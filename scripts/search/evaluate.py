"""Evidence-range evaluation; generated smoke cases never claim human relevance."""

import json
import statistics
import time

from core import STATE, database, digest, grade, metrics, read_json, tokens, write_json
from service import Search


def seed(args):
    from cli import release
    directory, manifest = release(args)
    db = database(directory / "corpus.sqlite")
    cases = []
    for scope in ("audio", "articles"):
        seen = set()
        for row in db.execute("SELECT payload FROM passages WHERE scope=? ORDER BY id", (scope,)):
            hit = json.loads(row["payload"])
            if hit["sourceId"] in seen:
                continue
            words = tokens(hit["text"])
            if len(words) < 12:
                continue
            start, end = words[3][1], words[10][2]
            query = hit["text"][start:end]
            seen.add(hit["sourceId"])
            cases.append({"id": f"smoke_{scope}_{len(seen)}", "family": hit["sourceId"],
                          "split": "development", "scope": scope, "intent": "phrase",
                          "query": query, "reviewed": False, "provenance": "generated_exact_phrase_smoke",
                          "gold": [{"sourceId": hit["sourceId"], "sourceHash": hit["sourceHash"],
                                    "charStart": hit["charStart"] + start, "charEnd": hit["charStart"] + end,
                                    "grade": 3}]})
            if len(seen) >= 25:
                break
    path = args.dataset or directory / "smoke-queries.json"
    write_json(path, {"version": 1, "generation": manifest["generation"], "cases": cases})
    print(f"Wrote {len(cases)} generated smoke cases to {path}; not a relevance benchmark")


def evaluate(args):
    from cli import release
    directory, manifest = release(args)
    path = args.dataset or directory / "smoke-queries.json"
    dataset = read_json(path)
    cases = dataset["cases"]
    if not cases:
        raise ValueError("Empty evaluation dataset")
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate evaluation IDs")
    families = {}
    for case in cases:
        family = case["family"]
        if family in families and families[family] != case["split"]:
            raise ValueError("Query family leaks across development/heldout splits")
        families[family] = case["split"]
    if any(case["split"] == "heldout" for case in cases) and not args.heldout:
        raise ValueError("Heldout evaluation requires --heldout; freeze settings before using it")
    config = {"generation": manifest["generation"], "mode": args.mode, "candidates": args.candidates,
              "ratio": args.ratio, "threshold": args.threshold, "rerank": args.rerank}
    reference = None
    if args.rerank:
        baseline_config = {**config, "rerank": False}
        for filename in sorted(directory.glob(f"eval-{args.mode}-base-*.json")):
            report = read_json(filename)
            if report["config"] == baseline_config and report["datasetDigest"] == digest(dataset):
                reference = {r["id"]: r.get("candidateIds") for r in report["results"]}
        if reference is None or any(ids is None for ids in reference.values()):
            raise ValueError("Run the matching no-reranker evaluation first to freeze candidate IDs")
    if args.heldout:
        frozen = directory / "heldout-config.json"
        if frozen.exists() and read_json(frozen) != config:
            raise ValueError("Heldout settings already frozen; create fresh query families before retuning")
        write_json(frozen, config)
    db = database(directory / "corpus.sqlite")
    for case in cases:
        if not case.get("gold") and not case.get("noUsefulEvidence"):
            raise ValueError(f"Case {case['id']} needs evidence ranges or an explicit no-evidence judgment")
        for gold in case.get("gold", []):
            row = db.execute("SELECT * FROM sources WHERE id=?", (gold["sourceId"],)).fetchone()
            if row is None or json.loads(row["payload"])["sourceHash"] != gold["sourceHash"]:
                raise ValueError(f"Gold source missing or changed: {case['id']}")
            if not 0 <= gold["charStart"] < gold["charEnd"] <= len(row["text"]) or gold["grade"] not in (0, 1, 2, 3):
                raise ValueError("Invalid gold evidence range/grade")
    search = Search(manifest["generation"], args.rerank, args.threads)
    results = []
    for case in cases:
        response = search.run(case["query"], scope=case["scope"], mode=args.mode,
                              candidates=args.candidates, ratio=args.ratio, threshold=args.threshold)
        candidate_ids = [hit["id"] for hit in response["candidates"]]
        if reference is not None and reference.get(case["id"]) != candidate_ids:
            raise ValueError("Candidate IDs/order changed; this is not a controlled reranker comparison")
        if args.rerank and "reranker_unavailable" in response["degraded"]:
            raise RuntimeError("Reranker did not run; download its pinned model before evaluating it")
        scores = metrics(response["hits"], response["candidates"], case.get("gold", []))
        scores["falseDirect"] = int(bool(case.get("noUsefulEvidence") and response["hits"] and not response["widened"]))
        scores["falseAny"] = int(bool(case.get("noUsefulEvidence") and response["hits"]))
        results.append({"id": case["id"], "scope": case["scope"], "intent": case.get("intent"),
                        "candidateIds": candidate_ids, "reranked": response["reranked"],
                        "scores": scores, "seconds": response["seconds"], "degraded": response["degraded"],
                        "widened": response["widened"], "candidateLimitReached": response["candidateLimitReached"],
                        "displayed": [{"sourceId": hit["sourceId"], "charStart": hit["charStart"],
                                       "charEnd": hit["charEnd"], "grade": grade(hit, case.get("gold", []))}
                                      for hit in response["hits"][:10]]})
        print(f"eval {case['id']}: success3={scores['success3']} recall={scores['candidateRecall']} seconds={response['seconds']}", flush=True)
    answerable = {case["id"] for case in cases if any(g["grade"] >= 2 for g in case.get("gold", []))}
    aggregates = {}
    for scope in ("all", "audio", "articles"):
        rows = [r for r in results if (scope == "all" or r["scope"] == scope) and r["id"] in answerable]
        aggregates[scope] = {}
        for key in ("success3", "success5", "mrr3", "ndcg10", "candidateRecall"):
            values = [r["scores"][key] for r in rows if r["scores"][key] is not None]
            aggregates[scope][key] = statistics.mean(values) if values else None
    latencies = sorted(r["seconds"] for r in results)
    report = {"config": config, "datasetDigest": digest(dataset), "cases": len(cases),
              "reviewedCases": sum(bool(c.get("reviewed")) for c in cases),
              "qualityApproved": False, "interpretation": "Diagnostic only; human gold review and release gates are separate.",
              "metrics": aggregates, "falseDirect": sum(r["scores"]["falseDirect"] for r in results),
              "falseAny": sum(r["scores"]["falseAny"] for r in results),
              "negativeCases": sum(bool(c.get("noUsefulEvidence")) for c in cases),
              "p50Seconds": statistics.median(latencies), "p95Seconds": latencies[min(len(latencies) - 1, int(len(latencies) * .95))],
              "results": results}
    output = directory / f"eval-{args.mode}-{'rerank' if args.rerank else 'base'}-{int(time.time())}.json"
    write_json(output, report)
    print(json.dumps({"report": str(output), "metrics": aggregates, "reviewedCases": report["reviewedCases"]}, indent=2))
