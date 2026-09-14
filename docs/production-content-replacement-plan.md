# Production Content Replacement Plan

Recorded on 2026-09-13. This plan replaces the public legacy archive with the current Convex/R2 archive and the new BGE-M3 + Meilisearch search pipeline. It does not merge, import, or retain legacy search documents in production.

## Decision

Use the current project as the only production application and use this data flow:

```text
Convex metadata + R2 transcript/audio artifacts
                    |
                    v
        deterministic release builder
                    |
          BGE-M3 document vectors
                    |
                    v
clean generation-specific Meilisearch indexes
                    |
      query -> local BGE-M3 -> hybrid search
                    |
          live Convex revision check
                    |
                    v
       unchanged excerpt or audio result
```

The browser must call the search API. It must not call Meilisearch directly. `BGE-reranker-v2-m3` remains disabled because the controlled pilot did not improve relevance and increased median response time from 0.491 seconds to 34.571 seconds.

“No old content” means:

- No legacy `cues`, `articles`, or `lessons` index is queried after cutover.
- No document from the old repository is copied into a new index.
- The old Meilisearch data volume is deleted after the new public path passes the cutover checks.
- The old Vercel build and its public search key are retired.
- Production rollback uses an earlier **new** generation or a maintenance page. It never restores the legacy corpus.

The local old repository at `/Users/haithamassoli/Documents/kashaf-alkulify` is outside the production system. Delete it separately only after the production replacement is complete and any code worth retaining has been reviewed.

## Verified state

### Public legacy system

The following was verified from DNS, HTTP responses, the deployed browser bundle, and the old local repository:

| Item | Verified state |
| --- | --- |
| Public site | `https://alkulify.assoli.site`, served by Vercel |
| Public search | `https://search.assoli.site`, served by Caddy |
| Search engine | Meilisearch health endpoint is available |
| Legacy audio passages | 133,649 documents in `cues` |
| Legacy articles | 3,379 documents in `articles` |
| Legacy lessons | 4,691 documents in `lessons` |
| Old local build data | Approximately 220 MB |
| Old production design | Caddy -> Meilisearch, with Ollama/BGE-M3 beside it |
| Browser access | The old browser bundle contains a public Meilisearch search key |

The server's ED25519 SSH fingerprint matches the provider message. SSH password authentication was rejected, so the actual containers, volumes, CPU, RAM, disk, firewall, and server paths are not yet verified. The provider password may have changed since provisioning.

### New system

| Item | Verified state |
| --- | --- |
| Source deployment | Convex `dev:hip-bat-697` |
| Eligible lesson rows | 4,360 |
| Eligible lesson duration | Approximately 2,300 hours |
| Eligible articles | 4,455 |
| R2 role | Transcript and audio artifact storage |
| Search pilot | 10 lessons + 10 articles |
| Pilot passages | 459 audio + 78 article passages |
| Pilot vectors | 537/537 BGE-M3 vectors verified |
| Search quality status | Engineering pilot only; `qualityApproved: false` |

The current pilot proves the pipeline, not corpus completeness or public search quality. A production cutover is blocked until a full release is prepared, embedded, indexed, verified, and evaluated.

## Phase 0: regain and secure server access

- [ ] Obtain the current root password or add an SSH public key through the provider console.
- [ ] Log in only after rechecking the ED25519 fingerprint.
- [ ] Create a named administrative user with `sudo` and install an SSH key.
- [ ] Confirm key login in a second session before changing authentication settings.
- [ ] Rotate the password shown in the screenshot.
- [ ] Disable root password login after key access is proven.
- [ ] Record the provider recovery-console procedure.

Run a read-only inventory without printing container environment variables or secret files:

```sh
uname -a
lscpu
free -h
df -hT
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker compose ls
docker volume ls
ss -lntup
systemctl --failed
find /opt /srv /var/www -maxdepth 3 -type f -name 'compose*.yml' -o -name 'Caddyfile'
```

Capture these facts in the deployment record:

- [ ] Debian version, CPU count/architecture, RAM, swap, and free disk.
- [ ] Compose project directory and exact image versions.
- [ ] Existing Meilisearch and Ollama volume names and sizes.
- [ ] Caddy configuration and certificate storage.
- [ ] Open public ports and firewall rules.
- [ ] Any server checkout, cron, timer, backup, or updater related to the old project.
- [ ] Whether Docker logs or backups contain old document bodies.

Do not delete or stop anything during inventory.

## Phase 1: freeze the production source contract

Convex and R2 become the only content authority. The old repository, YouTube-derived `data/`, Blogger files, Wayback files, and old Meilisearch indexes are not inputs.

- [ ] Confirm `hip-bat-697` is the intended production source or move the finalized archive to a production Convex deployment first.
- [ ] Review the 1,273 lesson rows excluded by the current eligibility rules; classify them without importing legacy text to fill gaps.
- [ ] Fix malformed article titles such as `=` or bare URLs in the source data.
- [ ] Require versioned immutable R2 keys for transcript corrections.
- [ ] Pause archive writers for the final export, or take two exports and require identical source revisions.
- [ ] Save the final eligible source IDs, revision hashes, counts, and total duration as the release inventory.
- [ ] Confirm every result can resolve to a current Convex source and, for audio, a current R2 part.

Acceptance criteria:

- [ ] Every indexed parent ID exists in the final Convex export.
- [ ] Every exported source has one current revision hash.
- [ ] Every transcript artifact passes lesson ID, assembly hash, part order, checksum, and timestamp validation.
- [ ] No code path reads `/Users/haithamassoli/Documents/kashaf-alkulify/data`.

## Phase 2: finish relevance evaluation before the full build

The current ten semantic questions are agent-drafted and contain no reviewed no-evidence cases. They cannot approve a public release.

- [ ] Build reviewed query families for remembered quotations, rulings/topics, and “did the sheikh discuss this?” searches.
- [ ] Include public-language and student-language phrasings for the same intent.
- [ ] Include negation, quoted opposing views, common ASR errors, ambiguous terms, and questions with no supporting source.
- [ ] Listen to each audio gold range and verify that the excerpt preserves attribution and negation.
- [ ] Keep development and held-out families separate.
- [ ] Freeze chunk size, hybrid ratio, candidate limit, and threshold before the held-out run.
- [ ] Keep exact phrase search as a user option and hybrid search as the default.
- [ ] Keep reranking off unless a new controlled comparison improves reviewed evidence ranking enough to justify VPS latency.

Required release report:

- [ ] Success@3 and Success@5.
- [ ] MRR@3 and nDCG@10.
- [ ] Candidate evidence recall.
- [ ] False positives for no-evidence queries.
- [ ] Warm and cold latency on the VPS.
- [ ] Peak process RAM and concurrent-request behavior.

Quality approval must remain false until a human-reviewed held-out report passes the agreed targets.

## Phase 3: build the complete new release

Run the release builder from the current repository. Omit `--limit`; a limit creates another sample.

```sh
npm run search:export
npm run search:prepare
npm run search:embed -- --batch 4 --threads 2
```

Embedding is resumable and reuses vectors only when the exact model input and pinned configuration match. Keep BGE-M3 at the pinned revision and use original Arabic text for embeddings. Keep the existing conservative Arabic normalization for lexical and exact-phrase paths.

Before indexing:

- [ ] Record the generated release ID.
- [ ] Record audio/article source and passage counts from the manifest.
- [ ] Confirm all expected passages have finite 1,024-dimensional vectors.
- [ ] Confirm the release belongs to the final Convex deployment.
- [ ] Confirm there is enough local and server disk for the new release plus temporary import files.

Do not compare the new counts to the legacy counts as an equality test. The new manifest and Convex eligibility rules define completeness.

## Phase 4: create a clean production search stack

Reuse the VPS, Caddy, and Meilisearch version where they are healthy. Replace the data volume and request path.

Minimal production changes needed in the new project:

- [ ] Add a production container for `scripts/search/service.py` and its pinned Python dependencies.
- [ ] Add one `SEARCH_BIND_HOST` setting so the API can bind to the container interface; retain loopback as the local default.
- [ ] Add the search API to the existing Compose network.
- [ ] Preload the pinned BGE-M3 model snapshot and force offline model loading at runtime.
- [ ] Mount the active release manifest, phrase SQLite database, and model cache read-only where possible.
- [ ] Store Convex, R2, and Meilisearch secrets in a root-readable server environment file, never in the image or repository.
- [ ] Set `SEARCH_ALLOWED_ORIGIN=https://alkulify.assoli.site`.
- [ ] Keep one inference request active at a time until VPS measurements justify more.

Create a new Meilisearch volume, for example `meili_data_v2`. Do not reuse or copy the old `meili_data` volume. Bind Meilisearch only to the private Compose network or to host loopback for an SSH tunnel.

The temporary Caddy routing during migration should preserve the old frontend while the new API is tested:

```text
https://search.assoli.site/api/* -> strip /api -> search-api:8787
https://search.assoli.site/*     -> legacy Meilisearch temporarily
```

After cutover, remove the second route and return 404 for every non-API path. This removes public direct access to Meilisearch.

Ollama is not needed in the target stack because the Python API generates BGE-M3 query vectors locally. Remove it only after the new API passes its VPS tests.

## Phase 5: index and verify the clean volume

Expose the clean Meilisearch instance through an SSH tunnel, never through an unauthenticated public port:

```sh
ssh -L 17700:127.0.0.1:7700 <admin>@152.53.0.218
MEILI_HOST=http://127.0.0.1:17700 MEILI_MASTER_KEY=<new-key> npm run search:index
MEILI_HOST=http://127.0.0.1:17700 MEILI_MASTER_KEY=<new-key> npm run search:verify
```

Transfer only the matching new release runtime files to the search API host, then activate that same generation there. Do not transfer old `data/`, old Meilisearch dumps, or old indexes.

- [ ] Meilisearch contains exactly the two generation-specific indexes in the release manifest.
- [ ] Document IDs and fields equal the local prepared corpus.
- [ ] Stored vectors equal the cached BGE-M3 vectors for the same input.
- [ ] Vector coverage is 100% for both scopes.
- [ ] Search settings and the user-provided vector embedder match the manifest.
- [ ] Live Convex revision validation passes immediately before activation.
- [ ] Exact phrase search works across passage boundaries.
- [ ] Audio results resolve to correct R2 parts and timestamps.
- [ ] No index named `cues`, `articles`, or `lessons` exists in the clean volume.

If the VPS cannot hold old and new volumes at once, build and verify a Meilisearch dump locally, schedule maintenance, stop the old stack, delete the old volume, and import the new dump into the clean volume. Do not reduce verification to avoid the maintenance window.

## Phase 6: deploy the new frontend and cut over

Use the current Git repository, not `kashaf-alkulify-y`, as the Vercel source.

- [ ] Set `PUBLIC_SEARCH_API_URL=https://search.assoli.site/api` in the new Vercel project.
- [ ] Set the production Convex public URLs required by the current site.
- [ ] Do not define `PUBLIC_MEILI_HOST` or `PUBLIC_MEILI_SEARCH_KEY` in the new frontend.
- [ ] Build and deploy the current Astro application.
- [ ] Test the deployment URL before moving `alkulify.assoli.site`.
- [ ] Move the public domain to the new deployment.
- [ ] Verify audio and article scope selection, Arabic text, exact phrase mode, semantic search, empty results, and playback at timestamp.
- [ ] Inspect browser network traffic: all search calls must go to `/api`; none may call Meilisearch endpoints directly.
- [ ] Confirm API results are unchanged source excerpts and contain no generated answer or inferred ruling.

Cutover acceptance criteria:

- [ ] Public frontend build identifies the new repository commit.
- [ ] Public API identifies the full new generation, not pilot `4dfa01ed1cd4b51eba02`.
- [ ] Public result source IDs are a subset of the final Convex export.
- [ ] At least one reviewed quote, topic, article, no-evidence, and audio-playback case passes in production.
- [ ] Invalid requests return 400, disallowed origins return 403, and excess concurrent inference returns 429.
- [ ] Meilisearch is unreachable directly from the public Internet.
- [ ] Caddy, search API, and Meilisearch restart cleanly after a controlled reboot.

## Phase 7: delete the legacy production content

Run this phase only after every Phase 6 check passes. The user has chosen removal rather than a legacy-content rollback.

- [ ] Remove Caddy's legacy direct-to-Meilisearch route.
- [ ] Revoke the public search key embedded in the old frontend.
- [ ] Stop and remove the old Meilisearch container from the old Compose project.
- [ ] Delete the old Meilisearch data volume containing `cues`, `articles`, and `lessons`.
- [ ] Stop and remove the old Ollama container and model volume if no other application uses them.
- [ ] Delete any server-side old repository checkout, old dumps, and old content backups found during inventory.
- [ ] Remove old cron jobs, timers, and indexing scripts.
- [ ] Remove `PUBLIC_MEILI_HOST` and `PUBLIC_MEILI_SEARCH_KEY` from the retired Vercel project.
- [ ] Delete or disable the old Vercel project so its unique deployment URLs cannot continue serving the old static content.
- [ ] Rotate the new Meilisearch master key after import if it crossed the SSH tunnel from the maintenance machine.
- [ ] Re-run volume, process, port, and public endpoint inventories.

Deletion proof:

- [ ] `docker volume ls` and disk inspection show no legacy Meilisearch or Ollama content volume.
- [ ] Server filesystem search shows no old data checkout or dump.
- [ ] Public `/indexes/cues`, `/indexes/articles`, and `/indexes/lessons` paths are unavailable.
- [ ] The old Vercel deployment is unavailable.
- [ ] A sample of public result IDs all resolves to current Convex revisions.
- [ ] The deployment record contains the new generation ID, counts, commit, model revision, and verification report.

## Updates after replacement

Use immutable replacement generations for every archive update:

1. Export current Convex metadata.
2. Prepare transcripts from versioned R2 keys.
3. Reuse exact-input embeddings and compute new ones.
4. Index into new generation-specific indexes.
5. Verify documents, vectors, settings, and live revisions.
6. Evaluate the regression set.
7. Activate the new generation atomically.
8. Delete the previous **new** generation after the chosen rollback window.

Never update the active production indexes in place and never use the old repository as a fallback source.

## Go/no-go checklist

The replacement is ready only when all answers are “yes”:

- [ ] Is SSH access restored and the actual VPS inventory recorded?
- [ ] Is the final Convex deployment confirmed?
- [ ] Is the full corpus release built without `--limit`?
- [ ] Are 100% of new passages embedded and verified?
- [ ] Has a human-reviewed held-out evaluation passed?
- [ ] Has the clean VPS stack passed memory, latency, reboot, and concurrency checks?
- [ ] Does the browser call only the search API?
- [ ] Does every result validate against current Convex metadata?
- [ ] Is the public generation a full release rather than the 20-source pilot?
- [ ] Have all legacy production indexes, volumes, keys, jobs, builds, and public routes been removed?

If any answer is “no,” do not delete the old volume yet and do not claim that production contains only the new archive.
