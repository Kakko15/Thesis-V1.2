"""Cross-lingual query preparation for retrieval.

The archive is English: formal capstone manuscripts, indexed as English chunks.
A research question asked in Filipino or Ilocano embeds into a conversational
region of the vector space and matches those chunks poorly, however capable the
embedding model is at multilingual text -- cross-lingual alignment is close,
never identical, and the gap widens for a regional language like Ilocano
against formal academic English.

Routing was the other half of this and is handled deterministically in
`routers/chat.py`: greetings, identity, capability, origin and catalog
questions never reach retrieval at all, at zero token cost. What is left is the
genuine research question asked in Filipino or Ilocano, which SHOULD retrieve
and currently retrieves badly.

The fix is confined to the query. The translated text is used for the embedding
call and for question-type classification; it is never shown to the user, never
stored, and never replaces the question the generation prompt sees. That
containment is deliberate:

  * `services/prompts.py` is untouched, so PROMPT_VERSION does not move and the
    frozen generation contract is unchanged.
  * The Objective 2 harness asks its questions in English, so this path is not
    entered during `evaluation/run_comparison.py` and the measured numbers are
    unaffected.
  * A failure here costs retrieval quality, never availability: every error
    path falls back to the original question.
"""

import re

# Markers with no English homograph. One is enough: no English research
# question contains "ang", "mga", "tungkol" or "dagiti" by accident.
_DECISIVE_MARKERS = frozenset({
    # Filipino
    'ang', 'mga', 'ng', 'nang', 'sino', 'ano', 'anong', 'anu', 'paano', 'pano',
    'bakit', 'kailan', 'saan', 'nasaan', 'ilan', 'ilang', 'alin', 'aling',
    'tungkol', 'ukol', 'patungkol', 'ginamit', 'ginawa', 'gumamit', 'gumawa',
    'mayroon', 'meron', 'merong', 'hindi', 'wala', 'iyong', 'aking', 'aming',
    'kanilang', 'nila', 'niya', 'kanila', 'dito', 'rito', 'nandito', 'narito',
    'tesis', 'pananaliksik', 'pag', 'aaral', 'sinulat', 'isinulat', 'nagsulat',
    'kung', 'dahil', 'upang', 'nakuha', 'natuklasan', 'layunin', 'pamamaraan',
    'ibang', 'lahat', 'bawat', 'yung', 'itong', 'nito', 'niyon', 'noong',
    # Ilocano
    'dagiti', 'iti', 'ania', 'anya', 'asino', 'siasino', 'kasano', 'maipapan',
    'daytoy', 'dayta', 'adda', 'aramid', 'nangaramid', 'panagadal', 'ditoy',
    'kadagiti', 'nagbanagan', 'panagsukisok', 'ar', 'aramaten', 'ar-aramaten',
    # Measured 2026-09-14: "kayat ko makita dyay specific objectives da"
    # carried only one weak marker and was embedded as Ilocano.
    'kayat', 'kaykayat', 'dyay', 'diay', 'apay', 'awan', 'ammo', 'ammom',
    'kitaen', 'kitaem', 'basaen', 'ipakitam', 'nagan', 'naganna', 'mabalin',
    'makita', 'sadino', 'mano', 'agpada', 'kunana', 'kunam', 'saanmo',
})
# Markers that also occur in English, or are too short to carry the decision
# alone. Two or more of these together still say the question is not English.
_WEAK_MARKERS = frozenset({
    'na', 'sa', 'ba', 'po', 'ho', 'ito', 'iyon', 'ka', 'mo', 'ko', 'ni', 'si',
    'ay', 'at', 'para', 'lang', 'din', 'rin', 'naman', 'pala', 'kaya', 'daw',
    'ti', 'ken', 'met', 'laeng', 'kadi', 'nga', 'a', 'idi', 'kas', 'no',
    'da', 'mi', 'yo', 'tayo', 'kami',
})


def looks_non_english(text: str) -> bool:
    """Whether a question is worth translating before it is embedded.

    Deterministic on purpose. Deciding this with a model call would put a
    second paid request in front of every turn, including the English ones
    this path must not touch.
    """
    tokens = re.findall(r'[a-z]+', (text or '').lower())
    if not tokens:
        return False
    if any(token in _DECISIVE_MARKERS for token in tokens):
        return True
    return len({token for token in tokens if token in _WEAK_MARKERS}) >= 2


# Deliberately not in `services/prompts.py`. That module holds the generation
# contract the paper freezes and `PROMPT_VERSION` stamps; this is a query
# preparation step whose output never reaches the reader, and keeping it here
# is what lets the fix ship without moving a frozen constant.
_TRANSLATION_PROMPT = """You prepare search queries for an English-language \
academic thesis archive at Isabela State University.

Rewrite the question below as a short English search query. The question may be \
in Filipino, Ilocano, Taglish, or English.

Rules:
- Output ONLY the rewritten query. No preamble, no explanation, no quotes.
- Keep it under 25 words and on a single line.
- Preserve proper nouns, thesis titles, author names, acronyms and technical \
terms exactly as written.
- Keep the question's meaning and scope. Do not answer it, do not broaden it, \
and do not add topics it does not mention.
- If the question is already English, repeat it unchanged.

Question: {question}"""


def translation_prompt(question: str) -> str:
    """The query-rewrite instruction for one question."""
    return _TRANSLATION_PROMPT.format(question=question)


def usable_translation(candidate: str, original: str) -> str:
    """Accept a model rewrite only when it still looks like a search query.

    A refusal, an apology or a multi-line explanation must never become the
    text that gets embedded, so anything unexpected falls back to the question
    as asked -- which is exactly today's behaviour.
    """
    raw = (candidate or '').strip()
    # A multi-line reply is an explanation, not a search query -- the same
    # discipline `_rewrite_followup` applies to its own rewrite.
    if '\n' in raw:
        return original
    cleaned = re.sub(r'\s+', ' ', raw).strip().strip('"\'')
    if not 3 <= len(cleaned) <= 400:
        return original
    if cleaned.lower().startswith(('answer:', 'response:', 'query:', 'i cannot', 'i can not')):
        return original
    return cleaned
