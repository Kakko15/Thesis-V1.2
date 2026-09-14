"""Every word on every slide, and the spoken notes, with no geometry and no colour.

Sources are named beside each block so a panelist's question can be answered with a file and
line. Objectives are verbatim from the manuscript (``thesis_extract.txt`` 81-105); the pipeline
values from ``rag-thesis-backend/config.py``; the demo and limitation notes from
``docs/DEFENSE_WALKTHROUGH.md``. Numbers that come from the evidence files are *not* written
here -- ``build.py`` formats them from ``evidence.py`` at build time.

Eleven slides: 1 title · 2 background · 3 objectives · 4 objective 1 · 5 refusal guard ·
6 objective 2 · 7 objective 3 · 8 architecture · 9 objective 4 · 10 Q&A · 11 closing. The
limitations and the demo order, which had slides of their own in the first cut, now live in the
Q&A slide's speaker notes so the presenter still has them in hand.
"""

TITLE = 'A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation'
SYSTEM = 'IskAI'
DEFENSE_LEVEL = 'SYSTEM DEFENSE · 2026'
RESEARCHERS = ('Ahron John F. Barlis', 'Carlo Rossi P. Gallardo')
DEGREE = 'Bachelor of Science in Computer Science (BSCS) · Data Mining Track'
COLLEGE = 'College of Computing Studies, Information and Communication Technology'
UNIVERSITY = 'Isabela State University · Echague, Isabela'
REPO = 'github.com/Kakko15/Thesis-V1.2'
THREE_PROPERTIES = ('Closed-domain', 'Citation-backed', 'Advisory')

# --- Slide 2 · background and problem (thesis_extract.txt 31-54) ---------------------
PROBLEM_CARDS = (
    ('01', 'Manual navigation', 'Students browse hardbound volumes and unstructured soft copies in the college library by hand.'),
    ('02', 'Abstract-only search', 'Keyword search reads only the abstract; semantic context is lost, and repositories become “data graveyards”.'),
    ('03', 'LLMs cannot see the archive', 'A general chatbot answers from training data and cannot say which thesis a claim came from.'),
    ('04', 'Hypothesis', 'RAG over the approved CCSICT archive, with three properties:'),
)
DATA_MINING_LINE = ('Why this is a Data Mining thesis: unstructured text mining. Embeddings and cosine similarity turn manuscripts '
                    'into a searchable vector space.')

# --- Slide 3 · objectives, verbatim (thesis_extract.txt 81-105) -----------------------
GENERAL_OBJECTIVE = (
    'To develop and implement a Centralized AI-Powered Thesis Library using a Retrieval-Augmented Generation (RAG) AI '
    'architecture to solve the semantic gap and improve research retrieval performance in terms of time and management '
    'for the College of Computing Studies, Information and Communication Technology (CCSICT).'
)
SPECIFIC_OBJECTIVES = (
    'Develop a knowledge retrieval model that integrates Retrieval-Augmented Generation (RAG) and a Large Language Model (LLM) using the LangChain framework.',
    'Compare the performance of the baseline model, or Standard LLM, versus the proposed model (RAG + LLM) strictly in terms of factual accuracy and hallucination mitigation using real institutional queries.',
    'Apply the developed model (LLM + RAG) for the development of the Centralized AI-Powered Thesis Library System.',
    'Evaluate the system’s internal quality using the ISO/IEC 25010 software product quality standard through automated software testing tools based on the following criteria:',
)
OBJECTIVE_4_CRITERIA = ('4.1 Functional Suitability', '4.2 Performance Efficiency', '4.3 Reliability', '4.4 Maintainability')
OBJECTIVE_SHORT = ('The retrieval model', 'The comparison', 'The system', 'ISO/IEC 25010')

# --- Slide 4 · objective 1, frozen constants (config.py 16-115, retriever.py 645-646, chat.py 1715)
FROZEN_CONSTANTS = (
    ('Chunking', '800 tokens · 100 overlap · Literal[…]'),
    ('Tokenizer', 'cl100k_base, a documented proxy'),
    ('Embedding', 'gemini-embedding-001 · 768 dims'),
    ('Retrieval', 'match_chunks · cosine ≥ 0.30 · pool 15'),
    ('Rerank', '0.75 cosine + 0.25 lexical · ≤3/thesis'),
    ('Context', 'exactly 5 blocks · LongContextReorder'),
    ('Generation', 'gemini-3.6-flash · iskai-prompt-v4'),
    ('Validation', 'structural citation check · one repair'),
)
LATENCY_CHIPS = ('p95 204 ms · application-only (2026-07)', 'Grounded answer 4.5–11.4 s · four live queries')
CHAT_CALLOUTS = ('Inline [n] markers, validated against the sent blocks',
                 'Evidence sources are metadata: title, authors, page, section, match',
                 'No PDF link anywhere in the response')
GROUNDED_QUESTION = 'Which CCSICT theses used YOLO-based object detection, and what did each evaluate?'

# --- Slide 5 · refusal guard and grounding controls (DEFENSE_WALKTHROUGH.md 113-127) ----
GUARD_HEADLINE = 'The guard blocks generation requests, not research questions.'
GUARD_PAIR = (
    ('Write me a chapter 2 on YOLO-based object detection for campus security', 'Refused'),
    ('What methodology did the CCSICT theses on YOLO-based object detection use?', 'Answered'),
)
GUARD_EVIDENCE = '40-case matrix · tests/test_rag_controls.py::TestRequestGuard · runs inside the backend gate'
CONTROLS = (
    ('01', 'Threshold 0.30', 'Below it: “no qualifying archive evidence”, not a guess.'),
    ('02', 'Context-only prompt', 'The model answers only from the five retrieved blocks.'),
    ('03', 'Citation validation', 'Every [n] must point at a block sent; one bounded repair.'),
    ('04', 'Grounded fallback', 'If repair fails, a grounded summary replaces the reply.'),
)
CONTROLS_FOOTNOTE = ('Citation validation is structural, not semantic. It proves validity and coverage, not entailment; '
                     'faculty verification remains part of the process.')

# --- Slide 6 · objective 2 (numbers come from evidence.py) ------------------------------
OBJ2_HEADLINE = 'Pooled is significant. The stratum the paper quotes is not.'
OBJ2_CHART_KICKER = 'Ragas Answer Correctness · baseline → RAG'
OBJ2_WHY = ('Eight of sixteen present queries hit the grounded fallback: retrieval was healthy (cosine 0.67–0.74) '
            'but citation validation discarded the answer.')
OBJ2_INSTRUMENT = ('40 queries · 12 released manuscripts · three-member CCSICT panel sign-off 2026-09-13 · '
                   'Context Precision is RAG-only')

# --- Slide 7 · objective 3 (Archive.jsx, Novelty.jsx, novelty.py 48-55, upload router) --
SYSTEM_CALLOUTS = (
    ('Indirect access', 'No PDF URL, storage path or full text in any API response: metadata only.'),
    ('Durable ingestion', 'Staged, leased to a worker, committed atomically; nothing half-indexed is searchable.'),
    ('Novelty verdicts', 'clear · review_suggested < 50 % · high_overlap ≥ 50 % · exact_duplicate. A human decides.'),
    ('Duplication screen', '≥ 0.85 cosine at upload and query time; the matched thesis is named with its percentage.'),
    ('Live archive today', '{ARCHIVE_LINE}'),
)

# --- Slide 8 · architecture (paper Fig. 8; build_corrections.py 222-235; wizardSteps.js) --
LAYERS = (
    ('User Interface Layer', 'React 19 · Vite 8 · Tailwind v4 · five roles, guest researcher to superadmin'),
    ('Application Layer', 'FastAPI · LangChain · role and department boundary in Python · API plus a separate ingestion worker'),
    ('Embedding Layer', 'gemini-embedding-001 (768) · gemini-3.6-flash for chat · gemini-3.5-flash-lite for verdicts'),
    ('Data Storage Layer', 'Supabase Postgres + pgvector vector(768) · Auth · private Storage · transactional RPCs'),
)
INGEST_STAGES = ('Secure source', 'Malware scan', 'Extract & clean', 'Chunk (800 tokens)', 'Embed (768d)', 'Screen novelty (85 %)', 'Index vectors')
QUERY_STAGES = ('Embed query', 'match_chunks ≥ 0.30', 'Hybrid rerank', '5 blocks · reorder', 'Gemini 3.6 Flash', 'Validate citations')
CROSS_CUTTING = ('RLS-backed auth', 'Privileged MFA (aal2)', 'Rate limiting', 'ClamAV scanning')
TWO_PROCESSES = 'Two processes from one image: the API and the ingestion worker. The API never runs the pipeline inline.'

# --- Slide 9 · ISO/IEC 25010 (static rows must occur in iso25010_evidence.md; see build) --
ISO_STATIC = {
    'axe': 'axe-core 4.12.1 · WCAG 2.2 AA · 0 blocking, 0 advisory across 55 scans (2026-08-04)',
    'p95': 'p95 204 ms',
    'p95_note': 'application-only · 2026-07',
    'latency': '4.5–11.4 s grounded answer',
    'sonar': 'SonarQube 26.7.0.124771 · 2026-09-01',
    'sonar_detail': '0 bugs · 0 vulns · A / A / A',
    'fault': '60 req / 14 s · zero 5xx',
    'dup': 'Duplication 1.3 %',
    'lock': '98 pkgs · 2,353 hashes',
    'audits': 'pip-audit 0 · npm audit 0',
}
ISO_QUOTED = ['26.7.0.124771', 'p95 204 ms', '55 scans', 'axe-core 4.12.1', '60 requests in 14 seconds', 'Duplication 1.3%']
DELTAS_CAPTION = 'Objective 2 · the 40 paired differences'

# --- Limitations (DEFENSE_WALKTHROUGH.md 276-343): spoken on the Q&A slide -----------------
LIMITATIONS = (
    ('Load figures are provider-bound', 'Chat throughput was measured on a synthetic corpus on the free tier; the ceiling reached was the provider’s rate limit, not the application’s.'),
    ('A result, not yet a corpus lock', 'Objective 2 has a formal result; the PI-08 corpus lock, its receipt, and four institutional approvals are outstanding. The panel validated the instrument, not the release.'),
    ('Context Precision is RAG-only', 'A baseline with no retriever has no contexts to rank. The headline comparison is paired Answer Correctness.'),
    ('Citation checks are structural', 'They prove validity and coverage, not entailment between claim and source.'),
    ('PII redaction is best-effort', 'A deterministic regex pass plus mandatory human privacy review; not a guarantee.'),
    ('Single-process API', 'Six pieces of state live in process memory, so the API cannot yet be replicated. Documented as the first scaling task.'),
    ('Data Privacy Act work is incomplete', 'NPC registration and a user-facing privacy notice are outstanding; retention enforcement is deliberately disabled pending approval.'),
)
DEMO_ORDER = ('docker start isu-clamav, then the API on :8000, the ingestion worker, and the frontend on :5173; confirm /health, /ready and /health/worker; '
              'leave the Turnstile key blank and wait a minute on provider quota',
              'Landing → “Try as Guest Researcher” → ask which CCSICT theses used YOLO-based object detection; narrate the 5–12 s as generation',
              'The refusal pair: “Write me a chapter 2 …” is refused, “What methodology …” is answered with citations',
              'Sign in → Novelty Check → a verdict; say the word advisory',
              'Thesis Archive → the indirect-access pill and the badges; Research Administration → Overview, Upload history, System Management, Operations')

# --- Slide 10 · Q&A -------------------------------------------------------------------
QA_INVITATIONS = ('Ask the live system a question of your own',
                  'Perturb a parameter: threshold 0.30, screen 0.85',
                  f'Open the repository: {REPO}')

# --- Slide 11 · closing -----------------------------------------------------------------
DEFENDED = 'SYSTEM THESIS DEFENDED'
THANKS = 'Thank you'

# --- Speaker notes, spoken sentences ------------------------------------------------------
NOTES = {
    1: ('Good day to the panel. We are Ahron John Barlis and Carlo Rossi Gallardo, BSCS Data Mining Track, and this is the '
        'system defense of A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation, which we call IskAI. '
        'In one sentence: a student asks in plain language, the system retrieves the passages that answer from approved CCSICT '
        'manuscripts, and the model may only answer from those passages, with a citation for every claim. Everything after this '
        'slide is evidence for that sentence.'),
    2: ('Today a CCSICT student navigates hardbound volumes and soft copies by hand, and the keyword search that exists reads only '
        'the abstract. It cannot capture semantic context, so literature reviews are slow and topic duplication is caught late. A '
        'general chatbot does not fix this: it cannot tell you which thesis a claim came from. Our hypothesis is retrieval-augmented '
        'generation over the approved archive, with three properties we will keep repeating: closed-domain, citation-backed, '
        'advisory. This is a data mining thesis because the mining is over unstructured text: embeddings and cosine similarity, '
        'not tables.'),
    3: ('The general objective is read exactly as the manuscript states it. The four specific objectives are the spine of the '
        'deck: the retrieval model, the comparison, the system, and ISO 25010. Each card carries a thumbnail of the evidence that '
        'proves it, and the numbered rail in the corner tells you which objective you are watching being proved.'),
    4: ('Objective one. This is a real grounded answer from the running system, captured on 14 September, about the archive’s '
        'YOLO-based object-detection theses: inline citation markers and the evidence sources beneath, metadata only, no PDF '
        'link. The constants on the left are frozen: 800-token chunks with 100 overlap because a paragraph stays whole and a claim '
        'at a boundary appears in at least one chunk; cl100k_base because Google publishes no Gemini tokenizer, so we fixed a '
        'documented proxy rather than guess; 768 dimensions; a 0.30 threshold; a pool of fifteen reranked to exactly five blocks. '
        'Chunk size, overlap and dimensions are typed as Literal in config.py, so no environment variable can move them. '
        'Application-only latency is p95 204 milliseconds; the five to twelve seconds you will see in the demo is the language '
        'model generating, measured at 4.5 to 11.4 seconds.'),
    5: ('The hardest problem in this project was making the assistant refuse correctly. Ask it to write a chapter two and it '
        'refuses, because it is a retrieval assistant, not a ghostwriter. Ask what methodology the YOLO-based detection theses '
        'used and it answers with citations. An earlier guard blocked the second question too, which is exactly the question the '
        'archive exists to answer; the fix is covered by a 40-case matrix in test_rag_controls that runs inside the backend gate. '
        'Four independent controls stop hallucination: the threshold, the context-only prompt, structural citation validation with '
        'one repair, and a grounded fallback. We say plainly that validation is structural, not semantic: it proves validity and '
        'coverage, not entailment, and faculty verification remains part of the process.'),
    6: ('Objective two, and this is the slide the defense turns on. The instrument is forty institutional queries over the twelve '
        'released manuscripts, with every ground truth validated by a three-member CCSICT panel on 13 September. Pooled, Answer '
        'Correctness rose from 0.2169 to 0.3024, paired t-test p equals 3.222 times ten to the minus five, Cohen’s d of 0.74. But '
        'section 3.2.5 of our paper committed in advance to quoting the present stratum, the sixteen questions the archive can '
        'actually answer, because it is the only stratum with a corpus-derived ground truth. On present the gain is 0.060 with p '
        'equals 0.1257: not significant. The pooled significance is carried by the absence strata, which measure refusal behaviour, '
        'which is exactly what they exist to measure. Shapiro–Wilk on the pooled pairs gave W 0.9594, p 0.1595, so the parametric '
        'branch applies. We know why present underperforms: eight of its sixteen queries returned the grounded fallback after '
        'citation validation discarded an answer it could not cite, even though retrieval was healthy. The system chose to refuse '
        'rather than cite something it could not verify. That is the design working, at a measurable cost to the score.'),
    7: ('Objective three is the system around the model. The archive is metadata only: no API response ever carries a PDF URL, '
        'a storage path, or full text, and automated tests assert it. Uploads are staged, queued, and committed atomically by a '
        'separate worker, so a half-indexed thesis can never appear in search. The novelty check reports two numbers, highest '
        'passage similarity and matched-chunk coverage, and a tiered verdict that is advisory: the system never auto-rejects a '
        'topic; a human adviser decides. {ARCHIVE_NOTE}'),
    8: ('Four layers, as in Figure 8 of the paper. Two processes are built from one image: the API and the ingestion worker. '
        'Ingestion runs through seven stages, secure source to index vectors, and the query path runs embed, match at 0.30, '
        'rerank, five blocks, reorder, generate, validate. Authentication with row-level security, privileged multi-factor access, '
        'rate limiting and malware scanning cut across all four layers.'),
    9: ('Objective four, the four ISO 25010 characteristics, each with its own instrument and its own date. The test counts were '
        're-run today at the current commit and recorded in the evidence file. SonarQube is the 1 September scan, accessibility '
        'the 4 August audit, and the p95 figure is application-only from July. The sixty requests in fourteen seconds with zero '
        'server errors is fault-tolerance evidence, not throughput. On the right is Objective 2 query by query: twenty-nine of '
        'forty paired differences favour RAG. One gap we volunteer: the release fingerprint does not yet hash services/citations.py.'),
    10: ('We are open for examination: ask the live system anything, ask us to perturb a threshold, or open the repository; the '
         'formal run, the quality gate and the coverage figure are all reproducible. Before questions, seven limitations we state '
         'ourselves: ' + ' '.join(f'{i + 1}. {head}: {body}' for i, (head, body) in enumerate(LIMITATIONS)) +
         ' None of these touch the frozen, evaluated pipeline. If the panel asks for the live demo, the order is: '
         + ' Then '.join(DEMO_ORDER) + '. If the capacity notice appears, that is the provider quota, not a crash; if the system '
         'reports no qualifying archive evidence, the question fell below 0.30, so ask something indexed.'),
    11: ('Thank you to the panel, to our adviser, and to CCSICT for releasing the corpus that made the comparison possible.'),
}
