"""Functional Suitability — follow-up references in Filipino and Ilocano.

Measured 2026-09-14, a real two-turn transcript. Turn 1, "ana jay objectives da
carlo gallardo", was answered correctly. Turn 2, "kayat ko makita dyay specific
objectives da" -- "I want to see ITS specific objectives" -- carried its entire
reference in the enclitic `da`, matched none of the English patterns, was
embedded without its referent, and came back with the specific objectives of
five unrelated theses.

MUST_NOT_PIN is the important half. guards.py states the rule plainly: an
unresolved follow-up merely retrieves afresh, while a standalone question
wrongly read as one is answered about the WRONG PAPER. Two shapes make that
easy to get wrong here -- "na" is a linker as often as a demonstrative, and
`da` is the plural article as often as a possessor. Both readings of `da`
appear in the one transcript above.
"""

import pytest

from services.guards import is_ambiguous_followup

PRIOR = ['ana jay objectives da carlo gallardo']

MUST_FOLLOW_UP = (
    'ania dagiti nagbanagan da',
    'ania dagiti nagbanaganda',
    'ania dagiti objectives na ken ti metodolohia',
    'ania dagiti rekomendasion daytoy',
    'ania dagiti specific objectives na',
    'ania ti linaon ti kapitulo 3',
    'ania ti metodo dayta a tesis',
    'ania ti metodolohia da',
    'ania ti nagan na',
    'ania ti naganna',
    'ania ti resulta na',
    'ano ang konklusyon',
    'ano ang konklusyon ng tesis na iyon',
    'ano ang mga limitasyon ng tesis na ito',
    'ano ang mga rekomendasyon ng pag-aaral na ito',
    'ano ang nasa chapter 3',
    'ano ang recommendations',
    'ano ang scope and limitation',
    'ano ang specific objectives',
    'ano ang specific objectives nito',
    'ano naman ang findings nila',
    'ano pa ang mga layunin nito',
    'ano yan',
    'ano yun',
    'basaem man ti abstrak',
    'gusto ko makita yung specific objectives',
    'ilan ang mga sanggunian ng tesis na iyon',
    'ilan ang respondente',
    'ilan ang respondente nila',
    'ipakita mo naman yung specific objectives',
    'kayat ko makita dyay specific objectives',
    'kayat ko makita dyay specific objectives da',
    'ket ania ti konklusion',
    'kitaem man dagiti objectives',
    'maipapan iti daytoy',
    'mano dagiti kapitulo ti dayta a tesis',
    'mano dagiti respondente na',
    'meron pa bang ibang tesis na katulad nito',
    'nasaan ang metodolohiya ng tesis na ito',
    'pakita mo yung findings',
    'sige, ano ang methodology',
    'tungkol doon',
    'yung tesis, ano ang conclusion',
)

MUST_NOT_PIN = (
    'Rank archived theses by findings on detection accuracy',
    'Summarize the study of mango ripeness classification',
    'What are the archived theses that used YOLO for detection?',
    'Which theses report results above ninety percent precision?',
    'adda kadi dyay tesis maipapan iti OCR',
    'adda kadi tesis da maipapan iti OCR',
    'ana jay objectives da carlo gallardo',
    'ania dagita tesis maipapan iti attendance',
    'ania dagiti nagan da dagiti estudyante nga nangaramid iti SECURE',
    'ania dagiti objectives da maria santos',
    'ania dagiti objectives diay tesis ni Carlo Gallardo',
    'ania dagiti objectives ti SECURE',
    'ania dagiti panagsukisok nga nangaramid iti mobile app',
    'ania dagiti tesis da Gallardo ken Dela Cruz',
    'ania dagiti tesis dagiti IT students',
    'ania dagiti tesis ditoy',
    'ania dagiti tesis ditoy maipapan iti OCR',
    'ania dagiti tesis maipapan iti IT',
    'ania dagitoy nga tesis tungkol sa OCR',
    'ania dagitoy tesis maipapan iti OCR',
    'ania met ti metodo ti SECURE',
    'ania ti OCR ken kasano nga naaramat daytoy kadagiti tesis',
    'ania ti OCR?',
    'ania ti nagbanagan ti panagadal maipapan iti YOLO',
    'ania ti naibaga ti tesis ni Gallardo maipapan iti OCR',
    'ania ti panagadal a nangusar iti YOLO',
    'ania ti sistema para iti attendance',
    'ania ti tesis a naipablaak idi 2020',
    'ano ang CCSICT at ilan ang tesis nito',
    'ano ang OCR',
    'ano ang RAG at ano ang gamit nito sa thesis library',
    'ano ang RAG?',
    'ano ang YOLO',
    'ano ang YOLO at paano ito ginamit sa mga tesis',
    'ano ang accuracy nila ng mga tesis na gumamit ng CNN',
    'ano ang chapter 3 ng FindMe?',
    'ano ang findings ng study ni Dela Cruz tungkol sa OCR',
    'ano ang ganitong klase ng tesis tungkol sa IoT',
    'ano ang ginamit nila sa pag-aaral tungkol sa mangga',
    'ano ang kanya-kanyang kontribusyon ng mga may-akda ng FindMe',
    'ano ang kanya-kanyang tungkulin sa tesis tungkol sa mangga',
    'ano ang layunin ng SECURE?',
    'ano ang layunin ng pag-aaral ni Carlo Gallardo',
    'ano ang metodolohiya ng system nila',
    'ano ang metodolohiya ng tesis na pinamagatang A Centralized AI-Powered Thesis Library',
    'ano ang mga feature ng inventory system nila',
    'ano ang mga layunin ng mga pag-aaral tungkol sa OCR',
    'ano ang mga sistema na ginawa ng CCSICT students',
    'ano ang mga tesis dito',
    'ano ang mga tesis dito tungkol sa OCR',
    'ano ang mga tesis doon sa departamento ng IT',
    'ano ang mga tesis na available na',
    'ano ang mga tesis na binanggit ni Dela Cruz',
    'ano ang mga tesis na binanggit sa RRL',
    'ano ang mga tesis na gumamit ng CNN',
    'ano ang mga tesis na may accuracy na .95 pataas',
    'ano ang mga tesis na may accuracy na mas mataas sa 90 porsyento',
    'ano ang mga tesis na naka index na',
    'ano ang mga tesis ng mga estudyante ng IT',
    'ano ang mga thesis na gumamit ng transfer learning?',
    'ano ang objectives ng FindMe',
    'ano ang proyekto para sa GoldenSun',
    'ano ang sistema para sa attendance monitoring',
    'ano ang specific objectives ng thesis ni Gallardo',
    'ano ang system na ginawa nila',
    'ano ang tesis ni Enoy?',
    'ano ang thesis library ng ISU',
    'ano naman ang accuracy ng SECURE',
    'ano naman ang mga tesis tungkol sa IoT',
    'ano pa ang sinabi ng pag-aaral tungkol sa OCR',
    'ano pa ang sinabi ng tesis',
    'anong pag-aaral na tungkol sa mangga',
    'anong system ang ginagamit nila',
    'anong tesis tungkol sa OCR?',
    'anong thesis na nag-focus sa OCR ng Ilocano text',
    'asino da nagaramid ti FindMe',
    'asino dagiti nagaramid da iti SECURE',
    'asino dagitoy nangaramid iti FindMe',
    'asino ni Enoy iti tesis',
    'dagiti tesis nga agusar iti YOLO',
    'gaano kadami ang mga tesis sa archive',
    'ibigay mo ang tesis na may pinakamataas na accuracy',
    'ilan ang mga pag-aaral dito na gumamit ng YOLO',
    'ilan ang mga pag-aaral na binanggit sa RRL',
    'ilan ang mga tesis noong 2023',
    'ilan ang mga tesis tungkol sa OCR na naka publish na',
    'madami pa bang pananaliksik na gumamit ng YOLO',
    'mano da amin nga tesis ditoy',
    'marami pa bang tesis tungkol sa agrikultura',
    'marami pang tesis ang gumamit ng CNN',
    'may ganoong pag-aaral ba tungkol sa mangga',
    'may ibang thesis pa ba tungkol sa OCR',
    'may tesis ba dito tungkol sa mangga',
    'may tesis ba doon sa CCSICT tungkol sa OCR',
    'may tesis ba na gumamit ng transfer learning para sa mangga',
    'may tesis ba tungkol sa IT governance',
    'may tesis ba tungkol sa mangga?',
    'paano gumagana ang RAG',
    'paano nila ginawa ang sistema',
    'sino ang authors nila sa OCR thesis',
    'sino ang gumawa ng FindMe?',
    'sino ang gumawa ng IT inventory system',
    'sino ang gumawa ng attendance system nila',
    'sino ang mga may-akda nila sa tesis tungkol sa OCR',
    'sino ang mga respondente ng pag-aaral tungkol sa mangga',
    'sino ang sumulat ng FindMe at ano ang objectives nito',
    'sino naman ang gumawa ng FindMe',
    'sino si Carlo Gallardo at ano ang tesis niya',
    'sino si Carlo Gallardo?',
    'sino si Gallardo',
    'sino sila na sumulat ng FindMe',
)


@pytest.mark.parametrize('question', MUST_FOLLOW_UP)
def test_local_followups_keep_their_referent(question):
    assert is_ambiguous_followup(question, PRIOR), question


@pytest.mark.parametrize('question', MUST_NOT_PIN)
def test_standalone_questions_are_never_pinned(question):
    assert not is_ambiguous_followup(question, PRIOR), question


def test_nothing_is_a_followup_without_a_prior_turn():
    for question in MUST_FOLLOW_UP:
        assert not is_ambiguous_followup(question, []), question


class TestTheProgramNamedIT:
    """`it|its` was case-insensitive, and BSIT is one of five CCSICT programs."""

    @pytest.mark.parametrize('question', [
        'what theses are about IT',
        'ano ang mga tesis ng mga estudyante ng IT',
        'anong thesis ang tungkol sa IT',
        'ilan ang tesis ng IT department',
    ])
    def test_the_acronym_is_not_a_pronoun(self, question):
        assert not is_ambiguous_followup(question, PRIOR), question

    @pytest.mark.parametrize('question', [
        'what is it about',
        'tell me more about its methodology',
        'summarize it',
    ])
    def test_the_lowercase_pronoun_still_is_one(self, question):
        assert is_ambiguous_followup(question, PRIOR), question
