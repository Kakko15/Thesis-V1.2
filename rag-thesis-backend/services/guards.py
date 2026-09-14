"""Deterministic request controls for the retrieval-only thesis assistant."""

import re


REFUSAL_MESSAGE = (
    'I can help you discover, compare, summarize, and cite existing archived studies, '
    'but I cannot write thesis chapters, assignments, proposals, hypotheses, or original '
    'academic arguments for you. Ask me what the archive contains about your topic instead.'
)

_EN_GENERATION_VERB = (
    r'(?:write|draft|compose|generate|create|produce|complete|make'
    r'|rewrite|expand|extend|formulate)'
)
# Filipino and Ilocano carry the request on the verb itself, so the English
# list alone left the refusal contract holding in one language only. Measured
# 2026-09-14: "isulat mo ang aking thesis", "gumawa ka ng chapter 1 para sa
# akin" and "isuratmo ti tesis ko" all reached full RAG generation, while their
# English equivalents were refused. The paper's academic-integrity claim was
# true only for users who asked in English.
#
# TIER A -- request forms. Tagalog object-focus (-in / i- / pa- / paki-) and
# Ilocano (-en / -em) verbs are morphologically requests: the speaker is asking
# for the thing to be made. The split matters because the ATTRIBUTION forms --
# "sumulat", "sinulat", "isinulat", "naisurat" -- are what legitimate questions
# about archived authors use, and the Tagalog -um-/-in- infixes physically
# split the root while the Ilocano in-/nag-/na- prefixes precede it, so no
# request form can contain an attribution form as a substring. That is what
# lets this list be broad without endangering "ano ang isinulat nila".
#
# Matched against the RAW question, where hyphens survive -- hence [\s-]? for
# "paki-sulat" and "i-write".
_FIL_ADDR = r'(?:\s*(?:mo|mong|nyo|nyong|niyo|niyong|ninyo|ninyong))?'
_FIL_REQUEST_VERB = (
    r'(?:'
    rf'(?:i|ipa|pa|paki|ipaki)[\s-]?sulat{_FIL_ADDR}'
    # Bare "sulatin" is also a noun meaning a written work, so it needs the
    # addressee: "anong sulatin ang naging basehan ng tesis ko" is a question.
    r'|sulat(?:in|an)\s*(?:mo|mong|nyo|niyo|ninyo)'
    rf'|(?:isusulat|susulatin|magsulat|magsusulat|mag[\s-]?sulat){_FIL_ADDR}'
    rf'|(?:gawin|gagawin|gawan|gagawan|gawaan|igawa|ipagawa){_FIL_ADDR}'
    rf'|(?:buuin|buoin|bubuuin|ibuo){_FIL_ADDR}'
    rf'|(?:likhain|lilikhain|ilikha){_FIL_ADDR}'
    rf'|(?:tapusin|tatapusin|itapos|ipatapos|patapusin){_FIL_ADDR}'
    rf'|(?:kumpletuhin|kumpletohin|kukumpletuhin|ikumpleto){_FIL_ADDR}'
    rf'|(?:palawakin|palalawakin|pahabain|papahabain){_FIL_ADDR}'
    # Taglish loanverbs: "i-write mo", "mag-generate ka", "paki-draft".
    rf'|(?:i|ipa|pa|paki|ipaki|mag|magpa)[\s-]?{_EN_GENERATION_VERB}{_FIL_ADDR}'
    # Ilocano.
    r'|isurat(?:\s*(?:mo|m|yo|nyo|niyo|ta|tayo))?'
    r'|surat(?:en|em|am|enyo|ennak|annak)|ipasurat|pasuratem'
    r'|aramid(?:en|em|enyo|ennak)|ipaaramid(?:mo|m)?|pagaramiden'
    r'|partuat(?:en|em|enyo)|bukel(?:en|em|enyo)'
    r'|leppas(?:en|em|enyo)|turpos(?:en|em)'
    r'|padakkel(?:en|em)|paatiddog(?:en|em)'
    r')'
)
# TIER B -- homographs. "gumawa ka ng chapter 1 para sa akin" is a request and
# "sino ang gumawa ng FindMe" is the single most important question this
# archive answers, and they share the verb token exactly. The zero-width
# lookahead makes a second-person marker immediately after the verb, or a
# beneficiary in the same sentence, mandatory -- so the modifier window still
# begins right after the verb and cannot swallow the discriminator. The
# beneficiary branch is needed for parity: English "make a chapter 1 for me"
# is already refused.
_FIL_IMPERATIVE_VERB = (
    r'(?:gumawa|gawa|sumulat|bumuo|lumikha|agsurat|agaramid|agpartuat|agbukel)'
    r'(?=\s+(?:ka|kayo|mo|nyo|niyo|ninyo)\b'
    r'|[^.!?]*\bpara\s+sa\s+(?:akin|amin|kin)\b'
    r'|[^.!?]*\b(?:kaniak|kadakami|tulongannak|tulungannak|tulongandak'
    r'|pangngaasim|pangngaasiyo)\b)'
    r'(?:\s+(?:ka|kayo|mo|nyo|niyo|ninyo))?'
)
# Only content-*transformation* verbs belong here. Retrieval verbs must never be
# added: an earlier attempt to close the gaps below by adding `give`, `provide`
# and `outline` — together with section names like `objectives`, `abstract` and
# `discussion` as artifacts — refused 4 of 9 legitimate retrieval questions
# ("Give me the objectives of that 2023 IoT study", "Outline the methodology
# used in that thesis"). Those words are this assistant's working vocabulary.
# The four added below have no retrieval sense, and `\bwrite` cannot match
# inside "rewrite", which is why that one has to be spelled out.
#
# The same rule governed every Filipino and Ilocano addition. Held out for
# having no English counterpart in the twelve above, and each measured
# refusing a real question: the balangkas family (it is literally "outline",
# the word behind the 4-of-9 regression), the dagdag family ("add", which
# refused "anong mga pag-aaral ang pwede kong idagdag sa RRL ko"), the
# ituloy family ("continue", which would refuse the very phrasing the archive
# paging recognizes), the ayos/bago/rebisa families (fix/change/revise), and
# the Ilocano urnos/sukat family -- "sukatan" is an everyday Tagalog noun
# meaning metric, as in "ano ang mga sukatan na ginamit sa pag-aaral".
# The buod/salin family ("summarize", "translate") is excluded on principle:
# REFUSAL_MESSAGE itself promises to summarize.
_GENERATION_VERB = rf'(?:{_EN_GENERATION_VERB}|{_FIL_REQUEST_VERB}|{_FIL_IMPERATIVE_VERB})'
# Artifacts this system must never author on a user's behalf.
#
# The Ilocano fused-possessive forms come FIRST, because one morpheme
# otherwise defeats both the artifact slot and the ownership slot at once:
# "metodolohi(?:a|ya)\b" cannot match inside "metodolohiak", so "Isuratmo ti
# metodolohiak" read as neither an artifact nor an owned one.
_FIL_FUSED_OWNED_ARTIFACT = (
    r'(?:tesis|tisis|thesis|kapitulo|kabanata|papel|metodolohi(?:a|ya)'
    r'|konklusion|konklusyon|panukala|rrl|hipotesis|haypotesis)(?:ko|k|mi|tayo)'
)
_ARTIFACT = (
    rf'(?:{_FIL_FUSED_OWNED_ARTIFACT}|'
    r'thesis|chapters?|rrl|review\s+of\s+related\s+literature|methodolog(?:y|ies)|'
    r'conclusions?|hypothes(?:is|es)|research\s+proposals?|problem\s+statements?|'
    r'conceptual\s+frameworks?|assignments?|essays?|academic\s+arguments?|'
    # A literal translation of the list above and nothing more. Held out for
    # being this assistant's working vocabulary, exactly as objectives and
    # abstract are on the English side: pananaliksik, pag-aaral, saliksik,
    # abstrak, panimula, layunin, talakayan, buod, rekomendasyon, natuklasan,
    # resulta, paksa, pamagat, sanggunian, talaan, listahan. The corpus entry
    # "gumawa ka ng talaan ng mga tesis na gumamit ng CNN" is the proof: it is
    # the attack sentence character for character but for the governed noun.
    r't(?:e|i)sis|disertasyon|dissertation|kabanata|kapitulo|'
    r'metodolohi(?:ya|a)|kongklusyon|konklusyon|konklusiyon|konklusion|'
    r'haypotesis|hipotesis|panukalang\s+pananaliksik|panukala|'
    r'pahayag\s+ng\s+suliranin|paglalahad\s+ng\s+suliranin|'
    r'balangkas\s+konseptwal|kong?septwal\s+na\s+balangkas|'
    r'rebyu\s+ng\s+kaugnay\s+na\s+literatura|kaugnay\s+na\s+literatura|'
    r'takdang[\s-]aralin|asaynment|sanaysay|akademikong\s+argumento|'
    # English-register gaps that the Taglish corpus exposed, and which slip
    # past the guard in plain English today for the same reason.
    r'statements?\s+of\s+the\s+problem|sop|lit\s+review|chap\s*\d+|'
    r'theoretical\s+frameworks?)'
)
# Determiners, quantifiers, and adjectives that legitimately sit between the
# verb and the artifact in a real request ("write me a full chapter"). This is
# deliberately a closed list: matching arbitrary words between the two is what
# made the previous rule fire on ordinary retrieval questions.
#
# The Filipino and Ilocano additions are function words and enclitic particles
# only -- no content words. Three exclusions are load-bearing. The
# second-person markers (mo, ka, kayo, ninyo) are NOT here: they are the sole
# discriminator TIER B depends on, and putting them in this window dissolved
# it, refusing "sino ang gumawa ng tesis tungkol sa OCR". Neither are `sa` and
# `para`, which are oblique markers rather than determiners -- an artifact
# after them is not the verb's object, and including `sa` refused "ano ang
# dapat kong gawin sa chapter 3 ko", which English allows.
_MODIFIER = (
    r'(?:me|us|my|our|the|a|an|another|this|that|these|those|some|one|two|three|'
    r'new|original|full|entire|whole|complete|final|sample|draft|brief|short|'
    r'detailed|good|proper|\d+|'
    r'ako|kami|kita|ang|ng|nang|yung|ung|yong|iyong|ito|iyan|iyon|isang|mga|'
    r'akong|aking|aming|naming|nating|ating|bago|bagong|buo|buong|'
    r'kumpleto|kumpletong|maikli|maikling|halimbawang|pangalawang|unang|na|'
    r'kaniak|kaniami|kadakami|nga|naman|po|ho|lang|din|rin|ba|sana|muna|'
    r'daw|raw|ngayon|pa|ti|iti|dagiti|daytoy|dayta|toy|maysa|man|kadi|met|'
    r'laeng|amin)'
)
# Filipino stacks more particles between the verb and its object than English
# does ("gumawa ka nga po ng isang bagong kabanata"), so the closed-list window
# is wider here than the free-token one below. Widening a CLOSED list is safe
# in a way that widening an arbitrary-word window is not.
_FIL_POSS_POST = r'(?:ko|kong|namin|naming|natin|nating|mi|tayo)'
_FIL_NUMTAIL = r'(?:\s+(?:\d+|[ivx]+|uno|dos|tres|isa|dalawa|tatlo|tallo)){0,2}'

# The verb must actually govern the artifact. "write a chapter" qualifies;
# "...used to create the system" alongside the word "methodology" does not.
_VERB_GOVERNS_ARTIFACT = re.compile(
    rf'\b{_GENERATION_VERB}\s+(?:{_MODIFIER}\s+){{0,8}}{_ARTIFACT}\b',
    re.IGNORECASE,
)
# The artifact is claimed as the requester's own work ("my thesis chapter").
# Filipino marks ownership in two directions -- pre-posed "aking tesis" and
# enclitic "tesis ko" / "kabanata 2 ko" -- and Ilocano fuses it onto the noun.
_OWNED_ARTIFACT = re.compile(
    rf'\b(?:my|our)\s+(?:{_MODIFIER}\s+){{0,2}}{_ARTIFACT}\b'
    rf'|\b(?:aking|aming|ating|inyong)\s+(?:{_MODIFIER}\s+){{0,2}}{_ARTIFACT}\b'
    rf'|\b{_ARTIFACT}{_FIL_NUMTAIL}\s*{_FIL_POSS_POST}\b'
    rf'|\b{_FIL_FUSED_OWNED_ARTIFACT}\b',
    re.IGNORECASE,
)
# A generation verb aimed at the requester's own artifact, even loosely phrased
# ("write about my thesis", "draft something for our chapter"). Requiring the
# possessive keeps this off questions about what archived authors wrote.
#
# This is the one clause that fires on its own, so the Filipino branches use
# the CLOSED modifier list rather than the free-token window, and use TIER A
# only. The TIER B -um- roots were removed from here after measuring two
# refusals of "sino ang gumawa ng tesis ko" and "sino ang sumulat ng tesis
# namin" -- a co-author asking which archived thesis is theirs.
_FIL_TIERB_COMPLEMENT = r'(?:nga\s+(?:agsurat|agaramid|agbukel|agpartuat))'
_GENERATE_OWNED_ARTIFACT = re.compile(
    rf'\b{_GENERATION_VERB}\b(?:\s+\S+){{0,4}}?\s+(?:my|our)\s+'
    rf'(?:{_MODIFIER}\s+){{0,2}}{_ARTIFACT}\b'
    rf'|\b(?:{_FIL_REQUEST_VERB}|{_FIL_TIERB_COMPLEMENT})\b(?:\s+{_MODIFIER}){{0,4}}'
    rf'\s+{_ARTIFACT}{_FIL_NUMTAIL}\s*{_FIL_POSS_POST}\b'
    rf'|\b(?:{_FIL_REQUEST_VERB}|{_FIL_TIERB_COMPLEMENT})\b(?:\s+{_MODIFIER}){{0,4}}'
    rf'\s+{_FIL_FUSED_OWNED_ARTIFACT}\b',
    re.IGNORECASE,
)
# The sentence asks *this assistant* to produce something, rather than asking
# what the archived studies did.
#
# The Filipino markers are admitted verb-adjacent or fused only. A free-floating
# "mo" was rejected: it is also the ergative agent of a verb whose subject is
# the assistant's own previous turn ("na ipinakita mo", "na binanggit mo"),
# which is the commonest shape of a Filipino follow-up. "paki-\w+" was rejected
# for the same reason -- paki- politens ANY verb, so it refused pakisuyo,
# pakiusap, pakinggan and paki-check, each wrapping a legitimate question.
_DIRECTED_AT_ASSISTANT = re.compile(
    # Imperative, at the start of the message or of a later sentence.
    rf'(?:^|[.!?;]\s+)(?:(?:please|kindly|pls|now|just|first|paki|pakiusap|sige\s+na)\s+)*{_GENERATION_VERB}\b'
    # Second-person request.
    r'|\b(?:can|could|would|will|shall|should)\s+(?:you|u)\b'
    r'|\byou\s+(?:should|must|will|can|need\s+to|have\s+to)\b'
    # First-person demand.
    r'|\bi\s+(?:want|need|would\s+like)\b'
    r'|\bhelp\s+(?:me|us)\b'
    r'|\bfor\s+(?:me|us)\b'
    r'|\bon\s+(?:my|our)\s+behalf\b'
    # Filipino and Ilocano.
    rf'|\b{_FIL_REQUEST_VERB}\s*(?:mo|mong|nyo|nyong|niyo|ninyo|ka|kayo|yo|nak)\b'
    r'|\b(?:gumawa|sumulat|bumuo|lumikha|agsurat|agaramid)\s+(?:ka|kayo|mo|nyo|niyo|ninyo)\b'
    r'|\bpaki[\s-]?(?:sulat|gawa|gawin|tapos|tapusin|buo|buuin|draft|write'
    r'|generate|create|make|compose|produce|complete|expand|formulate)\b'
    r'|\btulung?an\s+(?:mo|nyo|niyo|ninyo)\b|\bpatulong\b|\bpakitulong\b'
    r'|\bp(?:w|uw)ede\s+(?:mo|po|ba|kayo|ninyo|niyo)\b|\bpede\s+(?:mo|ba)\b'
    r'|\bmaaari\s+(?:mo|po|ba|kayo)\b|\bkaya\s+mo\s+ba\b'
    r'|\bgusto\s+ko(?:ng)?\b|\bkailangan\s+ko(?:ng)?\b'
    r'|\bpara\s+sa\s+(?:akin|amin|kin)\b|\bkaniak\b|\bkadakami\b'
    r'|\bpangngaasi(?:m|yo|mi)\b|\bmabalin(?:mo|\s+mo)\s*kadi\b'
    r'|\btulong?an+ak\b|\btulongandak\b|\bkayat\s*ko\b',
    re.IGNORECASE,
)
# Injection, in every language this archive is asked questions in. Held out:
# "panuto" (every ISU thesis appendix carries a literal "Panuto:" heading over
# its questionnaire instructions), "limitasyon" ("Saklaw at Limitasyon" is a
# standard section heading) and bare "papel". _INJECTION is tested first and
# returns a different category, so an overfire here answers a methodology
# question as though it were a jailbreak attempt.
_INJECTION = re.compile(
    r'\b(ignore|disregard|override) (all |any )?(previous|prior|system) instructions?|'
    r'\b(reveal|show|print) (me )?(the )?(system )?(prompt|instructions?)|'
    r'\bbypass (the )?(rules?|restrictions?|guardrails?)|\bact as (a|an)|'
    r'\bpretend (to be|you are)|\bchange your role|\bdeveloper mode|\bjailbreak\b|'
    r'\b(?:huwag|wag|di|dimo|saanmo)\b[^.!?]{0,40}?'
    r'\b(?:sundin|pansinin|ipangag|isaalang-alang)\b[^.!?]{0,40}?'
    r'\b(?:utos|instruksyon|instruction|tagubilin|panuntunan|patakaran|tuntunin|'
    r'alituntunin|bilin|annuroten|system\s*prompt)\b|'
    r'\b(?:kalimutan|limutin|lipatem|lipaten)\b[^.!?]{0,40}?'
    r'\b(?:instruksyon|utos|tagubilin|panuntunan|patakaran|bilin|annuroten)\b|'
    r'\b(?:balewalain|laktawan|lampasan|alisin|labsan)\b[^.!?]{0,30}?'
    r'\b(?:patakaran|tuntunin|panuntunan|alituntunin|restriksyon|guardrail|filter|annuroten)\b|'
    r'\b(?:ipakita|sabihin|i-?print|basahin|ilista)\s+(?:mo|nyo|niyo|ninyo)\s+'
    r'(?:sa\s+akin\s+)?ang(?:\s+mga)?\s+(?:iyong|inyong)\s+'
    r'(?:system\s*)?(?:prompt|instruksyon|tagubilin|panuntunan|alituntunin)\b|'
    r'\b(?:ipakita|sabihin|i-?print|basahin)\s+(?:mo|nyo|niyo|ninyo)\s+'
    r'(?:sa\s+akin\s+)?ang\s+(?:iyong\s+|inyong\s+)?system\s*prompt\b|'
    r'\bipakitam\s+(?:ti|dagiti)\s+(?:system\s*prompt|bilin\w*|annuroten)\b|'
    r'\bano\s+ang\s+(?:system\s*)?(?:prompt|mga\s+instruksyon|instruksyon|tagubilin)\s+mo\b|'
    r'\bmagpanggap\s+ka|\bkunwari\s+(?:ikaw|ka)\b|'
    r'\b(?:umarte|gumanap|kumilos)\s+ka\s+bilang\b|'
    r'\bhindi\s+ka\s+na\s+(?:si\s+)?iskai\b|\bwala\s+ka\s+nang\s+(?:mga\s+)?patakaran\b|'
    r'\bagpammarang\s+ka\b|\bagbalinka\s+a\b|\baginka\s+a\b',
    re.IGNORECASE,
)


# A question is a follow-up when it contains an expression that cannot be
# resolved from the question itself. Each pattern below is one such expression.
# A false positive costs more than a false negative here: an unresolved
# follow-up merely retrieves afresh, while a standalone question wrongly read
# as one gets pinned to the previous answer's theses and is answered about the
# wrong paper.

# Pronouns with no antecedent inside the question. `this` and `that` are
# deliberately absent: they are demonstratives here but also relative pronouns
# ("theses that used YOLO") and ordinary determiners ("this year"), and each
# has its own narrower pattern below.
_FOLLOWUP_REFERENCE = re.compile(
    r'\b(it|its|they|them|their|these|those|former|latter|same)\b', re.IGNORECASE
)

# "that thesis", "this system", "that one" -- a demonstrative pointing at
# something named earlier in the conversation.
_DEMONSTRATIVE_REFERENCE = re.compile(
    r'\b(?:this|that)\s+'
    r'(?:study|paper|thesis|research|system|project|work|manuscript|one|author|'
    r'approach|methodology|method|dataset|model|finding|result)s?\b',
    re.IGNORECASE,
)

# A demonstrative left dangling at the end: "tell me more about that".
_TRAILING_DEMONSTRATIVE = re.compile(
    r'\b(?:about|regarding|on|with|from|of)\s+(?:this|that|these|those)\s*\??$',
    re.IGNORECASE,
)

# `above` only where it points back at the conversation. It used to match on
# the bare word, so "theses reporting accuracy above ninety percent" was read
# as a follow-up and pinned to the previous answer.
_ABOVE_REFERENCE = re.compile(
    r'\bthe\s+above\b|\b(?:mentioned|noted|listed|shown|described|discussed|cited)\s+above\b',
    re.IGNORECASE,
)

# Only genuine continuations. This used to accept any question opening
# "what|how|why|when|where|who" followed by "is|are|was|were|did|does", which
# is how most standalone questions in the language begin -- "what is
# retrieval-augmented generation?" was classified as a follow-up and answered
# against whatever the previous turn happened to cite. "what about", "what
# else" and an "and"-prefixed question are continuations; "what is" is not.
_FOLLOWUP_START = re.compile(
    r'^(?:and\s+)?(?:what|how)\s+(?:about|else)\b'
    r'|^and\s+(?:what|how|why|when|where|who)\b',
    re.IGNORECASE,
)

# A question can open with a discourse marker and still be the same follow-up.
# `_FOLLOWUP_START` is anchored, so "so what is the result?" missed it while
# "what is the result?" matched. Stripped before that test, never before the
# others -- the marker carries no reference of its own.
_DISCOURSE_OPENER = re.compile(
    r'^\s*(?:so|ok|okay|alright|right|well|then|now|also|but|and)\b[\s,]*', re.IGNORECASE,
)

# "the study", "the paper", "the thesis" with nothing saying which one is a
# reference back to whatever the conversation was already about. Measured
# 2026-09-14: after an answer citing the mango-classification thesis, "so what
# is the result of the study?" carried no pronoun, opened with a discourse
# marker and ran to eight words, so it missed all three tests above, was
# treated as a fresh question, retrieved a different paper's results and
# answered that the archive held no results for the mango study.
#
# Only document nouns, and only unqualified. A noun followed by "of"/"about"/
# "by"/"on" names its own subject ("the study of mango ripeness") and is not a
# reference back. Aspect nouns -- results, findings, objectives -- are
# deliberately excluded: "what are the findings on YOLO accuracy" is an
# ordinary question that should retrieve freely.
_BARE_DOCUMENT_REFERENCE = re.compile(
    r'\bthe\s+(?:study|paper|thesis|research|system|project|work|manuscript)\b'
    r'(?!\s+(?:of|on|about|by|for|titled|regarding|concerning|from|that|which)\b)',
    re.IGNORECASE,
)


def _is_generation_request(normalized: str) -> bool:
    """True only when a generation verb governs a prohibited artifact *and* the
    sentence asks this assistant to produce it.

    Two independent searches — "contains a generation verb" and "contains a
    prohibited artifact" — refused ordinary retrieval questions, because the
    verb and the artifact never had to be related to each other. "What
    conclusion did the authors make about accuracy?" was blocked. Requiring
    the verb to govern the artifact, and the request to be addressed to the
    assistant, keeps the refusal contract while allowing those questions.
    Rule 6 of the grounded prompt still refuses anything this misses.
    """
    if _GENERATE_OWNED_ARTIFACT.search(normalized):
        return True
    if not _VERB_GOVERNS_ARTIFACT.search(normalized):
        return False
    return bool(
        _DIRECTED_AT_ASSISTANT.search(normalized)
        or _OWNED_ARTIFACT.search(normalized)
    )


def prohibited_reason(text: str) -> str | None:
    """Return a stable block category, or None for allowed retrieval requests."""
    normalized = re.sub(r'\s+', ' ', text or '').strip()
    if _INJECTION.search(normalized):
        return 'prompt_injection'
    if _is_generation_request(normalized):
        return 'academic_content_generation'
    return None


def is_ambiguous_followup(question: str, prior_questions: list[str]) -> bool:
    """Identify questions that need prior conversational references resolved."""
    if not prior_questions:
        return False
    normalized = re.sub(r'\s+', ' ', question or '').strip()
    if not normalized:
        return False
    return bool(
        _FOLLOWUP_REFERENCE.search(normalized)
        or _DEMONSTRATIVE_REFERENCE.search(normalized)
        or _TRAILING_DEMONSTRATIVE.search(normalized)
        or _ABOVE_REFERENCE.search(normalized)
        or _BARE_DOCUMENT_REFERENCE.search(normalized)
        or _FOLLOWUP_START.search(_DISCOURSE_OPENER.sub('', normalized))
        # A very short question mid-conversation is almost always a
        # continuation, and there is rarely enough in it to retrieve on alone.
        or (len(normalized.split()) <= 5 and normalized.endswith('?'))
    )


def fallback_standalone_question(question: str, prior_questions: list[str]) -> str:
    """Deterministic fallback when the optional rewrite call is unavailable."""
    previous = prior_questions[-1] if prior_questions else ''
    combined = f'Previous research question: {previous}\nFollow-up: {question}'.strip()
    return combined[:4000]
