"""Every word on every slide, and the spoken notes, with no geometry and no colour.

Sources are named beside each block so a panelist's question can be answered with a
file and line. Objectives are verbatim from the manuscript (``thesis_extract.txt``
81-105); the pipeline values from ``rag-thesis-backend/config.py``; the demo script from
``docs/DEFENSE_WALKTHROUGH.md``. Numbers that come from the evidence files are *not*
written here -- ``build.py`` formats them from ``evidence.py`` at build time.
"""

TITLE = 'A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation'
SYSTEM = 'IskAI'
DEFENSE_LEVEL = 'SYSTEM DEFENSE · 2026'
RESEARCHERS = ('Ahron John F. Barlis', 'Carlo Rossi P. Gallardo')
DEGREE = 'Bachelor of Science in Computer Science (BSCS) · Data Mining Track'
COLLEGE = 'College of Computing Studies, Information and Communication Technology'
UNIVERSITY = 'Isabela State University · Echague, Isabela'
REPO = 'github.com/Kakko15/Thesis-V1.2'

THESIS_STATEMENT = (
    'IskAI is a closed-domain research assistant over the CCSICT thesis archive: a student asks in '
    'plain language, the system retrieves the passages that actually answer the question from '
    'approved manuscripts, and the language model may only answer from those passages, with a '
    'citation for every claim.'
)
THREE_PROPERTIES = ('Closed-domain', 'Citation-backed', 'Advisory')

# --- Slide 2 · background and problem (thesis_extract.txt 31-54) ---------------------
PROBLEM_CARDS = (
    ('01', 'Manual navigation',
     'Students browse hardbound volumes and unstructured soft copies in the college library by hand.'),
    ('02', 'Abstract-only search',
     'Rigid keyword systems read only the abstract; semantic context and technical depth are lost. '
     'Static repositories become “data graveyards”.'),
    ('03', 'LLMs cannot see the archive',
     'A general chatbot answers from training data. It cannot say which CCSICT thesis a claim came '
     'from, and it may invent one.'),
    ('04', 'Hypothesis',
     'RAG over the approved CCSICT archive, with three properties:'),
)
DATA_MINING_LINE = ('Why this is a Data Mining thesis: unstructured text mining. Embeddings and cosine similarity '
                    'turn manuscripts into a searchable vector space.')

# --- Slide 3 · objectives, verbatim (thesis_extract.txt 81-105) -----------------------
GENERAL_OBJECTIVE = (
    'To develop and implement a Centralized AI-Powered Thesis Library using a Retrieval-Augmented '
    'Generation (RAG) AI architecture to solve the semantic gap and improve research retrieval '
    'performance in terms of time and management for the College of Computing Studies, Information '
    'and Communication Technology (CCSICT).'
)
SPECIFIC_OBJECTIVES = (
    ('Develop a knowledge retrieval model that integrates Retrieval-Augmented Generation (RAG) and a '
     'Large Language Model (LLM) using the LangChain framework.'),
    ('Compare the performance of the baseline model, or Standard LLM, versus the proposed model '
     '(RAG + LLM) strictly in terms of factual accuracy and hallucination mitigation using real '
     'institutional queries.'),
    ('Apply the developed model (LLM + RAG) for the development of the Centralized AI-Powered Thesis '
     'Library System.'),
    ('Evaluate the system’s internal quality using the ISO/IEC 25010 software product quality standard '
     'through automated software testing tools based on the following criteria:'),
)
OBJECTIVE_4_CRITERIA = ('4.1 Functional Suitability', '4.2 Performance Efficiency', '4.3 Reliability', '4.4 Maintainability')
OBJECTIVE_SHORT = ('The retrieval model', 'The comparison', 'The system', 'ISO/IEC 25010')

# --- Slide 4 · objective 1, frozen constants (config.py 16-115, retriever.py 645-646, chat.py 1715)
FROZEN_CONSTANTS = (
    ('Chunking', '800 tokens · 100 overlap · Literal[…], not env-overridable'),
    ('Tokenizer', 'cl100k_base as a fixed, documented proxy'),
    ('Embedding', 'models/gemini-embedding-001 · 768 dimensions · vector(768)'),
    ('Retrieval', 'match_chunks · cosine ≥ 0.30 · candidate pool 15 · department-scoped in SQL'),
    ('Rerank', '0.75 cosine + 0.25 lexical · ≤ 3 chunks per thesis · 1 for corpus-wide'),
    ('Context', 'exactly 5 blocks · LongContextReorder'),
    ('Generation', 'gemini-3.6-flash · iskai-prompt-v4 · 2,000-token ceiling'),
    ('Validation', 'structural citation check · one bounded repair · grounded fallback'),
)
LATENCY_CHIPS = (
    'p95 204 ms · application-only (2026-07)',
    'Grounded answer 4.5–11.4 s · four live queries',
)
CHAT_CALLOUTS = ('Inline [n] markers, validated against the blocks actually sent',
                 'Evidence sources: title, authors, page, section, match — metadata only',
                 'No PDF link anywhere in the response')

# --- Slide 5 · refusal guard and grounding controls (DEFENSE_WALKTHROUGH.md 113-127) ----
GUARD_HEADLINE = 'The guard blocks generation requests, not research questions.'
GUARD_PAIR = (
    ('Write me a chapter 2 on YOLO-based object detection for campus security', 'Refused'),
    ('What methodology did the CCSICT theses on YOLO-based object detection use?', 'Answered, with citations'),
)
GROUNDED_QUESTION = 'Which CCSICT theses used YOLO-based object detection, and what did each evaluate?'
GUARD_EVIDENCE = '40-case matrix · tests/test_rag_controls.py::TestRequestGuard · runs inside the backend gate'
CONTROLS = (
    ('01', 'Threshold 0.30', 'Below it the system reports “no qualifying archive evidence” instead of answering.'),
    ('02', 'Context-only prompt', 'The model may answer only from the five retrieved blocks; general knowledge is out of bounds.'),
    ('03', 'Citation validation', 'Every [n] must point at a block actually sent; one bounded repair attempt.'),
    ('04', 'Grounded fallback', 'If repair fails the reply is dropped for a grounded summary, never patched to look done.'),
)
CONTROLS_FOOTNOTE = 'Citation validation is structural, not semantic. It proves validity and coverage, not entailment; faculty verification remains part of the process.'

# --- Slide 6 · objective 2 (numbers come from evidence.py) ------------------------------
OBJ2_HEADLINE = 'Pooled is significant. The stratum the paper quotes is not.'
OBJ2_WHY = ('Eight of the sixteen present queries returned the grounded fallback: retrieval was healthy in all '
            'eight (five blocks, cosine 0.67–0.74), and structural citation validation discarded the answer.')
OBJ2_INSTRUMENT = ('Ragas Answer Correctness, baseline → RAG · 40 institutional queries · 12-manuscript released corpus · '
                   'three-member CCSICT panel sign-off 2026-09-13 · Context Precision is RAG-only')

# --- Slide 7 · objective 3 (Archive.jsx, Novelty.jsx, novelty.py 48-55, upload router) --
SYSTEM_CALLOUTS = (
    ('Indirect access', 'No PDF URL, storage path, or full text in any API response; the archive is metadata only.'),
    ('Durable ingestion', 'Staged, queued under a worker lease, committed atomically. Nothing half-indexed is ever searchable.'),
    ('Novelty verdicts', 'clear (0 matched) · review_suggested (< 50 %) · high_overlap (≥ 50 %) · exact_duplicate. Advisory: a human decides.'),
    ('Duplication screen', '≥ 0.85 cosine at upload and at query time; the matched thesis is named with its percentage.'),
    ('Live archive today', '{ARCHIVE_LINE}'),
)

# --- Slide 8 · architecture (paper Fig. 8; build_corrections.py 222-235; wizardSteps.js) --
LAYERS = (
    ('User Interface Layer', 'React 19 · Vite 8 · Tailwind v4 · guest researcher, student, faculty, admin, superadmin'),
    ('Application Layer', 'FastAPI · LangChain Expression Language · role and department boundary enforced in Python · durable leased job queue'),
    ('Embedding Layer', 'gemini-embedding-001 (768) · gemini-3.6-flash for grounded chat · gemini-3.5-flash-lite for novelty verdicts'),
    ('Data Storage Layer', 'Supabase Postgres + pgvector vector(768) · Auth · private Storage bucket · transactional RPC functions'),
)
INGEST_STAGES = ('Secure source', 'Malware scan', 'Extract & clean', 'Chunk (800 tokens)', 'Embed (768d)', 'Screen novelty (85 %)', 'Index vectors')
QUERY_STAGES = ('Embed query', 'match_chunks ≥ 0.30', 'Hybrid rerank', '5 blocks · reorder', 'Gemini 3.6 Flash', 'Validate citations')
CROSS_CUTTING = ('RLS-backed auth', 'Privileged MFA (aal2)', 'Rate limiting', 'ClamAV scanning')
TWO_PROCESSES = 'Two processes from one image: the API and the ingestion worker. The API never runs the pipeline inline.'

# --- Slide 9 · ISO/IEC 25010 (static rows must occur in iso25010_evidence.md; see build) --
ISO_STATIC = {
    'axe': 'axe-core 4.12.1 · WCAG 2.2 AA · 0 blocking, 0 advisory across 55 scans (2026-08-04)',
    'p95': 'p95 204 ms',
    'p95_note': 'application-only, provider latency excluded (2026-07)',
    'latency': 'Grounded answer 4.5–11.4 s, four live queries (2026-08-31)',
    'sonar': 'SonarQube 26.7.0.124771 · 2026-09-01',
    'sonar_detail': '0 bugs · 0 vulnerabilities · 0 hotspots · A / A / A',
    'fault': '60 requests in 14 s, zero 5xx, under provider exhaustion',
    'dup': 'Duplication 1.3 %',
    'lock': '98 packages hash-locked · 2,353 SHA-256 hashes',
    'audits': 'pip-audit 0 advisories (CI) · npm audit 0',
}
ISO_QUOTED = ['26.7.0.124771', 'p95 204 ms', '55 scans', 'axe-core 4.12.1', '60 requests in 14 seconds', 'Duplication 1.3%']
DELTAS_CAPTION = 'Objective 2 in detail: every one of the 40 paired queries behind the pooled effect.'

# --- Slide 10 · limitations (DEFENSE_WALKTHROUGH.md 276-343) ----------------------------
LIMITATIONS = (
    ('Load figures are provider-bound', 'Chat throughput was measured on a synthetic corpus on the free tier; the ceiling reached was the provider’s rate limit, not the application’s.'),
    ('A result, not yet a corpus lock', 'Objective 2 has a formal result; the PI-08 corpus lock, its receipt, and four institutional approvals are outstanding. The panel validated the instrument, not the release.'),
    ('Context Precision is RAG-only', 'A baseline with no retriever has no contexts to rank. The headline comparison is paired Answer Correctness.'),
    ('Citation checks are structural', 'They prove validity and coverage, not entailment between claim and source.'),
    ('PII redaction is best-effort', 'A deterministic regex pass plus mandatory human privacy review; not a guarantee.'),
    ('Single-process API', 'Six pieces of state live in process memory, so the API cannot yet be replicated. Documented as the first scaling task.'),
    ('Data Privacy Act work is incomplete', 'NPC registration and a user-facing privacy notice are outstanding; retention enforcement is deliberately disabled pending approval.'),
)

# --- Slide 11 · live demo playbook (README “Running the stack”; walkthrough §3, §8, §9) --
DEMO_STAGES = (
    ('01', 'Boot', ('docker start isu-clamav → API :8000 → ingestion worker → frontend :5173',
                    'Confirm /health, /ready, /health/worker', 'Turnstile blank · wait 60 s on provider quota')),
    ('02', 'Grounded query', ('Landing → “Try as Guest Researcher”', 'Ask which CCSICT theses used YOLO-based object detection',
                              'Narrate the 5–12 s as generation; retrieval is milliseconds')),
    ('03', 'Guard & novelty', ('“Write me a chapter 2 …” → refused', '“What methodology …” → answered, cited',
                               'Sign in → Novelty Check → verdict. Say: advisory.')),
    ('04', 'Audit', ('Archive → indirect-access pill, badges, a card', 'Research Administration → Overview · Upload history · System Management · Operations',
                     'python -m scripts.release_fingerprint')),
)
DEMO_FAILURES = (
    ('“IskAI has reached the research AI service usage limit”', 'Provider quota, not a crash. The system detects exhaustion and returns an explicit notice.'),
    ('“Search completed · no qualifying archive evidence.”', 'Correct behaviour: the question fell below 0.30. Ask something indexed.'),
)

# --- Slide 12 · rubric compliance matrix (master prompt Part 5.2; no institutional file) --
RUBRIC_NOTE = ('No institutional rubric exists in the repository. Criteria and weights follow the defense package '
               'specification; grouped under Technical Validity · UI Demonstration · AI Pipeline · Defense Q&A.')
RUBRIC_ROWS = (
    ('System functionality and completeness', '30', 'All four objectives realized in the running system; live demo of chat, archive, novelty, upload, administration',
     'Slides 4–9 · live demo', 'EVIDENCED'),
    ('Technical depth and soundness of the AI pipeline', '25', 'Frozen constants typed Literal[…]; four grounding controls; 40-case refusal-guard matrix',
     'Slides 4–5, 8 · config.py · tests/test_rag_controls.py', 'EVIDENCED'),
    ('Evaluation rigour and honesty of results', '20', '40-query panel-validated instrument; pooled and present reported side by side; ISO 25010 gates re-run 2026-09-14',
     'Slides 6, 9 · iso25010_evidence.md · run 5e8fb7f21db6', 'EVIDENCED · present NS'),
    ('Presentation quality and clarity', '15', 'This deck; four-stage demo playbook; failure narration prepared',
     'Slide 11 · docs/DEFENSE_WALKTHROUGH.md', 'PREPARED'),
    ('Mastery under questioning', '10', 'Limitations stated before they are asked; rapid-fire answers rehearsed',
     'Slides 10, 14 · walkthrough §7', 'PREPARED'),
)

# --- Slide 13 · chapter 1 dossier and recommendation form (master prompt Part 5.1, 5.3) --
DOSSIER_ITEMS = (
    ('Title page', 'Exactly as the manuscript: title, college, university, degree and track, researchers'),
    ('1.2 Objectives of the Study', 'General objective, then the four specific objectives with 4.1–4.4'),
    ('System architecture', 'Figure 8, four layers — regenerated from paper/Figure8_System_Architecture.build.py'),
    ('AI pipeline', 'Figure 1, Algorithmic Flow of Retrieval-Augmented Generation — paper/Figure1_RAG_Architecture.svg'),
)
FORM_FIELDS = (
    ('Header', 'ISU · CCSICT · Panel Recommendation Form'),
    ('Pre-filled', 'Thesis title · researchers · degree and track'),
    ('Panel', 'Date · panel member · role: Chair / Member / Adviser'),
    ('Table', 'No. · Section · Recommendation · Action and date (10+ rows)'),
    ('Verdict', 'Accepted · minor · major revisions · resubmit'),
    ('Signatures', 'Panel member, printed name · date · adviser’s noting'),
)

# --- Slide 14 · Q&A -------------------------------------------------------------------
QA_INVITATIONS = ('Ask the live system a question of your own',
                  'Perturb a parameter: the 0.30 threshold, the 0.85 screen',
                  f'Open the repository: {REPO}')

# --- Slide 15 · closing -----------------------------------------------------------------
DEFENDED = 'SYSTEM THESIS DEFENDED'
THANKS = 'Thank you'

# --- Speaker notes, spoken sentences ------------------------------------------------------
NOTES = {
    1: ('Good day to the panel. We are Ahron John Barlis and Carlo Rossi Gallardo, BSCS Data Mining Track, '
        'and this is the system defense of A Centralized AI-Powered Thesis Library Using Retrieval-Augmented '
        'Generation, which we call IskAI. In one sentence: a student asks in plain language, the system retrieves '
        'the passages that answer from approved CCSICT manuscripts, and the model may only answer from those '
        'passages, with a citation for every claim. Everything after this slide is evidence for that sentence.'),
    2: ('Today a CCSICT student navigates hardbound volumes and soft copies by hand, and the keyword search that '
        'exists reads only the abstract. It cannot capture semantic context, so literature reviews are slow and topic '
        'duplication is caught late. A general chatbot does not fix this: it cannot tell you which thesis a claim came '
        'from. Our hypothesis is retrieval-augmented generation over the approved archive, with three properties we '
        'will keep repeating: closed-domain, citation-backed, advisory. This is a data mining thesis because the '
        'mining is over unstructured text: embeddings and cosine similarity, not tables.'),
    3: ('The general objective is read exactly as the manuscript states it. The four specific objectives are the '
        'spine of the deck: the retrieval model, the comparison, the system, and ISO 25010. Each card carries a '
        'thumbnail of the evidence that proves it, and the numbered rail in the corner tells you which objective '
        'you are watching being proved at any moment.'),
    4: ('Objective one. This is a real grounded answer from the running system, captured on 14 September, about the '
        'archive’s YOLO-based object-detection theses: inline citation markers and the evidence sources beneath, metadata '
        'only, no PDF link. The constants '
        'on the left are frozen: 800-token chunks with 100 overlap because a paragraph stays whole and a claim at a '
        'boundary appears in at least one chunk; cl100k_base because Google publishes no Gemini tokenizer, so we fixed '
        'a documented proxy rather than guess; 768 dimensions; a 0.30 threshold; a pool of fifteen reranked to '
        'exactly five blocks. Chunk size, overlap and dimensions are typed as Literal in config.py, so no environment '
        'variable can move them. Application-only latency is p95 204 milliseconds; the five to twelve seconds you '
        'will see in the demo is the language model generating, and we measured that at 4.5 to 11.4 seconds.'),
    5: ('The hardest problem in this project was making the assistant refuse correctly. Ask it to write a chapter '
        'two and it refuses, because it is a retrieval assistant, not a ghostwriter. Ask what methodology the '
        'YOLO-based detection theses used and it answers with citations. An earlier guard blocked the second question too, which is '
        'exactly the question the archive exists to answer; the fix is covered by a 40-case matrix in '
        'test_rag_controls that runs inside the backend gate. Four independent controls stop hallucination: the '
        'threshold, the context-only prompt, structural citation validation with one repair, and a grounded '
        'fallback. We say plainly that validation is structural, not semantic.'),
    6: ('Objective two, and this is the slide the defense turns on. The instrument is forty institutional queries '
        'over the twelve released manuscripts, with every ground truth validated by a three-member CCSICT panel on '
        '13 September. Pooled, Answer Correctness rose from 0.2169 to 0.3024, paired t-test p equals 3.222 times ten '
        'to the minus five, Cohen’s d of 0.74. But section 3.2.5 of our paper committed in advance to quoting the '
        'present stratum, the sixteen questions the archive can actually answer, because it is the only stratum with '
        'a corpus-derived ground truth. On present the gain is 0.060 with p equals 0.1257: not significant. The '
        'pooled significance is carried by the absence strata, which measure refusal behaviour, which is exactly what '
        'they exist to measure. We know why present underperforms: eight of its sixteen queries returned the grounded '
        'fallback after citation validation discarded an answer it could not cite, even though retrieval was healthy. '
        'The system chose to refuse rather than cite something it could not verify. That is the design working, at a '
        'measurable cost to the score.'),
    7: ('Objective three is the system around the model. The archive is metadata only: no API response ever '
        'carries a PDF URL, a storage path, or full text, and automated tests assert it. Uploads are staged, queued, '
        'and committed atomically by a separate worker, so a half-indexed thesis can never appear in search. The '
        'novelty check reports two numbers, highest passage similarity and matched-chunk coverage, and a tiered '
        'verdict that is advisory: the system never auto-rejects a topic; a human adviser decides. {ARCHIVE_NOTE}'),
    8: ('Four layers, as in Figure 8 of the paper. Two processes are built from one image: the API and the ingestion '
        'worker. Ingestion runs through seven stages, secure source to index vectors, and the query path runs embed, '
        'match at 0.30, rerank, five blocks, reorder, generate, validate. Authentication with row-level security, '
        'privileged multi-factor access, rate limiting and malware scanning cut across all four layers.'),
    9: ('Objective four, the four ISO 25010 characteristics, each with its own instrument and its own date. The '
        'test counts were re-run today at the current commit and recorded in the evidence file. SonarQube is the '
        '1 September scan, accessibility the 4 August audit, and the p95 figure is application-only from July. The '
        'sixty requests in fourteen seconds with zero server errors is fault-tolerance evidence, not throughput. '
        'Below is Objective 2 query by query: twenty-nine of forty paired differences favour RAG. One gap we '
        'volunteer: the release fingerprint does not yet hash services/citations.py.'),
    10: ('Before you ask: seven limitations. Load figures are provider-bound. Objective 2 has a result but the '
         'corpus lock does not. Context Precision is RAG-only. Citation checks are structural. PII redaction is '
         'best-effort. The API is single-process. And the Data Privacy Act work is not complete. None of these touch '
         'the frozen, evaluated pipeline.'),
    11: ('We will now switch to the live system in four stages: boot, a grounded query as a guest, the guard and a '
         'novelty verdict, then the administration surfaces. If the provider quota trips, the system returns an '
         'explicit notice rather than an error, and we will say so.'),
    12: ('This matrix maps the rubric criteria to where each is proven. The badges say evidenced with a pointer, '
         'not a self-graded score, and the evaluation row carries the present-stratum caveat in the badge itself.'),
    13: ('The printed dossier holds the title page, the objectives, the four-layer architecture and the RAG flow, '
         'and the panel has a recommendation form with numbered rows for revisions and the overall verdict.'),
    14: ('We are open for examination. Ask the live system anything, ask us to perturb a threshold, or open the '
         'repository: the formal run, the quality gate, and the coverage figure are all reproducible.'),
    15: ('Thank you to the panel, to our adviser, and to CCSICT for releasing the corpus that made the comparison '
         'possible.'),
}
