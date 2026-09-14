"""The two evidence charts, rendered in the deck palette at exactly their placed size.

``figsize`` equals the size the picture is placed at on the slide, so a 14 pt label here is
14 pt on the projector. Colours come from ``theme`` for the active mode: green for the RAG /
positive pole, dark orange (never red: every green/red pair failed deuteranopia separation) for
"baseline scored higher", amber for the flagged ``present`` stratum, a neutral zero line.

The p-values deliberately stay out of the PNGs: they live in the text chips beside the chart so
``verify.py`` can prove the pooled p never appears without the ``present`` p.
"""

from __future__ import annotations

from pathlib import Path

from . import theme
from .evidence import Comparison
from .fonts import ensure_fonts, register_matplotlib

FOREST_SIZE = (6.2, 2.8)
DELTAS_SIZE = (4.75, 2.5)


def _setup():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    register_matplotlib(ensure_fonts())
    plt.rcParams.update({
        'font.family': theme.FONT_BODY, 'font.size': 14,
        'text.color': '#' + theme.TEXT, 'axes.labelcolor': '#' + theme.MUTED,
        'xtick.color': '#' + theme.MUTED, 'ytick.color': '#' + theme.MUTED, 'axes.edgecolor': '#' + theme.MUTED,
    })
    return plt


def _hex(c: str) -> str:
    return '#' + c


def render_forest(cmp: Comparison, out: Path, size_in: tuple[float, float] = FOREST_SIZE) -> Path:
    plt = _setup()
    rows = cmp.ordered_strata()
    fig, ax = plt.subplots(figsize=size_in, dpi=theme.RENDER_DPI)
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')
    ys = list(range(len(rows)))[::-1]
    for y, s in zip(ys, rows):
        emphasised = s.key == 'present'
        color = _hex(theme.CHART_AMBER if emphasised else theme.CHART_GREEN)
        ax.plot([s.ci_lo, s.ci_hi], [y, y], color=color, lw=2, solid_capstyle='round', zorder=2)
        ax.plot([s.mean_diff], [y], marker='o', ms=9 if emphasised else 8, color=color, mec=_hex(theme.PANEL), mew=2, zorder=3)
        ax.text(-0.012, y, f'{s.label}  ·  n = {s.n}', ha='right', va='center', fontsize=14, clip_on=False,
                transform=ax.get_yaxis_transform(), color=_hex(theme.TEXT if emphasised else theme.MUTED),
                fontweight='semibold' if emphasised else 'normal')
        if s.key in ('pooled', 'present'):
            ax.text(s.ci_hi + 0.012, y, f'{s.mean_diff:+.3f}', ha='left', va='center', fontsize=14, color=_hex(theme.TEXT), family=theme.FONT_MONO)
    ax.axvline(0, color=_hex(theme.CHART_ZERO), lw=2, zorder=1)
    ax.set_xlim(-0.13, 0.40)
    ax.set_ylim(-0.7, len(rows) - 0.3)
    ax.set_yticks([])
    ax.set_xticks([-0.1, 0, 0.1, 0.2, 0.3])
    ax.set_xticklabels(['−0.10', '0', '+0.10', '+0.20', '+0.30'], family=theme.FONT_MONO, fontsize=14)
    ax.tick_params(axis='x', length=0, pad=6)
    ax.grid(axis='x', color=_hex(theme.CHART_GRID), alpha=theme.CHART_GRID_ALPHA, lw=1)
    for side in ('top', 'right', 'left'):
        ax.spines[side].set_visible(False)
    ax.spines['bottom'].set_color(_hex(theme.MUTED))
    ax.spines['bottom'].set_alpha(0.35)
    fig.text(0.56, 0.19, 'Mean paired difference, RAG − baseline, with 95 % CI', ha='center', va='top', fontsize=14, color=_hex(theme.MUTED))
    handles = [
        plt.Line2D([], [], color=_hex(theme.CHART_GREEN), marker='o', lw=2, label='Stratum'),
        plt.Line2D([], [], color=_hex(theme.CHART_AMBER), marker='o', lw=2, label='present — the stratum §3.2.5 quotes'),
    ]
    leg = fig.legend(handles=handles, loc='lower center', ncol=2, fontsize=14, frameon=False, handlelength=1.6,
                     borderaxespad=0.1, columnspacing=1.6, bbox_to_anchor=(0.56, -0.01))
    for t in leg.get_texts():
        t.set_color(_hex(theme.MUTED))
    fig.subplots_adjust(left=0.42, right=0.985, top=0.98, bottom=0.32)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, transparent=True, dpi=theme.RENDER_DPI)
    plt.close(fig)
    return out


def render_paired_deltas(cmp: Comparison, out: Path, size_in: tuple[float, float] = DELTAS_SIZE) -> Path:
    plt = _setup()
    from matplotlib.patches import FancyBboxPatch, Rectangle
    rows = sorted(cmp.rows, key=lambda r: r.delta)
    fig, ax = plt.subplots(figsize=size_in, dpi=theme.RENDER_DPI)
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')
    n, width, radius = len(rows), 0.72, 0.02
    for x, r in enumerate(rows):
        d = r.delta
        color = _hex(theme.CHART_GREEN if d >= 0 else theme.CHART_NEG)
        if abs(d) < 1e-9:
            color = _hex(theme.CHART_ZERO)
        y0, y1 = (0, d) if d >= 0 else (d, 0)
        pad = min(radius, abs(d) / 2)
        box = FancyBboxPatch((x - width / 2, min(y0, y1) - (pad if d >= 0 else 0)), width, (y1 - y0) + pad,
                             boxstyle=f'round,pad=0,rounding_size={pad}', linewidth=0, facecolor=color, zorder=2)
        box.set_clip_path(Rectangle((x - 1, y0), 2, y1 - y0, transform=ax.transData))
        ax.add_patch(box)
        if r.kind == 'notice':
            ax.add_patch(Rectangle((x - width / 2, y0), width, y1 - y0, fill=False, ec=_hex(theme.TEXT), lw=1.4, zorder=3))
    ax.axhline(0, color=_hex(theme.CHART_ZERO), lw=2, zorder=1)
    ax.axhline(cmp.pooled.mean_diff, color=_hex(theme.MUTED), lw=1, alpha=0.7, zorder=1)
    ax.text(0.2, cmp.pooled.mean_diff + 0.012, f'mean {cmp.pooled.mean_diff:+.4f}', ha='left', va='bottom', fontsize=14,
            color=_hex(theme.MUTED), family=theme.FONT_MONO)
    lo, hi = min(r.delta for r in rows), max(r.delta for r in rows)
    ax.set_xlim(-0.8, n - 0.2)
    ax.set_ylim(min(lo, 0) - 0.05, hi + 0.08)
    ax.set_xticks([])
    ticks = [t for t in (-0.2, 0, 0.2, 0.4, 0.6) if lo - 0.05 <= t <= hi + 0.08]
    ax.set_yticks(ticks)
    ax.set_yticklabels([f'{t:+.1f}' if t else '0' for t in ticks], family=theme.FONT_MONO, fontsize=14)
    ax.tick_params(axis='y', length=0, pad=6)
    ax.grid(axis='y', color=_hex(theme.CHART_GRID), alpha=theme.CHART_GRID_ALPHA, lw=1)
    for side in ('top', 'right', 'bottom'):
        ax.spines[side].set_visible(False)
    ax.spines['left'].set_alpha(0)
    ax.set_xlabel(f'{n} paired queries, sorted by RAG − baseline', fontsize=14, color=_hex(theme.MUTED), labelpad=8)
    pos = sum(1 for r in rows if r.delta > 0)
    neg = sum(1 for r in rows if r.delta < 0)
    handles = [
        plt.Rectangle((0, 0), 1, 1, color=_hex(theme.CHART_GREEN), label=f'RAG scored higher ({pos})'),
        plt.Rectangle((0, 0), 1, 1, color=_hex(theme.CHART_NEG), label=f'Baseline scored higher ({neg})'),
        plt.Rectangle((0, 0), 1, 1, fill=False, ec=_hex(theme.TEXT), lw=1.4, label=f'Grounded fallback ({len(cmp.notice_rows)})'),
    ]
    leg = ax.legend(handles=handles, loc='upper left', fontsize=14, frameon=False, handlelength=1.2, borderaxespad=0.2, labelspacing=0.35)
    for t in leg.get_texts():
        t.set_color(_hex(theme.MUTED))
    fig.subplots_adjust(left=0.12, right=0.985, top=0.98, bottom=0.17)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, transparent=True, dpi=theme.RENDER_DPI)
    plt.close(fig)
    return out


def render_all(cmp: Comparison, out_dir: Path | None = None) -> dict[str, Path]:
    out_dir = out_dir or theme.RENDER_DIR
    return {
        'forest.png': render_forest(cmp, out_dir / 'forest.png'),
        'deltas.png': render_paired_deltas(cmp, out_dir / 'deltas.png'),
    }


if __name__ == '__main__':
    from .evidence import load_comparison
    for name, path in render_all(load_comparison()).items():
        print(f'{theme.MODE}/{name}', path.stat().st_size, 'bytes')
