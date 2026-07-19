# RAG Items 9-16: Implemented Changes and Old-vs-New Behavior

## Implementation status

Items 9-16 are implemented in the application, migration, frontend, tests, and operator tooling. No live Supabase migration, storage mutation, vector replacement, or production Gemini re-embedding was performed.

The current application code expects the migration in `rag-thesis-backend/migrations/20260717_rag_items_9_16.sql` before the new index-version and page-location fields are used in a deployed environment. Existing papers remain searchable immediately after that migration through a legacy active-index backfill. Exact page citations require a later authorized re-index.

## Old vs. new system behavior

| Area | Old behavior | New behavior |
|---|---|---|
| Exact 85% boundary | An exact match could be missed because SQL used `>` | Both retrieval RPCs use inclusive `>=`; 84.99% is clear, 85.00% and 85.01% are flagged |
| Duplication metrics | One ambiguous duplication percentage mixed passage similarity and document coverage | Highest passage similarity, matched chunk coverage, matched chunk count, total chunks, and advisory verdict are separate |
| Count field | `matched_chunks` risked being interpreted as a count | `matched_chunk_count` is numeric; `matched_chunks` remains the comparison-excerpt list |
| Units | Ratios and percentages could be mixed | Internal similarity is `0-1`; public API and UI values are `0-100` |
| Legacy values | A stored ratio could render as a tiny percentage | Values at or below `1` are normalized to percent; already-percent values are preserved |
| Verdict | AI wording could imply acceptance or rejection | Deterministic advisory tiers are shown; the high tier reads “High overlap—faculty review required” |
| Department scope | Client selections could influence scope without one shared server rule | Guests are forced to CCSICT; ordinary users use their profile department; cross-department requests return 403; superadmin selections are validated |
| Threshold ownership | Chat clients sent an effective match count/threshold | Deprecated client fields are ignored; validated server configuration owns retrieval `0.30`, top-k `5`, and duplication `0.85` |
| Follow-ups | History could influence an answer without sufficient current evidence | Only ambiguous follow-ups are rewritten, current evidence is retrieved again, and no-current-context returns the no-result response |
| Session history | History was loaded without an explicit ownership query in the RAG path | Ownership is checked before loading no more than five recent exchanges; guest session IDs are rejected |
| Retrieval ranking | Results were grouped at paper level before reordering | Evidence chunks are ranked individually; citation IDs are assigned before the tested custom reorder |
| Chunk continuity | Pages had no retained location map | The cleaned document is split as one stream, including cross-page overlap, then mapped to one-based page ranges and active sections |
| Citations | Sources were paper-level | Sources include citation ID, chunk ID/index, department, similarity, page range, and section where available |
| Multiple passages | Several passages from one paper collapsed conceptually | Each evidence chunk remains a separate citation and source card |
| Citation failures | Invalid or missing markers could be silently tolerated | Every substantive unit is structurally validated, one repair is attempted, then a safe valid-source fallback is returned |
| Content controls | Refusal depended mainly on model instructions | Prompt injection and academic-content generation are blocked deterministically before embedding/generation |
| Index replacement | Replacing vectors could leave a paper partially indexed | A complete inactive version is staged and verified, then activated atomically |
| Rollback and pruning | Old vectors had no explicit lifecycle | The active and newest inactive rollback versions are protected; explicit pruning removes only older eligible inactive versions |
| RPC access | No activation RPC existed | Activation and pruning RPCs are security-definer functions with execution revoked from `public`, `anon`, and `authenticated` |
| Production safety | Re-index work could be run accidentally | The command defaults to dry-run; live work requires explicit `--apply` |

## API changes

### Chat request

Effective fields:

```json
{
  "question": "Which archived studies used clustering?",
  "session_id": null,
  "department_filter": "CCSICT"
}
```

`department_filter` is effective only for superadmins. Old `match_count` and `match_threshold` fields are accepted as unknown compatibility input but ignored.

### Chat source

```json
{
  "citation_id": 1,
  "id": "paper-uuid",
  "chunk_id": 123,
  "title": "Thesis title",
  "authors": "Authors",
  "year": 2026,
  "track": "Data Mining",
  "department": "CCSICT",
  "similarity": 91.23,
  "page_start": 34,
  "page_end": 35,
  "section": "Methodology",
  "chunk_index": 8
}
```

`id` remains the paper ID. Author-metadata results and legacy saved messages can omit chunk/location fields.

### Canonical scan response

```json
{
  "flagged": true,
  "threshold": 85.0,
  "highest_similarity": 94.25,
  "matched_chunk_percentage": 32.5,
  "matched_chunk_count": 13,
  "total_chunks": 40,
  "verdict_level": "review_suggested",
  "matched_papers": [],
  "matched_chunks": [],
  "duplication_percentage": 32.5
}
```

`duplication_percentage` is retained temporarily as a deprecated alias for `matched_chunk_percentage`.

### Metric definitions

- `highest_similarity`: greatest qualifying uploaded-to-archived chunk cosine similarity, public `0-100`.
- `matched_chunk_percentage`: `matched_chunk_count / total_chunks * 100`.
- `matched_chunk_count`: number of uploaded chunks with a nearest archive match at or above 85%.
- `matched_chunks`: saved excerpt comparisons, not a numeric count and potentially limited for display.
- `verdict_level`: `clear` at zero matched chunks, `review_suggested` above zero and below 50% coverage, and `high_overlap` at 50% or more coverage.

## Schema migration instructions

The migration has deliberately not been applied. When an operator authorizes deployment:

1. Take a database backup and test the migration on staging.
2. Review the migrations in order:
   - `rag-thesis-backend/migrations/20260717_rag_items_9_16.sql`
   - `rag-thesis-backend/migrations/20260717_security_scope_evaluation.sql`
   - `rag-thesis-backend/migrations/20260718_transactional_ingestion_cleanup.sql`
3. Apply those migrations in that order through the approved Supabase migration workflow.
4. Verify CCSICT exists in `departments`, every paper has `active_index_version`, every legacy chunk has the matching version, and both RPC definitions contain `>=` and the department filter.
5. Verify direct anon/authenticated access to `departments` is denied and activation/pruning execution is service-role only.
6. Deploy the backend and frontend only after the schema checks pass.

The migration is transactional. A uniqueness conflict or other error rolls it back rather than leaving a partial schema.

## Safe re-index instructions

Run commands from `rag-thesis-backend`. Dry-run is the default and performs no Supabase, storage, or Gemini calls:

```powershell
.\.venv\Scripts\python.exe scripts\reindex_citations.py --all --fixture-dir ..
```

After migration and explicit production authorization, re-index one paper or all papers:

```powershell
.\.venv\Scripts\python.exe scripts\reindex_citations.py --paper-id PAPER_UUID --apply
.\.venv\Scripts\python.exe scripts\reindex_citations.py --all --apply --resume
```

Pruning is separate and explicit:

```powershell
.\.venv\Scripts\python.exe scripts\reindex_citations.py --prune-old --older-than-days 7 --apply
```

The apply path downloads the private original, extracts page/section ranges, generates and verifies every embedding, inserts a new inactive version, verifies staged rows, and activates only at the end. Missing originals and extraction/embedding failures are recorded and skipped. A failed staged version cannot replace the old active index.

## Compatibility behavior

- Existing papers remain searchable after migration through legacy version backfill.
- Existing saved source JSON without page/chunk fields still renders at paper level.
- Existing scan records still render through ratio/percentage normalization and the deprecated coverage alias.
- Old chat clients can send removed threshold fields, but those values have no effect.
- Papers without recoverable originals retain paper-level citations.
- Full page-aware citation data appears only after an authorized re-index.

## Thesis paper updates required

The PDF was not edited in this implementation task. A future thesis revision should update:

- Chapter 1 scope/delimitation: define the 85% rule as inclusive and advisory, not automatic rejection.
- Chapter 3 retrieval procedure: document fixed server-owned settings, department resolution, ambiguous-follow-up rewriting, current-evidence enforcement, and chunk-level reordering.
- Chapter 3 document processing: document combined-document splitting, page/section character ranges, active index versions, atomic activation, rollback retention, and explicit pruning.
- Chapter 3 duplication procedure: distinguish highest passage similarity from matched chunk coverage and define all three advisory tiers.
- Chapter 3 generation controls: describe deterministic pre-generation blocking and structural post-generation citation validation with one repair attempt.
- Database/API diagrams and data dictionary: add `departments`, index-version/location fields, canonical scan fields, activation/pruning RPCs, and chunk-specific source fields.
- Evaluation/testing chapter: include the exact threshold, isolation, follow-up, citation, migration, rollback, pruning, compatibility, and dry-run tests now present in the system.

## Verified results

- Backend: 107/107 PyTest tests passed.
- Overall backend coverage: 52%, increased from the previous 42% baseline.
- Touched core service coverage: chunker 95%, citations 94%, document processor 88%, guards 92%, novelty 100%, retriever 95%.
- Frontend ESLint: 0 errors and 4 existing complexity warnings; warning count decreased from the five-warning baseline.
- Frontend production build: passed.
- Backend Pylint: 9.77/10; remaining findings are existing complexity/style findings, primarily in untouched analytics/administration routes.
- Re-index dry-run: passed against the local thesis PDF and extracted TXT with `external_calls: 0`; 27 page-aware PDF chunks and 31 page-less TXT chunks were verified.
- SQL contract review: inclusive thresholds, department filters, active-index filters, legacy backfill, service-role RPC revocation, and rollback-protected pruning are present.
- `git diff --check`: passed after implementation and documentation updates.

## Citation-validation limitation

The validator guarantees citation-marker structure, valid source IDs, and citation coverage for substantive paragraphs/list items. It does **not** prove semantic entailment of every sentence by the cited chunk. The low-temperature model prompt, untrusted-context delimiter, retrieval threshold, and safe fallback reduce factual risk, but faculty review remains necessary.

## Production state

The configured live Supabase project is unchanged. No migration was executed, no production original was downloaded, no live index was staged or activated, no inactive version was pruned, and no production Gemini embedding was generated.
