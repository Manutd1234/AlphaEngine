"""
Asynchronous job queue for compute-heavy work (Module C's parameter sweeps).
============================================================================
A parameter sweep can take tens of seconds. Running it inside the request
handler would block the event loop that also carries the kill switch — the one
code path that must never queue behind a backtest. So sweeps are dispatched to
a worker pool and the caller gets a ``job_id`` immediately.

Two interchangeable backends behind one interface:

* ``in-process``  (default) — a bounded ``ThreadPoolExecutor``. Zero infra:
  clone, ``pip install``, run. NumPy/Numba release the GIL for the numeric
  inner loops, so thread-based parallelism is genuinely parallel here.
* ``celery``      — activated automatically when ``CELERY_BROKER_URL`` (or
  ``REDIS_URL``) is set. Same API, but work leaves the web process entirely and
  can be scaled horizontally. This is the production topology described in the
  blueprint; see ``celery_tasks.py`` and ``worker.py``.

The abstraction matters more than the broker: the API surface, gateway console
and independent notification bot never learn which one is running.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlsplit

from config import settings
from modules.backoff import Backoff
from modules.schemas import JobStatus

log = logging.getLogger("alphaengine.jobs")


# Kombu supports more transports than these, but returning an arbitrary URL
# scheme would turn malformed configuration such as ``secret:...`` into a log
# or API disclosure. Unknown transports are still observable as ``other``;
# credentials, hosts, ports, virtual hosts and query strings never are.
_KNOWN_BROKER_TRANSPORTS = {
    "amqp",
    "azurestoragequeues",
    "consul",
    "filesystem",
    "gcpubsub",
    "memory",
    "mongodb",
    "pyamqp",
    "redis",
    "rediss",
    "sentinel",
    "sqs",
    "sqlalchemy",
}


def broker_transport_identity(url: str | None = None) -> str | None:
    """Return a credential-free broker transport label.

    This is intentionally much narrower than a redacted URL. Even a redacted
    URL exposes deployment topology (host, port, database index and vhost),
    none of which an operator needs in the queue summary.
    """
    raw = settings.celery_broker_url if url is None else url
    if not raw:
        return None
    try:
        scheme = urlsplit(raw).scheme.lower()
    except ValueError:
        return "other"
    base = scheme.split("+", 1)[0]
    return base if base in _KNOWN_BROKER_TRANSPORTS else "other"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


#: Which job kinds may be retried, and how many attempts each gets.
#:
#: Opt-in by name, never a default, and each entry is a claim that running the
#: work twice is indistinguishable from running it once:
#:
#:   data.backfill — merges bars into the cache keyed by (symbol, interval, ts).
#:                   A repeated merge overwrites identical rows.
#:   data.replay   — re-runs one capability through the validated fetch path and
#:                   records a finding. A second finding is a second observation,
#:                   which is what the ledger is for. It costs a provider call,
#:                   which is why the count is 2 rather than 3.
#:   ml.fit        — reads bars and writes one run row. A retry writes a second
#:                   run, which is honest: two fits of the same spec on the same
#:                   data ARE two runs, and the seed and data_hash say so.
#:
#: Anything absent gets one attempt. `backtest` is deliberately absent: it
#: pushes a corpus card and a Telegram message on completion, and repeating
#: those is visible to a reader.
RETRYABLE: dict[str, int] = {
    "data.backfill": 3,
    "data.replay": 2,
    "ml.fit": 2,
}

RETRY_BASE_S = 2.0
RETRY_CEILING_S = 30.0


@dataclass
class JobRecord:
    job_id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    message: str = ""
    submitted_at: datetime = field(default_factory=_utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result: Any = None
    error: str | None = None
    backend: str = "in-process"
    meta: dict[str, Any] = field(default_factory=dict)
    #: Attempts made, including the one in flight. 1 for a job that has run once.
    attempt: int = 0
    #: When the next attempt is due, while one is pending. None at every other
    #: moment — a job that is running, finished or will not be retried has no
    #: next attempt, and a stale timestamp here would read as one that does.
    next_attempt_at: datetime | None = None
    #: Total attempts allowed. 1 means no retry, which is the default and the
    #: only safe assumption for work whose idempotence has not been argued.
    max_attempts: int = 1

    def to_status(self) -> JobStatus:
        return JobStatus(
            job_id=self.job_id,
            kind=self.kind,
            status=self.status,  # type: ignore[arg-type]
            progress=round(self.progress, 4),
            message=self.message,
            submitted_at=self.submitted_at,
            started_at=self.started_at,
            finished_at=self.finished_at,
            error=self.error,
            backend=self.backend,
        )


class JobQueue:
    def __init__(self, workers: int | None = None) -> None:
        self.workers = workers or settings.job_workers
        self._pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="alphaengine-job")
        self._jobs: dict[str, JobRecord] = {}
        self._celery_app = None
        self.backend = self._resolve_backend()
        self._on_complete: list[Callable[[JobRecord], Any]] = []

    # -- backend selection ------------------------------------------------ #
    def _resolve_backend(self) -> str:
        if not settings.celery_broker_url:
            return "in-process"
        try:
            from celery_tasks import celery_app  # type: ignore

            self._celery_app = celery_app
            log.info("job backend: celery (%s)", broker_transport_identity())
            return "celery"
        except Exception as exc:
            log.warning(
                "CELERY_BROKER_URL set but Celery unavailable (%s); using in-process pool",
                type(exc).__name__,
            )
            return "in-process"

    def on_complete(self, hook: Callable[[JobRecord], Any]) -> None:
        """Register a completion callback (used to push results to Telegram)."""
        if hook not in self._on_complete:
            self._on_complete.append(hook)

    # -- submission ------------------------------------------------------- #
    def submit(self, kind: str, fn: Callable[..., Any], *args, meta: dict | None = None, **kwargs) -> JobRecord:
        """Dispatch ``fn`` on a worker and return immediately.

        If ``fn`` declares a ``progress`` parameter the queue injects a callable
        so long-running work can report intermediate state; if it declares
        ``job_id`` it receives the queue's id, so anything the job persists is
        keyed the same way the caller polls it.
        """
        job_id = uuid.uuid4().hex[:12]
        record = JobRecord(
            job_id=job_id, kind=kind, backend=self.backend, meta=meta or {},
            max_attempts=RETRYABLE.get(kind, 1),
        )
        self._jobs[job_id] = record

        # Completion hooks are coroutines that must run on the gateway's loop.
        # Outside one (scripts, sync tests) the job still runs — only the
        # notification is skipped.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
            log.debug("no running event loop; completion hooks disabled for job %s", job_id)

        if self.backend == "celery" and self._celery_app is not None:
            self._submit_celery(record, kind, args, kwargs, loop)
        else:
            self._submit_local(record, fn, args, kwargs, loop)
        return record

    def _submit_local(self, record: JobRecord, fn, args, kwargs, loop) -> None:
        def progress(pct: float, message: str = "") -> None:
            record.progress = max(0.0, min(1.0, pct))
            if message:
                record.message = message

        # Inject the queue's identifiers so a local run records the same job_id
        # the caller polls — Celery gets this for free from `self.request.id`.
        injected = dict(kwargs)
        params = inspect.signature(fn).parameters
        if "progress" in params:
            injected["progress"] = progress
        if "job_id" in params:
            injected["job_id"] = record.job_id

        def runner() -> None:
            """Run, and retry only where repeating the work is safe.

            Retry is opt-in per kind via RETRYABLE, never a default. A job whose
            idempotence has not been argued gets one attempt: silently repeating
            work with side effects is a worse failure than not repeating it, and
            it is the kind that shows up as duplicated rows weeks later.

            The sleep is on the worker thread, which is where the delay belongs
            — a retry that returned to the pool would let a later job overtake
            an earlier one that is merely waiting.
            """
            backoff = Backoff(base_s=RETRY_BASE_S, ceiling_s=RETRY_CEILING_S)
            record.started_at = _utcnow()
            while True:
                record.attempt += 1
                record.status = "running"
                try:
                    record.result = fn(*args, **injected)
                    record.status = "succeeded"
                    record.next_attempt_at = None
                    record.progress = 1.0
                    record.error = None
                    break
                except Exception as exc:
                    record.error = f"{type(exc).__name__}: {exc}"
                    if record.attempt >= record.max_attempts:
                        record.status = "failed"
                        record.next_attempt_at = None
                        log.error(
                            "job %s failed after %d attempt(s): %s\n%s",
                            record.job_id, record.attempt, exc, traceback.format_exc(),
                        )
                        break
                    delay = backoff.failed()
                    log.warning(
                        "job %s attempt %d/%d failed (%s); retrying in %.1fs",
                        record.job_id, record.attempt, record.max_attempts,
                        type(exc).__name__, delay,
                    )
                    # The time, not just the fact: "retrying" with no due time
                    # is indistinguishable from "stuck" on the job list.
                    record.next_attempt_at = _utcnow() + timedelta(seconds=delay)
                    record.message = (
                        f"retrying after {type(exc).__name__}"
                        f" at {record.next_attempt_at.strftime('%H:%M:%S')} UTC"
                    )
                    time.sleep(delay)
            record.finished_at = _utcnow()
            self._persist(record)
            self._schedule_complete(record, loop)

        self._pool.submit(runner)

    def _schedule_complete(self, record: JobRecord, loop) -> None:
        """Hand the completion hooks back to the event loop from a worker thread.

        The loop can be gone by the time a job finishes (shutdown, or a test
        whose loop has closed). Explicitly close the coroutine in that case —
        an un-awaited coroutine is a resource leak and a noisy warning.
        """
        coro = self._fire_complete(record)
        if loop is None or loop.is_closed():
            coro.close()
            return
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError as exc:
            coro.close()
            log.debug("could not dispatch completion hooks for %s: %s", record.job_id, exc)

    def _submit_celery(self, record: JobRecord, kind: str, args, kwargs, loop) -> None:
        from celery_tasks import TASK_MAP  # type: ignore

        task = TASK_MAP.get(kind)
        if task is None:
            record.status = "failed"
            record.error = f"no celery task registered for kind={kind}"
            return
        async_result = task.apply_async(args=list(args), kwargs=kwargs, task_id=record.job_id)
        record.status = "queued"
        if loop is None or loop.is_closed():
            log.warning("celery job %s dispatched but no loop to poll it on", record.job_id)
            return
        asyncio.run_coroutine_threadsafe(self._poll_celery(record, async_result), loop)

    async def _poll_celery(self, record: JobRecord, async_result) -> None:
        while True:
            await asyncio.sleep(1.0)
            state = async_result.state
            if state == "PROGRESS":
                record.status = "running"
                info = async_result.info or {}
                record.progress = float(info.get("progress", record.progress))
                record.message = str(info.get("message", record.message))
            elif state in {"SUCCESS", "FAILURE", "REVOKED"}:
                record.finished_at = _utcnow()
                if state == "SUCCESS":
                    record.status = "succeeded"
                    record.progress = 1.0
                    record.result = async_result.result
                else:
                    record.status = "failed" if state == "FAILURE" else "cancelled"
                    record.error = str(async_result.info)
                self._persist(record)
                await self._fire_complete(record)
                return
            elif state == "STARTED":
                record.status = "running"
                record.started_at = record.started_at or _utcnow()

    async def _fire_complete(self, record: JobRecord) -> None:
        for hook in self._on_complete:
            try:
                out = hook(record)
                if asyncio.iscoroutine(out):
                    await out
            except Exception as exc:
                log.error("job completion hook failed: %s", exc)

    def _persist(self, record: JobRecord) -> None:
        try:
            from modules.audit import get_audit

            get_audit().record_job(
                record.job_id, record.kind, record.status,
                record.submitted_at.replace(tzinfo=None),
                record.finished_at.replace(tzinfo=None) if record.finished_at else None,
                record.backend, record.error,
            )
        except Exception as exc:
            log.error("job persist failed: %s", exc)

    # -- read model ------------------------------------------------------- #
    def get(self, job_id: str) -> JobRecord | None:
        return self._jobs.get(job_id)

    def list(self, limit: int = 25, kind_prefix: str | None = None) -> list[JobRecord]:
        records = self._jobs.values()
        if kind_prefix:
            records = [r for r in records if r.kind.startswith(kind_prefix)]
        return sorted(records, key=lambda r: r.submitted_at, reverse=True)[:limit]

    def stats(self) -> dict[str, Any]:
        by_status: dict[str, int] = {}
        for rec in self._jobs.values():
            by_status[rec.status] = by_status.get(rec.status, 0) + 1
        return {
            "backend": self.backend,
            "workers": self.workers,
            "broker_configured": bool(settings.celery_broker_url),
            "broker_transport": broker_transport_identity(),
            "total": len(self._jobs),
            "by_status": by_status,
        }

    def shutdown(self) -> None:
        old_pool = self._pool
        self._pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="alphaengine-job")
        old_pool.shutdown(wait=False, cancel_futures=True)

_queue: JobQueue | None = None


def get_queue() -> JobQueue:
    global _queue
    if _queue is None:
        _queue = JobQueue()
    return _queue
