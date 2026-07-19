from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models import DepartmentCreate, DepartmentUpdate, ProfileUpdate, SessionCreate, SessionUpdate
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
