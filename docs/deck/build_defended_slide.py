"""Build the one-slide "System thesis defended" closing card, with the IskAI mark as the hero.

Separate from build.py's slide 11 on purpose. In the eleven-slide deck that slide is the end
of a Morph sequence: a node ring converges around the ISU seal, so its centre is committed to
the ring and the mark cannot go there -- dropped in, a solid book covered the headline.

As a standalone card there is no sequence to honour, so the composition inverts: the mark is
the subject, stacked above the headline rather than behind it, and the ring is gone. Nothing
overlaps anything.

Theme, fonts, colours and the measured text boxes are imported from the deck so this card and
the deck are visibly the same artefact.

    node docs/deck/logo_motif.mjs            # once, to render the mark
    tmp/deck/.venv/Scripts/python.exe -m docs.deck.logo_motif
    tmp/deck/.venv/Scripts/python.exe -m docs.deck.build_defended_slide [--out PATH]

Writes tmp/deck/out/IskAI_System_Thesis_Defended.pptx unless --out says otherwise.
"""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from pptx.util import Inches as I

from . import content as C, theme
from .build import ISU_SEAL, SH, SW, T, logo_dir
from .pptx_helpers import blank_slide, flat_picture, new_presentation, picture, set_notes

OUT_DEFAULT = Path(__file__).resolve().parents[2] / 'tmp' / 'deck' / 'out' / 'IskAI_System_Thesis_Defended.pptx'

# The mark render is a square canvas with the glow baked in and the book at ~72% of it, so the
# placed height is noticeably larger than the visible mark. 3.45 in of canvas reads as a ~2.5 in
# book, which is hero-sized without pushing the headline off the optical centre.
LOGO_CANVAS_H = 3.45
LOGO_TOP = 0.28
HEADLINE_Y = 3.62


def build(out: Path) -> Path:
    renders = logo_dir()
    mark = renders / 'orb_000.png'
    glow = renders / 'glow.png'
    if not mark.exists():
        raise SystemExit(
            f'{mark} is missing. Render the mark first:\n'
            '  node docs/deck/logo_motif.mjs\n'
            '  tmp/deck/.venv/Scripts/python.exe -m docs.deck.logo_motif'
        )

    prs = new_presentation()
    s = blank_slide(prs)

    # A wide, very soft wash so the card is not a white rectangle on a projector.
    if glow.exists():
        flat_picture(s, glow, I(SW / 2 - 7.0), I(-2.2), w=I(14.0), name='!!glow', opacity=55)

    flat_picture(s, mark, I((SW - LOGO_CANVAS_H) / 2), I(LOGO_TOP), h=I(LOGO_CANVAS_H), name='!!mark')

    y = T(s, 0.9, HEADLINE_Y, SW - 1.8,
          [[(C.DEFENDED, {'size': 34, 'bold': True, 'color': theme.GOLD, 'font': theme.FONT_TITLE})]],
          align='center')
    y = T(s, 1.1, y + 0.14, SW - 2.2,
          [[(C.TITLE, {'size': 16, 'color': theme.TEXT})]], align='center')
    y = T(s, 1.1, y + 0.10, SW - 2.2,
          [[(' · '.join(C.RESEARCHERS), {'size': 15, 'bold': True, 'color': theme.TEXT})]],
          align='center')
    y = T(s, 1.1, y + 0.06, SW - 2.2,
          [[(C.DEGREE, {'size': 14, 'color': theme.MUTED})]], align='center')
    y = T(s, 1.1, y + 0.05, SW - 2.2,
          [[(f'{C.COLLEGE}  ·  {C.UNIVERSITY}', {'size': 14, 'color': theme.MUTED})]],
          align='center')
    y = T(s, 1.1, y + 0.12, SW - 2.2,
          [[(f'{C.THANKS}  ·  {date.today().year}', {'size': 15, 'bold': True, 'color': theme.GREEN})]],
          align='center')

    # Institutional mark bottom-left, matching the title slide's footer treatment.
    seal_h = 0.62
    seal_y = SH - seal_h - 0.34
    if ISU_SEAL.exists():
        picture(s, ISU_SEAL, I(0.62), I(seal_y), h=I(seal_h), rounded=False, border=None, shadow=False)
    T(s, 0.62 + seal_h + 0.18, seal_y + 0.02, 4.2,
      [[('CCSICT · Echague', {'size': 13, 'bold': True, 'color': theme.TEXT})]])
    T(s, 0.62 + seal_h + 0.18, seal_y + 0.30, 4.2,
      [[(f'System defense · {date.today().year}', {'size': 12, 'color': theme.MUTED})]])

    set_notes(s, 'Closing card. Thank the panel, the adviser, and CCSICT for releasing the corpus.')

    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', default=str(OUT_DEFAULT))
    args = ap.parse_args(argv)
    out = build(Path(args.out))
    print(f'wrote {out}  ({out.stat().st_size / 1024:.0f} kB, 1 slide, theme {theme.MODE})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
