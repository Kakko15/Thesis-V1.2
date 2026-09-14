"""DrawingML that python-pptx cannot emit: Morph transitions, 3D camera presets, and spins.

The transition element on slide N describes the transition *into* N. Morph matches objects
across consecutive slides by identity, or by an identical name beginning with ``!!``;
``build.py`` names its persistent objects that way. The ``mc:Fallback`` is not optional: it is
the fade that PowerPoint 2016 and earlier play instead of rejecting the file. Namespace
prefixes are declared inline because ``p14``, ``p159`` and ``mc`` are not in python-pptx's map.
The duration attribute is ``p14:dur``; the ``morph`` element itself is ``p159`` (PowerPoint
2015/09), which the master prompt got wrong.

``inject_spin`` adds a within-slide emphasis animation (a continuous rotation that starts with
the slide) through a ``p:timing`` tree, which must follow the transition in the slide element.
"""

from __future__ import annotations

from pptx.oxml import parse_xml
from pptx.oxml.ns import qn

P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
P14_NS = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
P159_NS = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main'   # Morph lives here, not in p14
MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

# slide number -> (duration ms, morph option). Slide 1 has no transition.
MORPH_PLAN: dict[int, tuple[int, str]] = {
    2: (1000, 'byObject'),   # orb translates left and compresses
    3: (750, 'byWord'),      # hypothesis resolves into the general objective
    4: (750, 'byObject'),    # !!obj1 grows; !!frame1 tilts flat
    5: (1000, 'byObject'),   # the chat frame splits into the refusal pair
    6: (750, 'byObject'),    # !!obj2
    7: (1000, 'byObject'),   # !!obj3; archive bleed
    8: (750, 'byObject'),
    9: (750, 'byObject'),    # !!obj4
    10: (1250, 'byObject'),  # the orb returns at slide-1 scale
    11: (1500, 'byObject'),  # the collapse: orb, rail and objective cards converge
}

# Verified 2026-09-14 by round-tripping through PowerPoint 365 (16.0.20326): a `p14:morph`
# child, which the master prompt's snippet used, is silently discarded and the slide
# re-saves with no transition. `p159:morph` under `Requires="p159"` survives.
_MORPH = (
    f'<mc:AlternateContent xmlns:mc="{MC_NS}" xmlns:p="{P_NS}" xmlns:p14="{P14_NS}" xmlns:p159="{P159_NS}">'
    '<mc:Choice Requires="p159"><p:transition spd="slow" p14:dur="{dur}"><p159:morph option="{opt}"/></p:transition></mc:Choice>'
    '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>'
    '</mc:AlternateContent>'
)


def inject_morph(slide, dur_ms: int, option: str = 'byObject') -> None:
    if not 500 <= dur_ms <= 1500:
        raise ValueError(f'morph duration {dur_ms} ms outside the 500-1500 ms rule')
    if option not in ('byObject', 'byWord', 'byChar'):
        raise ValueError(option)
    el = slide._element
    for old in el.findall(f'{{{MC_NS}}}AlternateContent'):
        el.remove(old)
    for old in el.findall(qn('p:transition')):
        el.remove(old)
    timing = el.find(qn('p:timing'))
    node = parse_xml(_MORPH.format(dur=dur_ms, opt=option))
    if timing is not None:
        timing.addprevious(node)       # transition precedes timing in CT_Slide
    else:
        el.append(node)


def apply_plan(prs, plan: dict[int, tuple[int, str]] = MORPH_PLAN) -> None:
    for idx, slide in enumerate(prs.slides, start=1):
        if idx in plan:
            dur, opt = plan[idx]
            inject_morph(slide, dur, opt)


# One continuous rotation (presetID 8 = Spin, emphasis) on one shape, started with the slide and
# repeated until the slide ends. 21600000 = 360 degrees in 60000ths.
_SPIN = (
    f'<p:timing xmlns:p="{P_NS}"><p:tnLst><p:par>'
    '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
    '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>'
    '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>'
    '<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
    '{effects}'
    '</p:childTnLst></p:cTn></p:par>'
    '</p:childTnLst></p:cTn></p:par>'
    '</p:childTnLst></p:cTn>'
    '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
    '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
    '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
)
_EFFECT = (
    '<p:par><p:cTn id="{cid}" presetID="8" presetClass="emph" presetSubtype="0" repeatCount="indefinite" '
    'fill="hold" grpId="0" nodeType="withEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
    '<p:animRot by="{by}"><p:cBhvr><p:cTn id="{cid2}" dur="{dur}" fill="hold"/>'
    '<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst>'
    '</p:cBhvr></p:animRot></p:childTnLst></p:cTn></p:par>'
)


def inject_spins(slide, spins: list[tuple[object, float, bool]]) -> None:
    """spins: (shape, seconds per revolution, clockwise). Replaces any existing timing tree."""
    el = slide._element
    for old in el.findall(qn('p:timing')):
        el.remove(old)
    effects = ''
    cid = 5
    for shape, seconds, clockwise in spins:
        effects += _EFFECT.format(cid=cid, cid2=cid + 1, by=21600000 if clockwise else -21600000,
                                  dur=int(seconds * 1000), spid=shape.shape_id)
        cid += 2
    el.append(parse_xml(_SPIN.format(effects=effects)))


_SCENE = f'<a:scene3d xmlns:a="{A_NS}"><a:camera prst="{{prst}}"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>'
_SP3D = (f'<a:sp3d xmlns:a="{A_NS}" extrusionH="{{ext}}" contourW="12700"><a:contourClr><a:srgbClr val="{{contour}}"/>'
         '</a:contourClr></a:sp3d>')

TILTED = 'perspectiveContrastingLeftFacing'
TILTED_RIGHT = 'perspectiveContrastingRightFacing'
FLAT = 'orthographicFront'


def inject_scene3d(shape, prst: str = FLAT, extrusion_emu: int = 0, contour: str = '2A3038') -> None:
    """Append a camera (and optional extrusion) to a picture or shape; call last."""
    sppr = shape._element.spPr
    for tag in ('a:scene3d', 'a:sp3d'):
        for old in sppr.findall(qn(tag)):
            sppr.remove(old)
    sppr.append(parse_xml(_SCENE.format(prst=prst)))
    if extrusion_emu:
        sppr.append(parse_xml(_SP3D.format(ext=extrusion_emu, contour=contour)))


def has_morph(slide) -> tuple[bool, int | None, str | None, bool]:
    """(present, duration, option, fallback present) for the verifier."""
    el = slide._element
    ac = el.find(f'{{{MC_NS}}}AlternateContent')
    if ac is None:
        return False, None, None, False
    morph = ac.find(f'.//{{{P159_NS}}}morph')
    trans = ac.find(f'.//{{{P_NS}}}transition')
    fallback = ac.find(f'{{{MC_NS}}}Fallback')
    dur = trans.get(f'{{{P14_NS}}}dur') if trans is not None else None
    return morph is not None, int(dur) if dur else None, morph.get('option') if morph is not None else None, fallback is not None


def spin_targets(slide) -> list[int]:
    """Shape ids carrying a spin animation, for the verifier."""
    return [int(t.get('spid')) for t in slide._element.iter(f'{{{P_NS}}}spTgt')]
