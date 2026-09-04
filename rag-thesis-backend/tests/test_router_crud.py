import inspect
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from models import (
    DepartmentCreate, DepartmentUpdate, ProfileUpdate, RoleUpdate,
    SessionCreate, SessionUpdate, UserUpdate,
)
from routers import analytics, departments, maintenance, papers, sessions
from routers import settings as settings_router


def public_request(path='/'):
    """slowapi's wrapper needs a real Request, so rate-limited handlers cannot
    be called with a stand-in object even after unwrapping the decorator."""
    return Request({
        'type': 'http', 'method': 'GET', 'path': path, 'headers': [],
        'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


class Query:
    def __init__(self, result):
        self.result = result
        self.operations = []

    def _op(self, name, *args): self.operations.append((name, args)); return self
    def select(self, *args, **kwargs): return self._op('select', *args, kwargs)
    def eq(self, *args): return self._op('eq', *args)
    def neq(self, *args): return self._op('neq', *args)
    def in_(self, *args): return self._op('in', *args)
    def order(self, *args, **kwargs): return self._op('order', *args, kwargs)
    def limit(self, *args): return self._op('limit', *args)
    # The analytics aggregates page their reads, so the builder must accept a
    # range. This stub serves one page and reports no count, which exercises
    # _fetch_all's short-page fallback.
    def range(self, *args): return self._op('range', *args)
    def single(self): return self._op('single')
    def insert(self, *args): return self._op('insert', *args)
    def update(self, *args): return self._op('update', *args)
    def delete(self): return self._op('delete')
    def execute(self): return self.result


class Bucket:
    def __init__(self):
        self.removed = []
        self.fail_remove = False

    def remove(self, paths):
        if self.fail_remove:
            raise RuntimeError('storage unavailable')
        self.removed.extend(paths)


class Storage:
    def __init__(self, bucket): self.bucket = bucket
    def from_(self, _name): return self.bucket


class ScriptedClient:
    def __init__(self, responses):
        self.responses = {name: list(items) for name, items in responses.items()}
        self.queries = []
        self.bucket = Bucket()
        self.storage = Storage(self.bucket)

    def table(self, name):
        item = self.responses[name].pop(0)
        result = item if hasattr(item, 'data') else SimpleNamespace(data=item, count=None)
        query = Query(result)
        self.queries.append((name, query))
        return query


def result(data=None, count=None):
    return SimpleNamespace(data=data or [], count=count)


class UniqueViolation(Exception):
    """Shaped like the SDK's error: SQLSTATE on `code`, detail in the message."""
    code = '23505'


class DuplicateCodeClient:
    """ScriptedClient's Query can only return, so the constraint-violation path
    needs a client whose insert raises. Reads report the name as free, which is
    what makes the code collision the only reachable failure."""

    def __init__(self, error=None):
        self.error = error or UniqueViolation(
            'duplicate key value violates unique constraint "departments_code_uq"',
        )

    def table(self, _name):
        return self

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args):
        return self

    def insert(self, *_args):
        raise self.error

    def execute(self):
        return SimpleNamespace(data=[], count=None)


class TestSessions:
    def test_session_crud_and_owner_checks(self, monkeypatch):
        user = SimpleNamespace(id='u1')
        client = ScriptedClient({'chat_sessions': [
            [{'id': 's1'}], [{'id': 's2'}],
            [{'id': 's1'}], [{'id': 's1', 'title': 'Renamed'}],
            [{'id': 's1'}], [],
            [{'id': 's1'}],
        ], 'chat_messages': [[{'id': 'm1'}]]})
        monkeypatch.setattr(sessions, 'sb', client)
        monkeypatch.setattr(
            sessions,
            'get_user_scope',
            lambda _user_id: {'role': 'student', 'department': 'CCSICT'},
        )
        assert sessions.list_sessions(user) == [{'id': 's1'}]
        assert sessions.create_session(SessionCreate(title='New'), user)['id'] == 's2'
        assert sessions.update_session('s1', SessionUpdate(title='Renamed'), user)['title'] == 'Renamed'
        assert sessions.delete_session('s1', user) == {'deleted': True}
        # Saved rows are returned with the derived presentation hint; a stored
        # research answer carries no conversational notice type.
        assert sessions.get_session_messages('s1', user) == [{'id': 'm1', 'notice_type': None}]

    def test_missing_session_is_404(self, monkeypatch):
        monkeypatch.setattr(sessions, 'sb', ScriptedClient({'chat_sessions': [[]]}))
        with pytest.raises(HTTPException) as caught:
            sessions.delete_session('missing', SimpleNamespace(id='u1'))
        assert caught.value.status_code == 404


class TestDepartmentsAndSettings:
    def test_department_crud(self, monkeypatch):
        body = DepartmentCreate(name='CAS', track_label='Program', tracks=['Math'])
        client = ScriptedClient({'departments': [
            [{'id': 'c', 'name': 'CCSICT'}], [],
            [{'id': 'd', 'name': 'CAS', 'track_label': 'Program', 'tracks': ['Math']}],
            [{'id': 'd', 'name': 'CAS', 'track_label': 'Program', 'tracks': ['Math']}],
            [], [{'id': 'd', 'name': 'CAS2', 'track_label': 'Program', 'tracks': ['Math']}],
            [{'id': 'd', 'name': 'CAS2'}], [],
        ], 'profiles': [result(count=0)], 'papers': [result(count=0)],
            'scan_history': [result(count=0)], 'chat_sessions': [result(count=0)],
            'upload_jobs': [result(count=0)], 'activity_log': [result(count=0)]})
        monkeypatch.setattr(departments, 'sb', client)
        assert inspect.unwrap(departments.list_departments)(public_request('/departments/'))[0]['name'] == 'CCSICT'
        assert departments.create_department(body, SimpleNamespace(id='root'))['name'] == 'CAS'
        updated = departments.update_department('d', DepartmentUpdate(name='CAS2'), SimpleNamespace(id='root'))
        assert updated['name'] == 'CAS2'
        assert departments.delete_department('d', SimpleNamespace(id='root'))['message'].startswith('Department deleted')

    def _created_insert_payload(self, client):
        """The dict handed to `.insert()` on the departments table."""
        inserts = [
            args[0] for name, query in client.queries if name == 'departments'
            for operation, args in query.operations if operation == 'insert'
        ]
        assert len(inserts) == 1
        return inserts[0]

    def test_department_code_is_derived_from_the_name(self, monkeypatch):
        """`departments.code` is NOT NULL from 20260725 with no default, so an
        insert that omits it is a not-null violation surfaced as a 500."""
        client = ScriptedClient({'departments': [
            [], [{'id': 'd', 'name': 'CAS', 'code': 'CAS'}],
        ]})
        monkeypatch.setattr(departments, 'sb', client)
        created = departments.create_department(
            DepartmentCreate(name='CAS', track_label='Track', tracks=[]),
            SimpleNamespace(id='root'),
        )
        assert created['code'] == 'CAS'
        # Same formula as the migration's backfill, so an API-created row is
        # indistinguishable from one the migration would have produced.
        assert self._created_insert_payload(client)['code'] == 'CAS'

    def test_derived_code_strips_punctuation_and_uppercases(self, monkeypatch):
        client = ScriptedClient({'departments': [[], [{'id': 'd'}]]})
        monkeypatch.setattr(departments, 'sb', client)
        departments.create_department(
            DepartmentCreate(name='c-c s.i/c t', track_label='Track', tracks=[]),
            SimpleNamespace(id='root'),
        )
        assert self._created_insert_payload(client)['code'] == 'CCSICT'

    def test_explicit_department_code_wins_over_the_derived_one(self, monkeypatch):
        client = ScriptedClient({'departments': [[], [{'id': 'd'}]]})
        monkeypatch.setattr(departments, 'sb', client)
        departments.create_department(
            DepartmentCreate(name='College of Nursing', code='CON', track_label='Track', tracks=[]),
            SimpleNamespace(id='root'),
        )
        assert self._created_insert_payload(client)['code'] == 'CON'

    @pytest.mark.parametrize('name', ['---', '   .   '])
    def test_underivable_department_code_is_422(self, monkeypatch, name):
        monkeypatch.setattr(departments, 'sb', ScriptedClient({'departments': [[]]}))
        with pytest.raises(HTTPException) as caught:
            departments.create_department(
                DepartmentCreate(name=name, track_label='Track', tracks=[]),
                SimpleNamespace(id='root'),
            )
        assert caught.value.status_code == 422
        assert 'code' in caught.value.detail

    def test_overlong_derived_department_code_is_422(self, monkeypatch):
        monkeypatch.setattr(departments, 'sb', ScriptedClient({'departments': [[]]}))
        with pytest.raises(HTTPException) as caught:
            departments.create_department(
                DepartmentCreate(
                    name='College of Business, Accountancy and Public Administration',
                    track_label='Track', tracks=[],
                ),
                SimpleNamespace(id='root'),
            )
        assert caught.value.status_code == 422

    def test_duplicate_department_code_is_409_not_500(self, monkeypatch):
        """departments_code_uq is independent of the name check, so a code
        collision is reachable even when the requested name is free."""
        monkeypatch.setattr(departments, 'sb', DuplicateCodeClient())
        with pytest.raises(HTTPException) as caught:
            departments.create_department(
                DepartmentCreate(name='CAS', track_label='Track', tracks=[]),
                SimpleNamespace(id='root'),
            )
        assert caught.value.status_code == 409
        assert 'CAS' in caught.value.detail

    def test_unrelated_insert_failure_is_not_swallowed(self, monkeypatch):
        monkeypatch.setattr(departments, 'sb', DuplicateCodeClient(error=RuntimeError('connection reset')))
        with pytest.raises(RuntimeError):
            departments.create_department(
                DepartmentCreate(name='CAS', track_label='Track', tracks=[]),
                SimpleNamespace(id='root'),
            )

    def test_department_conflict_and_missing(self, monkeypatch):
        monkeypatch.setattr(departments, 'sb', ScriptedClient({'departments': [[{'id': 'd'}]]}))
        with pytest.raises(HTTPException) as duplicate:
            departments.create_department(DepartmentCreate(name='CAS', track_label='Track', tracks=[]), SimpleNamespace(id='root'))
        assert duplicate.value.status_code == 400
        monkeypatch.setattr(departments, 'sb', ScriptedClient({'departments': [[]]}))
        with pytest.raises(HTTPException) as missing:
            departments.update_department('x', DepartmentUpdate(name='CAS'), SimpleNamespace(id='root'))
        assert missing.value.status_code == 404

    def test_formal_department_cannot_be_renamed_or_deleted(self, monkeypatch):
        protected = {'id': 'c', 'name': 'CCSICT', 'track_label': 'Track', 'tracks': []}
        monkeypatch.setattr(departments, 'sb', ScriptedClient({
            'departments': [[protected], [protected]],
        }))
        with pytest.raises(HTTPException) as renamed:
            departments.update_department(
                'c', DepartmentUpdate(name='Other'), SimpleNamespace(id='root'),
            )
        assert renamed.value.status_code == 409
        with pytest.raises(HTTPException) as deleted:
            departments.delete_department('c', SimpleNamespace(id='root'))
        assert deleted.value.status_code == 409

    def test_referenced_department_cannot_be_deleted(self, monkeypatch):
        client = ScriptedClient({
            'departments': [[{'id': 'd', 'name': 'CAS'}]],
            'profiles': [result(count=1)],
            'papers': [result(count=0)],
            'scan_history': [result(count=0)],
            'chat_sessions': [result(count=0)],
            'upload_jobs': [result(count=0)],
            'activity_log': [result(count=0)],
        })
        monkeypatch.setattr(departments, 'sb', client)
        with pytest.raises(HTTPException) as referenced:
            departments.delete_department('d', SimpleNamespace(id='root'))
        assert referenced.value.status_code == 409

    def test_public_and_role_settings(self, monkeypatch):
        assert settings_router.get_public_settings()['evaluation_department'] == 'CCSICT'
        features = {
            'student': {
                'chat': True, 'archive': True, 'novelty': False, 'upload': False,
            },
            'faculty': {
                'chat': True, 'archive': True, 'novelty': True, 'upload': False,
            },
        }
        client = ScriptedClient({'system_settings': [[{'value': features}], [{'value': features}]]})
        monkeypatch.setattr(settings_router, 'sb', client)
        assert settings_router.get_features(SimpleNamespace(id='u1')) == features
        monkeypatch.setattr(settings_router, 'invalidate_features_cache', lambda: None)
        monkeypatch.setattr(settings_router, 'log_activity', lambda *_args, **_kwargs: None)
        assert settings_router.update_features(features, SimpleNamespace(id='root'))['features'] == features


class TestPapersAndAnalytics:
    def test_paper_listing_and_delete_cleanup(self, monkeypatch):
        user = SimpleNamespace(id='admin')
        client = ScriptedClient({'profiles': [
            [{'role': 'admin', 'department': 'CCSICT'}],
            [{'id': 'admin', 'full_name': 'Admin', 'email': 'a@x'}],
            [{'role': 'admin', 'department': 'CCSICT'}],
        ], 'papers': [
            [{'id': 'p1', 'uploaded_by': 'admin'}],
            [{'id': 'p1', 'title': 'T', 'storage_path': 'private.pdf', 'department': 'CCSICT'}],
            [],
            [],
        ]})
        monkeypatch.setattr(papers, 'sb', client)
        monkeypatch.setattr(papers, 'log_activity', lambda *_args, **_kwargs: None)
        listed = papers.list_papers(user=user)
        assert listed[0]['uploader_name'] == 'Admin'
        assert papers.delete_paper('p1', user) == {'deleted': 'p1'}
        assert client.bucket.removed == ['private.pdf']

    def test_paper_listing_falls_back_before_catalog_migration(self, monkeypatch):
        class MissingSchemaQuery(Query):
            def execute(self):
                raise RuntimeError('program_id does not exist')

        class PreMigrationClient:
            def __init__(self):
                self.paper_calls = 0

            def table(self, name):
                if name == 'profiles':
                    rows = ([{'role': 'admin', 'department': 'CCSICT'}]
                            if self.paper_calls == 0 else [{'id': 'admin', 'full_name': 'Admin'}])
                    return Query(SimpleNamespace(data=rows))
                self.paper_calls += 1
                if self.paper_calls == 1:
                    return MissingSchemaQuery(SimpleNamespace(data=[]))
                return Query(SimpleNamespace(data=[{
                    'id': 'legacy', 'title': 'Legacy thesis', 'uploaded_by': 'admin',
                    'department': 'CCSICT',
                }]))

        monkeypatch.setattr(papers, 'sb', PreMigrationClient())
        listed = papers.list_papers(user=SimpleNamespace(id='admin'))
        assert listed[0]['title'] == 'Legacy thesis'
        assert listed[0]['uploader_name'] == 'Admin'

    def test_storage_failure_keeps_paper_pending_and_retryable(self, monkeypatch):
        user = SimpleNamespace(id='admin')
        client = ScriptedClient({
            'profiles': [[{'role': 'admin', 'department': 'CCSICT'}]],
            'papers': [
                [{'id': 'p1', 'title': 'T', 'storage_path': 'private.pdf', 'department': 'CCSICT'}],
                [],
            ],
            'storage_cleanup_queue': [[]],
        })
        client.bucket.fail_remove = True
        monkeypatch.setattr(papers, 'sb', client)
        monkeypatch.setattr(papers, 'log_activity', lambda *_args, **_kwargs: None)
        with pytest.raises(HTTPException) as caught:
            papers.delete_paper('p1', user)
        assert caught.value.status_code == 503
        paper_queries = [query for table, query in client.queries if table == 'papers']
        assert ('update', ({'ingestion_status': 'deletion_pending'},)) in paper_queries[1].operations
        assert not any(name == 'delete' for query in paper_queries for name, _args in query.operations)

    def test_overview_aggregates_past_the_postgrest_row_cap(self, monkeypatch):
        """Totals and distributions must survive `db-max-rows`.

        PostgREST caps one response at the project's `db-max-rows` (1000 by
        default on Supabase). Every figure here was derived with `len()` or
        `Counter()` over a single unpaged read, so past that cap the dashboard
        reported numbers that were quietly wrong — sitting beside `count='exact'`
        figures that were right, with nothing distinguishing them.
        """
        requested_ranges = []

        class PagingQuery:
            def __init__(self, rows):
                self.rows, self.start, self.stop = rows, 0, None

            def select(self, *_args, **_kwargs): return self
            def eq(self, *_args): return self
            def limit(self, *_args): return self

            def range(self, start, end):
                # PostgREST honours at most db-max-rows per response, so a full
                # page is truncated here exactly as the real server would.
                self.start, self.stop = start, min(end + 1, start + 1000)
                requested_ranges.append((start, end))
                return self

            def execute(self):
                # db-max-rows applies to every response, ranged or not. Capping
                # the unranged case too is what makes this a real regression
                # test: an unpaged read sees 1000 of 2500 rows, exactly as it
                # would against the live server.
                page = (
                    self.rows[self.start:self.stop] if self.stop
                    else self.rows[:1000]
                )
                return SimpleNamespace(data=page, count=len(self.rows))

        class PagingClient:
            def __init__(self, tables): self.tables = tables
            def table(self, name): return PagingQuery(self.tables.get(name, []))

        papers = [
            {'id': f'p{i}', 'track': 'Data Mining' if i % 2 else 'Web Development',
             'year': 2024, 'chunk_count': 2, 'thesis_category': 'student'}
            for i in range(2500)
        ]
        monkeypatch.setattr(analytics, 'sb', PagingClient({
            'papers': papers,
            'profiles': [{'role': 'student'} for _ in range(1200)],
            'scan_history': [{'duplication_percentage': 60} for _ in range(1100)],
        }))
        monkeypatch.setattr(analytics, '_admin_scope', lambda _user: ('superadmin', None))

        overview = analytics.overview(SimpleNamespace(id='root'))

        # Exact totals, not a capped page length.
        assert overview['papers']['total'] == 2500
        assert overview['users']['total'] == 1200
        assert overview['usage']['novelty_scans'] == 1100
        # Distributions cover every row, not just the first page.
        assert sum(overview['papers']['per_track'].values()) == 2500
        assert overview['papers']['per_category'] == {'student': 2500}
        assert overview['papers']['total_chunks'] == 5000
        assert overview['usage']['flagged_scans'] == 1100
        # Three contiguous pages for 2500 papers, starting where the last ended.
        paper_ranges = requested_ranges[:3]
        assert [start for start, _end in paper_ranges] == [0, 1000, 2000]

    def test_public_summary_overview_and_profile(self, monkeypatch):
        client = ScriptedClient({
            'papers': [
                [{'id': 'p1', 'track': 'Data Mining', 'year': 2024}],
                [{'id': 'p1', 'track': 'Data Mining', 'year': 2024, 'chunk_count': 3}],
            ],
            'activity_log': [result(count=4), result(count=5)],
            'profiles': [
                [{'role': 'admin', 'department': 'CCSICT'}],
                [{'role': 'student'}, {'role': 'faculty'}],
                [{'id': 'u1', 'email': 'u@x', 'role': 'student'}],
                [{'id': 'u1', 'full_name': 'Updated'}],
            ],
            'scan_history': [[{'duplication_percentage': 60, 'created_at': 'now'}]],
            'chat_sessions': [result(count=2)],
        })
        monkeypatch.setattr(analytics, 'sb', client)
        summary = inspect.unwrap(analytics.public_summary)(public_request('/analytics/summary'))
        assert summary['total_papers'] == 1 and summary['year_range']['from'] == 2024
        overview = analytics.overview(SimpleNamespace(id='admin'))
        assert overview['papers']['total_chunks'] == 3
        assert overview['usage']['flagged_scans'] == 1
        assert analytics.my_profile(SimpleNamespace(id='u1', email='u@x'))['id'] == 'u1'
        updated = analytics.update_my_profile(ProfileUpdate(full_name='Updated'), SimpleNamespace(id='u1'))
        assert updated['full_name'] == 'Updated'

    def test_profile_read_falls_back_before_catalog_migration(self, monkeypatch):
        class MissingSchemaQuery(Query):
            def execute(self):
                raise RuntimeError('program_id does not exist')

        class PreMigrationClient:
            def __init__(self): self.calls = 0
            def table(self, _name):
                self.calls += 1
                if self.calls == 1:
                    return MissingSchemaQuery(SimpleNamespace(data=[]))
                return Query(SimpleNamespace(data=[{
                    'id': 'u1', 'email': 'u@x', 'role': 'student', 'department': 'CCSICT',
                }]))

        monkeypatch.setattr(analytics, 'sb', PreMigrationClient())
        profile = analytics.my_profile(SimpleNamespace(id='u1', email='u@x'))
        assert profile['id'] == 'u1'
        assert 'program_id' not in profile

    def test_count_failure_and_empty_profile_update(self, monkeypatch):
        class FailingClient:
            def table(self, _name): raise RuntimeError('offline')
        monkeypatch.setattr(analytics, 'sb', FailingClient())
        assert analytics._count('papers') == 0
        assert analytics.update_my_profile(ProfileUpdate(), SimpleNamespace(id='u1')) == {'status': 'no changes'}

    def test_profile_avatar_path_and_department_logs_are_server_validated(self, monkeypatch):
        user = SimpleNamespace(id='u1')
        with pytest.raises(HTTPException) as external_avatar:
            analytics.update_my_profile(
                ProfileUpdate(avatar_url='https://tracker.invalid/avatar.png'),
                user,
            )
        assert external_avatar.value.status_code == 422

        client = ScriptedClient({
            'profiles': [
                [{'id': 'u1', 'full_name': 'User', 'avatar_url': 'u1/avatar.png'}],
                [{'role': 'admin', 'department': 'CCSICT'}],
            ],
            'activity_log': [[{'id': 1, 'user_id': None, 'department': 'CCSICT'}]],
        })
        monkeypatch.setattr(analytics, 'sb', client)
        updated = analytics.update_my_profile(ProfileUpdate(avatar_url='u1/avatar.png'), user)
        assert updated['avatar_url'] == 'u1/avatar.png'
        logs = analytics.get_system_logs(user=user)
        assert logs[0]['department'] == 'CCSICT'
        activity_query = next(query for table, query in client.queries if table == 'activity_log')
        assert ('eq', ('department', 'CCSICT')) in activity_query.operations


class TestPublicSummaryDeclinesRatherThanInvents:
    """The landing strip states these four figures as fact to anonymous visitors.

    `StatsStrip` already has an honest rendering for an unreadable archive --
    four em dashes, a reconnect notice, its own retry -- and its own comment
    says it exists to distinguish that from a genuine zero. What it cannot
    render honestly is a fabricated 0 that looks measured. The unguarded reads
    produced both failure modes at once: a bare 500 out of the paged paper
    read, and a quiet, measured-looking 0 out of the sibling activity count.
    """

    class FailingAt:
        """A client whose reads work except for one named table."""

        def __init__(self, failing, responses):
            self.failing = failing
            self.inner = ScriptedClient(responses)

        def table(self, name):
            if name == self.failing:
                raise RuntimeError('PostgREST unavailable')
            return self.inner.table(name)

    @staticmethod
    def summary(monkeypatch, client):
        monkeypatch.setattr(analytics, 'sb', client)
        return inspect.unwrap(analytics.public_summary)(public_request('/analytics/summary'))

    @pytest.mark.parametrize('failing', ['papers', 'activity_log'])
    def test_either_unreadable_source_is_declined_as_503(self, monkeypatch, failing):
        client = self.FailingAt(failing, {
            'papers': [[{'id': 'p1', 'track': 'Data Mining', 'year': 2024}]],
            'activity_log': [result(count=4)],
        })
        with pytest.raises(HTTPException) as refused:
            self.summary(monkeypatch, client)
        assert refused.value.status_code == 503
        assert 'temporarily unavailable' in refused.value.detail

    def test_a_measured_zero_is_still_published(self, monkeypatch):
        """503 means "could not count", never "counted zero" -- an empty
        archive is a true statement this endpoint must still be able to make."""
        client = ScriptedClient({'papers': [[]], 'activity_log': [result(count=0)]})
        assert self.summary(monkeypatch, client) == {
            'total_papers': 0,
            'total_tracks': 0,
            'year_range': None,
            'total_queries': 0,
        }

    def test_the_admin_dashboard_keeps_its_tolerant_count(self, monkeypatch):
        """`overview` publishes a dozen independent figures side by side, where
        blanking the panel over one unreadable count is the worse trade. That
        contract stays -- only the single-figure callers changed."""
        def unavailable(*_args, **_kwargs):
            raise RuntimeError('PostgREST unavailable')

        monkeypatch.setattr(analytics, '_exact_count', unavailable)
        assert analytics._count('activity_log', action='chat_query') == 0


class TestAnalyticsAdministration:
    def test_admin_activity_and_user_lists_are_department_scoped(self, monkeypatch):
        admin = SimpleNamespace(id='admin')
        activity_client = ScriptedClient({
            'profiles': [[{'role': 'admin', 'department': 'CCSICT'}]],
            'activity_log': [[{'id': 'event-1', 'department': 'CCSICT'}]],
        })
        monkeypatch.setattr(analytics, 'sb', activity_client)
        assert analytics.recent_activity(limit=500, user=admin)[0]['id'] == 'event-1'
        activity_query = next(query for table, query in activity_client.queries if table == 'activity_log')
        assert ('eq', ('department', 'CCSICT')) in activity_query.operations
        assert ('limit', (100,)) in activity_query.operations

        users_client = ScriptedClient({'profiles': [
            [{'id': 'student', 'department': 'CCSICT'}],
            [{'role': 'admin', 'department': 'CCSICT'}],
        ]})
        monkeypatch.setattr(analytics, 'sb', users_client)
        assert analytics.list_users(admin)[0]['id'] == 'student'
        list_query = users_client.queries[0][1]
        assert ('eq', ('department', 'CCSICT')) in list_query.operations
        assert ('neq', ('role', 'superadmin')) in list_query.operations

        root_client = ScriptedClient({'profiles': [
            [{'id': 'root'}, {'id': 'student'}],
            [{'role': 'superadmin', 'department': None}],
        ]})
        monkeypatch.setattr(analytics, 'sb', root_client)
        assert len(analytics.list_users(SimpleNamespace(id='root'))) == 2
        assert not any(name in {'eq', 'neq'} for name, _args in root_client.queries[0][1].operations)

    def test_role_changes_enforce_scope_and_write_audit(self, monkeypatch):
        admin = SimpleNamespace(id='admin')
        events = []
        invalidated = []
        client = ScriptedClient({'profiles': [
            [{'role': 'admin', 'department': 'CCSICT'}],
            [{'id': 'u2', 'email': 'u2@isu.edu.ph', 'role': 'student', 'department': 'CCSICT'}],
            [],
        ]})
        monkeypatch.setattr(analytics, 'sb', client)
        monkeypatch.setattr(analytics, 'invalidate_role_cache', invalidated.append)
        monkeypatch.setattr(analytics, 'log_activity', lambda *args: events.append(args))
        updated = analytics.update_user_role(
            'u2', RoleUpdate(role='faculty', status='approved'), admin,
        )
        assert updated == {'id': 'u2', 'role': 'faculty', 'status': 'approved'}
        assert invalidated == ['u2'] and events[0][1] == 'role_change'

        with pytest.raises(HTTPException) as own_role:
            analytics.update_user_role('admin', RoleUpdate(role='faculty'), admin)
        assert own_role.value.status_code == 400

        missing_client = ScriptedClient({'profiles': [
            [{'role': 'admin', 'department': 'CCSICT'}], [],
        ]})
        monkeypatch.setattr(analytics, 'sb', missing_client)
        with pytest.raises(HTTPException) as missing:
            analytics.update_user_role('missing', RoleUpdate(role='student'), admin)
        assert missing.value.status_code == 404

        foreign_client = ScriptedClient({'profiles': [
            [{'role': 'admin', 'department': 'CCSICT'}],
            [{'id': 'u3', 'role': 'student', 'department': 'CAS'}],
        ]})
        monkeypatch.setattr(analytics, 'sb', foreign_client)
        with pytest.raises(HTTPException) as foreign:
            analytics.update_user_role('u3', RoleUpdate(role='faculty'), admin)
        assert foreign.value.status_code == 403

        privileged_client = ScriptedClient({'profiles': [
            [{'role': 'admin', 'department': 'CCSICT'}],
            [{'id': 'u4', 'role': 'student', 'department': 'CCSICT'}],
        ]})
        monkeypatch.setattr(analytics, 'sb', privileged_client)
        with pytest.raises(HTTPException) as privileged:
            analytics.update_user_role('u4', RoleUpdate(role='superadmin'), admin)
        assert privileged.value.status_code == 403

    def test_superadmin_user_delete_and_detail_update(self, monkeypatch):
        root = SimpleNamespace(id='root')
        invalidated = []
        events = []
        delete_client = ScriptedClient({'profiles': [
            [{'role': 'superadmin', 'department': None}],
            [{'department': 'CCSICT', 'role': 'student'}],
        ]})
        delete_client.auth = SimpleNamespace(
            admin=SimpleNamespace(delete_user=lambda user_id: user_id),
        )
        monkeypatch.setattr(analytics, 'sb', delete_client)
        monkeypatch.setattr(analytics, 'invalidate_role_cache', invalidated.append)
        monkeypatch.setattr(analytics, 'log_activity', lambda *args: events.append(args))
        assert analytics.delete_user('u2', root) == {'deleted': True}
        assert invalidated == ['u2'] and events[0][1] == 'user_delete'

        with pytest.raises(HTTPException) as own_account:
            analytics.delete_user('root', root)
        assert own_account.value.status_code == 400

        detail_client = ScriptedClient({
            'profiles': [
                [{'role': 'superadmin', 'department': None}],
                [{'department': 'CCSICT', 'role': 'student'}],
                [{'id': 'u2', 'email': 'u2@isu.edu.ph', 'full_name': 'Updated',
                  'role': 'faculty', 'department': 'CAS', 'status': 'approved'}],
            ],
            'departments': [[{'name': 'CAS'}]],
        })
        monkeypatch.setattr(analytics, 'sb', detail_client)
        updated = analytics.update_user_details(
            'u2',
            UserUpdate(full_name='Updated', role='faculty', department='CAS', status='approved'),
            root,
        )
        assert updated['department'] == 'CAS' and updated['role'] == 'faculty'

    def test_delete_blocked_by_dependent_records_is_a_conflict(self, monkeypatch):
        # A row that must be kept still references the account, so Postgres raises
        # 23503. That is a refusal, not a server fault: reporting 500 told the
        # administrator only that "something went wrong" with no way to act on it.
        root = SimpleNamespace(id='root')

        class ForeignKeyViolation(Exception):
            code = '23503'
            message = 'update or delete on table "users" violates foreign key constraint'

        blocked = ScriptedClient({'profiles': [
            [{'role': 'superadmin', 'department': None}],
            [{'department': 'CCSICT', 'role': 'student'}],
        ]})
        blocked.auth = SimpleNamespace(
            admin=SimpleNamespace(
                delete_user=lambda _user_id: (_ for _ in ()).throw(ForeignKeyViolation()),
            ),
        )
        monkeypatch.setattr(analytics, 'sb', blocked)
        # Neither side effect may run when the delete was refused.
        monkeypatch.setattr(analytics, 'invalidate_role_cache',
                            lambda *_a: pytest.fail('cache invalidated despite refusal'))
        monkeypatch.setattr(analytics, 'log_activity',
                            lambda *_a: pytest.fail('deletion logged despite refusal'))

        with pytest.raises(HTTPException) as conflict:
            analytics.delete_user('u2', root)
        assert conflict.value.status_code == 409
        assert 'referenced' in conflict.value.detail

    def test_reference_conflict_detection_shapes(self):
        # Supabase surfaces the driver error differently depending on where it is
        # raised, so the SQLSTATE has to be found on any of these shapes.
        assert analytics._is_reference_conflict(SimpleNamespace(code='23503'))
        assert analytics._is_reference_conflict(SimpleNamespace(pgcode='23503'))
        assert analytics._is_reference_conflict(RuntimeError('violates foreign key constraint'))
        assert analytics._is_reference_conflict(RuntimeError('SQLSTATE 23503'))
        # Unrelated failures must still be treated as faults, not refusals.
        assert not analytics._is_reference_conflict(RuntimeError('offline'))
        assert not analytics._is_reference_conflict(SimpleNamespace(code='23505'))

    def test_user_delete_failure_and_detail_guards_fail_closed(self, monkeypatch):
        root = SimpleNamespace(id='root')
        failing_client = ScriptedClient({'profiles': [
            [{'role': 'superadmin', 'department': None}],
            [{'department': 'CCSICT', 'role': 'student'}],
        ]})
        failing_client.auth = SimpleNamespace(
            admin=SimpleNamespace(delete_user=lambda _user_id: (_ for _ in ()).throw(RuntimeError('offline'))),
        )
        monkeypatch.setattr(analytics, 'sb', failing_client)
        with pytest.raises(HTTPException) as failed_delete:
            analytics.delete_user('u2', root)
        assert failed_delete.value.status_code == 500

        unknown_client = ScriptedClient({
            'profiles': [
                [{'role': 'superadmin', 'department': None}],
                [{'department': 'CCSICT', 'role': 'student'}],
            ],
            'departments': [[]],
        })
        monkeypatch.setattr(analytics, 'sb', unknown_client)
        with pytest.raises(HTTPException) as unknown_department:
            analytics.update_user_details(
                'u2', UserUpdate(full_name='User', role='student', department='Unknown'), root,
            )
        assert unknown_department.value.status_code == 422

        admin = SimpleNamespace(id='admin')
        foreign_client = ScriptedClient({'profiles': [
            [{'role': 'admin', 'department': 'CCSICT'}],
            [{'department': 'CAS', 'role': 'student'}],
        ]})
        monkeypatch.setattr(analytics, 'sb', foreign_client)
        with pytest.raises(HTTPException) as foreign:
            analytics.update_user_details(
                'u3', UserUpdate(full_name='User', role='student'), admin,
            )
        assert foreign.value.status_code == 403

    def test_system_logs_join_profiles_and_profile_failures_are_explicit(self, monkeypatch):
        root = SimpleNamespace(id='root')
        client = ScriptedClient({
            'profiles': [
                [{'role': 'superadmin', 'department': None}],
                [{'id': 'u2', 'email': 'u2@isu.edu.ph', 'full_name': 'User'}],
            ],
            'activity_log': [[
                {'id': 'e1', 'user_id': 'u2'},
                {'id': 'e2', 'user_id': None},
            ]],
        })
        monkeypatch.setattr(analytics, 'sb', client)
        logs = analytics.get_system_logs(limit=1, user=root)
        assert len(logs) == 1 and logs[0]['user']['email'] == 'u2@isu.edu.ph'

        missing_client = ScriptedClient({'profiles': [[]]})
        monkeypatch.setattr(analytics, 'sb', missing_client)
        with pytest.raises(HTTPException) as invalid_admin:
            analytics._admin_scope(root)
        assert invalid_admin.value.status_code == 403

        monkeypatch.setattr(analytics, 'sb', ScriptedClient({'profiles': [[]]}))
        with pytest.raises(HTTPException) as missing_profile:
            analytics.my_profile(SimpleNamespace(id='missing'))
        assert missing_profile.value.status_code == 404

        with pytest.raises(HTTPException) as empty_name:
            analytics.update_my_profile(ProfileUpdate(full_name='   '), root)
        assert empty_name.value.status_code == 422

    def test_normalized_profile_selection_is_server_resolved(self, monkeypatch):
        user = SimpleNamespace(id='u1')
        client = ScriptedClient({'profiles': [
            [{'role': 'student', 'department': 'CCSICT'}],
            [{'id': 'u1', 'program_id': 'program-bscs', 'specialization_id': 'specialization-dm'}],
        ]})
        monkeypatch.setattr(analytics, 'sb', client)
        monkeypatch.setattr(
            analytics,
            'resolve_academic_selection',
            lambda *_args, **_kwargs: SimpleNamespace(
                program_id='program-bscs', specialization_id='specialization-dm',
            ),
        )
        updated = analytics.update_my_profile(
            ProfileUpdate(program_id='program-bscs', specialization_id='specialization-dm'),
            user,
        )
        assert updated['specialization_id'] == 'specialization-dm'

        unavailable_client = ScriptedClient({'profiles': [
            [{'role': 'student', 'department': 'CCSICT'}],
        ]})
        monkeypatch.setattr(analytics, 'sb', unavailable_client)
        monkeypatch.setattr(
            analytics,
            'resolve_academic_selection',
            lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('migration pending')),
        )
        with pytest.raises(HTTPException) as unavailable:
            analytics.update_my_profile(ProfileUpdate(program_id='program-bscs'), user)
        assert unavailable.value.status_code == 503


class TestStorageCleanupMaintenance:
    def test_superadmin_can_list_and_complete_cleanup(self, monkeypatch):
        user = SimpleNamespace(id='root')
        client = ScriptedClient({
            'storage_cleanup_queue': [
                [{'id': 1, 'operation': 'delete_paper', 'attempts': 0}],
                [{
                    'id': 1,
                    'operation': 'delete_paper',
                    'resource_path': 'private.pdf',
                    'paper_id': 'p1',
                    'attempts': 0,
                    'status': 'pending',
                }],
                [],
            ],
            'papers': [[]],
        })
        monkeypatch.setattr(maintenance, 'sb', client)
        monkeypatch.setattr(maintenance, 'log_activity', lambda *_args, **_kwargs: None)
        assert maintenance.list_pending_storage_cleanup(user)['tasks'][0]['id'] == 1
        assert maintenance.retry_storage_cleanup(1, user)['status'] == 'completed'
        assert client.bucket.removed == ['private.pdf']

    def test_retrying_an_expunged_task_is_404_not_500(self, monkeypatch):
        """Finding 4: the route declares a 404 it could not emit. `.single()`
        made PostgREST reject the zero-row result and postgrest-py raise before
        the guard, so a superadmin retrying an expunged task got an unhandled
        500. The stub never emulated that, so the suite stayed green."""
        user = SimpleNamespace(id='root')
        client = ScriptedClient({'storage_cleanup_queue': [[]]})
        monkeypatch.setattr(maintenance, 'sb', client)
        with pytest.raises(HTTPException) as caught:
            maintenance.retry_storage_cleanup(999, user)
        assert caught.value.status_code == 404

    def test_cleanup_retry_failure_remains_pending(self, monkeypatch):
        user = SimpleNamespace(id='root')
        client = ScriptedClient({
            'storage_cleanup_queue': [[{
                'id': 2,
                'operation': 'rollback_upload',
                'resource_path': 'orphan.pdf',
                'paper_id': None,
                'attempts': 1,
                'status': 'pending',
            }], []],
        })
        client.bucket.fail_remove = True
        monkeypatch.setattr(maintenance, 'sb', client)
        with pytest.raises(HTTPException) as caught:
            maintenance.retry_storage_cleanup(2, user)
        assert caught.value.status_code == 503
