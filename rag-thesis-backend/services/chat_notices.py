"""System notices returned by chat, and the capacity cooldown that emits one.

Chat answers three questions that have nothing to do with retrieval or
generation: has the provider's quota run out, is this response research output
or a system message, and how should a stored system message be treated when the
conversation is replayed. Those concerns were interleaved with the RAG pipeline
in `routers/chat.py`; they live here so the pipeline module is about the
pipeline.

**Notices versus answers (B14).** A notice is a response the system produced
about itself — the capacity apology, the guard refusal, the guest-allowance
message, the no-relevant-thesis message. Each carries no sources. Persisting
them as answers meant the history loader fed an apology back to the model as
conversational context, so the next question built on it and a follow-up had no
prior sources to anchor to.

The fix is a structural marker written when the row is created, not a string
match performed when it is read. `response_kind()` decides from the response
object; `KIND_NOTICE` is stored in `chat_messages.kind`. `is_stored_non_answer()`
survives as a second line of defence for rows written before the migration
backfilled them, and for any row whose text is a notice while its kind says
otherwise.

Notices stay visible in the user's transcript. The conversation happened, and
dropping the question the user asked would be a worse outcome than showing them
why it could not be answered.
"""

import re
import time

from config import settings
from services.guards import REFUSAL_MESSAGE
from services.guest_budget import GUEST_BUDGET_MESSAGE
from services.network_retry import mentions_http_status

KIND_ANSWER = 'answer'
KIND_NOTICE = 'notice'
NOTICE_TYPE_CONVERSATION = 'conversation'

# Rows saved before the conversational copy was shortened retain this wording.
# Keep recognizing them as routine conversation so a restored transcript does
# not show a warning banner merely because the response predates the new copy.
LEGACY_CONVERSATION_PREFIX = (
    "Hello! I'm IskAI, the research assistant for the ISU Thesis AI Library."
)

CAPACITY_MESSAGE = (
    'IskAI has reached the research AI service usage limit, so your question could not '
    'be processed right now. Please try again later.'
)

NO_RELEVANT_PREFIX = 'No relevant thesis was found in the'

# The greeting reply. Lives here rather than in routers/chat.py for the
# same reason NO_RELEVANT_PREFIX does: it is a system message about the system,
# so the classifier and the text it classifies must not be able to drift apart.
# It was previously stored as an answer, which meant the history loader replayed
# "AI: Hello! I'm IskAI..." to the model as conversational context on the next
# turn -- exactly what B14 exists to prevent.
CONVERSATION_MESSAGES = (
    "Hello! I'm IskAI. What CCSICT thesis topic would you like to explore?",
    'Hi! What topic, title, author, or methodology would you like to search in the CCSICT archive?',
    'Welcome back. Tell me what CCSICT research you want to explore today.',
    'Hello! I can help you discover and compare archived CCSICT studies. Where should we begin?',
    'Hi there! Ask me a research question, or give me a thesis topic to search.',
    'Good to see you! What would you like to learn from the CCSICT thesis archive?',
    'Welcome! We can explore a research topic, study, author, method, or finding.',
    'Hello again. Which area of CCSICT research can I help you investigate?',
    'Hi! Share a topic or question, and I will look for supporting archived studies.',
    'Greetings! What research would you like to discover or compare today?',
)
CONVERSATION_MESSAGE = CONVERSATION_MESSAGES[0]

# Identity questions are distinct from greetings so the assistant answers what
# was asked instead of repeating its welcome message.
IDENTITY_MESSAGE = (
    "I'm IskAI, the research assistant for the ISU Thesis AI Library. I retrieve "
    'information from archived CCSICT theses and provide citation-backed answers '
    'without exposing full manuscripts.'
)

# The answer to "who developed you". This is application provenance documented
# by the repository itself, not a claim inferred from whichever manuscript
# happens to rank nearest to the question.
#
# Lives here for the same reason CONVERSATION_MESSAGE does: it is a system
# message about the system, so the classifier below and the text it classifies
# must not be able to drift apart, and it must never be replayed to the model
# as conversational context.
SYSTEM_ORIGIN_MESSAGE = (
    'IskAI was developed by Ahron John F. Barlis and Carlo Rossi P. Gallardo '
    'for their BSCS Data Mining thesis, "A Centralized AI-Powered Thesis Library '
    'Using Retrieval-Augmented Generation," at Isabela State University Echague. '
    'If you meant a system described in another archived thesis, name that thesis.'
)

# The capabilities reply ("what can you do", "how do I use this"). Previously
# these questions fell into the greeting, which says who IskAI is but not what
# to ask it. A system message about the system, so it lives beside the
# classifier like the others and is never replayed as model context.
CAPABILITIES_MESSAGE = (
    'I can help you research the archived CCSICT theses. Ask me to: find studies by '
    'topic, title, author, year, or category; summarize one thesis; compare two or more '
    'theses; list or count what the archive holds; or check how close a proposed topic '
    'sits to existing work. Every factual answer cites the archived passages it came '
    'from. I answer only from the indexed archive, and I do not write thesis chapters, '
    'literature reviews, or other academic content.'
)

# The courtesy reply (thanks / goodbye). Without it, "thank you" runs semantic
# retrieval and usually returns "No relevant thesis was found" -- a correct
# pipeline output and a terrible goodbye.
COURTESY_MESSAGES = (
    "You're welcome! Ask me anytime about archived thesis topics, methods, findings, or authors.",
    'Happy to help. Let me know if you want to explore another CCSICT study.',
    'Anytime! I am ready for your next archive research question.',
    'Glad I could help. You can continue with a topic, title, author, or comparison.',
    'My pleasure. Ask another question whenever you are ready.',
    'You are welcome. I can help again whenever you want to examine another study.',
    'Glad that helped. Feel free to continue exploring the CCSICT archive.',
    'No problem! Send another research question whenever one comes to mind.',
    'Happy to assist. We can look into another topic whenever you are ready.',
    'You are very welcome. I am here if you need another evidence-backed answer.',
)
COURTESY_MESSAGE = COURTESY_MESSAGES[0]

FAREWELL_MESSAGES = (
    'Goodbye! Your saved conversation will be here when you return.',
    'See you next time. Come back whenever you want to explore more CCSICT research.',
    'Take care! IskAI will be ready when you have another research question.',
    'Until next time. Your thesis research conversation is saved here.',
    'Thanks for using IskAI. Have a good day!',
    'Farewell for now. Return anytime to continue exploring the thesis archive.',
    'See you again soon. Your CCSICT research trail will remain available.',
    'Have a great day! I will be here when you are ready to continue your research.',
    'Take care, and come back anytime you need another archive-backed answer.',
    'Goodbye for now. I look forward to helping with your next research question.',
)
FAREWELL_MESSAGE = FAREWELL_MESSAGES[0]


def varied_message(messages: tuple[str, ...], prior_replies: list[str]) -> str:
    """Choose the least recently used variant, deterministically.

    Each unused message is selected once before the pool cycles. On later
    cycles, the message whose latest appearance is oldest wins, guaranteeing no
    immediate repeat while keeping tests and transcripts reproducible.
    """
    latest = {
        message: max(
            (index for index, reply in enumerate(prior_replies) if reply == message),
            default=-1,
        )
        for message in messages
    }
    return min(messages, key=lambda message: latest[message])

# A single opaque token can receive a misleadingly high embedding similarity
# despite sharing no language with the retrieved text. Ask for a usable topic
# instead of presenting unrelated studies as evidence.
UNCLEAR_TOPIC_MESSAGE = (
    "I couldn't identify a thesis topic or research question in that message. "
    'Try a topic such as "artificial intelligence," or ask me to search by title, '
    'author, methodology, or finding.'
)

# Opening of the grounded retrieval fallback, which reports that no direct
# answer could be verified and then points at the closest archived studies. It
# carries citations, so it is deliberately NOT flagged `no_relevant_thesis`:
# retrieval did succeed and the sources are real. It is still a system message
# about the system, so it must not become model context either. Matched by
# prefix because the study list is interpolated after it.
GROUNDED_FALLBACK_PREFIX = 'I could not verify a direct answer'

# Every response text the system persists that is a notice rather than research
# output. The no-relevant, greeting, and grounded-fallback texts interpolate or
# extend, so they are matched by prefix; the others are exact constants.
NOTICE_MARKERS = (
    CAPACITY_MESSAGE,
    REFUSAL_MESSAGE,
    GUEST_BUDGET_MESSAGE,
    NO_RELEVANT_PREFIX,
    *CONVERSATION_MESSAGES,
    IDENTITY_MESSAGE,
    SYSTEM_ORIGIN_MESSAGE,
    CAPABILITIES_MESSAGE,
    *COURTESY_MESSAGES,
    *FAREWELL_MESSAGES,
    UNCLEAR_TOPIC_MESSAGE,
    GROUNDED_FALLBACK_PREFIX,
)

_CAPACITY_STATE = {'limited_until': 0.0}

_TRANSIENT_CAPACITY_MARKERS = (
    'resource_exhausted', 'quota exceeded', 'rate limit', 'too many requests',
)
# Matched as a labelled HTTP status ("HTTP 429", "code: 429", "429 Too Many
# Requests"), never as a bare substring: '429' also occurs inside chunk counts,
# byte sizes and identifiers, and a false positive here trips the process-wide
# cooldown below and rotates the key pool for nothing.
_CAPACITY_STATUSES = ('429',)


def is_capacity_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        any(marker in message for marker in _TRANSIENT_CAPACITY_MARKERS)
        or mentions_http_status(message, _CAPACITY_STATUSES)
    )


def capacity_limit_is_active() -> bool:
    return time.monotonic() < _CAPACITY_STATE['limited_until']


def mark_capacity_limited() -> None:
    _CAPACITY_STATE['limited_until'] = (
        time.monotonic() + settings.gemini_capacity_cooldown_seconds
    )


def reset_capacity_limit() -> None:
    """Clear the cooldown immediately.

    The cooldown is process state with a minute-long lifetime, so a test that
    triggers it would otherwise leak a capacity response into whatever runs next.
    """
    _CAPACITY_STATE['limited_until'] = 0.0


def is_stored_non_answer(answer: str) -> bool:
    """Recognize a persisted notice from its text.

    Retained after B14 gave `chat_messages` a `kind` column, because rows written
    by an earlier build carry whatever the backfill assigned them, and because a
    notice mis-stored as an answer should still not become model context.
    """
    normalized = re.sub(r'\s+', ' ', answer or '').strip()
    if not normalized:
        return False
    return any(normalized.startswith(marker[:60]) for marker in NOTICE_MARKERS)


def response_kind(response) -> str:
    """Classify a ChatResponse at the source, before it is persisted.

    Structural where a structural signal exists: `no_relevant_thesis` is already
    a field. The other two notices are module constants, so exact equality
    against them is as precise as a dedicated flag would be, without widening the
    public response schema.
    """
    if getattr(response, 'no_relevant_thesis', False):
        return KIND_NOTICE
    if getattr(response, 'notice_type', None) == NOTICE_TYPE_CONVERSATION:
        return KIND_NOTICE
    answer = getattr(response, 'answer', '') or ''
    if answer in (
        CAPACITY_MESSAGE, REFUSAL_MESSAGE, GUEST_BUDGET_MESSAGE, *CONVERSATION_MESSAGES,
        IDENTITY_MESSAGE,
        SYSTEM_ORIGIN_MESSAGE, CAPABILITIES_MESSAGE, *COURTESY_MESSAGES,
        *FAREWELL_MESSAGES,
        UNCLEAR_TOPIC_MESSAGE,
    ):
        return KIND_NOTICE
    if answer.startswith((NO_RELEVANT_PREFIX, GROUNDED_FALLBACK_PREFIX)):
        return KIND_NOTICE
    return KIND_ANSWER


def notice_type(answer: str) -> str | None:
    """Presentation subtype for routine, non-research conversation."""
    if (answer or '').startswith(LEGACY_CONVERSATION_PREFIX):
        return NOTICE_TYPE_CONVERSATION
    if answer in (
        *CONVERSATION_MESSAGES, IDENTITY_MESSAGE, SYSTEM_ORIGIN_MESSAGE,
        CAPABILITIES_MESSAGE, *COURTESY_MESSAGES, *FAREWELL_MESSAGES,
    ):
        return NOTICE_TYPE_CONVERSATION
    return None
