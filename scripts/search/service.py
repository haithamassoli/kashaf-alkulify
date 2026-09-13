"""Local CPU retrieval API. Same search function is used by the UI and evaluator."""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from core import (MODEL, RERANKER, RERANK_REVISION, REVISION, STATE, Meili, anchor,
                  database, group_hits, normalize, phrase_spans, read_json, request)


def live_revisions(ids):
    current = {}
    for offset in range(0, len(ids), 50):
        response = request(os.environ["CONVEX_URL"].rstrip("/") + "/api/query",
                           {"path": "search:revisions", "args": {"ids": ids[offset:offset + 50]}, "format": "json"})
        if response.get("status") != "success":
            raise RuntimeError("Source validation unavailable")
        current.update((r["sourceId"], r["sourceRevision"]) for r in response["value"])
    return current


class Search:
    def __init__(self, generation=None, rerank=False, threads=2):
        self.generation = generation or read_json(STATE / "active.json")["generation"]
        self.directory = STATE / "releases" / self.generation
        self.manifest = read_json(self.directory / "manifest.json")
        if self.manifest["inventory"]["deployment"] != os.environ["CONVEX_DEPLOYMENT"]:
            raise ValueError("Release and live validation target different deployments")
        self.model = None
        self.reranker = None
        self.rerank = rerank
        self.threads = threads
        self.meili = Meili()

    def encoder(self):
        if self.model is None:
            # ponytail: keep one large model resident on an 8GB CPU host;
            # retain both only after measuring the destination server's RAM.
            self.reranker = None
            import gc
            gc.collect()
            import torch
            from sentence_transformers import SentenceTransformer
            torch.set_num_threads(self.threads)
            self.model = SentenceTransformer(MODEL, revision=REVISION, device="cpu", local_files_only=True)
            self.model.max_seq_length = self.manifest["config"]["maxTokens"]
        return self.model

    def rerank_hits(self, query, hits):
        if self.reranker is None:
            from sentence_transformers import CrossEncoder
            self.reranker = CrossEncoder(RERANKER, revision=RERANK_REVISION, device="cpu",
                                        max_length=2048, local_files_only=True)
        if any(len(self.reranker.tokenizer.encode(query, hit["text"])) > 2048 for hit in hits):
            raise ValueError("Reranker input exceeds its explicit token budget")
        scores = self.reranker.predict([(query, hit["text"]) for hit in hits], batch_size=2)
        return [hit for _, hit in sorted(zip(scores.tolist(), hits), key=lambda pair: pair[0], reverse=True)]

    def phrases(self, db, query, scope, count):
        normalized = normalize(query)
        if not normalized:
            return []
        # FTS narrows whole sources; application verifies consecutive tokens and maps raw offsets.
        expression = '"' + normalized.replace('"', '""') + '"'
        rows = db.execute("SELECT sourceId FROM phrases WHERE phrases MATCH ? AND scope=? ORDER BY rank LIMIT ?",
                          (expression, scope, count))
        hits = []
        for row in rows:
            source = db.execute("SELECT * FROM sources WHERE id=?", (row["sourceId"],)).fetchone()
            payload = json.loads(source["payload"])
            segments = json.loads(source["segments"])
            for left, right in phrase_spans(source["text"], query):
                # Context is shown separately; the evidence span remains the verified phrase.
                context_left, context_right = max(0, left - 160), min(len(source["text"]), right + 300)
                hits.append({"id": f"{payload['sourceId']}_{left}_{right}", "scope": scope,
                             "sourceId": payload["sourceId"], "sourceHash": payload["sourceHash"],
                             "sourceRevision": payload["sourceRevision"], "title": payload["title"],
                             "charStart": left, "charEnd": right,
                             "text": source["text"][left:right], "context": source["text"][context_left:context_right],
                             **anchor(segments, left, right)})
                if len(hits) >= count:
                    return hits
        return hits

    def run(self, query, scope="audio", mode="hybrid", candidates=100, all_occurrences=False,
            ratio=0.7, threshold=None, validate_live=True):
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 500:
            raise ValueError("Query must contain 1–500 characters")
        if not normalize(query) or not 0 <= ratio <= 1:
            raise ValueError("A query needs letters or digits and a ratio between 0 and 1")
        if scope not in ("audio", "articles") or mode not in ("phrase", "hybrid", "lexical"):
            raise ValueError("Unknown search scope or mode")
        if type(candidates) is not int or not 1 <= candidates <= 200:
            raise ValueError("Candidate limit must be 1–200")
        started = time.monotonic()
        db = database(self.directory / "corpus.sqlite")
        degraded = []
        widened = False
        try:
            if mode == "phrase":
                hits = self.phrases(db, query, scope, candidates)
            else:
                body = {"q": normalize(query, True), "limit": candidates,
                        "matchingStrategy": "all", "showRankingScore": True}
                if threshold is not None:
                    if not isinstance(threshold, (int, float)) or not 0 <= threshold <= 1:
                        raise ValueError("Threshold must be 0–1")
                    body["rankingScoreThreshold"] = threshold
                if mode == "hybrid":
                    if self.manifest.get("lexicalOnly"):
                        degraded.append("embeddings_incomplete")
                    else:
                        try:
                            model = self.encoder()
                            if len(model.tokenizer.encode(query)) > model.max_seq_length:
                                raise ValueError("Query exceeds model token budget")
                            body["vector"] = model.encode(query, normalize_embeddings=True).tolist()
                            body["hybrid"] = {"embedder": "bge", "semanticRatio": ratio}
                            if self.rerank:
                                self.model = None
                                del model
                                import gc
                                gc.collect()
                        except (OSError, RuntimeError):
                            degraded.append("embedding_unavailable")
                path = f"/indexes/{self.manifest['indexes'][scope]}/search"
                hits = self.meili.call(path, body)["hits"]
                if not hits:
                    body.pop("vector", None)
                    body.pop("hybrid", None)
                    body.pop("rankingScoreThreshold", None)
                    body["matchingStrategy"] = "frequency"
                    hits = self.meili.call(path, body)["hits"]
                    widened = bool(hits)
            if validate_live:
                revisions = live_revisions(list(dict.fromkeys(hit["sourceId"] for hit in hits)))
                fresh = [h for h in hits if revisions.get(h["sourceId"]) == h["sourceRevision"]]
                if len(fresh) != len(hits):
                    degraded.append("stale_sources_removed")
                hits = fresh
            retrieved = list(hits)
            if self.rerank and mode != "phrase" and hits:
                try:
                    hits = self.rerank_hits(query, hits)
                except (OSError, RuntimeError):
                    degraded.append("reranker_unavailable")
            for hit in hits:
                row = db.execute("SELECT * FROM sources WHERE id=?", (hit["sourceId"],)).fetchone()
                source = json.loads(row["payload"])
                left, right = max(0, hit["charStart"] - 160), min(len(row["text"]), hit["charEnd"] + 300)
                hit.setdefault("context", row["text"][left:right])
                hit["url"] = source["url"] if urllib.parse.urlsplit(source["url"]).scheme == "https" else ""
            displayed = group_hits(hits, all_occurrences)
            return {"generation": self.generation, "scope": scope, "mode": mode,
                    "pilot": self.manifest["pilot"], "sourceCount": self.manifest["sources"],
                    "degraded": degraded, "widened": widened, "candidateLimit": candidates,
                    "candidateLimitReached": len(retrieved) >= candidates,
                    "seconds": round(time.monotonic() - started, 3), "hits": displayed,
                    "candidates": retrieved, "reranked": self.rerank and not degraded and mode != "phrase"}
        finally:
            db.close()

    def playback(self, source_id, part_order):
        from cli import s3_client
        with database(self.directory / "corpus.sqlite") as db:
            row = db.execute("SELECT payload,segments FROM sources WHERE id=? AND scope='audio'", (source_id,)).fetchone()
        if row is None:
            raise ValueError("Source not found")
        source = json.loads(row["payload"])
        if live_revisions([source_id]).get(source_id) != source["sourceRevision"]:
            raise ValueError("Source changed or is no longer available")
        part = next((p for p in source["parts"] if p["order"] == part_order), None)
        if part is None:
            raise ValueError("Part not found")
        url = s3_client().generate_presigned_url("get_object", Params={"Bucket": os.environ["R2_ARCHIVE_BUCKET"],
                                                   "Key": part["r2Key"]}, ExpiresIn=3600)
        def stamp(ms):
            ms = max(0, round(ms))
            return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}.{ms % 1000:03}"
        import html
        captions = "WEBVTT\n\n" + "\n\n".join(
            f"{stamp(s['startMs'] - part['offsetMs'])} --> {stamp(s['endMs'] - part['offsetMs'])}\n{html.escape(s['text'])}"
            for s in json.loads(row["segments"]) if s["partOrder"] == part_order)
        return {"url": url, "offsetMs": part["offsetMs"], "durationMs": part["durationMs"],
                "captions": "data:text/vtt;charset=utf-8," + urllib.parse.quote(captions)}


def serve(args):
    search = Search(args.generation, args.rerank, args.threads)
    inference = threading.BoundedSemaphore(1)
    origin = os.getenv("SEARCH_ALLOWED_ORIGIN", "http://localhost:4321")

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *_):
            pass  # Do not persist religious questions or signed playback URLs.

        def reply(self, status, payload):
            raw = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            if self.headers.get("Origin") == origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            if self.headers.get("Origin") != origin:
                self.reply(403, {"error": "Origin not allowed"})
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {"status": "ready", "generation": search.generation,
                                 "lexicalOnly": search.manifest.get("lexicalOnly", False)})
                return
            self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if self.headers.get("Origin") not in (None, origin):
                self.reply(403, {"error": "Origin not allowed"})
                return
            if not inference.acquire(blocking=False):
                self.reply(429, {"error": "Search is busy; please retry"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192:
                    raise ValueError("Invalid body length")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("Expected JSON object")
                if self.path == "/search":
                    allowed = {"query", "scope", "mode", "allOccurrences"}
                    if set(body) - allowed or type(body.get("allOccurrences", False)) is not bool:
                        raise ValueError("Invalid search fields")
                    result = search.run(body.get("query"), body.get("scope", "audio"), body.get("mode", "hybrid"),
                                        candidates=args.candidates, ratio=args.ratio, threshold=args.threshold,
                                        all_occurrences=body.get("allOccurrences", False))
                    result.pop("candidates")
                    self.reply(200, result)
                elif self.path == "/playback":
                    if not isinstance(body.get("sourceId"), str) or type(body.get("partOrder")) is not int:
                        raise ValueError("Invalid playback fields")
                    self.reply(200, search.playback(body["sourceId"], body["partOrder"]))
                else:
                    self.reply(404, {"error": "Not found"})
            except (ValueError, TypeError):
                self.reply(400, {"error": "Invalid request or source no longer available"})
            except Exception:
                self.reply(503, {"error": "Search temporarily unavailable"})
            finally:
                inference.release()

    print(f"Search API http://127.0.0.1:{args.port}; generation={search.generation}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
