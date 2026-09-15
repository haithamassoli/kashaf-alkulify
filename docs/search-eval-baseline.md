# Search Evaluation Baseline: old site vs new site

**Run:** 2026-09-15, against the live production endpoints.
**Harness:** [`scripts/search/compare.py`](../scripts/search/compare.py).
**Questions:** [`data/search/compare/questions.json`](../data/search/compare/questions.json).
**Judgments:** [`data/search/compare/judgments.json`](../data/search/compare/judgments.json).
**Plan built on this baseline:** [search-overhaul-plan.md](search-overhaul-plan.md).

## 1. Summary

- **Ranking quality is a statistical tie on audio.** The old site scores higher overall (S@3 0.83 vs 0.74), but that gap comes from 11 legacy article questions, which were written from article titles the old site embeds. Excluding them, S@3 is 0.81 (old) vs 0.80 (new). Across all answerable cases the difference is not significant (McNemar χ² = 2.44, p > 0.1).
- **The new site is 3.4× faster** (p50 1.56 s vs 5.35 s), but **it fails as soon as two people search at once.** With 2 simultaneous users, 3 of 6 requests were rejected; with 8 users, 21 of 24.
- **The new site never says «no answer».** It showed confident results for 11/11 out-of-corpus queries and 12/12 in-domain questions with no answer in the archive. The old site labelled all out-of-corpus queries as «closest matches» or returned nothing.
- **Where the new site loses clearly:** article questions phrased like article titles (0.09 vs 1.00), clitic-prefixed words (0.00 vs 1.00), verbatim quotations (0.67 vs 1.00), and filler in the top 5 (Junk@5 0.29 vs 0.18).
- **Where the new site wins clearly:** questions written from its own corpus (audio 0.93 vs 0.80; articles 0.80 vs 0.30), dialect questions, and speed.

## 2. Setup

### Systems

Both systems were called exactly as their search pages call them:

| Label | Endpoint | Behaviour reproduced |
|---|---|---|
| `old-live` | `https://search.assoli.site` (Meilisearch, public search key) | `kashaf-abu-jaafar/src/lib/meili.ts` `search()`: strict hybrid (`semanticRatio` 0.7, `rankingScoreThreshold` 0.765) on the active tab, the lesson-title block in parallel, and a relaxed `frequency` retry labelled `widened` when nothing is shown. Scored list: cue hits (audio) or article hits. |
| `new-live` | `https://search.assoli.site/api/search` (generation `4e92ff5f5c9c007dae88`) | `src/islands/search.tsx` default: `mode: hybrid`, grouped one hit per source. A 429 was retried with backoff so quality runs were not polluted; none occurred. |

The two corpora overlap but are not identical: YouTube uploads vs the Telegram archive, 8,815 sources. A question answered in only one corpus penalizes the other system. The origin slices below make that visible.

### Questions (151)

| Origin | Scope | n | Bias |
|---|---|---|---|
| `legacy-tuning` | audio | 50 | Old site was tuned on these |
| `legacy-heldout` | audio | 29 | Old site's held-out set, later reused for tuning |
| `legacy-articles` | articles | 12 | Written from old article titles, which old article vectors include |
| `new-corpus` | audio 16 / articles 12 | 28 | Paraphrased from a seeded random sample of new-corpus passages |
| `robustness` | audio | 32 | Spelling, clitic, typo, diacritics, dialect, long, name, topic and quote variants, plus 3 out-of-corpus |

Categories: 106 question, 14 topic, 6 quote, 4 name, 3 spelling, 3 clitic, 2 typo, 1 dialect, 1 long, 11 out-of-corpus (`none`).

### Judging

- The top 5 hits of both systems were pooled per query (1,336 unique hits), shuffled, and graded blind: 2 = answers the query, 1 = related, 0 = not relevant. Grades are keyed by query + exact hit text.
- Grading was done by 13 agent judges using one written rubric. A second, independent agent judge re-graded a random 150 hits. Agreement: 93% exact, **κ = 0.90**, 96% on the «answers» decision (κ = 0.92), and zero 0↔2 disagreements.
- Both judges are the same model family, so this agreement shows the rubric is applied consistently, not that the grades are free of shared model bias. A human review of a sample is still required before release decisions (plan §2).
- A query is *answerable* when either system surfaced a grade-2 hit: 128 of 140 in-domain queries. Quality metrics use answerable queries only.

### Metrics

- **S@k:** a grade-2 hit within the top k.
- **MRR@5** and **nDCG@5:** gains 2^g−1; the ideal ranking comes from all judged hits for the query.
- **Useful@5 / Junk@5:** share of the returned top 5 graded ≥1 / 0.
- **Confident:** results returned without the system's widened / closest-match label.
- **Latency:** client wall time from the evaluator's machine to the VPS, sequential, one system at a time.

## 3. Results

| System | S@1 | S@3 | S@5 | MRR@5 | nDCG@5 | Useful@5 | Junk@5 | No-answer in-domain shown as confident | Out-of-corpus shown as confident | p50 s | p95 s | Max s | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| old-live | **0.65** | **0.83** | **0.88** | **0.74** | **0.70** | **0.81** | **0.18** | 11/12 | **0/11** | 5.35 | 5.59 | 5.72 | 0 |
| new-live | 0.56 | 0.74 | 0.79 | 0.66 | 0.63 | 0.71 | 0.29 | 12/12 | 11/11 | **1.56** | **2.83** | **3.96** | 0 |

Per-case nDCG@5: old better on 62, new better on 46, tie on 20. S@3 disagreements: old-only 26, new-only 15.

### Slices (S@3 / nDCG@5)

| Slice | n | old-live | new-live |
|---|---|---|---|
| audio/question | 76 | 0.82 / 0.68 | **0.83 / 0.71** |
| audio/topic | 14 | **1.00 / 0.81** | 0.86 / 0.72 |
| audio/quote | 6 | **1.00 / 0.86** | 0.67 / 0.50 |
| audio/clitic | 3 | **1.00 / 0.92** | 0.00 / 0.03 |
| audio/spelling | 2 | 0.50 / **0.52** | 0.50 / 0.22 |
| audio/typo | 2 | 1.00 / **0.76** | 1.00 / 0.66 |
| audio/name | 2 | 1.00 / 0.75 | 1.00 / 0.76 |
| audio/dialect | 1 | 1.00 / 0.39 | 1.00 / **0.83** |
| audio/long | 1 | 1.00 / **0.89** | 1.00 / 0.56 |
| articles/question | 21 | **0.67 / 0.63** | 0.43 / 0.41 |
| origin: legacy-tuning | 43 | 0.86 / **0.76** | 0.84 / 0.71 |
| origin: legacy-heldout | 24 | **0.88** / 0.63 | 0.75 / **0.66** |
| origin: legacy-articles | 11 | **1.00 / 0.90** | 0.09 / 0.16 |
| origin: new-corpus | 25 | 0.60 / 0.54 | **0.88 / 0.72** |
| origin: robustness | 25 | **0.88 / 0.74** | 0.72 / 0.58 |

The slices with n ≤ 6 (quote, clitic, spelling, typo, name, dialect, long) are signals, not measurements. Plan Phase 0 enlarges them before they gate anything.

### Bias-adjusted views

| View | n | old-live S@3 / nDCG@5 | new-live S@3 / nDCG@5 |
|---|---|---|---|
| All answerable except `legacy-articles` | 117 | 0.81 / 0.68 | 0.80 / 0.67 |
| Audio questions, all origins | 76 | 0.82 / 0.68 | 0.83 / 0.71 |
| Audio, `new-corpus` only | 15 | 0.80 / 0.67 | 0.93 / 0.74 |
| Articles, `new-corpus` only | 10 | 0.30 / 0.34 | 0.80 / 0.69 |

Each system does best on questions derived from its own corpus. On neutral ground (audio questions from all origins) they are equal.

### Concurrent users (`compare.py load`, 3 rounds, no retries)

| Simultaneous users | new-live rejected | new-live p50 of successes | old-live rejected | old-live p50 |
|---|---|---|---|---|
| 1 | 0/3 | 1.27 s | 0/3 | 5.40 s |
| 2 | **3/6** | 1.26 s | 0/6 | 5.36 s |
| 4 | **9/12** | 1.20 s | 0/12 | 5.36 s |
| 8 | **21/24** | 1.21 s | 2/24 | 5.36 s |

On the new site, exactly one request per round succeeds: the service holds a single inference slot for the whole request and rejects the rest immediately with 429. The old site's 2 rejections at 8 users are most likely Caddy's per-IP limit (30 requests / 10 s), hit because all simulated users came from one test client; separate visitors would not share that limit.

## 4. Failure analysis

Examples from this run, all agent-judged:

1. **Article questions phrased like titles** (`legacy-articles`, new site 1/11).
   - «هل يسعى المتمتع سعيا واحدا أم سعيين» → top 5 all grade 0.
   - «هل طه من الحروف المقطعة» → all 0.
   - «ما هو اسم الله الأعظم» → one grade 1.

   The old article index embeds `title + paragraph`; the new one embeds the paragraph only (`documentTemplate: body-only`) and splits articles line by line. Title-shaped questions therefore have nothing to match semantically. On articles written from the new corpus's bodies, the new site wins (0.80 vs 0.30).
2. **Clitic prefixes** (new site 0/3). `بالمولد النبوي`, `والتوحيد` and `والربا` return grade-0 hits only. The old site's `articleSynonyms` maps `بال/وال/لل` forms to the stem. The morphology probe `صام` is the same failure: new all 0, old 2 in the top 5.
3. **Quotations** (new 4/6).
   - «أحق الناس بالطفل أمه» and «لا يجب الحد إلا على مكلف عالم بالتحريم» find nothing useful.
   - The exact-phrase mode, tested separately, returns 0 hits for both, because it preserves hamza while the transcripts drop it.
4. **Filler passages.** `الصلاه` (new: 0,0,0,0,0) returns «اللهم صل وسلم» fragments. Junk@5 is 0.29 vs 0.18.
5. **No relevance floor.** All 11 out-of-corpus queries (e.g. `asdfghjkl`, «أفضل وصفة لتحضير الكيك بالشوكولاتة») return 10 confident hits. The old site returned nothing or labelled closest matches (9 widened, 2 empty).
6. **Both systems** show confident results for in-domain questions nobody answered: 12 such queries, including «حكم التأمين التجاري», «زاد المستقنع» and «ما شروط القسامة». The old site's strict pass still let 11/12 through; a floor alone won't fix this without calibration.
7. **New site wins** on questions from its own corpus and on everyday phrasing: «هل تجب طاعة الوالدين في الطلاق», «شو حكم اللي بصلي وهو قاعد», «ما أول خلع وقع في الإسلام» (old returned nothing), «كم عدة المتوفى عنها زوجها».

## 5. Limitations

- Agent judgments, not human or audio review. See the agreement caveat in §2.
- Pool depth 5. A system that ranks a good hit at 6–10 gets no credit, and «answerable» is bounded by what the two systems surfaced.
- Different corpora. A miss can be missing content rather than bad ranking; the origin slices are the control for this.
- One run from one client location. Latency includes the network path from the evaluator's machine to the Vienna VPS, and both systems share one VPS, so they were run sequentially.
- Small slices (n ≤ 6) for several robustness categories.

## 6. Reproduce

```sh
export OLD_SEARCH_KEY=…   # the old site's public search-only key, from its JS bundle
python3 scripts/search/compare.py run --system old --label old-live
python3 scripts/search/compare.py run --system new --label new-live
python3 scripts/search/compare.py pool old-live new-live     # writes .search/compare/pool/batch-*.json
# grade each batch into batch-NN.grades.json ({key: 0|1|2}) using the rubric in §2
python3 scripts/search/compare.py import
python3 scripts/search/compare.py score old-live new-live    # also writes .search/compare/report.md
python3 scripts/search/compare.py load --system new --concurrency 1 2 4 8
```

To score a change before it ships:
1. Run `npm run search:serve` locally.
2. Run `run --system new --endpoint http://127.0.0.1:8787 --label <change>`.
3. Run `pool <change>` so only newly surfaced hits need grading.
4. Run `import`, then `score new-live <change>`.

Raw runs live under `.search/compare/` (git-ignored). The question set and judgments are committed.
