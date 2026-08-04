"""Regression tests for S2 — the global daily guest token ceiling.

The gap these pin: per-guest (30/min) and per-IP (300/min) limits bound how fast
one caller can ask, and Turnstile bounds who can ask, but nothing bounded a
day's aggregate guest spend. A distributed script holding valid challenges could
drain the shared Gemini quota and take chat down for signed-in users too.
"""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks

from config import settings
from models import ChatRequest
from routers import chat
from services import guest_budget


class FakeStorage:
    """Mirrors the two `limits` storage methods this feature uses."""

    def __init__(self):
        self.counters = {}
        self.expiries = {}
        self.failures = 0

    def incr(self, key, expiry, amount=1):
        if self.failures:
            self.failures -= 1
            raise RuntimeError('storage unavailable')
        self.expiries[key] = expiry
        self.counters[key] = self.counters.get(key, 0) + amount
        return self.counters[key]

    def get(self, key):
        if self.failures:
            self.failures -= 1
            raise RuntimeError('storage unavailable')
        return self.counters.get(key, 0)


@pytest.fixture(name='storage')
def storage_fixture(monkeypatch):
    fake = FakeStorage()
    # Hold the real cached getter, because teardown runs before monkeypatch
    # restores the attribute — clearing through the module would hit the lambda.
    cached_getter = guest_budget._storage
    cached_getter.cache_clear()
    monkeypatch.setattr(guest_budget, '_storage', lambda: fake)
    yield fake
    cached_getter.cache_clear()


@pytest.fixture(name='budget')
def budget_fixture(monkeypatch):
    monkeypatch.setattr(settings, 'guest_daily_token_budget', 1000)


class TestTheCeilingIsOffByDefault:
    """0 means unlimited, so development and the frozen evaluation run unchanged."""

    def test_the_shipped_default_is_unlimited(self):
        assert settings.guest_daily_token_budget == 0

    def test_a_disabled_budget_never_refuses_and_never_touches_storage(self, storage):
        assert guest_budget.is_enabled() is False
        assert guest_budget.is_exhausted() is False
        decision = guest_budget.charge(10_000_000)
        assert decision.allowed is True
        assert storage.counters == {}


class TestChargingAccumulatesAgainstTheDay:
    def test_charges_add_up_until_the_budget_is_crossed(self, storage, budget):
        first = guest_budget.charge(400)
        second = guest_budget.charge(400)
        third = guest_budget.charge(400)
        assert (first.allowed, second.allowed, third.allowed) == (True, True, False)
        assert (first.spent, second.spent, third.spent) == (400, 800, 1200)
        assert third.budget == 1000

    def test_landing_exactly_on_the_budget_is_still_allowed(self, storage, budget):
        assert guest_budget.charge(1000).allowed is True
        assert guest_budget.is_exhausted() is True

    def test_each_utc_day_gets_its_own_counter(self, storage, budget):
        monday = datetime(2026, 8, 4, 23, 59, 30, tzinfo=timezone.utc)
        tuesday = datetime(2026, 8, 5, 0, 0, 30, tzinfo=timezone.utc)
        assert guest_budget.charge(1000, now=monday).allowed is True
        assert guest_budget.is_exhausted(now=monday) is True
        # A new day starts clean rather than inheriting yesterday's exhaustion.
        assert guest_budget.is_exhausted(now=tuesday) is False
        assert guest_budget.charge(1000, now=tuesday).allowed is True
        assert len(storage.counters) == 2

    def test_a_counter_created_late_in_the_day_outlives_its_own_day(self, storage, budget):
        late = datetime(2026, 8, 4, 23, 59, 59, tzinfo=timezone.utc)
        guest_budget.charge(1, now=late)
        expiry = storage.expiries[guest_budget._day_key(late)]
        # One second of day left, plus the documented minute of slack, floored at 60.
        assert expiry >= 60

    def test_a_refused_charge_cannot_lock_out_the_next_day(self, storage, budget):
        today = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)
        tomorrow = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
        for _ in range(20):
            guest_budget.charge(1000, now=today)
        assert guest_budget.spent_today(now=today) == 20_000
        assert guest_budget.is_exhausted(now=tomorrow) is False


class TestTheCeilingFailsOpen:
    """An unreachable shared counter must not take guest chat down; the
    per-guest and per-IP rate limits still apply."""

    def test_a_storage_failure_allows_the_request(self, storage, budget):
        storage.failures = 1
        decision = guest_budget.charge(500)
        assert decision.allowed is True

    def test_a_storage_failure_reports_nothing_spent(self, storage, budget):
        storage.failures = 1
        assert guest_budget.spent_today() == 0
        storage.failures = 1
        assert guest_budget.is_exhausted() is False


class TestTheEstimateIsAnUpperBound:
    def test_the_charge_includes_the_configured_maximum_output(self):
        assert guest_budget.estimate_charge('') == settings.gemini_max_output_tokens

    def test_longer_prompts_cost_more(self):
        short = guest_budget.estimate_charge('attendance monitoring')
        longer = guest_budget.estimate_charge('attendance monitoring ' * 200)
        assert longer > short > settings.gemini_max_output_tokens

    def test_the_estimate_is_the_prompt_plus_the_output_bound(self):
        from services.chunker import count_tokens

        prompt = 'What methodology did the attendance monitoring studies use?'
        assert guest_budget.estimate_charge(prompt) == (
            count_tokens(prompt) + settings.gemini_max_output_tokens
        )


class TestTheChatEndpointEnforcesIt:
    @staticmethod
    def _run(question='Which theses cover attendance monitoring?', user=None):
        return asyncio.run(chat._chat_impl(
            ChatRequest(question=question),
            SimpleNamespace(headers={}),
            BackgroundTasks(),
            user,
        ))

    @staticmethod
    def _today():
        return guest_budget._day_key(datetime.now(timezone.utc))

    @staticmethod
    def _retrieval_with_one_source():
        async def retrieval(*_args, **_kwargs):
            return ('Context about attendance monitoring [1]', [
                {'id': 'p1', 'title': 'Attendance Study', 'author': 'Cruz', 'year': 2025},
            ], 0.8), None
        return retrieval

    @pytest.fixture(autouse=True)
    def _no_department_lookup(self, monkeypatch):
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_a: 'CCSICT')

    def test_an_exhausted_guest_is_refused_before_any_retrieval(
        self, storage, budget, monkeypatch,
    ):
        storage.counters[self._today()] = 5000

        async def must_not_run(*_args, **_kwargs):
            raise AssertionError('retrieval ran after the allowance was exhausted')
        monkeypatch.setattr(chat, '_retrieve_evidence', must_not_run)

        response = self._run()
        assert response.answer == guest_budget.GUEST_BUDGET_MESSAGE
        assert response.sources == []

    def test_a_signed_in_user_is_never_charged(self, storage, budget, monkeypatch):
        storage.counters[self._today()] = 5000
        monkeypatch.setattr(chat, '_retrieve_evidence', self._retrieval_with_one_source())

        async def generation(*_args, **_kwargs):
            return 'Attendance monitoring is covered [1].', None
        monkeypatch.setattr(chat, '_invoke_generation', generation)

        response = self._run(user=SimpleNamespace(id='user-1'))
        assert response.answer != guest_budget.GUEST_BUDGET_MESSAGE
        # Still exactly the seeded guest total: authenticated traffic is not billed.
        assert storage.counters[self._today()] == 5000

    def test_a_guest_generation_is_charged_before_it_runs(
        self, storage, budget, monkeypatch,
    ):
        order = []
        monkeypatch.setattr(chat, '_retrieve_evidence', self._retrieval_with_one_source())
        real_charge = guest_budget.charge

        def recording_charge(tokens, now=None):
            order.append('charge')
            return real_charge(tokens, now)
        monkeypatch.setattr(guest_budget, 'charge', recording_charge)

        async def generation(*_args, **_kwargs):
            order.append('generate')
            return 'Attendance monitoring is covered [1].', None
        monkeypatch.setattr(chat, '_invoke_generation', generation)

        self._run()
        assert order == ['charge', 'generate']
        assert guest_budget.spent_today() >= settings.gemini_max_output_tokens

    def test_a_guest_over_the_ceiling_never_reaches_generation(
        self, storage, budget, monkeypatch,
    ):
        monkeypatch.setattr(settings, 'guest_daily_token_budget', 10)
        monkeypatch.setattr(chat, '_retrieve_evidence', self._retrieval_with_one_source())

        async def must_not_run(*_args, **_kwargs):
            raise AssertionError('generation ran past the ceiling')
        monkeypatch.setattr(chat, '_invoke_generation', must_not_run)

        response = self._run()
        assert response.answer == guest_budget.GUEST_BUDGET_MESSAGE

    def test_the_notice_is_not_replayed_as_conversational_context(self):
        assert chat._is_stored_non_answer(guest_budget.GUEST_BUDGET_MESSAGE) is True
