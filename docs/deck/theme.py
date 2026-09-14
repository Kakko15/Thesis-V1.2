"""Deck palette, type, and geometry constants, in two modes.

``DECK_THEME=light`` (default) or ``DECK_THEME=dark`` selects the mode at import time, so every
module sees one consistent set. The UI accents are the app's own: the ISU forest green
``#046A38`` seed and ``#FFC72C`` gold in light mode, and the constellation orb's ``#34d388`` /
``#FFC72C`` in dark mode. Chart marks are a separate set that the dataviz palette validator
accepted on 2026-09-14 (``docs/deck/README.md`` records the runs): green ``#14a86e`` and dark
orange ``#d95926`` pass in both modes (every green/red pair failed deuteranopia separation);
the amber that emphasises the ``present`` stratum is ``#b45309`` on light (CVD 7.4, legal with
the bold label and legend as secondary encoding) and ``#c98500`` on dark.
"""

import os
from pathlib import Path

from pptx.util import Emu, Pt

MODE = os.environ.get('DECK_THEME', 'light').strip().lower()
if MODE not in ('light', 'dark'):
    raise SystemExit(f'DECK_THEME must be light or dark, not {MODE!r}')

_PALETTES = {
    'light': dict(
        GROUND='F5F7F9', GROUND_ALT='EEF1F4', PANEL='FFFFFF', PANEL_ALPHA=74,
        GLASS_BORDER='0F172A', GLASS_BORDER_ALPHA=9, FRAME_BORDER='CBD5E1', SHADOW_ALPHA=12,
        TEXT='0F172A', MUTED='5B6472', INK_ON_ACCENT='0F172A', ON_GREEN='FFFFFF',
        GREEN='046A38', GOLD='B45309', GOLD_FILL='FFC72C', GREEN_SOFT='34D388',
        CHART_GREEN='14A86E', CHART_NEG='D95926', CHART_AMBER='B45309', CHART_ZERO='5B6472',
        CHART_GRID='0F172A', CHART_GRID_ALPHA=0.08,
        ORB=dict(node='#046a38', hub='#b45309', arc='#059656', core='#046a38', core_alpha=0.10,
                 halo_node='#34d388', halo_hub='#f2a900', ring='#046a38'),
        GLOW_RGB=(0x34, 0xD3, 0x88), GLOW_ALPHA=0.16,
    ),
    'dark': dict(
        GROUND='070B14', GROUND_ALT='0B0F19', PANEL='111827', PANEL_ALPHA=60,
        GLASS_BORDER='FFFFFF', GLASS_BORDER_ALPHA=8, FRAME_BORDER='2A3038', SHADOW_ALPHA=25,
        TEXT='F2F4F7', MUTED='9AA4B2', INK_ON_ACCENT='070B14', ON_GREEN='070B14',
        GREEN='34D388', GOLD='FFC72C', GOLD_FILL='FFC72C', GREEN_SOFT='34D388',
        CHART_GREEN='14A86E', CHART_NEG='D95926', CHART_AMBER='C98500', CHART_ZERO='9AA4B2',
        CHART_GRID='FFFFFF', CHART_GRID_ALPHA=0.06,
        ORB=dict(node='#34d388', hub='#ffc72c', arc='#10b96c', core='#0a5c36', core_alpha=0.55,
                 halo_node='#34d388', halo_hub='#ffc72c', ring='#34d388'),
        GLOW_RGB=(0x34, 0xD3, 0x88), GLOW_ALPHA=0.22,
    ),
}
globals().update(_PALETTES[MODE])

# Type
FONT_TITLE = 'Montserrat'
FONT_BODY = 'DM Sans'
FONT_MONO = 'JetBrains Mono'
MIN_PT = 14
PT = {
    'title': 40, 'kicker': 14, 'body': 20, 'small': 16, 'chip': 14,
    'stat': 56, 'hero': 64, 'caption': 14, 'table': 14, 'mono': 15,
}

# Geometry: 16:9, 13.333 x 7.5 in
SLIDE_W = Emu(12192000)
SLIDE_H = Emu(6858000)
RENDER_PX = (2560, 1440)
RENDER_DPI = 192
RENDER_DIR = Path(__file__).resolve().parents[2] / 'tmp' / 'deck' / 'renders' / MODE


def pt(name: str) -> Pt:
    """Point size for a named text role, never below MIN_PT."""
    return Pt(max(PT[name], MIN_PT))
