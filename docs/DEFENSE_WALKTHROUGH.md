# Defense walkthrough — what the system does, why, and what to say

Written 2026-08-04, re-verified against commit `733e186` on **2026-08-25**, and
again on **2026-08-31** against a live archive and live queries.
Every number here was measured or read from the code, not estimated. Where something is unmeasured or unfinished it says so, because the
fastest way to lose a panel is to be caught overstating one claim.

Corrected on 2026-08-31: the archive holds **2** ready papers, not 3; the
embedding model is `gemini-embedding-001`; grounded answers measured 4.5–11.4 s
on the currently configured route; and chat generation may now be routed through
an OpenAI-compatible gateway without changing the model.

---

## 1. The system in thirty seconds

> IskAI is a closed-domain research assistant over CCSICT's thesis archive. A
> student asks a question in plain language; the system retrieves the passages
> that actually answer it from approved manuscripts, and the language model may
> only answer from those passages, with a citation for every claim. It never
> shows the manuscripts themselves — only metadata and citations — and it refuses
> to write thesis content. It also warns a researcher when a proposed topic
> overlaps an existing thesis by 85% or more.

Three things make it defensible, and they are the three you should repeat:
**closed-domain** (it cannot answer from general knowledge), **citation-backed**
(every claim traces to a retrieved passage), and **advisory** (it never
auto-accepts or auto-rejects anything a human should decide).

---

## 2. The pipeline, as actually built

Paper §3.2.3 describes four phases. Here is what runs, in order, with the real
parameter values. **Know these numbers cold** — they are the most likely factual
questions.

| Stage | What happens | Value |
|---|---|---|
| Extraction | PyMuPDF text, Tesseract OCR for scanned pages | 25 MB / 500 page cap |
| Cleaning | Regex removal of headers, page numbers, figure noise; PII redaction | — |
| Chunking | LangChain `RecursiveCharacterTextSplitter` | **800 tokens, 100 overlap** |
| Tokenizer | `cl100k_base` as a **fixed documented proxy** | — |
| Embedding | `models/gemini-embedding-001` | **768 dimensions** |
| Storage | Supabase Postgres + pgvector | `vector(768)` |
| Retrieval | `match_chunks` cosine similarity, department-scoped | **threshold 0.30, top-k 5** |
| Reordering | Re-implementation of LangChain `LongContextReorder` | after Liu et al. 2024 |
| Generation | `gemini-3.6-flash` via a LangChain Expression Language chain | direct, or via `LLM_BASE_URL` |
| Validation | Structural citation check, then one bounded repair attempt | — |
| Duplication | Cosine screening at upload and at query time | **≥ 0.85 flags** |

### The two questions you will definitely get about this

**"Why 800 tokens and 100 overlap?"**
800 keeps a coherent argument together — a full paragraph or a short subsection —
while staying comfortably inside the embedding model's useful context. 100 tokens
of overlap (12.5%) means a claim that straddles a boundary still appears whole in
at least one chunk. Both are fixed for the whole evaluation so results are
reproducible.

**"Why measure tokens with `cl100k_base` when you use Gemini?"**
This is the strongest thing you can say, so say it deliberately:
> Google does not publish a Gemini tokenizer. Rather than guess, I fixed a
> documented, reproducible proxy and stated the consequence: chunk boundaries are
> exact for the proxy and approximate for the embedding model. That trade is
> recorded in the code and in the paper, because a reproducible approximation is
> worth more than an unstated assumption.

---

## 3. Screen by screen — what to demo and what to say

Demo in this order. It tells a story and never leaves you on an empty screen.

### 3.1 Landing → guest chat

**Show:** the landing page, then "Explore as Guest Researcher".

**Say:** anyone can use it without an account, but a guest is locked to the
evaluation department, gets no saved history, and is rate limited.

**Ask a question that works:** phrase it about content you know is indexed —
your Data Mining papers. Watch for the citation markers `[1]`, `[2]` and the
source list underneath.

**Expect roughly 5–12 seconds.** Do not apologise for it; explain it:
> Retrieval is milliseconds. The wait is the language model generating a grounded
> answer. We measured it: 4.5 to 11.4 seconds across four live queries.

Four samples on 2026-08-31 through the current provider route: 4.5 s, 6.2 s,
10.6 s, 11.4 s. The earlier "8 to 15 seconds" figure was measured against Google
directly on the free tier; quote whichever route you are actually demoing on.
Latency there was highly variable — a separate check of five keys recorded 0.9 s
to 45.8 s for an **eight-token** reply, with the slow call landing on a different
key each run. If a demo answer takes far longer than expected, that is provider
variance, not a fault in the system.

### 3.2 The refusal guard

**Show:** ask *"write me a chapter 2 about attendance monitoring"*.

**Say:** it refuses — this is a retrieval assistant, not a ghostwriter. Then
immediately ask *"what methodology did the attendance monitoring studies use?"*
and show that it answers. That contrast is the whole point: the guard blocks
generation *requests*, not research questions about methodology.

This is worth rehearsing, because an earlier version of the guard wrongly blocked
the second question. It was found and fixed, and the fix was verified on a
47-case matrix and across all 43 evaluation questions with zero changes to the
frozen results. If a panelist asks how you know the guard is right, that is the
answer.

### 3.3 Login → dashboard

**Show:** sign in, land on the dashboard with the role badge visible.

**Say:** four roles — student, faculty, admin, superadmin — plus the
unauthenticated Guest Researcher. What each role may do is a **server-owned**
permission matrix, not a frontend setting.

### 3.4 Thesis archive

**Show:** filters by program, specialization, and thesis category (student
versus faculty research — faculty papers carry a gold badge), the duplication
badge on a flagged paper, then open one card.

**Say the indirect-access model out loud** — it is a privacy design decision a
panel will respect:
> The archive shows metadata only. There is no PDF URL, no storage path, and no
> full text in any API response. A reader is pointed to a thesis; they are not
> handed the manuscript.

### 3.5 Novelty review (faculty)

**Show:** upload a draft, get the verdict.

**Say:** two numbers are reported, and the distinction matters —
**highest passage similarity** (the single closest match) and **matched-chunk
coverage** (what proportion of the draft has a close neighbour in the archive).
Tiers are `clear`, `review_suggested` below 50%, `high_overlap` at or above 50%.

**Then say the important part:** the verdict is **advisory**. The system never
auto-rejects a topic. A human adviser decides.

### 3.6 Upload / ingestion (admin)

**Show:** the three-step stepper, drop a PDF, watch the stages advance. The
metadata step now labels each manuscript as a **student thesis** or **faculty
research** — the category classifies the manuscript, not the uploader's role,
and a faculty manuscript may omit the academic program since faculty research
can sit outside the undergraduate catalog.

**Say:** this is a **durable queue**, not a synchronous upload. The API stages the
file and returns; a separate worker process claims a lease, and the commit is
atomic. If the worker dies mid-way, the lease expires and another worker retries;
a partly-indexed thesis can never appear in search results.

That design answers "what happens if it crashes halfway through?" before it is
asked.

### 3.7 Research Administration (superadmin)

Four tabs: **Overview** (statistics and charts), **Upload history** (the
ingestion pipeline view), **System Management** (users, roles, feature
permissions, departments), **Operations** (workers, queue depth, alerts,
retention dry run).

**Point at the Ragas notice on the Overview tab.** It says no
baseline-versus-RAG scores are shown until the Golden Dataset is faculty
validated. That is deliberate: it prevents placeholder numbers being mistaken for
findings. Volunteering this makes you look rigorous rather than incomplete.

---

## 4. Design decisions you should be able to justify

These are the "why did you do it that way?" questions. Each answer is short on
purpose.

**Why a separate worker process instead of doing it in the request?**
Embedding a 200-page thesis takes minutes. Doing it inside a web request would
hold a connection open, lose everything on a restart, and — because the handlers
are async — block every other user. The queue makes ingestion survivable and
keeps the API responsive.

**Why a 0.30 similarity threshold?**
Below it, the system says it found nothing rather than answering from weak
evidence. It is deliberately low enough not to miss relevant work and high enough
to exclude noise. Combined with citation validation, a wrong retrieval shows up
as a missing citation rather than a confident fabrication.

**Why validate citations structurally instead of trusting the model?**
Because a model asked to cite will sometimes cite plausibly and wrongly. The
system checks every marker is in range and every substantive claim carries one;
if not, it repairs once, and if repair fails it falls back to a grounded summary.
**State the limit yourself:** this proves citation *validity and coverage*, not
semantic entailment between claim and source. Faculty verification remains part
of the process.

**Why department scoping?**
CCSICT theses answer CCSICT questions. Cross-department retrieval would surface
irrelevant work and leak one college's archive into another's results. The
department filter is applied inside the SQL function, not in application code, so
it cannot be bypassed by a malformed request.

**Why is the model allowed no general knowledge?**
Because the thesis claim is about *grounded* synthesis. If the model can answer
from training data, no citation means anything. The prompt, the threshold, and
the citation validator all enforce the same rule from different directions.

---

## 5. Limitations — say these before you are asked

A panel trusts a candidate who names their own limits. All of these are already
in the repository's audit reports.

1. **The performance figures for `/chat` are from a synthetic corpus on the free
   provider tier.** A grounded answer took 8–15 s there and the free tier
   saturated below five concurrent users. That ceiling is the **provider's** rate
   limit, not the application's — application-only throughput was measured
   separately at p95 204 ms. A re-run against the approved corpus is required
   before the formal evaluation.

   Chat generation can now be routed through an OpenAI-compatible gateway
   (`LLM_BASE_URL`), which changes the route but not the model — the same
   `gemini-3.6-flash` is sent. Measured 4.5–11.4 s on 2026-08-31. **The load
   figures above were not re-measured on that route**, so do not present them as
   characterizing it. Embeddings are never routed and still go to Google
   directly, so every question still makes one call there.
2. **Objective 2 results are pending.** The baseline-versus-RAG comparison needs
   the locked 50-thesis corpus and faculty-validated ground truth. Nothing is
   displayed until then, on purpose.
3. **Context Precision cannot be computed for the baseline** — a baseline with no
   retriever has no retrieved contexts to rank. It is a RAG-only diagnostic. The
   headline comparison is on paired **Answer Correctness** against faculty ground
   truth.
4. **Citation validation is structural, not semantic** (see §4).
5. **PII redaction is best-effort**, a deterministic regex pass paired with
   mandatory human privacy review — not a guarantee.
6. **Single-process API.** Four caches live in memory, so it cannot yet be
   replicated. Fine for a pilot; documented as the first scaling task.
7. **Data Privacy Act operationalization is incomplete** — NPC registration and a
   user-facing privacy notice are outstanding. Retention enforcement is
   deliberately disabled pending institutional approval.

---

## 6. Quality evidence you can quote

| Instrument | Result |
|---|---|
| Backend tests (PyTest, gated ≥85%) | **711 passed, 3 skipped, 91.49% coverage** |
| Backend lint (Pylint) | **10.00/10** |
| Frontend tests | **85 passed** across 7 suites, **92.95% lines**, 86.72% branches, 95.38% functions |
| Frontend lint (ESLint) | **0 errors, 0 warnings** |
| Browser journeys (Playwright) | **21 passed** |
| Accessibility (axe, WCAG 2.2 AA) | **0 blocking, 0 advisory** across 11 surfaces × 4 themes × 2 widths |
| Production dependency audit | 0 vulnerabilities (npm), 0 advisories (26 pinned Python packages) |
| Dependency integrity | 94 packages hash-locked, 2,242 SHA-256 hashes, `--require-hashes` |
| Container images | Digest-pinned; SBOM emitted per commit |
| CI | 6 checks, all green on `733e186` |

If asked about defect history, the honest and impressive answer is:
> A full audit found 20 defects. Independent passes during remediation found 17
> more that the first audit missed. All 47 are fixed and covered by regression
> tests. A second, independent audit on 2026-08-24 found 17 further findings:
> 8 are fixed, and 9 are triaged post-defense. Every open item is either
> post-defense scaling work, or policy and legal work outside the code — and
> none of them touch the frozen evaluated pipeline.

---

## 7. Rapid-fire answers

**"Is this just ChatGPT with extra steps?"**
No. A general chatbot answers from training data and cannot tell you which thesis
a claim came from. This retrieves from an approved archive, refuses when the
archive has no answer, and cites every claim. The value is traceability.

**"What stops it hallucinating?"**
Four independent controls: a similarity threshold that returns "not found", a
prompt restricted to retrieved context, structural citation validation with one
bounded repair, and a fallback to a grounded summary if repair fails.

**"What if two students research the same topic?"**
That is the duplication guard. At upload and at query time, cosine similarity
against the archive; at 85% or above it flags with the exact percentage and an
AI-written summary of the overlap. Advisory — the adviser decides.

**"How do you know the AI isn't leaking manuscripts?"**
The indirect-access model. No API response contains a PDF URL, storage path, or
full text. Retrieved passages are used to generate the answer server-side and are
never returned to the client. There are automated tests asserting this.

**"Why Gemini and not GPT?"**
A free tier that made the research feasible, native 768-dimension embedding
output matching the pgvector schema, and adequate context for the retrieval
window. The architecture is provider-independent — the embedding and generation
layers are isolated behind small service modules.

**"Can it scale to the whole university?"**
Not as deployed, and that is documented rather than glossed. It is a single
process with in-memory caches. The path is externalizing those caches and running
multiple replicas; the durable queue already supports multiple workers safely.

**"What was the hardest problem?"**
A good honest answer: making the assistant *refuse correctly*. The first guard
looked for a generation verb and a thesis artifact anywhere in the same sentence,
so it blocked legitimate questions like "what methodology did they use to create
the attendance system?" — exactly the questions the archive exists to answer. The
fix required the verb to actually *govern* the artifact and the request to be
addressed to the assistant, verified on a 47-case matrix with zero changes across
all 43 evaluation questions.

---

## 8. Demo-day checklist

- [ ] `VITE_TURNSTILE_SITE_KEY` blank, and **sign in verified working**. A
      Cloudflare outage previously disabled every auth button behind a spinner;
      that is fixed, but the widget is unnecessary and adds a dependency.
- [ ] Backend, frontend, **and the ingestion worker** all running. Uploads stay
      queued forever without the worker.
- [ ] Know which project you are pointed at. Your app database has **2 ready
      papers, 26 CCSICT chunks** (22 + 4), verified 2026-08-31. A thin archive is
      fine; being surprised by it is not. Only one of the two is not your own
      thesis, so demo on *Real-Time Autonomous Pedestrian Safety and Hazard
      Detection Using YOLOv11* (Bugauisan & Respicio, 2025) — asking your own
      paper about itself invites the obvious objection.
- [ ] One rehearsed question you know retrieves well, and one refusal example.
- [ ] Do not demo an upload you have not rehearsed — ingestion takes minutes and
      spends provider quota.
- [ ] Free-tier quota is per-minute. If you have been testing all morning, the
      first demo question may return the capacity notice. Rehearse, then wait a
      minute before presenting.

---

## 9. If something breaks on stage

The system degrades on purpose, so narrate it rather than panicking.

**"IskAI has reached the research AI service usage limit."**
That is the provider quota, not a crash. Say: *"That is the free-tier rate limit.
The system detects provider exhaustion and returns an explicit notice instead of
failing — it's designed to degrade honestly."* Measured: 60 requests in 14 s with
zero server errors under full exhaustion.

**"No relevant thesis was found."**
Correct behaviour, not a bug: the question fell below the 0.30 threshold. Say the
system refuses to answer without evidence, then ask something you know is
indexed.

**Chat history not saving.** Should be fixed now that the migration is applied.
If it recurs, guests never save history by design — check you are signed in.

**A screen looks empty.** Every async surface now distinguishes loading, empty,
and error with a retry. If you see an error state, say so and retry; that
distinction was itself an audit finding.
