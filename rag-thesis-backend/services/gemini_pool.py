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

# Cache slot for the gateway client. The gateway authenticates with its own
# credential rather than a Gemini key, so it needs a stable identity in the
# `(kind, api_key)` cache that can never collide with a real key.
_GATEWAY_KEY = '\x00gateway'

# api_key -> monotonic deadline before which the key is treated as exhausted.
_cooldowns: dict[str, float] = {}
# (kind, api_key) -> constructed client; building one per call would open a new
# HTTP client for every question.
_clients: dict[tuple[str, str], object] = {}
_lock = threading.Lock()


def gateway_enabled() -> bool:
    """Whether chat traffic is routed through an OpenAI-compatible gateway."""
    return bool(settings.llm_base_url.strip())


def active_output_ceiling() -> int:
    """The output-token ceiling actually in force for chat generation.

    The two routes carry different budgets, so a caller reporting "the reply hit
    the ceiling" has to name the one that applied. Reading
    `gemini_max_output_tokens` unconditionally reported 2,000 on a gateway
    deployment whose ceiling was 6,000, which sends a reader to the wrong
    setting with a number that never applied.
    """
    if gateway_enabled():
        return settings.llm_gateway_max_output_tokens
    return settings.gemini_max_output_tokens


def _gateway_client(kind: str):
    """One chat client pointed at the gateway, sending the model name unchanged.

    The model name is unchanged, so `gemini-3.6-flash` on a gateway is still
    `gemini-3.6-flash` and the paper's version tables and Figure 8 stay
    accurate. **The answers are not equivalent, and this comment used to claim
    they were.** `thinking_level` is Gemini-native and cannot cross an
    OpenAI-compatible boundary, so for as long as it was simply dropped nothing
    bounded reasoning on this route: a measured grounded call spent 1,920 of its
    1,996 output tokens reasoning and returned a severed reply, while the same
    question answered completely in 943 tokens against Google.

    `reasoning_effort` is the OpenAI-compatible spelling of the same control and
    is sent here carrying `thinking_level`'s configured value. An operator that
    rejects the parameter fails this hop, and `_should_continue` then falls the
    call back to Google, which is the provider under contract anyway -- so
    sending it cannot strand a question. The ceiling is this route's own
    (`llm_gateway_max_output_tokens`), leaving the direct route's evaluated
    budget untouched.
    """
    return ChatOpenAI(
        model=settings.gemini_verdict_model if kind == VERDICT else settings.gemini_chat_model,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        timeout=settings.gemini_timeout_seconds,
        max_retries=settings.gemini_max_retries,
        max_tokens=settings.llm_gateway_max_output_tokens,
        reasoning_effort=settings.gemini_thinking_level,
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
    # The sentinel decides, not `gateway_enabled()`. Keying off the global flag
    # meant every reserve Gemini key also built a gateway client, so the
    # "fall back to Google" hops were four more calls to the same gateway with
    # the same credential — a fallback that could not fall back.
    if api_key == _GATEWAY_KEY:
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
    """`(api_key, client)` pairs of Gemini reserve keys, best candidates first.

    A key still inside its cooldown is demoted rather than dropped: exhausting
    every option is better than giving up early, so a pool can never behave worse
    than the single key it replaced.
    """
    keys = settings.gemini_reserve_key_list
    ready = [key for key in keys if not _is_cooling(key)]
    cooling = [key for key in keys if _is_cooling(key)]
    return [(key, _client(kind, key)) for key in ready + cooling]


def attempt_chain(primary, kind: str) -> list[tuple[str, str | None, object]]:
    """Every client to try, in order, as `(label, api_key, client)`.

    The gateway goes first when configured, because that is the whole point of
    configuring it — but it is treated as best-effort. Google remains the
    contract: `primary` is the caller's own Gemini client, followed by any
    reserve keys.

    This is deliberately assembled here rather than at the call sites. Each
    caller passes the Gemini client it already holds, which is what keeps the
    single-key path and the existing tests unchanged; if the gateway were only
    reachable through `reserve_attempts` it would never be tried at all, because
    the primary is always attempted first.
    """
    chain: list[tuple[str, str | None, object]] = []
    # Skipped entirely while cooling, unlike a reserve key, which is merely
    # demoted. A key that is only rate-limited fails fast and is still worth a
    # last-resort attempt; an unreachable gateway can hang until
    # `gemini_timeout_seconds`, so retrying it on every request would add a
    # minute to every question when Google is sitting right behind it.
    if kind != EMBED and gateway_enabled() and not _is_cooling(_GATEWAY_KEY):
        chain.append(('gateway', _GATEWAY_KEY, _client(kind, _GATEWAY_KEY)))
    chain.append(('primary', None, primary))
    chain.extend(('reserve', key, client) for key, client in reserve_attempts(kind))
    return chain


def _should_continue(label: str, error: BaseException) -> bool:
    """Whether a failure on this hop should fall through to the next one.

    The gateway is optional infrastructure, so **any** failure there falls back
    to Google — an unreachable host, a rejected credential and an exhausted
    quota are all reasons to use the provider that is actually under contract,
    and none of them is a reason to fail a user's question.

    Google hops keep the original narrower rule: only exhaustion rotates, so a
    malformed prompt fails once instead of being replayed against every key.
    """
    if label == 'gateway':
        logger.warning(
            'Gemini gateway hop failed (%s); falling back to Google',
            type(error).__name__,
        )
        return True
    return is_capacity_error(error)


async def arun(primary, kind: str, call: Callable[[object], Awaitable[T]]) -> T:
    """Await `call` against each client in turn: gateway, primary, reserves."""
    last: BaseException | None = None
    for label, api_key, client in attempt_chain(primary, kind):
        try:
            return await call(client)
        except Exception as error:  # pylint: disable=broad-exception-caught
            if not _should_continue(label, error):
                raise
            if api_key:
                _mark_exhausted(api_key)
            last = error
    raise last  # type: ignore[misc]  # the chain always holds at least `primary`


def run(primary, kind: str, call: Callable[[object], T]) -> T:
    """Synchronous `arun`, for the embedding and duplication-chat call sites."""
    last: BaseException | None = None
    for label, api_key, client in attempt_chain(primary, kind):
        try:
            return call(client)
        except Exception as error:  # pylint: disable=broad-exception-caught
            if not _should_continue(label, error):
                raise
            if api_key:
                _mark_exhausted(api_key)
            last = error
    raise last  # type: ignore[misc]  # the chain always holds at least `primary`
