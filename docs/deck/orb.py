"""Pre-render the constellation orb: stills for Morph, and an animated turntable GIF.

PowerPoint 2019 shows native 3D models as flat images and Canva drops them, so the deck's 3D
object is the app's own hero geometry, rendered here. Stills at three yaw angles are Morphed
between slides; the title and Q&A slides carry a 36-frame turntable GIF, which PowerPoint plays
in Slide Show, so the sphere visibly turns. The geometry mirrors
``rag-thesis-frontend/src/components/three/constellation.js`` (mulberry32, fibonacci sphere,
seeded arcs) so the deck orb *is* the landing-page orb. Colours follow ``theme.MODE``.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from . import theme

NODE_COUNT = 140
HUB_COUNT = 12
RADIUS = 2.0
GIF_FRAMES = 36
GIF_PX = 1000


def mulberry32(seed: int):
    a = seed & 0xFFFFFFFF

    def imul(x: int, y: int) -> int:
        return ((x & 0xFFFFFFFF) * (y & 0xFFFFFFFF)) & 0xFFFFFFFF

    def rand() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rand


def fibonacci_sphere(count: int, radius: float) -> np.ndarray:
    golden = math.pi * (3 - math.sqrt(5))
    pts = []
    for i in range(count):
        y = 1 - (i / (count - 1)) * 2
        r = math.sqrt(1 - y * y)
        theta = golden * i
        pts.append((math.cos(theta) * r * radius, y * radius, math.sin(theta) * r * radius))
    return np.array(pts)


def hub_indices(seed: int = 42) -> set[int]:
    rand = mulberry32(seed)
    for _ in range(NODE_COUNT):      # the app burns one draw per node for phase offsets first
        rand()
    hubs: set[int] = set()
    while len(hubs) < HUB_COUNT:
        hubs.add(math.floor(rand() * NODE_COUNT))
    return hubs


def build_arcs(nodes: np.ndarray, radius: float, max_arcs: int = 64, min_dist: float = 0.4,
               max_dist: float = 1.15, seed: int = 7, segments: int = 20) -> list[np.ndarray]:
    rand = mulberry32(seed)
    seen: set[tuple[int, int]] = set()
    arcs: list[np.ndarray] = []
    attempts = max_arcs * 60
    while len(arcs) < max_arcs and attempts > 0:
        attempts -= 1
        i = math.floor(rand() * len(nodes))
        j = math.floor(rand() * len(nodes))
        if i == j:
            continue
        key = (i, j) if i < j else (j, i)
        if key in seen:
            continue
        a, b = nodes[i], nodes[j]
        dist = float(np.linalg.norm(a - b))
        if dist < min_dist or dist > max_dist:
            continue
        seen.add(key)
        mid = (a + b) / 2
        mid = mid / np.linalg.norm(mid) * radius * 1.28
        t = np.linspace(0, 1, segments + 1)[:, None]
        arcs.append((1 - t) ** 2 * a + 2 * (1 - t) * t * mid + t ** 2 * b)
    return arcs


def _rotate(points: np.ndarray, yaw_deg: float, tilt_rad: float = 0.22) -> np.ndarray:
    yaw = math.radians(yaw_deg)
    ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    rx = np.array([[1, 0, 0], [0, math.cos(tilt_rad), -math.sin(tilt_rad)], [0, math.sin(tilt_rad), math.cos(tilt_rad)]])
    return points @ ry.T @ rx.T


def _converge(points: np.ndarray, hubs: set[int]) -> np.ndarray:
    """Every node onto a ring in the picture plane; hubs equally spaced on it."""
    out = np.zeros_like(points)
    hub_list = sorted(hubs)
    regular = [i for i in range(len(points)) if i not in hubs]
    for k, i in enumerate(hub_list):
        ang = 2 * math.pi * k / len(hub_list) + math.pi / 2
        out[i] = (RADIUS * math.cos(ang), RADIUS * math.sin(ang), 0.0)
    for k, i in enumerate(regular):
        ang = 2 * math.pi * k / len(regular) + math.pi / 2 + 0.01
        r = RADIUS * (1.0 if k % 2 == 0 else 0.955)
        out[i] = (r * math.cos(ang), r * math.sin(ang), 0.0)
    return out


def _draw(ax, pts, hubs, arcs, angle_deg, converged, matplotlib, plt):
    from matplotlib.collections import LineCollection
    P = theme.ORB
    depth = (pts[:, 2] + RADIUS) / (2 * RADIUS)
    order = np.argsort(pts[:, 2])
    if not converged:
        ax.add_patch(plt.Circle((0, 0), RADIUS * 0.985, color=P['core'], alpha=P['core_alpha'], zorder=1.0))
        ax.add_patch(plt.Circle((0, 0), RADIUS * 1.04, color=P['arc'], alpha=0.05, zorder=0))
        segs, alphas = [], []
        for arc in arcs:
            r = _rotate(arc, angle_deg)
            for k in range(len(r) - 1):
                segs.append([(r[k, 0], r[k, 1]), (r[k + 1, 0], r[k + 1, 1])])
                alphas.append(0.06 + 0.24 * ((r[k, 2] + RADIUS * 1.28) / (2 * RADIUS * 1.28)))
        lc = LineCollection(segs, linewidths=1.1, zorder=1.5)
        lc.set_color(np.array([matplotlib.colors.to_rgba(P['arc'], a) for a in alphas]))
        ax.add_collection(lc)
    else:
        ax.add_patch(plt.Circle((0, 0), RADIUS, fill=False, ec=P['ring'], lw=2.2, alpha=0.35, zorder=1))
        ax.add_patch(plt.Circle((0, 0), RADIUS * 1.09, fill=False, ec=P['ring'], lw=14, alpha=0.05, zorder=0))
    for i in order:
        x, y = pts[i, 0], pts[i, 1]
        d = depth[i]
        is_hub = i in hubs
        color = P['hub'] if is_hub else P['node']
        halo = P['halo_hub'] if is_hub else P['halo_node']
        base = (0.055 if is_hub else 0.03) if converged else (0.05 if is_hub else 0.026) * (0.65 + 0.7 * d)
        a = 0.3 + 0.7 * d
        z = 2 + d if (converged or d >= 0.5) else 0.5 + d   # back half sits behind the core disc
        for mult, alpha, col in ((3.2, 0.07, halo), (1.9, 0.16, halo), (1.0, 1.0, color)):
            ax.add_patch(plt.Circle((x, y), base * mult, color=col, alpha=alpha * a, lw=0, zorder=z))


def _figure(plt, size_px, half_h):
    w_in, h_in = size_px[0] / theme.RENDER_DPI, size_px[1] / theme.RENDER_DPI
    fig = plt.figure(figsize=(w_in, h_in), dpi=theme.RENDER_DPI)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    ax.set_xlim(-half_h * w_in / h_in, half_h * w_in / h_in)
    ax.set_ylim(-half_h, half_h)
    ax.set_aspect('equal')
    return fig, ax


def render_orb(angle_deg: float, out: Path, converged: bool = False, size_px=None, half_h: float = 2.9) -> Path:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    nodes = fibonacci_sphere(NODE_COUNT, RADIUS)
    hubs = hub_indices()
    arcs = [] if converged else build_arcs(nodes, RADIUS)
    pts = _rotate(_converge(nodes, hubs), 0.0, tilt_rad=0.0) if converged else _rotate(nodes, angle_deg)
    fig, ax = _figure(plt, size_px or theme.RENDER_PX, half_h)
    _draw(ax, pts, hubs, arcs, angle_deg, converged, matplotlib, plt)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, transparent=True, dpi=theme.RENDER_DPI)
    plt.close(fig)
    return out


def render_turntable_gif(out: Path, frames: int = GIF_FRAMES, px: int = GIF_PX, ms_per_frame: int = 90) -> Path:
    """A square turntable of the orb on the slide ground, so PowerPoint animates it in Slide Show."""
    import io
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from PIL import Image
    nodes = fibonacci_sphere(NODE_COUNT, RADIUS)
    hubs = hub_indices()
    arcs = build_arcs(nodes, RADIUS)
    ground = tuple(int(theme.GROUND[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    images = []
    for k in range(frames):
        angle = 360.0 * k / frames
        fig, ax = _figure(plt, (px, px), 2.75)
        _draw(ax, _rotate(nodes, angle), hubs, arcs, angle, False, matplotlib, plt)
        buf = io.BytesIO()
        fig.savefig(buf, transparent=True, dpi=theme.RENDER_DPI, format='png')
        plt.close(fig)
        buf.seek(0)
        frame = Image.new('RGBA', (px, px), ground)
        frame.alpha_composite(Image.open(buf).convert('RGBA').resize((px, px), Image.LANCZOS))
        images.append(frame.convert('RGB').quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG))
    out.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(out, save_all=True, append_images=images[1:], duration=ms_per_frame, loop=0, optimize=False, disposal=1)
    return out


def render_glow(out: Path) -> Path:
    """Soft radial light source for the upper-left of every slide (no gradient XML)."""
    from PIL import Image
    w, h = 1400, 1400
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt((xx - w * 0.5) ** 2 + (yy - h * 0.5) ** 2) / (w * 0.5)
    alpha = np.clip(1 - r, 0, 1) ** 2.6 * theme.GLOW_ALPHA
    img = np.zeros((h, w, 4), dtype=np.uint8)
    img[..., :3] = np.array(theme.GLOW_RGB, dtype=np.uint8)
    img[..., 3] = (alpha * 255).astype(np.uint8)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, 'RGBA').save(out)
    return out


FRAMES = {'orb_000.png': 0.0, 'orb_040.png': 40.0, 'orb_080.png': 80.0}
ALL = (*FRAMES, 'orb_converged.png', 'glow.png', 'orb_turntable.gif')


def render_all(out_dir: Path | None = None, force: bool = False) -> dict[str, Path]:
    out_dir = out_dir or theme.RENDER_DIR
    made = {}
    for name, angle in FRAMES.items():
        p = out_dir / name
        made[name] = p if p.exists() and not force else render_orb(angle, p)
    p = out_dir / 'orb_converged.png'
    made['orb_converged.png'] = p if p.exists() and not force else render_orb(0.0, p, converged=True)
    p = out_dir / 'glow.png'
    made['glow.png'] = p if p.exists() and not force else render_glow(p)
    p = out_dir / 'orb_turntable.gif'
    made['orb_turntable.gif'] = p if p.exists() and not force else render_turntable_gif(p)
    return made


if __name__ == '__main__':
    for name, path in render_all(force=True).items():
        print(f'{theme.MODE}/{name}', path.stat().st_size, 'bytes')
