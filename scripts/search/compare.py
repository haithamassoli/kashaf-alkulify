"""Compare live search systems on one question set with pooled, graded judgments.

Stdlib only, so it runs with any python3 against the public endpoints:

  python3 scripts/search/compare.py run --system old --label old-live
  python3 scripts/search/compare.py run --system new --label new-live
  python3 scripts/search/compare.py pool old-live new-live      # unjudged top-5 hits, blind
  python3 scripts/search/compare.py import                      # merge graded batches
  python3 scripts/search/compare.py score old-live new-live     # quality + latency report
  python3 scripts/search/compare.py load --system new           # concurrent users

`--endpoint` points `new` at a local `npm run search:serve` to score a change before shipping it.
Judgments are keyed by query + exact hit text, so re-chunked passages come back unjudged
instead of silently inheriting an old grade.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "search" / "compare"
STATE = ROOT / ".search" / "compare"
DEPTH = 5
OLD_HOST = "https://search.assoli.site"
NEW_ENDPOINT = "https://search.assoli.site/api"
# The old site ships this search-only key in its public JS bundle.
OLD_KEY = os.getenv("OLD_SEARCH_KEY", "")


def post(url, body, headers, timeout=180):
    request = urllib.request.Request(url, json.dumps(body, ensure_ascii=False).encode(),
                                     {"Content-Type": "application/json", **headers}, method="POST")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read()), 200, time.monotonic() - started
    except urllib.error.HTTPError as error:
        return None, error.code, time.monotonic() - started
    except OSError:
        return None, 0, time.monotonic() - started


def key(case_id, title, text):
    return hashlib.sha1(f"{case_id}\n{title}\n{text}".encode()).hexdigest()[:16]


def old_search(case, _endpoint, _mode):
    """Mirrors kashaf-abu-jaafar src/lib/meili.ts search(): strict hybrid, lesson block, labelled widening."""
    headers = {"Authorization": f"Bearer {OLD_KEY}", "Origin": "https://alkulify-y.assoli.site"}
    q, audio = case["query"], case["scope"] == "audio"

    def pair(strategy):
        shared = {"q": q, "locales": ["ara"], "matchingStrategy": strategy, "page": 1}
        if strategy == "all":
            shared |= {"hybrid": {"embedder": "default", "semanticRatio": 0.7}, "rankingScoreThreshold": 0.765}
        return {"queries": [{"indexUid": "cues", **shared, "hitsPerPage": 20 if audio else 0},
                            {"indexUid": "articles", **shared, "hitsPerPage": 0 if audio else 20}]}

    started = time.monotonic()
    with ThreadPoolExecutor(2) as pool:
        strict = pool.submit(post, f"{OLD_HOST}/multi-search", pair("all"), headers)
        lessons = pool.submit(post, f"{OLD_HOST}/indexes/lessons/search",
                              {"q": q, "locales": ["ara"], "matchingStrategy": "all", "hitsPerPage": 3}, headers)
        (data, status, _), (lesson_data, _, _) = strict.result(), lessons.result()
    if data is None:
        return {"status": status, "seconds": time.monotonic() - started, "hits": []}
    cues, articles = data["results"]
    lesson_total = (lesson_data or {}).get("totalHits", 0)
    telling = len(q.split()) >= 2 and 0 < lesson_total <= 300
    widened = False
    if not cues["totalHits"] and not articles["totalHits"] and not telling:
        relaxed, status, _ = post(f"{OLD_HOST}/multi-search", pair("frequency"), headers)
        if relaxed and (relaxed["results"][0]["totalHits"] or relaxed["results"][1]["totalHits"]):
            cues, articles = relaxed["results"]
            widened = True
    active = cues if audio else articles
    return {"status": status, "seconds": time.monotonic() - started, "widened": widened,
            "total": active["totalHits"], "lessonBlock": len((lesson_data or {}).get("hits", [])) if telling else 0,
            "hits": [{"title": h["title"], "text": h["text"], "start": h.get("start")} for h in active["hits"]]}


def new_search(case, endpoint, mode):
    retries = 0
    while True:
        data, status, seconds = post(f"{endpoint}/search", {"query": case["query"], "scope": case["scope"], "mode": mode},
                                     {"Origin": "https://alkulify.assoli.site"})
        # One inference slot: a 429 is someone else's search, so wait rather than record a failure.
        if status != 429 or retries == 6:
            break
        retries += 1
        time.sleep(1.5 * retries)
    if data is None:
        return {"status": status, "seconds": seconds, "retries": retries, "hits": []}
    return {"status": status, "seconds": seconds, "retries": retries, "widened": data["widened"],
            "total": len(data["hits"]), "degraded": data["degraded"],
            "hits": [{"title": h["title"], "text": h["text"], "start": h.get("startMs")} for h in data["hits"]]}


SYSTEMS = {"old": old_search, "new": new_search}


def cases():
    return json.loads((DATA / "questions.json").read_text())["cases"]


def load_run(label):
    return json.loads((STATE / "runs" / f"{label}.json").read_text())


def judgments():
    path = DATA / "judgments.json"
    return json.loads(path.read_text()) if path.exists() else {}


def run(args):
    if args.system == "old" and not OLD_KEY:
        raise SystemExit("Set OLD_SEARCH_KEY to the old site's public search key")
    results = []
    for case in cases():
        result = SYSTEMS[args.system](case, args.endpoint, args.mode)
        result["hits"] = [{**h, "key": key(case["id"], h["title"], h["text"])} for h in result["hits"][:10]]
        results.append({"id": case["id"], **result})
        print(f"{case['id']} {args.system} {result['status']} {result['seconds']:.2f}s hits={len(result['hits'])}", flush=True)
        time.sleep(args.pause)
    path = STATE / "runs" / f"{args.label}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"system": args.system, "mode": args.mode, "endpoint": args.endpoint,
                                "createdAt": time.time(), "results": results}, ensure_ascii=False))
    print(path)


def pool(args):
    judged, by_id = judgments(), {c["id"]: c for c in cases()}
    items = {}
    for label in args.runs:
        for result in load_run(label)["results"]:
            case = by_id[result["id"]]
            if case["category"] == "none":
                continue
            for hit in result["hits"][:DEPTH]:
                if hit["key"] not in judged.get(case["id"], {}):
                    items[hit["key"]] = {"key": hit["key"], "id": case["id"], "query": case["query"],
                                         "scope": case["scope"], "category": case["category"],
                                         "title": hit["title"], "text": hit["text"]}
    items = list(items.values())
    random.Random(0).shuffle(items)  # judges must not see which system ranked what
    directory = STATE / "pool"
    directory.mkdir(parents=True, exist_ok=True)
    for index in range(0, len(items), args.batch):
        (directory / f"batch-{index // args.batch:02d}.json").write_text(
            json.dumps(items[index:index + args.batch], ensure_ascii=False, indent=1))
    print(f"{len(items)} unjudged hits in {math.ceil(len(items) / args.batch)} batches under {directory}")


def import_grades(_args):
    judged = judgments()
    for batch in sorted((STATE / "pool").glob("batch-??.json")):
        grades_path = batch.with_suffix(".grades.json")
        if not grades_path.exists():
            print(f"missing {grades_path.name}")
            continue
        grades = json.loads(grades_path.read_text())
        for item in json.loads(batch.read_text()):
            grade = grades.get(item["key"])
            if grade in (0, 1, 2):
                judged.setdefault(item["id"], {})[item["key"]] = {"g": grade, "t": f"{item['title'][:40]} | {item['text'][:60]}"}
    (DATA / "judgments.json").write_text(json.dumps(judged, ensure_ascii=False, indent=1, sort_keys=True))
    print(f"{sum(map(len, judged.values()))} judgments")


def dcg(grades):
    return sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(grades))


def case_scores(grades, pool_grades):
    """grades: top-DEPTH grades in displayed order (None = unjudged). pool_grades: every judged grade for the case."""
    known = [g or 0 for g in grades[:DEPTH]]
    ideal = dcg(sorted(pool_grades, reverse=True)[:DEPTH])
    first = next((i for i, g in enumerate(known) if g == 2), None)
    return {"s1": int(first == 0), "s3": int(first is not None and first < 3), "s5": int(first is not None),
            "mrr": 0 if first is None else 1 / (first + 1), "ndcg": dcg(known) / ideal if ideal else 0,
            "useful": sum(g >= 1 for g in known) / len(known) if known else 0,
            "junk": sum(g == 0 for g in known) / len(known) if known else 0,
            "unjudged": sum(g is None for g in grades[:DEPTH])}


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * fraction))]


def score(args):
    judged, all_cases = judgments(), cases()
    runs = {label: {r["id"]: r for r in load_run(label)["results"]} for label in args.runs}
    answerable = {c["id"] for c in all_cases if any(j["g"] == 2 for j in judged.get(c["id"], {}).values())}
    rows = {}
    for label, results in runs.items():
        per_case = {}
        for case in all_cases:
            result = results[case["id"]]
            if case["category"] == "none" or case["id"] not in answerable:
                continue
            grades = [judged.get(case["id"], {}).get(h["key"], {}).get("g") for h in result["hits"]]
            per_case[case["id"]] = case_scores(grades, [j["g"] for j in judged[case["id"]].values()])
        # A widened (labelled «closest matches») page is honest; only unlabelled hits count as confident.
        confident = lambda group: sum(bool(results[c["id"]]["hits"]) and not results[c["id"]].get("widened")  # noqa: E731
                                      for c in group)
        rows[label] = {"per_case": per_case, "results": results,
                       "unanswered": confident([c for c in all_cases if c["category"] != "none" and c["id"] not in answerable]),
                       "none": confident([c for c in all_cases if c["category"] == "none"])}
    mean = lambda values: statistics.mean(values) if values else 0  # noqa: E731
    lines = [f"Answerable cases (a judged grade-2 hit exists): {len(answerable)} of "
             f"{sum(c['category'] != 'none' for c in all_cases)}; out-of-corpus cases: "
             f"{sum(c['category'] == 'none' for c in all_cases)}.\n",
             "| System | S@1 | S@3 | S@5 | MRR@5 | nDCG@5 | Useful@5 | Junk@5 | Unjudged | No-answer in-domain shown as confident | Out-of-corpus shown as confident | p50 s | p95 s | Max s | Errors |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    unanswered = sum(c["category"] != "none" and c["id"] not in answerable for c in all_cases)
    for label, row in rows.items():
        scores, seconds = row["per_case"].values(), [r["seconds"] for r in row["results"].values()]
        lines.append(f"| {label} | " + " | ".join(f"{mean([s[k] for s in scores]):.2f}" for k in ("s1", "s3", "s5", "mrr", "ndcg", "useful", "junk"))
                     + f" | {sum(s['unjudged'] for s in scores)} | {row['unanswered']}/{unanswered}"
                     + f" | {row['none']}/{sum(c['category'] == 'none' for c in all_cases)}"
                     + f" | {statistics.median(seconds):.2f} | {percentile(seconds, .95):.2f} | {max(seconds):.2f}"
                     + f" | {sum(r['status'] != 200 for r in row['results'].values())} |")
    groups = {}
    for case in all_cases:
        if case["id"] in answerable:
            groups.setdefault(f"{case['scope']}/{case['category']}", []).append(case["id"])
            groups.setdefault(f"origin:{case['origin']}", []).append(case["id"])
    lines += ["", "| Slice (S@3 / nDCG@5) | n | " + " | ".join(rows) + " |", "|---|---|" + "---|" * len(rows)]
    for name, ids in sorted(groups.items()):
        lines.append(f"| {name} | {len(ids)} | " + " | ".join(
            f"{mean([row['per_case'][i]['s3'] for i in ids]):.2f} / {mean([row['per_case'][i]['ndcg'] for i in ids]):.2f}"
            for row in rows.values()) + " |")
    if len(rows) == 2:
        (a, first), (b, second) = rows.items()
        diff = [first["per_case"][i]["ndcg"] - second["per_case"][i]["ndcg"] for i in answerable]
        lines += ["", f"Per-case nDCG@5: {a} better {sum(d > 0.05 for d in diff)}, "
                      f"{b} better {sum(d < -0.05 for d in diff)}, tie {sum(abs(d) <= 0.05 for d in diff)}."]
    report = "\n".join(lines)
    print(report)
    (STATE / "report.md").write_text(report + "\n")


def load(args):
    queries = [c for c in cases() if c["category"] == "question"]
    for users in args.concurrency:
        outcomes = []
        for round_ in range(args.rounds):
            batch = queries[round_ * users:(round_ + 1) * users]
            with ThreadPoolExecutor(users) as executor:
                outcomes += executor.map(lambda c: raw(args.system, c, args.endpoint), batch)
            time.sleep(2)
        ok = [s for status, s in outcomes if status == 200]
        print(f"{args.system} users={users} requests={len(outcomes)} ok={len(ok)} "
              f"rejected={len(outcomes) - len(ok)} p50={statistics.median(ok) if ok else 0:.2f}s max={max(ok, default=0):.2f}s", flush=True)


def raw(system, case, endpoint):
    """One request, no retry: what a visitor gets when others search at the same moment."""
    if system == "old":
        result = old_search(case, endpoint, "hybrid")
        return result["status"], result["seconds"]
    _, status, seconds = post(f"{endpoint}/search", {"query": case["query"], "scope": case["scope"], "mode": "hybrid"},
                              {"Origin": "https://alkulify.assoli.site"})
    return status, seconds


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "load"):
        command = commands.add_parser(name)
        command.add_argument("--system", choices=SYSTEMS, required=True)
        command.add_argument("--endpoint", default=NEW_ENDPOINT)
    commands.choices["run"].add_argument("--label", required=True)
    commands.choices["run"].add_argument("--mode", choices=["hybrid", "phrase", "lexical"], default="hybrid")
    commands.choices["run"].add_argument("--pause", type=float, default=0.5)
    commands.choices["load"].add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4, 8])
    commands.choices["load"].add_argument("--rounds", type=int, default=3)
    commands.add_parser("pool").add_argument("runs", nargs="+")
    commands.choices["pool"].add_argument("--batch", type=int, default=120)
    commands.add_parser("import")
    commands.add_parser("score").add_argument("runs", nargs="+")
    args = parser.parse_args()
    {"run": run, "pool": pool, "import": import_grades, "score": score, "load": load}[args.command](args)


if __name__ == "__main__":
    main()
