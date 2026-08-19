"""Server-owned CCSICT academic catalog validation and legacy translation."""

from dataclasses import dataclass

from fastapi import HTTPException

LEGACY_CLASSIFICATIONS = {
    'Data Mining': ('BSCS', 'DM'),
    'Web Development': ('BSIT', 'WMAD'),
    'Network Security': ('BSIT', 'NETSEC'),
}
AMBIGUOUS_LEGACY_TRACKS = {'Intelligent Systems', 'Information Management'}
SPECIALIZATION_REQUIRED_PROGRAMS = {'BSCS', 'BSIT'}

# Authorship provenance of a manuscript. Deliberately unrelated to
# profiles.role, which also has a 'faculty' value: the category classifies
# the thesis, not whoever uploaded it.
THESIS_CATEGORIES = frozenset({'student', 'faculty'})


def normalize_thesis_category(value: str | None) -> str:
    """Return the canonical category, defaulting absent input to 'student'."""
    category = (value or 'student').strip().lower()
    if category not in THESIS_CATEGORIES:
        raise HTTPException(422, "thesis_category must be 'student' or 'faculty'.")
    return category


@dataclass(frozen=True)
class AcademicSelection:
    department_id: str
    program_id: str | None
    specialization_id: str | None
    display_track: str
    legacy_track: str | None
    classification_status: str

    def as_payload(self) -> dict:
        return {
            'department_id': self.department_id,
            'program_id': self.program_id,
            'specialization_id': self.specialization_id,
            'track': self.display_track,
            'legacy_track': self.legacy_track,
            'classification_status': self.classification_status,
        }


def _single(query, detail: str) -> dict:
    rows = query.limit(1).execute().data or []
    if not rows:
        raise HTTPException(422, detail)
    return rows[0]


def resolve_academic_selection(
    client, *, department_name: str, program_id: str | None,
    specialization_id: str | None, legacy_track: str | None,
    require_program: bool,
) -> AcademicSelection:
    """Validate UUID ownership, or translate a one-release legacy track safely."""
    department = _single(
        client.table('departments').select('id,code,name,active')
        .eq('name', department_name).eq('active', True),
        'Unknown or archived department.',
    )
    normalized_track = (legacy_track or '').strip()
    if not program_id and normalized_track in LEGACY_CLASSIFICATIONS:
        program_code, specialization_code = LEGACY_CLASSIFICATIONS[normalized_track]
        program = _single(
            client.table('programs').select('id,code,name,department_id,active')
            .eq('department_id', department['id']).eq('code', program_code).eq('active', True),
            'The legacy track program is unavailable.',
        )
        specialization = _single(
            client.table('specializations').select('id,code,name,program_id,active')
            .eq('program_id', program['id']).eq('code', specialization_code).eq('active', True),
            'The legacy track specialization is unavailable.',
        )
        return AcademicSelection(
            str(department['id']), str(program['id']), str(specialization['id']),
            str(specialization['name']), normalized_track, 'classified',
        )
    if not program_id:
        if normalized_track in AMBIGUOUS_LEGACY_TRACKS and not require_program:
            return AcademicSelection(
                str(department['id']), None, None, normalized_track,
                normalized_track, 'needs_review',
            )
        if require_program:
            raise HTTPException(422, 'A valid academic program is required.')
        return AcademicSelection(str(department['id']), None, None, normalized_track, None, 'unclassified')

    program = _single(
        client.table('programs').select('id,code,name,department_id,active')
        .eq('id', program_id).eq('department_id', department['id']).eq('active', True),
        'Program does not belong to the selected department or is archived.',
    )
    specialization = None
    if specialization_id:
        specialization = _single(
            client.table('specializations').select('id,code,name,program_id,active')
            .eq('id', specialization_id).eq('program_id', program['id']).eq('active', True),
            'Specialization does not belong to the selected program or is archived.',
        )
    if program['code'] in SPECIALIZATION_REQUIRED_PROGRAMS and not specialization:
        raise HTTPException(422, f"{program['code']} requires a valid specialization.")
    if program['code'] not in SPECIALIZATION_REQUIRED_PROGRAMS and specialization:
        raise HTTPException(422, f"{program['code']} does not accept a specialization.")
    display = str(specialization['name']) if specialization else str(program['code'])
    return AcademicSelection(
        str(department['id']), str(program['id']),
        str(specialization['id']) if specialization else None,
        display, normalized_track or None, 'classified',
    )
