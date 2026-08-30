"""Reserve-key rotation (services/gemini_pool.py)."""

import asyncio

import pytest

from config import settings
from services import gemini_pool

# Captured before the autouse fixture stubs it out, so the construction test
# below exercises the real factory rather than the stand-in.
REAL_BUILD = gemini_pool._build


class CapacityError(RuntimeError):
    """Shaped like a provider 429 so `is_capacity_error` recognizes it."""

    def __init__(self):
        super().__init__('429 RESOURCE_EXHAUSTED: quota exceeded')


@pytest.fixture(autouse=True)
def clean_pool(monkeypatch):
    gemini_pool.reset()
    # Never construct a real client: stand one in per (kind, key).
    monkeypatch.setattr(gemini_pool, '_build', lambda kind, key: f'client:{kind}:{key}')
    # Pin the Gemini-direct route. Without this every rotation assertion below
    # silently depends on the developer's .env: configuring LLM_BASE_URL routes
    # chat traffic to a gateway, reserve_attempts() correctly returns nothing
    # for those kinds, and seven tests turn red locally while CI -- which has no
    # .env at all -- stays green. TestGateway covers the routed path explicitly.
    monkeypatch.setattr(settings, 'llm_base_url', '')
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

    @pytest.mark.parametrize('kind', [gemini_pool.CHAT, gemini_pool.EXTRACT, gemini_pool.VERDICT])
    def test_chat_kinds_are_routed(self, routed, kind):
        assert type(REAL_BUILD(kind, 'unused')).__name__ == 'ChatOpenAI'

    def test_embeddings_are_never_routed(self, routed):
        """The pgvector column is vector(768) and match_chunks filters on the
        recorded embedding model, so routing embeddings returns zero results
        rather than degraded ones."""
        assert type(REAL_BUILD(gemini_pool.EMBED, 'k')).__name__ == 'GoogleGenerativeAIEmbeddings'

    def test_the_model_name_is_sent_unchanged(self, routed):
        """Only the route changes, so the paper's tables stay accurate."""
        assert REAL_BUILD(gemini_pool.CHAT, 'unused').model_name == settings.gemini_chat_model
        assert REAL_BUILD(gemini_pool.VERDICT, 'unused').model_name == settings.gemini_verdict_model

    def test_reserve_gemini_keys_are_skipped_for_routed_kinds(self, routed, monkeypatch):
        """The gateway authenticates itself, so Gemini reserves cannot help."""
        use_keys(monkeypatch, 'k2', 'k3')
        assert gemini_pool.reserve_attempts(gemini_pool.CHAT) == []

    def test_embeddings_still_get_the_reserve_pool(self, routed, monkeypatch):
        use_keys(monkeypatch, 'k2', 'k3')
        assert [k for k, _ in gemini_pool.reserve_attempts(gemini_pool.EMBED)] == ['k2', 'k3']


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
