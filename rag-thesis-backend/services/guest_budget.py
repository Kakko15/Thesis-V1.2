"""Global daily ceiling on guest research spend (S2).

Three controls already bound guest chat, and none of them bounds its total
cost. The per-guest limit (30/minute) and the per-IP limit (300/minute) cap how
fast one caller can ask. Turnstile caps *who* can ask, since the client-minted
X-Guest-ID is otherwise free to rotate. But a distributed script holding valid
challenges can still spend the project's entire Gemini quota in a morning, and
that quota is shared — exhausting it takes chat down for signed-in students and
faculty as well.

This module adds the missing ceiling: a token budget counted against a UTC-day
key in the same storage that already backs rate limiting, so replicas share one
budget rather than each enforcing its own.

Two design points worth stating.

**The charge is a deliberate over-estimate, booked before generation.** It is
the measured prompt input plus the configured maximum output, so it is an upper
bound on what the request can cost rather than a measurement of what it did
cost. A ceiling that bills after the fact cannot refuse the request that
breaches it. Retrieval embeddings are not billed here; they are a small
fraction of a chat request's cost, and `is_exhausted()` is checked before any
embedding call so an exhausted budget stops spending immediately.

**A refused request still increments the counter.** Checking before
incrementing would reintroduce the race that an atomic increment exists to
avoid. The observable behaviour is identical — a refused caller stays refused
either way — and the key expires at the day boundary, so an inflated count
cannot lock the next day out.

A budget of 0 means unlimited. That keeps development, the test suite, and the
frozen thesis-evaluation pipeline byte-identical to their previous behaviour;
`config.validate_production_services` is what makes a real number mandatory in
production.
"""

import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import NamedTuple

from limits.storage import storage_from_string

from config import settings
from services.chunker import count_tokens

logger = logging.getLogger(__name__)

KEY_PREFIX = 'guest-token-budget'

GUEST_BUDGET_MESSAGE = (
    "IskAI's shared daily allowance for guest research questions has been used up. "
    'Please sign in with your ISU account to continue, or try again tomorrow.'
)


class BudgetDecision(NamedTuple):
    """The outcome of one charge, with the numbers behind it for logging."""

    allowed: bool
    charged: int
    spent: int
    budget: int


ALLOWED_UNLIMITED = BudgetDecision(allowed=True, charged=0, spent=0, budget=0)


@lru_cache(maxsize=1)
def _storage():
    """Bind to the shared rate-limit storage once.

    Cached rather than created per call because a Redis URI would otherwise open
    a connection per request. Tests clear the cache to swap in a fake.
    """
    return storage_from_string(settings.rate_limit_storage_uri)


def _day_key(now: datetime) -> str:
    return f'{KEY_PREFIX}:{now.strftime("%Y-%m-%d")}'


def _seconds_left_in_day(now: datetime) -> int:
    """Expire the counter just after the UTC day it belongs to.

    A minute of slack means a counter created at 23:59:59 still outlives its own
    day rather than expiring mid-request.
    """
    midnight = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    return max(60, int((midnight - now).total_seconds()) + 60)


def is_enabled() -> bool:
    return settings.guest_daily_token_budget > 0


def estimate_charge(*texts: str) -> int:
    """Upper-bound the tokens one guest generation can cost.

    Measured with the same fixed tokenizer proxy the chunker uses, so the number
    is reproducible and documented rather than a character-count guess.
    """
    prompt_tokens = sum(count_tokens(text) for text in texts if text)
    return prompt_tokens + settings.gemini_max_output_tokens


def spent_today(now: datetime | None = None) -> int:
    """Tokens already booked against today's budget, or 0 when disabled."""
    if not is_enabled():
        return 0
    reference = now or datetime.now(timezone.utc)
    try:
        return int(_storage().get(_day_key(reference)) or 0)
    except Exception as error:
        # Fail open: the shared counter being unreachable must not take guest
        # chat down. The per-guest and per-IP rate limits still apply.
        logger.warning('Guest budget lookup failed (%s)', type(error).__name__)
        return 0


def is_exhausted(now: datetime | None = None) -> bool:
    """Cheap read-only check, used before spending anything on retrieval."""
    if not is_enabled():
        return False
    return spent_today(now) >= settings.guest_daily_token_budget


def charge(tokens: int, now: datetime | None = None) -> BudgetDecision:
    """Book `tokens` against today's budget and report whether to proceed."""
    if not is_enabled():
        return ALLOWED_UNLIMITED
    budget = settings.guest_daily_token_budget
    amount = max(1, int(tokens))
    reference = now or datetime.now(timezone.utc)
    try:
        spent = int(_storage().incr(
            _day_key(reference), _seconds_left_in_day(reference), amount=amount,
        ))
    except Exception as error:
        logger.warning('Guest budget charge failed (%s)', type(error).__name__)
        return ALLOWED_UNLIMITED
    return BudgetDecision(
        allowed=spent <= budget, charged=amount, spent=spent, budget=budget,
    )
