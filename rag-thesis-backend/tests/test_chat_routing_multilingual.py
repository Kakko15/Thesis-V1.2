"""Functional Suitability — catalog routing in Filipino and Ilocano.

Measured 2026-09-14: every intent classifier matched English regexes only, so
"ano ang mga tesis dito" missed the archive fast path and was answered by
generic vector retrieval instead of the authoritative catalog.

MUST_STAY_RETRIEVAL is the important half. "ano", "ilan" and "alin" open
catalog questions and ordinary research questions in equal measure, so routing
on the interrogative alone would replace real answers with an alphabetical
list. What separates them is whether the sentence points at ONE manuscript,
which is what _FIL_RETRIEVAL_GUARD tests.
"""

import pytest

from routers.chat import (
    _extract_author_name,
    _is_archive_continuation_question,
    _is_archive_count_question,
    _is_archive_inventory_question,
)

INVENTORY = (
    'adda pay sabali nga tesis',
    'alin ang mga tesis dito',
    'ania dagiti adda a tesis ditoy',
    'ania dagiti amin a tesis ditoy',
    'ania dagiti tesis ditoy',
    'ania dagiti tesis nga adda ditoy',
    'ania ti listaan dagiti tesis ditoy',
    'ania ti tesis ditoy',
    'ano ang mga naka-archive na tesis',
    'ano ang mga pananaliksik dito',
    'ano ang mga tesis dito',
    'ano ang mga tesis na nasa archive',
    'ano ang mga titulo ng tesis dito',
    'anong klaseng tesis ang meron dito',
    'anong mga pag-aaral ang meron dito',
    'anong mga pamagat ng tesis ang nasa archive',
    'anong mga thesis ang available dito',
    'anong uri ng tesis ang available dito',
    'anu-ano ang mga tesis na available dito',
    'ilista mo ang mga tesis',
    'ilista mo lahat ng tesis',
    'ipakita mo ang mga tesis dito',
    'listahan ng mga tesis',
    'may iba pa bang tesis',
    'mayroon pa bang ibang thesis',
    'meron pa bang ibang tesis dito',
    'nasaan ang mga tesis dito',
    'pakita mo yung mga thesis',
    'pwede ko bang makita lahat ng tesis dito',
)

COUNT = (
    'bilang ng mga tesis sa archive',
    'gaano kadami ang mga tesis sa archive',
    'gaano karami ang tesis dito',
    'ilan ang mga tesis dito',
    'ilan ang tesis sa archive',
    'ilan ang tesises dito',
    'ilang tesis ang meron dito',
    'mano dagiti tesis ditoy',
)

CONTINUATION = (
    'adda pay',
    'adda pay kadi',
    'ang natitira',
    'ania pay',
    'ano pa',
    'ano pa ba',
    'dadduma pay',
    'dagdag pa',
    'dagiti nabati',
    'iba pa',
    'iba pa ba',
    'iba pa bang tesis',
    'iba pang tesis',
    'ibang tesis',
    'ibigay mo ang natitirang tesis',
    'ipagpatuloy',
    'marami pa',
    'marami pa bang tesis',
    'mayroon pa bang iba',
    'meron pa ba',
    'sabali pay nga tesis',
    'susunod na 5',
    'tuloy mo',
    'yung natitira',
)

MUST_STAY_RETRIEVAL = (
    'alin ang mga tesis dito na may pinakamataas na accuracy',
    'alin ang mga tesis na naka-deploy sa sistema ng ISU',
    'ania ti metodo daytoy',
    'ano ang kasunod na pahina ng tesis na iyon',
    'ano ang metodolohiya ng mga pag-aaral dito',
    'ano ang mga pananaliksik na gumamit ng database',
    'ano ang mga related studies dito',
    'ano ang mga sumusunod na tesis na binasa nila',
    'ano ang mga tesis dito ni Enoy',
    'ano ang mga tesis dito noong 2023',
    'ano ang mga tesis na binanggit sa RRL',
    'ano ang mga tesis na gumamit ng sistema ng OCR',
    'ano ang mga tesis na nasa sistema na gumamit ng YOLO',
    'ano ang mga tesis sa database ng ISU',
    'ano ang nabati ng mga may akda sa pasasalamat',
    'ano ang natitirang oras ng sistema',
    'ano ang pamagat ng tesis na ito',
    'ano ang pamagat ng tesis ni Enoy',
    'ano ang pananaliksik na gumamit ng sistema ng CCTV',
    'ano ang pananaliksik ni Enoy sa sistema',
    'ano ang pananaliksik nila dito',
    'ano ang titulo ng tesis na iba sa nauna',
    'ano pa ang mga layunin nito',
    'ano pa ang sinabi ng pag-aaral tungkol sa OCR',
    'ano pa ang sinabi ng tesis',
    'anong mga tesis ang may pinakamataas na accuracy sa sistema',
    'asino ti nangaramid iti daytoy',
    'banggitin mo ang tesis na gumamit ng CNN',
    'eh si archive',
    'iba pang pag-aaral tungkol sa face recognition',
    'iba pang rekomendasyon ng tesis na ito',
    'iba pang tesis na gumamit ng YOLO',
    'iba pang tesis tungkol sa attendance',
    'iba pang titulo ng tesis na iyon',
    'ibigay mo ang metodolohiya ng tesis',
    'ibigay mo ang tesis na may pinakamataas na accuracy',
    'ilan ang kabanata ng tesis na ito',
    'ilan ang layunin ng tesis na iyon',
    'ilan ang may akda ng tesis na iyon',
    'ilan ang mga may akda ng tesis ni Aquino',
    'ilan ang mga pag-aaral na binanggit sa RRL',
    'ilan ang mga pag-aaral na sinuri sa tesis na iyon',
    'ilan ang mga pag-aaral na tinalakay sa tesis ni Enoy',
    'ilan ang mga sanggunian ng tesis na iyon',
    'ilan ang mga tesis na kanilang binasa',
    'ilan ang mga variable sa pananaliksik na iyon',
    'ilan ang natitirang kabanata',
    'ilan ang pahina ng tesis na iyon',
    'ilan ang respondente ng tesis ni Aquino',
    'ilan ang respondente sa tesis na iyon',
    'ilan sa mga tesis ang gumamit ng deep learning',
    'ilang taon ang ginugol nila sa tesis',
    'ilista mo ang mga pag-aaral sa RRL',
    'ilista mo ang mga respondents ng tesis',
    'ilista mo ang mga tesis ni Dr Reyes',
    'ipakita mo ang mga layunin ng tesis',
    'ipakita mo ang tesis na gumamit ng YOLO',
    'ipakita mo ang tesis ni Enoy',
    'ipalista mo ang mga tesis noong 2022',
    'itala mo ang mga tesis na may accuracy na mahigit 90',
    'listahan ng mga tesis na gumamit ng Arduino',
    'madami pa bang pananaliksik na gumamit ng YOLO',
    'mano dagiti kapitulo ti dayta a tesis',
    'mano dagiti respondente iti tesis ni Enoy',
    'marami pa bang respondents',
    'marami pa bang tesis tungkol sa agrikultura',
    'marami pang tesis ang gumamit ng CNN',
    'may dagdag pang tesis ba si Enoy',
    'may ibang respondents ba ang tesis na iyon',
    'may tesis ba dito',
    'mayroon bang tesis tungkol sa OCR',
    'meron pa bang datos tungkol sa attendance',
    'meron pa bang ibang tesis na katulad nito',
    'meron pa bang ibang tesis ni Aquino',
    'nabati ba ng may-akda ang panel sa tesis',
    'nasaan ang metodolohiya ng tesis na ito',
    'natitirang budget ng proyekto',
    'pwede ko bang makita ang tesis ni Enoy',
    'pwede mo bang ilista ang mga tesis na gumamit ng CNN',
    'sabali pay nga tesis ni Aquino',
    'si dito',
    'si sistema',
    'si tesis',
    'sino ang gumawa ng FindMe',
    'sino ang gumawa ng tesis tungkol sa attendance',
    'sino ang may akda ng FindMe',
    'sino ang mga nabati sa acknowledgment ng tesis',
    'sino ang mga respondents',
    'sino ang nabati nila sa acknowledgment',
    'sino ang sumulat ng tesis na ito',
    'sino si ito',
)

AUTHOR_LOOKUP = (
    ('asinno ni Reyes', 'Reyes'),
    ('asino ni Enoy', 'Enoy'),
    ('asino ni Enoy ditoy', 'Enoy'),
    ('asino ni Enoy iti tesis', 'Enoy'),
    ('siasino ni Juan Dela Cruz', 'Juan Dela Cruz'),
    ('sino ang si Reyes po', 'Reyes'),
    ('sino ba si Rainier Aquino', 'Rainier Aquino'),
    ('sino po si Kurt Robin Enoy', 'Kurt Robin Enoy'),
    ('sino si Dr Reyes', 'Reyes'),
    ('sino si Enoy', 'Enoy'),
    ('sino si Enoy dito', 'Enoy'),
    ('sino si Enoy sa tesis na ito', 'Enoy'),
    ('sino si Gng Aquino', 'Aquino'),
    ('sino si Juan Dela Cruz', 'Juan Dela Cruz'),
    ('sino si engr Enoy', 'Enoy'),
    ('sino si sir Reyes', 'Reyes'),
)


@pytest.mark.parametrize('question', INVENTORY)
def test_catalog_questions_reach_the_archive_fast_path(question):
    assert _is_archive_inventory_question(question), question


@pytest.mark.parametrize('question', COUNT)
def test_count_questions_are_answered_as_counts(question):
    assert _is_archive_count_question(question), question


@pytest.mark.parametrize('question', CONTINUATION)
def test_continuations_page_the_listing(question):
    assert _is_archive_continuation_question(question, True), question


@pytest.mark.parametrize('question', MUST_STAY_RETRIEVAL)
def test_research_questions_are_never_routed_to_the_catalog(question):
    assert not _is_archive_inventory_question(question), question
    assert not _is_archive_continuation_question(question, True), question


@pytest.mark.parametrize('question,expected', AUTHOR_LOOKUP)
def test_filipino_author_questions_resolve_the_name(question, expected):
    assert _extract_author_name(question) == expected, question
