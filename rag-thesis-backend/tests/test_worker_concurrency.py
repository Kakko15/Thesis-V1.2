"""INGESTION_CONCURRENCY: the worker runs several claimed jobs at once.

At the default of 1 the loop must be byte-for-byte the evaluated behaviour:
one claim, one job, processed inline on the calling thread, no pool. Above 1,
claimed jobs run on a thread pool bounded by the setting, and shutdown drains
every in-flight job so no lease is stranded.
"""

import threading
import time

import pytest
from pydantic import ValidationError

from config import Settings
from workers import ingestion_worker


def _quiet_worker(monkeypatch, calls, scanner='healthy'):
    monkeypatch.setattr(ingestion_worker, 'scanner_status', lambda: scanner)
    monkeypatch.setattr(
        ingestion_worker, 'register_worker',
        lambda *_args, **kwargs: calls.append(('registry', kwargs.get('state'), kwargs.get('current_job_id'))),
    )
    monkeypatch.setattr(ingestion_worker, 'process_one_cleanup', lambda *_args: None)
    monkeypatch.setattr(ingestion_worker, 'expire_terminal_jobs', lambda *_args: None)
    monkeypatch.setattr(ingestion_worker, 'stop_worker', lambda *_args: calls.append(('stopped', None, None)))
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_poll_seconds', 0.2)


def _claims(job_ids):
    jobs = iter([{'id': job_id} for job_id in job_ids])
    return lambda *_args: next(jobs, None)


def _watchdog(stop_event, seconds=10.0):
    """A test that never sets stop_event must still end; the assertion then fails loudly."""
    timer = threading.Timer(seconds, stop_event.set)
    timer.daemon = True
    timer.start()
    return timer


def test_default_concurrency_processes_inline_with_no_pool(monkeypatch):
    calls = []
    _quiet_worker(monkeypatch, calls)
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_concurrency', 1)
    monkeypatch.setattr(
        ingestion_worker, 'ThreadPoolExecutor',
        lambda *_args, **_kwargs: pytest.fail('a pool was constructed at concurrency 1'),
    )
    threads = []
    monkeypatch.setattr(
        ingestion_worker, 'process_claimed_job',
        lambda *_args: threads.append(threading.current_thread()),
    )
    stop = threading.Event()
    _watchdog(stop)
    queue = iter([{'id': 'job-1'}])

    def claim(*_args):
        job = next(queue, None)
        if job is None:
            stop.set()  # the queue is empty: end the loop instead of idling
        return job

    monkeypatch.setattr(ingestion_worker, 'claim_job', claim)

    assert ingestion_worker.run_worker(stop_event=stop, client=object()) == 1
    assert threads == [threading.current_thread()]
    assert ('registry', 'processing', 'job-1') in calls
    assert calls[-1] == ('stopped', None, None)


def test_once_forces_serial_mode_regardless_of_the_setting(monkeypatch):
    calls = []
    _quiet_worker(monkeypatch, calls)
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_concurrency', 4)
    monkeypatch.setattr(ingestion_worker, 'claim_job', _claims(['job-1']))
    monkeypatch.setattr(
        ingestion_worker, 'ThreadPoolExecutor',
        lambda *_args, **_kwargs: pytest.fail('--once must never construct a pool'),
    )
    monkeypatch.setattr(ingestion_worker, 'process_claimed_job', lambda *_args: calls.append(('processed', None, None)))
    assert ingestion_worker.run_worker(once=True, client=object()) == 1
    assert ('processed', None, None) in calls and calls[-1] == ('stopped', None, None)


def test_pooled_worker_runs_claimed_jobs_at_the_same_time(monkeypatch):
    calls = []
    _quiet_worker(monkeypatch, calls)
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_concurrency', 3)
    monkeypatch.setattr(ingestion_worker, 'claim_job', _claims(['job-1', 'job-2', 'job-3']))
    stop = threading.Event()
    _watchdog(stop)
    # Three parties: the barrier only opens when all three jobs are running
    # simultaneously, which a serial loop can never satisfy.
    barrier = threading.Barrier(3, timeout=5)
    finished = []
    lock = threading.Lock()

    def process(_client, job, *_args):
        barrier.wait()
        with lock:
            finished.append(job['id'])
            if len(finished) == 3:
                stop.set()

    monkeypatch.setattr(ingestion_worker, 'process_claimed_job', process)

    assert ingestion_worker.run_worker(stop_event=stop, client=object()) == 3
    assert sorted(finished) == ['job-1', 'job-2', 'job-3']
    assert {entry for entry in calls if entry[1] == 'processing'} == {
        ('registry', 'processing', 'job-1'),
        ('registry', 'processing', 'job-2'),
        ('registry', 'processing', 'job-3'),
    }
    assert calls[-1] == ('stopped', None, None)


def test_pooled_worker_never_exceeds_the_configured_concurrency(monkeypatch):
    calls = []
    _quiet_worker(monkeypatch, calls)
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_concurrency', 2)
    job_ids = [f'job-{index}' for index in range(5)]
    monkeypatch.setattr(ingestion_worker, 'claim_job', _claims(job_ids))
    stop = threading.Event()
    _watchdog(stop)
    lock = threading.Lock()
    state = {'active': 0, 'peak': 0, 'done': 0}

    def process(*_args):
        with lock:
            state['active'] += 1
            state['peak'] = max(state['peak'], state['active'])
        time.sleep(0.2)
        with lock:
            state['active'] -= 1
            state['done'] += 1
            if state['done'] == len(job_ids):
                stop.set()

    monkeypatch.setattr(ingestion_worker, 'process_claimed_job', process)

    assert ingestion_worker.run_worker(stop_event=stop, client=object()) == 5
    assert state['peak'] == 2


def test_stop_drains_in_flight_jobs_before_the_registry_is_closed(monkeypatch):
    calls = []
    _quiet_worker(monkeypatch, calls)
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_concurrency', 2)
    monkeypatch.setattr(ingestion_worker, 'claim_job', _claims(['job-1', 'job-2']))
    stop = threading.Event()
    _watchdog(stop)
    entered = []
    lock = threading.Lock()
    release = threading.Event()

    def process(*_args):
        with lock:
            entered.append(True)
        release.wait(timeout=10)
        calls.append(('processed', None, None))

    monkeypatch.setattr(ingestion_worker, 'process_claimed_job', process)
    result = {}

    def run():
        result['processed'] = ingestion_worker.run_worker(stop_event=stop, client=object())

    runner = threading.Thread(target=run, daemon=True)
    runner.start()
    # Wait until both jobs hold a slot, ask the worker to stop, then let the
    # jobs finish: the worker must wait for them rather than abandon them.
    deadline = time.monotonic() + 5
    while len(entered) < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(entered) == 2, 'both jobs should hold a slot before the stop request'
    stop.set()
    time.sleep(0.3)
    assert runner.is_alive(), 'the worker exited while two jobs were still running'
    release.set()
    runner.join(timeout=5)

    assert result['processed'] == 2
    assert calls.count(('processed', None, None)) == 2
    assert calls[-1] == ('stopped', None, None)
    assert calls.index(('stopped', None, None)) > max(
        index for index, entry in enumerate(calls) if entry[0] == 'processed'
    )


def test_pooled_worker_waits_when_every_slot_is_busy(monkeypatch):
    """With all slots taken the loop must not keep claiming jobs it cannot run."""
    calls = []
    _quiet_worker(monkeypatch, calls)
    monkeypatch.setattr(ingestion_worker.settings, 'ingestion_concurrency', 2)
    stop = threading.Event()
    _watchdog(stop)
    release = threading.Event()
    claims = {'count': 0}
    queue = iter([{'id': 'job-1'}, {'id': 'job-2'}])

    def claim(*_args):
        claims['count'] += 1
        return next(queue, None)

    def process(*_args):
        release.wait(timeout=5)

    monkeypatch.setattr(ingestion_worker, 'claim_job', claim)
    monkeypatch.setattr(ingestion_worker, 'process_claimed_job', process)
    runner = threading.Thread(
        target=lambda: ingestion_worker.run_worker(stop_event=stop, client=object()), daemon=True,
    )
    runner.start()
    time.sleep(0.8)  # several poll intervals with both slots occupied
    claims_while_busy = claims['count']
    stop.set()
    release.set()
    runner.join(timeout=5)
    assert claims_while_busy == 2, 'the loop claimed while no slot was free'


@pytest.mark.parametrize('value', [0, 9])
def test_ingestion_concurrency_is_bounded(value):
    with pytest.raises(ValidationError):
        Settings(
            gemini_api_key='test', supabase_url='https://example.supabase.co',
            supabase_key='test', ingestion_concurrency=value,
        )


def test_max_batch_files_is_bounded():
    with pytest.raises(ValidationError):
        Settings(
            gemini_api_key='test', supabase_url='https://example.supabase.co',
            supabase_key='test', max_batch_files=0,
        )
    assert Settings(
        gemini_api_key='test', supabase_url='https://example.supabase.co',
        supabase_key='test',
    ).max_batch_files == 20
