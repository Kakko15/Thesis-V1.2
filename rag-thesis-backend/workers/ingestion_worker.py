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

from supabase import create_client

from config import settings
from services.ingestion import LeaseLostError, process_ingestion_job
from services.upload_queue import (
    claim_job,
    expire_terminal_jobs,
    fail_job,
    heartbeat_job,
    is_retryable_ingestion_error,
    process_one_cleanup,
    schedule_retry,
)

logger = logging.getLogger(__name__)


class LeaseHeartbeat:
    """Keep a claimed lease alive and expose authoritative stage updates."""

    def __init__(self, client, job_id: str, worker_id: str):
        self.client = client
        self.job_id = job_id
        self.worker_id = worker_id
        self.valid = True
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self.update

    def __exit__(self, _exc_type, _exc, _traceback):
        self._stop.set()
        self._thread.join(timeout=settings.ingestion_heartbeat_seconds + 1)

    def update(self, **updates) -> bool:
        if not self.valid:
            return False
        try:
            self.valid = heartbeat_job(
                self.client, self.job_id, self.worker_id,
                settings.ingestion_lease_seconds, **updates,
            )
        except Exception as error:
            logger.warning('Upload heartbeat failed for %s (%s)', self.job_id, type(error).__name__)
            self.valid = False
        return self.valid

    def _run(self):
        while not self._stop.wait(settings.ingestion_heartbeat_seconds):
            if not self.update():
                return


def _worker_id() -> str:
    return f'{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}'


def process_claimed_job(client, job: dict, worker_id: str) -> None:
    job_id = str(job['id'])
    try:
        with LeaseHeartbeat(client, job_id, worker_id) as heartbeat:
            process_ingestion_job(client, job, worker_id, heartbeat)
    except LeaseLostError:
        logger.warning('Stopped work on %s because its lease was lost', job_id)
    except Exception as error:
        logger.error('Durable ingestion job %s failed (%s)', job_id, type(error).__name__)
        attempts = int(job.get('attempt_count') or 1)
        max_attempts = int(job.get('max_attempts') or settings.ingestion_max_attempts)
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
    processed = 0
    logger.info('Durable ingestion worker started as %s', worker_id)
    while not stop_event.is_set():
        now = time.monotonic()
        if now >= maintenance_at:
            try:
                process_one_cleanup(client, worker_id)
                expire_terminal_jobs(client)
            except Exception as error:
                logger.warning('Ingestion maintenance failed (%s)', type(error).__name__)
            maintenance_at = now + settings.ingestion_maintenance_seconds
        try:
            job = claim_job(client, worker_id, settings.ingestion_lease_seconds)
        except Exception as error:
            logger.error('Could not claim an ingestion job (%s)', type(error).__name__)
            if once:
                return processed
            stop_event.wait(settings.ingestion_poll_seconds)
            continue
        if job:
            process_claimed_job(client, job, worker_id)
            processed += 1
        elif once:
            return processed
        else:
            stop_event.wait(settings.ingestion_poll_seconds)
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description='Run the durable thesis-ingestion worker')
    parser.add_argument('--once', action='store_true', help='Process at most one available job')
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    )
    stop_event = threading.Event()

    def stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    run_worker(once=args.once, stop_event=stop_event)


if __name__ == '__main__':
    main()
