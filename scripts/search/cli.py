"""Reproducible local search releases. Run with .search-venv/bin/python."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import platform
import secrets
import subprocess
import sys
import time
from pathlib import Path

from core import (MODEL, NORM_VERSION, REVISION, ROOT, STATE, Meili, anchor,
                  database, digest, embedding_input_hash, load_env, normalize, passage_ranges,
                  read_json, source_text, write_json)


def export(args):
    deployment = os.environ["CONVEX_DEPLOYMENT"]
    checkpoint = STATE / "export-checkpoint.json"
    state = read_json(checkpoint) if checkpoint.exists() else {}
    if state.get("deployment") != deployment:
        state = {"deployment": deployment, "sources": [], "inventory": {}, "cursors": {}}
    sources = state["sources"]
    inventory = state["inventory"]
    for scope in ("audio", "articles"):
        if scope in inventory:
            continue
        cursor, scanned = state["cursors"].get(scope, [None, 0])
        while True:
            result = subprocess.run(
                ["npx", "convex", "run", "search:exportPage", json.dumps({
                    "scope": scope, "paginationOpts": {"numItems": 50, "cursor": cursor}
                }), "--codegen", "disable", "--deployment", deployment.split(":", 1)[-1]], cwd=ROOT,
                capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(f"Convex export failed; checkpoint retained. {result.stderr[-1500:]}")
            page = json.loads(result.stdout)
            sources.extend(json.loads(page["payload"]))
            scanned += page["scanned"]
            cursor = page["cursor"]
            state["cursors"][scope] = [cursor, scanned]
            print(f"export {scope}: scanned={scanned} eligible={sum(s['scope'] == scope for s in sources)}", flush=True)
            if page["done"]:
                inventory[scope] = {"scanned": scanned, "eligible": sum(s["scope"] == scope for s in sources)}
                write_json(checkpoint, state)
                break
            write_json(checkpoint, state)
    ids = [s["sourceId"] for s in sources]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate sources in export; retry after source writers finish")
    write_json(STATE / "sources.json", sources)
    write_json(STATE / "inventory.json", {"createdAt": time.time(), "deployment": os.getenv("CONVEX_DEPLOYMENT"),
                                        "inventory": inventory, "digest": digest(sources)})
    checkpoint.unlink(missing_ok=True)
    print(json.dumps(inventory))


def s3_client():
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"],
                        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto",
                        config=Config(connect_timeout=15, read_timeout=60,
                                      retries={"max_attempts": 3, "mode": "standard"}))


def prepare(args):
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
    source_rows = read_json(STATE / "sources.json")
    # A deterministic pilot samples across the archive rather than its first lessons.
    selected = []
    for scope in ("audio", "articles"):
        rows = sorted((s for s in source_rows if s["scope"] == scope), key=lambda s: digest(s["sourceId"]))
        selected.extend(rows[:args.limit] if args.limit else rows)
    if not selected:
        raise ValueError("No eligible sources")
    config = {"model": MODEL, "revision": REVISION, "dimensions": 1024,
              "pooling": "cls", "normalizeEmbeddings": True, "precision": "float32",
              "maxTokens": args.tokens, "documentTemplate": "body-only", "queryTemplate": "raw",
              "normalization": NORM_VERSION, "chunkSeconds": args.seconds, "chunkVersion": 1}
    inventory = read_json(STATE / "inventory.json")
    if inventory["deployment"] != os.environ["CONVEX_DEPLOYMENT"]:
        raise ValueError("Export belongs to another deployment")
    generation = digest({"sources": selected, "config": config})[:20]
    directory = STATE / "releases" / generation
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "manifest.json").exists():
        print(f"Already prepared: {generation}")
        return
    target = directory / "corpus.sqlite.tmp"
    target.unlink(missing_ok=True)
    db = database(target)
    db.executescript("""
        CREATE TABLE sources(id TEXT PRIMARY KEY, scope TEXT, payload TEXT, text TEXT, segments TEXT);
        CREATE VIRTUAL TABLE phrases USING fts5(sourceId UNINDEXED, scope UNINDEXED, text, tokenize='unicode61 remove_diacritics 0');
        CREATE TABLE passages(id TEXT PRIMARY KEY, scope TEXT, payload TEXT, inputHash TEXT);
    """)
    s3 = s3_client()
    counts = {"audio": 0, "articles": 0}
    text_hashes = []
    for index, source in enumerate(selected):
        artifact = None
        if source["scope"] == "audio":
            key = source["transcriptKey"]
            # Fetch current bytes even when a key is reused; cache only embeddings by actual input.
            artifact = json.loads(s3.get_object(Bucket=os.environ["R2_ARCHIVE_BUCKET"], Key=key)["Body"].read())
        text, segments = source_text(source, artifact)
        source = {**source, "sourceHash": digest({"text": text, "segments": segments}), "text": text}
        text_hashes.append((source["sourceId"], source["sourceHash"]))
        db.execute("INSERT INTO sources VALUES (?,?,?,?,?)",
                   (source["sourceId"], source["scope"], json.dumps(source, ensure_ascii=False), text,
                    json.dumps(segments, ensure_ascii=False)))
        db.execute("INSERT INTO phrases VALUES (?,?,?)", (source["sourceId"], source["scope"], normalize(text)))
        for left, right in passage_ranges(text, segments, tokenizer, args.seconds, args.tokens):
            raw = text[left:right]
            identity = {"sourceId": source["sourceId"], "sourceHash": source["sourceHash"],
                        "charStart": left, "charEnd": right, "config": config}
            input_hash = embedding_input_hash(raw, config)
            document = {"id": digest(identity), "sourceId": source["sourceId"],
                        "sourceHash": source["sourceHash"], "sourceRevision": source["sourceRevision"],
                        "scope": source["scope"], "title": source["title"], "text": raw,
                        "lexicalText": normalize(raw, True), "lexicalTitle": normalize(source["title"], True),
                        "charStart": left, "charEnd": right, "inputHash": input_hash,
                        **anchor(segments, left, right)}
            db.execute("INSERT INTO passages VALUES (?,?,?,?)", (document["id"], document["scope"], json.dumps(document, ensure_ascii=False), input_hash))
            counts[source["scope"]] += 1
        if index % 25 == 0:
            db.commit()
            print(f"prepare {index + 1}/{len(selected)}: {counts}", flush=True)
    db.commit()
    db.close()
    target.replace(directory / "corpus.sqlite")
    # Include actual R2 bytes in the final identity, not just mutable object keys.
    final_generation = digest({"generation": generation, "sourceHashes": text_hashes})[:20]
    final_directory = directory.with_name(final_generation)
    if final_directory.exists():
        existing = read_json(final_directory / "manifest.json")
        if existing["config"] != config or existing["sourceDigest"] != digest(text_hashes):
            raise ValueError("Existing release identity mismatch")
        (directory / "corpus.sqlite").unlink()
        directory.rmdir()
        write_json(STATE / "prepared.json", {"generation": final_generation})
        print(f"Reused identical prepared release: {final_generation}")
        return
    directory.rename(final_directory)
    manifest = {"generation": final_generation, "createdAt": time.time(), "config": config,
                "sources": len(selected), "counts": counts, "sourceDigest": digest(text_hashes),
                "pilot": bool(args.limit), "indexes": {scope: f"search_{scope}_{final_generation}" for scope in counts},
                "inventory": read_json(STATE / "inventory.json"), "state": "prepared"}
    write_json(final_directory / "manifest.json", manifest)
    write_json(STATE / "prepared.json", {"generation": final_generation})
    print(json.dumps(manifest, indent=2))


def release(args):
    generation = args.generation or read_json(STATE / "prepared.json")["generation"]
    if not generation.isalnum():
        raise ValueError("Invalid generation")
    directory = STATE / "releases" / generation
    manifest = read_json(directory / "manifest.json")
    if manifest["inventory"]["deployment"] != os.environ["CONVEX_DEPLOYMENT"]:
        raise ValueError("Release belongs to another deployment")
    return directory, manifest


def embedding_cache():
    db = database(STATE / "embeddings.sqlite")
    db.execute("CREATE TABLE IF NOT EXISTS embeddings(inputHash TEXT PRIMARY KEY, vector TEXT)")
    return db


def embed(args):
    import torch
    from sentence_transformers import SentenceTransformer
    directory, manifest = release(args)
    db = database(directory / "corpus.sqlite")
    cache = embedding_cache()
    torch.set_num_threads(args.threads)
    model = SentenceTransformer(MODEL, revision=REVISION, device="cpu", local_files_only=True)
    model.max_seq_length = manifest["config"]["maxTokens"]
    started = time.monotonic()
    pending = []
    encoded = skipped = 0

    def flush():
        nonlocal encoded
        texts = [json.loads(row["payload"])["text"] for row in pending]
        for text in texts:
            if len(model.tokenizer.encode(text, add_special_tokens=True)) > model.max_seq_length:
                raise ValueError("Unrecorded model truncation")
        vectors = model.encode(texts, batch_size=args.batch, normalize_embeddings=True, convert_to_numpy=True)
        for row, vector in zip(pending, vectors, strict=True):
            if vector.shape != (1024,) or not torch.isfinite(torch.from_numpy(vector)).all():
                raise ValueError("Invalid embedding")
            cache.execute("INSERT OR REPLACE INTO embeddings VALUES (?,?)", (row["inputHash"], json.dumps(vector.tolist())))
        cache.commit()
        encoded += len(pending)
        pending.clear()
        print(f"embed encoded={encoded} reused={skipped} seconds={time.monotonic() - started:.1f}", flush=True)

    for row in db.execute("SELECT * FROM passages ORDER BY id"):
        if cache.execute("SELECT 1 FROM embeddings WHERE inputHash=?", (row["inputHash"],)).fetchone():
            skipped += 1
            continue
        pending.append(row)
        if len(pending) >= args.batch:
            flush()
        if args.limit and encoded >= args.limit:
            break
    if pending:
        flush()
    write_json(directory / "embed-report.json", {"encoded": encoded, "reused": skipped,
               "seconds": time.monotonic() - started, "device": "cpu", "threads": args.threads,
               "machine": platform.machine(), "torch": torch.__version__})


def settings(manifest):
    return {"searchableAttributes": ["lexicalText", "lexicalTitle"], "displayedAttributes": ["*"],
            "filterableAttributes": ["sourceId"], "distinctAttribute": None,
            "stopWords": [], "synonyms": {}, "searchCutoffMs": 10000,
            "pagination": {"maxTotalHits": 10000},
            "typoTolerance": {"disableOnNumbers": True},
            "embedders": {"bge": {"source": "userProvided", "dimensions": 1024}}}


def index(args):
    directory, manifest = release(args)
    if (STATE / "active.json").exists() and read_json(STATE / "active.json")["generation"] == manifest["generation"]:
        raise ValueError("Active releases are immutable; build another generation before changing indexes")
    (directory / "verify-report.json").unlink(missing_ok=True)
    db = database(directory / "corpus.sqlite")
    cache = embedding_cache()
    meili = Meili()
    indexes = {row["uid"] for row in meili.call("/indexes?limit=1000")["results"]}
    for scope, name in manifest["indexes"].items():
        if name not in indexes:
            meili.task("/indexes", {"uid": name, "primaryKey": "id"})
        # Declare before uploading any vectors. Every asynchronous task is checked.
        meili.task(f"/indexes/{name}/settings", settings(manifest), "PATCH")
        batch = []
        for row in db.execute("SELECT * FROM passages WHERE scope=? ORDER BY id", (scope,)):
            document = json.loads(row["payload"])
            vector = cache.execute("SELECT vector FROM embeddings WHERE inputHash=?", (row["inputHash"],)).fetchone()
            if not vector:
                if not args.lexical:
                    raise ValueError("Missing embeddings: run embed or explicitly use index --lexical")
                document["_vectors"] = {"bge": {"embeddings": [], "regenerate": False}}
            else:
                document["_vectors"] = {"bge": {"embeddings": json.loads(vector["vector"]), "regenerate": False}}
            batch.append(document)
            if len(batch) == 100:
                meili.task(f"/indexes/{name}/documents", batch)
                batch.clear()
        if batch:
            meili.task(f"/indexes/{name}/documents", batch)
        print(f"indexed {scope}: {manifest['counts'][scope]}", flush=True)
    manifest["state"] = "indexed"
    manifest["lexicalOnly"] = args.lexical
    manifest["meiliVersion"] = meili.call("/version")["pkgVersion"]
    write_json(directory / "manifest.json", manifest)


def verify(args):
    directory, manifest = release(args)
    db = database(directory / "corpus.sqlite")
    meili = Meili()
    cache = embedding_cache()
    sources = {}
    for row in db.execute("SELECT * FROM sources"):
        payload = json.loads(row["payload"])
        segments = json.loads(row["segments"])
        if digest({"text": row["text"], "segments": segments}) != payload["sourceHash"]:
            raise ValueError("Local source hash mismatch")
        if payload["scope"] == "audio":
            source_text(payload, {"lessonId": payload["sourceId"], "assemblyHash": payload["assemblyHash"],
                                  "parts": payload["parts"], "segments": segments})
        sources[row["id"]] = row["text"]
    result = {}
    for scope, name in manifest["indexes"].items():
        expected = {row["id"]: json.loads(row["payload"]) for row in db.execute("SELECT * FROM passages WHERE scope=?", (scope,))}
        for document in expected.values():
            if sources[document["sourceId"]][document["charStart"]:document["charEnd"]] != document["text"]:
                raise ValueError("Passage is not the claimed original source span")
            if embedding_input_hash(document["text"], manifest["config"]) != document["inputHash"]:
                raise ValueError("Embedding input hash mismatch")
            if normalize(document["text"], True) != document["lexicalText"]:
                raise ValueError("Lexical representation mismatch")
        found = {}
        offset = 0
        vectors = 0
        while True:
            page = meili.call(f"/indexes/{name}/documents?offset={offset}&limit=100&retrieveVectors=true")["results"]
            for document in page:
                identity = document["id"]
                if identity in found or identity not in expected:
                    raise ValueError("Unexpected or duplicated indexed ID")
                vector = document.pop("_vectors", {}).get("bge", {}).get("embeddings", [])
                if vector:
                    import math
                    flat = vector[0] if isinstance(vector[0], list) else vector
                    if len(flat) != 1024 or not all(math.isfinite(v) for v in flat):
                        raise ValueError("Corrupt indexed vector")
                    cached = cache.execute("SELECT vector FROM embeddings WHERE inputHash=?", (expected[identity]["inputHash"],)).fetchone()
                    if cached is None or any(abs(a - b) > 0.00001 for a, b in zip(flat, json.loads(cached["vector"]), strict=True)):
                        raise ValueError("Indexed vector differs from the vector for this exact input")
                    vectors += 1
                if document != expected[identity]:
                    raise ValueError(f"Indexed content differs from manifest: {identity}")
                found[identity] = True
            offset += len(page)
            if len(page) < 100:
                break
        if set(found) != set(expected):
            raise ValueError("Indexed/source ID mismatch")
        if not manifest.get("lexicalOnly") and vectors != len(expected):
            raise ValueError("Incomplete embedding coverage")
        actual = meili.call(f"/indexes/{name}/settings")
        for key, value in settings(manifest).items():
            if key in ("embedders", "typoTolerance"):
                for subkey, subvalue in value.items():
                    if key == "embedders":
                        if any(actual[key][subkey].get(k) != v for k, v in subvalue.items()):
                            raise ValueError("Embedder configuration mismatch")
                    elif actual[key][subkey] != subvalue:
                        raise ValueError("Typo configuration mismatch")
            elif actual[key] != value:
                raise ValueError(f"Settings mismatch: {key}")
        result[scope] = {"documents": len(found), "vectors": vectors, "idsAndContentsMatch": True}
    from service import live_revisions
    rows = [json.loads(row["payload"]) for row in db.execute("SELECT payload FROM sources")]
    current = live_revisions([r["sourceId"] for r in rows])
    stale = [r["sourceId"] for r in rows if current.get(r["sourceId"]) != r["sourceRevision"]]
    if stale:
        raise ValueError(f"{len(stale)} source revisions changed; export and prepare again")
    report = {"generation": manifest["generation"], "meiliHost": meili.host, "verifiedAt": time.time(), "result": result,
              "liveRevisionsMatch": True, "qualityApproved": False}
    write_json(directory / "verify-report.json", report)
    print(json.dumps(report, indent=2))


def activate(args):
    directory, manifest = release(args)
    report = read_json(directory / "verify-report.json")
    if report["generation"] != manifest["generation"] or time.time() - report["verifiedAt"] > 3600:
        raise ValueError("Run verify on this generation within the last hour")
    if report.get("meiliHost") != Meili().host:
        raise ValueError("Verification targeted a different Meilisearch host; run verify again")
    if (STATE / "active.json").exists():
        active = read_json(STATE / "active.json")
        if active["generation"] != manifest["generation"]:
            write_json(STATE / "previous.json", active)
    # One atomic pointer switches both immutable Meili names and the phrase database.
    write_json(STATE / "active.json", {"generation": manifest["generation"]})
    print(f"Activated local generation {manifest['generation']}; human relevance approval remains separate")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["export", "prepare", "embed", "index", "verify", "activate", "serve", "eval", "seed-eval", "start-engine"])
    parser.add_argument("--generation")
    parser.add_argument("--limit", type=int, default=0, help="prepare: sources per scope; embed: newly encoded passages")
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--tokens", type=int, default=512)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--lexical", action="store_true")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--rerank", action="store_true")
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--mode", choices=["lexical", "hybrid", "phrase"], default="hybrid")
    parser.add_argument("--candidates", type=int, default=100)
    parser.add_argument("--ratio", type=float, default=0.7)
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--heldout", action="store_true")
    args = parser.parse_args()
    load_env()
    STATE.mkdir(exist_ok=True)
    if args.limit < 0 or not 1 <= args.batch <= 32 or not 1 <= args.tokens <= 8192 or args.seconds < 1:
        parser.error("Invalid limits")
    if args.command == "serve":
        from service import serve
        serve(args)
        return
    if args.command in ("eval", "seed-eval"):
        from evaluate import evaluate, seed
        (seed if args.command == "seed-eval" else evaluate)(args)
        return
    if args.command == "start-engine":
        key_path = STATE / "meili-key"
        key = os.getenv("MEILI_MASTER_KEY")
        if not key and not key_path.exists():
            key_path.write_text(secrets.token_hex(32))
            key_path.chmod(0o600)
        env = {**os.environ, "MEILI_MASTER_KEY": key or key_path.read_text().strip()}
        os.execve(STATE / "bin" / "meilisearch", ["meilisearch", "--http-addr", "127.0.0.1:7700",
                  "--db-path", str(STATE / "meili-db"), "--no-analytics", "--max-indexing-memory", "512MiB"], env)
    # ponytail: one local writer; move to the existing worker's stage lock for multiple hosts.
    with (STATE / "writer.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.exit(2, "Another search writer is running; retry when it finishes.\n")
        {"export": export, "prepare": prepare, "embed": embed, "index": index,
         "verify": verify, "activate": activate}[args.command](args)


if __name__ == "__main__":
    main()
