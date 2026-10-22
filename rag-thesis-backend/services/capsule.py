"""Capsule proposal screening: the pure half of POST /duplication/capsule.

A capsule is the short blueprint an adviser reviews before a full manuscript
exists -- working title, rationale and significance, research questions or
objectives, and methodology. Screening one the way a manuscript is screened
does not work: a capsule is a page or two, so the 800-token chunker turns it
into one or two chunks and the "share of the thesis that points at one archived
thesis" can only come out 0%, 50% or 100%.

So each section is screened on its own, and a section plays the role a chunk
plays for a manuscript: the verdict bands are the same (services/novelty.py::
verdict_for_concentration, 25 and 70), graded on the share of sections whose
closest archived thesis is the same one at or above the duplication threshold.
A section that is close to the archive but under the threshold is still
reported with its closest thesis, because for a proposal "what does this
resemble" is the question an adviser asks even when nothing is flagged.

Timeline and budget are deliberately not sections here: they say nothing about
whether a study has already been done.

Nothing in this module is part of the evaluated manuscript pipeline; it reuses
the frozen threshold and bands rather than defining new ones.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from services.novelty import percent, verdict_for_concentration

# Order is the order a capsule is written and read in.
CAPSULE_SECTIONS: tuple[tuple[str, str], ...] = (
    ('title', 'Working title'),
    ('rationale', 'Rationale and significance'),
    ('objectives', 'Research questions / objectives'),
    ('methodology', 'Methodology'),
)
SECTION_LABELS = dict(CAPSULE_SECTIONS)

# Below this, an archived chunk is not shown as a section's "closest" thesis.
# A short section embeds close to almost anything in a one-department archive,
# so without a floor every section names some thesis and the report reads as
# an accusation. Advisory display only; flagging uses the duplication threshold.
CLOSEST_FLOOR = 0.60

# Title wording is a character ratio, not an embedding cosine, so it is not
# held to the duplication threshold. Titles in one department share templates
# ("Inventory Management System for ISU Cabagan" / "... Echague" is 0.88), and
# at 0.85 those would flag on wording alone. Two titles above this share nearly
# every character, which is the case worth flagging.
TITLE_WORDING_FLAG = 0.92

# Minimum length of a body section worth screening. Shorter than this, an
# embedding says more about the phrasing than about the study.
MIN_SECTION_CHARACTERS = 40

_WORD = re.compile(r'[a-z0-9]+')
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')
_SPACE = re.compile(r'\s+')


def clean_text(value: str | None) -> str:
    """Strip control characters and collapse whitespace."""
    return _SPACE.sub(' ', _CONTROL.sub(' ', value or '')).strip()


def display_name(title: str, limit: int = 200) -> str:
    """The name a capsule is listed under in scan history."""
    name = clean_text(title)
    return name if len(name) <= limit else name[: limit - 1].rstrip() + '…'


def title_wording_similarity(left: str, right: str) -> float:
    """How closely two titles share wording, 0-1, ignoring case and punctuation."""
    left_words = _WORD.findall((left or '').lower())
    right_words = _WORD.findall((right or '').lower())
    if not left_words or not right_words:
        return 0.0
    return SequenceMatcher(None, ' '.join(left_words), ' '.join(right_words)).ratio()


def closest_title(title: str, papers: list[dict]) -> tuple[dict | None, float]:
    """The archived paper whose title is worded most like `title`."""
    best, best_score = None, 0.0
    for paper in papers:
        score = title_wording_similarity(title, paper.get('title') or '')
        if score > best_score:
            best, best_score = paper, score
    return best, best_score


@dataclass
class SectionResult:
    key: str
    text: str
    similarity: float = 0.0          # 0-1, the section's closest archived match
    paper_id: str | None = None
    archived_excerpt: str = ''       # never public; grounds the follow-up chat
    basis: str = 'meaning'           # 'meaning' (embedding) or 'wording' (title text)

    def flagged(self, threshold: float) -> bool:
        limit = max(threshold, TITLE_WORDING_FLAG) if self.basis == 'wording' else threshold
        return self.paper_id is not None and self.similarity >= limit


def best_match(matches: list[dict]) -> dict | None:
    """The single closest archived chunk among a section's candidates."""
    candidates = [match for match in matches if match.get('paper_id')]
    return max(candidates, key=lambda match: match.get('similarity') or 0.0, default=None)


def grade(sections: list[SectionResult], threshold: float) -> dict:
    """The scan-history figures for a capsule, in the manuscript scan's terms.

    `total_chunks` is the number of sections screened and `matched_chunk_count`
    the number flagged, so the stored record reads the same way a manuscript's
    does and the report, the history list, and the metadata export need no
    second code path. `top_matches[].match_count` is the number of flagged
    sections pointing at that thesis, which is what the client's concentration
    figure is derived from.
    """
    total = len(sections)
    flagged = [section for section in sections if section.flagged(threshold)]
    per_paper: dict[str, dict] = {}
    for section in flagged:
        entry = per_paper.setdefault(section.paper_id, {'count': 0, 'similarity': 0.0, 'sections': []})
        entry['count'] += 1
        entry['similarity'] = max(entry['similarity'], section.similarity)
        entry['sections'].append(section.key)
    ranked = sorted(per_paper.items(), key=lambda item: (item[1]['count'], item[1]['similarity']), reverse=True)
    top_count = ranked[0][1]['count'] if ranked else 0
    concentration = (top_count / total * 100) if total else 0.0
    return {
        'total_chunks': total,
        'matched_chunk_count': len(flagged),
        'matched_chunk_percentage': (len(flagged) / total * 100) if total else 0.0,
        'duplication_percentage': (len(flagged) / total * 100) if total else 0.0,
        # Embedding similarity only: a title wording ratio is shown on its own
        # row, but it is not a passage similarity and is not reported as one.
        'highest_similarity': percent(max(
            (section.similarity for section in sections if section.basis == 'meaning'), default=0.0,
        )),
        'verdict_level': verdict_for_concentration(concentration),
        'ranked_papers': ranked,
    }


def public_sections(sections: list[SectionResult], papers: dict[str, dict], threshold: float) -> list[dict]:
    """Per-section results for the report: metadata only, never archived text."""
    rows = []
    for section in sections:
        paper = papers.get(section.paper_id) if section.paper_id else None
        close = paper is not None and section.similarity >= CLOSEST_FLOOR
        rows.append({
            'key': section.key,
            'label': SECTION_LABELS[section.key],
            'words': len(section.text.split()),
            'similarity': percent(section.similarity) if close else 0.0,
            'flagged': close and section.flagged(threshold),
            'basis': section.basis,
            'closest': {
                'id': paper['id'],
                'title': paper.get('title', ''),
                'authors': paper.get('authors', ''),
                'year': paper.get('year', ''),
                'track': paper.get('track', ''),
            } if close else None,
        })
    return rows


def summary_markdown(rows: list[dict], verdict_level: str, threshold: float, department: str) -> str:
    """A deterministic write-up of the per-section result.

    No model call: every sentence here restates a figure above it, and the
    follow-up chat is where a reviewer asks for interpretation. A list rather
    than a table, because the report renders Markdown without table support.
    """
    heading = {
        'clear': 'Clear',
        'review_suggested': 'Review suggested',
        'high_overlap': 'High overlap — faculty review required',
    }.get(verdict_level, verdict_level)
    lines = [
        f'### Capsule screening: {heading}',
        '',
        f'Each section of the capsule was compared on its own against the {department} archive. '
        f'A section is flagged when its closest archived passage reaches the '
        f'{threshold * 100:.0f}% similarity threshold.',
        '',
    ]
    for row in rows:
        closest = row['closest']
        if closest is None:
            lines.append(f"- **{row['label']}:** no archived thesis is closely similar.")
            continue
        how = 'worded like' if row['basis'] == 'wording' else 'closest to'
        year = f" ({closest['year']})" if closest.get('year') else ''
        mark = ' — **flagged**' if row['flagged'] else ''
        lines.append(f"- **{row['label']}:** {row['similarity']:.1f}% {how} *{closest['title']}*{year}{mark}")
    lines += [
        '',
        'This is a similarity advisory for a proposal, not a plagiarism verdict. '
        'A short section can resemble an archived study without repeating it; '
        'final judgment belongs to the adviser and the committee.',
    ]
    return '\n'.join(lines)
