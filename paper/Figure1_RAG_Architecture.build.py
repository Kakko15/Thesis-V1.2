"""Generate Figure 1 - the RAG architecture flow, as an SVG.

Faithful redraw of the original figure's design. Only two labels change, both
model names the corrected body text now contradicts:

    text-embedding-004  ->  gemini-embedding-001
    Gemini 1.5 Flash    ->  Gemini 3.6 Flash

Everything else - the seven steps, their wording, the two-row wrap, the colour
assignment and the icon vocabulary - is reproduced as it was.

    python Figure1_RAG_Architecture.build.py   -> Figure1_RAG_Architecture.svg
"""

W, H = 2048, 880

TITLE_INK = '#202124'
CAPTION_INK = '#5F6368'
CARD_BORDER = '#E8EAED'
ARROW = '#3C4043'

CARD_W, CARD_H = 370, 377
ROW1_Y, ROW2_Y = 18, 460
COLS = [107, 580, 1052, 1525]

parts: list[str] = []


def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# --- icon glyphs, drawn white on the coloured disc -------------------------
def icon(kind, cx, cy):
    g = f'<g fill="none" stroke="#FFFFFF" stroke-width="5" ' \
        f'stroke-linecap="round" stroke-linejoin="round">'
    if kind == 'search':
        g += (f'<circle cx="{cx - 4}" cy="{cy - 5}" r="16"/>'
              f'<line x1="{cx + 8}" y1="{cy + 9}" x2="{cx + 19}" y2="{cy + 20}"/>')
    elif kind == 'transform':
        g += (f'<line x1="{cx - 10}" y1="{cy + 16}" x2="{cx - 10}" y2="{cy - 16}"/>'
              f'<polyline points="{cx - 20},{cy - 7} {cx - 10},{cy - 18} {cx},{cy - 7}"/>'
              f'<line x1="{cx + 10}" y1="{cy - 16}" x2="{cx + 10}" y2="{cy + 16}"/>'
              f'<polyline points="{cx},{cy + 7} {cx + 10},{cy + 18} {cx + 20},{cy + 7}"/>')
    elif kind == 'database':
        g += (f'<rect x="{cx - 18}" y="{cy - 19}" width="36" height="17" rx="4"/>'
              f'<rect x="{cx - 18}" y="{cy + 2}" width="36" height="17" rx="4"/>'
              f'<circle cx="{cx - 9}" cy="{cy - 10.5}" r="2.4" fill="#FFFFFF" stroke="none"/>'
              f'<circle cx="{cx - 9}" cy="{cy + 10.5}" r="2.4" fill="#FFFFFF" stroke="none"/>')
    elif kind == 'document':
        g += (f'<path d="M {cx - 15} {cy - 20} h 20 l 11 11 v 29 a 3 3 0 0 1 -3 3 '
              f'h -28 a 3 3 0 0 1 -3 -3 v -37 a 3 3 0 0 1 3 -3 z"/>'
              f'<line x1="{cx - 8}" y1="{cy + 3}" x2="{cx + 8}" y2="{cy + 3}"/>'
              f'<line x1="{cx - 8}" y1="{cy + 12}" x2="{cx + 8}" y2="{cy + 12}"/>')
    elif kind == 'reorder':
        g += (f'<line x1="{cx - 17}" y1="{cy - 13}" x2="{cx + 17}" y2="{cy - 13}"/>'
              f'<line x1="{cx - 17}" y1="{cy}" x2="{cx + 6}" y2="{cy}"/>'
              f'<line x1="{cx - 17}" y1="{cy + 13}" x2="{cx - 4}" y2="{cy + 13}"/>')
    elif kind == 'robot':
        g += (f'<rect x="{cx - 18}" y="{cy - 11}" width="36" height="28" rx="8"/>'
              f'<line x1="{cx}" y1="{cy - 11}" x2="{cx}" y2="{cy - 20}"/>'
              f'<circle cx="{cx}" cy="{cy - 22}" r="3" fill="#FFFFFF" stroke="none"/>'
              f'<circle cx="{cx - 7}" cy="{cy + 2}" r="3.2" fill="#FFFFFF" stroke="none"/>'
              f'<circle cx="{cx + 7}" cy="{cy + 2}" r="3.2" fill="#FFFFFF" stroke="none"/>'
              f'<line x1="{cx - 6}" y1="{cy + 11}" x2="{cx + 6}" y2="{cy + 11}"/>')
    elif kind == 'verified':
        points = []
        import math
        for i in range(16):
            angle = math.pi * 2 * i / 16 - math.pi / 2
            r = 22 if i % 2 == 0 else 17
            points.append(f'{cx + r * math.cos(angle):.1f},{cy + r * math.sin(angle):.1f}')
        g += (f'<polygon points="{" ".join(points)}" fill="#FFFFFF" stroke="none"/>')
        g += (f'<polyline points="{cx - 8},{cy} {cx - 2},{cy + 6} {cx + 9},{cy - 6}" '
              f'stroke-width="4.5"/>')
    return g + '</g>'


def card(x, y, colour, glyph, title, caption_lines):
    cx = x + CARD_W / 2
    parts.append(
        f'<rect x="{x}" y="{y}" width="{CARD_W}" height="{CARD_H}" rx="24" '
        f'fill="#FFFFFF" stroke="{CARD_BORDER}" stroke-width="2"/>'
    )
    disc_y = y + 94
    parts.append(f'<circle cx="{cx}" cy="{disc_y}" r="52" fill="{colour}"/>')
    stroke = '#FFFFFF' if glyph != 'verified' else colour
    parts.append(icon(glyph, cx, disc_y).replace('stroke="#FFFFFF"', f'stroke="{stroke}"', 1)
                 if glyph == 'verified' else icon(glyph, cx, disc_y))
    parts.append(
        f'<text x="{cx}" y="{y + 200}" font-size="30" font-weight="700" '
        f'text-anchor="middle" fill="{TITLE_INK}">{esc(title)}</text>'
    )
    for i, line in enumerate(caption_lines):
        parts.append(
            f'<text x="{cx}" y="{y + 249 + i * 30}" font-size="21" '
            f'text-anchor="middle" fill="{CAPTION_INK}">{esc(line)}</text>'
        )


def arrow(x1, x2, y):
    parts.append(
        f'<line x1="{x1}" y1="{y}" x2="{x2 - 12}" y2="{y}" stroke="{ARROW}" '
        f'stroke-width="4" stroke-linecap="round" marker-end="url(#tip)"/>'
    )


parts.append(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
    f'viewBox="0 0 {W} {H}" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif">'
)
parts.append(
    f'<defs><marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" '
    f'markerHeight="6" orient="auto-start-reverse">'
    f'<path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="{ARROW}" stroke-width="1.8" '
    f'stroke-linecap="round" stroke-linejoin="round"/></marker></defs>'
)
parts.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')

card(COLS[0], ROW1_Y, '#4285F4', 'search', 'User Query',
     ['Natural language research', 'question'])
card(COLS[1], ROW1_Y, '#EA4335', 'transform', 'Embedding Model',
     ['gemini-embedding-001 converts', 'to vectors'])
card(COLS[2], ROW1_Y, '#34A853', 'database', 'Vector Database',
     ['Supabase semantic similarity', 'search'])
card(COLS[3], ROW1_Y, '#FBBC04', 'document', 'Retrieved Context',
     ['Top-K matching thesis chunks'])

card(COLS[0], ROW2_Y, '#FF7A00', 'reorder', 'Context Reordering',
     ["Optimizes position to avoid 'Lost", "in the Middle'"])
card(COLS[1], ROW2_Y, '#A142F4', 'robot', 'LLM Prompt',
     ['Query + Context fed to Gemini', '3.6 Flash'])
card(COLS[2], ROW2_Y, '#12B5CB', 'verified', 'Final Answer',
     ['Citation-backed, localized', 'response'])

for a, b in ((0, 1), (1, 2), (2, 3)):
    arrow(COLS[a] + CARD_W + 14, COLS[b] - 14, ROW1_Y + 190)
for a, b in ((0, 1), (1, 2)):
    arrow(COLS[a] + CARD_W + 14, COLS[b] - 14, ROW2_Y + 190)

# the wrap from the end of row one to the start of row two
wrap_x = COLS[3] + CARD_W / 2 + 24
parts.append(
    f'<path d="M {wrap_x} {ROW1_Y + CARD_H + 4} V {ROW2_Y - 22} H {COLS[0] + CARD_W + 6}" '
    f'fill="none" stroke="#BDC1C6" stroke-width="3" stroke-dasharray="10 9" '
    f'stroke-linecap="round"/>'
)

parts.append('</svg>')
open('Figure1_RAG_Architecture.svg', 'w', encoding='utf-8').write('\n'.join(parts))
print('wrote Figure1_RAG_Architecture.svg')
