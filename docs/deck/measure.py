"""Text measurement with the deck's real font files, so boxes are sized from metrics.

The first build estimated line counts from character counts and PowerPoint disagreed: DM Sans
runs about 0.1 in per character at 14 pt and Montserrat Bold wider still, so headings wrapped
into their bodies. Every text box is now laid out by wrapping words against the TrueType
advance widths (Pillow's ``ImageFont``) and stacking measured line heights. Line height uses
each face's ascent + descent (DM Sans 1.31 em, Montserrat 1.23 em, JetBrains Mono 1.32 em)
plus a small safety margin, which is what PowerPoint uses for single spacing.
"""

from __future__ import annotations

from functools import lru_cache

from PIL import ImageFont

from . import theme
from .fonts import ensure_fonts

_FILES = {
    ('DM Sans', False): 'DMSans-400', ('DM Sans', True): 'DMSans-600',
    ('Montserrat', False): 'Montserrat-700', ('Montserrat', True): 'Montserrat-700',
    ('JetBrains Mono', False): 'JetBrainsMono-400', ('JetBrains Mono', True): 'JetBrainsMono-500',
}
_LINE = {'DM Sans': 1.31, 'Montserrat': 1.23, 'JetBrains Mono': 1.32}
_SAFETY = 1.04
_PATHS = None


def _paths():
    global _PATHS
    if _PATHS is None:
        _PATHS = ensure_fonts()
    return _PATHS


@lru_cache(maxsize=None)
def _font(family: str, bold: bool, size_pt: int) -> ImageFont.FreeTypeFont:
    key = _FILES.get((family, bold), _FILES[('DM Sans', bold)])
    return ImageFont.truetype(str(_paths()[key]), size_pt)


def width_in(text: str, family: str = theme.FONT_BODY, size_pt: int = 14, bold: bool = False) -> float:
    """Advance width of a string in inches (points at ``size_pt`` / 72)."""
    return _font(family, bold, int(round(size_pt))).getlength(text) / 72


def line_height_in(family: str, size_pt: float) -> float:
    return size_pt * _LINE.get(family, 1.31) * _SAFETY / 72


def _tokens(runs):
    """Flatten runs into (word, family, size, bold, trailing_space) tokens."""
    out = []
    for text, opts in runs:
        fam = opts.get('font', theme.FONT_BODY)
        size = opts.get('size', 14)
        size = theme.PT[size] if isinstance(size, str) else size
        bold = bool(opts.get('bold', False))
        parts = text.split(' ')
        for i, word in enumerate(parts):
            out.append((word, fam, size, bold, i < len(parts) - 1))
    return out


def paragraph_lines(runs, width_in_: float) -> list[float]:
    """Greedy word wrap of one paragraph; returns the height of each line in inches."""
    tokens = _tokens(runs)
    lines: list[float] = []
    cur_w, cur_h, any_word = 0.0, 0.0, False
    space_w = 0.0
    for word, fam, size, bold, trailing in tokens:
        w = width_in(word, fam, size, bold) if word else 0.0
        h = line_height_in(fam, size)
        if any_word and cur_w + space_w + w > width_in_ + 1e-6:
            lines.append(cur_h)
            cur_w, cur_h, any_word = 0.0, 0.0, False
            space_w = 0.0
        cur_w += (space_w if any_word else 0.0) + w
        cur_h = max(cur_h, h)
        any_word = True
        space_w = width_in(' ', fam, size, bold) if trailing else 0.0
    lines.append(cur_h if any_word else line_height_in(theme.FONT_BODY, 14))
    return lines


def block_height_in(paragraphs, width_in_: float, *, space_after_pt: float = 0.0, line_spacing: float | None = None) -> float:
    """Height of a text box holding ``paragraphs`` (the structure ``pptx_helpers.text`` accepts)."""
    total = 0.0
    for i, para in enumerate(paragraphs):
        runs = para if isinstance(para, list) else [(para, {})]
        heights = paragraph_lines(runs, width_in_)
        factor = line_spacing or 1.0
        total += sum(h * factor for h in heights)
        if i < len(paragraphs) - 1:
            total += space_after_pt / 72
    return total + 0.02


def fits(paragraphs, width_in_: float, height_in_: float, **kw) -> bool:
    return block_height_in(paragraphs, width_in_, **kw) <= height_in_ + 1e-6
