"""Deck palette, type, and geometry constants.

Everything visual that is a number lives here so a late change is one edit. The UI
accents are sampled from the app's own constellation orb
(`rag-thesis-frontend/src/components/three/ConstellationOrb.jsx`, dark palette) so the
deck and its screenshots read as one system. The *chart* marks are a separate, darker
set: the dataviz palette validator (run 2026-09-14 against the panel surface #111827,
`--mode dark`) rejected the raw accents for marks -- OKLCH L 0.77 and 0.86 sit above the
0.48-0.67 dark-surface band -- and rejected every green/red pair on deuteranopia
separation (best 5.5, floor 6). The set below passes all checks; the recorded output
is in `docs/deck/README.md`.
"""

from pptx.util import Emu, Pt

# Grounds and panels
GROUND = '070B14'
GROUND_ALT = '0B0F19'
PANEL = '111827'
PANEL_ALPHA = 60            # percent
GLASS_BORDER = 'FFFFFF'
GLASS_BORDER_ALPHA = 8      # percent (#FFFFFF15 = 8.2 %)
FRAME_BORDER = '2A3038'

# Text
TEXT = 'F2F4F7'
MUTED = '9AA4B2'
INK_ON_ACCENT = '070B14'

# UI accents (chips, rail, orb, one accent object per slide)
GREEN = '34D388'
GOLD = 'FFC72C'

# Chart marks (validated 2026-09-14; see module docstring)
CHART_GREEN = '14A86E'      # RAG / positive pole
CHART_NEG = 'D95926'        # baseline scored higher (dark orange, not red)
CHART_AMBER = 'C98500'      # emphasis: the `present` stratum
CHART_ZERO = '9AA4B2'       # neutral midpoint / zero line
CHART_GRID = 'FFFFFF'       # at 6 % alpha

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
MARGIN = Emu(685800)        # 0.75 in
RENDER_PX = (2560, 1440)
RENDER_DPI = 192


def pt(name: str) -> Pt:
    """Point size for a named text role, never below MIN_PT."""
    return Pt(max(PT[name], MIN_PT))
