"""Seed a disposable Supabase project with a synthetic thesis corpus (§4.7).

Why this exists
--------------
`/chat` has never been load-tested. Every performance figure on record was
measured against `/health`, `/upload/tracks`, and `/analytics/summary`, so the
capacity of the system's core feature is unknown. Load-testing it needs a corpus:
against an empty archive every request returns "no relevant thesis found" and
never reaches generation, which would measure the fast path and mislabel it RAG.

The real 50-thesis defense corpus is a governed artifact gated on four
institutional approvals (see `scripts/corpus_manifest.py`) and must never be
approximated. This script instead produces obviously-synthetic theses for
performance measurement only. Any figure derived from it must be reported as
measured on a synthetic corpus.

What it does not do
-------------------
It does not touch answer quality. Objective 2 needs the real corpus and
faculty-validated ground truth; nothing here substitutes for that.

How it stays faithful
---------------------
It commits through `commit_paper_ingestion`, the same PostgreSQL function
production uses, so `papers`, `paper_index_versions`, and `chunks` are written
atomically and consistently. It chunks with `services.chunker.split_document` and
embeds with `services.embedder.embed_texts` — the real implementations, not
copies. A hand-rolled three-table insert would be the obvious shortcut and the
obvious way to produce a corpus that silently retrieves nothing.

Safety
------
Refuses to run unless the target is provably the disposable project: an explicit
`--project-ref` that matches `TEST_SUPABASE_PROJECT_REF`, a matching hostname,
and both the URL and the service key differing from the application's.

Usage
-----
    python -m scripts.seed_synthetic_corpus --project-ref <disposable-ref>
    python -m scripts.seed_synthetic_corpus --project-ref <ref> --count 12 --dry-run
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

BACKEND_ROOT = Path(__file__).resolve().parent.parent

TITLE_MARKER = '[SYNTHETIC LOAD-TEST RECORD]'

TOPICS = [
    {
        'slug': 'crop-disease-cnn',
        'subject': 'rice leaf disease detection',
        'artifact': 'a convolutional neural network classifier',
        'domain': 'agricultural extension work in Isabela',
        'data': '4,812 field photographs of rice leaves collected across three municipalities',
        'metric': 'classification accuracy',
        'result': '94.2%',
        'stakeholder': 'municipal agriculturists',
        'tool': 'TensorFlow',
    },
    {
        'slug': 'campus-intrusion-detection',
        'subject': 'campus network intrusion detection',
        'artifact': 'an anomaly-based detection service',
        'domain': 'university network operations',
        'data': 'six months of anonymized NetFlow records from the campus core switch',
        'metric': 'true-positive rate',
        'result': '91.7%',
        'stakeholder': 'network administrators',
        'tool': 'Suricata',
    },
    {
        'slug': 'enrollment-chatbot',
        'subject': 'automated enrollment inquiry handling',
        'artifact': 'a retrieval-based conversational agent',
        'domain': 'student registration services',
        'data': '3,140 archived enrollment inquiries from two academic years',
        'metric': 'intent recognition accuracy',
        'result': '88.5%',
        'stakeholder': 'registrar staff',
        'tool': 'Rasa',
    },
    {
        'slug': 'iot-irrigation',
        'subject': 'soil-moisture-driven irrigation scheduling',
        'artifact': 'an IoT sensor and actuator network',
        'domain': 'smallholder farm water management',
        'data': 'continuous readings from twelve capacitive soil-moisture sensors over one cropping season',
        'metric': 'water consumption reduction',
        'result': '27.4%',
        'stakeholder': 'farmer cooperatives',
        'tool': 'ESP32 microcontrollers',
    },
    {
        'slug': 'student-performance-prediction',
        'subject': 'early prediction of academic difficulty',
        'artifact': 'a gradient-boosted decision model',
        'domain': 'academic advising',
        'data': 'anonymized records for 2,265 students across eight semesters',
        'metric': 'area under the ROC curve',
        'result': '0.863',
        'stakeholder': 'guidance counsellors',
        'tool': 'scikit-learn',
    },
    {
        'slug': 'library-recommendation',
        'subject': 'library holdings recommendation',
        'artifact': 'a collaborative filtering recommender',
        'domain': 'library circulation services',
        'data': '58,900 borrowing transactions spanning four years',
        'metric': 'precision at ten',
        'result': '0.412',
        'stakeholder': 'librarians',
        'tool': 'implicit ALS',
    },
    {
        'slug': 'attendance-face-recognition',
        'subject': 'contactless class attendance capture',
        'artifact': 'a face-recognition attendance terminal',
        'domain': 'classroom administration',
        'data': '9,600 enrolment images and 44,000 attendance events',
        'metric': 'recognition accuracy under classroom lighting',
        'result': '96.8%',
        'stakeholder': 'faculty members',
        'tool': 'dlib',
    },
    {
        'slug': 'flood-early-warning',
        'subject': 'riverine flood early warning',
        'artifact': 'a distributed water-level telemetry network',
        'domain': 'disaster risk reduction',
        'data': 'hourly water-level and rainfall readings from five upstream stations over two typhoon seasons',
        'metric': 'lead time before threshold breach',
        'result': '3.6 hours',
        'stakeholder': 'municipal disaster officers',
        'tool': 'LoRaWAN',
    },
    {
        'slug': 'ewaste-inventory',
        'subject': 'electronic waste inventory tracking',
        'artifact': 'a barcode-driven asset lifecycle system',
        'domain': 'institutional property management',
        'data': '7,430 property records reconciled against physical inventory',
        'metric': 'reconciliation error reduction',
        'result': '61.2%',
        'stakeholder': 'property custodians',
        'tool': 'Laravel',
    },
    {
        'slug': 'barangay-records',
        'subject': 'barangay civil records digitization',
        'artifact': 'an offline-first records management application',
        'domain': 'local government service delivery',
        'data': '18,200 handwritten residency and clearance records',
        'metric': 'median certificate issuance time',
        'result': '4.1 minutes',
        'stakeholder': 'barangay secretaries',
        'tool': 'SQLite replication',
    },
    {
        'slug': 'tricycle-dispatch',
        'subject': 'shared tricycle dispatch optimization',
        'artifact': 'a queue-aware dispatch heuristic',
        'domain': 'local public transport',
        'data': '21,700 trip records logged at four terminals',
        'metric': 'average passenger waiting time',
        'result': '5.8 minutes',
        'stakeholder': 'terminal operators',
        'tool': 'OR-Tools',
    },
    {
        'slug': 'rice-yield-forecast',
        'subject': 'municipal rice yield forecasting',
        'artifact': 'a multivariate time-series model',
        'domain': 'agricultural planning',
        'data': 'eleven years of municipal yield statistics joined with rainfall and temperature series',
        'metric': 'mean absolute percentage error',
        'result': '7.9%',
        'stakeholder': 'provincial planners',
        'tool': 'Prophet',
    },
    {
        'slug': 'lms-usage-analytics',
        'subject': 'learning management system engagement analysis',
        'artifact': 'an engagement analytics dashboard',
        'domain': 'blended course delivery',
        'data': '412,000 activity events from 1,880 enrolled students',
        'metric': 'correlation with final grade',
        'result': '0.58',
        'stakeholder': 'programme chairs',
        'tool': 'Moodle event logs',
    },
    {
        'slug': 'malware-classification',
        'subject': 'static malware family classification',
        'artifact': 'an opcode n-gram classifier',
        'domain': 'endpoint security operations',
        'data': '11,400 labelled binaries drawn from a public reference set',
        'metric': 'macro F1 score',
        'result': '0.902',
        'stakeholder': 'security analysts',
        'tool': 'radare2',
    },
    {
        'slug': 'dialect-speech-recognition',
        'subject': 'Ilocano speech recognition for public service kiosks',
        'artifact': 'a fine-tuned acoustic model',
        'domain': 'frontline government service counters',
        'data': '46 hours of transcribed Ilocano speech from 88 volunteer speakers',
        'metric': 'word error rate',
        'result': '18.3%',
        'stakeholder': 'kiosk service staff',
        'tool': 'Kaldi',
    },
]

SURNAMES = [
    'Bautista', 'Cabrera', 'Dela Cruz', 'Espiritu', 'Fernandez', 'Gaspar',
    'Hidalgo', 'Ignacio', 'Jimenez', 'Lacsamana', 'Manalo', 'Navarro',
    'Ocampo', 'Pascual', 'Quintos', 'Ramos', 'Salvador', 'Tolentino',
    'Umali', 'Villanueva',
]
GIVEN_INITIALS = list('ABCDEFGHIJKLMNPRSTVZ')


def _sentences(topic: dict, kind: str) -> list[str]:
    """Section-specific sentence pool, parameterized by the topic."""
    t = topic
    pools = {
        'background': [
            f"Work on {t['subject']} in {t['domain']} has historically depended on manual procedures that scale poorly.",
            f"Practitioners in {t['domain']} report that existing records are fragmented across spreadsheets and paper forms.",
            f"The absence of a consolidated view forces {t['stakeholder']} to reconcile figures by hand each reporting period.",
            f"Prior local attempts at {t['subject']} were discontinued once their original proponents graduated.",
            f"Regional policy increasingly expects evidence-based reporting, which the current process cannot supply reliably.",
            f"This gap motivated the design of {t['artifact']} evaluated in this study.",
            f"Comparable institutions have adopted digital tooling, but their contexts differ enough that direct transfer fails.",
            f"Consultation with {t['stakeholder']} confirmed that turnaround time, not analytical sophistication, is the binding constraint.",
        ],
        'problem': [
            f"This study asks whether {t['artifact']} can support {t['subject']} at a quality acceptable to {t['stakeholder']}.",
            f"Specifically, it measures {t['metric']} against the current manual baseline.",
            f"It further examines whether the approach remains usable under the connectivity conditions typical of {t['domain']}.",
            f"A secondary question concerns the effort required to maintain the system after handover.",
            f"The study does not attempt to replace professional judgement in {t['domain']}.",
            f"Cost of ownership is treated as a constraint rather than an outcome variable.",
        ],
        'scope': [
            f"The study is limited to {t['domain']} within the province and does not generalize beyond it.",
            f"Only {t['data']} were used; no additional collection was undertaken after the cut-off date.",
            f"Personally identifying details were removed before analysis, and no participant is identifiable in any reported figure.",
            f"The prototype was evaluated offline; production deployment is outside the scope of this work.",
            f"Findings are conditioned on the sampling frame and should be revisited if the population changes.",
        ],
        'terms': [
            f"{t['metric'].capitalize()} refers to the primary outcome measure reported throughout this study.",
            f"{t['tool']} denotes the implementation toolkit used to build {t['artifact']}.",
            f"Baseline refers to the existing manual procedure in {t['domain']} against which the prototype is compared.",
            f"Holdout set refers to the portion of {t['data']} withheld from model fitting.",
            f"Handover refers to the transfer of the prototype and its documentation to {t['stakeholder']}.",
        ],
        'literature': [
            f"Published work on {t['subject']} converges on the value of consolidating source data before modelling.",
            f"Several authors report that {t['metric']} improves materially once inputs are standardized.",
            f"Studies conducted outside the region tend to assume infrastructure that is not available in {t['domain']}.",
            f"A recurring finding is that adoption depends more on workflow fit than on headline accuracy.",
            f"Reviews of {t['tool']} note its suitability for small teams with limited operational budget.",
            f"Reported figures for comparable systems range widely, which complicates direct comparison.",
            f"The literature is consistent that human oversight must remain in the loop for consequential decisions.",
            f"Few studies document what happens to such systems after the original authors leave.",
        ],
        'synthesis': [
            f"Taken together, the reviewed work supports {t['artifact']} as a defensible design choice for {t['subject']}.",
            f"It also indicates that {t['metric']} alone is an insufficient basis for adoption decisions.",
            f"The gap this study addresses is the absence of locally grounded evidence in {t['domain']}.",
            f"Accordingly, the evaluation reports both the outcome measure and the operational conditions under which it was obtained.",
        ],
        'methodology': [
            f"The study followed a developmental research design with an iterative build-and-evaluate cycle.",
            f"{t['data'].capitalize()} formed the evaluation dataset.",
            f"Records were partitioned into training, validation, and holdout portions before any modelling.",
            f"{t['artifact'].capitalize()} was implemented using {t['tool']}.",
            f"Preprocessing removed duplicates, normalized field formats, and dropped records failing validation.",
            f"{t['metric'].capitalize()} was computed on the untouched holdout portion only.",
            f"The manual baseline was timed under observation with the cooperation of {t['stakeholder']}.",
            f"Each configuration was run three times and the median reported, to limit the effect of run-to-run variation.",
            f"Ethical clearance was secured before any data were accessed.",
        ],
        'results': [
            f"The prototype reached {t['result']} on {t['metric']}, exceeding the manual baseline.",
            f"Performance was stable across the holdout partition, with no partition deviating materially from the mean.",
            f"Errors concentrated in a small number of atypical records rather than spreading uniformly.",
            f"{t['stakeholder'].capitalize()} rated the interface as usable after a single orientation session.",
            f"Processing time remained within the window acceptable for routine use in {t['domain']}.",
            f"Sensitivity analysis showed the result is robust to reasonable changes in the preprocessing thresholds.",
            f"One configuration underperformed noticeably and was excluded from the final design after review.",
        ],
        'conclusion': [
            f"The study concludes that {t['artifact']} is a viable support tool for {t['subject']} in {t['domain']}.",
            f"The reported {t['result']} on {t['metric']} should be read alongside the stated delimitations.",
            f"The approach does not remove the need for professional judgement by {t['stakeholder']}.",
            f"Sustained benefit depends on someone owning the system after handover.",
        ],
        'recommendations': [
            f"It is recommended that {t['stakeholder']} pilot the prototype for one full reporting cycle before wider rollout.",
            f"Future work should widen the sampling frame beyond the municipalities covered here.",
            f"A maintenance agreement should be established before the system is relied upon operationally.",
            f"Subsequent studies should report operational cost alongside {t['metric']}.",
            f"Periodic revalidation is advised, since the underlying population is not static.",
        ],
    }
    return pools[kind]


def _paragraphs(rng: random.Random, topic: dict, kind: str, count: int) -> str:
    """Build paragraphs by sampling without adjacent repetition."""
    pool = _sentences(topic, kind)
    out = []
    for _ in range(count):
        size = min(len(pool), rng.randint(4, 6))
        picked = rng.sample(pool, size)
        out.append(' '.join(picked))
    return '\n\n'.join(out)


def build_thesis_text(rng: random.Random, topic: dict) -> str:
    """A thesis long enough to produce several 800-token chunks."""
    p = _paragraphs
    sections = [
        ('ABSTRACT', p(rng, topic, 'problem', 2)),
        ('CHAPTER 1', ''),
        ('1.1 Background of the Study', p(rng, topic, 'background', 4)),
        ('1.2 Statement of the Problem', p(rng, topic, 'problem', 3)),
        ('1.3 Scope and Delimitation', p(rng, topic, 'scope', 3)),
        ('1.5 Definition of Terms', p(rng, topic, 'terms', 2)),
        ('CHAPTER 2', ''),
        ('2.1 Review of Related Literature', p(rng, topic, 'literature', 5)),
        ('2.2 Synthesis of the Literature', p(rng, topic, 'synthesis', 3)),
        ('CHAPTER 3', ''),
        ('3.1 Research Methodology', p(rng, topic, 'methodology', 5)),
        ('3.2 Data Gathering Procedure', p(rng, topic, 'methodology', 3)),
        ('CHAPTER 4', ''),
        ('4.1 Results and Discussion', p(rng, topic, 'results', 5)),
        ('CHAPTER 5', ''),
        ('5.1 Conclusion', p(rng, topic, 'conclusion', 3)),
        ('5.2 Recommendations', p(rng, topic, 'recommendations', 3)),
    ]
    blocks = []
    for heading, body in sections:
        blocks.append(heading)
        if body:
            blocks.append(body)
    return '\n\n'.join(blocks)


def paginate(text: str, chars_per_page: int = 2600) -> list[str]:
    """Split into page-sized pieces on paragraph boundaries."""
    pages, current = [], ''
    for block in text.split('\n\n'):
        candidate = f'{current}\n\n{block}' if current else block
        if len(candidate) > chars_per_page and current:
            pages.append(current)
            current = block
        else:
            current = candidate
    if current:
        pages.append(current)
    return pages


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, _, value = line.partition('=')
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def resolve_target(env: dict[str, str], required_ref: str) -> tuple[str, str]:
    """Prove the target is the disposable project, or refuse to continue."""
    url = env.get('TEST_SUPABASE_URL', '').rstrip('/')
    key = env.get('TEST_SUPABASE_SERVICE_ROLE_KEY', '')
    declared_ref = env.get('TEST_SUPABASE_PROJECT_REF', '')
    app_url = env.get('SUPABASE_URL', '').rstrip('/')
    app_key = env.get('SUPABASE_KEY', '')

    problems = []
    if not (url and key and declared_ref):
        problems.append('TEST_SUPABASE_URL / _PROJECT_REF / _SERVICE_ROLE_KEY must all be set')
    if declared_ref and required_ref != declared_ref:
        problems.append(
            f'--project-ref {required_ref!r} does not match TEST_SUPABASE_PROJECT_REF'
        )
    host_ref = (urlparse(url).hostname or '').split('.')[0]
    if declared_ref and host_ref != declared_ref:
        problems.append('TEST_SUPABASE_PROJECT_REF does not match TEST_SUPABASE_URL')
    if url and url == app_url:
        problems.append('the disposable URL equals the application SUPABASE_URL')
    if key and key == app_key:
        problems.append('the disposable service key equals the application SUPABASE_KEY')
    if problems:
        for problem in problems:
            print(f'REFUSING: {problem}', file=sys.stderr)
        sys.exit(2)
    return url, key


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument(
        '--project-ref', required=True,
        help='Disposable project ref; must match TEST_SUPABASE_PROJECT_REF.',
    )
    parser.add_argument('--count', type=int, default=12,
                        help='Number of synthetic theses (default 12).')
    parser.add_argument('--department', default='',
                        help='Target department (default: the evaluation department).')
    parser.add_argument('--seed', type=int, default=20260804,
                        help='RNG seed, so a corpus is reproducible.')
    parser.add_argument('--dry-run', action='store_true',
                        help='Generate and chunk, but neither embed nor write.')
    args = parser.parse_args()

    if not 1 <= args.count <= len(TOPICS):
        print(f'--count must be between 1 and {len(TOPICS)}', file=sys.stderr)
        return 2

    env = read_env_file(BACKEND_ROOT / '.env')
    url, key = resolve_target(env, args.project_ref)

    # Point the application settings at the disposable project for this process
    # only. Environment variables take precedence over the .env file, so nothing
    # here can reach the application project.
    os.environ['SUPABASE_URL'] = url
    os.environ['SUPABASE_KEY'] = key
    os.environ['APP_ENVIRONMENT'] = 'development'
    os.environ.setdefault('GEMINI_API_KEY', env.get('GEMINI_API_KEY', ''))
    sys.path.insert(0, str(BACKEND_ROOT))

    from config import settings
    from services.chunker import build_chunk_metadata, split_document
    from services.document_processor import ExtractedDocument, ExtractedPage
    from services.index_provenance import current_index_fingerprint
    from supabase import create_client

    department = args.department or settings.thesis_evaluation_department
    client = create_client(url, key)

    tracks = []
    try:
        rows = client.table('departments').select('name,tracks').eq(
            'name', department
        ).limit(1).execute().data or []
        tracks = list(rows[0].get('tracks') or []) if rows else []
    except Exception as error:
        print(f'Could not read department tracks ({type(error).__name__}); using a default.')
    if not tracks:
        tracks = ['Data Mining']

    print(f'target project : {args.project_ref}')
    print(f'department      : {department}')
    print(f'theses          : {args.count}')
    print(f'mode            : {"DRY RUN" if args.dry_run else "WRITE"}')
    print()

    # Already-seeded topics are skipped rather than duplicated, so an
    # interrupted run — the Gemini free tier exhausts its embedding quota well
    # before twelve theses — can simply be re-run to top up.
    existing_titles: set[str] = set()
    try:
        rows = client.table('papers').select('title').eq(
            'department', department
        ).execute().data or []
        existing_titles = {
            str(row.get('title') or '') for row in rows
            if TITLE_MARKER in str(row.get('title') or '')
        }
    except Exception as error:
        print(f'Could not list existing papers ({type(error).__name__}); '
              'proceeding without skip protection.')
    if existing_titles:
        print(f'already seeded : {len(existing_titles)} synthetic paper(s) — these will be skipped\n')

    rng = random.Random(args.seed)
    total_chunks = 0
    committed = []
    skipped = 0

    for index, topic in enumerate(TOPICS[:args.count], start=1):
        # Generated before the skip check so the RNG stream stays identical to a
        # fresh run; otherwise a resumed run would produce different authors and
        # years for the remaining theses and the corpus would not be reproducible.
        text = build_thesis_text(rng, topic)
        pages = [
            ExtractedPage(page_number=number, text=body)
            for number, body in enumerate(paginate(text), start=1)
        ]
        document = ExtractedDocument(pages=pages, redaction_stats={})
        chunk_records = split_document(document)
        total_chunks += len(chunk_records)

        authors = ', '.join(
            f'{rng.choice(GIVEN_INITIALS)}. {rng.choice(SURNAMES)}' for _ in range(rng.randint(2, 3))
        )
        title = (
            f"{TITLE_MARKER} {topic['subject'].capitalize()} using "
            f"{topic['artifact']}"
        )
        year = rng.randint(2019, 2026)
        track = tracks[index % len(tracks)]

        if title in existing_titles:
            print(f"{index:>2}. {topic['slug']:<30} already seeded - skipped")
            skipped += 1
            total_chunks -= len(chunk_records)
            continue

        print(f"{index:>2}. {topic['slug']:<30} pages={len(pages):<3} chunks={len(chunk_records):<3} "
              f"tokens={sum(r['token_count'] for r in chunk_records):<6} {year} {track}")

        if args.dry_run:
            continue

        from services.embedder import embed_texts
        try:
            embeddings = embed_texts([record['content'] for record in chunk_records])
        except Exception as error:
            # The free tier exhausts its embedding quota well before twelve
            # theses. Stop cleanly and keep what already committed, rather than
            # unwinding a corpus that is already usable.
            print(f'    EMBEDDING FAILED: {type(error).__name__}', file=sys.stderr)
            print(f'    quota is likely exhausted; {len(committed)} paper(s) committed this run.',
                  file=sys.stderr)
            print('    re-run the same command later to top up - already-seeded '
                  'theses are skipped.', file=sys.stderr)
            break
        if len(embeddings) != len(chunk_records):
            print('  embedding count mismatch; aborting', file=sys.stderr)
            return 1

        paper_id = str(uuid.uuid4())
        paper_data = {
            'id': paper_id,
            'title': title,
            'authors': authors,
            'year': year,
            'abstract': f"Synthetic record for load testing. {topic['subject'].capitalize()} "
                        f"evaluated with {topic['artifact']}.",
            'track': track,
            'filename': f"synthetic-{topic['slug']}.pdf",
            'storage_path': f"synthetic/{topic['slug']}.pdf",
            'chunk_count': len(chunk_records),
            'uploaded_by': None,
            'department': department,
            'redaction_stats': {},
            'duplication_scan': None,
            'index_provenance': current_index_fingerprint(),
        }
        chunk_rows = [
            {
                'chunk_index': record['chunk_index'],
                'content': record['content'],
                'page_start': record['page_start'],
                'page_end': record['page_end'],
                'section': record['section'],
                'metadata': build_chunk_metadata(
                    title, authors, track, year,
                    department=department,
                    page_start=record['page_start'],
                    page_end=record['page_end'],
                    section=record['section'],
                    chunk_index=record['chunk_index'],
                    token_count=record['token_count'],
                ),
                'embedding': embedding,
            }
            for record, embedding in zip(chunk_records, embeddings)
        ]
        try:
            result = client.rpc('commit_paper_ingestion', {
                'p_paper': paper_data,
                'p_chunks': chunk_rows,
            }).execute()
            committed.append(str(result.data))
            print(f'    committed as {result.data}')
        except Exception as error:
            print(f'    COMMIT FAILED: {type(error).__name__}: {str(error)[:200]}', file=sys.stderr)
            return 1

    print()
    print(f'chunks generated : {total_chunks}')
    if skipped:
        print(f'skipped          : {skipped} already-seeded')
    if args.dry_run:
        print('dry run: nothing embedded, nothing written.')
    else:
        print(f'papers committed : {len(committed)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
