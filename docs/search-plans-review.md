# Arabic Search Plans: Comparative Review and Consolidation Recommendations

**Reviewed:** September 12, 2026

**Scope:** Compare the current search proposal with the earlier website's search plans, including the subsequently supplied round-3 plan, and the Telegram archive's search/integration plans. This is a review and proposed amendment list, not another implementation specification. The existing plans have not been edited by this review.

**Evidence:** Local plans, search/indexing/evaluation code, and evaluation JSON files; official documentation for disputed integration details. Historical performance numbers below come from the earlier reports. I did not rerun retrieval experiments, inspect the live corpus, or benchmark the VPS.

## 1. Decision

Use the **current Arabic search plan as the quality and product specification**, the **Telegram search plan as the ingestion/integration guide**, and the **earlier website's implemented hybrid search as a baseline and source of reusable work**. Consolidate their decisions into one maintained search plan before implementation.

The supplied **round-3 plan now provides the strongest corrective checklist for the old system**: reproducible index releases, corrected evaluation, explicit degradation, and investigation of search cutoff. Incorporate those checks before retuning models. Section 9 reviews its remaining limitations; its unchecked tasks are proposed repairs, not evidence that the repairs have shipped.

Keep **Meilisearch + local BGE-M3** as the starting configuration. Evaluate **BGE-reranker-v2-m3** and **GTE multilingual reranker** against identical candidate sets. Add **multilingual-e5-large** as the first embedding challenger because the earlier corpus experiment provides a specific reason to test it. Keep Qwen3-Embedding-0.6B as a later challenger; defer 4B experiments until a smaller configuration has a diagnosed quality ceiling and the machine has measured capacity.

The current plan is the strongest fit for the user's requirements, but it missed valuable existing work and gives too much early attention to model alternatives. The Telegram plan is the most concrete guide to the existing archive pipeline, but its speed gate and optional-reranking stance need revision for this task. Rounds 1 and 2 provide implementation evidence with flawed metrics and stale instructions. Round 3 recognizes and proposes to repair most of those problems.

## 2. Documents and their roles

| Document | Strongest contribution | Limitation | Recommended role |
| --- | --- | --- | --- |
| [Current Arabic search plan](/Users/haithamassoli/Desktop/bional/kashaf-alkulify/docs/arabic-search-plan.md) | User journeys, faithful excerpts, strict phrases, Arabic normalization, CPU reranking, source-range evaluation, update safety | No measured baseline; incomplete inventory of earlier work; broad experiment sequence | Main specification after the amendments below |
| [Earlier SEARCH-PLAN.md](/Users/haithamassoli/Documents/kashaf-alkulify/docs/SEARCH-PLAN.md) | Diagnoses lexical failures, whole-lesson discovery, query preservation, domain aliases, baseline evaluation | Prioritizes eliminating empty pages; its rejection of semantics was superseded by round 2 | Historical diagnosis and regression cases |
| [Earlier SEARCH-PLAN-2.md](/Users/haithamassoli/Documents/kashaf-alkulify/docs/SEARCH-PLAN-2.md) | Implemented hybrid search, model screening, local batch embeddings, threshold experiments, operational lessons | Parent-level success labeled as top-3; reused held-out data; stale deployment recipe | Executable comparison baseline, with corrected evaluation and deployment contracts |
| [Supplied round-3 plan](/Users/haithamassoli/.codex/attachments/d49460c0-4e1e-4476-ad07-d11e213393df/pasted-text.txt) | Corrected rendered-order evaluation, index release discipline, cutoff investigation, active-scope fallback, private-question handling | Some gates overstate completeness; no full strict-normalization or CPU-reranking design; repairs remain proposed | Preferred corrective checklist for the existing baseline, amended as described in section 9 |
| [Telegram search plan](/Users/haithamassoli/Documents/telegram-archive/docs/search_meilisearch_bge_m3_plan.md) | Existing Python worker, Convex/R2 integration, versioned embeddings, asynchronous task handling, deterministic passages | September 8 corpus status predates newer records; one-second gate; reranking deferred | Ingestion and model-artifact integration guide |
| [Telegram main plan](/Users/haithamassoli/Documents/telegram-archive/docs/telegram_archive_plan.md), [tasks](/Users/haithamassoli/Documents/telegram-archive/docs/tasks.md), [next decisions](/Users/haithamassoli/Documents/telegram-archive/docs/next-decisions.md) | Archive identity, corrections, migration coverage, current milestone records, virtual audio timeline | Search details conflict with the dedicated search document in IDs, grouping, model inputs, and sizing | Source/migration contracts and implementation ownership |

The main distinctions are substantive:

| Decision | Earlier website | Telegram search proposal | Current proposal / recommendation |
| --- | --- | --- | --- |
| Primary success | Find a useful lesson and avoid dead ends | Improve retrieval over keyword search | Find the actual evidence, location, and enough context |
| Retrieval unit | Cues plus a separate whole-lesson lexical index | Mainly 45–90 second passages | Compare existing segments, bounded context, and coherent merged passages |
| Query inference | Meilisearch calls local Ollama | Backend supplies a local query vector | Prefer a small local API with `userProvided` vectors for verification and reranking |
| Reranking | Omitted | Deferred | Evaluate it because the user explicitly prioritizes relevance |
| Phrase search | Broad lexical matching / in-player substring matching | Keyword/phrase mode mentioned | Defined conservative phrase contract and original-source verification |
| Grouping | Lesson cards plus cues; articles distinct by parent | Request-level parent distinct | Preserve candidate passages until reranking; group evidence afterward |
| Resource goal | Historical deployment around 0.8 s, report target ≤2 s | Proposed warm p95 ≤1 s | Measure a reliable CPU operating envelope; no arbitrary subsecond veto |

## 3. Findings that change the recommendation

### 3.1 Historical improvement is useful evidence, but its success metric is weaker than its label

Round 2 reports improvement from 17/29 to 23/29 on the original audio questions, 9/25 to 15/25 on its second audio set, and 4/12 to 12/12 on article questions. These are historical reported results on the old corpus, not newly verified measurements or success rates for the new search design.

In [scripts/eval.ts](/Users/haithamassoli/Documents/kashaf-alkulify/scripts/eval.ts:53), the audio evaluator combines the first **three lesson cards and three cue hits**, then accepts any matching `video_id`. This can inspect six cards while printing `answer-in-top-3`. A cue from the correct lesson also passes even if that cue does not contain the requested evidence. The JSON targets have source IDs and notes, but no machine-readable gold timestamps or evidence ranges.

Preserve that historical metric under an accurate name, such as **legacy displayed-parent success**, so old runs remain comparable. Add separate measurements for candidate evidence recall, success within the first five actual displayed groups, excerpt completeness, and playback-anchor correctness. A lesson found without a verified passage is useful discovery, but must not count as a located answer passage.

The evaluator also uses `counts.v + counts.a` to decide whether a query produced direct results. That can report success in returning results when the selected scope itself is empty. Evaluate the selected scope and the actual rendered list. The existing [search function](/Users/haithamassoli/Documents/kashaf-alkulify/src/lib/meili.ts:329) similarly lets results in either scope prevent its relaxed retry; do not carry that behavior into the new scope-first interface.

### 3.2 The old held-out questions must become development data

The [round-2 tuning table](/Users/haithamassoli/Documents/kashaf-alkulify/docs/SEARCH-PLAN-2.md:151) compares ratios and thresholds on both the original and purported held-out sets; the earlier model screen also uses both audio sets. They are valuable regression data, but they cannot provide an untouched final test for the selected configuration.

The three JSON files contain **91 query records**, of which **66 have expected source IDs** and **8 are marked `expect: none`**. The other 17 lack expected source IDs. Import them as reviewed development seeds, map available targets to canonical new-archive sources, and add gold evidence ranges. Keep unmapped legacy sources as explicit coverage gaps. Create fresh held-out query families before selecting new settings.

The 12 article questions were derived from article titles, which the article embeddings include. They test a useful but narrow task. Neither 12/12 on that set nor reducing empty article tabs proves broad article relevance. Add questions written from article bodies and ordinary visitor wording. Add plausible in-domain questions with no judged useful source; eight nonsense questions are insufficient for threshold calibration.

### 3.3 E5-large deserves a trial; raw score spread is not a reason to reject it

The [historical model screen](/Users/haithamassoli/Documents/kashaf-alkulify/docs/SEARCH-PLAN-2.md:80) reports 37/54 for `multilingual-e5-large`, 35/54 for body-only BGE-M3, 36/54 for BGE-M3 with titles, and 27/54 for Qwen3-Embedding-0.6B. The experiment used 6,849 cues, including target lessons and sampled distractors. Its results justify a shortlist, not a claim about full-corpus passage accuracy. Different serving paths also mean runtime, precision, prompts, and truncation must be recorded in a new comparison.

The plan's argument that E5's narrow cosine-score range makes it unsuitable for thresholding is not established. Range width alone says nothing decisive about relevant/irrelevant overlap. Compare false positives at matched useful-evidence recall and use rank metrics. E5's model card describes its high cosine scores as expected; it requires `query: ` / `passage: ` prefixes and supports inputs up to 512 tokens. A local API can supply those prefixes. [Official E5-large model card](https://huggingface.co/intfloat/multilingual-e5-large)

For the first fair embedding comparison, use identical evidence spans that fit each model's tokenizer budget, including prefixes. Evaluate longer BGE context separately rather than truncating E5 silently. Qwen remains an option; its old result gives no reason to prioritize it over E5-large here. Neither result decides the winner on cleaner, larger Telegram transcripts.

### 3.4 Passage evidence must remain separate from whole-lesson discovery

The old `lessons` index recovered useful parent documents missed by cue retrieval. Preserve it as an **experimental discovery fallback**, not a mandatory third production index. Words spread over a long lesson do not establish that the lesson addresses their relationship.

Test whether the fallback finds additional useful source spans. If it does, inspect passages from a bounded number of retrieved parents through the same evidence-ranking path, or show a separately labeled lesson-discovery block. Do not blend whole-lesson matches into verified passage counts. If passage retrieval covers the same evidence, omit the extra index.

Retain fine source segments for playback while testing larger retrieval context. This addresses the useful point behind the old plan's reluctance to recut its cues without accepting its assumption that passing `q` to the player solves precision. The [current old player](/Users/haithamassoli/Documents/kashaf-alkulify/src/islands/Player.tsx:212) looks for a normalized substring; a semantic paraphrase may not occur, and a later matching phrase can move playback away from the selected occurrence. Carry the original query for user continuity, but anchor playback to verified evidence.

### 3.5 Broad matching is not strict phrase matching

`matchingStrategy: all` means required query terms, not verified consecutive wording. The old UI's “strict” pass also includes semantics. Keep the current plan's separate phrase route and its conservative normalization contract.

Do not copy the old normalization helper wholesale into phrase verification. It folds `ة/ه`, `ى/ي`, `ؤ/و`, and `ئ/ي`; the archive's helper has a different contract. Reuse reviewed synonym data and fixtures, then reconcile normalization explicitly. Do not change existing title identity behavior silently.

The old plan's “interrogatives only” stop-word list includes `ما`. In `ما يجوز`, that word may negate the statement. An index-wide stop-word setting cannot distinguish this use from an interrogative. Start without a stop-word list; test any query simplification on judged examples without removing meaning from stored text.

Add one clarification to the current plan: a strict search for `يجوز` can legitimately match that word inside `لا يجوز`. The error is hiding `لا` in the excerpt or presenting the passage as approval. Phrase occurrence and proposition meaning are different judgments.

Also correct the old explanation of `frequency`: current official documentation says it drops the **most common** terms first, while the old plan and code comment say the rarest. Probe the pinned engine release before relying on this behavior. [Meilisearch matching strategies](https://www.meilisearch.com/docs/capabilities/full_text_search/how_to/use_matching_strategy)

### 3.6 Thresholds should protect presentation without destroying candidate recall

Do not inherit `semanticRatio = 0.7`, `SCORE_FLOOR = 0.765`, or `LESSON_CEILING = 300` as production constants. They belong to a specific old corpus, model-serving configuration, result layout, and evaluation set. Keep them as historical comparison settings only.

In particular, a strict threshold applied before a reranker can remove useful passages the reranker would have promoted. First measure candidate recall with minimal filtering, then tune the final result policy separately for audio and articles. Display exact, estimated, or bounded counts according to what the system actually counted. An empty result is acceptable when no suitable evidence was found.

The old round-2 document says `distribution` shipped in one section and says it was dropped in another; the inspected [embedder configuration](/Users/haithamassoli/Documents/kashaf-alkulify/meilisearch-embedder.json) omits it. A monotone score transformation does not improve ordering within a pure semantic list, though it can affect a lexical/semantic merge and threshold placement. It does not create probability calibration. [Meilisearch score distribution](https://www.meilisearch.com/docs/capabilities/hybrid_search/advanced/tune_distribution)

### 3.7 Reuse the batch approach, not the old deployment recipe

The [round-2 recipe](/Users/haithamassoli/Documents/kashaf-alkulify/docs/SEARCH-PLAN-2.md:185) says to upload vectors before declaring the embedder. Later comments in [scripts/embed.ts](/Users/haithamassoli/Documents/kashaf-alkulify/scripts/embed.ts) and [scripts/index.ts](/Users/haithamassoli/Documents/kashaf-alkulify/scripts/index.ts:19) explicitly report that this lost vectors on the tested version, and describe declaring the embedder on an empty replacement index first. Treat the recipe as stale.

For the new `userProvided` path, declare settings on the candidate index, wait for success, upload documents/vectors, verify task outcomes and vector coverage, then activate the generation. The application supplies both document and query vectors. `documentTemplate` does not apply to this embedder source. These are different responsibilities from the old Meilisearch-to-Ollama integration. [Official integration contract](https://www.meilisearch.com/docs/capabilities/hybrid_search/how_to/search_with_user_provided_embeddings)

Likewise, retaining `_vectors` through `updateDocuments` is safe only while model input is unchanged. The old scripts emit `regenerate: false`, update text without input hashes, and can skip embedding by document ID alone. A same-ID text correction can therefore retain a stale vector. Reuse the Telegram plan's `(embedHash, embeddingInputHash)` cache and content-revision checks. Track specific Meilisearch task success; waiting until a queue becomes idle does not establish that its tasks succeeded.

### 3.8 The archive integration needs reconciliation, not another pipeline

The September 8 Telegram search proposal says transcription is incomplete. The [September 11 status document](/Users/haithamassoli/Documents/telegram-archive/docs/next-decisions.md:16) and task ledger record 9,793 completed audio binaries, 2,926.6 hours, 5,630 lessons, and 4,455 articles, with 1,625 lessons needing grouping review. These are newer documented counts, not a fresh live audit. Complete transcription does not mean every composition is eligible for public search.

Do not add the old site's 1,136 hours to the new archive's hours without checking overlap. Keep the user's approximately 4,000 hours as a planning scale until an inventory establishes unique, searchable coverage.

Add the archive's existing migration obligations to the current search plan: preserve old-only material, import manual corrections, map old IDs and links, and verify coverage before replacing the site. Reuse the existing Python CLI, pipeline locks, R2 access, failure records, and lesson timeline. Physical merging of audio files is not required; search coordinates must agree with the permanent virtual timeline.

The dedicated Telegram search proposal already corrects several older main-plan assumptions, but [tasks.md](/Users/haithamassoli/Documents/telegram-archive/docs/tasks.md:101) still repeats them. Reconcile the task list before coding: colon-containing IDs, global parent distinct, aggressive normalized embedding inputs, and an unmeasured 4 GB sizing rule must not remain competing instructions. Meilisearch limits ID characters, and a parent filter alone does not turn off global distinct. [Primary keys](https://www.meilisearch.com/docs/capabilities/indexing/how_to/design_primary_keys), [Distinct configuration](https://www.meilisearch.com/docs/capabilities/full_text_search/how_to/configure_distinct_attribute)

## 4. Configuration to adopt now

| Area | Recommendation | Why |
| --- | --- | --- |
| Product | Scope-first audio/articles; ordinary search plus optional phrase matching | Matches the stated user journeys without technical mode choices |
| Search engine | Existing self-hosted Meilisearch, with exact version recorded | Earlier implementation already demonstrates the needed baseline; no evidence yet justifies migration |
| Embeddings | Local BGE-M3 dense output as the reference | Existing operational experience and a credible starting point |
| First embedding challenger | `intfloat/multilingual-e5-large` | Specific historical corpus evidence; test documented prefixes and limits |
| Reranking | Compare none, BGE-reranker-v2-m3, and GTE multilingual on identical candidates | Quality priority justifies the experiment; no winner or CPU capacity has been measured here |
| API | One small VPS search API with private model/index access | Centralizes strict verification, source eligibility, reranking, and model protocols; reuse existing inference handlers where possible |
| Archive worker | Existing Telegram Python pipeline | Avoids recreating ingestion, locking, and artifact management in the website project |
| Batch placement | VPS CPU baseline; optionally a user-owned local machine for offline embeddings | Local batch work can reduce competition with submitted searches; a separate machine is not a release dependency |
| Passage construction | Existing source segments plus measured context alternatives | Retains navigation precision while testing recall and complete statements |
| Grouping | Remove exact duplicates before scoring; group overlapping evidence afterward | Early one-per-parent distinct can discard the best evidence before reranking |
| Whole-lesson index | Conditional discovery experiment | Retain only if it adds verified useful evidence or helps a tested browsing journey |
| Runtime | Reference CPU inference, then compatible optimization if needed | Old one-core figures and raw weight sizes do not establish the current VPS's capacity |
| Deferred | Qwen 4B, new search engine, learned sparse/multivector path, fine-tuning | No diagnosed failure yet requires these additions |

Keep the old direct browser-to-Meilisearch system as a historical baseline. The added API is justified by the requested verification and reranking work; it does not require changing the whole site to server rendering. Do not introduce a second queue or manifest store if the existing worker already covers the requirement. Any local parent-text snapshot remains derived data.

Keep the original query visible when opening a result, but show source context by default instead of automatically filtering away adjacent lines. Expose additional occurrences within the same lesson/article. Do not show model names, mixing ratios, or reranking switches to visitors.

## 5. Revised experiment order

The current plan's evaluation breadth is useful. Execute a smaller sequence first and expand only when results identify the next question.

| Stage | Work | Required evidence before moving on |
| --- | --- | --- |
| R0: reconcile | Inventory actual VPS/corpus, identify reusable code, import legacy questions/corrections, map old IDs | Source coverage report; historical and new metrics named separately |
| R1: establish baselines | Reproduce the old configuration where its snapshot exists; run lexical and BGE hybrid baselines on one fixed new-corpus snapshot | Actual selected-scope results, gold evidence ranges, no unverified claim that old numbers were reproduced |
| R2: fix evidence | Test conservative/tolerant normalization, strict phrases, source anchors, and a small set of context policies | Reliable excerpts; measured candidate evidence recall before reranking |
| R3: improve ranking | If relevant evidence is in the pool, compare no reranker/BGE/GTE; otherwise prioritize the missing-candidate cause | Paired evidence-ranking gains and CPU cost, with identical candidates for reranker comparison |
| R4: challenge retrieval | Test E5-large for persistent retrieval gaps or a planned pilot comparison; test Qwen later if still warranted | Fair input protocols, audited truncation, full-context differences reported separately |
| R5: release comparison | Freeze finalists, run on the full eligible corpus and fresh held-out families, exercise updates and playback | Quality by scope/intent, correct counts/anchors, measured operating envelope and recovery |

Import all 91 legacy records as development material after review. They can seed the current plan's 120 development cases where applicable, but they are not automatically independent or complete labels. Author 120 fresh held-out cases for the proposed 240-query evaluation target, keeping related query families together and maintaining the intent and scope coverage in the main plan. Add normalization variations within families rather than inflating sample size.

Use the main plan's Success@5, nDCG@10, candidate evidence recall, phrase precision, and source-integrity checks. Retain legacy parent success as a secondary comparison. Keep proposed numeric quality targets labeled as proposals. The Telegram plan's one-second target must not veto a configuration that produces materially better results and completes reliably on the actual VPS.

## 6. Proposed amendments to the current plan

| Current section | Amendment |
| --- | --- |
| 3: Repository fit | Add the old website's implementation/evaluation inventory and the existing Telegram worker; identify ownership of each reusable component |
| 4: Corpus audit | Record dated old/new counts, reconcile overlap and eligibility, and add migration coverage and correction import |
| 5: Passages | Add conditional whole-lesson discovery; distinguish fine playback anchors from larger retrieval context |
| 6: Normalization | Import reviewed alias examples; document `ما` negation and the phrase-occurrence-versus-proposition distinction; keep strict and tolerant profiles separate |
| 7: Integration | Reuse the existing pipeline and local inference where practical; document `userProvided` responsibilities and the corrected empty-index setup order |
| 8: Model options | Add E5-large before Qwen; defer the optional 4B branch until a measured need |
| 9: Ranking | Include the historical configuration as a baseline; make fallback selected-scope-aware; keep thresholds from hiding evidence before reranking |
| 10: CPU operation | Add optional user-owned offline batch generation without making it mandatory; pin artifact/runtime compatibility |
| 11: Updates | Add an explicit regression for same-ID corrections with preserved vectors and ID-only embedding skips; incorporate legacy redirects and corrections |
| 12: Evaluation | Import 91 legacy records/66 source-labeled cases as development data; repair metric names and add fresh held-out families |
| 13–14: Experiments/checklists | Use R0–R5 as the first execution path; defer broader model/engine work until failures justify it |
| 15: Operations | Preserve local aggregate monitoring and clear degraded states; port only relevant existing operational checks |

After agreement, update the main search plan and reconcile the archive's M4/M4.5 checklist. Mark earlier plans as historical references rather than keeping several competing definitions of current search behavior. This review records the reasons for those changes.

## 7. Consolidation checklist

- [ ] Name one canonical search specification and link the historical plans as evidence.
- [ ] Record which search and archive components already exist before adding files or services.
- [ ] Verify current VPS resources and competing workloads.
- [ ] Reconcile unique corpus coverage, publication eligibility, and old-only sources.
- [ ] Import manual corrections and map legacy result/source URLs.
- [ ] Import and review the 91 legacy query records; locate evidence for the 66 source-labeled cases.
- [ ] Rename the historical parent metric and score the actual selected-scope display order.
- [ ] Create fresh held-out query families and representative in-domain no-useful-evidence cases.
- [ ] Preserve strict phrase rules, original text, negation, and source offsets across normalizers.
- [ ] Test query continuity without allowing substring reseeking to replace the chosen evidence anchor.
- [ ] Compare source segments and bounded-context passages before a full rebuild.
- [ ] Retain whole-lesson discovery only if its added value is measured.
- [ ] Establish lexical and BGE hybrid baselines on one fixed corpus snapshot.
- [ ] Measure candidate evidence recall before evaluating rerankers.
- [ ] Compare none/BGE/GTE reranking on identical candidates and context.
- [ ] Add E5-large with its documented prefixes and audited token limits.
- [ ] Recalibrate ratios, thresholds, and counts; do not copy the old constants as defaults.
- [ ] Preserve multiple candidate passages per parent until evidence scoring is complete.
- [ ] Correct embedder setup order and verify task success plus vector coverage.
- [ ] Test same-ID text correction, stale vector invalidation, retry, and removal behavior.
- [ ] Reconcile the archive task list with corrected IDs, grouping, and model inputs.
- [ ] Freeze finalists, validate on the full eligible corpus, and record actual CPU behavior.

## 8. Questions that remain for implementation

The comparison does not need another product decision to establish direction. Implementation still needs the VPS's actual CPU architecture/core allocation and RAM, expected concurrent searches, and the current eligible corpus inventory. It also needs a named owner for relevance judgments and review of uncertain lesson grouping. Until measured, neither a claimed one-core server nor a 4 GB assumption establishes whether two resident models plus Meilisearch will fit.

The recommendation assumes this work serves the current website backed by the Telegram archive. Local inference and the existing Convex/R2 source infrastructure retain their roles from the agreed plan; no new external model service is proposed.

## 9. Additional review: the supplied round-3 plan

The [round-3 document](/Users/haithamassoli/.codex/attachments/d49460c0-4e1e-4476-ad07-d11e213393df/pasted-text.txt), dated August 23, is a substantial improvement over rounds 1 and 2. It reports a larger old-site snapshot: 4,691 lessons, 2,553 hours, and 133,649 source cues. It also reports stale local documents, a missing cue embedder, and lower success when scoring actual rendered cards. These are supplied historical observations, not fresh measurements from this review. Do not combine this snapshot with the Telegram corpus without reconciling overlap.

### 9.1 What it resolves and what it adds

| Earlier concern | Round-3 treatment | Review decision |
| --- | --- | --- |
| Six cards labeled top-3 | Score the ordered rendered list | Adopt; retain passage-level evidence checks |
| Single historical target ID | Rejudge failures and accept other verified sources | Adopt; use versioned source ranges as durable gold labels |
| Reused held-out data | Add fresh questions | Adopt, with the tuning correction below |
| Stale documents and missing vectors | Build a replacement, verify it, swap, test rollback | Adopt and strengthen identity/hash verification |
| Hidden keyword fallback | Expose and monitor degradation | Adopt; isolate failures by scope so a broken audio index does not downgrade healthy articles |
| Wrong active-scope empty behavior | Widen within the selected scope | Adopt |
| Subsecond speed gates | Treat latency as diagnostic | Adopt while retaining finite queues/timeouts and resource checks |
| Private query logging | Aggregate events, opt-in raw text, clicks not treated as labels | Adopt locally; do not make PostHog a new service dependency |
| Unknown impact of engine cutoff | Compare cutoffs and inspect processing | Add to the current plan's baseline and full-corpus checks |
| Reranking before retrieval works | Require candidate recall first | Adopt; this orders the reranker experiment rather than excluding it |

### 9.2 Amendments needed before adoption

**Search stability is evidence, not proof of complete retrieval.** Meilisearch documents that a cutoff can return the best results found before processing stops. Increasing the cutoff is therefore a useful test. Repeat it across representative queries, cold/warm runs, filters, and concurrent load on a frozen index. Stable IDs and counts after one increase do not establish that every relevant source was found. `showPerformanceDetails` provides a timing breakdown; do not treat that parameter alone as an explicit completion certificate. Use any supported cutoff signal from the pinned release, inspect timings, and measure judged evidence recall. [Search cutoff](https://www.meilisearch.com/docs/capabilities/full_text_search/how_to/configure_search_cutoff), [Search API](https://www.meilisearch.com/docs/reference/api/search/search-with-post)

**Separate accurate counting from useful ranking.** The reported 5,002 ms versus 49 ms comparison changes both threshold placement and pagination. It does not isolate which change costs time or prove equivalent retrieval. Compare those factors separately. The API documents extra scoring work for a threshold combined with page pagination. Keep a generous-cutoff reference experiment, but do not make exhaustive counts a universal quality requirement. Compare evidence recall at growing candidate depths; select a pool from measured coverage before reranking. Do not adopt the 60-result shortcut from one query, and do not forbid bounded pools merely because quality is the priority. Every reranked result set needs a declared candidate boundary. Meilisearch pagination also has a `maxTotalHits` limit. [Threshold behavior](https://www.meilisearch.com/docs/reference/api/search/search-with-post), [Pagination limits](https://www.meilisearch.com/docs/capabilities/full_text_search/how_to/paginate_search_results)

**Resolve the held-out contradiction.** Phase 1 correctly freezes candidates before testing, but phase 3 says to sweep ratios and retain 0.7 unless another wins on the held-out set. Perform all sweeps on development data; freeze the complete candidate and evaluate once on held-out data. If that result drives another tuning round, retire it as a final test and create fresh families. Forty new questions are a pilot addition; judge their scope/intent coverage before treating small differences as decisive. Rejudge pooled candidates across all finalists, not only old failures.

**Strengthen the release gate beyond equal counts.** One missing document and one stale document can leave counts equal. Verify the eligible source-ID set, source/content hashes, embedding-input hashes, and model configuration. For this one-vector-per-passage design, check each eligible passage has its expected vector; total vector count alone is insufficient. Drain or reconcile concurrent writes before switching related index generations. Preserve the source-correction and vector-invalidation rules from the main review.

**Make candidate-index evaluation explicit.** The existing `--ladder` evaluator calls the production search helper. That helper uses `PUBLIC_MEILI_HOST` and fixed `cues`, `articles`, and `lessons` names; changing `MEILI_HOST` or creating `cues_next` alone does not retarget it. Add one explicit test target/index mapping and assert the endpoint and generation recorded by the replay. The listed verification commands are not yet evidence that a replacement index was tested. [Evaluator](/Users/haithamassoli/Documents/kashaf-alkulify/scripts/eval.ts:52), [Search helper](/Users/haithamassoli/Documents/kashaf-alkulify/src/lib/meili.ts:166)

**Keep meaning checks alongside lexical statistics.** Document frequency does not establish that removing a word preserves meaning; `ما` may negate a statement. Test number typo settings and synonym directionality as experiments. Keep the current plan's separate original, tolerant lexical, strict phrase, and model-input policies. Calling the hybrid `all` pass “strict” does not implement verified phrase matching.

**Treat token overlap as a landing heuristic only.** Test it within the returned evidence span and retain the existing anchor if no credible improvement appears. A semantic paraphrase may share few words; a question, quotation, or rejected opinion may share many. Median/P95 timing errors are useful, but also inspect whether the landing point omits negation, attribution, or a necessary condition. A 45-second P95 allowance is too weak as the only quality gate for roughly 30-second source segments. Prefer accepted source-revision/time ranges over cue IDs that will change when chunking changes.

**Pair negative-query gates with positive recall.** Zero observed false-direct results is a useful regression condition, not proof of zero future error. Track lost answerable queries and evidence recall so raising the floor cannot satisfy the negative gate by hiding useful material. Label uncertain absence judgments and report raw counts by intent. Compare no reranker/BGE/GTE once candidate recall is adequate, including cases that a pre-rerank threshold might otherwise exclude.

### 9.3 Effect on the combined execution order

1. Reuse round 3's replacement-index, settings, source-identity, and model-compatibility checks.
2. Repair the rendered-order evaluator, source-range labels, selected-scope handling, and replay target mapping.
3. Establish a baseline whose measured quality is not silently limited by engine cutoff or sibling-index fallback.
4. Test normalization, passage context, and ranking placement; compare rerankers once the candidate pool contains the evidence.
5. Challenge BGE-M3 with E5-large if retrieval gaps remain or the planned pilot warrants the comparison; keep broader model changes secondary to a trustworthy baseline.
6. Validate the complete configuration on the full eligible archive and fresh held-out cases, including source updates and playback.

The main plan remains the product and quality contract. Round 3 supplies the preferred repair sequence for the inherited search system; the Telegram plan supplies archive integration. None of them should independently override the others' source, normalization, or evaluation contracts after consolidation.
