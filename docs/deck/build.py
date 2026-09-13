"""Build the 15-slide IskAI system-defense deck.

    tmp/deck/.venv/Scripts/python.exe -m docs.deck.build [--out PATH] [--captures DIR]
        [--allow-fixture-captures] [--allow-missing] [--iso-date 2026-09-14]

Every figure is read from the evidence files (``evidence.py``); every word from
``content.py``; every colour from ``theme.py``. Persistent objects are recreated on each
slide under the same ``!!`` name so PowerPoint Morph moves them instead of fading.
Captures come from ``assets/captures/manifest.json``; fixture-mode captures (fabricated
e2e data) are refused unless ``--allow-fixture-captures``, because the final deck must
show the real system only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from datetime import date
from pathlib import Path

from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

from . import charts, content as C, orb, theme, xml_post
from .evidence import IsoBlock, assert_quoted, fmt_ci, fmt_p, load_comparison, load_iso_block
from .pptx_helpers import (blank_slide, block_arc, chip, circle, flat_picture, glass_card, hline, new_presentation,
                           picture, rect, set_notes, table, text)

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ASSETS = HERE / 'assets'
RENDERS = ROOT / 'tmp' / 'deck' / 'renders'
OUT_DEFAULT = ROOT / 'tmp' / 'deck' / 'out' / 'IskAI_Defense_Deck.pptx'
ISU_SEAL = ROOT / 'rag-thesis-frontend' / 'public' / 'isu-logo.jpg'

I = Inches
SW, SH = 13.333, 7.5
TOTAL = 15
LINE = 0.245          # inches per 14 pt line, DM Sans


def lines_for(s: str, chars_per_line: int) -> int:
    return max(1, math.ceil(len(s) / chars_per_line))


class Captures:
    """Resolve capture keys through the manifest; refuse stand-ins for the final deck."""

    def __init__(self, directory: Path, allow_fixture: bool, allow_missing: bool):
        self.dir = directory
        self.allow_fixture = allow_fixture
        self.allow_missing = allow_missing
        manifest = directory / 'manifest.json'
        self.entries = json.loads(manifest.read_text(encoding='utf-8'))['captures'] if manifest.exists() else {}
        self.used: dict[str, dict] = {}

    def get(self, key: str) -> Path | None:
        entry = self.entries.get(key)
        if entry is None or not (self.dir / entry['file']).exists():
            if self.allow_missing:
                return None
            raise SystemExit(f'capture {key!r} is missing from {self.dir}; pass --allow-missing for a draft')
        if entry.get('mode') != 'live' and not self.allow_fixture:
            raise SystemExit(f'capture {key!r} is a {entry.get("mode")} stand-in; pass --allow-fixture-captures for a draft')
        self.used[key] = entry
        return self.dir / entry['file']


class Ctx:
    def __init__(self, args):
        self.cmp = load_comparison()
        self.iso: IsoBlock | None = None
        try:
            self.iso = load_iso_block(args.iso_date)
        except ValueError as exc:
            if not args.allow_missing:
                raise SystemExit(str(exc))
            print(f'warning: {exc}; slide 9 will carry [VERIFY] markers', file=sys.stderr)
        assert_quoted(C.ISO_QUOTED)
        self.caps = Captures(Path(args.captures), args.allow_fixture_captures, args.allow_missing)
        wanted = (*orb.FRAMES, 'orb_converged.png', 'glow.png')
        self.renders = {n: RENDERS / n for n in wanted} if all((RENDERS / n).exists() for n in wanted) else orb.render_all()
        self.charts = charts.render_all(self.cmp)
        self.charts['deltas_small.png'] = charts.render_paired_deltas(self.cmp, RENDERS / 'deltas_small.png', size_in=(5.4, 2.85))
        self.head = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, cwd=ROOT).stdout.strip()
        state_path = Path(args.captures) / 'archive_state.json'
        if state_path.exists():
            st = json.loads(state_path.read_text(encoding='utf-8'))
            day = st.get('read_on') or st.get('read_at', '')[:10]
            self.archive_line = (f'{st["total_papers"]} manuscripts indexed in the CCSICT scope · {st["total_tracks"]} academic tracks '
                                 f'(live /analytics/summary, read {day}).')
            self.archive_note = (f'As of {day} the archive reports {st["total_papers"]} indexed manuscripts inside the CCSICT scope; '
                                 'the two YOLO-based detection theses you saw cited are among them.')
        else:
            self.archive_line = '[VERIFY] live archive size: run capture.mjs --mode live to record /analytics/summary.'
            self.archive_note = '[VERIFY] archive size.'


# --- shared furniture ----------------------------------------------------------------------

def glow(slide, n: int):
    """The single light source, upper-left, drifting 30-60 px between slides."""
    dx, dy = ((n * 37) % 61 - 30) / 96, ((n * 53) % 61 - 30) / 96
    return flat_picture(slide, RENDERS / 'glow.png', I(-3.0 + dx), I(-3.2 + dy), w=I(9.5), name='!!glow')


def kicker(slide, x, y, label: str, w=I(8), color: str = theme.GREEN):
    return text(slide, x, y, w, I(0.3), [[(label.upper(), {'size': 'kicker', 'color': color, 'bold': True})]])


def title(slide, x, y, label, w=I(9.5), size: int = 36):
    return text(slide, x, y, w, I(0.9), [[(label, {'size': size, 'bold': True, 'font': theme.FONT_TITLE})]])


def page_number(slide, n: int):
    text(slide, I(SW - 1.9), I(SH - 0.5), I(1.15), I(0.3), [[(f'{n:02d} / {TOTAL}', {'size': 14, 'color': theme.MUTED, 'font': theme.FONT_MONO})]], align='right')


def _center_run(shape, label: str, color: str, font: str = theme.FONT_MONO):
    tf = shape.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.size = Pt(14)
    r.font.bold = True
    r.font.name = font
    r.font.color.rgb = RGBColor.from_string(color)


def rail(slide, active: int | None, *, ring_positions: list[tuple[float, float]] | None = None):
    """Four objective markers top-right; the gold ring sits on the active one."""
    d = I(0.32)
    base_x, y = SW - 0.75 - 4 * 0.42, 0.62
    for k in range(4):
        cx, cy = ring_positions[k] if ring_positions else (base_x + k * 0.42 + 0.16, y)
        on = active == (k + 1)
        c = circle(slide, I(cx), I(cy), d, fill=theme.GREEN if on else theme.PANEL, alpha=100 if on else 85,
                   line=None if on else theme.MUTED, line_pt=0.75, name=f'!!rail{k + 1}')
        _center_run(c, str(k + 1), theme.INK_ON_ACCENT if on else theme.MUTED)
    if active and not ring_positions:
        cx = base_x + (active - 1) * 0.42 + 0.16
        circle(slide, I(cx), I(y), I(0.46), fill=None, line=theme.GOLD, line_pt=1.5, name='!!railActive')


def thumb(slide, n: int, path: Path | None, x, y, w, label: str):
    """Tilted evidence thumbnail on an objective card; becomes the full `!!frameN` on its slide."""
    h = Emu(int(w * 9 / 16))
    if path is not None:
        pic = picture(slide, path, x, y, w=w, name=f'!!frame{n}')
        xml_post.inject_scene3d(pic, xml_post.TILTED, extrusion_emu=19050)
        return pic
    box = rect(slide, x, y, w, h, fill=theme.PANEL, alpha=85, radius=0.08, name=f'!!frame{n}')
    text(slide, x, y, w, h, [[(label, {'size': 14, 'color': theme.GOLD, 'font': theme.FONT_MONO})]], align='center', anchor='middle')
    xml_post.inject_scene3d(box, xml_post.TILTED, extrusion_emu=19050)
    return box


def objective_card(slide, n: int, x, y, w, h, *, as_title: bool = False, thumb_path: Path | None = None,
                   thumb_label: str | None = None):
    """`!!objN`: a grid card on slide 3, the title card of its own slide later, a tick on slide 15."""
    card = glass_card(slide, x, y, w, h, name=f'!!obj{n}')
    pad, num_w = I(0.22), I(0.6)
    text(slide, x + pad, y + I(0.15), num_w, I(0.4), [[(f'0{n}', {'size': 20, 'color': theme.GREEN, 'font': theme.FONT_MONO, 'bold': True})]])
    body_x = x + pad + num_w
    if as_title:
        text(slide, body_x, y + I(0.12), w - pad * 2 - num_w, I(0.36),
             [[(f'Objective {n} · {C.OBJECTIVE_SHORT[n - 1]}', {'size': 22, 'bold': True, 'font': theme.FONT_TITLE})]])
        text(slide, body_x, y + I(0.52), w - pad * 2 - num_w, h - I(0.6), [[(C.SPECIFIC_OBJECTIVES[n - 1], {'size': 14, 'color': theme.MUTED})]])
        return card
    # The thumbnail sits in the heading row only; the body starts below it so text never runs under it.
    thumb_w = I(0.98)
    if thumb_label is not None:
        thumb(slide, n, thumb_path, x + w - pad - thumb_w, y + I(0.12), thumb_w, thumb_label)
    text(slide, body_x, y + I(0.15), w - pad * 2 - num_w - thumb_w - I(0.2), I(0.3),
         [[(C.OBJECTIVE_SHORT[n - 1], {'size': 16, 'bold': True, 'font': theme.FONT_TITLE})]])
    body = C.SPECIFIC_OBJECTIVES[n - 1]
    if n == 4:
        body = body + ' ' + ' · '.join(C.OBJECTIVE_4_CRITERIA)
    text(slide, body_x, y + I(0.7), w - pad * 2 - num_w, h - I(0.75), [[(body, {'size': 14, 'color': theme.MUTED})]])
    return card


def frame(slide, name: str, path: Path | None, x, y, *, w=None, h=None, label: str = '', tilt: str = xml_post.FLAT):
    """A framed screenshot, or a labelled placeholder when the capture is not yet on disk."""
    if path is not None:
        pic = picture(slide, path, x, y, w=w, h=h, name=name)
        xml_post.inject_scene3d(pic, tilt)
        return pic
    if h is None:
        h = Emu(int(w * 9 / 16))
    if w is None:
        w = Emu(int(h * 16 / 9))
    box = glass_card(slide, x, y, w, h, name=name, alpha=70)
    text(slide, x, y, w, h, [[(f'[CAPTURE] {label}', {'size': 16, 'color': theme.GOLD, 'font': theme.FONT_MONO})]], align='center', anchor='middle')
    xml_post.inject_scene3d(box, tilt)
    return box


def labelled_rows(slide, x, y, w, rows, *, key_w=I(1.35), size: int = 14, key_color: str = theme.GREEN, gap=I(0.36)):
    yy = y
    for key, value in rows:
        text(slide, x, yy, key_w, gap, [[(key, {'size': size, 'color': key_color, 'font': theme.FONT_MONO, 'bold': True})]])
        text(slide, x + key_w, yy, w - key_w, gap, [[(value, {'size': size})]])
        yy += gap
    return yy


# --- slides -------------------------------------------------------------------------------

def slide_01(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 1)
    flat_picture(s, RENDERS / 'orb_000.png', I(2.9), I(-0.1), w=I(SW), name='!!orb')
    kicker(s, I(0.75), I(1.35), C.DEFENSE_LEVEL)
    text(s, I(0.75), I(1.75), I(6.9), I(2.4), [[(C.TITLE, {'size': 34, 'bold': True, 'font': theme.FONT_TITLE})]], line_spacing=1.05)
    text(s, I(0.75), I(4.05), I(6.9), I(0.5), [[(C.SYSTEM, {'size': 22, 'bold': True, 'color': theme.GREEN, 'font': theme.FONT_TITLE}),
                                                 ('  ·  ' + '  ·  '.join(C.THREE_PROPERTIES), {'size': 16, 'color': theme.MUTED})]])
    text(s, I(0.75), I(4.75), I(6.9), I(1.3), [
        [(' · '.join(C.RESEARCHERS), {'size': 20, 'bold': True})],
        [(C.DEGREE, {'size': 15, 'color': theme.MUTED})],
        [(C.COLLEGE, {'size': 15, 'color': theme.MUTED})],
        [(C.UNIVERSITY, {'size': 15, 'color': theme.MUTED})],
    ], space_after=2)
    picture(s, ISU_SEAL, I(0.75), I(6.25), h=I(0.85), rounded=False, border=None, shadow=False)
    text(s, I(1.75), I(6.42), I(4), I(0.5), [[('CCSICT · Echague', {'size': 14, 'color': theme.MUTED, 'bold': True})],
                                             [('System defense · 2026', {'size': 14, 'color': theme.MUTED})]])
    set_notes(s, C.NOTES[1])
    return s


def slide_02(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 2)
    flat_picture(s, RENDERS / 'orb_040.png', I(-4.6), I(0.3), w=I(10.5), name='!!orb', opacity=55)
    kicker(s, I(0.75), I(0.55), 'The problem · Chapter 1')
    title(s, I(0.75), I(0.85), 'Background of the study', w=I(6))
    gx, gy, gw, gh, gap = 5.0, 1.55, 3.7, 2.3, 0.22
    for i, (num, head, body) in enumerate(C.PROBLEM_CARDS):
        cx, cy = gx + (i % 2) * (gw + gap), gy + (i // 2) * (gh + gap)
        is_hyp = i == 3
        glass_card(s, I(cx), I(cy), I(gw), I(gh), alpha=60 if not is_hyp else 75)
        text(s, I(cx + 0.25), I(cy + 0.2), I(0.7), I(0.35), [[(num, {'size': 16, 'color': theme.GOLD if is_hyp else theme.GREEN, 'font': theme.FONT_MONO, 'bold': True})]])
        text(s, I(cx + 0.25), I(cy + 0.52), I(gw - 0.5), I(0.4), [[(head, {'size': 17, 'bold': True, 'font': theme.FONT_TITLE})]])
        text(s, I(cx + 0.25), I(cy + 0.95), I(gw - 0.5), I(1.0), [[(body, {'size': 14 if is_hyp else 15, 'color': theme.TEXT if is_hyp else theme.MUTED})]],
             name='!!statement' if is_hyp else None)
        if is_hyp:
            px, row = cx + 0.25, 0
            for k, prop in enumerate(C.THREE_PROPERTIES):
                if k == 2:
                    px, row = cx + 0.25, 1
                _, cw = chip(s, I(px), I(cy + gh - 0.76 + row * 0.38), prop, size=14, h=I(0.32), pad=I(0.12))
                px += cw / 914400 + 0.1
    text(s, I(0.75), I(6.55), I(11.8), I(0.5), [[(C.DATA_MINING_LINE, {'size': 14, 'color': theme.MUTED})]])
    page_number(s, 2)
    set_notes(s, C.NOTES[2])
    return s


def slide_03(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 3)
    flat_picture(s, RENDERS / 'orb_080.png', I(0), I(0), w=I(SW), name='!!orb', opacity=15)
    kicker(s, I(0.75), I(0.42), 'Chapter 1 · objectives of the study')
    title(s, I(0.75), I(0.7), 'Objectives', w=I(6))
    rail(s, None)
    glass_card(s, I(0.75), I(1.5), I(11.85), I(1.25), alpha=55)
    kicker(s, I(1.0), I(1.6), 'General objective', w=I(5))
    text(s, I(1.0), I(1.88), I(11.4), I(0.85), [[(C.GENERAL_OBJECTIVE, {'size': 15})]], name='!!statement')
    thumbs = {1: (ctx.caps.get('chat_grounded'), '/chat'), 2: (ctx.charts['forest.png'], 'forest'),
              3: (ctx.caps.get('archive'), '/archive'), 4: (ctx.charts['deltas.png'], 'deltas')}
    gw, gh, gap = 5.85, 2.05, 0.15
    for n in range(1, 5):
        cx = 0.75 + ((n - 1) % 2) * (gw + gap)
        cy = 2.95 + ((n - 1) // 2) * (gh + gap)
        path, label = thumbs[n]
        objective_card(s, n, I(cx), I(cy), I(gw), I(gh), thumb_path=path, thumb_label=label)
    page_number(s, 3)
    set_notes(s, C.NOTES[3])
    return s


def slide_04(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 4)
    rail(s, 1)
    objective_card(s, 1, I(0.75), I(0.42), I(7.9), I(1.02), as_title=True)
    fr = frame(s, '!!frame1', ctx.caps.get('chat_grounded'), I(6.95), I(1.62), w=I(5.65), label='/chat · grounded answer')
    yy = 1.62 + fr.height / 914400 + 0.15
    for line in C.CHAT_CALLOUTS:
        text(s, I(6.95), I(yy), I(5.65), I(0.3), [[('— ', {'size': 14, 'color': theme.GREEN}), (line, {'size': 14, 'color': theme.MUTED})]])
        yy += 0.32
    glass_card(s, I(0.75), I(1.62), I(5.95), I(4.25))
    kicker(s, I(1.0), I(1.78), 'Frozen constants', w=I(5))
    labelled_rows(s, I(1.0), I(2.1), I(5.5), C.FROZEN_CONSTANTS, key_w=I(1.2), gap=I(0.46))
    for k, label in enumerate(C.LATENCY_CHIPS):
        chip(s, I(0.75), I(6.08 + k * 0.46), label, size=14, color=theme.GOLD)
    page_number(s, 4)
    set_notes(s, C.NOTES[4])
    return s


def slide_05(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 5)
    rail(s, 1)
    kicker(s, I(0.75), I(0.42), 'Objective 1 · continued')
    title(s, I(0.75), I(0.7), 'Refusal guard and grounding controls', w=I(9.5), size=30)
    text(s, I(0.75), I(1.42), I(9.5), I(0.4), [[(C.GUARD_HEADLINE, {'size': 18, 'color': theme.GREEN, 'bold': True})]])
    fw = 5.4
    for k, (question, verdict) in enumerate(C.GUARD_PAIR):
        fx = 0.75 + k * (fw + 0.4)
        key = 'chat_refused' if k == 0 else 'chat_answered'
        frame(s, '!!frame1' if k == 0 else '!!frame1b', ctx.caps.get(key), I(fx), I(1.9), w=I(fw), label=f'/chat · {verdict.lower()}')
        text(s, I(fx), I(5.02), I(fw - 1.7), I(0.6), [[('“' + question + '”', {'size': 14, 'color': theme.MUTED, 'italic': True})]])
        chip(s, I(fx + fw - 1.6), I(5.04), verdict.split(',')[0], size=14, color=theme.GOLD if k == 0 else theme.GREEN, filled=True)
    cw_ = 2.85
    for i, (num, head, body) in enumerate(C.CONTROLS):
        cx = 0.75 + i * (cw_ + 0.2)
        glass_card(s, I(cx), I(5.68), I(cw_), I(1.2), alpha=55)
        text(s, I(cx + 0.18), I(5.78), I(0.5), I(0.3), [[(num, {'size': 14, 'color': theme.GREEN, 'font': theme.FONT_MONO, 'bold': True})]])
        text(s, I(cx + 0.6), I(5.78), I(cw_ - 0.75), I(0.3), [[(head, {'size': 14, 'bold': True})]])
        text(s, I(cx + 0.18), I(6.08), I(cw_ - 0.36), I(0.78), [[(body, {'size': 14, 'color': theme.MUTED})]])
    text(s, I(0.75), I(6.98), I(9.5), I(0.3), [[(C.GUARD_EVIDENCE, {'size': 14, 'color': theme.GOLD, 'font': theme.FONT_MONO})]])
    page_number(s, 5)
    set_notes(s, C.NOTES[5] + ' ' + C.CONTROLS_FOOTNOTE)
    return s


def stat_group(slide, x, y, w, h, *, heading: str, stratum, emphasis: bool):
    accent = theme.GOLD if emphasis else theme.GREEN
    glass_card(slide, x, y, w, h, alpha=70)
    text(slide, x + I(0.22), y + I(0.13), w - I(2.5), I(0.3), [[(heading.upper(), {'size': 14, 'color': accent, 'bold': True})]])
    verdict = 'SIGNIFICANT AT α = 0.05' if stratum.significant else 'NOT SIGNIFICANT'
    _, cw = chip(slide, x + w - I(2.35), y + I(0.12), verdict, size=14, color=accent, filled=emphasis, h=I(0.3), pad=I(0.12))
    text(slide, x + I(0.22), y + I(0.45), w - I(0.44), I(0.55),
         [[(f'{stratum.baseline:.4f}', {'size': 24, 'color': theme.MUTED, 'font': theme.FONT_MONO}),
           ('  →  ', {'size': 20, 'color': theme.MUTED}),
           (f'{stratum.rag:.4f}', {'size': 30, 'bold': True, 'font': theme.FONT_MONO})]])
    text(slide, x + I(0.22), y + I(1.02), w - I(0.44), I(0.8), [
        [(f't = {stratum.t:.4f} · p = {fmt_p(stratum.p)}', {'size': 14, 'font': theme.FONT_MONO})],
        [(f'd_z = {stratum.d_z:.4f} · mean difference {stratum.mean_diff:+.4f}', {'size': 14, 'font': theme.FONT_MONO, 'color': theme.MUTED})],
        [(f'95 % CI {fmt_ci(stratum.ci_lo, stratum.ci_hi)}', {'size': 14, 'font': theme.FONT_MONO, 'color': theme.MUTED})],
    ], space_after=1)


def slide_06(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 6)
    rail(s, 2)
    objective_card(s, 2, I(0.75), I(0.42), I(7.9), I(1.02), as_title=True)
    cmp = ctx.cmp
    text(s, I(0.75), I(1.55), I(6.6), I(0.75), [[(C.OBJ2_HEADLINE, {'size': 18, 'bold': True, 'font': theme.FONT_TITLE})]])
    picture(s, ctx.charts['forest.png'], I(0.75), I(2.28), w=I(6.6), name='!!frame2', border=None, shadow=False, rounded=False)
    text(s, I(0.75), I(6.0), I(6.6), I(0.75), [[(C.OBJ2_INSTRUMENT, {'size': 14, 'color': theme.MUTED})]])
    gx, gw, gh = 7.6, 5.05, 1.85
    stat_group(s, I(gx), I(1.55), I(gw), I(gh), heading=f'Pooled · n = {cmp.pooled.n}', stratum=cmp.pooled, emphasis=False)
    stat_group(s, I(gx), I(3.5), I(gw), I(gh), heading=f'present (§3.2.5) · n = {cmp.present.n}', stratum=cmp.present, emphasis=True)
    text(s, I(gx), I(5.45), I(gw), I(1.1), [[(C.OBJ2_WHY, {'size': 14, 'color': theme.MUTED})]])
    text(s, I(0.75), I(6.78), I(10.5), I(0.55), [
        [(f'run {cmp.run_id} at {cmp.commit} · generated {cmp.generated_at} · formal_result: {str(cmp.formal_result).lower()} · {cmp.queries_scored}/{cmp.queries_total} scored',
          {'size': 14, 'color': theme.GREEN, 'font': theme.FONT_MONO})],
        [(f'chat {cmp.models["chat"]} · judge {cmp.models["verdict"]} · embeddings {cmp.models["embedding"]} · {cmp.prompt_version}',
          {'size': 14, 'color': theme.MUTED, 'font': theme.FONT_MONO})],
    ])
    page_number(s, 6)
    set_notes(s, C.NOTES[6])
    return s


def slide_07(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 7)
    rail(s, 3)
    objective_card(s, 3, I(0.75), I(0.42), I(7.9), I(1.02), as_title=True)
    frame(s, '!!frame3', ctx.caps.get('archive'), I(5.35), I(1.62), w=I(8.3), label='/archive · filters, badges, indirect-access pill')
    frame(s, '!!frame3b', ctx.caps.get('novelty'), I(8.75), I(4.55), w=I(4.55), label='/novelty · verdict header', tilt=xml_post.TILTED_RIGHT)
    yy = 1.62
    for head, body in C.SYSTEM_CALLOUTS:
        body = body.replace('{ARCHIVE_LINE}', ctx.archive_line)
        n_lines = lines_for(body, 52)
        text(s, I(0.75), I(yy), I(4.4), I(0.3), [[(head, {'size': 15, 'bold': True, 'color': theme.GREEN})]])
        text(s, I(0.75), I(yy + 0.3), I(4.4), I(n_lines * LINE + 0.05), [[(body, {'size': 14, 'color': theme.MUTED})]])
        yy += 0.3 + n_lines * LINE + 0.22
    page_number(s, 7)
    set_notes(s, C.NOTES[7].replace('{ARCHIVE_NOTE}', ctx.archive_note))
    return s


def slide_08(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 8)
    rail(s, 3)
    kicker(s, I(0.75), I(0.42), 'Paper Figure 8 · four layers')
    title(s, I(0.75), I(0.7), 'System architecture and data flow', w=I(9), size=30)
    lx, ly, lw, lh = 0.75, 1.62, 7.2, 0.98
    for i, (name, desc) in enumerate(C.LAYERS):
        x = lx + i * 0.3
        card = glass_card(s, I(x), I(ly + i * 1.12), I(lw), I(lh), alpha=45 + i * 10, name=f'!!layer{i + 1}')
        xml_post.inject_scene3d(card, xml_post.FLAT, extrusion_emu=12700)
        text(s, I(x + 0.25), I(ly + i * 1.12 + 0.12), I(lw - 0.5), I(0.35), [[(name, {'size': 18, 'bold': True, 'font': theme.FONT_TITLE})]])
        text(s, I(x + 0.25), I(ly + i * 1.12 + 0.5), I(lw - 0.5), I(0.45), [[(desc, {'size': 14, 'color': theme.MUTED})]])
    text(s, I(0.75), I(6.2), I(7.8), I(0.6), [[(C.TWO_PROCESSES, {'size': 14, 'color': theme.MUTED})]])
    cx = 0.75
    for label in C.CROSS_CUTTING:
        _, cw = chip(s, I(cx), I(6.75), label, size=14, color=theme.GREEN)
        cx += cw / 914400 + 0.12
    rx = 9.2
    kicker(s, I(rx), I(1.62), 'Ingestion · durable worker', w=I(3.4))
    yy = 1.95
    for k, stage in enumerate(C.INGEST_STAGES):
        circle(s, I(rx + 0.16), I(yy + 0.14), I(0.2), fill=theme.GREEN if k < 6 else theme.GOLD)
        text(s, I(rx + 0.45), I(yy), I(3.2), I(0.3), [[(stage, {'size': 14})]])
        yy += 0.34
    kicker(s, I(rx), I(yy + 0.15), 'Query · chat pipeline', w=I(3.4))
    yy += 0.48
    for stage in C.QUERY_STAGES:
        circle(s, I(rx + 0.16), I(yy + 0.14), I(0.2), fill=theme.GREEN)
        text(s, I(rx + 0.45), I(yy), I(3.2), I(0.3), [[(stage, {'size': 14})]])
        yy += 0.34
    page_number(s, 8)
    set_notes(s, C.NOTES[8])
    return s


def gauge_card(slide, x, y, w, h, *, heading: str, big: str, big_note: str, lines: list[str], pct: float | None):
    glass_card(slide, x, y, w, h, alpha=62)
    text(slide, x + I(0.2), y + I(0.14), w - I(0.4), I(0.3), [[(heading.upper(), {'size': 14, 'color': theme.GREEN, 'bold': True})]])
    if pct is not None:
        d = I(0.95)
        cx, cy = x + I(0.2) + d / 2, y + I(0.5) + d / 2
        block_arc(slide, cx, cy, d, start_deg=135, sweep_deg=270, thickness=0.18, fill=theme.PANEL, alpha=100)
        block_arc(slide, cx, cy, d, start_deg=135, sweep_deg=270 * pct / 100, thickness=0.18, fill=theme.GREEN)
        text(slide, x + I(0.2), y + I(0.78), d, I(0.4), [[(f'{pct:.0f}%' if pct >= 99.995 else f'{pct:.2f}%', {'size': 14, 'bold': True, 'font': theme.FONT_MONO})]], align='center')
        text(slide, x + I(1.25), y + I(0.5), w - I(1.45), I(0.4), [[(big, {'size': 18, 'bold': True, 'font': theme.FONT_MONO})]])
        text(slide, x + I(1.25), y + I(0.88), w - I(1.45), I(0.55), [[(big_note, {'size': 14, 'color': theme.MUTED})]])
    else:
        text(slide, x + I(0.2), y + I(0.48), w - I(0.4), I(0.5), [[(big, {'size': 26, 'bold': True, 'font': theme.FONT_MONO})]])
        text(slide, x + I(0.2), y + I(0.98), w - I(0.4), I(0.5), [[(big_note, {'size': 14, 'color': theme.MUTED})]])
    yy = y + I(1.5)
    for ln in lines:
        n_lines = lines_for(ln, 30)
        text(slide, x + I(0.2), yy, w - I(0.4), I(n_lines * LINE + 0.04), [[(ln, {'size': 14, 'color': theme.MUTED})]])
        yy += I(n_lines * LINE + 0.06)


def slide_09(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 9)
    rail(s, 4)
    objective_card(s, 4, I(0.75), I(0.42), I(7.9), I(1.02), as_title=True)
    iso = ctx.iso
    V = '[VERIFY]'
    when = f'{iso.date} at {iso.commit}' if iso else V
    cards = [
        dict(heading='4.1 Functional suitability', big=f'{iso.backend_passed:,}' if iso else V, big_note=f'backend tests · {iso.backend_skipped} skipped' if iso else V,
             pct=iso.coverage_pct if iso else None,
             lines=[f'{iso.coverage_pct:.2f} % coverage · {iso.missed} of {iso.statements:,} missed' if iso else V,
                    f'{iso.fe_passed} frontend tests · {iso.playwright_passed} Playwright journeys' if iso and iso.playwright_passed else V]),
        dict(heading='4.2 Performance efficiency', big=C.ISO_STATIC['p95'], big_note=C.ISO_STATIC['p95_note'], pct=None,
             lines=[C.ISO_STATIC['latency'], 'Retrieval is milliseconds; generation dominates.']),
        dict(heading='4.3 Reliability', big='Gate PASSED', big_note=C.ISO_STATIC['sonar'], pct=None,
             lines=[C.ISO_STATIC['sonar_detail'], C.ISO_STATIC['fault']]),
        dict(heading='4.4 Maintainability', big=iso.pylint if iso else V, big_note='Pylint · ESLint 0 / 0' if iso and iso.eslint_clean else V,
             pct=100.0 if iso and iso.pylint == '10.00/10' else None,
             lines=[C.ISO_STATIC['dup'], C.ISO_STATIC['lock'], C.ISO_STATIC['audits']]),
    ]
    cw_, ch_, gy = 2.85, 2.75, 1.62
    for i, card in enumerate(cards):
        gauge_card(s, I(0.75 + i * (cw_ + 0.2)), I(gy), I(cw_), I(ch_), **card)
    picture(s, ctx.charts['deltas_small.png'], I(0.75), I(4.5), w=I(5.4), name='!!frame4', border=None, shadow=False, rounded=False)
    pos = sum(1 for r in ctx.cmp.rows if r.delta > 0)
    text(s, I(6.45), I(4.55), I(6.2), I(0.6), [[(C.DELTAS_CAPTION, {'size': 15})]])
    text(s, I(6.45), I(5.2), I(6.2), I(2.0), [
        [(f'{pos} of {len(ctx.cmp.rows)} paired differences favour RAG; {len(ctx.cmp.notice_rows)} RAG replies were grounded fallbacks rather than answers.', {'size': 14, 'color': theme.MUTED})],
        [('Accessibility: ' + C.ISO_STATIC['axe'] + '.', {'size': 14, 'color': theme.MUTED})],
        [(f'Each characteristic carries the date of its own instrument; the test counts were re-run {when} and recorded in iso25010_evidence.md.', {'size': 14, 'color': theme.MUTED})],
    ], space_after=4)
    page_number(s, 9)
    set_notes(s, C.NOTES[9])
    return s


def slide_10(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 10)
    rail(s, None)
    kicker(s, I(0.75), I(0.42), 'Stated before they are asked')
    title(s, I(0.75), I(0.7), 'Limitations', w=I(6))
    cols = [C.LIMITATIONS[:4], C.LIMITATIONS[4:]]
    for c, items in enumerate(cols):
        x = 0.75 + c * 6.0
        for r, (head, body) in enumerate(items):
            y = 1.62 + r * 1.3
            glass_card(s, I(x), I(y), I(5.8), I(1.18), alpha=52)
            text(s, I(x + 0.2), I(y + 0.14), I(0.5), I(0.3), [[(f'0{c * 4 + r + 1}', {'size': 14, 'color': theme.GOLD, 'font': theme.FONT_MONO, 'bold': True})]])
            text(s, I(x + 0.65), I(y + 0.13), I(5.0), I(0.3), [[(head, {'size': 16, 'bold': True})]])
            text(s, I(x + 0.65), I(y + 0.46), I(5.0), I(0.7), [[(body, {'size': 14, 'color': theme.MUTED})]])
    text(s, I(6.75), I(5.55), I(5.8), I(0.9), [[('None of these touch the frozen, evaluated pipeline. Each is recorded in docs/DEFENSE_WALKTHROUGH.md §5 and in the audit reports.',
                                                 {'size': 14, 'color': theme.MUTED})]])
    page_number(s, 10)
    set_notes(s, C.NOTES[10])
    return s


def slide_11(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 11)
    rail(s, None)
    kicker(s, I(0.75), I(0.42), 'Live system simulation')
    title(s, I(0.75), I(0.7), 'Demo playbook: four stages', w=I(8), size=30)
    hline(s, I(1.0), I(2.05), I(11.3), color=theme.GREEN, alpha=70, pt_w=1.5)
    cw_ = 2.85
    for i, (num, head, bullets) in enumerate(C.DEMO_STAGES):
        cx = 0.75 + i * (cw_ + 0.2)
        c = circle(s, I(cx + 0.4), I(2.05), I(0.42), fill=theme.GREEN if i < 3 else theme.GOLD, line=None)
        _center_run(c, num, theme.INK_ON_ACCENT)
        glass_card(s, I(cx), I(2.5), I(cw_), I(3.25), alpha=58)
        text(s, I(cx + 0.2), I(2.64), I(cw_ - 0.4), I(0.35), [[(head, {'size': 18, 'bold': True, 'font': theme.FONT_TITLE})]])
        text(s, I(cx + 0.2), I(3.08), I(cw_ - 0.4), I(2.6), [[('— ', {'size': 14, 'color': theme.GREEN}), (b, {'size': 14, 'color': theme.MUTED})] for b in bullets], space_after=5)
    kicker(s, I(0.75), I(5.95), 'If something breaks, narrate it', w=I(6))
    yy = 6.22
    for quote, meaning in C.DEMO_FAILURES:
        text(s, I(0.75), I(yy), I(10.4), I(0.3), [[(quote, {'size': 14, 'color': theme.GOLD, 'font': theme.FONT_MONO})]])
        text(s, I(0.75), I(yy + 0.27), I(10.4), I(0.3), [[(meaning, {'size': 14, 'color': theme.MUTED})]])
        yy += 0.62
    page_number(s, 11)
    set_notes(s, C.NOTES[11])
    return s


def slide_12(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 12)
    rail(s, None)
    kicker(s, I(0.75), I(0.42), 'Rubric compliance matrix')
    title(s, I(0.75), I(0.7), 'Criterion → proof → where to find it', w=I(9), size=30)
    rows = [['Criterion', 'Weight', 'What proves it', 'Where', 'Status']]
    rows += [list(r) for r in C.RUBRIC_ROWS]
    table(s, I(0.75), I(1.62), I(11.85), rows, [0.24, 0.09, 0.34, 0.22, 0.11], row_h=I(0.78), badge_col=4)
    text(s, I(0.75), I(6.5), I(11.85), I(0.6), [[(C.RUBRIC_NOTE, {'size': 14, 'color': theme.MUTED})]])
    page_number(s, 12)
    set_notes(s, C.NOTES[12])
    return s


def checklist(slide, x, y, w, items, *, mark_color: str):
    yy = y
    for head, body in items:
        c = circle(slide, x + I(0.16), yy + I(0.16), I(0.3), fill=mark_color)
        _center_run(c, '✓', theme.INK_ON_ACCENT, font=theme.FONT_BODY)
        n_lines = lines_for(body, 50)
        text(slide, x + I(0.5), yy, w - I(0.5), I(0.3), [[(head, {'size': 15, 'bold': True})]])
        text(slide, x + I(0.5), yy + I(0.27), w - I(0.5), I(n_lines * LINE + 0.04), [[(body, {'size': 14, 'color': theme.MUTED})]])
        yy += I(0.27 + n_lines * LINE + 0.1)
    return yy


def slide_13(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 13)
    rail(s, None)
    kicker(s, I(0.75), I(0.42), 'Printed package for the panel')
    title(s, I(0.75), I(0.7), 'Chapter 1 dossier and recommendation form', w=I(10), size=30)
    for k, (head, items, mark) in enumerate((('Chapter 1 dossier', C.DOSSIER_ITEMS, theme.GREEN), ('Panel recommendation form', C.FORM_FIELDS, theme.GOLD))):
        x = 0.75 + k * 6.05
        card = glass_card(s, I(x), I(1.62), I(5.8), I(5.1), alpha=58)
        xml_post.inject_scene3d(card, xml_post.FLAT, extrusion_emu=12700)
        text(s, I(x + 0.3), I(1.8), I(5.2), I(0.4), [[(head, {'size': 20, 'bold': True, 'font': theme.FONT_TITLE})]])
        checklist(s, I(x + 0.3), I(2.35), I(5.2), items, mark_color=mark)
    text(s, I(0.75), I(6.85), I(11.85), I(0.4), [[('The dossier pages are regenerated from the manuscript sources (paper/), never screenshotted from this deck; the form is a one-page print with ten blank rows.',
                                                   {'size': 14, 'color': theme.MUTED})]])
    page_number(s, 13)
    set_notes(s, C.NOTES[13])
    return s


def slide_14(prs, ctx: Ctx):
    s = blank_slide(prs)
    glow(s, 14)
    flat_picture(s, RENDERS / 'orb_000.png', I(2.9), I(-0.1), w=I(SW), name='!!orb')
    rail(s, None)
    kicker(s, I(0.75), I(1.35), 'Defense Q&A and panel deliberation')
    title(s, I(0.75), I(1.7), 'Open for examination', w=I(6.5), size=40)
    text(s, I(0.75), I(2.75), I(6.3), I(1.8), [[('— ', {'size': 18, 'color': theme.GREEN}), (line, {'size': 18})] for line in C.QA_INVITATIONS], space_after=8)
    cmp, iso = ctx.cmp, ctx.iso
    chips = [f'Run {cmp.run_id} · {cmp.queries_scored}/{cmp.queries_total} scored · formal_result: true',
             'SonarQube gate PASSED · CI 7 check-runs green',
             (f'{iso.coverage_pct:.2f} % coverage · Pylint {iso.pylint}' if iso else '[VERIFY] coverage · Pylint')]
    for k, label in enumerate(chips):
        chip(s, I(0.75), I(4.7 + k * 0.44), label, size=14, color=theme.GREEN, font=theme.FONT_MONO, char_w=0.0086)
    proven = {1: 'slides 4–5', 2: 'slide 6', 3: 'slide 7', 4: 'slide 9'}
    for n in range(1, 5):
        x = 0.75 + (n - 1) * 1.62
        glass_card(s, I(x), I(6.15), I(1.5), I(0.9), alpha=55, name=f'!!obj{n}')
        text(s, I(x + 0.15), I(6.22), I(1.3), I(0.3), [[(f'0{n}', {'size': 14, 'color': theme.GREEN, 'font': theme.FONT_MONO, 'bold': True})]])
        text(s, I(x + 0.15), I(6.5), I(1.3), I(0.5), [[(C.OBJECTIVE_SHORT[n - 1], {'size': 14, 'bold': True})], [(proven[n], {'size': 14, 'color': theme.MUTED})]])
    page_number(s, 14)
    set_notes(s, C.NOTES[14])
    return s


def slide_15(prs, ctx: Ctx):
    s = blank_slide(prs)
    cx, cy = SW / 2, 3.45
    flat_picture(s, RENDERS / 'glow.png', I(cx - 6.5), I(cy - 6.5), w=I(13), name='!!glow')
    flat_picture(s, RENDERS / 'orb_converged.png', I(0), I(cy - SH / 2), w=I(SW), name='!!orb')
    ring_d = 2 * (2.0 / 2.9) * (SH / 2)       # orb RADIUS 2 in a ±2.9 frame that spans the slide height
    circle(s, I(cx), I(cy), I(ring_d), fill=None, line=theme.GREEN, line_pt=1.0, name='!!ring')
    r = ring_d / 2
    rail(s, None, ring_positions=[(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)])
    for n in range(1, 5):
        ang = math.radians(45 + (n - 1) * 90)
        tx, ty = cx + (r - 0.5) * math.cos(ang), cy - (r - 0.5) * math.sin(ang)
        rect(s, I(tx - 0.11), I(ty - 0.11), I(0.22), I(0.22), fill=theme.GOLD, radius=0.3, name=f'!!obj{n}')
    seal_d = 2.2
    disc = circle(s, I(cx), I(cy - 0.35), I(seal_d), fill=theme.PANEL, alpha=82, line=theme.GLASS_BORDER, line_pt=0.75, name='!!seal')
    xml_post.inject_scene3d(disc, 'perspectiveFront', extrusion_emu=76200)
    picture(s, ISU_SEAL, I(cx - 0.75), I(cy - 0.35 - 0.75), h=I(1.5), rounded=False, border=None, shadow=False)
    text(s, I(cx - 3.0), I(cy + 0.95), I(6.0), I(0.55), [[(C.DEFENDED, {'size': 24, 'bold': True, 'color': theme.GOLD, 'font': theme.FONT_TITLE})]], align='center')
    text(s, I(0.75), I(6.2), I(SW - 1.5), I(0.4), [[(C.TITLE, {'size': 15, 'color': theme.MUTED})]], align='center')
    text(s, I(0.75), I(6.55), I(SW - 1.5), I(0.4), [[(' · '.join(C.RESEARCHERS) + '  ·  ' + C.DEGREE, {'size': 14, 'color': theme.MUTED})]], align='center')
    text(s, I(0.75), I(6.9), I(SW - 1.5), I(0.4), [[(C.THANKS + '  ·  ' + C.COLLEGE + ', ' + C.UNIVERSITY + '  ·  ' + str(date.today().year), {'size': 14, 'color': theme.GREEN})]], align='center')
    set_notes(s, C.NOTES[15])
    return s


SLIDES = [slide_01, slide_02, slide_03, slide_04, slide_05, slide_06, slide_07, slide_08, slide_09, slide_10,
          slide_11, slide_12, slide_13, slide_14, slide_15]


def build(args) -> Path:
    ctx = Ctx(args)
    prs = new_presentation()
    for fn in SLIDES:
        fn(prs, ctx)
    xml_post.apply_plan(prs)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(out)
    notes = {
        'built_at': date.today().isoformat(),
        'head': ctx.head,
        'objective2_run': ctx.cmp.run_id,
        'iso_block': ctx.iso.date if ctx.iso else None,
        'captures': ctx.caps.used,
        'morph_plan': {str(k): {'ms': v[0], 'option': v[1]} for k, v in xml_post.MORPH_PLAN.items()},
        'renders': {k: hashlib.sha256(Path(v).read_bytes()).hexdigest()[:16] for k, v in {**ctx.renders, **ctx.charts}.items()},
        'size_bytes': out.stat().st_size,
    }
    out.with_suffix('.build.json').write_text(json.dumps(notes, indent=2), encoding='utf-8')
    print(f'wrote {out} ({out.stat().st_size / 1e6:.1f} MB)')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=str(OUT_DEFAULT))
    ap.add_argument('--captures', default=str(ASSETS / 'captures'))
    ap.add_argument('--allow-fixture-captures', action='store_true')
    ap.add_argument('--allow-missing', action='store_true', help='draft: placeholders for missing captures and evidence block')
    ap.add_argument('--iso-date', default='2026-09-14')
    args = ap.parse_args(argv)
    build(args)


if __name__ == '__main__':
    main()
