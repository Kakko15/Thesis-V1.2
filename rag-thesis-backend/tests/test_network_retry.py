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


def test_http2_remote_protocol_stream_reset_is_retried(monkeypatch):
    class RemoteProtocolError(Exception):
        pass

    calls = 0
    delays = []

    def operation():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RemoteProtocolError('<StreamReset stream_id:1, error_code:1, remote_reset:True>')
        return 'ok'

    monkeypatch.setattr(network_retry.time, 'sleep', delays.append)
    assert network_retry.retry_transient(operation, label='test') == 'ok'
    assert calls == 2
    assert delays == [0.25]


def test_real_httpx_transport_errors_are_transient():
    import httpx

    assert network_retry.is_transient_network_error(
        httpx.RemoteProtocolError('<StreamReset stream_id:1, error_code:1, remote_reset:True>'),
    )
    assert network_retry.is_transient_network_error(httpx.ReadError('connection lost'))


def test_same_named_errors_from_non_network_modules_are_not_transient():
    import tarfile

    assert not network_retry.is_transient_network_error(tarfile.ReadError('bad tar header'))
