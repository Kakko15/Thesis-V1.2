"""Reserve-key rotation (services/gemini_pool.py)."""

import asyncio

import pytest

from config import settings
from services import gemini_pool

# Captured before the autouse fixture stubs it out, so the construction test
# below exercises the real factory rather than the stand-in.
REAL_BUILD = gemini_pool._build

# What the stubbed `_build` in `clean_pool` returns for the gateway hop.
GATEWAY_STUB = f'client:{gemini_pool.CHAT}:{gemini_pool._GATEWAY_KEY}'


class CapacityError(RuntimeError):
    """Shaped like a provider 429 so `is_capacity_error` recognizes it."""

    def __init__(self):
        super().__init__('429 RESOURCE_EXHAUSTED: quota exceeded')


@pytest.fixture(autouse=True)
def clean_pool(monkeypatch):
    gemini_pool.reset()
    # Never construct a real client: stand one in per (kind, key).
    monkeypatch.setattr(gemini_pool, '_build', lambda kind, key: f'client:{kind}:{key}')
    # Pin every input this module reads from configuration. Without this the
    # assertions below silently depend on the developer's .env, and a local run
    # disagrees with CI -- which has no .env at all. That has now bitten twice:
    # once when real GEMINI_API_KEYS were added, and again when LLM_BASE_URL
    # was. Tests that need either opt in through `use_keys` or TestGateway.
    monkeypatch.setattr(settings, 'llm_base_url', '')
    monkeypatch.setattr(settings, 'gemini_api_keys', '')
    yield
    gemini_pool.reset()


def use_keys(monkeypatch, *keys):
    monkeypatch.setattr(
        type(settings), 'gemini_reserve_key_list',
        property(lambda _self: list(keys)),
    )


def run(coro):
    return asyncio.run(coro)


class TestReserveKeyResolution:
    def test_no_reserve_keys_when_unset(self, monkeypatch):
        # Pinned rather than read from the ambient .env: once a developer
        # configures real reserve keys this assertion would fail locally while
        # still passing in CI, which has no .env at all.
        monkeypatch.setattr(settings, 'gemini_api_keys', '')
        assert settings.gemini_reserve_key_list == []

    def test_primary_and_duplicates_are_excluded(self, monkeypatch):
        monkeypatch.setattr(settings, 'gemini_api_key', 'primary')
        monkeypatch.setattr(settings, 'gemini_api_keys', ' reserve-a , primary,reserve-a, reserve-b ')
        assert settings.gemini_reserve_key_list == ['reserve-a', 'reserve-b']

    def test_blank_entries_are_ignored(self, monkeypatch):
        monkeypatch.setattr(settings, 'gemini_api_keys', ' , ,')
        assert settings.gemini_reserve_key_list == []


class TestSingleKeyBehaviourIsUnchanged:
    """With no reserves the control flow must match having no pool at all."""

    def test_success_returns_primary_result(self):
        assert run(gemini_pool.arun('primary', gemini_pool.CHAT,
                                    lambda client: _async(client))) == 'primary'

    def test_capacity_error_propagates_untouched(self):
        with pytest.raises(CapacityError):
            run(gemini_pool.arun('primary', gemini_pool.CHAT, _async_raise(CapacityError())))

    def test_sync_capacity_error_propagates_untouched(self):
        with pytest.raises(CapacityError):
            gemini_pool.run('primary', gemini_pool.EMBED, _raise(CapacityError()))

    def test_no_client_is_constructed(self, monkeypatch):
        def forbidden(_kind, _key):
            pytest.fail('a reserve client was built when no reserve key is configured')

        monkeypatch.setattr(gemini_pool, '_build', forbidden)
        assert run(gemini_pool.arun('primary', gemini_pool.CHAT,
                                    lambda client: _async(client))) == 'primary'


class TestRotation:
    def test_falls_through_to_a_reserve_key(self, monkeypatch):
        use_keys(monkeypatch, 'k2')
        seen = []

        async def call(client):
            seen.append(client)
            if client == 'primary':
                raise CapacityError()
            return 'answered'

        assert run(gemini_pool.arun('primary', gemini_pool.CHAT, call)) == 'answered'
        assert seen == ['primary', 'client:chat:k2']

    def test_tries_every_key_before_giving_up(self, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')
        seen = []

        async def call(client):
            seen.append(client)
            raise CapacityError()

        with pytest.raises(CapacityError):
            run(gemini_pool.arun('primary', gemini_pool.CHAT, call))
        assert seen == ['primary', 'client:chat:k2', 'client:chat:k3']

    def test_sync_path_rotates_too(self, monkeypatch):
        use_keys(monkeypatch, 'k2')
        seen = []

        def call(client):
            seen.append(client)
            if client == 'primary':
                raise CapacityError()
            return [0.0] * 768

        assert len(gemini_pool.run('primary', gemini_pool.EMBED, call)) == 768
        assert seen == ['primary', 'client:embed:k2']

    def test_non_capacity_errors_never_rotate(self, monkeypatch):
        """A bad prompt must fail once, not be replayed against every key."""
        use_keys(monkeypatch, 'k2', 'k3')
        seen = []

        async def call(client):
            seen.append(client)
            raise ValueError('malformed request')

        with pytest.raises(ValueError):
            run(gemini_pool.arun('primary', gemini_pool.CHAT, call))
        assert seen == ['primary']

    def test_a_reserve_failing_for_another_reason_stops_the_rotation(self, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')
        seen = []

        async def call(client):
            seen.append(client)
            if client == 'primary':
                raise CapacityError()
            raise PermissionError('invalid api key')

        with pytest.raises(PermissionError):
            run(gemini_pool.arun('primary', gemini_pool.CHAT, call))
        assert seen == ['primary', 'client:chat:k2']


class TestCooldown:
    def test_an_exhausted_key_is_demoted_not_dropped(self, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')

        async def exhaust_k2(client):
            if client in ('primary', 'client:chat:k2'):
                raise CapacityError()
            return 'from k3'

        assert run(gemini_pool.arun('primary', gemini_pool.CHAT, exhaust_k2)) == 'from k3'

        # k2 is now cooling, so k3 is offered first -- but k2 is still offered.
        order = [key for key, _client in gemini_pool.reserve_attempts(gemini_pool.CHAT)]
        assert order == ['k3', 'k2']

    def test_cooldown_expires(self, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')
        gemini_pool._mark_exhausted('k2')
        assert [k for k, _ in gemini_pool.reserve_attempts(gemini_pool.CHAT)] == ['k3', 'k2']

        monkeypatch.setattr(settings, 'gemini_key_cooldown_seconds', 0)
        gemini_pool._mark_exhausted('k2')
        assert [k for k, _ in gemini_pool.reserve_attempts(gemini_pool.CHAT)] == ['k2', 'k3']


class TestClientConstruction:
    def test_clients_are_cached_per_kind_and_key(self, monkeypatch):
        builds = []

        def counting(kind, key):
            builds.append((kind, key))
            return object()

        monkeypatch.setattr(gemini_pool, '_build', counting)
        use_keys(monkeypatch, 'k2')
        first = gemini_pool.reserve_attempts(gemini_pool.CHAT)[0][1]
        second = gemini_pool.reserve_attempts(gemini_pool.CHAT)[0][1]
        assert first is second
        assert builds == [(gemini_pool.CHAT, 'k2')]

        gemini_pool.reserve_attempts(gemini_pool.EMBED)
        assert builds == [(gemini_pool.CHAT, 'k2'), (gemini_pool.EMBED, 'k2')]

    def test_unknown_kind_is_rejected(self):
        with pytest.raises(ValueError, match='Unknown Gemini client kind'):
            REAL_BUILD('nonsense', 'k')


class TestGateway:
    """LLM_BASE_URL routes the chat kinds elsewhere; embeddings never move."""

    @pytest.fixture
    def routed(self, monkeypatch):
        monkeypatch.setattr(settings, 'llm_base_url', 'https://gateway.example/v1')
        monkeypatch.setattr(settings, 'llm_api_key', 'sk-test')

    def test_disabled_when_no_base_url_is_set(self):
        assert gemini_pool.gateway_enabled() is False

    def test_enabled_when_a_base_url_is_set(self, routed):
        assert gemini_pool.gateway_enabled() is True

    def test_whitespace_only_base_url_is_not_a_gateway(self, monkeypatch):
        monkeypatch.setattr(settings, 'llm_base_url', '   ')
        assert gemini_pool.gateway_enabled() is False

    GATEWAY = gemini_pool._GATEWAY_KEY

    @pytest.mark.parametrize('kind', [gemini_pool.CHAT, gemini_pool.EXTRACT, gemini_pool.VERDICT])
    def test_the_sentinel_builds_a_gateway_client(self, routed, kind):
        assert type(REAL_BUILD(kind, self.GATEWAY)).__name__ == 'ChatOpenAI'

    @pytest.mark.parametrize('kind', [gemini_pool.CHAT, gemini_pool.EXTRACT, gemini_pool.VERDICT])
    def test_a_real_key_still_builds_a_gemini_client(self, routed, kind):
        """Keying off `gateway_enabled()` instead of the sentinel made every
        reserve key build another gateway client, so the fallback could not
        fall back."""
        assert type(REAL_BUILD(kind, 'gemini-key')).__name__ == 'ChatGoogleGenerativeAI'

    def test_embeddings_are_never_routed(self, routed):
        """The pgvector column is vector(768) and match_chunks filters on the
        recorded embedding model, so routing embeddings returns zero results
        rather than degraded ones."""
        assert type(REAL_BUILD(gemini_pool.EMBED, 'k')).__name__ == 'GoogleGenerativeAIEmbeddings'

    def test_the_model_name_is_sent_unchanged(self, routed):
        """Only the route changes, so the paper's tables stay accurate."""
        assert REAL_BUILD(gemini_pool.CHAT, self.GATEWAY).model_name == settings.gemini_chat_model
        assert REAL_BUILD(
            gemini_pool.VERDICT, self.GATEWAY,
        ).model_name == settings.gemini_verdict_model

    def test_the_route_carries_a_reasoning_bound_and_its_own_ceiling(self, routed):
        """`thinking_level` cannot cross an OpenAI-compatible boundary.

        While it was simply dropped, nothing bounded reasoning on this route: a
        measured grounded call spent 1,918 of its 1,996 output tokens reasoning
        and returned a severed reply, where the same question answered
        completely in 943 tokens against Google. `reasoning_effort` is the
        equivalent control, and the raised ceiling is the headroom that keeps a
        harder question from being severed anyway.
        """
        client = REAL_BUILD(gemini_pool.CHAT, self.GATEWAY)
        assert client.reasoning_effort == settings.gemini_thinking_level
        assert client.max_tokens == settings.llm_gateway_max_output_tokens

    def test_the_direct_route_keeps_the_budget_it_was_evaluated_with(self, routed):
        """A formal Objective 2 run must use Google, on the exact budget the
        frozen pipeline was measured with. The gateway's larger ceiling is its
        own and must not leak onto it."""
        google = REAL_BUILD(gemini_pool.CHAT, 'gemini-key')
        assert google.max_output_tokens == settings.gemini_max_output_tokens
        assert google.max_output_tokens != settings.llm_gateway_max_output_tokens

    def test_the_reported_ceiling_is_the_one_that_applied(self, routed, monkeypatch):
        """A truncation warning names a ceiling; it must be the live one.

        Reading the direct route's budget on a gateway deployment understated it
        by 5,600 tokens and pointed a reader at the wrong setting.
        """
        assert gemini_pool.active_output_ceiling() == settings.llm_gateway_max_output_tokens
        monkeypatch.setattr(settings, 'llm_base_url', '')
        assert gemini_pool.active_output_ceiling() == settings.gemini_max_output_tokens

    def test_the_gateway_is_tried_first_then_google(self, routed, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')
        chain = gemini_pool.attempt_chain('primary-client', gemini_pool.CHAT)
        assert [label for label, _key, _client in chain] == [
            'gateway', 'primary', 'reserve', 'reserve',
        ]

    def test_embeddings_skip_the_gateway_hop_entirely(self, routed, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')
        chain = gemini_pool.attempt_chain('primary-client', gemini_pool.EMBED)
        assert [label for label, _key, _client in chain] == ['primary', 'reserve', 'reserve']

    def test_any_gateway_failure_falls_back_to_google(self, routed):
        """The gateway is optional infrastructure; Google is the contract. An
        unreachable host or a rejected credential must not fail the question."""
        seen = []

        async def call(client):
            seen.append(client)
            if client == GATEWAY_STUB:
                raise PermissionError('gateway rejected the credential')
            return 'answered by google'

        assert run(
            gemini_pool.arun('primary-client', gemini_pool.CHAT, call),
        ) == 'answered by google'
        assert seen == [GATEWAY_STUB, 'primary-client']

    def test_a_failed_gateway_is_skipped_on_the_next_request(self, routed):
        """Otherwise every question pays a failed gateway round trip. An
        unreachable host can hang until gemini_timeout_seconds, so retrying it
        per request would add a minute to each answer with Google right behind
        it."""
        async def failing(client):
            if client == GATEWAY_STUB:
                raise ConnectionError('gateway unreachable')
            return 'from google'

        assert run(gemini_pool.arun('primary-client', gemini_pool.CHAT, failing)) == 'from google'

        second = gemini_pool.attempt_chain('primary-client', gemini_pool.CHAT)
        assert [label for label, _k, _c in second] == ['primary'], (
            'the gateway should be skipped while cooling'
        )

    def test_the_gateway_is_retried_once_its_cooldown_expires(self, routed, monkeypatch):
        gemini_pool._mark_exhausted(gemini_pool._GATEWAY_KEY)
        assert [l for l, _k, _c in gemini_pool.attempt_chain('p', gemini_pool.CHAT)] == ['primary']

        monkeypatch.setattr(settings, 'gemini_key_cooldown_seconds', 0)
        gemini_pool._mark_exhausted(gemini_pool._GATEWAY_KEY)
        assert [l for l, _k, _c in gemini_pool.attempt_chain('p', gemini_pool.CHAT)] == [
            'gateway', 'primary',
        ]

    def test_a_google_hop_still_only_rotates_on_exhaustion(self, routed, monkeypatch):
        """Past the gateway the narrower rule holds: a malformed prompt fails
        once instead of being replayed against every key."""
        use_keys(monkeypatch, 'k2')
        seen = []

        async def call(client):
            seen.append(client)
            if client == GATEWAY_STUB:
                raise CapacityError()
            raise ValueError('malformed request')

        with pytest.raises(ValueError):
            run(gemini_pool.arun('primary-client', gemini_pool.CHAT, call))
        assert seen == [GATEWAY_STUB, 'primary-client']


def _async(value):
    async def produce():
        return value
    return produce()


def _async_raise(error):
    async def call(_client):
        raise error
    return call


def _raise(error):
    def call(_client):
        raise error
    return call
