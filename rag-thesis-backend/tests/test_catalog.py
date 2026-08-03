"""PI-04 normalized catalog and migration contract tests."""

import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from routers import catalog
from services.catalog import resolve_academic_selection


def public_request(path='/'):
    """slowapi's wrapper needs a real Request, so rate-limited handlers cannot
    be called with a stand-in object even after unwrapping the decorator."""
    return Request({
        'type': 'http', 'method': 'GET', 'path': path, 'headers': [],
        'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


class Result:
    def __init__(self, data): self.data = data


class Query:
    def __init__(self, rows):
        self.rows = list(rows)
        self.pending_update = None
    def select(self, _fields): return self
    def order(self, _field, **_kwargs): return self
    def eq(self, field, value):
        self.rows = [row for row in self.rows if row.get(field) == value]
        return self
    def limit(self, _count): return self
    def insert(self, value):
        inserted = {'id': f"new-{len(self.rows) + 1}", **value}
        self.rows.append(inserted)
        return Query([inserted])
    def update(self, values):
        self.pending_update = values
        return self
    def execute(self):
        if self.pending_update:
            for row in self.rows: row.update(self.pending_update)
        return Result(self.rows)


class Client:
    def __init__(self):
        self.rows = {
            'departments': [{'id': 'dept', 'code': 'CCSICT', 'name': 'CCSICT', 'active': True}],
            'programs': [
                {'id': 'bscs', 'code': 'BSCS', 'name': 'Computer Science', 'department_id': 'dept', 'active': True},
                {'id': 'bsit', 'code': 'BSIT', 'name': 'Information Technology', 'department_id': 'dept', 'active': True},
            ],
            'specializations': [
                {'id': 'dm', 'code': 'DM', 'name': 'Data Mining', 'program_id': 'bscs', 'active': True},
                {'id': 'wmad', 'code': 'WMAD', 'name': 'Web and Mobile Application Development', 'program_id': 'bsit', 'active': True},
            ],
        }
    def table(self, name): return Query(self.rows[name])


class PreMigrationClient(Client):
    def __init__(self):
        super().__init__()
        self.normalized_department_query = True
        self.rows['departments'][0] = {
            'id': 'dept', 'name': 'CCSICT', 'track_label': 'Track',
            'tracks': ['Web Development'], 'created_at': '2026-01-01',
        }

    def table(self, name):
        if name == 'departments' and self.normalized_department_query:
            self.normalized_department_query = False
            return MissingNormalizedSchemaQuery(self.rows[name])
        return Query(self.rows[name])


class MissingNormalizedSchemaQuery(Query):
    def execute(self):
        raise RuntimeError('normalized catalog schema is not installed')


def test_safe_legacy_track_is_translated_without_guessing():
    selected = resolve_academic_selection(
        Client(), department_name='CCSICT', program_id=None,
        specialization_id=None, legacy_track='Web Development', require_program=True,
    )
    assert (selected.program_id, selected.specialization_id) == ('bsit', 'wmad')
    assert selected.legacy_track == 'Web Development'
    assert selected.classification_status == 'classified'


def test_ambiguous_legacy_track_requires_review_for_privileged_upload():
    selected = resolve_academic_selection(
        Client(), department_name='CCSICT', program_id=None,
        specialization_id=None, legacy_track='Intelligent Systems', require_program=False,
    )
    assert selected.program_id is None
    assert selected.classification_status == 'needs_review'


def test_bscs_requires_specialization():
    with pytest.raises(HTTPException, match='requires a valid specialization'):
        resolve_academic_selection(
            Client(), department_name='CCSICT', program_id='bscs',
            specialization_id=None, legacy_track=None, require_program=True,
        )


def test_migration_is_additive_seeded_and_has_pre_activation_rollback():
    root = Path(__file__).resolve().parents[1]
    migration = (root / 'migrations/20260725_normalized_academic_catalog.sql').read_text(encoding='utf-8')
    rollback = (root / 'migrations/20260725_normalized_academic_catalog.rollback.sql').read_text(encoding='utf-8')
    assert 'create table if not exists public.programs' in migration.lower()
    assert all(code in migration for code in ['BSCS', 'BSIT', 'BSDSA', 'BSIS', 'BLIS', 'WMAD', 'NETSEC'])
    assert 'needs_review' in migration
    assert 'delete from' not in migration.lower()
    assert 'drop table if exists public.specializations' in rollback.lower()


def test_nested_catalog_contract_and_active_filter(monkeypatch):
    client = Client()
    client.rows['programs'].append({
        'id': 'archived', 'code': 'OLD', 'name': 'Old Program',
        'department_id': 'dept', 'active': False,
    })
    monkeypatch.setattr(catalog, 'sb', client)
    payload = inspect.unwrap(catalog.list_catalog)(public_request('/catalog/departments'))
    assert payload['contract_version'] == '2026-07-25'
    department = payload['departments'][0]
    assert [program['code'] for program in department['programs']] == ['BSCS', 'BSIT']
    assert department['tracks'] == ['Data Mining', 'Web and Mobile Application Development']
    assert inspect.unwrap(catalog.list_catalog_legacy)(public_request('/catalog/departments/legacy')) == payload['departments']


def test_catalog_falls_back_safely_before_normalized_migration(monkeypatch):
    monkeypatch.setattr(catalog, 'sb', PreMigrationClient())
    department = inspect.unwrap(catalog.list_catalog_legacy)(public_request('/catalog/departments/legacy'))[0]
    assert department['code'] == 'CCSICT'
    assert department['active'] is True
    assert department['programs'] == []
    assert department['tracks'] == ['Web Development']


# The routes now declare the injected superadmin with Annotated, so direct
# calls must supply it explicitly instead of relying on a Depends default.
_SUPERADMIN = SimpleNamespace(id='root')


def test_superadmin_catalog_create_update_and_archive_paths(monkeypatch):
    client = Client()
    monkeypatch.setattr(catalog, 'sb', client)
    program = catalog.create_program(SimpleNamespace(
        parent_id='dept', code='BLIS', name='Library and Information Science',
    ), _user=_SUPERADMIN)
    assert program['code'] == 'BLIS'
    updated = catalog.update_program('bscs', SimpleNamespace(
        model_dump=lambda **_kwargs: {'name': 'Computer Science and Data Mining'},
    ), _user=_SUPERADMIN)
    assert updated['name'] == 'Computer Science and Data Mining'
    specialization = catalog.create_specialization(SimpleNamespace(
        parent_id='bsit', code='NETSEC', name='Network and Security',
    ), _user=_SUPERADMIN)
    assert specialization['code'] == 'NETSEC'
    archived = catalog.update_specialization('dm', SimpleNamespace(
        model_dump=lambda **_kwargs: {'active': False},
    ), _user=_SUPERADMIN)
    assert archived['active'] is False


def test_catalog_rejects_missing_parents_and_entities(monkeypatch):
    client = Client()
    monkeypatch.setattr(catalog, 'sb', client)
    with pytest.raises(HTTPException, match='parent department'):
        catalog.create_program(
            SimpleNamespace(parent_id='missing', code='NEW', name='New'), _user=_SUPERADMIN,
        )
    with pytest.raises(HTTPException, match='Program not found'):
        catalog.update_program('missing', SimpleNamespace(
            model_dump=lambda **_kwargs: {'active': False},
        ), _user=_SUPERADMIN)
    with pytest.raises(HTTPException, match='parent program'):
        catalog.create_specialization(SimpleNamespace(
            parent_id='missing', code='NEW', name='New Specialization',
        ), _user=_SUPERADMIN)
    with pytest.raises(HTTPException, match='program field'):
        catalog.update_program(
            'bscs', SimpleNamespace(model_dump=lambda **_kwargs: {}), _user=_SUPERADMIN,
        )
    with pytest.raises(HTTPException, match='specialization field'):
        catalog.update_specialization(
            'dm', SimpleNamespace(model_dump=lambda **_kwargs: {}), _user=_SUPERADMIN,
        )
