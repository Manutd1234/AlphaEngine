"""A config-driven schedule for replay and backfill jobs.

``DATA_SCHEDULES`` is a semicolon-separated list of entries in one of two
shapes:

    replay:<capability>:<SYMBOL>@every=<15m|1h|6h|1d>
    backfill:<SYMBOL>:<interval>:<lookback>@every=<…>      (lookback like 2d, 12h)
    backfill:<SYMBOL>:<interval>:<lookback>@daily=HH:MM     (UTC)

The loop ticks every ``DATA_SCHEDULER_TICK_S`` seconds, submits whatever is
due, and records the run in the data-operations SQLite file so a restart does
not re-fire a daily job. Invalid entries are listed with their error, never
dropped silently. In-process, one gateway — a scheduler, not a workflow
engine, and the schedules view says so.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from config import settings
from modules.schemas import DataBackfillRequest, DataReplayRequest, DataScheduleView

log = logging.getLogger("alphaengine.data_scheduler")

_EVERY = {"15m": 15 * 60_000, "1h": 3_600_000, "6h": 6 * 3_600_000, "1d": 86_400_000}
_LOOKBACK = re.compile(r"^(\d+)([hd])$")
_DAILY = re.compile(r"^(\d{1,2}):(\d{2})$")


@dataclass
class DataSchedule:
    id: str
    kind: str  # replay | backfill
    expression: str
    valid: bool
    cadence: str
    error: str | None
    every_ms: int | None = None
    daily_hhmm: tuple[int, int] | None = None
    capability: str | None = None
    symbol: str | None = None
    interval: str | None = None
    lookback_ms: int | None = None

    def next_due_ms(self, last_run_ms: float | None, now_ms: float) -> float | None:
        if not self.valid:
            return None
        if self.every_ms is not None:
            return (last_run_ms or 0) + self.every_ms
        if self.daily_hhmm is not None:
            hh, mm = self.daily_hhmm
            now = datetime.fromtimestamp(now_ms / 1000.0, tz=timezone.utc)
            today = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            candidate = today if today.timestamp() * 1000 > (last_run_ms or 0) else today + timedelta(days=1)
            if candidate.timestamp() * 1000 <= (last_run_ms or 0):
                candidate += timedelta(days=1)
            return candidate.timestamp() * 1000
        return None


def _slug(expression: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", expression.lower()).strip("-")[:80]


def parse_schedule(expression: str) -> DataSchedule:
    base = DataSchedule(id=_slug(expression), kind="replay", expression=expression, valid=False, cadence="", error=None)
    try:
        spec, _, cadence = expression.partition("@")
        parts = spec.split(":")
        if not cadence or "=" not in cadence:
            raise ValueError("missing @every=… or @daily=HH:MM")
        mode, _, value = cadence.partition("=")
        if mode == "every":
            if value not in _EVERY:
                raise ValueError(f"every must be one of {', '.join(_EVERY)}")
            base.every_ms = _EVERY[value]
        elif mode == "daily":
            m = _DAILY.fullmatch(value)
            if not m or not (0 <= int(m.group(1)) < 24 and 0 <= int(m.group(2)) < 60):
                raise ValueError("daily must be HH:MM (UTC)")
            base.daily_hhmm = (int(m.group(1)), int(m.group(2)))
        else:
            raise ValueError("cadence must be every or daily")
        base.cadence = cadence
        if parts[0] == "replay":
            if len(parts) != 3:
                raise ValueError("replay:<capability>:<SYMBOL>")
            DataReplayRequest(symbol=parts[2], capability=parts[1])  # validates both
            base.kind, base.capability, base.symbol = "replay", parts[1], parts[2].upper()
        elif parts[0] == "backfill":
            if len(parts) != 4:
                raise ValueError("backfill:<SYMBOL>:<interval>:<lookback>")
            m = _LOOKBACK.fullmatch(parts[3])
            if not m:
                raise ValueError("lookback like 2d or 12h")
            amount, unit = int(m.group(1)), m.group(2)
            base.lookback_ms = amount * (3_600_000 if unit == "h" else 86_400_000)
            now = datetime.now(timezone.utc)
            DataBackfillRequest(symbol=parts[1], interval=parts[2], from_at=now - timedelta(milliseconds=base.lookback_ms), to_at=now)
            base.kind, base.symbol, base.interval = "backfill", parts[1].upper(), parts[2]
        else:
            raise ValueError("kind must be replay or backfill")
        base.valid = True
    except Exception as exc:
        base.error = str(exc).split("\n")[0][:200]
    return base


#: job id -> schedule id, for the few seconds between submit and completion.
#: In memory because it is only meaningful within one process's lifetime: a
#: restart loses the mapping, and the row `record_run` already wrote is what
#: survives, which is the honest half.
_SCHEDULE_BY_JOB: dict[str, str] = {}


def record_schedule_outcome(job_id: str, status: str) -> None:
    """Write the terminal status against the schedule that submitted the job.

    `last_outcome` used to be whatever `record.status` was at submit time —
    "queued", always. So a schedule whose job failed still read as having run
    cleanly, and nothing revisited it. The column existed and could not have
    held a failure.
    """
    schedule_id = _SCHEDULE_BY_JOB.pop(job_id, None)
    if schedule_id is None:
        return
    try:
        from config import settings
        from modules.data_jobs import ScheduleRunStore

        ScheduleRunStore(str(settings.data_ops_db_path)).record_run(
            schedule_id, time.time() * 1000.0, job_id, status,
        )
    except Exception as exc:
        log.error("data scheduler: outcome for %s not recorded (%s)", job_id, type(exc).__name__)


class DataScheduler:
    def __init__(self, expressions: list[str] | None = None, *, store: Any | None = None) -> None:
        self.schedules = [parse_schedule(e) for e in (expressions if expressions is not None else settings.data_schedules)]
        self._store = store
        self._task: asyncio.Task[None] | None = None
        for s in self.schedules:
            if not s.valid:
                log.warning("data schedule %r ignored: %s", s.expression, s.error)

    def _runs(self):
        if self._store is None:
            from modules.data_jobs import ScheduleRunStore

            self._store = ScheduleRunStore(str(settings.data_ops_db_path))
        return self._store

    def due(self, now_ms: float | None = None) -> list[DataSchedule]:
        now = now_ms if now_ms is not None else time.time() * 1000.0
        out = []
        for s in self.schedules:
            if not s.valid:
                continue
            last = self._runs().last_run(s.id)
            due_at = s.next_due_ms(last["last_run_at"] if last else None, now)
            if due_at is not None and due_at <= now:
                out.append(s)
        return out

    def submit(self, schedule: DataSchedule, *, now_ms: float | None = None) -> str:
        from modules.data_jobs import submit_backfill, submit_replay

        now = now_ms if now_ms is not None else time.time() * 1000.0
        if schedule.kind == "replay":
            record = submit_replay(DataReplayRequest(symbol=schedule.symbol or "", capability=schedule.capability or "quote"), actor="scheduler")
        else:
            to_at = datetime.fromtimestamp(now / 1000.0, tz=timezone.utc)
            from_at = to_at - timedelta(milliseconds=schedule.lookback_ms or 0)
            record = submit_backfill(
                DataBackfillRequest(symbol=schedule.symbol or "", interval=schedule.interval or "1h", from_at=from_at, to_at=to_at),
                actor="scheduler",
            )
        # Status at SUBMIT time, which is "queued" — the terminal outcome is
        # written by `record_schedule_outcome` from the completion hook. This
        # row exists now so a restart between submit and completion still shows
        # the schedule as having fired.
        self._runs().record_run(schedule.id, now, record.job_id, record.status)
        _SCHEDULE_BY_JOB[record.job_id] = schedule.id
        return record.job_id

    def tick(self, now_ms: float | None = None) -> list[str]:
        """Submit every due schedule, isolating each from the others.

        This was a list comprehension, so a schedule that raised took the rest
        of the tick with it — the ones already submitted kept their `record_run`
        row and the remainder were silently skipped until the next interval,
        with nothing recording that they had been. A bad symbol in one schedule
        stopped every other schedule on the desk.
        """
        submitted: list[str] = []
        for schedule in self.due(now_ms):
            try:
                submitted.append(self.submit(schedule, now_ms=now_ms))
            except Exception as exc:
                log.error(
                    "data scheduler: %s did not submit (%s)", schedule.id, type(exc).__name__,
                )
        return submitted

    async def loop(self, tick_s: float | None = None) -> None:
        interval = tick_s if tick_s is not None else settings.data_scheduler_tick_s
        while True:
            try:
                submitted = await asyncio.to_thread(self.tick)
                if submitted:
                    log.info("data scheduler submitted %s", ", ".join(submitted))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("data scheduler tick failed (%s)", type(exc).__name__)
            await asyncio.sleep(max(1.0, interval))

    def start(self) -> None:
        if self._task is None and any(s.valid for s in self.schedules):
            self._task = asyncio.create_task(self.loop(), name="data-scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                log.debug("data scheduler cancelled")
            except Exception as exc:
                log.warning("data scheduler stopped with %s", type(exc).__name__)
            self._task = None

    def views(self, now_ms: float | None = None) -> list[DataScheduleView]:
        now = now_ms if now_ms is not None else time.time() * 1000.0
        out: list[DataScheduleView] = []
        for s in self.schedules:
            last = self._runs().last_run(s.id) if s.valid else None
            due = s.next_due_ms(last["last_run_at"] if last else None, now) if s.valid else None
            out.append(DataScheduleView(
                id=s.id, kind=s.kind, expression=s.expression, valid=s.valid, cadence=s.cadence,  # type: ignore[arg-type]
                next_due_at=datetime.fromtimestamp(due / 1000.0, tz=timezone.utc) if due else None,
                last_run_at=datetime.fromtimestamp(last["last_run_at"] / 1000.0, tz=timezone.utc) if last and last.get("last_run_at") else None,
                last_job_id=last.get("last_job_id") if last else None,
                last_outcome=last.get("last_outcome") if last else None,
                error=s.error,
            ))
        return out


_scheduler: DataScheduler | None = None


def get_scheduler() -> DataScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = DataScheduler()
    return _scheduler
