# Local Arabic search: operations and evaluation

This implements the first executable Meilisearch/BGE-M3 baseline from the search plan. The local pilot is an engineering and relevance experiment, not a release of the entire archive. No generated answers are produced.

See [implementation results](search-implementation-results.md) for actual coverage, checks, CPU measurements, and the controlled reranker comparison. Reranking remains optional because the initial experiment did not improve overall evidence ranking.

## What runs where

- Convex remains the source of article text, lesson identity, publication eligibility, and ordered audio parts. `search:exportPage` is an internal, paginated CLI query. `search:revisions` exposes only fingerprints of currently eligible sources.
- R2 remains the private store for existing transcripts and audio. These commands do not transcribe audio, change archive rows, or upload source text to a model provider.
- Meilisearch Community Edition stores separate audio and article passage indexes. BGE-M3 runs locally on CPU and supplies document/query vectors. Meilisearch never calls an external embedding service.
- SQLite is a disposable local search artifact: original texts, offsets, source manifests, exact-phrase FTS, and a separate embedding cache. It is not another source database.
- A loopback Python HTTP service handles query embeddings, source checks, optional reranking, and short-lived audio URLs. Astro's `/search/` page calls it. The service accepts one inference request at a time and returns 429 when busy.

The tested Meilisearch version is **1.53.2**. BGE-M3 is pinned to `5617a9f61b028005a4858fdac845db406aefb181`; the optional BGE-reranker-v2-m3 is pinned to `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e`. Both use CPU float32. `scripts/search/requirements.txt` records the installed Python versions. Quantized inference has not been validated.

## First setup

Run from the repository root, with Node, `uv`, and the project's npm dependencies installed:

```sh
uv venv .search-venv --python 3.12
uv pip install --python .search-venv/bin/python -r scripts/search/requirements.txt
```

On a Linux VPS without a GPU, use `--torch-backend cpu` with `uv pip install` to avoid installing CUDA packages. Compatibility and peak RAM must be checked on that host; the initial measurements are from an 8GB Apple Silicon computer using CPU inference.

Install the matching **Community Edition** binary from the [official 1.53.2 release](https://github.com/meilisearch/meilisearch/releases/tag/v1.53.2) as `.search/bin/meilisearch`, verify its release checksum, and make it executable. The tested Apple Silicon binary has SHA-256 `7fa492746343c1dd7217ead82fc6d42e74c1304593e4604f52ca71cf44d61b28`.

Download model files once. Source documents are not part of these requests:

```sh
HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_XET=1 .search-venv/bin/python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    "BAAI/bge-m3",
    revision="5617a9f61b028005a4858fdac845db406aefb181",
    allow_patterns=["*.json", "*.model", "pytorch_model.bin", "1_Pooling/*"],
)
# Optional: needed only for --rerank.
snapshot_download(
    "BAAI/bge-reranker-v2-m3",
    revision="953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
    allow_patterns=["*.json", "*.model", "model.safetensors"],
)
PY
```

Normal inference uses `local_files_only=True`. Query text is not written to access logs or analytics. Evaluation queries and reports are local files.

The existing `.env.local` provides `CONVEX_DEPLOYMENT`, `CONVEX_URL`, `R2_ENDPOINT`, `R2_ARCHIVE_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Export uses the signed-in Convex CLI, so `.env.local` alone is not a substitute for CLI authentication. The currently selected deployment is `dev:hip-bat-697`.

Optional settings:

| Variable | Default / purpose |
| --- | --- |
| `MEILI_HOST` | `http://127.0.0.1:7700` |
| `MEILI_MASTER_KEY` | Generated locally in `.search/meili-key`, mode 0600, when starting the bundled engine |
| `SEARCH_ALLOWED_ORIGIN` | `http://localhost:4321`; one exact permitted browser origin |
| `PUBLIC_SEARCH_API_URL` | Astro production API URL; development defaults to `http://127.0.0.1:8787` |

Never expose the Meilisearch master key or R2 credentials through `PUBLIC_*` variables. The service binds to loopback; publishing it requires an HTTPS reverse proxy, matching origin configuration, bounded request/worker limits, and query-free proxy logs. Python's development HTTP server is not a public production ingress.

## Build and check a release

In a terminal dedicated to Meilisearch:

```sh
.search-venv/bin/python scripts/search/cli.py start-engine
```

After the search functions have been pushed to the intended Convex development deployment:

```sh
npm run search:export
npm run search:prepare -- --limit 10
npm run search:embed
npm run search:index
npm run search:verify
.search-venv/bin/python scripts/search/cli.py seed-eval
npm run search:eval -- --mode phrase
npm run search:eval -- --mode lexical
npm run search:eval -- --mode hybrid
npm run search:eval -- --mode hybrid --dataset data/search/development.json
```

`prepare --limit 10` selects ten sources per scope by a stable hash. Omitting `--limit` prepares every eligible exported source; that is a deliberate full-corpus run, with a different release identity. `--seconds 30|60|90` and `--tokens 512` support chunking experiments. Long ASR segments are split by token budget without inventing finer timestamps.

`data/search/development.json` targets the initial pilot's source IDs and source hashes. Another sample may not contain those sources: the evaluator fails on missing or changed gold, rather than quietly removing difficult questions. Build an appropriate evaluation set for each corpus while preserving development/heldout family separation.

The generated release name and index names appear in `.search/prepared.json` and `.search/releases/<generation>/manifest.json`. Pass `--generation <generation>` to operate on another prepared release. Commands reject a release belonging to a different Convex deployment. Source exports checkpoint between pages and resume after an interruption on the same deployment.

`embed --limit 8` measures a small initial batch. It caches successful batches by exact model input and embedding configuration. Repeating `embed` reuses matching inputs, including when the source ID is unchanged but its text has changed: changed text has a different cache key.

For a keyword-only experiment, use `index --lexical`. Missing vectors are explicitly empty; the manifest records incomplete semantic coverage. Hybrid requests then report degradation instead of pretending to use semantic retrieval. Run `index` again after completing embeddings, before activating that generation.

Every Meilisearch task is awaited and failed/canceled tasks raise an error. Verification checks:

- Exact passage IDs and every stored document field against the local corpus.
- Vector dimensions, finite values, and equality to the cached vector for that exact input.
- Full vector coverage for a hybrid release.
- Search settings and the user-provided embedder configuration.
- Live Convex source revisions, including publication eligibility and current audio-part membership.

R2 transcript keys are treated as immutable versioned artifacts, as in the existing archive pipeline. Preparation hashes the fetched text and timestamps, so a subsequent rebuild detects changed bytes even under a reused key. Live revision checks do not fetch transcript bytes: overwriting a transcript under the same R2 key requires rebuilding before activation. Prefer a new versioned key for corrections.

## Use the local pilot

```sh
.search-venv/bin/python scripts/search/cli.py activate
npm run search:serve
npm run astro -- dev --background
```

Open `http://localhost:4321/search/`. Choose audio or articles before submitting a query. The default is hybrid retrieval. The optional phrase mode verifies consecutive normalized tokens against the original full source and can find phrases spanning chunk boundaries. Results show unchanged source text, surrounding context, and an audio anchor or original source link.

The phrase contract ignores harakat, tatweel, punctuation boundaries, and Arabic/Persian digit variants. It preserves hamza, `ة/ه`, `ى/ي`, and negation. Lexical search additionally folds alef variants, `ى/ي`, and `ة/ه`. Embeddings use original body text. No stop-word deletion, stemming, or unreviewed synonym expansion is enabled.

Grouping occurs after passage ranking/reranking. “Multiple occurrences” keeps multiple passages per source. A finite candidate limit is disclosed; the interface never claims to enumerate everything the sheikh said. Empty results do not assert that he never discussed the subject. The UI labels pilot coverage and lexical fallback/degraded retrieval.

Playback converts the selected lesson timestamp to its original part's local timestamp. The service rechecks the source before signing a one-hour R2 URL and supplies a VTT transcript for that part. Playback currently covers the selected part; automatic continuation across the complete multipart lesson remains in the player integration phase.

## Comparing retrieval and reranking

```sh
npm run search:eval -- --dataset data/search/development.json --mode lexical
npm run search:eval -- --dataset data/search/development.json --mode hybrid --candidates 100
npm run search:eval -- --dataset data/search/development.json --mode hybrid --candidates 100 --rerank
```

Repeat candidate limits 50/100/200 on development data when recall is insufficient. `--ratio` and `--threshold` are explicit experimental settings; a threshold is not a probability. The initial runtime uses ratio 0.7 and no calibrated acceptance threshold. Do not interpret arbitrary semantic neighbors as proof of a ruling or position.

The reranker uses the same retrieval candidates and groups only afterward. CPU serving keeps one large model resident at a time in reranking mode to limit RAM; this trades latency for memory. Keep reranking off unless its evidence-ranking gains justify the measured cost.

Reports record generation, dataset digest, mode, candidate limit, settings, displayed evidence ranges, degradation, latency, Success@3/5, MRR@3, nDCG@10, and candidate evidence recall. A result must contain the complete judged evidence range: partial overlap could omit a negation. A correct parent with the wrong passage does not pass. Duplicate hits do not earn repeated relevance credit. No-evidence cases record direct-result and any-result false positives separately. Reranker evaluations require identical candidate IDs and ordering to the corresponding baseline run.

Generated quote cases are **smoke tests**. The checked-in semantic questions are **agent-drafted development cases**, not human judgments or audio-verified gold. Reports always distinguish these from a completed quality approval. Fresh heldout cases require `--heldout`; the configuration is frozen for that release and cannot be changed for a subsequent heldout run.

## Updates, rollback, and remaining release gates

Export and prepare again after source changes, then embed/index/verify the replacement generation. Existing vectors are reused only for identical inputs. New generation indexes contain only that generation's sources, so retired/removed sources are omitted without fragile per-document cleanup. Source validation also prevents a retired or changed source in an older index from being returned.

Activation writes one atomic local pointer naming both immutable Meilisearch indexes and the corresponding phrase database. It requires a recent successful verification. The previous pointer is retained in `.search/previous.json`. Restart the API with `--generation <previous-generation>` to roll back, or verify and activate that generation again. Active indexes cannot be reindexed in place. Do not delete old generation directories/indexes until rollback is no longer needed.

Operational verification is distinct from public quality approval. Before making search public:

- [ ] Build a representative larger pilot, then evaluate the full-corpus finalists.
- [ ] Review the corpus exclusion inventory and any migration/correction gaps.
- [ ] Expand and independently review the evaluation families, including plausible no-evidence questions, negation, quoted opposing positions, and ambiguous ASR.
- [ ] Listen to gold audio ranges and judge whether excerpts preserve attribution and the surrounding ruling.
- [ ] Freeze development tuning before opening fresh heldout families.
- [ ] Calibrate direct-result/fallback thresholds against both useful-evidence recall and false positives.
- [ ] Measure search cutoff stability and candidate recall across cold/warm and concurrent runs. A stable top list is not a completeness proof.
- [ ] Compare BGE reranking with no reranking; evaluate the E5/GTE challengers only when the observed failures justify them.
- [ ] Measure CPU memory/latency on the actual VPS and configure production process supervision and HTTPS ingress.
- [ ] Run a rollback drill and connect archive update scheduling to the existing pipeline stage ownership.
- [ ] Freeze source writers or compare a final export before full-corpus activation; paginated exports are not a single database snapshot.

Project checks: `npm run search:check`, `npm run check`, and `npm run build`. Do not run the build concurrently with the development server when validating hydration: the installed Vite/React stack was observed to reuse a production JSX runtime in development; restarting the dev server repaired its cache.
