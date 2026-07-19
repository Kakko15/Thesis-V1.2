from types import SimpleNamespace

from services import activity


class Query:
    def __init__(self, data=None, capture=None):
        self.data = data or []
        self.capture = capture

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def limit(self, *_args): return self

    def insert(self, payload):
        self.capture.append(payload)
        return self

    def execute(self): return SimpleNamespace(data=self.data)


class Client:
    def __init__(self):
        self.rows = []

    def table(self, name):
        if name == 'profiles':
            return Query([{'department': 'CCSICT'}])
        return Query(capture=self.rows)


def test_activity_derives_department_without_leaking_primary_failures(monkeypatch):
    client = Client()
    monkeypatch.setattr(activity, 'sb', client)
    activity.log_activity('u1', 'chat_query', {'question_length': 12})
    assert client.rows == [{
        'user_id': 'u1',
        'action': 'chat_query',
        'department': 'CCSICT',
        'detail': {'question_length': 12},
    }]


def test_activity_failure_is_non_fatal(monkeypatch):
    class FailingClient:
        def table(self, _name): raise RuntimeError('offline')

    monkeypatch.setattr(activity, 'sb', FailingClient())
    assert activity.log_activity('u1', 'chat_query') is None
