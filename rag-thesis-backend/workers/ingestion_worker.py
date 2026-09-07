"""Separate durable ingestion worker.

Run with: python -m workers.ingestion_worker
"""

import argparse
import logging
import os
import signal
import socket
import threading
import time
import uuid
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait

from warning_filters import silence_known_third_party_warnings

# Must run before the first `langchain*` import below.
silence_known_third_party_warnings()

# The filter call above has to precede these imports, so the first-party
# import that provides it cannot sit in its usual place.
# pylint: disable=wrong-import-order
from supabase import create_client
# pylint: enable=wrong-import-order

from config import settings
from services.ingestion import (
    LeaseLostError,
    MalwareDetectedIngestionError,
    process_ingestion_job,
)
from services.malware import scanner_status
from services.operations import (
    evaluate_operations,
    register_worker,
    stop_worker,
    upsert_alert,
    notify_webhook,
)
from services.safe_logging import configure_safe_logging
from services.upload_queue import (
    claim_job,
    expire_terminal_jobs,
    fail_job,
    finalize_cancellation,
    heartbeat_job_control,
    is_retryable_ingestion_error,
    process_one_cleanup,
    schedule_retry,
)

logger = logging.getLogger(__name__)


class CancellationRequested(RuntimeError):
    """Internal control signal raised only at safe ingestion checkpoints."""


class LeaseHeartbeat:  # pylint: disable=too-many-instance-attributes
    """Keep a claimed lease alive and expose authoritative stage updates.

    Two threads drive this: the pipeline thread reports real stage transitions,
    and a background thread keeps the lease alive between them. Both used to
    read and write `valid`/`cancel_requested` unsynchronized and could issue
    overlapping control RPCs, so depending on arrival order at PostgreSQL a job
    row could end up with a stale stage — the admin's progress bar jumping
    backwards — or a transient background failure could clear `valid` mid-check
    on the pipeline thread and abort a healthy job with LeaseLostError.

    The mutable state is now guarded by a lock, and the background thread sends
    a bare keep-alive that never carries a stage, progress, or message.

    The nine attributes are three cohesive groups — job identity, lease state
    with the lock guarding it, and the background thread with the lock
    serializing its control RPCs. Splitting the class would separate a lock
    from the state it protects, so the count is deliberate. The two locks stay
    distinct on purpose: sharing one would hold it across a network round trip
    and make reading `valid` block for the length of an RPC.
    """

    def __init__(self, client, job_id: str, worker_id: str, scanner: str = 'healthy'):
        self.client = client
        self.job_id = job_id
        self.worker_id = worker_id
        self._state_lock = threading.Lock()
        self._valid = True
        self._cancel_requested = False
        # Only one control RPC may be in flight, so a keep-alive cannot land
        # out of order against a real stage update.
        self._rpc_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(scanner,), daemon=True)

    # Preserved as attributes so existing callers and tests keep reading them.
    @property
    def valid(self) -> bool:
        with self._state_lock:
            return self._valid

    @valid.setter
    def valid(self, value: bool) -> None:
        with self._state_lock:
            self._valid = bool(value)

    @property
    def cancel_requested(self) -> bool:
        with self._state_lock:
            return self._cancel_requested

    @cancel_requested.setter
    def cancel_requested(self, value: bool) -> None:
        with self._state_lock:
            self._cancel_requested = bool(value)

    def __enter__(self):
        self._thread.start()
        return self.update

    def __exit__(self, _exc_type, _exc, _traceback):
        self._stop.set()
        self._thread.join(timeout=settings.ingestion_heartbeat_seconds + 1)

    def update(self, **updates) -> bool:
        with self._state_lock:
            if self._cancel_requested:
                raise CancellationRequested('Upload cancellation was requested')
            if not self._valid:
                return False
        try:
            with self._rpc_lock:
                control = heartbeat_job_control(
                    self.client, self.job_id, self.worker_id,
                    settings.ingestion_lease_seconds, **updates,
                )
            with self._state_lock:
                self._valid = bool(control.get('lease_valid'))
                self._cancel_requested = bool(control.get('cancel_requested'))
                valid, cancelled = self._valid, self._cancel_requested
        except Exception as error:
            logger.warning('Upload heartbeat failed for %s (%s)', self.job_id, type(error).__name__)
            with self._state_lock:
                self._valid = False
            return False
        if cancelled:
            raise CancellationRequested('Upload cancellation was requested')
        return valid

    def _run(self, scanner: str):
        while not self._stop.wait(settings.ingestion_heartbeat_seconds):
            try:
                # A bare keep-alive: passing no stage, progress, or message means
                # this thread can never overwrite what the pipeline reported.
                if not self.update():
                    return
                register_worker(
                    self.client, self.worker_id, state='processing',
                    scanner=scanner, current_job_id=self.job_id,
                )
            except CancellationRequested:
                return
            except Exception as error:
                logger.warning(
                    'Worker registry heartbeat failed while processing (%s)',
                    type(error).__name__,
                )


def _worker_id() -> str:
    return f'{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}'


def process_claimed_job(client, job: dict, worker_id: str,
                        scanner: str = 'healthy') -> None:
    job_id = str(job['id'])
    try:
        with LeaseHeartbeat(client, job_id, worker_id, scanner) as heartbeat:
            process_ingestion_job(client, job, worker_id, heartbeat)
    except CancellationRequested:
        if finalize_cancellation(client, job_id, worker_id):
            logger.info('Cancelled durable ingestion job %s at a safe checkpoint', job_id)
        else:
            logger.warning('Cancellation could not finalize because job %s lost its lease', job_id)
    except LeaseLostError:
        logger.warning('Stopped work on %s because its lease was lost', job_id)
    except Exception as error:
        logger.exception('Durable ingestion job %s failed (%s)', job_id, type(error).__name__)
        attempts = int(job.get('attempt_count') or 1)
        max_attempts = int(job.get('max_attempts') or settings.ingestion_max_attempts)
        if isinstance(error, MalwareDetectedIngestionError):
            try:
                alert = upsert_alert(
                    client, f'malware:{job_id}', 'malware_detected', 'critical',
                    {'job_id': job_id, 'action': 'rejected_and_cleanup_queued'},
                )
                if alert:
                    notify_webhook(client, alert)
            except Exception as alert_error:
                logger.warning('Malware alert persistence failed (%s)', type(alert_error).__name__)
        if attempts < max_attempts and is_retryable_ingestion_error(error):
            if not schedule_retry(client, job, worker_id, error):
                logger.warning('Retry was not scheduled because job %s no longer owns its lease', job_id)
        elif not fail_job(client, job_id, worker_id, error):
            logger.warning('Failure was not recorded because job %s no longer owns its lease', job_id)


class _Housekeeping:
    """Registry heartbeat and maintenance timers shared by both worker modes.

    Extracted from the loop body so the inline (concurrency 1) and pooled paths
    run exactly the same cadence: registry state every heartbeat interval,
    cleanup, expiry, and the operations monitor every maintenance interval.
    """

    def __init__(self, client, worker_id: str):
        self.client = client
        self.worker_id = worker_id
        self.registry_at = 0.0
        self.maintenance_at = 0.0
        self.scan_state = 'unknown'

    def tick(self, current_job_id: str | None = None) -> None:
        now = time.monotonic()
        if now >= self.registry_at:
            self.scan_state = scanner_status()
            if current_job_id:
                state, extra = 'processing', {'current_job_id': current_job_id}
            else:
                state, extra = ('degraded' if self.scan_state == 'unavailable' else 'idle'), {}
            try:
                register_worker(self.client, self.worker_id, state=state, scanner=self.scan_state, **extra)
            except Exception as error:
                logger.warning('Worker registry heartbeat failed (%s)', type(error).__name__)
            self.registry_at = now + settings.ingestion_heartbeat_seconds
        if now >= self.maintenance_at:
            try:
                process_one_cleanup(self.client, self.worker_id)
                expire_terminal_jobs(self.client)
                if settings.operations_monitor_enabled:
                    evaluate_operations(self.client)
            except Exception as error:
                logger.warning('Ingestion maintenance failed (%s)', type(error).__name__)
            self.maintenance_at = now + settings.ingestion_maintenance_seconds

    def register_processing(self, job_id: str) -> None:
        try:
            register_worker(
                self.client, self.worker_id, state='processing', scanner=self.scan_state,
                current_job_id=job_id,
            )
        except Exception as error:
            logger.warning('Worker registry update failed (%s)', type(error).__name__)


def _drain(executor: ThreadPoolExecutor | None, in_flight: dict) -> int:
    """Let every submitted job finish and report how many were still pending.

    Each job owns a LeaseHeartbeat, so waiting here is safe for as long as the
    pipeline takes; abandoning the threads would strand leases that only expire
    after ingestion_lease_seconds and would re-run the job elsewhere.
    """
    if executor is None:
        return 0
    if in_flight:
        logger.info('Draining %d in-flight ingestion job(s) before shutdown', len(in_flight))
    executor.shutdown(wait=True)
    return len(in_flight)


def run_worker(*, once: bool = False, stop_event: threading.Event | None = None,
               client=None) -> int:
    client = client or create_client(settings.supabase_url, settings.supabase_key)
    stop_event = stop_event or threading.Event()
    worker_id = _worker_id()
    house = _Housekeeping(client, worker_id)
    # `--once` processes a single job inline whatever the setting, so the smoke
    # path and the tests keep one deterministic shape. Above 1, claimed jobs run
    # on a pool: claim_upload_job's `for update skip locked` and the per-job
    # lease already make concurrent claimers safe, and one worker_id may hold
    # several leases because lease_owner is recorded per job.
    concurrency = 1 if once else settings.ingestion_concurrency
    executor = (
        ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix='ingest')
        if concurrency > 1 else None
    )
    in_flight: dict[Future, str] = {}
    processed = 0
    poll = settings.ingestion_poll_seconds
    logger.info('Durable ingestion worker started as %s (concurrency %d)', worker_id, concurrency)
    try:
        while not stop_event.is_set():
            for future in [pending for pending in in_flight if pending.done()]:
                # process_claimed_job records every outcome itself and never
                # raises, so a finished future only needs counting.
                in_flight.pop(future)
                processed += 1
                house.registry_at = 0.0
            house.tick(next(iter(in_flight.values()), None))
            if house.scan_state == 'unavailable':
                if once:
                    return processed
                stop_event.wait(poll)
                continue
            if len(in_flight) >= concurrency:
                wait(in_flight, timeout=poll, return_when=FIRST_COMPLETED)
                continue
            try:
                job = claim_job(client, worker_id, settings.ingestion_lease_seconds)
            except Exception as error:
                logger.exception('Could not claim an ingestion job (%s)', type(error).__name__)
                if once:
                    return processed
                stop_event.wait(poll)
                continue
            if job:
                house.register_processing(str(job['id']))
                if executor is None:
                    process_claimed_job(client, job, worker_id, house.scan_state)
                    processed += 1
                    house.registry_at = 0.0
                else:
                    future = executor.submit(process_claimed_job, client, job, worker_id, house.scan_state)
                    in_flight[future] = str(job['id'])
            elif once:
                return processed
            elif in_flight:
                # Nothing claimable, but slots are working: wake on the first
                # finished job rather than sleeping a full poll interval.
                wait(in_flight, timeout=poll, return_when=FIRST_COMPLETED)
            else:
                stop_event.wait(poll)
        return processed + _drain(executor, in_flight)
    finally:
        if executor is not None:
            executor.shutdown(wait=True)
        try:
            stop_worker(client, worker_id)
        except Exception as error:
            logger.warning('Worker shutdown registry update failed (%s)', type(error).__name__)

def main() -> None:
    parser = argparse.ArgumentParser(description='Run the durable thesis-ingestion worker')
    parser.add_argument('--once', action='store_true', help='Process at most one available job')
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    )
    configure_safe_logging()
    stop_event = threading.Event()

    def stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    run_worker(once=args.once, stop_event=stop_event)


if __name__ == '__main__':
    main()
