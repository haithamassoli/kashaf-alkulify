# Search Overhaul Plan — alkulify.assoli.site

**Written:** 2026-09-15
**Scope:** The live search on the new site (Telegram archive). This covers the Python search API, passage construction, the Meilisearch settings, the search page, and the operations around them.
**Baseline:** [search-eval-baseline.md](search-eval-baseline.md). That eval compares this site with the old YouTube site on 151 queries.
**Relationship to earlier plans:** [arabic-search-plan.md](arabic-search-plan.md) and [search-plans-review.md](search-plans-review.md) remain the product specification. This plan is the execution order for the next round. Four places deliberately amend them because live evidence contradicts them; each is marked **Amends**.

## 1. Where search stands

The full archive is live: 4,360 lessons and 4,455 articles, split into 150,590 audio passages and 50,428 article passages. Retrieval is Meilisearch 1.53.1 hybrid search, 70% semantic, with BGE-M3 query vectors from the Python service. Every result is checked against Convex before it is returned.

Baseline in one line: audio ranking is **tied** with the old site (S@3 new 0.83, old 0.82 on 76 audio questions). Overall S@3 is **0.74 vs 0.83**, dragged down by articles, clitics and quotations. The new site is **3.4× faster** (p50 1.56 s), but **rejects 21 of 24 requests at 8 simultaneous users** and **never reports «no answer»** (11/11 out-of-corpus queries shown as confident results).

What the baseline eval and the live comparison established:

| # | Problem | Evidence | Effect on a visitor |
|---|---|---|---|
| P1 | **One search at a time, instant 429.** `service.py` returns 429 when its single inference slot is taken. The slot covers the whole request, not just embedding. Caddy rate-limits Meilisearch paths only, not `/api/*`. | Load test: 2 users → 3/6 rejected; 8 users → 21/24 rejected, each in ~0.27 s. The UI shows «تعذّر إتمام البحث» with no retry. | Two visitors pressing «بحث» together means one fails. One client in a loop blocks everyone. |
| P2 | **No relevance floor.** `threshold` is `None`, so the service always returns the nearest 100 passages. | 11/11 out-of-corpus queries shown as confident results (old site: 0/11), including `asdfghjkl`. 12/12 in-domain questions nobody answered also shown as confident (old: 11/12). | Nonsense gets a confident page of results, and «no answer» never appears. |
| P3 | **Tiny passages outrank real ones.** The last segment of a lesson becomes its own passage, and articles are split per line. | `الصلاه` → top 4 are «اللهم صل وسلم». `والتوحيد` → «وعلى آله وصحبه وسلم». 7,552 article passages (15%) have ≤10 words and 23,263 (46%) have ≤25. Junk@5 is 0.29 (old: 0.18). | Short or one-word queries show filler first. |
| P3b | **Article vectors ignore the title.** New articles are embedded `body-only`, one line at a time; the old site embeds `title + paragraph`. | Legacy article questions (title-shaped): S@3 **0.09** vs old 1.00. Articles overall: 0.43 vs 0.67. On questions written from article bodies the new site wins, 0.80 vs 0.30. | Visitors who ask about an article's subject don't find the article. |
| P4 | **No clitic handling.** `synonyms: {}`, and the lexical field only folds letters. | Clitic slice S@3 **0.00** vs old 1.00 (`بالمولد النبوي`, `والتوحيد`, `والربا`). «هل للصداق حد أعلى» returns صدقة / صديق / حد الزاني; the old site, which maps `لل/وال/بال` to the stem, finds كتاب الصداق. Morphology probe `صام`: all 0. | Natural phrasings with و/ب/ل prefixes miss the matching words. |
| P5 | **Exact-phrase mode can't match transcripts.** It preserves hamza, ة/ه and ى/ي, but ASR output is inconsistent in all three. | «أحق الناس بالطفل أمه» → 0 results. «لا يجب الحد إلا على مكلف عالم بالتحريم» → 0. `الصلاه` → 2. | The mode built for quotations rarely finds a quotation. |
| P6 | **Quotations are weak in default mode too.** | Quote slice S@3 0.67 vs old 1.00. «من أحدث في أمرنا هذا ما ليس منه فهو رد»: top 3 lack the hadith; the old site's top 4 all contain it. | The most common way people search Hadith and texts underperforms. |
| P7 | **Data quality leaks into results.** | Near-duplicate lessons («زاد المسافر [ ٨ ]» / «زاذ المسافر 8») both appear. `<hesitation>` tags are shown. Article titles `=` or bare URLs. | Repeated cards and noisy excerpts. |
| P8 | **No title or series discovery.** Titles are indexed per passage, but the semantic leg drowns them. | `زاد المستقنع` → «تعالى المستعان». | Finding a book or series by name needs the series filter. |
| P9 | **Freshness is manual.** The live release was embedded on a Mac (5.1 h for 110k passages) and copied up; no timer or job refreshes it. | One generation (`4e92ff5f…`); edited sources are dropped at query time as `stale_sources_removed`. | New lessons are unsearchable until someone rebuilds by hand; edited ones silently disappear. |
| P10 | **Shared, swapping host.** The old site's Meilisearch (12 GB index, 2.3 GB swapped), Ollama, the new Meilisearch (2.4 GB RSS) and the search API (1.7 GB) share 8 GB of RAM, 4 CPUs and a rotational disk. | 3.3 GB of swap in use. | Latency spikes under load; no headroom for a second worker or a reranker. |

What is good and must not regress:
- Everyday-phrased questions and questions about this archive's own content: audio new-corpus S@3 0.93 vs old 0.80; article-body questions 0.80 vs 0.30; examples «هل تجب طاعة الوالدين في الطلاق» and «شو حكم اللي بصلي وهو قاعد».
- ~2 s latency.
- Faithful excerpts with audio anchors.
- Per-query source validation.

## 2. Goals and release gates

Every phase is measured with `scripts/search/compare.py` against the recorded baseline runs. A phase ships only if its gate holds and no slice with n ≥ 15 drops by more than 0.05 in S@3.

| Gate | New site now | Old site | Target |
|---|---|---|---|
| S@3, all answerable cases | 0.74 | 0.83 | **≥ 0.85** |
| nDCG@5, all answerable cases | 0.63 | 0.70 | ≥ 0.72 |
| S@3, `audio/question` | 0.83 | 0.82 | no regression (≥ 0.81) |
| S@3, `articles/question` | 0.43 | 0.67 | ≥ 0.75, and `legacy-articles` ≥ 0.80 |
| S@3, `audio/quote` | 0.67 (n=6) | 1.00 | ≥ 0.90 on the enlarged slice |
| S@3, `audio/clitic` | 0.00 (n=3) | 1.00 | ≥ 0.80 on the enlarged slice |
| Junk@5 | 0.29 | 0.18 | ≤ 0.15 |
| Out-of-corpus shown as confident | 11/11 | 0/11 | ≤ 1/11 |
| In-domain no-answer shown as confident | 12/12 | 11/12 | ≤ 6/12 |
| Rejected requests, 8 simultaneous users | 21/24 | 2/24 | 0/24 |
| Latency p95, 1 user / 8 users | 2.83 s / n.a. | 5.59 s / — | ≤ 3 s / ≤ 8 s |
| New lesson searchable after publication | manual | — | ≤ 24 h, automatic |

Judgments are agent-drafted. Before the final release gate, a person reviews a random 10% of the judgments behind the gate slices plus every disagreement between systems. If more than 10% of the reviewed grades change, re-judge.

## 3. Phases

Order is by cost to benefit. Phases 1 and 2 need no re-embedding. Phase 3 needs a new release, but embeddings are cached by exact input, so only changed passages are encoded.

### Phase 0 — Evaluation harness (done in this change)

- [x] `scripts/search/compare.py` handles run, pool, import, score and load. It runs against live or local endpoints and uses the same question set for both sites.
- [x] `data/search/compare/questions.json` holds 151 queries:
  - 79 legacy audio questions (tuning + held-out) and 12 legacy article questions;
  - 28 new questions written from a seeded random sample of new-corpus passages;
  - 32 robustness variants: spelling, clitic, typo, diacritics, dialect, long, names;
  - 11 out-of-corpus queries.
- [x] `data/search/compare/judgments.json` stores 1,336 pooled top-5 grades (0/1/2), keyed by query and exact hit text. A second judge on 150 hits agreed at κ = 0.90.
- [x] Baseline recorded in [search-eval-baseline.md](search-eval-baseline.md).
- [ ] Enlarge the slices that are too small to gate, to ≥ 15 queries each: quote (6), clitic (3), spelling (3), typo (2), name (4), dialect (1). Add ≥ 20 article questions written from article bodies and ≥ 10 plausible in-domain questions with no answer, so the floor can be calibrated.
- [ ] Split the set. `legacy-*` and `robustness` are **development** (they were already used for tuning). `new-corpus` plus 30 fresh questions written by a person before Phase 3 are **held-out**. Held-out is scored only at gates.
- [ ] Add a `new-phrase` run (`--mode phrase`) for the quote and name slices so Phase 4 has its own baseline.

### Phase 1 — Availability (service and proxy only)

1. **Serialize only the model.** In `Search.run`, the inference semaphore currently wraps the whole request: embedding, Meilisearch, Convex validation, context assembly. Hold it only around `model.encode`, which takes a few hundred ms on CPU. Meilisearch and Convex calls run concurrently in the `ThreadingHTTPServer` threads.
2. **Queue instead of reject.** Use `inference.acquire(timeout=10)`. Return 503 with `Retry-After: 2` only after the timeout, and cap waiting requests at 16. The UI's `fetchSearch` retries once on 429/503 after the `Retry-After` delay. It shows «البحث مزدحم، نعيد المحاولة…» rather than the generic failure.
3. **Rate-limit `/api/*` in Caddy.** Add a second `rate_limit` zone for `path /api/search /api/lesson /api/playback`, 20 events per 10 s per IP. Search is the costly path; keep playback generous.
4. **Cache query vectors.** Use `functools.lru_cache(maxsize=2048)` on the normalized query text → vector. Repeat questions and tab switches skip inference. `ponytail:` in-process cache; move to Redis only if a second worker appears.
5. **Cache source revisions for 60 s.** `live_revisions` makes two Convex queries per search. Cache `{sourceId: revision}` with a 60 s TTL for search. `playback` and `lesson` keep calling Convex uncached, so signing stays strict.
6. **Gate:** `compare.py load --system new --concurrency 1 2 4 8` → 0/24 rejected at 8 users (baseline 21/24), p95 ≤ 8 s. Quality unchanged: `run` + `score` within ±0.02 S@3 of `new-live`.

### Phase 2 — Ranking fixes that need no new passages

1. **Relevance floor, applied after retrieval.**
   - Request `showRankingScore: true`, but do **not** send `rankingScoreThreshold`. On the old site, that parameter forced exhaustive vector scoring into its 5 s `searchCutoffMs`: 5 ms without it, 5,002 ms with it.
   - In Python, call a response *confident* when the top hit's `_rankingScore` is ≥ the floor. Below the floor, return hits with `lowConfidence: true`, and the UI labels them «لم نجد مطابقة مباشرة. هذه أقرب النصوص.»
   - Calibrate the floor on the development split. Pick the highest floor that keeps S@3 on answerable cases within 0.02 of the baseline; report how many out-of-corpus and unanswerable cases it catches.
   - Store it per scope in the manifest's `config`.
2. **Short-passage guard (stop-gap until Phase 3).** Drop hits whose text has fewer than 8 words from the top of the list, unless the query itself has ≤ 3 words and the hit contains them as a phrase. `ponytail:` word-count heuristic; Phase 3 removes the cause.
3. **Phrase-first merge for quotations.**
   - When a query has ≥ 4 words, also run the FTS phrase lookup from `Search.phrases` (SQLite; 0.3–1.2 s for 4–9-word phrases in the live test, and slower only for common one-word phrases, which this rule excludes).
   - Verified phrase hits go first, marked `exact: true`, followed by hybrid hits, with duplicates removed by `sourceId` + overlapping span.
   - This gives visitors quotation behaviour without the toggle; the toggle remains for "only exact".
4. **Query-length-aware semantic ratio.**
   - Sweep `ratio` ∈ {0.3, 0.5, 0.7} separately for queries of 1–2 words and 3+ words on the development split.
   - Expected result: a lower ratio for 1–2 words, where the keyword is the intent. Adopt it only if S@3 improves on the `topic`, `name`, `spelling` and `clitic` slices without losing more than 0.02 on `question`.
5. **Gate:**
   - Out-of-corpus shown as confident ≤ 1/11, and in-domain no-answer shown as confident ≤ 6/12.
   - `audio/quote` S@3 ≥ 0.90.
   - Junk@5 ≤ 0.20 (the stop-gap; Phase 3 takes it to 0.15).
   - `audio/question` ≥ 0.81.

### Phase 3 — Passages, text, and duplicates (new release generation)

Bump `chunkVersion` to 2 and `NORM_VERSION` to `arabic-search-v2`, then run export → prepare → embed → index → verify → activate as today. Unchanged passages reuse cached vectors.

1. **Audio chunking (`passage_ranges`).**
   - Never close a passage on the last segment alone. If the final range is shorter than 10 s or 25 words, extend the previous range to the end of the source.
   - Apply the same rule to a short range produced by the token splitter.
   - Add tests: a lesson ending in «وصلى الله على نبينا محمد» yields no standalone passage, and the concatenated ranges still equal the source text.
2. **Article passages.**
   - Merge consecutive paragraphs until 40–200 words. A paragraph over 200 words stays whole and goes through the token splitter.
   - Skip passages with no Arabic or Latin letters, or that are only a URL.
   - For titles that are `=`, a URL, or shorter than 3 characters, derive the display title from the first line of the article, cut to 80 characters. Fixing the title in Convex belongs to the Organizer and dashboard, not here.
   - **Embed `title + passage` for articles** (`documentTemplate: "title-body"` in the manifest config), as the old site does (`{{doc.title}}\n{{doc.text}}`). This is the largest single gap in the baseline: legacy article questions score 0.09 vs 1.00. It re-embeds the ~50k article passages (~2–3 h on the Mac batch path: the last release encoded 110,027 passages in 5.1 h). Audio keeps `body-only`, since lesson titles are series labels, not topics; test `title-body` for audio as a separate run and adopt it only if `audio/question` does not drop.
   - Make `documentTemplate` a per-scope setting. `embedding_input_hash` includes the embedding config, so a single global template change would also invalidate every cached audio vector.
3. **Clean ASR markup for search, keep it for evidence.**
   - Remove `<hesitation>`, `<...>` tags and repeated filler tokens (`ااا`, `آآآ`) from `lexicalText` and from the embedding input.
   - Offsets stay pointed at the original text.
   - Strip the same tags when rendering `context` in the UI.
   - **Amends** §6 of the search plan: the embedding input changes, from original body text to cleaned body text.
4. **Light clitic folding.**
   - Add a searchable field `lexicalLight` after `lexicalText` and `lexicalTitle`. It applies `lexical` folding plus a prefix strip, mirroring the old site's `articleStem`: `^(?:[وف][بكل]?|[بكل])ال` → `ال`-less stem, `^(?:[وف])?لل` → stem, with a special case for `لله`.
   - Apply the same function to the query.
   - Listing it after `lexicalText` in `searchableAttributes` lets Meilisearch's `attribute` ranking rule keep exact-form matches above folded ones.
   - This reindexes but does not re-embed.
   - **Amends** the plan's «no stemming» rule: this is prefix stripping only, not stemming, and it is measured on the `clitic` slice.
5. **Domain synonyms.**
   - Port `kashaf-abu-jaafar/data/domain-synonyms.json` (76 reviewed entries, for example الاغاني → غناء/معازف, البنوك → ربا) into index `synonyms`, both directions.
   - Keep only entries whose target occurs in the corpus.
   - **Amends** «no unreviewed synonym expansion»: these were reviewed for the old site. Re-review them against this corpus before enabling.
6. **Near-duplicate lessons.**
   - At prepare time, fingerprint each audio source by the normalized text of its first and last 2,000 characters.
   - Sources sharing a fingerprint get a `canonicalSourceId`, which is the earliest `sourceId`.
   - `group_hits` groups by it, so one card is shown, with other copies available under «كل المواضع».
   - Report the groups in the release manifest so an editor can merge them in the archive. Deleting in Convex stays a human decision.
7. **Gate:** every Phase 2 gate still holds after judging newly pooled hits. `articles/question` S@3 ≥ 0.75 and `legacy-articles` ≥ 0.80. `audio/clitic` ≥ 0.80 on the enlarged slice. Junk@5 ≤ 0.15.

### Phase 4 — Exact-phrase mode that fits transcripts

1. Change `phrase_spans` and the FTS `phrases` table to use `lexical=True` folding (alef forms, ى/ي, ة/ه) on both text and query, still requiring consecutive tokens.
   - Negation and word order stay protected, because no tokens are dropped.
   - **Amends** the strict phrase contract: preserving hamza/ة/ى is wrong for ASR text that doesn't preserve them.
   - Keep the strict comparison for articles, which are typed text, if the article quote slice shows a loss.
2. Tolerate a single-token ASR substitution only when the phrase has ≥ 6 tokens. Mark the hit `approximate: true` and do not place it among exact hits. `ponytail:` one substitution; revisit with evidence.
3. **Gate:** the `new-phrase` run finds «أحق الناس بالطفل أمه» and «لا يجب الحد إلا على مكلف عالم بالتحريم». `quote` S@3 in phrase mode is ≥ hybrid mode.

### Phase 5 — Search page

1. **Honest counts.** «N نتيجة» currently counts up to 100 grouped hits. Show «أبرز النتائج» and state that the list is bounded, which the notice already does when `candidateLimitReached` is set.
2. **States:** busy-and-retrying (Phase 1), low-confidence (Phase 2), exact hits badged «نص مطابق» (Phase 2/4).
3. **Title and series block.** When the query matches all words of a lesson title or series name (a Convex `content:series` lookup that already exists for the filter), show up to 3 lesson or series cards above passages, like the old site's lesson block. The eval scores this block separately; the passage metrics stay comparable.
4. **Context rendering:** strip ASR tags (Phase 3) and highlight the folded forms, so `للصداق` highlights `الصداق`.
5. **Accessibility check** after the changes; the last scan was zero violations.

### Phase 6 — Freshness, capacity, operations

1. **Automated delta releases.**
   - A systemd timer (daily, off-peak) runs `export → prepare → embed → index → verify → activate` on the VPS. Unchanged passages reuse cached vectors, so a normal day encodes only new lessons.
   - Log encoded passages and wall time.
   - If a day's delta is more than 5,000 passages, skip activation and alert. The Mac batch path remains for full rebuilds.
   - Measure first: CPU embedding throughput on this VPS, and full reindex time of ~200k documents with vectors. If the reindex takes more than 1 h, switch from immutable full generations to in-place upserts with a per-update manifest, keeping the previous generation for rollback.
2. **Free the host.** Once Phase 2's gate shows the new site at or above the old one, retire the old site's Meilisearch (`meilisearch.service`, 12 GB) and Ollama, or move them to another machine. That releases ~2.5 GB RAM and removes the swap pressure. Owner decision; see §5.
3. **Monitoring.** A timer runs a synthetic query every 5 minutes against `/api/search`. It alerts on non-200 responses, p95 > 5 s over an hour, or `degraded` not empty. Keep query text out of logs as today; record only counters (requests, 429/503, low-confidence, empty).
4. **Host hygiene.** Rotate the root password, which was shared in chat, and set `PasswordAuthentication no`, since key login works. Record Meilisearch and model versions in the manifest, as today.

### Phase 7 — Release

1. Run the full `compare.py` suite on development and held-out, and publish the new report beside the baseline.
2. Complete the human spot-check from §2.
3. Keep the previous generation's `previous.json` for one-command rollback. Update [search-operations.md](search-operations.md) with the new commands and the timer.

## 4. Work breakdown

| Phase | Files | Size | Re-embed |
|---|---|---|---|
| 1 | `scripts/search/service.py`, `src/islands/search.tsx`, `/etc/caddy/Caddyfile` | S | no |
| 2 | `scripts/search/service.py`, `scripts/search/cli.py` (manifest config), `src/islands/search.tsx` | M | no |
| 3 | `scripts/search/core.py`, `scripts/search/cli.py`, `scripts/search/test_search.py` | L | articles fully; audio only where passage text changed |
| 4 | `scripts/search/core.py`, `scripts/search/service.py` | S | no (FTS rebuild at prepare) |
| 5 | `src/islands/search.tsx`, `src/lib/highlight.ts` | M | no |
| 6 | systemd units on the VPS, `docs/search-operations.md` | M | no |

No Convex schema change is needed. If Phase 3's duplicate report later becomes an archive-side merge, that work happens in `convex/` and starts by reading `convex/_generated/ai/guidelines.md`.

Out of scope until a gate fails for a reason they would fix: rerankers (the pilot measured a 34.6 s median on CPU), new embedding models, a second search engine, and LLM-generated answers.

## 5. Decisions for the owner

1. **Retire the old site's search stack** on the shared VPS after Phase 2, or move it elsewhere.
2. **Below-floor behaviour.** Labelled «أقرب النصوص», which is recommended and matches the old site, or an empty result.
3. **Amendments to the phrase contract (Phase 4) and the no-synonym rule (Phase 3)**: accept on the evidence above, or keep strict and accept lower quote and clitic recall.
4. **Who does the 10% human judgment review** before the release gate.
