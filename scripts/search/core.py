"""Lossless source spans, Arabic normalization, retrieval metrics and local IO."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".search"
NORM_VERSION = "arabic-search-v1"
MODEL = "BAAI/bge-m3"
REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
RERANKER = "BAAI/bge-reranker-v2-m3"
RERANK_REVISION = "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e"


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def embedding_input_hash(text, config):
    return digest({"text": text, "embedding": {k: v for k, v in config.items()
                   if k not in ("chunkSeconds", "chunkVersion", "normalization")}})


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def read_json(path: Path):
    return json.loads(path.read_text())


def load_env():
    # Node parses the project's existing dotenv syntax; never echo credentials.
    import subprocess
    result = subprocess.run(
        ["node", "--env-file=.env.local", "--input-type=module", "-e",
         "process.stdout.write(JSON.stringify(process.env))"], cwd=ROOT,
        check=True, capture_output=True, text=True)
    for key, value in json.loads(result.stdout).items():
        os.environ.setdefault(key, value)
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def request(url, body=None, method=None, key=None, timeout=120):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def tokens(text: str, lexical=False):
    """Normalized tokens with Python-codepoint offsets into the unchanged text.

    Compose each base + marks first so decomposed hamza stays equivalent to أ.
    Strict mode preserves ة/ه, ى/ي, hamza and negation; punctuation separates words.
    """
    characters = []
    index = 0
    while index < len(text):
        end = index + 1
        while end < len(text) and unicodedata.category(text[end]).startswith("M"):
            end += 1
        for char in unicodedata.normalize("NFKC", text[index:end]):
            if char == "ـ" or unicodedata.category(char).startswith("M"):
                continue
            if char.isdecimal():
                char = str(unicodedata.decimal(char))
            if lexical:
                char = char.translate(str.maketrans("أإآٱىة", "اااايه"))
            characters.append((char.lower() if char.isalnum() else " ", index, end))
        index = end
    result = []
    word = ""
    start = finish = 0
    for char, left, right in characters + [(" ", len(text), len(text))]:
        if char == " ":
            if word:
                result.append((word, start, finish))
                word = ""
        else:
            if not word:
                start = left
            word += char
            finish = right
    return result


def normalize(text: str, lexical=False) -> str:
    return " ".join(word for word, _, _ in tokens(text, lexical))


def phrase_spans(text: str, query: str):
    source = tokens(text)
    needle = [word for word, _, _ in tokens(query)]
    if not needle:
        return []
    words = [word for word, _, _ in source]
    return [(source[i][1], source[i + len(needle) - 1][2])
            for i in range(len(words) - len(needle) + 1)
            if words[i:i + len(needle)] == needle]


def source_text(source, artifact=None):
    if source["scope"] == "articles":
        return source["text"], []
    if artifact["lessonId"] != source["sourceId"] or artifact["assemblyHash"] != source["assemblyHash"]:
        raise ValueError("Transcript identity does not match current lesson")
    if artifact["parts"] and [(p["sha256"], p["offsetMs"]) for p in artifact["parts"]] != [
        (p["sha256"], p["offsetMs"]) for p in source["parts"]
    ]:
        raise ValueError("Transcript parts do not match current timeline")
    offset = 0
    for order, part in enumerate(source["parts"]):
        if part["order"] != order or part["offsetMs"] != offset or part["durationMs"] <= 0:
            raise ValueError("Lesson parts are not a contiguous ordered timeline")
        offset += part["durationMs"]
    if abs(offset - source["durationMs"]) > 1:
        raise ValueError("Lesson duration differs from its parts")
    text = ""
    segments = []
    for segment in artifact["segments"]:
        if not isinstance(segment["text"], str):
            raise ValueError("Invalid transcript text")
        part = next((p for p in source["parts"] if p["order"] == segment["partOrder"]), None)
        if part is None or part["sha256"] != segment["sha256"]:
            raise ValueError("Unknown transcript part")
        if not 0 <= segment["startMs"] < segment["endMs"] <= source["durationMs"] + 1000:
            raise ValueError("Invalid transcript timing")
        if not part["offsetMs"] <= segment["startMs"] < part["offsetMs"] + part["durationMs"]:
            raise ValueError("Segment starts outside its part")
        if segments and segment["startMs"] < segments[-1]["startMs"]:
            raise ValueError("Transcript is out of order")
        if text:
            text += "\n"
        start = len(text)
        text += segment["text"]
        segments.append({**segment, "charStart": start, "charEnd": len(text)})
    return text, segments


def passage_ranges(text, segments, tokenizer, seconds=30, max_tokens=512):
    """Join complete segments to the target duration; split oversized spans losslessly.

    Fine timestamps remain source timestamps even when one ASR segment is long.
    """
    ranges = []
    if segments:
        start = 0
        for i, segment in enumerate(segments):
            if segment["endMs"] - segments[start]["startMs"] >= seconds * 1000 or i == len(segments) - 1:
                ranges.append((segments[start]["charStart"], segment["charEnd"]))
                start = i + 1
    else:
        ranges = [(m.start(), m.end()) for m in re.finditer(r"[^\n]+(?:\n(?!\n)[^\n]+)*", text)]
    output = []
    for left, right in ranges:
        pending = [(left, right)]
        while pending:
            left, right = pending.pop(0)
            if not text[left:right].strip():
                continue
            count = len(tokenizer.encode(text[left:right], add_special_tokens=True))
            if count <= max_tokens:
                output.append((left, right))
                continue
            middle = (left + right) // 2
            boundary = text.rfind(" ", left + 1, middle + 1)
            if boundary <= left:
                boundary = middle
            if boundary <= left:
                raise ValueError("Cannot split input within the model token budget")
            pending[0:0] = [(left, boundary), (boundary, right)]
    return output


def anchor(segments, left, right):
    matches = [s for s in segments if s["charEnd"] > left and s["charStart"] < right]
    if not matches:
        return {}
    return {"startMs": matches[0]["startMs"], "endMs": matches[-1]["endMs"],
            "partOrder": matches[0]["partOrder"]}


def database(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def group_hits(hits, all_occurrences=False):
    if all_occurrences:
        return hits
    seen = set()
    result = []
    for hit in hits:
        if hit["sourceId"] in seen:
            continue
        seen.add(hit["sourceId"])
        result.append(hit)
    return result


def grade(hit, gold):
    """Require the complete judged span; partial overlap may omit a negation."""
    grades = []
    for item in gold:
        if hit["sourceId"] != item["sourceId"] or hit["sourceHash"] != item["sourceHash"]:
            continue
        if hit["charStart"] <= item["charStart"] and hit["charEnd"] >= item["charEnd"]:
            grades.append(item["grade"])
    return max(grades, default=0)


def metrics(displayed, candidates, gold):
    remaining = list(gold)
    scores = []
    for hit in displayed:
        scores.append(grade(hit, remaining))
        remaining = [g for g in remaining if not grade(hit, [g])]
    # The UI defaults to one result per source. Multiple accepted ranges in one
    # source cannot occupy multiple positions in the ideal displayed ranking.
    parent_grades = {}
    for item in gold:
        parent_grades[item["sourceId"]] = max(parent_grades.get(item["sourceId"], 0), item["grade"])
    ideal = sorted(parent_grades.values(), reverse=True)[:10]
    dcg = lambda values: sum((2 ** value - 1) / math.log2(i + 2) for i, value in enumerate(values))
    useful = [g for g in gold if g["grade"] >= 2]
    return {
        "success3": int(any(score >= 2 for score in scores[:3])),
        "success5": int(any(score >= 2 for score in scores[:5])),
        "mrr3": next((1 / (i + 1) for i, score in enumerate(scores[:3]) if score >= 2), 0),
        "ndcg10": dcg(scores[:10]) / dcg(ideal) if dcg(ideal) else None,
        "candidateRecall": sum(any(grade(hit, [g]) >= 2 for hit in candidates) for g in useful) / len(useful) if useful else None,
    }


class Meili:
    def __init__(self):
        self.host = os.getenv("MEILI_HOST", "http://127.0.0.1:7700").rstrip("/")
        self.key = os.getenv("MEILI_MASTER_KEY")
        if not self.key and (STATE / "meili-key").exists():
            self.key = (STATE / "meili-key").read_text().strip()

    def call(self, path, body=None, method=None):
        return request(self.host + path, body, method, self.key)

    def task(self, path, body, method="POST"):
        response = self.call(path, body, method)
        uid = response["taskUid"]
        deadline = time.monotonic() + 3600
        while time.monotonic() < deadline:
            task = self.call(f"/tasks/{uid}")
            if task["status"] == "succeeded":
                return task
            if task["status"] in ("failed", "canceled"):
                raise RuntimeError(f"Meilisearch task {uid} {task['status']}: {task.get('error')}")
            time.sleep(0.2)
        raise TimeoutError(f"Meilisearch task {uid} exceeded one hour; inspect before resuming")
