"""Generate the plain-language system overview figure (SVG).

Figure 8 in the paper is the complete component map; it is correct but dense,
and in a walkthrough you end up narrating boxes instead of the mechanism. This
figure makes one claim instead: two flows meet at one archive, and there are
four places where the system is allowed to say no.

Hand-laid-out for the same reason Figure 8 is - auto-layout routes the write
and read edges through the middle band.

    python Figure_System_Overview.build.py [outdir]   -> IskAI_System_Overview.svg
"""
import sys
from pathlib import Path

W, H = 1600, 850

INK = '#1E293B'
MUTED = '#475569'
FAINT = '#64748B'
BOX_FILL = '#F8FAFC'
BOX_BORDER = '#94A3B8'
INGEST = '#B45309'
ASK = '#0F766E'
STORE = '#4338CA'
GUARD_INK = '#B91C1C'
GUARD_FILL = '#FEF2F2'
GUARD_BORDER = '#FCA5A5'

parts: list[str] = []


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text(x, y, s, size=12.5, fill=MUTED, weight=None, anchor=None, spacing=None):
    a = f' text-anchor="{anchor}"' if anchor else ''
    w = f' font-weight="{weight}"' if weight else ''
    ls = f' letter-spacing="{spacing}"' if spacing else ''
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}"{w}{a}{ls}>{esc(s)}</text>')


def guard_pill(x, y):
    parts.append(f'<rect x="{x}" y="{y}" width="84" height="20" rx="10" '
                 f'fill="{GUARD_FILL}" stroke="{GUARD_BORDER}" stroke-width="1.2"/>')
    parts.append(f'<path d="M{x + 13} {y + 5.5} l5 -1.8 5 1.8 v4.2 c0 3.2 -2.1 5.4 -5 6.4 '
                 f'c-2.9 -1 -5 -3.2 -5 -6.4 z" fill="none" stroke="{GUARD_INK}" '
                 f'stroke-width="1.4" stroke-linejoin="round"/>')
    text(x + 29, y + 14.2, 'guardrail', 10.5, GUARD_INK, '700', spacing='0.5')


def step(x, y, w, h, n, accent, title, lines, guard=False):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="11" fill="{BOX_FILL}" '
                 f'stroke="{BOX_BORDER}" stroke-width="1.5"/>')
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="5" rx="2.5" fill="{accent}"/>')
    parts.append(f'<circle cx="{x + 26}" cy="{y + 31}" r="13.5" fill="{accent}"/>')
    text(x + 26, y + 35.5, str(n), 13.5, '#FFFFFF', '700', 'middle')
    text(x + 48, y + 36, title, 15.5, INK, '700')
    for i, line in enumerate(lines):
        text(x + 22, y + 62 + i * 18, line, 12.5, MUTED)
    if guard:
        guard_pill(x + 22, y + h - 30)


def lane_label(x, y, accent, label, note):
    parts.append(f'<rect x="{x}" y="{y - 11}" width="13" height="13" rx="3.5" fill="{accent}"/>')
    text(x + 22, y, label.upper(), 13, accent, '800', spacing='1.6')
    text(x + 46 + 9.6 * len(label), y, note, 13, FAINT)


def arrow(x1, y1, x2, y2, color, dash=False):
    d = ' stroke-dasharray="6 5"' if dash else ''
    mk = 'ar_i' if color == INGEST else ('ar_a' if color == ASK else 'ar_s')
    parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
                 f'stroke-width="2.2" marker-end="url(#{mk})"{d}/>')


# ---------------------------------------------------------------- header ---
text(62, 52, 'IskAI \u2014 how one thesis gets in, and how one question gets answered', 26, INK, '800')
text(62, 79, 'A centralized AI-powered thesis library using retrieval-augmented generation \u00b7 ISU CCSICT',
     14.5, FAINT)

# ------------------------------------------------------- ingestion lane ---
ING_X = [62, 366, 670, 974, 1278]
ING_W, ING_H, ING_Y = 260, 132, 132
lane_label(62, 118, INGEST, 'Ingestion',
           '\u2014 a librarian adds a thesis. Runs in a separate worker, never in the web request.')

ingest = [
    ('Faculty uploads a PDF', ['Signed in, approved account', 'Department and program chosen',
                               '25 MB / 500 page ceiling'], False),
    ('The API only queues it', ['File staged in a private bucket', 'Job keyed by Idempotency-Key',
                                'Re-sending the form adds nothing'], False),
    ('A worker picks it up', ['Holds a lease, sends heartbeats', 'Virus scan + SHA-256 check',
                              'Text extraction, OCR if scanned'], False),
    ('Chunk, then embed', ['800 tokens, 100 overlap', 'gemini-embedding-001',
                           '768 numbers per chunk'], False),
    ('Screen, then commit', ['\u2265 0.85 to an existing thesis', 'is flagged before it lands',
                             'One transaction, fingerprinted'], True),
]
for i, (t, ls, g) in enumerate(ingest):
    step(ING_X[i], ING_Y, ING_W, ING_H, i + 1, INGEST, t, ls, g)
    if i < 4:
        arrow(ING_X[i] + ING_W + 9, ING_Y + ING_H / 2, ING_X[i + 1] - 9, ING_Y + ING_H / 2, INGEST)

# ------------------------------------------------------------- archive ---
BUS_Y, BUS_H = 348, 142
parts.append(f'<rect x="62" y="{BUS_Y}" width="1476" height="{BUS_H}" rx="14" fill="#EEF2FF" '
             f'stroke="{STORE}" stroke-width="1.8"/>')
text(86, BUS_Y + 34, 'THE ARCHIVE', 13, STORE, '800', spacing='1.6')
text(206, BUS_Y + 34, '\u2014 Supabase Postgres + pgvector. One store, written by the top flow, read by the bottom one.',
     13.5, MUTED)

pills = [
    ('Approved papers', 'title, authors, year, department'),
    ('Chunks \u00b7 vector(768)', 'stamped with the index fingerprint'),
    ('Chat history', 'per signed-in session'),
    ('Roles + departments', 'enforced in Python, not in the browser'),
]
px, pw = 86, 350
for i, (t, s) in enumerate(pills):
    x = px + i * (pw + 14)
    parts.append(f'<rect x="{x}" y="{BUS_Y + 50}" width="{pw}" height="58" rx="9" fill="#FFFFFF" '
                 f'stroke="#C7D2FE" stroke-width="1.4"/>')
    text(x + 18, BUS_Y + 74, t, 13.5, INK, '700')
    text(x + 18, BUS_Y + 94, s, 11.8, FAINT)

text(86, BUS_Y + 128, 'The manuscript itself is never handed to a reader \u2014 only its metadata and the passages it is cited for.',
     12.5, STORE)

# write edge
arrow(1408, ING_Y + ING_H + 8, 1408, BUS_Y - 8, INGEST)
text(1396, BUS_Y - 28, 'writes chunks + provenance', 12.5, INGEST, '600', 'end')

# ------------------------------------------------------------- ask lane ---
ASK_X = [61, 314, 567, 820, 1073, 1326]
ASK_W, ASK_H, ASK_Y = 213, 152, 566
lane_label(62, 548, ASK, 'A question',
           '— a reader asks. Retrieval is milliseconds; the wait is the model.')

ask = [
    ('A reader asks', ['Student, faculty, or guest', 'Plain language, no query syntax'], False),
    ('Intent guard', ['Refuses \u201cwrite my chapter 2\u201d', 'Answers \u201cwhat methodology',
                      'did those studies use?\u201d'], True),
    ('Retrieve', ['Question becomes a vector', 'Cosine \u2265 0.30, top 15',
                  'Only your department'], True),
    ('Keep five blocks', ['Rerank: meaning + wording', '\u2264 3 chunks from one thesis',
                          'Strongest placed at the edges'], False),
    ('Generate', ['gemini-3.6-flash', 'May use those five blocks',
                  'and nothing else it knows'], False),
    ('Check, then answer', ['Every [n] matched to a block', 'Uncited sources dropped',
                            'Answer + the papers it used'], True),
]
for i, (t, ls, g) in enumerate(ask):
    step(ASK_X[i], ASK_Y, ASK_W, ASK_H, i + 1, ASK, t, ls, g)
    if i < 5:
        arrow(ASK_X[i] + ASK_W + 8, ASK_Y + ASK_H / 2, ASK_X[i + 1] - 8, ASK_Y + ASK_H / 2, ASK)

# read edges
arrow(640, ASK_Y - 8, 640, BUS_Y + BUS_H + 8, ASK)
text(628, BUS_Y + BUS_H + 38, 'query vector', 12.5, ASK, '600', 'end')
arrow(714, BUS_Y + BUS_H + 8, 714, ASK_Y - 8, ASK)
text(726, BUS_Y + BUS_H + 38, 'the passages that match', 12.5, ASK, '600')

# -------------------------------------------------------------- footer ---
FY = 744
claims = [
    ('Closed-domain', 'If the archive has no passage for it, the answer is “I don’t have that,” not a guess.'),
    ('Citation-backed', 'Every claim carries an [n] a reader can trace back to a real retrieved passage.'),
    ('Advisory', 'It flags a 0.85 overlap and refuses to ghostwrite. It never decides for a human.'),
]
for i, (t, s) in enumerate(claims):
    x = 61 + i * 498
    parts.append(f'<rect x="{x}" y="{FY}" width="484" height="70" rx="11" fill="#FFFFFF" '
                 f'stroke="#CBD5E1" stroke-width="1.4"/>')
    parts.append(f'<circle cx="{x + 32}" cy="{FY + 35}" r="14" fill="none" stroke="{INK}" stroke-width="1.6"/>')
    parts.append(f'<path d="M{x + 25} {FY + 35} l5 5.5 l10 -11.5" fill="none" stroke="{INK}" '
                 f'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')
    text(x + 58, FY + 30, t, 14.5, INK, '700')
    text(x + 58, FY + 51, s, 11.8, FAINT)

# --------------------------------------------------------------- output ---
defs = ''.join(
    f'<marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" '
    f'markerHeight="6.5" orient="auto-start-reverse">'
    f'<path d="M0 0 L10 5 L0 10 z" fill="{col}"/></marker>'
    for mid, col in (('ar_i', INGEST), ('ar_a', ASK), ('ar_s', STORE))
)

ARIA = ('Two flows meet at one archive: ingestion writes embedded chunks into Supabase '
        'pgvector, and a question reads five passages back out before the model may answer, '
        'with four guardrails along the way.')

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
    f'role="img" aria-label="{ARIA}" '
    f'font-family="Inter, Segoe UI, Helvetica Neue, Arial, sans-serif">'
    f'<defs>{defs}</defs>'
    f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>'
    + ''.join(parts) +
    '</svg>\n'
)

outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
target = outdir / 'IskAI_System_Overview.svg'
target.write_bytes(svg.encode('utf-8'))
print(f'wrote {target}  ({len(svg)} bytes)')
