"""Assemble the IskAI logo turntable GIF from the frames logo_motif.mjs rendered.

Split from the renderer because rasterising the SVG needs a browser and writing an
animated GIF needs Pillow, and the two live in different runtimes here: Playwright in
the frontend's node_modules, Pillow in tmp/deck/.venv.

    node docs/deck/logo_motif.mjs
    tmp/deck/.venv/Scripts/python.exe -m docs.deck.logo_motif

Writes ``orb_turntable.gif`` beside the stills, using orb.py's filename so build.py's
``--motif logo`` can point RENDERS at this directory and change nothing else.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

MS_PER_FRAME = 70          # ~2.5 s per loop over 36 frames: present, not distracting
GIF_COLORS = 128           # the mark is two greens and a pale page; 128 is generous


def assemble(theme: str = 'light') -> Path:
    out_dir = ROOT / 'tmp' / 'deck' / 'renders' / f'{theme}-logo'
    manifest = out_dir / '_frames.json'
    if not manifest.exists():
        raise SystemExit(f'no frames in {out_dir}; run: node docs/deck/logo_motif.mjs')

    paths = [Path(p) for p in json.loads(manifest.read_text(encoding='utf-8'))]
    missing = [p for p in paths if not p.exists()]
    if missing:
        raise SystemExit(f'{len(missing)} frame(s) missing, first: {missing[0]}')

    # GIF has one transparent index, not an alpha channel. Compositing onto the deck's
    # own near-white page keeps the mark's drop shadow from fringing into a grey halo,
    # which is what a naive RGBA->P conversion produces on a light slide.
    page = (248, 250, 246)
    frames = []
    for path in paths:
        rgba = Image.open(path).convert('RGBA')
        flat = Image.new('RGB', rgba.size, page)
        flat.paste(rgba, mask=rgba.split()[3])
        frames.append(flat.convert('P', palette=Image.ADAPTIVE, colors=GIF_COLORS))

    gif = out_dir / 'orb_turntable.gif'
    frames[0].save(
        gif, save_all=True, append_images=frames[1:],
        duration=MS_PER_FRAME, loop=0, optimize=True, disposal=1,
    )
    shutil.rmtree(out_dir / '_frames', ignore_errors=True)
    manifest.unlink(missing_ok=True)
    return gif


def main() -> int:
    theme = sys.argv[1] if len(sys.argv) > 1 else 'light'
    gif = assemble(theme)
    kb = gif.stat().st_size / 1024
    print(f'wrote {gif.relative_to(ROOT)}  ({kb:.0f} kB)')
    with Image.open(gif) as img:
        print(f'  {img.n_frames} frames, {img.size[0]}x{img.size[1]}, {MS_PER_FRAME} ms/frame')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
