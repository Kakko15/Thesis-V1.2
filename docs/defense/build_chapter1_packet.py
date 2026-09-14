"""Build the printed Chapter 1 excerpt the panel holds during the system defense.

The four sections the adviser asked to be printed -- title page, objectives, system
architecture, AI pipeline -- are reproduced *unmodified* from ``paper/paper_CORRECTED.pdf``
so that the sheet in a panelist's hand and the page in the manuscript are identical.
Only the cover sheet is generated, and it carries the provenance (source file, its SHA-256,
the manuscript page ranges) so a panelist can verify any page against the full paper.

Run from the repository root with the backend venv, which already pins PyMuPDF:

    rag-thesis-backend/.venv/Scripts/python.exe docs/defense/build_chapter1_packet.py

Output lands in the gitignored ``tmp/defense/``, matching how ``docs/deck`` keeps its
generator committed and its renders scratch.
"""

from __future__ import annotations

import hashlib
import sys
from datetime import date
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'paper' / 'paper_CORRECTED.pdf'
OUT_DIR = ROOT / 'tmp' / 'defense'
OUT = OUT_DIR / 'Chapter1_Defense_Packet.pdf'

A4 = fitz.paper_rect('a4')
SERIF = 'tiro'          # Times-Roman, the manuscript's face
SERIF_BOLD = 'tibo'
MONO = 'cour'
READ_BLOCK = 1048576

# (label, first manuscript page, last manuscript page, what the panel is looking at)
SECTIONS = (
    ('Title Page', 1, 1,
     'Manuscript cover: title, degree, researchers.'),
    ('1.2 Objectives of the Study', 3, 4,
     'General objective, then the four specific objectives with the ISO/IEC 25010 sub-criteria.'),
    ('3.3 System Architecture', 56, 59,
     'The four-layer architecture. The section heading falls at the foot of p. 56; '
     'Figure 8 is reproduced full-page on p. 59.'),
    ('Figure 1 - Algorithmic Flow of RAG', 16, 16,
     'The AI pipeline as a diagram: retrieval, augmentation, generation.'),
    ('3.2.3 System Procedures', 48, 51,
     'The AI pipeline in prose: digitization and cleaning, semantic indexing and metadata '
     'injection, retrieval with reordering and thresholds, system integration.'),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(READ_BLOCK), b''):
            digest.update(block)
    return digest.hexdigest()


def draw_cover(page, rows, fingerprint):
    """Lay out the index sheet; raise if a textbox cannot hold its text."""
    left, right = 64.0, A4.width - 64.0
    state = {'y': 74.0}

    def box(text, size, font, gap, align=fitz.TEXT_ALIGN_LEFT):
        rect = fitz.Rect(left, state['y'], right, state['y'] + size * 8 + 4)
        used = page.insert_textbox(rect, text, fontsize=size, fontname=font,
                                   align=align, lineheight=1.28)
        if used < 0:
            raise SystemExit(f'cover overflow: {text[:48]!r} needs {-used:.0f} more points')
        state['y'] += (rect.height - used) + gap

    def rule(shade, width):
        page.draw_line(fitz.Point(left, state['y']), fitz.Point(right, state['y']),
                       color=(shade, shade, shade), width=width)

    box('ISABELA STATE UNIVERSITY  -  ECHAGUE, ISABELA', 9.5, SERIF, 2.0)
    box('College of Computing Studies, Information and Communication Technology', 9.5, SERIF, 16.0)
    box('SYSTEM DEFENSE  -  PRINTED MANUSCRIPT EXCERPT', 15.0, SERIF_BOLD, 8.0)
    box('A Centralized AI-Powered Thesis Library Using '
        'Retrieval-Augmented Generation', 12.5, SERIF, 6.0)
    box('Ahron John F. Barlis  -  Carlo Rossi P. Gallardo      '
        'BS Computer Science, Data Mining Track', 10.0, SERIF, 12.0)

    rule(0.2, 0.8)
    state['y'] += 16.0

    box('Every page after this cover is reproduced unmodified from the corrected manuscript. '
        'The manuscript page number printed at the top of each sheet is the authoritative '
        'reference; the packet column below is only this booklet running order.',
        10.0, SERIF, 20.0)

    col_packet, col_pages, col_section = left, left + 62.0, left + 140.0
    head = state['y']
    for label, x in (('Packet', col_packet), ('Manuscript', col_pages), ('Section', col_section)):
        page.insert_textbox(fitz.Rect(x, head, x + 200, head + 16), label,
                            fontsize=9.0, fontname=SERIF_BOLD)
    state['y'] += 15.0
    rule(0.55, 0.5)
    state['y'] += 9.0

    for packet_pages, manuscript_pages, label, note in rows:
        top = state['y']
        page.insert_textbox(fitz.Rect(col_packet, top, col_packet + 60, top + 30),
                            packet_pages, fontsize=9.5, fontname=SERIF)
        page.insert_textbox(fitz.Rect(col_pages, top, col_pages + 74, top + 30),
                            manuscript_pages, fontsize=9.5, fontname=SERIF)
        rect = fitz.Rect(col_section, top, right, top + 120)
        used = page.insert_textbox(rect, f'{label}\n{note}', fontsize=9.5, fontname=SERIF,
                                   lineheight=1.25)
        if used < 0:
            raise SystemExit(f'index row overflow: {label!r}')
        state['y'] = top + (rect.height - used) + 11.0

    state['y'] += 6.0
    rule(0.55, 0.5)
    state['y'] += 14.0
    box(f'Source  paper/paper_CORRECTED.pdf\nSHA-256  {fingerprint}\n'
        f'Built  {date.today().isoformat()}     Regenerate  '
        f'docs/defense/build_chapter1_packet.py',
        8.0, MONO, 0.0)


def main():
    if not SOURCE.exists():
        print(f'missing {SOURCE}; run paper/build_corrections.py first', file=sys.stderr)
        return 1

    fingerprint = sha256(SOURCE)
    src = fitz.open(SOURCE)
    out = fitz.open()
    out.new_page(width=A4.width, height=A4.height)   # cover, filled once ranges are known

    rows = []
    for label, first, last, note in SECTIONS:
        if last > src.page_count:
            raise SystemExit(f'{label}: manuscript has {src.page_count} pages, wanted p. {last}')
        start = out.page_count + 1
        out.insert_pdf(src, from_page=first - 1, to_page=last - 1)
        end = out.page_count
        packet = f'{start}' if start == end else f'{start}-{end}'
        manuscript = f'p. {first}' if first == last else f'pp. {first}-{last}'
        rows.append((packet, manuscript, label, note))

    draw_cover(out[0], rows, fingerprint)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out.set_metadata({
        'title': 'System Defense - Printed Manuscript Excerpt',
        'author': 'Ahron John F. Barlis; Carlo Rossi P. Gallardo',
        'subject': 'Chapter 1 title page and objectives, system architecture, AI pipeline',
        'creator': 'docs/defense/build_chapter1_packet.py',
    })
    out.save(OUT, garbage=4, deflate=True)

    print(f'{OUT.relative_to(ROOT)}  {out.page_count} pages  {OUT.stat().st_size / 1024:.0f} kB')
    for packet, manuscript, label, _ in rows:
        print(f'  packet {packet:<6} <- {manuscript:<10} {label}')
    print(f'  source sha256 {fingerprint}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
