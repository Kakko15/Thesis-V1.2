"""Generate Figure 8 - System Architecture, as a hand-laid-out SVG.

Auto-layout engines put this diagram's long ingestion edges through the middle
of the retrieval column. Positions here are explicit, and the two flows are
routed down reserved rails so nothing crosses a box.

    python build_figure8.py        -> Figure8_System_Architecture.svg
"""

W, H = 1680, 1430

INK = '#1E293B'
MUTED = '#475569'
CONTAINER_BORDER = '#CBD5E1'
CONTAINER_TITLE = '#64748B'
BOX_FILL = '#F8FAFC'
BOX_BORDER = '#94A3B8'
INGEST = '#B45309'
RETRIEVE = '#0F766E'
ACTOR = '#475569'

parts: list[str] = []


def esc(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def container(x, y, w, h, title, dashed=False):
    dash = ' stroke-dasharray="7 5"' if dashed else ''
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#FFFFFF" '
        f'stroke="{CONTAINER_BORDER}" stroke-width="1.6"{dash}/>'
    )
    parts.append(
        f'<text x="{x + 22}" y="{y + 27}" font-size="13.5" font-weight="700" '
        f'letter-spacing="1.4" fill="{CONTAINER_TITLE}">{esc(title.upper())}</text>'
    )


def box(x, y, w, h, title, lines=(), accent=None):
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{BOX_FILL}" '
        f'stroke="{BOX_BORDER}" stroke-width="1.5"/>'
    )
    if accent:
        parts.append(
            f'<rect x="{x}" y="{y}" width="5" height="{h}" rx="2.5" fill="{accent}"/>'
        )
    ty = y + 27
    parts.append(
        f'<text x="{x + 18}" y="{ty}" font-size="15" font-weight="700" '
        f'fill="{INK}">{esc(title)}</text>'
    )
    for i, line in enumerate(lines):
        parts.append(
            f'<text x="{x + 18}" y="{ty + 21 + i * 17}" font-size="12.5" '
            f'fill="{MUTED}">{esc(line)}</text>'
        )


def path(points, color, label=None, label_at=None, label_anchor='middle',
         label_dy=-8, marker='end'):
    d = f'M {points[0][0]} {points[0][1]}'
    for px, py in points[1:]:
        d += f' L {px} {py}'
    head = f' marker-end="url(#arrow-{color[1:]})"' if marker else ''
    parts.append(
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.9" '
        f'stroke-linejoin="round"{head}/>'
    )
    if label:
        lx, ly = label_at
        for i, line in enumerate(label.split('|')):
            ty = ly + label_dy + i * 15
            wpx = len(line) * 6.9 + 12
            hx = {'start': lx - 6, 'end': lx - wpx + 6,
                  'middle': lx - wpx / 2}[label_anchor]
            parts.append(
                f'<rect x="{hx}" y="{ty - 12}" width="{wpx}" height="17" rx="3" '
                f'fill="#FFFFFF" opacity="0.94"/>'
            )
            parts.append(
                f'<text x="{lx}" y="{ty}" font-size="12.5" '
                f'font-weight="600" text-anchor="{label_anchor}" fill="{color}">'
                f'{esc(line)}</text>'
            )


def actor(cx, cy, name):
    parts.append(
        f'<g stroke="{ACTOR}" stroke-width="2" fill="none" stroke-linecap="round">'
        f'<circle cx="{cx}" cy="{cy}" r="11" fill="#FFFFFF"/>'
        f'<line x1="{cx}" y1="{cy + 11}" x2="{cx}" y2="{cy + 38}"/>'
        f'<line x1="{cx - 16}" y1="{cy + 21}" x2="{cx + 16}" y2="{cy + 21}"/>'
        f'<line x1="{cx}" y1="{cy + 38}" x2="{cx - 14}" y2="{cy + 60}"/>'
        f'<line x1="{cx}" y1="{cy + 38}" x2="{cx + 14}" y2="{cy + 60}"/>'
        f'</g>'
    )
    for i, line in enumerate(name.split('|')):
        parts.append(
            f'<text x="{cx}" y="{cy + 80 + i * 16}" font-size="13.5" font-weight="600" '
            f'text-anchor="middle" fill="{INK}">{esc(line)}</text>'
        )


# --------------------------------------------------------------------------
# canvas
# --------------------------------------------------------------------------
parts.append(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
    f'viewBox="0 0 {W} {H}" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif">'
)
parts.append('<defs>')
for colour in (INGEST, RETRIEVE, ACTOR):
    parts.append(
        f'<marker id="arrow-{colour[1:]}" viewBox="0 0 10 10" refX="9" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M 0 1 L 9 5 L 0 9 z" fill="{colour}"/></marker>'
    )
parts.append('</defs>')
parts.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')

# --------------------------------------------------------------------------
# actors
# --------------------------------------------------------------------------
actor(210, 62, 'Superadmin')
actor(360, 62, 'Admin')
actor(1090, 62, 'Faculty')
actor(1240, 62, 'Student')
actor(1400, 62, 'Guest|Researcher')

# --------------------------------------------------------------------------
# containers and boxes
# --------------------------------------------------------------------------
container(110, 215, 1450, 118, 'User Interface Layer')
box(150, 247, 410, 68, 'Upload Interface', ['Role-gated by a server-owned', 'permission matrix'], INGEST)
box(1000, 247, 520, 68, 'Web Application UI', ['React 19 / Vite 8'], RETRIEVE)

container(110, 370, 1450, 452, 'Application Layer  ·  Python Backend')
box(150, 408, 410, 92, 'Upload API', ['Validate, privately stage,', 'reserve job → HTTP 202'], INGEST)
box(150, 524, 410, 74, 'Duplication Guard', ['Cosine similarity ≥ 0.85'])
box(1000, 408, 520, 66, 'Query Processor', ['FastAPI · Uvicorn · Pydantic'], RETRIEVE)
box(1000, 498, 520, 100, 'RAG Pipeline', [
    'LangChain Expression Language chain',
    'match_chunks: cosine ≥ 0.30 · top-k 5 · department-scoped',
    'LongContextReorder applied before generation',
], RETRIEVE)
box(1000, 622, 520, 62, 'Response Generator', ['gemini-3.6-flash'], RETRIEVE)
box(1000, 708, 520, 80, 'Citation Validator', [
    'Structural marker + coverage check,', 'then one bounded repair attempt',
], RETRIEVE)

container(110, 858, 470, 128, 'Ingestion Worker  ·  separate process', dashed=True)
box(150, 890, 390, 78, 'Leased Job Processor', [
    'claim → download → malware scan →', 'extract → chunk → embed → screen → commit',
], INGEST)

container(110, 1022, 1450, 172, 'Embedding Layer')
box(150, 1058, 390, 118, 'PDF Loader', [
    'PyMuPDF extraction,', 'Tesseract OCR fallback,', 'cleaning + PII redaction',
])
box(660, 1058, 390, 118, 'Text Chunker', [
    'RecursiveCharacterTextSplitter', '800 tokens / 100 overlap',
    'cl100k_base measurement proxy',
])
box(1130, 1058, 390, 118, 'Embedding Model', [
    'langchain-google-genai', 'gemini-embedding-001', '768 dimensions',
])

container(110, 1230, 1450, 172, 'Data Storage Layer')
box(150, 1266, 390, 100, 'Upload Job Queue', ['upload_jobs', 'leased, idempotent'])
box(660, 1266, 390, 100, 'Thesis PDF Repository', ['Supabase Storage', 'private bucket'])
box(1130, 1266, 390, 100, 'Vector Database', ['Supabase pgvector', 'vector(768)'])

# --------------------------------------------------------------------------
# actor -> interface
# --------------------------------------------------------------------------
path([(210, 152), (210, 200), (250, 200), (250, 247)], ACTOR)
path([(360, 152), (360, 200), (400, 200), (400, 247)], ACTOR)
path([(1090, 152), (1090, 247)], ACTOR)
path([(1240, 152), (1240, 247)], ACTOR)
path([(1400, 152), (1400, 247)], ACTOR)

# --------------------------------------------------------------------------
# ingestion path (amber)
# --------------------------------------------------------------------------
path([(355, 315), (355, 408)], INGEST,
     'multipart upload', (367, 368), 'start')

# stage the private PDF - down the centre gutter
path([(560, 440), (600, 440), (600, 1208), (855, 1208), (855, 1266)], INGEST,
     'stage private PDF', (612, 706), 'start')

# reserve + queue the job - down the left rail
path([(150, 470), (72, 470), (72, 1300), (150, 1300)], INGEST,
     'queue job', (84, 640), 'start')

# worker claims the lease - back up the left rail
path([(150, 1340), (100, 1340), (100, 930), (150, 930)], INGEST,
     'claim (lease)', (112, 1010), 'start')

path([(345, 968), (345, 1058)], INGEST, 'extract', (357, 1018), 'start')
path([(540, 1117), (660, 1117)], INGEST, 'split', (600, 1110))
path([(1050, 1117), (1130, 1117)], INGEST, 'embed', (1090, 1110))
path([(1325, 1176), (1325, 1266)], INGEST,
     'atomic commit|(metadata + vectors)', (1337, 1206), 'start')
path([(450, 890), (450, 598)], INGEST, 'ingest screen', (462, 750), 'start')

# --------------------------------------------------------------------------
# retrieval path (teal)
# --------------------------------------------------------------------------
path([(1260, 315), (1260, 408)], RETRIEVE, 'API request', (1272, 368), 'start')
path([(1260, 474), (1260, 498)], RETRIEVE)
path([(1000, 548), (560, 548)], RETRIEVE, 'query novelty check', (780, 541))
path([(1000, 578), (958, 578), (958, 1006), (1230, 1006), (1230, 1058)], RETRIEVE,
     'embed query', (946, 760), 'end')
path([(1520, 528), (1596, 528), (1596, 1316), (1520, 1316)], RETRIEVE,
     'match_chunks', (1584, 470), 'end')
path([(1260, 598), (1260, 622)], RETRIEVE)
path([(1260, 684), (1260, 708)], RETRIEVE, 'draft answer', (1272, 704), 'start')
path([(1520, 748), (1632, 748), (1632, 281), (1520, 281)], RETRIEVE,
     'cited answer', (1620, 372), 'end')

# --------------------------------------------------------------------------
# legend
# --------------------------------------------------------------------------
parts.append(
    f'<rect x="1000" y="852" width="560" height="140" rx="12" fill="#FFFFFF" '
    f'stroke="{CONTAINER_BORDER}" stroke-width="1.6"/>'
)
parts.append(
    f'<text x="1026" y="879" font-size="13.5" font-weight="700" letter-spacing="1.4" '
    f'fill="{CONTAINER_TITLE}">LEGEND</text>'
)
parts.append(f'<line x1="1028" y1="909" x2="1084" y2="909" stroke="{INGEST}" stroke-width="2.4"/>')
parts.append(
    f'<text x="1098" y="914" font-size="13" fill="{INK}">'
    f'Ingestion path — the API stages and queues; a leased worker commits</text>'
)
parts.append(f'<line x1="1028" y1="941" x2="1084" y2="941" stroke="{RETRIEVE}" stroke-width="2.4"/>')
parts.append(
    f'<text x="1098" y="946" font-size="13" fill="{INK}">'
    f'Retrieval path — closed-domain; every answer is cited, metadata only</text>'
)
parts.append(
    f'<text x="1026" y="972" font-size="12" font-style="italic" fill="{CONTAINER_TITLE}">'
    f'No API response exposes a PDF URL, storage path, or manuscript text.</text>'
)

parts.append(
    f'<text x="1026" y="990" font-size="12" font-style="italic" fill="{CONTAINER_TITLE}">'
    f'Upload is admin-default; it may be granted to student and faculty roles.</text>'
)

parts.append('</svg>')

open('Figure8_System_Architecture.svg', 'w', encoding='utf-8').write('\n'.join(parts))
print('wrote Figure8_System_Architecture.svg')
