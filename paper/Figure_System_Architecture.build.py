"""Generate the phase-card System Architecture figure (SVG).

Same reading order as the walkthrough: the top row builds the archive, the
bottom row answers a question. Hand-laid-out; the row-wrap elbow and the wide
phase-7 card are the two things auto-layout always gets wrong.

    python Figure_System_Architecture.build.py [outdir] -> IskAI_System_Architecture.svg
"""
import sys
from pathlib import Path

W, H = 2000, 1350

PAGE = '#FAF8F3'
PANEL_BORDER = '#E3E5E8'
INK = '#111827'
SOFT = '#374151'
FAINT = '#6B7280'
CARD_BORDER = '#C9CDD3'
RULE = '#DCE0E5'
NAVY = '#1F3A4D'
OK = '#15803D'
NO = '#DC2626'

parts: list[str] = []


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text(x, y, s, size=11.5, fill=SOFT, weight=None, anchor=None, spacing=None):
    a = f' text-anchor="{anchor}"' if anchor else ''
    w = f' font-weight="{weight}"' if weight else ''
    ls = f' letter-spacing="{spacing}"' if spacing else ''
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}"{w}{a}{ls}>{esc(s)}</text>')


def rule(x1, x2, y, color=RULE, dash=False, width=1.1):
    d = ' stroke-dasharray="4 4"' if dash else ''
    parts.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" '
                 f'stroke-width="{width}"{d}/>')


def vrule(x, y1, y2, color=RULE):
    parts.append(f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="{color}" stroke-width="1.1"/>')


def card(x, y, w, h, phase, name_lines):
    """Card shell + centred header. Returns the y of the header separator."""
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="#FFFFFF" '
                 f'stroke="{CARD_BORDER}" stroke-width="1.3"/>')
    cx = x + w / 2
    text(cx, y + 34, f'PHASE {phase}', 17, INK, '800', 'middle', '1.3')
    for i, line in enumerate(name_lines):
        text(cx, y + 58 + i * 21, line.upper(), 15, INK, '700', 'middle', '0.7')
    sep = y + 58 + len(name_lines) * 21 + 6
    rule(x, x + w, sep)
    return sep


def bullets(x, y, items, size=14.5, step=25, fill=SOFT):
    for i, it in enumerate(items):
        yy = y + i * step
        if it.startswith('  '):                      # continuation line
            text(x + 16, yy, it.strip(), size, fill)
        else:
            parts.append(f'<circle cx="{x + 4}" cy="{yy - 4.5}" r="2.5" fill="{FAINT}"/>')
            text(x + 16, yy, it, size, fill)
    return y + len(items) * step


def outcome(x, w, y, label, lines):
    rule(x + 16, x + w - 16, y, RULE, dash=True)
    cx = x + w / 2
    text(cx, y + 26, label, 14, INK, '800', 'middle', '0.6')
    for i, line in enumerate(lines):
        text(cx, y + 48 + i * 20, line, 13.5, FAINT, None, 'middle')


def arrow(x1, y1, x2, y2):
    parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{INK}" '
                 f'stroke-width="1.6" marker-end="url(#ar)"/>')


def elbow(pts):
    d = ' '.join(('M' if i == 0 else 'L') + f'{px} {py}' for i, (px, py) in enumerate(pts))
    parts.append(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="1.6" '
                 f'marker-end="url(#ar)"/>')


def icon(kind, cx, cy):
    """Line-art glyph drawn inside a 46 x 46 box centred on (cx, cy)."""
    g = [f'<g transform="translate({cx} {cy}) scale(1.28) translate({-cx} {-cy})" '
         f'fill="none" stroke="{INK}" stroke-width="1.5" stroke-linecap="round" '
         f'stroke-linejoin="round">']
    if kind == 'pdf':
        g.append(f'<path d="M{cx - 15} {cy - 21} h20 l10 10 v32 h-30 z"/>')
        g.append(f'<path d="M{cx + 5} {cy - 21} v10 h10"/>')
        for i in range(3):
            g.append(f'<line x1="{cx - 8}" y1="{cy - 1 + i * 8}" x2="{cx + 10}" y2="{cy - 1 + i * 8}"/>')
    elif kind == 'gear':
        g.append(f'<circle cx="{cx}" cy="{cy}" r="8"/>')
        g.append(f'<circle cx="{cx}" cy="{cy}" r="17"/>')
        for a in (0, 60, 120, 180, 240, 300):
            import math
            r1, r2 = 17, 22
            rad = math.radians(a)
            g.append(f'<line x1="{cx + r1 * math.cos(rad):.1f}" y1="{cy + r1 * math.sin(rad):.1f}" '
                     f'x2="{cx + r2 * math.cos(rad):.1f}" y2="{cy + r2 * math.sin(rad):.1f}"/>')
    elif kind == 'grid':
        g.append(f'<rect x="{cx - 20}" y="{cy - 16}" width="40" height="32" rx="3"/>')
        g.append(f'<line x1="{cx - 20}" y1="{cy}" x2="{cx + 20}" y2="{cy}"/>')
        g.append(f'<line x1="{cx - 7}" y1="{cy - 16}" x2="{cx - 7}" y2="{cy + 16}"/>')
        g.append(f'<line x1="{cx + 7}" y1="{cy - 16}" x2="{cx + 7}" y2="{cy + 16}"/>')
    elif kind == 'person':
        g.append(f'<circle cx="{cx}" cy="{cy - 10}" r="9"/>')
        g.append(f'<path d="M{cx - 18} {cy + 19} a18 18 0 0 1 36 0"/>')
    elif kind == 'search':
        g.append(f'<circle cx="{cx - 4}" cy="{cy - 4}" r="14"/>')
        g.append(f'<line x1="{cx + 7}" y1="{cy + 7}" x2="{cx + 18}" y2="{cy + 18}"/>')
    elif kind == 'chat':
        g.append(f'<path d="M{cx - 20} {cy - 16} h40 v26 h-26 l-10 9 v-9 h-4 z"/>')
        g.append(f'<line x1="{cx - 11}" y1="{cy - 6}" x2="{cx + 11}" y2="{cy - 6}"/>')
        g.append(f'<line x1="{cx - 11}" y1="{cy + 2}" x2="{cx + 4}" y2="{cy + 2}"/>')
    elif kind == 'db':
        g.append(f'<ellipse cx="{cx}" cy="{cy - 13}" rx="17" ry="6.5"/>')
        g.append(f'<path d="M{cx - 17} {cy - 13} v26 a17 6.5 0 0 0 34 0 v-26"/>')
        g.append(f'<path d="M{cx - 17} {cy} a17 6.5 0 0 0 34 0"/>')
    elif kind == 'doc':
        g.append(f'<path d="M{cx - 14} {cy - 19} h18 l10 10 v28 h-28 z"/>')
        for i in range(3):
            g.append(f'<line x1="{cx - 7}" y1="{cy - 2 + i * 8}" x2="{cx + 9}" y2="{cy - 2 + i * 8}"/>')
    elif kind == 'check':
        g.append(f'<circle cx="{cx}" cy="{cy}" r="17"/>')
        g.append(f'<path d="M{cx - 8} {cy} l6 6.5 l11 -13"/>')
    elif kind == 'lock':
        g.append(f'<rect x="{cx - 14}" y="{cy - 3}" width="28" height="21" rx="3.5"/>')
        g.append(f'<path d="M{cx - 8} {cy - 3} v-7 a8 8 0 0 1 16 0 v7"/>')
    g.append('</g>')
    parts.append(''.join(g))


def decision(cx, y, yes, no):
    """Two outcome discs under a short fork, like a review gate."""
    lx, rx = cx - 72, cx + 72
    parts.append(f'<path d="M{cx} {y} v12 M{lx} {y + 12} h144 M{lx} {y + 12} v12 M{rx} {y + 12} v12" '
                 f'fill="none" stroke="{INK}" stroke-width="1.3"/>')
    for x, col, glyph, lines in ((lx, OK, 'ok', yes), (rx, NO, 'no', no)):
        cy = y + 40
        parts.append(f'<circle cx="{x}" cy="{cy}" r="14" fill="none" stroke="{col}" stroke-width="1.8"/>')
        if glyph == 'ok':
            parts.append(f'<path d="M{x - 5.5} {cy} l4 4.5 l7.5 -9" fill="none" stroke="{col}" '
                         f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
        else:
            parts.append(f'<path d="M{x - 5} {cy - 5} l10 10 M{x + 5} {cy - 5} l-10 10" fill="none" '
                         f'stroke="{col}" stroke-width="2" stroke-linecap="round"/>')
        for i, line in enumerate(lines):
            text(x, cy + 34 + i * 19, line, 13, SOFT if i == 0 else FAINT,
                 '700' if i == 0 else None, 'middle')


# ================================================================ layout ===
parts.append(f'<rect width="{W}" height="{H}" fill="{PAGE}"/>')
text(60, 96, 'System Architecture', 52, NAVY, '800')
parts.append(f'<rect x="62" y="118" width="80" height="6" rx="3" fill="{NAVY}"/>')
text(62, 164, 'IskAI — a centralized AI-powered thesis library using retrieval-augmented '
              'generation · ISU CCSICT', 17, FAINT)

parts.append(f'<rect x="60" y="200" width="1880" height="1110" rx="10" fill="#FFFFFF" '
             f'stroke="{PANEL_BORDER}" stroke-width="1.4"/>')

R1X = [122, 574, 1026, 1478]
R2X = [122, 574, 1026]
CW, CH = 400, 470
R1Y, R2Y = 250, 800

text(122, 232, 'BUILDING THE ARCHIVE', 14.5, INK, '800', spacing='1.2')
text(352, 232, '— once per thesis, in a background worker', 14.5, FAINT)
text(122, 750, 'ANSWERING A QUESTION', 14.5, INK, '800', spacing='1.2')
text(357, 750, '— once per question, in seconds', 14.5, FAINT)

ROW1 = [
    ('1', ['Upload &', 'Intake'], 'pdf', [
        'Faculty or admin, signed in',
        'PDF up to 25 MB / 500 pages',
        'Department + program tagged',
        'Stored in a private bucket',
        'Queued, never processed inline',
    ], 'OUTPUT:', ['A queued ingestion job', '(the web request ends here)']),
    ('2', ['Safety &', 'Extraction'], 'gear', [
        'A background worker picks it up',
        'Held with a timer — a crash frees it',
        'SHA-256 rejects a re-upload',
        'ClamAV virus scan',
        'PyMuPDF text extraction',
        'Tesseract OCR for scanned pages',
        'Headers, page numbers, PII removed',
    ], 'OUTPUT:', ['Clean manuscript text']),
    ('3', ['Chunk &', 'Embed'], 'grid', [
        'Recursive character splitter',
        '800 tokens, 100 overlap',
        'cl100k_base as a fixed proxy',
        'gemini-embedding-001',
        '768 numbers per chunk',
    ], 'OUTPUT:', ['Embedded chunks, each stamped', 'with the index fingerprint']),
]
for i, (n, name, ic, bl, olab, olines) in enumerate(ROW1):
    x = R1X[i]
    sep = card(x, R1Y, CW, CH, n, name)
    icon(ic, x + CW / 2, sep + 44)
    bullets(x + 22, sep + 92, bl)
    outcome(x, CW, R1Y + CH - 84, olab, olines)

# phase 4 - the review gate
x4 = R1X[3]
sep4 = card(x4, R1Y, CW, CH, '4', ['Novelty Screen', 'Human-in-the-loop'])
icon('person', x4 + CW / 2, sep4 + 40)
bullets(x4 + 22, sep4 + 92, [
    'Compared against every thesis',
    'Cosine similarity, 0.85 threshold',
    'Advisory — never an automatic reject',
])
decision(x4 + CW / 2, sep4 + 178,
         ['Below 0.85', 'Commit to archive'],
         ['0.85 or above', 'Adviser reviews'])
outcome(x4, CW, R1Y + CH - 84, 'OUTPUT:', ['The paper is live in the archive'])

for i in range(3):
    arrow(R1X[i] + CW + 8, R1Y + CH / 2, R1X[i + 1] - 8, R1Y + CH / 2)
elbow([(R1X[3] + CW / 2, R1Y + CH), (R1X[3] + CW / 2, 770), (R2X[0] + CW / 2, 770),
       (R2X[0] + CW / 2, R2Y - 8)])


ROW2 = [
    ('5', ['Retrieve'], 'search', [
        'The question becomes a vector',
        'match_chunks, cosine \u2265 0.30',
        'Locked to your department',
        'Top 15 candidates pooled',
        'Rerank on meaning + wording',
        '\u2264 3 chunks from one thesis',
    ], ['Exactly 5 passages, strongest', 'placed at the edges']),
    ('6', ['Guard &', 'Generate'], 'chat', [
        'Refuses \u201cwrite my chapter 2\u201d',
        'Answers \u201cwhat methodology\u2026\u201d',
        'Prompt = those 5 passages only',
        'gemini-3.6-flash writes the answer',
        'Every [n] checked against them',
        'Uncited sources are dropped',
    ], ['A cited answer \u2014 or \u201cthat is not', 'in the archive,\u201d never a guess']),
]
for i, (n, name, ic, bl, olines) in enumerate(ROW2):
    x = R2X[i]
    sep = card(x, R2Y, CW, CH, n, name)
    icon(ic, x + CW / 2, sep + 44)
    bullets(x + 22, sep + 92, bl)
    outcome(x, CW, R2Y + CH - 84, 'OUTPUT:', olines)

# phase 7 - wide delivery card
x7, w7 = R2X[2], 852
sep7 = card(x7, R2Y, w7, CH, '7', ['Delivery & Record'])
cols = [
    ('chat', 'Cited Answer', ['Plain language', 'Every claim carries [n]']),
    ('doc', 'Source List', ['Title, authors, year', 'Metadata only']),
    ('db', 'Chat History', ['Saved per session', 'Signed-in users only']),
    ('lock', 'The PDF Stays Put', ['No manuscript is ever', 'served to a reader']),
]
colw = w7 / 4
for i, (ic, label, lines) in enumerate(cols):
    cx = x7 + colw * i + colw / 2
    if i:
        vrule(x7 + colw * i, sep7 + 14, R2Y + CH - 104)
    icon(ic, cx, sep7 + 58)
    text(cx, sep7 + 124, label, 16, INK, '700', 'middle')
    for j, line in enumerate(lines):
        text(cx, sep7 + 154 + j * 21, line, 13.5, FAINT, None, 'middle')
outcome(x7, w7, R2Y + CH - 84, 'END:',
        ['The reader gets an answer they can check. The archive keeps the record.'])

arrow(R2X[0] + CW + 8, R2Y + CH / 2, R2X[1] - 8, R2Y + CH / 2)
arrow(R2X[1] + CW + 8, R2Y + CH / 2, R2X[2] - 8, R2Y + CH / 2)

# --------------------------------------------------------------- output ---
ARIA = ('System architecture in seven phases: the top row builds the archive '
        '(upload, safety and extraction, chunk and embed, novelty screen), and the '
        'bottom row answers a question (retrieve, guard and generate, delivery).')
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
    f'role="img" aria-label="{ARIA}" '
    f'font-family="Inter, Segoe UI, Helvetica Neue, Arial, sans-serif">'
    f'<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
    f'markerHeight="6" orient="auto-start-reverse">'
    f'<path d="M0 0 L10 5 L0 10 z" fill="{INK}"/></marker></defs>'
    + ''.join(parts) + '</svg>\n'
)

outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
target = outdir / 'IskAI_System_Architecture.svg'
target.write_bytes(svg.encode('utf-8'))
print(f'wrote {target}  ({len(svg)} bytes)')
