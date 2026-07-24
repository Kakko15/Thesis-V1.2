from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models import (
    DepartmentCreate, DepartmentUpdate, ProfileUpdate, RoleUpdate,
    SessionCreate, SessionUpdate, UserUpdate,
)
from routers import analytics, departments, maintenance, papers, sessions
from routers import settings as settings_router


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
        assert sessions.get_session_messages('s1', user) == [{'id': 'm1'}]

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
        assert departments.list_departments()[0]['name'] == 'CCSICT'
        assert departments.create_department(body, SimpleNamespace(id='root'))['name'] == 'CAS'
        updated = departments.update_department('d', DepartmentUpdate(name='CAS2'), SimpleNamespace(id='root'))
        assert updated['name'] == 'CAS2'
        assert departments.delete_department('d', SimpleNamespace(id='root'))['message'].startswith('Department deleted')

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
        summary = analytics.public_summary()
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
                {
                    'id': 1,
                    'operation': 'delete_paper',
                    'resource_path': 'private.pdf',
                    'paper_id': 'p1',
                    'attempts': 0,
                    'status': 'pending',
                },
                [],
            ],
            'papers': [[]],
        })
        monkeypatch.setattr(maintenance, 'sb', client)
        monkeypatch.setattr(maintenance, 'log_activity', lambda *_args, **_kwargs: None)
        assert maintenance.list_pending_storage_cleanup(user)['tasks'][0]['id'] == 1
        assert maintenance.retry_storage_cleanup(1, user)['status'] == 'completed'
        assert client.bucket.removed == ['private.pdf']

    def test_cleanup_retry_failure_remains_pending(self, monkeypatch):
        user = SimpleNamespace(id='root')
        client = ScriptedClient({
            'storage_cleanup_queue': [{
                'id': 2,
                'operation': 'rollback_upload',
                'resource_path': 'orphan.pdf',
                'paper_id': None,
                'attempts': 1,
                'status': 'pending',
            }, []],
        })
        client.bucket.fail_remove = True
        monkeypatch.setattr(maintenance, 'sb', client)
        with pytest.raises(HTTPException) as caught:
            maintenance.retry_storage_cleanup(2, user)
        assert caught.value.status_code == 503
