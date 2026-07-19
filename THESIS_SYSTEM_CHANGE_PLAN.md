# Thesis System Change Plan

This plan lists the changes required to make the current system secure, internally consistent, thesis-compliant, and defensible during evaluation. Work should proceed in this order: security and data integrity, database consistency, algorithm correctness, research evaluation, and then optional enhancements.

> **Progress legend:** ✅ implemented and verified · 🚧 partially implemented · ⏳ pending
>
> **Last implementation review:** July 20, 2026 — Items 4, 9–19, and 27–31 are implemented. The hardened backend passed **220/220 tests with 81.85% coverage**, and the disposable-Supabase security integration passed. Frontend verification: **7/7 unit tests, ESLint 0 errors/0 warnings, and production build passed**. All three JMeter profiles completed. SonarQube passed with zero bugs, vulnerabilities, hotspots, or new-code issues. Pylint: **10.00/10**. Privacy-safe LangSmith traces verify embedding, duplication, retrieval, generation, citation repair, total latency, and token usage. The final citation re-index dry-run passed with zero external calls. Ragas remains pending its faculty-validated academic prerequisite.

## P0 - Critical fixes

### 1. Repair the Supabase schema

Update `rag-thesis-backend/supabase_setup.sql`:

- Create the missing `departments` table:
  - `id`
  - unique `name`
  - `track_label`
  - `tracks jsonb`
  - `created_at`
- Seed CCSICT and its approved tracks.
- Add `profiles.avatar_url`.
- Create the `avatars` storage bucket and owner-only upload, update, and delete policies.
- Seed `role_features` instead of creating it during the first API request.
- Add migrations for existing installations, especially:
  - `profiles.department`
  - `profiles.status`
  - `profiles.avatar_url`
  - `papers.department`
- Add indexes on department columns.
- Add schema tests verifying every table and column used by the application exists.
- Move toward numbered migrations instead of maintaining one monolithic setup script.

### 🚧 2. Close the signup privilege-escalation vulnerability

> 🚧 **Core vulnerability fixed; final disposable-project proof pending.** Public signup no longer accepts admin or superadmin, faculty remains pending, all public accounts are server-assigned to CCSICT, and the Admin/department choices are removed from signup. A separate `role_requests` workflow has not yet been added.

The signup trigger currently trusts `requested_role` from user-controlled metadata. An attacker could request `superadmin`; because only faculty and admin are marked pending, that account could become an approved superadmin.

- Never accept `admin` or `superadmin` from signup metadata.
- Public signup should allow only `student` and optionally `faculty`.
- Faculty requests must remain pending.
- Admins and superadmins must only be created or promoted by an existing authorized administrator.
- Prefer a separate `role_requests` table instead of storing an untrusted requested role directly in `profiles`.
- Remove the Admin option from `rag-thesis-frontend/src/pages/auth/SignUpForm.jsx`.

### ✅ 3. ~~Fix profile row-level security~~

> ✅ **Implemented and verified against a disposable Supabase project.** Client updates are restricted to `full_name` and `avatar_url`; role, status, department, and email mutations are rejected. The application-project and service-key guards also passed. Integration result: 3/3 tests in 3.42 seconds.

The current profile update policy only ensures that the role remains unchanged. A user could directly modify their own `status` or `department` through Supabase.

- Restrict user-editable fields to `full_name` and `avatar_url`.
- Keep `role`, `status`, `department`, and `email` backend-only.
- Add a trigger that rejects unauthorized protected-column changes.
- Add tests proving pending users cannot approve themselves or change departments.

### ✅ 4. ~~Fix chat-session authorization~~

> ✅ **Implemented and verified.** Session ownership is checked before history is loaded, guest-supplied session IDs are rejected, and authorization behavior is covered by backend tests.

The `/chat` endpoint accepts a supplied `session_id` but does not verify ownership before loading history or inserting messages.

- For authenticated users, confirm `chat_sessions.user_id` matches the current user.
- For guests, reject or ignore all supplied session IDs.
- Return 404 or 403 for non-owned sessions.
- Include the user ID in `_load_chat_history`.
- Add IDOR tests for reading and writing another user's conversation.

### 🚧 5. Secure upload jobs

> 🚧 **Ownership and durable status persistence implemented.** Jobs are recorded in `upload_jobs`, scoped by owner and department, stale jobs fail safely, and polling is bounded. The in-process background executor is still not a fully durable worker queue; that production enhancement remains Item 35.

The in-memory upload job store does not record or verify its owner.

- Store `owner_id` and `department` on every job.
- Enforce ownership checks in `/upload/status/{job_id}`.
- Replace or supplement the in-memory store with a persistent database table.
- Record expiration and cleanup status.
- Add tests proving users cannot inspect another uploader's job.

### 🚧 6. Validate uploads properly

> 🚧 **Required validation implemented; final full-suite rerun pending.** PDF extension, MIME, magic bytes, size, encryption, page count, malformed content, and sanitized filename checks are present.

- Allow only PDF if strictly following the thesis.
- Otherwise, explicitly revise the paper to include TXT support.
- Validate file extension, MIME type, and PDF magic bytes.
- Sanitize filenames.
- Apply the 25 MB limit to metadata extraction as well.
- Reject encrypted, malformed, zero-page, and extreme-page-count PDFs.
- Add decompression and resource-exhaustion protections.

### 🚧 7. Make ingestion transactional

> 🚧 **Atomic database commit, persistent cleanup recovery, and ready-state isolation implemented; automatic retry idempotency remains pending.** Required storage failure is fatal, embedding count/dimensions are checked, paper/chunks commit through one service-role RPC, failed storage compensation is queued, and only ready papers are searchable.

Private-storage failure currently does not stop ingestion, and later failures can leave orphaned files.

- Treat required PDF-storage failure as fatal.
- If any later stage fails, delete the uploaded storage object.
- Insert the paper and chunks atomically where possible.
- Verify embedding count equals chunk count before inserting.
- Make retries idempotent.
- Store an ingestion status such as `processing`, `ready`, or `failed`.
- Never expose or search partially processed papers.

## P1 - Thesis algorithm correctness

### 8. Implement real token-based chunking

The current 800-token size and 100-token overlap are implemented as 3,200 characters and 400 characters.

- Replace character approximation with a documented tokenizer-based splitter.
- Verify no normal chunk exceeds 800 tokens.
- Verify adjacent chunks preserve approximately 100 tokens of overlap.
- Test Unicode, tables, citations, long words, and unusually formatted text.
- Ensure metadata does not unexpectedly consume the content token budget.
- If exact Gemini tokenization is impractical, change the paper to say approximately 800 tokens using a documented tokenizer proxy.

### ✅ 9. ~~Correct the 85% boundary~~

> ✅ **Implemented and verified.** SQL uses `>=`, and 84.99%, 85.00%, and 85.01% boundary behavior is tested.

Change SQL retrieval from:

```sql
similarity > match_threshold
```

to:

```sql
similarity >= match_threshold
```

Add boundary tests:

- 84.99%: not flagged
- 85.00%: flagged
- 85.01%: flagged

### ✅ 10. ~~Define duplication percentage correctly~~

> ✅ **Implemented and verified.** Highest passage similarity, matched-chunk coverage, numeric matched-chunk count, total chunks, matched excerpts, and deterministic advisory verdicts are separate fields. Public values use percentages while internal cosine values remain ratios.

The system currently combines two different concepts:

- cosine similarity of a matching chunk
- percentage of uploaded chunks that found an 85% or greater match

Return and display these separately:

- `highest_similarity`
- `matched_chunk_percentage`
- `matched_chunk_count` (numeric count)
- `matched_chunks` (comparison excerpt list)
- `total_chunks`
- `primary_matched_paper`
- deterministic verdict level

Update the thesis methodology to define the document-level formula precisely.

### ✅ 11. ~~Make duplication department-aware~~

> ✅ **Implemented and verified.** Retrieval, novelty scanning, query-time duplication checks, and upload screening use a server-resolved department. Guests are restricted to CCSICT, ordinary users remain in their profile department, and superadmin selection is validated.

- Add `p_department` to `check_topic_duplication` and every novelty-scanning call.
- Restrict the CCSICT evaluation to CCSICT records.
- Keep ordinary users within their assigned department.
- Allow a superadmin to deliberately select a department.
- Prevent guest-supplied department filters from bypassing server policy.

### ✅ 12. ~~Enforce the relevance threshold server-side~~

> ✅ **Implemented and verified.** Legacy client threshold fields are ignored, validated environment configuration is authoritative, and invalid server values fail startup validation.

- Remove `match_threshold` from the public `ChatRequest`, or ignore client-provided values.
- Make the server authoritative for retrieval threshold, match count, and duplication threshold.
- If thresholds remain configurable, load them consistently from `system_settings`.
- Remove unused settings that are not wired into runtime behavior.

### ✅ 13. ~~Fix follow-up retrieval~~

> ✅ **Implemented and verified.** Ambiguous follow-ups are resolved into standalone retrieval intent, remembered paper IDs are revalidated server-side, retrieval runs again, and previous AI text is never treated as evidence.

Current behavior can generate an answer from chat history when no current chunk passes the threshold.

1. Convert the follow-up plus recent history into a standalone retrieval query.
2. Perform retrieval again.
3. If nothing passes the threshold, return the explicit no-relevant-thesis response.
4. Never treat previous generated text as authoritative source material.

### ✅ 14. ~~Improve context reordering~~

> ✅ **Implemented and verified.** The tested custom `LongContextReorder` equivalent now reorders individual ranked chunks while preserving stable citation IDs and source metadata.

- Use the actual LangChain `LongContextReorder`, or document and test the custom equivalent.
- Reorder individual chunks instead of only grouped papers.
- Preserve citation numbering and paper metadata after reordering.

### ✅ 15. ~~Strengthen citations~~

> ✅ **Implemented and verified.** Sources are chunk-specific and include department, chunk index, page range, section, similarity, and thesis metadata. Legacy locations were backfilled, source cards group evidence cleanly, and structural citation validation performs one repair attempt before a safe fallback.

Add the following metadata to every chunk:

- title
- authors
- year
- track
- department
- page number
- section or chapter
- chunk index

Preserve page boundaries during extraction. A citation should ideally identify the thesis and location, for example:

> [1] Thesis Title - Author, Year, p. 34, Methodology

Add output validation:

- Reject citation numbers outside the source list.
- Require citations for factual research paragraphs.
- Remove unsupported, uncited claims.
- Return no sources when the response used none.
- Test multi-source and follow-up citation behavior.

### ✅ 16. ~~Strengthen hallucination and content-generation controls~~

> ✅ **Implemented and verified.** Deterministic pre-generation blocking, prompt-injection checks, low-temperature factual generation, per-paragraph/list citation coverage, invalid-ID rejection, bounded citation repair, and safe fallback behavior are tested.

- Add deterministic detection for requests to write chapters, assignments, or original academic arguments.
- Return a fixed refusal response before invoking Gemini for prohibited requests.
- Add post-generation checks for unsupported citations.
- Add prompt-injection and document-context injection tests.
- Reduce factual-answer temperature to approximately 0 to 0.2.
- Use structured model output where feasible.

## P1 - Scope and ethical compliance

### ✅ 17. ~~Resolve the indirect-access contradiction~~

> ✅ **Implemented and verified statically and in the UI build.** The signed-URL API, frontend helper, source-card manuscript opening, and Admin Open PDF action are removed. Originals remain private for controlled backend lifecycle operations only.

The thesis says users cannot view or download full PDFs, but administrators can open signed PDF URLs.

Choose one policy:

- Strict compliance: remove `/papers/{id}/url`, `getPaperUrl`, and every Open PDF action.
- Administrative exception: retain the functionality but revise the scope, ethical safeguards, role permissions, and architecture diagram to state that authorized custodial administrators may inspect originals.

The strictest thesis-aligned option is removal.

### ✅ 18. ~~Resolve CCSICT-only versus multi-department scope~~

> ✅ **Implemented.** `THESIS_EVALUATION_DEPARTMENT=CCSICT` controls guests, formal evaluation, fallbacks, runtime UI configuration, and evaluation metadata while validated multi-department administration remains available for future expansion.

Recommended approach:

- Keep multi-department support as a future-ready extension.
- Add a deployment setting such as `THESIS_EVALUATION_DEPARTMENT=CCSICT`.
- Restrict the formal experiment and reported corpus to CCSICT.
- Update the paper to distinguish the CCSICT-only formal evaluation from the system's future multi-department scalability.

Otherwise, remove department management and the superadmin functionality.

### ✅ 19. ~~Resolve the Researcher role~~

> ✅ **Implemented.** No new database role was added. Guest-facing terminology now uses **Guest Researcher**, and the thesis revision companion documents the Figure 8 rename and guest limitations.

Figure 8 includes a Researcher actor, but the implementation does not have a researcher role.

- Add an authenticated `researcher` role with documented permissions, or
- rename the diagram actor to Guest Researcher and document guest limitations.

### 🚧 20. Add manuscript privacy processing

> 🚧 **Deterministic processing implemented; institutional controls remain pending.** Supported PII is redacted, personal sections are excluded where detected, and redaction statistics are stored. Manual review, retention policy, provider terms, and written institutional approvals still require human completion.

The full manuscript is currently stored and indexed without PII redaction.

Add preprocessing for:

- email addresses
- student numbers
- phone numbers
- signatures
- addresses
- participant identifiers
- unnecessary approval-sheet personal data

Also:

- Exclude acknowledgements and personal-profile sections where appropriate.
- Store redaction statistics.
- Manually review redaction failures.
- Define storage retention and deletion rules.
- Document Gemini API retention and model-training terms.
- Obtain and archive written CCSICT and university librarian approval.

The paper should clarify that full text is securely processed internally while only approved metadata and synthesized responses are exposed.

### 21. Create a formal 50-document corpus manifest

Do not impose a permanent 50-document application limit. Instead, create an immutable evaluation manifest containing:

- exactly 50 thesis IDs
- titles, authors, years, and tracks
- source type: scanned or digital
- document hashes
- word, page, and chunk counts
- selection justification
- track distribution
- ingestion date
- preprocessing version
- embedding model and version
- approval and provenance records

This separates the study's fixed experiment from the scalable production archive.

## P1 - Complete Objective 2

### 22. Finish the Golden Dataset

For all 40 queries:

- Replace every placeholder ground truth.
- Add exact supporting thesis and page references.
- Obtain validation from three CCSICT faculty members.
- Record validator signoffs and dates.
- Lock the dataset hash before evaluation.
- Set `validated_by_faculty_panel` to true only after validation.

### 23. Test the deployed production pipeline

Refactor the application and evaluation harness so they import one shared RAG service. The experimental pathway must use:

- production retrieval threshold
- production context reordering
- production prompt
- citation behavior
- no-result handling
- exact configured models

### 24. Correct the baseline comparison

- Use the same Gemini model version for baseline and RAG.
- Set temperature to zero.
- Randomize or alternate execution order.
- Log model IDs, timestamps, latency, token use, and errors.
- Do not give the baseline the RAG context during scoring.
- Treat retrieval-specific context precision as a RAG metric rather than a baseline retrieval metric.
- Add factual or answer correctness against faculty-approved ground truth.
- Run repeated trials if model nondeterminism remains.

### 25. Complete statistical reporting

Generate and preserve:

- per-query scores
- means and standard deviations
- confidence intervals
- Shapiro-Wilk results
- paired t-test or Wilcoxon results
- effect size
- p-value
- significance decision at 0.05
- missing and failed sample accounting
- latency and token comparisons

Store immutable JSON and CSV outputs containing corpus and dataset hashes.

### 26. Remove fabricated or placeholder evaluation figures

Delete the hard-coded `EVAL_DATA` from `rag-thesis-frontend/src/pages/Admin.jsx`.

Replace it with:

- real generated result files or an evaluation-results API
- model, version, and date labels
- dataset validation state
- Evaluation not yet completed when results do not exist

Never display placeholder values as empirical findings.

## P1 - Complete Objective 4

### ✅ ~~27. Improve functional testing~~

> ✅ **Acceptance gate passed.** The hardened backend passed **212/212 tests** with **80.96% coverage**. The enhanced disposable-project security integration passed **1/1**, while the earlier project/key guard suite passed **3/3**. Tests cover approval status, privileged MFA, atomic chat saving, backend-only novelty/chat tables, strict private PDFs, owned avatar storage, readiness, production-project key masking, signup escalation prevention, and protected profile fields. Frontend passes **7/7 tests**, ESLint with **0 warnings**, and the production build.

Current measured backend coverage is **80.96%**, meeting the enforced 80% target.

Add tests for:

- successful upload ingestion
- storage rollback
- embedding failure
- exact 85% boundary
- department isolation
- session ownership
- upload-job ownership
- citation validation
- role-escalation attempts
- RLS behavior
- administrator PDF restrictions
- PII cleaning
- prompt injection
- no-context follow-ups
- malformed PDFs
- live-schema compatibility

Use a disposable Supabase test environment. Existing tests use dummy secrets and do not prove complete integration.

### ✅ ~~28. Execute and document JMeter testing~~

> ✅ **Completed with preserved evidence.** Provider-independent testing produced 900/900 HTTP 200 responses with 0% errors, 83.78 ms average latency, 204.05 ms p95, 286.01 ms p99, and 10.117 requests/second. The rate-limit profile produced 30 HTTP 200 and 30 expected HTTP 429 responses. Three controlled live-Gemini iterations passed with 0% errors and 1,223.67 ms average end-to-end latency. The live smoke used an empty disposable corpus and therefore measures availability/latency, not answer quality.

Run at least three iterations and report:

- average latency
- median latency
- p95 and p99 latency
- throughput
- error rate
- concurrent-user count
- ramp-up duration
- endpoint-specific results
- Gemini rate-limit behavior

Separate the provider-independent API load test from the controlled live Gemini end-to-end test.

### ✅ ~~29. Run SonarQube for real~~

> ✅ **Completed with exported evidence.** SonarQube Community Build 26.7.0.124771, SonarScanner CLI 8.0.1.6346, JDK 25.0.3, and scanner-provisioned JRE 21.0.9 were used. The quality gate passed with zero bugs, vulnerabilities, security hotspots, and new-code issues; reliability, security, and maintainability ratings are A, and duplication is 0.6%. The whole-repository baseline retains 280 legacy code smells and 36.3% combined coverage, while separately enforced backend coverage is 81.85%.

- Configure the required server and token.
- Run the scan on the final evaluation commit.
- Export bugs, vulnerabilities, security hotspots, smells, duplication, and coverage.
- Enforce a quality gate.
- Align Sonar's configured Python version with the Docker runtime. Docker currently uses Python 3.12 while Sonar declares 3.13 and 3.14.

### ✅ 30. ~~Activate LangSmith~~

> ✅ **Implemented and verified.** Three grounded requests against the disposable thesis fixture produced completed privacy-safe traces covering embedding, duplication, retrieval, generation, citation repair, and total latency. Real prompt/completion token counts were recorded while `LANGSMITH_HIDE_INPUTS=true` and `LANGSMITH_HIDE_OUTPUTS=true` prevented prompts, answers, and manuscript text from being exported.

Record:

- retrieval latency
- embedding latency
- generation latency
- total latency
- input and output tokens
- error rate
- trace IDs
- model versions

Ensure traces do not unnecessarily expose full manuscript text.

### ✅ 31. ~~Correct the quality evidence file~~

> ✅ **Implemented and verified.** The evidence file records the verified 220-test backend run, 81.85% coverage, disposable-Supabase integration, Pylint **10.00/10**, frontend tests/lint/build, all JMeter profiles, SonarQube, full-path LangSmith evidence, final citation re-index dry-run, artifact hashes, environments, and execution dates. Ragas is explicitly retained as pending because its Golden Dataset still requires faculty validation.

Maintain `rag-thesis-backend/evaluation/iso25010_evidence.md` with current verified values:

- 220 of 220 backend tests passed
- 81.85% backend coverage; enforced 80% gate passed
- enhanced disposable-Supabase security integration: 1 of 1 passed (earlier guards: 3 of 3 passed)
- Pylint: 10.00/10 on the current backend source tree
- Frontend: 7 of 7 unit tests; ESLint zero errors and zero warnings
- frontend production build passed
- JMeter completed
- SonarQube completed
- LangSmith completed, including generation, citation repair, token usage, and privacy validation
- Ragas pending

Do not call Objective 4 complete until every required instrument has actual results.

## P2 - Code quality and maintainability

### 32. Backend cleanup

- Normalize mixed CRLF and LF endings.
- Remove trailing whitespace.
- Remove unused imports.
- Replace f-string logging with lazy formatting.
- Use exception chaining.
- Break large router functions into services.
- Centralize Supabase repository operations.
- Centralize role and department authorization.
- Replace global in-process caches with bounded and cache-safe implementations.
- Move `test.py` and `test_rpc.py` into documented diagnostic tooling or remove them.
- Add type checking with Pyright or MyPy.

### 33. Frontend cleanup

- Split `Admin.jsx` into smaller modules and components.
- Reduce complexity in `Archive.jsx`, `Upload.jsx`, and `authUtils.js`.
- Add frontend unit tests.
- Add Playwright end-to-end tests.
- Reduce the large Three.js and particle bundle.
- Lazy-load heavy admin charts.
- Remove unused Vite and React starter assets.
- Replace the generic frontend README with project documentation.

### 34. Version and embedding migrations

Update the paper's software tables to current versions.

Because the embedding model changed:

- Record `embedding_model` and `embedding_dimensions` per paper or chunk.
- Prevent searches across incompatible embedding spaces.
- Create a controlled re-embedding command.
- Invalidate and rebuild vector indexes where required.
- Record preprocessing and chunking versions.

## P2 - Reliability and performance enhancements

### 35. Implement durable ingestion jobs

Replace FastAPI background tasks and the in-memory `_JOBS` dictionary with:

- database-backed jobs
- a worker queue
- retries
- idempotency keys
- progress events
- crash recovery
- cancellation
- an audit trail

### 36. Batch duplication retrieval

Current novelty scanning performs one database RPC per chunk. Add a batch RPC that accepts multiple vectors and returns their nearest matches to reduce network round trips.

### 37. Improve retrieval after freezing the thesis experiment

Possible later enhancements:

- hybrid dense and keyword retrieval
- metadata filters for year and track
- follow-up query rewriting
- reranking
- diversity or MMR
- section-aware chunking
- page-aware citations
- retrieval caching
- empirical tuning of top-k and threshold values

Do not introduce these before the baseline thesis experiment has been reproducibly frozen.

### 38. Improve operational security

- Apply route-specific chat and upload rate limits.
- Add security audit events.
- Document secret rotation.
- Add CSP and HSTS in production.
- Add dependency and vulnerability scanning.
- Add file malware scanning.
- Add account lockout and risk controls.
- Test backup and restoration.
- Define database and file retention policies.
- Log signed-URL access if administrative PDF viewing remains.
- Ensure logs do not contain manuscript text or sensitive user data.

## Required paper changes if current enhancements remain

Update the thesis to document:

- Gemini 2.5 Flash and `gemini-embedding-2`
- current dependency versions
- the custom LangChain or LCEL chain instead of legacy `RetrievalQA`
- multi-department architecture
- the superadmin role
- guest access
- sessions and conversation history
- MFA
- configurable role permissions
- background ingestion
- administrator analytics
- profile and avatar functions
- an explicit administrator PDF-access exception, if retained
- the precise document-duplication formula
- real measured evaluation and quality results
- revised architecture and role diagrams

## Features and claims to remove immediately

- Hard-coded Ragas and model-performance results.
- Public administrator account selection.
- Any ability to trust signup role metadata.
- Client-controlled retrieval thresholds.
- Unowned session and upload-job access.
- Administrator PDF viewing if strict indirect access is required.
- Claims that SonarQube, JMeter, LangSmith, or Ragas evaluation is complete when no result exists.
- Placeholder Golden Dataset answers from any formal evaluation or presentation.

## Recommended implementation sequence

### Milestone 1 - Secure foundation

- Correct signup role handling.
- Correct profile RLS.
- Enforce chat-session and job ownership.
- Synchronize the database schema.
- Remove hard-coded evaluation values.

### Milestone 2 - Thesis algorithm compliance

- Implement token-based chunking.
- ✅ ~~Correct the exact 85% boundary.~~
- ✅ ~~Define document-level duplication metrics.~~
- ✅ ~~Enforce department and retrieval thresholds server-side.~~
- ✅ ~~Add page-aware citations and deterministic content restrictions.~~
- ✅ ~~Add grounded follow-up retrieval and chunk-level context reordering.~~

### Milestone 3 - Data and evaluation readiness

- Complete the 50-document corpus manifest.
- Complete and validate the Golden Dataset.
- Add privacy and PII processing.
- Refactor evaluation to use the production RAG pipeline.

### Milestone 4 - Formal thesis evaluation

- Execute Ragas comparison and statistical tests.
- Execute repeated JMeter trials.
- Execute SonarQube.
- Activate LangSmith and collect latency evidence.
- Update the ISO/IEC 25010 evidence using real results.

### Milestone 5 - Engineering improvements

- Raise test coverage.
- Refactor complex frontend and backend modules.
- Implement durable jobs and batched vector operations.
- Add end-to-end, integration, privacy, and security tests.
- Update the thesis paper, tables, and architecture diagrams to the finalized system.
