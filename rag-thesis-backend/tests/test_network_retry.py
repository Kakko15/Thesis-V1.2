"""Transient network retry behavior for external read operations."""

import pytest

from services import network_retry


class WindowsWouldBlockError(OSError):
    winerror = 10035


def test_winerror_10035_recovers_without_exposing_failure(monkeypatch):
    calls = 0
    delays = []

    def operation():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise WindowsWouldBlockError('socket operation could not be completed immediately')
        return 'recovered'

    monkeypatch.setattr(network_retry.time, 'sleep', delays.append)
    assert network_retry.retry_transient(operation, label='test') == 'recovered'
    assert calls == 2
    assert delays == [0.25]


def test_non_transient_error_is_not_retried(monkeypatch):
    calls = 0
    monkeypatch.setattr(network_retry.time, 'sleep', lambda _delay: None)

    def operation():
        nonlocal calls
        calls += 1
        raise ValueError('invalid request')

    with pytest.raises(ValueError, match='invalid request'):
        network_retry.retry_transient(operation, label='test')
    assert calls == 1


def test_transient_error_is_bounded(monkeypatch):
    calls = 0
    monkeypatch.setattr(network_retry.time, 'sleep', lambda _delay: None)

    def operation():
        nonlocal calls
        calls += 1
        raise WindowsWouldBlockError('still unavailable')

    with pytest.raises(WindowsWouldBlockError):
        network_retry.retry_transient(operation, label='test', attempts=3)
    assert calls == 3
