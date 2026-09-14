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
    _is_ambiguous_system_identity_question,
    _is_ambiguous_system_origin_question,
    _is_self_platform_reference,
    _is_system_origin_question,
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


# 2026-09-14, second transcript: "anuano ang mga theses na nanandito sa system
# na ito" was answered with three retrieved theses as though they were the
# whole archive. Three independent defects -- the fused "anuano" spelling, the
# "nanandito" scope variant, and a "na ito" that belonged to the SYSTEM being
# searched rather than to a manuscript inside it.
CONTAINER_SCOPED = (
    'anuano ang mga theses na nanandito sa system na ito',
    'anoano ang mga tesis dito sa sistema',
    'ano ang mga tesis sa archive na ito',
    'anu-ano ang mga tesis nandito sa sistema',
    'ano ang mga theses na nanandito sa thesis library na ito',
)

# The same deictic, still pointing at one manuscript. Naming the container is
# only scope after a locative marker: half the systems in this archive are the
# SUBJECT of a thesis rather than the thing holding it.
CONTAINER_LOOKALIKES = (
    'ano ang metodolohiya ng pag-aaral na ito',
    'ano ang mga layunin ng tesis na ito',
    'ilan ang respondents sa system na ito',
    'ano ang mga tesis sa system na ito tungkol sa OCR',
    'ano ang ginamit na sistema sa pag-aaral na ito',
    'anong system ang ginawa nila sa tesis na ito',
)


@pytest.mark.parametrize('question', CONTAINER_SCOPED)
def test_a_deictic_on_the_container_still_reaches_the_catalog(question):
    assert _is_archive_inventory_question(question), question


@pytest.mark.parametrize('question', CONTAINER_LOOKALIKES)
def test_a_deictic_on_a_manuscript_still_blocks_the_catalog(question):
    assert not _is_archive_inventory_question(question), question


# 2026-09-14, third transcript: "sino ang nag develop netong system?" missed
# both origin patterns and was answered from retrieval, naming the developers
# of three archived theses' systems instead of the two students who built
# IskAI -- whose thesis sits in the very archive it searched.
SYSTEM_ORIGIN = (
    'sino ang nag develop netong system?',
    'sino ang nag-develop nitong system?',
    'sino ang gumawa nitong sistema?',
    'sino ang nag develop ng system na ito?',
    'sino ang gumawa ng app na ito?',
    'sino po ang nag-develop nito?',
    'asino ti nangaramid iti daytoy a sistema?',
)
SELF_ORIGIN = (
    'sino ang may gawa ng IskAI?',
    'sino ang nag develop sa iyo?',
    'asino ti nangaramid kenka?',
)
# A named thesis, or a system that an archived thesis BUILT, stays retrieval.
ORIGIN_LOOKALIKES = (
    'sino ang gumawa ng FindMe',
    'sino ang gumawa ng attendance system nila',
    'paano nila ginawa ang sistema',
    'sino ang nag develop ng sistema sa tesis na ito',
    'sino ang gumawa ng sistema ng ISU',
    'sino ang sumulat ng tesis tungkol sa OCR',
)


@pytest.mark.parametrize('question', SYSTEM_ORIGIN)
def test_filipino_this_system_questions_answer_iskai_provenance(question):
    assert _is_ambiguous_system_origin_question(question), question


@pytest.mark.parametrize('question', SELF_ORIGIN)
def test_filipino_questions_naming_iskai_need_no_context(question):
    assert _is_system_origin_question(question), question


@pytest.mark.parametrize('question', ORIGIN_LOOKALIKES)
def test_a_thesis_own_system_is_never_answered_as_provenance(question):
    assert not _is_system_origin_question(question), question
    assert not _is_ambiguous_system_origin_question(question), question


# 2026-09-14, fourth transcript: after a wrong origin answer, the user
# clarified with "itong system na ginagamit ko" and was told the evidence does
# not contain information about the platform they are interacting with -- then
# shown two more unrelated theses.
SELF_PLATFORM = (
    'itong system na ginagamit ko',
    'yung system na ginagamit ko ngayon',
    'ang app na ginagamit ko',
    'ibig kong sabihin itong system na ginagamit ko',
    'the system i am using',
    'this app im using',
)
# "ginagamit" also belongs to ordinary methodology questions about what an
# archived study used.
SELF_PLATFORM_LOOKALIKES = (
    'ano ang system na ginagamit sa tesis na ito',
    'anong system ang ginagamit nila',
    'ano ang ginagamit na sistema sa pag-aaral',
    'anong mga tools ang ginagamit sa attendance system',
)


@pytest.mark.parametrize('question', SELF_PLATFORM)
def test_a_reference_to_this_platform_resolves_to_iskai(question):
    assert _is_self_platform_reference(question), question


@pytest.mark.parametrize('question', SELF_PLATFORM_LOOKALIKES)
def test_what_an_archived_study_used_stays_retrieval(question):
    assert not _is_self_platform_reference(question), question


# 2026-09-14, fifth transcript: "ano ba itong system na ito?" reached retrieval
# twice and was answered with three archived systems -- one of them the thesis
# that describes IskAI itself.
WHAT_IS_THIS_SYSTEM = (
    'ano ba itong system na ito?',
    'ano itong system',
    'ano ang system na ito',
    'anong app ba ito',
    'ano ba itong website na ito',
    'ano ang platform na ito',
    'ania daytoy nga sistema',
)
# In a CCSICT archive most theses ARE systems, so "ano ... system" is one of
# the commonest shapes a real research question takes. A `.*`-joined version of
# the pattern above was measured swallowing seven of these; fullmatch is the
# whole reason it cannot.
WHAT_IS_THIS_LOOKALIKES = (
    'ano ang metodolohiya ng system nila',
    'ano ang mga tesis tungkol sa attendance system',
    'ano ang ginamit na system sa pag-aaral na ito',
    'ano ang architecture ng SECURE system',
    'ano ang mga feature ng inventory system nila',
    'anong programming language ang ginamit sa system',
    'ano ang layunin ng document tracking system',
    'ano ba ang naging resulta ng performance appraisal system',
    'ano ang system na ginawa nila',
    'ano ang pinakamahusay na system sa archive',
)


@pytest.mark.parametrize('question', WHAT_IS_THIS_SYSTEM)
def test_what_is_this_system_resolves_to_iskai(question):
    assert _is_ambiguous_system_identity_question(question), question


@pytest.mark.parametrize('question', WHAT_IS_THIS_LOOKALIKES)
def test_questions_about_an_archived_system_stay_retrieval(question):
    assert not _is_ambiguous_system_identity_question(question), question


# 2026-09-14, sixth transcript: "Sino ang nag develop etong sytem na ito?"
# asked directly after the identity answer, and still listed three archived
# theses' developers. Filipino doubles the reference freely -- a deictic BEFORE
# the noun and a demonstrative AFTER it -- and requiring one or the other made
# fullmatch reject the pair. "etong" is an ordinary contraction and "sytem" is
# what a student's hands actually type.
DOUBLED_REFERENCE_ORIGIN = (
    'Sino ang nag develop etong sytem na ito?',
    'sino ang nag develop netong system na ito',
    'sino ang gumawa nitong sistema na ito',
    'sino ang nag develop ng system na ito?',
    'sino ang gumawa ng app na ito ba',
    'sino po ang nag-develop nito',
)
DOUBLED_REFERENCE_LOOKALIKES = (
    'sino ang gumawa ng FindMe',
    'sino ang gumawa ng attendance system nila',
    'sino ang nag develop ng sistema sa tesis na ito',
    'sino ang gumawa ng sistema ng ISU',
    'sino ang nag develop ng inventory system para sa GoldenSun',
    'paano nila ginawa ang sistema',
)


@pytest.mark.parametrize('question', DOUBLED_REFERENCE_ORIGIN)
def test_a_doubled_reference_still_resolves_to_iskai(question):
    assert _is_ambiguous_system_origin_question(question), question


@pytest.mark.parametrize('question', DOUBLED_REFERENCE_LOOKALIKES)
def test_a_named_or_qualified_system_stays_retrieval(question):
    assert not _is_ambiguous_system_origin_question(question), question
