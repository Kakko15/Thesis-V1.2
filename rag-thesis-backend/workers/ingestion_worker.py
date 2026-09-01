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


def run_worker(*, once: bool = False, stop_event: threading.Event | None = None,
               client=None) -> int:
    client = client or create_client(settings.supabase_url, settings.supabase_key)
    stop_event = stop_event or threading.Event()
    worker_id = _worker_id()
    maintenance_at = 0.0
    registry_at = 0.0
    scan_state = 'unknown'
    processed = 0
    logger.info('Durable ingestion worker started as %s', worker_id)
    try:
        while not stop_event.is_set():
            now = time.monotonic()
            if now >= registry_at:
                scan_state = scanner_status()
                try:
                    register_worker(
                        client, worker_id,
                        state='degraded' if scan_state == 'unavailable' else 'idle',
                        scanner=scan_state,
                    )
                except Exception as error:
                    logger.warning('Worker registry heartbeat failed (%s)', type(error).__name__)
                registry_at = now + settings.ingestion_heartbeat_seconds
            if now >= maintenance_at:
                try:
                    process_one_cleanup(client, worker_id)
                    expire_terminal_jobs(client)
                    if settings.operations_monitor_enabled:
                        evaluate_operations(client)
                except Exception as error:
                    logger.warning('Ingestion maintenance failed (%s)', type(error).__name__)
                maintenance_at = now + settings.ingestion_maintenance_seconds
            if scan_state == 'unavailable':
                if once:
                    return processed
                stop_event.wait(settings.ingestion_poll_seconds)
                continue
            try:
                job = claim_job(client, worker_id, settings.ingestion_lease_seconds)
            except Exception as error:
                logger.exception('Could not claim an ingestion job (%s)', type(error).__name__)
                if once:
                    return processed
                stop_event.wait(settings.ingestion_poll_seconds)
                continue
            if job:
                try:
                    register_worker(
                        client, worker_id, state='processing', scanner=scan_state,
                        current_job_id=str(job['id']),
                    )
                except Exception as error:
                    logger.warning('Worker registry update failed (%s)', type(error).__name__)
                process_claimed_job(client, job, worker_id, scan_state)
                processed += 1
                registry_at = 0.0
            elif once:
                return processed
            else:
                stop_event.wait(settings.ingestion_poll_seconds)
        return processed
    finally:
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
