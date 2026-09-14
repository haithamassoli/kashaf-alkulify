# Arabic search implementation results

Recorded on 2026-09-13. This is an executable local pilot of the [search plan](arabic-search-plan.md), using the archive on **dev:hip-bat-697**. It is not a full-archive deployment or a human-approved relevance benchmark.

## Coverage

| Item | Observed count |
| --- | ---: |
| Lesson rows scanned | 5,633 |
| Eligible lessons in the final export | 4,360 |
| Eligible lesson duration | Approximately 2,300 hours |
| Articles scanned and eligible | 4,455 |
| Sources in the active pilot | 10 lessons + 10 articles |
| Indexed audio passages | 459 |
| Indexed article passages | 78 |
| Verified BGE-M3 vectors | 537 of 537 |

The local active generation is `4dfa01ed1cd4b51eba02`. Its immutable Meilisearch indexes and matching SQLite phrase database share one activation pointer. The complete metadata export is available locally, but the complete archive has **not** been embedded or indexed.

The pilot was selected before an overly restrictive edited-message eligibility check was corrected. It is therefore a pipeline diagnostic, not a representative sample of the final eligible archive. The corrected rule checks current media membership and edits after an explicit approval. Rejected lesson rows have not been individually audited; they must not be described as missing or lost recordings.

## Implemented behavior

- Separate audio and article scopes, hybrid search by default, and an optional exact-phrase mode.
- Original excerpts and surrounding context only; no generated answers or inferred rulings.
- Conservative Arabic normalization with original character offsets. Phrase matching preserves hamza, `ة/ه`, `ى/ي`, and negation; lexical fields additionally fold spelling variants. Embeddings use original text.
- Approximately 30-second passages with a 512-token ceiling; oversized ASR segments retain their source timestamps rather than inventing finer timing.
- Whole-source phrase verification across passage boundaries, and grouping after passage ranking or reranking.
- CPU BGE-M3 embeddings cached by exact input and pinned model configuration. Optional CPU BGE-reranker-v2-m3 uses the same retrieval candidates.
- Paginated internal Convex export, live publication/revision checks, private R2 retrieval, and signed audio playback from the selected original part.
- Awaited Meilisearch indexing tasks, complete document/vector verification, immutable releases, and an atomic activation pointer retaining the previous release.
- Reusable export, prepare, embed, index, verify, evaluate, and serve commands; see the [operations guide](search-operations.md).

## Evaluation interpretation

The checked-in `data/search/development.json` contains **10 provisional, agent-drafted semantic questions**: six audio and four article questions. None have independent human or audio review. A hit only earns relevance credit when its source hash matches and its displayed passage contains the complete judged evidence range. A correct lesson containing the wrong passage fails. Candidate identities and order must match for a reranker comparison.

The generated 20-quote smoke suite passed phrase, lexical, and hybrid retrieval in earlier runs. It checks that known excerpts can be retrieved; it does not measure semantic usefulness. The lexical configuration scored 0/10 Success@3 on the provisional semantic cases, while hybrid retrieval found all ten accepted evidence ranges among its candidates. This small, source-derived dataset does not establish that lexical retrieval is generally poor.

There are currently **zero reviewed cases and zero no-evidence cases**. Consequently, neither a false-positive rate nor an acceptance threshold has been established. Every evaluation and verification report retains `qualityApproved: false`.

### Controlled BGE reranker comparison

Both runs used the same generation, dataset digest, candidate identities and ordering, 100-candidate limit, semantic ratio 0.7, and no acceptance threshold. The evaluator checked candidate equality for every question.

| Measure, 10 provisional questions | BGE-M3 hybrid | Hybrid + BGE-reranker-v2-m3 |
| --- | ---: | ---: |
| Success@3 | 8/10 | 8/10 |
| Success@5 | 9/10 | 8/10 |
| MRR@3 | 0.800 | 0.800 |
| nDCG@10 | 0.839 | 0.800 |
| Candidate evidence recall | 10/10 | 10/10 |
| Median response time | 0.491 s | 34.571 s |
| Sample p95 response time | 9.210 s | 45.977 s |

**Decision: keep reranking optional and disabled in the default pilot.** It promoted the accepted evidence for `dev-05`, but displaced the accepted passage for `dev-06` after source grouping. `dev-04` failed with both. Candidate retrieval contained every accepted range, so inspect passage selection, grouping, context, and the judgments before changing embedding models. An alternative unjudged passage may still be useful: these labels cannot establish that the reranker is generally worse.

The baseline's first request includes model initialization; the reranker configuration reloads models to keep only one large model resident. These are sequential mixed-scope pilot timings with other local services running, not a controlled load or cold/warm capacity test. With only ten observations, the reported p95 is the maximum observed request. The complete reranker process took 317.38 seconds and macOS `time -l` reported a maximum resident set size of 1,924,284,416 bytes (1.79 GiB); that excludes other service processes and is not a Linux VPS memory guarantee.

Raw local reports are under `.search/releases/4dfa01ed1cd4b51eba02/`: `eval-hybrid-base-1789259810.json` and `eval-hybrid-rerank-1789260163.json`. The latter completed with no candidate-mismatch error or reranker fallback.

## Operational evidence

- [x] Final Convex functions pushed successfully to `dev:hip-bat-697`.
- [x] `npm run search:check`: eight tests passed, including normalization, evidence-range grading, timestamp identity, grouping, and failed indexing tasks.
- [x] `npm run check`: zero errors, zero warnings; eight deprecation hints remain.
- [x] `npm run build`: five pages built successfully.
- [x] Python compilation and `git diff --check` passed.
- [x] Final source/vector verification passed and the local pilot was activated; search API and Astro development server were restarted with current code.

All 537 stored documents and vectors were checked against the prepared source text, original offsets, cached inputs, and current Convex revisions. Vectors have 1,024 finite dimensions; their values match the cached vectors within the verifier's tolerance. The audio and article index settings also match the release configuration.

On this 8GB Apple Silicon computer, using CPU float32 with two inference threads and embedding batches of four, 529 new passages plus eight cached passages completed in 175.4 seconds. The initial eight-passage run took 8.2 seconds. These are local pilot measurements, not VPS capacity estimates.

Browser checks exercised semantic audio search and R2 playback. The selected result opened its original part at **178.468 seconds**; the loaded audio duration was 1,429.461 seconds and one caption track was present. API checks rejected invalid fields/scopes with 400 and an unapproved origin with 403. Four simultaneous search requests produced one 200 and three 429 responses, as intended by the single-inference limit. The search form accessibility scan reported zero violations.

After the final restart, the browser also verified the pilot notice, audio/article scope changes clearing old results, article semantic retrieval, and exact-phrase retrieval returning the unchanged excerpt despite omitted punctuation in the query. Some source article titles are just `=` or a URL; improving those archive titles remains a data-quality task.

## Remaining work before a public release

- [ ] Prepare a representative larger sample from the corrected export, then embed/index the full archive for finalist evaluation.
- [ ] Review excluded lessons and reconcile a final export while source writers are paused or changes are accounted for.
- [ ] Expand and independently judge query families, including no-evidence questions, negation, quotations of opposing positions, and ASR ambiguity; listen to the relevant audio.
- [ ] Freeze development settings, run fresh heldout families, and calibrate result thresholds against false positives and useful-evidence recall.
- [ ] Compare chunk sizes and model challengers when concrete failure cases justify them.
- [ ] Measure memory, latency, and retrieval stability on the actual VPS; configure HTTPS ingress and process supervision there.
- [ ] Integrate archive updates, rehearse rollback, and complete automatic multipart playback.

Live validation fingerprints Convex metadata and versioned R2 keys. It does not refetch R2 transcript bytes on every query; correcting an object under an unchanged key requires a rebuild. Paginated export is not a single global database snapshot. The local Python server and loopback API are not a public production deployment.
