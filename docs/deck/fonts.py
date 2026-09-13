"""Fetch the deck's OFL fonts once and register them with matplotlib.

Neither Montserrat, DM Sans nor JetBrains Mono is installed on the build machine
(checked 2026-09-14: only Consolas among the monos), and matplotlib falls back to
DejaVu silently. The PPTX only carries font *names* -- Canva maps all three natively,
and PowerPoint substitutes until the TTFs are installed or embedded -- but every chart
PNG is rasterised here, so the files are needed. They come from the Google Fonts CSS
endpoint, which serves TTF links to a legacy user agent.
"""

from __future__ import annotations

import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / 'tmp' / 'deck' / 'fonts'
FAMILIES = {
    'Montserrat': (700, 900),
    'DM Sans': (400, 500, 600),
    'JetBrains Mono': (400, 500),
}
_UA = 'Mozilla/4.0'


def _css(family: str, weights: tuple[int, ...]) -> str:
    query = family.replace(' ', '+') + ':wght@' + ';'.join(str(w) for w in weights)
    req = urllib.request.Request(f'https://fonts.googleapis.com/css2?family={query}', headers={'User-Agent': _UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode('utf-8')


def ensure_fonts() -> dict[str, Path]:
    """Return {'DMSans-400': path, ...}, downloading anything missing."""
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    found: dict[str, Path] = {}
    for family, weights in FAMILIES.items():
        key = family.replace(' ', '')
        missing = [w for w in weights if not (FONT_DIR / f'{key}-{w}.ttf').exists()]
        if missing:
            css = _css(family, weights)
            for match in re.finditer(r"font-weight: (\d+);.*?url\((https://[^)]+\.ttf)\)", css, re.S):
                weight, url = int(match.group(1)), match.group(2)
                target = FONT_DIR / f'{key}-{weight}.ttf'
                if not target.exists():
                    urllib.request.urlretrieve(url, target)
        for w in weights:
            path = FONT_DIR / f'{key}-{w}.ttf'
            if path.exists():
                found[f'{key}-{w}'] = path
    return found


def register_matplotlib(paths: dict[str, Path]) -> None:
    from matplotlib import font_manager
    for path in paths.values():
        font_manager.fontManager.addfont(str(path))


if __name__ == '__main__':
    for name, path in ensure_fonts().items():
        print(f'{name:22s} {path}')
