"""Regression tests for B14 — system notices stored as if they were answers.

The defect: `chat()` persisted whatever `_chat_impl` returned. A capacity
apology, a guard refusal, or a no-relevant-thesis message therefore landed in
`chat_messages` as research output, and `_load_chat_history` replayed it to the
model as conversational context — giving the next question an apology to build
on and leaving a follow-up with no prior sources to anchor to.

The earlier partial fix recognized those rows by matching their text on load.
These tests pin the structural replacement: classification at the source, a
`kind` column, and a SQL-side filter — while keeping the notice visible in the
user's own transcript.
"""

import pathlib
import re

import pytest

from models import ChatResponse, DuplicationAlert
from routers import chat, sessions
from services import chat_notices
from services.guards import REFUSAL_MESSAGE
from services.guest_budget import GUEST_BUDGET_MESSAGE

MIGRATION = (
    pathlib.Path(__file__).resolve().parent.parent
    / 'migrations' / '20260804_chat_message_kind.sql'
)
ROLLBACK = (
    pathlib.Path(__file__).resolve().parent.parent
    / 'migrations' / '20260804_chat_message_kind.rollback.sql'
)
SCHEMA = pathlib.Path(__file__).resolve().parent.parent / 'supabase_setup.sql'
NOTICE_BACKFILL = (
    pathlib.Path(__file__).resolve().parent.parent
    / 'migrations' / '20260825_notice_kind_greeting_and_fallback.sql'
)


class TestNoticesAreClassifiedAtTheSource:
    """Every notice the system can return must classify as one."""

    @pytest.mark.parametrize('answer', [
        chat_notices.CAPACITY_MESSAGE,
        REFUSAL_MESSAGE,
        GUEST_BUDGET_MESSAGE,
    ])
    def test_each_notice_constant_is_a_notice(self, answer):
        response = ChatResponse(answer=answer, sources=[])
        assert chat_notices.response_kind(response) == chat_notices.KIND_NOTICE

    def test_the_no_relevant_message_is_a_notice_for_every_department(self):
        for department in ('CCSICT', 'College of Engineering', None):
            message = chat.get_no_relevant_message(department)
            response = ChatResponse(answer=message, sources=[])
            assert chat_notices.response_kind(response) == chat_notices.KIND_NOTICE

    def test_the_no_relevant_flag_alone_marks_a_notice(self):
        """The post-generation path rewrites the answer but sets the flag, so the
        flag must be sufficient on its own."""
        response = ChatResponse(
            answer='Some other wording entirely.', sources=[], no_relevant_thesis=True,
        )
        assert chat_notices.response_kind(response) == chat_notices.KIND_NOTICE

    def test_a_real_answer_is_an_answer(self):
        response = ChatResponse(
            answer='Two studies examine attendance monitoring [1][2].',
            sources=[{'id': 'p1'}, {'id': 'p2'}],
        )
        assert chat_notices.response_kind(response) == chat_notices.KIND_ANSWER

    def test_an_answer_that_merely_mentions_a_notice_is_still_an_answer(self):
        """Exact equality, not a substring search: a genuine answer discussing
        usage limits must not be misfiled as a notice."""
        response = ChatResponse(
            answer=(
                'One study notes that IskAI has reached the research AI service '
                'usage limit during peak hours, per its evaluation chapter [1].'
            ),
            sources=[{'id': 'p1'}],
        )
        assert chat_notices.response_kind(response) == chat_notices.KIND_ANSWER

    def test_the_greeting_is_a_notice_not_an_answer(self):
        """The greeting answers without retrieval or generation and has no
        sources. Stored as an answer, the history loader replayed
        "AI: Hello! I'm IskAI..." to the model as context on the next turn."""
        from routers.chat import _conversation_response

        response = ChatResponse(answer=_conversation_response(), sources=[])
        assert chat_notices.response_kind(response) == chat_notices.KIND_NOTICE

    def test_the_grounded_fallback_is_a_notice_but_keeps_its_sources(self):
        """It reports that no direct answer could be verified, then points at
        the closest archived studies. Reclassified so it stops becoming model
        context — not flagged no_relevant_thesis, because retrieval did succeed
        and stripping the sources would remove the only thing it offers."""
        from routers.chat import _grounded_retrieval_fallback

        sources = [{'id': 'p1', 'title': 'A Study', 'citation_id': 1}]
        answer = _grounded_retrieval_fallback(sources, 'CCSICT')
        response = ChatResponse(answer=answer, sources=sources)
        assert chat_notices.response_kind(response) == chat_notices.KIND_NOTICE
        assert response.no_relevant_thesis is False
        assert response.sources == sources

    def test_the_classifier_covers_every_declared_marker(self):
        """Guard against a marker being added to NOTICE_MARKERS but not to
        response_kind, which would leave it filtered on read yet stored as an
        answer."""
        for marker in chat_notices.NOTICE_MARKERS:
            probe = marker if marker != chat_notices.NO_RELEVANT_PREFIX else (
                f'{marker} CCSICT archive for that query.'
            )
            response = ChatResponse(answer=probe, sources=[])
            assert chat_notices.response_kind(response) == chat_notices.KIND_NOTICE, marker


class TestThePersistedRowCarriesItsKind:
    class RecordingRpc:
        def __init__(self):
            self.payload = None

        def rpc(self, name, payload):
            assert name == 'save_chat_exchange'
            self.payload = payload
            return self

        def execute(self):
            return type('Result', (), {'data': 'session-1'})()

    def _persist(self, monkeypatch, response):
        from models import ChatRequest

        recorder = self.RecordingRpc()
        monkeypatch.setattr(chat, 'sb', recorder)
        chat._persist_chat_exchange(
            ChatRequest(question='Which theses cover attendance monitoring?'),
            response,
            type('User', (), {'id': 'user-1'})(),
            'CCSICT',
        )
        return recorder.payload

    def test_a_notice_is_stored_as_a_notice(self, monkeypatch):
        payload = self._persist(
            monkeypatch,
            ChatResponse(answer=chat_notices.CAPACITY_MESSAGE, sources=[]),
        )
        assert payload['p_kind'] == chat_notices.KIND_NOTICE

    def test_an_answer_is_stored_as_an_answer(self, monkeypatch):
        payload = self._persist(
            monkeypatch,
            ChatResponse(answer='Findings [1].', sources=[{'id': 'p1'}]),
        )
        assert payload['p_kind'] == chat_notices.KIND_ANSWER

    def test_a_notice_still_carries_its_duplication_alert(self, monkeypatch):
        """The no-relevant path can carry a flagged >=85% match (N7). Marking the
        row a notice must not discard the alert the user needs to see."""
        alert = DuplicationAlert(
            flagged=True, similarity=91.5, threshold=85.0,
            matched_paper={'title': 'Prior Study'},
        )
        payload = self._persist(
            monkeypatch,
            ChatResponse(
                answer=chat.get_no_relevant_message('CCSICT'),
                sources=[], no_relevant_thesis=True, duplication_alert=alert,
            ),
        )
        assert payload['p_kind'] == chat_notices.KIND_NOTICE
        assert payload['p_duplication_alert']['similarity'] == 91.5


class TestHistoryExcludesNoticesInSql:
    def test_the_loader_filters_on_kind(self):
        import inspect

        source = inspect.getsource(chat._load_chat_history)
        assert ".eq('kind', chat_notices.KIND_ANSWER)" in source

    def test_the_filter_is_applied_before_the_row_limit(self):
        """Filtering in Python after `.limit(5)` would return fewer usable
        exchanges whenever recent history contained notices."""
        import inspect

        source = inspect.getsource(chat._load_chat_history)
        kind_position = source.index("eq('kind'")
        limit_position = source.index('.limit(5)')
        assert kind_position < limit_position


class TestTheTranscriptStillShowsNotices:
    def test_the_message_listing_returns_the_kind(self):
        """The conversation happened. The user keeps seeing why their question
        could not be answered; the client is told which rows are notices."""
        assert 'kind' in sessions._MESSAGE_FIELDS.split(',')

    def test_the_listing_does_not_filter_notices_out(self):
        import inspect

        source = inspect.getsource(sessions.get_session_messages)
        assert 'kind' not in source.replace('_MESSAGE_FIELDS', '')


class TestTheTextMatcherSurvivesAsDefenceInDepth:
    """Rows written before the migration, or mis-stored, must still be excluded."""

    def test_every_notice_is_recognized_from_its_text(self):
        assert chat_notices.is_stored_non_answer(chat_notices.CAPACITY_MESSAGE)
        assert chat_notices.is_stored_non_answer(REFUSAL_MESSAGE)
        assert chat_notices.is_stored_non_answer(GUEST_BUDGET_MESSAGE)
        assert chat_notices.is_stored_non_answer(chat.get_no_relevant_message('CCSICT'))

    def test_a_real_answer_is_not_recognized_as_a_notice(self):
        assert not chat_notices.is_stored_non_answer(
            'Two studies examine attendance monitoring [1][2].'
        )

    def test_blank_text_is_not_a_notice(self):
        assert not chat_notices.is_stored_non_answer('')
        assert not chat_notices.is_stored_non_answer('   \n  ')


class TestTheMigrationMatchesTheApplication:
    """The backfill hard-codes notice text in SQL. If a message is reworded and
    the SQL is not, old rows silently stay misclassified."""

    @pytest.fixture(name='migration_sql')
    def migration_sql_fixture(self):
        return MIGRATION.read_text(encoding='utf-8')

    def test_the_backfill_matches_every_notice_the_code_can_produce(self, migration_sql):
        """Iterates NOTICE_MARKERS rather than a hard-coded list.

        The previous version named four markers explicitly, so when the greeting
        and the grounded-retrieval fallback were added to NOTICE_MARKERS this
        test kept passing while their pre-existing rows stayed `kind = 'answer'`
        in the database. Driving the loop from the constant means a new notice
        cannot be added without either extending a backfill or failing here.
        """
        # The backfill is spread over two additive migrations; a marker only has
        # to appear in one of them.
        normalized_sql = re.sub(
            r'\s+', ' ', migration_sql + '\n' + NOTICE_BACKFILL.read_text(encoding='utf-8'),
        )
        for marker in chat_notices.NOTICE_MARKERS:
            # SQL doubles embedded single quotes, so double them here too rather
            # than truncating the fragment at the first apostrophe.
            fragment = re.sub(r'\s+', ' ', marker)[:48].replace("'", "''")
            assert fragment in normalized_sql, marker

    def test_the_backfill_only_relabels_rows_it_has_not_already_seen(self, migration_sql):
        assert "set kind = 'notice'" in migration_sql
        assert "where kind = 'answer'" in migration_sql

    def test_the_kind_column_is_constrained_to_the_two_known_values(self, migration_sql):
        assert "check (kind in ('answer', 'notice'))" in migration_sql

    def test_the_old_rpc_signature_is_dropped(self, migration_sql):
        """PostgreSQL treats the 8-argument function as a separate overload, so
        leaving it in place would let a caller write an unmarked notice."""
        assert 'drop function if exists public.save_chat_exchange(' in migration_sql

    def test_the_rpc_rejects_an_unknown_kind(self, migration_sql):
        assert 'Unsupported chat message kind' in migration_sql

    def test_a_rollback_exists_and_restores_the_old_signature(self):
        rollback = ROLLBACK.read_text(encoding='utf-8')
        assert 'drop column if exists kind' in rollback
        assert 'create or replace function public.save_chat_exchange(' in rollback
        assert 'p_kind' not in rollback.split('create or replace function')[1].split('$$')[0]

    def test_the_base_schema_agrees_with_the_migration(self):
        schema = SCHEMA.read_text(encoding='utf-8')
        assert "kind text not null default 'answer'" in schema
        assert "check (kind in ('answer', 'notice'))" in schema
        assert 'p_kind text default' in schema
        # A fresh install must write the column, not just declare it.
        assert 'duplication_alert, kind' in schema
