"""Bounded synchronous work for asynchronous gateway routes.

DuckDB, SQLite and the optional PostgREST store expose synchronous APIs.  A
plain call from an ``async def`` route stalls every request on the event loop;
``asyncio.to_thread`` avoids that stall but uses an unbounded submission queue.
This module supplies the missing boundary: a small owned pool, bounded queue,
propagated request deadline, cancellation of work that has not started, and
unit-labelled telemetry. Running Python threads are drained, never reported as
killed -- CPython cannot safely cancel them.
"""

from __future__ import annotations

import asyncio
import contextvars
import os
import threading
import time
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, TypeVar

T = TypeVar("T")

REQUEST_ID_HEADER = "X-AlphaEngine-Request-Id"
BUDGET_CLASS_HEADER = "X-AlphaEngine-Budget-Class"
REMAINING_BUDGET_HEADER = "X-AlphaEngine-Remaining-Budget-Ms"
BUDGETS_MS = {"H1": 3_000, "H2": 8_000, "H3": 15_000, "H4": 25_000, "H5": 3_000}
_SAMPLES = 256


def _bounded_env(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return min(high, max(low, value))


@dataclass(slots=True)
class RequestBudget:
    request_id: str
    budget_class: str
    started_at: float
    deadline_at: float
    queue_wait_ms: float = 0.0
    blocking_ms: float = 0.0

    def remaining_s(self) -> float:
        return max(0.0, self.deadline_at - time.monotonic())

    @property
    def limit_ms(self) -> int:
        return max(0, round((self.deadline_at - self.started_at) * 1_000))

    def consumed_ms(self, *, now: float | None = None) -> int:
        observed = time.monotonic() if now is None else now
        return max(0, round((observed - self.started_at) * 1_000))


_request_budget: contextvars.ContextVar[RequestBudget | None] = contextvars.ContextVar(
    "alphaengine_request_budget", default=None,
)


@contextmanager
def bind_request_budget(request_id: str, budget_class: str, *, remaining_ms: int) -> Iterator[RequestBudget]:
    """Bind one trusted request context; primarily useful at non-HTTP seams."""
    now = time.monotonic()
    budget = RequestBudget(request_id, budget_class, now, now + max(0, remaining_ms) / 1000.0)
    token = _request_budget.set(budget)
    try:
        yield budget
    finally:
        _request_budget.reset(token)


class BackendBoundaryError(Exception):
    """Metadata shared by bounded-runtime failures at the HTTP boundary."""

    def __init__(self, boundary: str, *, dependency: str = "backend_worker_pool") -> None:
        self.boundary = boundary[:120]
        self.dependency = dependency[:120]
        super().__init__(self.boundary)


class BackendDeadlineExceeded(BackendBoundaryError, TimeoutError):
    """The caller stopped waiting when its propagated budget expired."""


class BackendSaturated(BackendBoundaryError, RuntimeError):
    """The owned workers and their bounded queue had no admission slot."""


@dataclass(slots=True)
class _Operation:
    submitted: int = 0
    completed: int = 0
    failed: int = 0
    queue_ms: deque[float] = field(default_factory=lambda: deque(maxlen=_SAMPLES))
    duration_ms: deque[float] = field(default_factory=lambda: deque(maxlen=_SAMPLES))


def _p95(values: deque[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int((len(ordered) * 0.95) - 1)))]


class BackendRuntime:
    """One bounded executor plus the state needed to operate it honestly."""

    def __init__(
        self,
        *,
        max_workers: int | None = None,
        max_queued: int | None = None,
        lag_interval_s: float = 0.1,
    ) -> None:
        self.max_workers = max_workers or _bounded_env("BACKEND_READ_WORKERS", 4, 1, 32)
        self.max_queued = max_queued if max_queued is not None else _bounded_env(
            "BACKEND_READ_QUEUE", 12, 0, 128,
        )
        self.lag_interval_s = max(0.01, lag_interval_s)
        self._executor: ThreadPoolExecutor | None = None
        self._capacity: asyncio.Semaphore | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lag_task: asyncio.Task[None] | None = None
        self._guard = threading.Lock()
        self._operations: dict[str, _Operation] = {}
        self._lag_ms: deque[float] = deque(maxlen=_SAMPLES)
        self._queued = 0
        self._running = 0
        self._completed = 0
        self._failed = 0
        self._saturated = 0
        self._cancelled = 0
        self._deadlines = 0
        self._startup_state = "not_started"
        self._startup_reason: str | None = None
        self._startup_detail: dict[str, Any] = {}

    def start(self) -> None:
        loop = asyncio.get_running_loop()
        if self._executor is not None:
            if self._loop is loop:
                return
            # TestClient and direct ``asyncio.run`` callers create a fresh loop
            # for each isolated request.  The worker pool is process-owned, but
            # its semaphore, lag sampler and callbacks are loop-owned.  Rebind
            # only after the old loop is closed and every submitted operation
            # has drained; an actually concurrent second loop is still refused.
            previous = self._loop
            with self._guard:
                idle = self._queued == 0 and self._running == 0
            if previous is None or not previous.is_closed() or not idle:
                raise RuntimeError("backend runtime is already owned by another event loop")
            self._loop = loop
            self._capacity = asyncio.Semaphore(self.max_workers + self.max_queued)
            self._lag_task = asyncio.create_task(
                self._sample_event_loop_lag(), name="backend-event-loop-lag"
            )
            return
        self._loop = loop
        self._capacity = asyncio.Semaphore(self.max_workers + self.max_queued)
        self._executor = ThreadPoolExecutor(
            max_workers=self.max_workers, thread_name_prefix="alphaengine-read",
        )
        self._lag_task = asyncio.create_task(self._sample_event_loop_lag(), name="backend-event-loop-lag")

    async def stop(self) -> None:
        task, self._lag_task = self._lag_task, None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        executor, self._executor = self._executor, None
        if executor is not None:
            await asyncio.to_thread(executor.shutdown, wait=True, cancel_futures=True)
        self._capacity = None
        self._loop = None

    async def _sample_event_loop_lag(self) -> None:
        while True:
            target = time.monotonic() + self.lag_interval_s
            await asyncio.sleep(self.lag_interval_s)
            with self._guard:
                self._lag_ms.append(max(0.0, (time.monotonic() - target) * 1000.0))

    def mark_starting(self) -> None:
        with self._guard:
            self._startup_state, self._startup_reason, self._startup_detail = "starting", None, {}

    def mark_ready(self, detail: dict[str, Any]) -> None:
        with self._guard:
            self._startup_state, self._startup_reason = "ready", None
            self._startup_detail = dict(detail)

    def mark_unready(self, reason: str) -> None:
        with self._guard:
            self._startup_state, self._startup_reason, self._startup_detail = "unready", reason[:240], {}

    def _operation(self, label: str) -> _Operation:
        if label in self._operations:
            return self._operations[label]
        safe = label if len(self._operations) < 64 else "other"
        return self._operations.setdefault(safe, _Operation())

    @staticmethod
    def _remaining_timeout(
        budget: RequestBudget | None, local_deadline: float | None,
    ) -> float | None:
        remaining = budget.remaining_s() if budget else None
        if local_deadline is not None:
            local_remaining = max(0.0, local_deadline - time.monotonic())
            remaining = local_remaining if remaining is None else min(remaining, local_remaining)
        return remaining

    async def _admit(
        self, label: str, budget: RequestBudget | None,
        remaining: float | None, admission_timeout_s: float, dependency: str,
    ) -> None:
        assert self._capacity is not None
        if remaining is not None and remaining <= 0:
            with self._guard:
                self._deadlines += 1
            raise BackendDeadlineExceeded(label, dependency=dependency)
        admission = admission_timeout_s if remaining is None else min(admission_timeout_s, remaining)
        try:
            async with asyncio.timeout(max(0.001, admission)):
                await self._capacity.acquire()
        except TimeoutError as exc:
            expired = budget is not None and budget.remaining_s() <= 0
            with self._guard:
                if expired:
                    self._deadlines += 1
                else:
                    self._saturated += 1
            if expired:
                raise BackendDeadlineExceeded(label, dependency=dependency) from exc
            raise BackendSaturated(label, dependency=dependency) from exc

    def _submit(
        self, label: str, fn: Callable[..., T], args: tuple[Any, ...],
        kwargs: dict[str, Any], budget: RequestBudget | None,
    ) -> Future[T]:
        queued_at = time.perf_counter()
        state = {"started": False}
        with self._guard:
            self._queued += 1
            self._operation(label).submitted += 1

        def invoke() -> T:
            started = time.perf_counter()
            queue_ms = (started - queued_at) * 1000.0
            with self._guard:
                state["started"] = True
                self._queued -= 1
                self._running += 1
                self._operation(label).queue_ms.append(queue_ms)
                if budget is not None:
                    budget.queue_wait_ms += queue_ms
            try:
                result = fn(*args, **kwargs)
            except BaseException:
                with self._guard:
                    self._failed += 1
                    self._operation(label).failed += 1
                raise
            finally:
                elapsed_ms = (time.perf_counter() - started) * 1000.0
                with self._guard:
                    self._running -= 1
                    self._operation(label).duration_ms.append(elapsed_ms)
                    if budget is not None:
                        budget.blocking_ms += elapsed_ms
            with self._guard:
                self._completed += 1
                self._operation(label).completed += 1
            return result

        try:
            future: Future[T] = self._executor.submit(invoke)
        except BaseException:
            with self._guard:
                self._queued -= 1
            self._capacity.release()
            raise
        capacity, loop = self._capacity, self._loop

        def release(_future: Future[T]) -> None:
            with self._guard:
                if not state["started"]:
                    self._queued -= 1
            try:
                loop.call_soon_threadsafe(capacity.release)
            except RuntimeError:
                pass

        future.add_done_callback(release)
        return future

    async def _wait_for(
        self, label: str, future: Future[T], remaining: float | None, dependency: str,
    ) -> T:
        wrapped = asyncio.wrap_future(future)
        try:
            if remaining is None:
                return await wrapped
            async with asyncio.timeout(max(0.001, remaining)):
                return await asyncio.shield(wrapped)
        except TimeoutError as exc:
            future.cancel()
            with self._guard:
                self._deadlines += 1
            raise BackendDeadlineExceeded(label, dependency=dependency) from exc
        except asyncio.CancelledError:
            future.cancel()
            with self._guard:
                self._cancelled += 1
            raise

    async def run(
        self,
        label: str,
        fn: Callable[..., T],
        *args: Any,
        timeout_s: float | None = None,
        honour_request_deadline: bool = True,
        admission_timeout_s: float = 0.05,
        dependency: str = "backend_worker_pool",
        **kwargs: Any,
    ) -> T:
        """Run one synchronous operation without an unbounded submission."""
        self.start()
        budget = _request_budget.get() if honour_request_deadline else None
        local_deadline = time.monotonic() + timeout_s if timeout_s is not None else None
        remaining = self._remaining_timeout(budget, local_deadline)
        await self._admit(label, budget, remaining, admission_timeout_s, dependency)
        remaining = self._remaining_timeout(budget, local_deadline)
        if remaining is not None and remaining <= 0:
            assert self._capacity is not None
            self._capacity.release()
            with self._guard:
                self._deadlines += 1
            raise BackendDeadlineExceeded(label, dependency=dependency)
        future = self._submit(label, fn, args, kwargs, budget)
        return await self._wait_for(label, future, remaining, dependency)

    def status(self) -> dict[str, Any]:
        with self._guard:
            operations = {
                label: {
                    "submitted": item.submitted,
                    "completed": item.completed,
                    "failed": item.failed,
                    "queue_p95_ms": round(_p95(item.queue_ms), 3),
                    "duration_p95_ms": round(_p95(item.duration_ms), 3),
                }
                for label, item in sorted(self._operations.items())
            }
            started = self._executor is not None
            return {
                "ready": started and self._startup_state in {"not_started", "ready"},
                "state": "running" if started else "stopped",
                "startup_state": self._startup_state,
                "startup_reason": self._startup_reason,
                "startup_detail": dict(self._startup_detail),
                "max_workers": self.max_workers,
                "queue_capacity": self.max_queued,
                "queue_depth": self._queued,
                "running": self._running,
                "completed_total": self._completed,
                "failed_total": self._failed,
                "saturated_total": self._saturated,
                "cancelled_total": self._cancelled,
                "deadline_total": self._deadlines,
                "event_loop_lag_p95_ms": round(_p95(self._lag_ms), 3),
                "operations": operations,
            }


_runtime = BackendRuntime()


def get_backend_runtime() -> BackendRuntime:
    return _runtime


def current_request_budget() -> RequestBudget | None:
    return _request_budget.get()

async def run_blocking(label: str, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await _runtime.run(label, fn, *args, **kwargs)
