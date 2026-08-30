"""Reserve Gemini API keys, used only when the primary key reports exhaustion.

Why this exists
---------------
Free-tier Gemini quota is per key and per minute. One key is enough for a single
researcher testing, and not enough for a room of people trying the assistant at
once: the first 429 trips `chat_notices.mark_capacity_limited()` and every
question for the next minute returns the capacity notice without being attempted
at all.

This module lets a deployment configure additional keys. On a capacity error the
call is retried against each reserve key in turn, and only when every key is
exhausted does the error propagate — so the global cooldown comes to mean "the
whole pool is out" rather than "one key hiccuped".

Design constraints this respects
--------------------------------
**The primary client is always tried first, exactly as before.** Callers pass the
client they already hold, so rotation is purely additive. With a single
configured key `reserve_attempts()` is empty and the control flow is identical to
having no pool at all, which keeps development, the test suite, and the frozen
evaluation pipeline unchanged.

**Only capacity errors rotate.** A malformed prompt or an auth failure fails on
the first key instead of being replayed against every remaining one.

**A pool is not a way around the quota.** Each reserve key must be a real,
separately-owned allowance — a co-researcher's key, or the department's — used
with that owner's consent. Minting extra accounts to multiply one person's free
tier violates the provider's terms. Every unpaid key also carries the same
data-use restriction, so a pool buys throughput and never legal headroom (see
`docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md`).
"""

import logging
import threading
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_openai import ChatOpenAI

from config import settings
from services.chat_notices import is_capacity_error

logger = logging.getLogger(__name__)

T = TypeVar('T')

CHAT = 'chat'
EXTRACT = 'extract'
VERDICT = 'verdict'
EMBED = 'embed'

# api_key -> monotonic deadline before which the key is treated as exhausted.
_cooldowns: dict[str, float] = {}
# (kind, api_key) -> constructed client; building one per call would open a new
# HTTP client for every question.
_clients: dict[tuple[str, str], object] = {}
_lock = threading.Lock()


def gateway_enabled() -> bool:
    """Whether chat traffic is routed through an OpenAI-compatible gateway."""
    return bool(settings.llm_base_url.strip())


def _gateway_client(kind: str):
    """One chat client pointed at the gateway, sending the model name unchanged.

    Only the route changes. A gateway that serves `gemini-3.6-flash` still runs
    `gemini-3.6-flash`, so the evaluated model, the paper's version tables and
    Figure 8 all stay accurate. `thinking_level` is dropped because it is a
    Gemini-native parameter with no OpenAI-compatible equivalent.
    """
    return ChatOpenAI(
        model=settings.gemini_verdict_model if kind == VERDICT else settings.gemini_chat_model,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        timeout=settings.gemini_timeout_seconds,
        max_retries=settings.gemini_max_retries,
        max_tokens=settings.gemini_max_output_tokens,
    )


def _build(kind: str, api_key: str):
    """Construct one client, matching each call site's existing parameters.

    The chat kinds differ only where the original call sites already differed:
    `extract` and `verdict` never passed `thinking_level`, so they are reproduced
    without it rather than quietly normalized into the chat configuration.

    EMBED is never routed through the gateway. The pgvector column is
    vector(768) under a CHECK constraint and `match_chunks` filters on the
    recorded embedding model, so a different embedding source returns zero
    results rather than degraded ones — a failure that presents as an empty
    archive rather than as a misconfiguration.
    """
    if kind != EMBED and gateway_enabled():
        return _gateway_client(kind)
    if kind in (CHAT, EXTRACT):
        options = {
            'model': settings.gemini_chat_model,
            'google_api_key': api_key,
            'timeout': settings.gemini_timeout_seconds,
            'max_retries': settings.gemini_max_retries,
            'max_output_tokens': settings.gemini_max_output_tokens,
        }
        if kind == CHAT:
            options['thinking_level'] = settings.gemini_thinking_level
        return ChatGoogleGenerativeAI(**options)
    if kind == VERDICT:
        return ChatGoogleGenerativeAI(
            model=settings.gemini_verdict_model,
            google_api_key=api_key,
            timeout=settings.gemini_timeout_seconds,
            max_retries=settings.gemini_max_retries,
            max_output_tokens=settings.gemini_max_output_tokens,
        )
    if kind == EMBED:
        return GoogleGenerativeAIEmbeddings(
            model=settings.gemini_embed_model,
            google_api_key=api_key,
            output_dimensionality=settings.embedding_dimensions,
        )
    raise ValueError(f'Unknown Gemini client kind: {kind}')


def _client(kind: str, api_key: str):
    with _lock:
        cached = _clients.get((kind, api_key))
    if cached is not None:
        return cached
    # Built outside the lock: constructing a client is slow enough that holding
    # the lock across it would serialize every first call in the process.
    built = _build(kind, api_key)
    with _lock:
        return _clients.setdefault((kind, api_key), built)


def _mark_exhausted(api_key: str) -> None:
    with _lock:
        _cooldowns[api_key] = time.monotonic() + settings.gemini_key_cooldown_seconds


def _is_cooling(api_key: str) -> bool:
    with _lock:
        return _cooldowns.get(api_key, 0.0) > time.monotonic()


def reset() -> None:
    """Test hook: drop cached clients and every recorded key cooldown."""
    with _lock:
        _cooldowns.clear()
        _clients.clear()


def reserve_attempts(kind: str) -> list[tuple[str, object]]:
    """`(api_key, client)` pairs to try after the primary, best candidates first.

    A key still inside its cooldown is demoted rather than dropped: exhausting
    every option is better than giving up early, so a pool can never behave worse
    than the single key it replaced.
    """
    if kind != EMBED and gateway_enabled():
        # The gateway authenticates with its own credential, so the reserve
        # Gemini keys cannot help this kind; offering them would spend a round
        # trip per key on a request that never reaches Google with those keys.
        return []
    keys = settings.gemini_reserve_key_list
    ready = [key for key in keys if not _is_cooling(key)]
    cooling = [key for key in keys if _is_cooling(key)]
    return [(key, _client(kind, key)) for key in ready + cooling]


async def arun(primary, kind: str, call: Callable[[object], Awaitable[T]]) -> T:
    """Await `call(primary)`, falling through to reserve keys on exhaustion."""
    try:
        return await call(primary)
    except Exception as error:  # pylint: disable=broad-exception-caught
        if not is_capacity_error(error):
            raise
        last = error
    # Deliberately outside the handler above: the loop re-raises whichever
    # exhaustion error came last, and inside an `except` block that would read as
    # an unchained re-raise of a different exception.
    for api_key, client in _announced(kind):
        try:
            return await call(client)
        except Exception as retry_error:  # pylint: disable=broad-exception-caught
            if not is_capacity_error(retry_error):
                raise
            _mark_exhausted(api_key)
            last = retry_error
    raise last


def run(primary, kind: str, call: Callable[[object], T]) -> T:
    """Synchronous `arun`, for the embedding and duplication-chat call sites."""
    try:
        return call(primary)
    except Exception as error:  # pylint: disable=broad-exception-caught
        if not is_capacity_error(error):
            raise
        last = error
    for api_key, client in _announced(kind):
        try:
            return call(client)
        except Exception as retry_error:  # pylint: disable=broad-exception-caught
            if not is_capacity_error(retry_error):
                raise
            _mark_exhausted(api_key)
            last = retry_error
    raise last


def _announced(kind: str) -> list[tuple[str, object]]:
    """Reserve attempts, logging once that the primary key ran out."""
    attempts = reserve_attempts(kind)
    if attempts:
        logger.warning(
            'Primary Gemini key reported exhaustion; trying %d reserve key(s) for %s',
            len(attempts), kind,
        )
    return attempts
