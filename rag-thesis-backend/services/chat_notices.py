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

KIND_ANSWER = 'answer'
KIND_NOTICE = 'notice'

CAPACITY_MESSAGE = (
    'IskAI has reached the research AI service usage limit, so your question could not '
    'be processed right now. Please try again later.'
)

NO_RELEVANT_PREFIX = 'No relevant thesis was found in the'

# The greeting/identity reply. Lives here rather than in routers/chat.py for the
# same reason NO_RELEVANT_PREFIX does: it is a system message about the system,
# so the classifier and the text it classifies must not be able to drift apart.
# It was previously stored as an answer, which meant the history loader replayed
# "AI: Hello! I'm IskAI..." to the model as conversational context on the next
# turn -- exactly what B14 exists to prevent.
CONVERSATION_MESSAGE = (
    "Hello! I'm IskAI, the research assistant for the ISU Thesis AI Library. "
    'Ask me about archived thesis topics, methodologies, findings, or related literature.'
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
    CONVERSATION_MESSAGE,
    GROUNDED_FALLBACK_PREFIX,
)

_CAPACITY_STATE = {'limited_until': 0.0}

_TRANSIENT_CAPACITY_MARKERS = (
    '429', 'resource_exhausted', 'quota exceeded', 'rate limit', 'too many requests',
)


def is_capacity_error(error: Exception) -> bool:
    message = str(error).lower()
    return any(marker in message for marker in _TRANSIENT_CAPACITY_MARKERS)


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
    answer = getattr(response, 'answer', '') or ''
    if answer in (
        CAPACITY_MESSAGE, REFUSAL_MESSAGE, GUEST_BUDGET_MESSAGE, CONVERSATION_MESSAGE,
    ):
        return KIND_NOTICE
    if answer.startswith((NO_RELEVANT_PREFIX, GROUNDED_FALLBACK_PREFIX)):
        return KIND_NOTICE
    return KIND_ANSWER
