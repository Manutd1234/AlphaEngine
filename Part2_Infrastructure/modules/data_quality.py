"""The durable, cross-instance data-quality ledger and its escalation rules.

Every web instance evaluates a data contract on each payload it fetches
(``lib/providers/contracts.ts``) and, until now, kept the result in a
per-lambda ring buffer: two polls landing on two instances described two
different worlds, and a restart forgot everything. Now each instance pushes
its findings through the ops-sync round trip it already makes, this ledger
persists them here — one SQLite file on the gateway's data volume — and every
instance reads the merged view back in the same response.

Two rules run on ingest and escalate to the Telegram alert chats and the
audit log: a burst of fatal findings from one provider, and a contract-fail
rate above a threshold once enough payloads have been evaluated. One
escalation per (rule, provider) per cooldown, auto-resolved when the
condition clears; every escalation is visible on the Data tab with the
channel it went to, so "escalated to log" is never mistaken for a page.

Boundaries, stated: one gateway process and one file — durable across
restarts and deploys, not replicated across regions; a single channel with
a cooldown, no acknowledgement workflow.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from config import settings
from modules.data_ops_store import SqliteStore

log = logging.getLogger("alphaengine.data_quality")

# --------------------------------------------------------------------------- #
# Wire contract — what an instance pushes, and the view every instance reads
# --------------------------------------------------------------------------- #

Severity = Literal["fatal", "warn", "drift"]

# Bounds on cardinality, not correctness: the ledger must survive a
# misbehaving client without growing without bound.
FINDINGS_BATCH_CAP = 200
CHECKS_PER_FINDING_CAP = 32
FUTURE_SLACK_MS = 60_000


class WebContractCheck(BaseModel):
    check: str = Field(min_length=1, max_length=64)
    severity: Severity
    message: str = Field(default="", max_length=200)


class WebContractFinding(BaseModel):
    """One contract evaluation, as the web instance recorded it.

    ``seq`` is the instance's own monotonic counter: with ``UNIQUE(instance,
    seq)`` a batch the instance restores and re-pushes after a failed sync is
    de-duplicated rather than counted twice.
    """

    seq: int = Field(ge=0)
    observed_at: float = Field(ge=0, description="Epoch milliseconds, client clock")
    capability: str = Field(min_length=1, max_length=32)
    provider: str = Field(min_length=1, max_length=64)
    symbol: str | None = Field(default=None, max_length=24)
    key: str = Field(default="", max_length=160)
    passed: bool
    fatal: int = Field(default=0, ge=0, le=100)
    warn: int = Field(default=0, ge=0, le=100)
    drift: int = Field(default=0, ge=0, le=100)
    not_evaluated: int = Field(default=0, ge=0, le=100)
    checks: list[WebContractCheck] = Field(default_factory=list, max_length=CHECKS_PER_FINDING_CAP)


class DataQualityCounts(BaseModel):
    evaluated: int
    passed: int
    fatal: int
    warn: int
    drift: int
    not_evaluated: int


class DataQualityProviderRow(DataQualityCounts):
    provider: str
    # None when nothing was evaluated — never 0, which would read as "perfect".
    fail_rate: float | None


class DataQualityCapabilityRow(DataQualityCounts):
    capability: str


class DataQualityFindingView(BaseModel):
    id: int
    observed_at: datetime
    instance: str
    source: Literal["web", "replay", "backfill"]
    capability: str
    provider: str
    symbol: str | None
    key: str
    passed: bool
    severity: Literal["fatal", "warn", "drift", "clean"]
    checks: list[str]


class DataQualityEscalationView(BaseModel):
    id: int
    rule: Literal["fatal_burst", "fail_rate"]
    provider: str
    opened_at: datetime
    window_minutes: int
    count: int
    evaluated: int | None
    detail: str
    notified_at: datetime | None
    channel: Literal["telegram", "log"] | None
    resolved_at: datetime | None


class DataQualityView(BaseModel):
    """The merged ledger, as every instance reads it back.

    Every field is required on purpose (the same house rule as
    ``WebStateView``): a response field with a default publishes itself as
    optional in the OpenAPI contract, and a generated client would then hedge
    against an absence that cannot happen.
    """

    schema_version: Literal[1] = 1
    backend: Literal["sqlite"]
    retention_days: int
    window_minutes: int
    observed_at: datetime
    first_observed_at: datetime | None
    last_observed_at: datetime | None
    instances: int
    total: DataQualityCounts
    by_provider: list[DataQualityProviderRow]
    by_capability: list[DataQualityCapabilityRow]
    recent: list[DataQualityFindingView]
    escalations: list[DataQualityEscalationView]


class DataQualityFindingsResponse(BaseModel):
    findings: list[DataQualityFindingView]
    total: int
    retention_days: int
    window_minutes: int
    observed_at: datetime


# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #

_DDL = [
    """
    CREATE TABLE IF NOT EXISTS data_quality_findings (
        id INTEGER PRIMARY KEY,
        instance TEXT NOT NULL,
        seq INTEGER NOT NULL,
        source TEXT NOT NULL,
        observed_at REAL NOT NULL,
        received_at REAL NOT NULL,
        capability TEXT NOT NULL,
        provider TEXT NOT NULL,
        symbol TEXT,
        key TEXT NOT NULL,
        passed INTEGER NOT NULL,
        fatal INTEGER NOT NULL,
        warn INTEGER NOT NULL,
        drift INTEGER NOT NULL,
        not_evaluated INTEGER NOT NULL,
        checks_json TEXT NOT NULL,
        UNIQUE(instance, seq)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_dq_findings_observed ON data_quality_findings(observed_at)",
    "CREATE INDEX IF NOT EXISTS ix_dq_findings_provider ON data_quality_findings(provider, observed_at)",
    """
    CREATE TABLE IF NOT EXISTS data_quality_escalations (
        id INTEGER PRIMARY KEY,
        rule TEXT NOT NULL,
        provider TEXT NOT NULL,
        opened_at REAL NOT NULL,
        window_minutes INTEGER NOT NULL,
        count INTEGER NOT NULL,
        evaluated INTEGER,
        detail TEXT NOT NULL,
        notified_at REAL,
        channel TEXT,
        resolved_at REAL
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_dq_esc_rule ON data_quality_escalations(rule, provider, opened_at)",
]

#: Columns added after the table shipped.
#:
#: This store has no migration table — `SqliteStore.migrate` runs
#: `CREATE TABLE IF NOT EXISTS` on every construction and there is no ALTER
#: path — so a column added later has to be added conditionally, the way
#: `audit.py` already does for `subscribers`. An unconditional ALTER fails on
#: the second start; a new CREATE would silently not run on an existing file.
_ESCALATION_COLUMNS: tuple[tuple[str, str], ...] = (
    # NULL means unacknowledged, and stays NULL for every row that predates
    # this. An escalation nobody has seen and an escalation from before the
    # column existed are the same fact: nobody has taken it.
    ("acknowledged_at", "REAL"),
    ("acknowledged_by", "TEXT"),
)

_PRUNE_EVERY_MS = 10 * 60_000

_AGGREGATE = (
    "COUNT(*) AS evaluated, SUM(passed) AS passed, SUM(fatal) AS fatal, "
    "SUM(warn) AS warn, SUM(drift) AS drift, SUM(not_evaluated) AS not_evaluated"
)


def _dt(ms: float | None) -> datetime | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)


def _now_ms() -> float:
    return time.time() * 1000.0


class Escalation(BaseModel):
    """A newly opened escalation, as returned to the caller who ingested it."""

    id: int
    rule: Literal["fatal_burst", "fail_rate"]
    provider: str
    opened_at: float
    window_minutes: int
    count: int
    evaluated: int | None
    detail: str


class DataQualityLedger(SqliteStore):
    def __init__(
        self,
        path: str,
        *,
        retention_days: int | None = None,
        view_window_minutes: int | None = None,
        recent_limit: int | None = None,
        escalate_fatal_count: int | None = None,
        escalate_window_minutes: int | None = None,
        escalate_fail_rate: float | None = None,
        escalate_min_samples: int | None = None,
        escalate_cooldown_minutes: int | None = None,
    ) -> None:
        super().__init__(path)
        self.retention_days = retention_days or settings.data_quality_retention_days
        self.view_window_minutes = view_window_minutes or settings.data_quality_view_window_minutes
        self.recent_limit = recent_limit or settings.data_quality_recent_limit
        self.escalate_fatal_count = escalate_fatal_count or settings.data_quality_escalate_fatal_count
        self.escalate_window_minutes = escalate_window_minutes or settings.data_quality_escalate_window_minutes
        self.escalate_fail_rate = (
            escalate_fail_rate if escalate_fail_rate is not None else settings.data_quality_escalate_fail_rate
        )
        self.escalate_min_samples = escalate_min_samples or settings.data_quality_escalate_min_samples
        self.escalate_cooldown_minutes = escalate_cooldown_minutes or settings.data_quality_escalate_cooldown_minutes
        self._last_prune_ms = 0.0
        self._gateway_seq = 0
        self.migrate(_DDL)
        self._add_missing_escalation_columns()

    def _add_missing_escalation_columns(self) -> None:
        """Add columns to a table that already exists on disk.

        `migrate` only runs CREATE TABLE IF NOT EXISTS, so a column added after
        the table shipped never appears on an existing data volume. Same shape
        as `audit.py`'s subscriber migration: read the columns, add what is
        missing, leave what is there.
        """
        existing = {
            str(row["name"]).lower()
            for row in self.query("PRAGMA table_info(data_quality_escalations)")
        }
        for column, sql_type in _ESCALATION_COLUMNS:
            if column not in existing:
                self.execute(f"ALTER TABLE data_quality_escalations ADD COLUMN {column} {sql_type}")

    def acknowledge(self, escalation_id: int, actor: str) -> bool:
        """Record that a person has taken this escalation.

        Returns False when there is no such open escalation — acknowledging one
        that has already resolved is not an error, but it is not an
        acknowledgement either, and saying so lets the caller tell "done" from
        "there was nothing to do".

        Idempotent: the first acknowledgement stands. A second person taking an
        escalation someone else already has should not quietly overwrite whose
        name is against it.
        """
        row = self.one(
            "SELECT id, acknowledged_at FROM data_quality_escalations "
            "WHERE id=? AND resolved_at IS NULL",
            (escalation_id,),
        )
        if row is None:
            return False
        if row["acknowledged_at"] is not None:
            return True
        self.execute(
            "UPDATE data_quality_escalations SET acknowledged_at=?, acknowledged_by=? WHERE id=?",
            (time.time() * 1000.0, actor[:120], escalation_id),
        )
        return True

    @classmethod
    def in_memory(cls, **kwargs: Any) -> "DataQualityLedger":
        return cls(":memory:", **kwargs)

    # -- ingest ------------------------------------------------------------- #
    def ingest(
        self,
        findings: list[WebContractFinding],
        *,
        instance: str,
        source: str = "web",
        now_ms: float | None = None,
    ) -> list[Escalation]:
        """Persist a batch (de-duplicated on ``(instance, seq)``), run the rules.

        Returns the escalations this batch newly opened, so the caller can
        publish them; nothing here does network I/O.
        """
        now = now_ms if now_ms is not None else _now_ms()
        retention_ms = self.retention_days * 86_400_000
        rows: list[tuple[Any, ...]] = []
        for finding in findings:
            # Refuse the stale and the future, as the latency ledger does: a
            # sample outside the window is a replay or a broken clock.
            if finding.observed_at < now - retention_ms or finding.observed_at > now + FUTURE_SLACK_MS:
                continue
            rows.append((
                instance, finding.seq, source, finding.observed_at, now,
                finding.capability, finding.provider, finding.symbol, finding.key,
                1 if finding.passed else 0, finding.fatal, finding.warn, finding.drift, finding.not_evaluated,
                json.dumps([c.model_dump() for c in finding.checks[:CHECKS_PER_FINDING_CAP]]),
            ))
        if rows:
            self.executemany(
                """
                INSERT INTO data_quality_findings
                    (instance, seq, source, observed_at, received_at, capability, provider, symbol, key,
                     passed, fatal, warn, drift, not_evaluated, checks_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(instance, seq) DO NOTHING
                """,
                rows,
            )
        providers = sorted({row[6] for row in rows})
        opened = self._evaluate_rules(providers, now) if providers else []
        self._resolve_cleared(now)
        if now - self._last_prune_ms >= _PRUNE_EVERY_MS:
            self.prune(now)
        return opened

    def record(
        self,
        *,
        source: Literal["replay", "backfill"],
        capability: str,
        provider: str,
        symbol: str | None,
        key: str,
        passed: bool,
        violations: list[dict[str, Any]],
        not_evaluated: int,
        instance: str,
        observed_ms: float | None = None,
    ) -> list[Escalation]:
        """A finding the gateway itself produced (a replay or backfill job)."""
        self._gateway_seq += 1
        checks = [
            WebContractCheck(
                check=str(v.get("check", ""))[:64] or "unknown",
                severity=v.get("severity", "warn"),
                message=str(v.get("message", ""))[:200],
            )
            for v in violations[:CHECKS_PER_FINDING_CAP]
        ]
        finding = WebContractFinding(
            seq=self._gateway_seq,
            observed_at=observed_ms if observed_ms is not None else _now_ms(),
            capability=capability,
            provider=provider,
            symbol=symbol,
            key=key,
            passed=passed,
            fatal=sum(1 for c in checks if c.severity == "fatal"),
            warn=sum(1 for c in checks if c.severity == "warn"),
            drift=sum(1 for c in checks if c.severity == "drift"),
            not_evaluated=not_evaluated,
            checks=checks,
        )
        # A gateway-side finding carries a seq the gateway process owns; the
        # instance name makes the (instance, seq) pair unique across restarts
        # only if the counter never repeats, so the job id is part of it.
        return self.ingest([finding], instance=instance, source=source)

    # -- rules -------------------------------------------------------------- #
    def _open_within_cooldown(self, rule: str, provider: str, now: float) -> bool:
        cooldown_ms = self.escalate_cooldown_minutes * 60_000
        row = self.one(
            "SELECT id FROM data_quality_escalations WHERE rule=? AND provider=? AND opened_at>? LIMIT 1",
            (rule, provider, now - cooldown_ms),
        )
        return row is not None

    def _evaluate_rules(self, providers: list[str], now: float) -> list[Escalation]:
        window_ms = self.escalate_window_minutes * 60_000
        since = now - window_ms
        opened: list[Escalation] = []
        for provider in providers:
            stats = self.one(
                """
                SELECT COUNT(*) AS evaluated,
                       SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN fatal>0 THEN 1 ELSE 0 END) AS fatal_findings
                FROM data_quality_findings WHERE provider=? AND observed_at>=?
                """,
                (provider, since),
            ) or {}
            evaluated = int(stats.get("evaluated") or 0)
            failed = int(stats.get("failed") or 0)
            fatal_findings = int(stats.get("fatal_findings") or 0)

            if fatal_findings >= self.escalate_fatal_count and not self._open_within_cooldown("fatal_burst", provider, now):
                detail = (
                    f"{fatal_findings} payloads with a fatal contract finding from {provider} "
                    f"in the last {self.escalate_window_minutes} minutes"
                )
                opened.append(self._open("fatal_burst", provider, now, fatal_findings, evaluated, detail))

            if evaluated >= self.escalate_min_samples:
                rate = failed / evaluated
                if rate > self.escalate_fail_rate and not self._open_within_cooldown("fail_rate", provider, now):
                    detail = (
                        f"{failed} of {evaluated} payloads from {provider} failed their contract "
                        f"({rate * 100:.0f}%) in the last {self.escalate_window_minutes} minutes"
                    )
                    opened.append(self._open("fail_rate", provider, now, failed, evaluated, detail))
        return opened

    def _open(self, rule: str, provider: str, now: float, count: int, evaluated: int, detail: str) -> Escalation:
        cursor = self.execute(
            """
            INSERT INTO data_quality_escalations
                (rule, provider, opened_at, window_minutes, count, evaluated, detail)
            VALUES (?,?,?,?,?,?,?)
            """,
            (rule, provider, now, self.escalate_window_minutes, count, evaluated, detail),
        )
        log.warning("data-quality escalation opened: %s", detail)
        return Escalation(
            id=int(cursor.lastrowid or 0), rule=rule, provider=provider, opened_at=now,
            window_minutes=self.escalate_window_minutes, count=count, evaluated=evaluated, detail=detail,
        )

    def _resolve_cleared(self, now: float) -> None:
        """An open escalation whose condition no longer holds is resolved, not deleted."""
        window_ms = self.escalate_window_minutes * 60_000
        since = now - window_ms
        for row in self.query("SELECT id, rule, provider FROM data_quality_escalations WHERE resolved_at IS NULL"):
            stats = self.one(
                """
                SELECT COUNT(*) AS evaluated,
                       SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN fatal>0 THEN 1 ELSE 0 END) AS fatal_findings
                FROM data_quality_findings WHERE provider=? AND observed_at>=?
                """,
                (row["provider"], since),
            ) or {}
            evaluated = int(stats.get("evaluated") or 0)
            failed = int(stats.get("failed") or 0)
            fatal_findings = int(stats.get("fatal_findings") or 0)
            still = (
                fatal_findings >= self.escalate_fatal_count
                if row["rule"] == "fatal_burst"
                else evaluated >= self.escalate_min_samples and failed / evaluated > self.escalate_fail_rate
            )
            if not still:
                self.execute("UPDATE data_quality_escalations SET resolved_at=? WHERE id=?", (now, row["id"]))

    def mark_notified(self, escalation_id: int, channel: str, now_ms: float | None = None) -> None:
        now = now_ms if now_ms is not None else _now_ms()
        self.execute(
            "UPDATE data_quality_escalations SET notified_at=?, channel=? WHERE id=?",
            (now, channel, escalation_id),
        )

    # -- read --------------------------------------------------------------- #
    def prune(self, now_ms: float | None = None) -> int:
        now = now_ms if now_ms is not None else _now_ms()
        self._last_prune_ms = now
        cutoff = now - self.retention_days * 86_400_000
        removed = self.execute("DELETE FROM data_quality_findings WHERE observed_at<?", (cutoff,)).rowcount
        self.execute(
            "DELETE FROM data_quality_escalations WHERE resolved_at IS NOT NULL AND resolved_at<?",
            (cutoff,),
        )
        return int(removed or 0)

    @staticmethod
    def _counts(row: dict[str, Any]) -> DataQualityCounts:
        return DataQualityCounts(
            evaluated=int(row.get("evaluated") or 0),
            passed=int(row.get("passed") or 0),
            fatal=int(row.get("fatal") or 0),
            warn=int(row.get("warn") or 0),
            drift=int(row.get("drift") or 0),
            not_evaluated=int(row.get("not_evaluated") or 0),
        )

    @staticmethod
    def _finding_view(row: dict[str, Any]) -> DataQualityFindingView:
        checks = json.loads(row["checks_json"] or "[]")
        fatal = int(row["fatal"] or 0)
        warn = int(row["warn"] or 0)
        drift = int(row["drift"] or 0)
        severity: Literal["fatal", "warn", "drift", "clean"] = (
            "fatal" if fatal else "warn" if warn else "drift" if drift else "clean"
        )
        return DataQualityFindingView(
            id=int(row["id"]),
            observed_at=_dt(row["observed_at"]),  # type: ignore[arg-type]
            instance=row["instance"],
            source=row["source"],
            capability=row["capability"],
            provider=row["provider"],
            symbol=row["symbol"],
            key=row["key"],
            passed=bool(row["passed"]),
            severity=severity,
            checks=[str(c.get("check", "")) for c in checks if isinstance(c, dict)],
        )

    def view(self, now_ms: float | None = None) -> DataQualityView:
        now = now_ms if now_ms is not None else _now_ms()
        since = now - self.view_window_minutes * 60_000
        # The aggregate is a module constant spliced into three queries; every
        # value is bound. The noqa marks the splice as identifiers, not input.
        agg = _AGGREGATE
        total_row = self.one(f"SELECT {agg} FROM data_quality_findings WHERE observed_at>=?", (since,)) or {}  # noqa: S608
        bounds = self.one(
            "SELECT MIN(observed_at) AS first_at, MAX(observed_at) AS last_at, COUNT(DISTINCT instance) AS instances "
            "FROM data_quality_findings WHERE observed_at>=?",
            (since,),
        ) or {}
        by_provider = [
            DataQualityProviderRow(
                provider=row["provider"],
                fail_rate=(
                    (int(row["evaluated"]) - int(row["passed"] or 0)) / int(row["evaluated"])
                    if int(row["evaluated"] or 0) > 0 else None
                ),
                **self._counts(row).model_dump(),
            )
            for row in self.query(
                f"SELECT provider, {agg} FROM data_quality_findings WHERE observed_at>=? GROUP BY provider ORDER BY provider",  # noqa: S608
                (since,),
            )
        ]
        by_capability = [
            DataQualityCapabilityRow(capability=row["capability"], **self._counts(row).model_dump())
            for row in self.query(
                f"SELECT capability, {agg} FROM data_quality_findings WHERE observed_at>=? GROUP BY capability ORDER BY capability",  # noqa: S608
                (since,),
            )
        ]
        recent = [
            self._finding_view(row)
            for row in self.query(
                "SELECT * FROM data_quality_findings WHERE observed_at>=? ORDER BY observed_at DESC, id DESC LIMIT ?",
                (since, self.recent_limit),
            )
        ]
        escalations = [
            self._escalation_view(row)
            for row in self.query(
                """
                SELECT * FROM data_quality_escalations
                WHERE resolved_at IS NULL
                   OR id IN (SELECT id FROM data_quality_escalations WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 10)
                ORDER BY opened_at DESC
                """,
            )
        ]
        return DataQualityView(
            backend="sqlite",
            retention_days=self.retention_days,
            window_minutes=self.view_window_minutes,
            observed_at=_dt(now),  # type: ignore[arg-type]
            first_observed_at=_dt(bounds.get("first_at")),
            last_observed_at=_dt(bounds.get("last_at")),
            instances=int(bounds.get("instances") or 0),
            total=self._counts(total_row),
            by_provider=by_provider,
            by_capability=by_capability,
            recent=recent,
            escalations=escalations,
        )

    @staticmethod
    def _escalation_view(row: dict[str, Any]) -> DataQualityEscalationView:
        return DataQualityEscalationView(
            id=int(row["id"]),
            rule=row["rule"],
            provider=row["provider"],
            opened_at=_dt(row["opened_at"]),  # type: ignore[arg-type]
            window_minutes=int(row["window_minutes"]),
            count=int(row["count"]),
            evaluated=int(row["evaluated"]) if row["evaluated"] is not None else None,
            detail=row["detail"],
            notified_at=_dt(row["notified_at"]),
            channel=row["channel"],
            resolved_at=_dt(row["resolved_at"]),
        )

    def findings(
        self,
        *,
        limit: int = 100,
        provider: str | None = None,
        capability: str | None = None,
        severity: str | None = None,
        since_ms: float | None = None,
    ) -> tuple[list[DataQualityFindingView], int]:
        clauses: list[str] = []
        params: list[Any] = []
        if provider:
            clauses.append("provider=?")
            params.append(provider)
        if capability:
            clauses.append("capability=?")
            params.append(capability)
        if severity == "fatal":
            clauses.append("fatal>0")
        elif severity == "warn":
            clauses.append("fatal=0 AND warn>0")
        elif severity == "drift":
            clauses.append("fatal=0 AND warn=0 AND drift>0")
        elif severity == "clean":
            clauses.append("fatal=0 AND warn=0 AND drift=0")
        if since_ms is not None:
            clauses.append("observed_at>=?")
            params.append(since_ms)
        # Every clause is a fixed fragment chosen above; every value is bound.
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        total = int((self.one(f"SELECT COUNT(*) AS n FROM data_quality_findings {where}", tuple(params)) or {}).get("n") or 0)  # noqa: S608
        rows = self.query(
            f"SELECT * FROM data_quality_findings {where} ORDER BY observed_at DESC, id DESC LIMIT ?",  # noqa: S608
            tuple([*params, max(1, min(500, limit))]),
        )
        return [self._finding_view(row) for row in rows], total

    def reset(self) -> None:
        self.execute("DELETE FROM data_quality_findings")
        self.execute("DELETE FROM data_quality_escalations")
        self._last_prune_ms = 0.0


# --------------------------------------------------------------------------- #
# Escalation delivery
# --------------------------------------------------------------------------- #

#: Desk roles a data-quality escalation is addressed to. A provider that has
#: started failing contract checks is a data engineer's problem first and a
#: developer's second; a portfolio manager receiving it learns nothing they can
#: act on. A chat with no role receives it regardless.
ESCALATION_ROLES = frozenset({"data", "dev"})


async def resolve_loop(interval_s: float = 60.0, ledger: "DataQualityLedger | None" = None) -> None:
    """Sweep for escalations whose condition has cleared.

    `_resolve_cleared` runs inside `ingest`, and only there — so an escalation
    resolves when the SAME provider sends more findings. A provider that stops
    reporting entirely, which is exactly what a badly broken one does, left its
    escalation open forever: the desk showed a permanent red against a condition
    that had ended, and the rule's cooldown meant no new one could open either.

    Cheap by construction. The sweep is a few reads over a table that holds at
    most a handful of open rows, and it does nothing at all when there are none.
    """
    ledger = ledger or get_data_quality()
    while True:
        try:
            await asyncio.sleep(max(5.0, interval_s))
            await asyncio.to_thread(ledger._resolve_cleared, time.time() * 1000.0)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("data quality: resolve sweep failed (%s)", type(exc).__name__)


async def publish_escalation(
    escalation: Escalation,
    *,
    ledger: DataQualityLedger | None = None,
    bot: Any | None = None,
    audit: Any | None = None,
) -> str:
    """Send one escalation to Telegram (or the log) and the audit trail.

    Never raises: the sync round trip that opened the escalation must not
    fail because a chat could not be reached. Returns the channel used.
    """
    ledger = ledger or get_data_quality()
    channel = "log"
    try:
        if bot is None:
            from modules.telegram import get_bot

            bot = get_bot()
        try:
            targets = int(bot.health().get("alert_targets", 0)) if hasattr(bot, "health") else 0
        except Exception:
            targets = 0
        channel = "telegram" if getattr(bot, "enabled", False) and targets > 0 else "log"
        text = (
            f"<b>Data-quality escalation</b> — {escalation.rule.replace('_', ' ')}\n"
            f"{escalation.detail}.\n"
            f"Rule window {escalation.window_minutes} min; auto-resolves when the condition clears."
        )
        # Addressed to the roles that own data quality. A chat with no role set
        # still receives it — see `_role_targets`.
        await bot.broadcast("warning", text, roles=ESCALATION_ROLES)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        log.error("data-quality escalation delivery failed (%s)", type(exc).__name__)
        channel = "log"
    try:
        if audit is None:
            from modules.audit import get_audit

            audit = get_audit()
        audit.record_risk_event(
            "data_quality_escalation",
            severity="warning",
            actor="data-quality",
            detail=escalation.detail,
            payload={
                "rule": escalation.rule,
                "provider": escalation.provider,
                "count": escalation.count,
                "evaluated": escalation.evaluated,
                "window_minutes": escalation.window_minutes,
                "escalation_id": escalation.id,
                "channel": channel,
            },
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.error("data-quality escalation audit write failed (%s)", type(exc).__name__)
    try:
        ledger.mark_notified(escalation.id, channel)
    except Exception as exc:  # pragma: no cover - defensive
        log.error("data-quality escalation mark failed (%s)", type(exc).__name__)
    return channel


_ledger: DataQualityLedger | None = None


def get_data_quality() -> DataQualityLedger:
    global _ledger
    if _ledger is None:
        _ledger = DataQualityLedger(str(settings.data_ops_db_path))
    return _ledger
