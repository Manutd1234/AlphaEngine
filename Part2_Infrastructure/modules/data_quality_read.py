"""The ledger's read path — the aggregate view and the findings page.

Split out of ``modules/data_quality.py`` as a mixin; ``self`` is the ledger.

The two ``GROUP BY`` queries below are the Python half of a mirrored pair: the
Postgres backend answers the same questions through the ``data_quality_rollup``
migration, and ``tests/test_data_quality_rollup.py`` reads THIS FILE to keep
the two naming the same columns.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from modules.data_quality_models import (
    DataQualityCapabilityRow,
    DataQualityCounts,
    DataQualityEscalationView,
    DataQualityFindingView,
    DataQualityProviderRow,
    DataQualityView,
)
from modules.data_quality_schema import _AGGREGATE, _dt, _now_ms


class DataQualityReadMixin:
    """Everything that only reads: prune, the row views, `view` and `findings`."""

    # -- read --------------------------------------------------------------- #
    def prune(self, now_ms: float | None = None) -> int:
        now = now_ms if now_ms is not None else _now_ms()
        self._last_prune_ms = now
        cutoff = now - self.retention_days * 86_400_000
        removed = self._sql_execute("DELETE FROM data_quality_findings WHERE observed_at<?", (cutoff,)).rowcount
        self._sql_execute(
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
        total_row = self._sql_one(f"SELECT {agg} FROM data_quality_findings WHERE observed_at>=?", (since,)) or {}  # noqa: S608
        bounds = self._sql_one(
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
            for row in self._sql_query(
                f"SELECT provider, {agg} FROM data_quality_findings WHERE observed_at>=? GROUP BY provider ORDER BY provider",  # noqa: S608
                (since,),
            )
        ]
        by_capability = [
            DataQualityCapabilityRow(capability=row["capability"], **self._counts(row).model_dump())
            for row in self._sql_query(
                f"SELECT capability, {agg} FROM data_quality_findings WHERE observed_at>=? GROUP BY capability ORDER BY capability",  # noqa: S608
                (since,),
            )
        ]
        recent = [
            self._finding_view(row)
            for row in self._sql_query(
                "SELECT * FROM data_quality_findings WHERE observed_at>=? ORDER BY observed_at DESC, id DESC LIMIT ?",
                (since, self.recent_limit),
            )
        ]
        escalations = [
            self._escalation_view(row)
            for row in self._sql_query(
                """
                SELECT * FROM data_quality_escalations
                WHERE resolved_at IS NULL
                   OR id IN (SELECT id FROM data_quality_escalations WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 10)
                ORDER BY opened_at DESC
                """,
            )
        ]
        return DataQualityView(
            backend=self.backend,  # what is serving, not what was true when written
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
            acknowledged_at=_dt(row["acknowledged_at"]),
            acknowledged_by=row["acknowledged_by"],
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
        total = int((self._sql_one(f"SELECT COUNT(*) AS n FROM data_quality_findings {where}", tuple(params)) or {}).get("n") or 0)  # noqa: S608
        rows = self._sql_query(
            f"SELECT * FROM data_quality_findings {where} ORDER BY observed_at DESC, id DESC LIMIT ?",  # noqa: S608
            tuple([*params, max(1, min(500, limit))]),
        )
        return [self._finding_view(row) for row in rows], total

    def reset(self) -> None:
        self._sql_execute("DELETE FROM data_quality_findings")
        self._sql_execute("DELETE FROM data_quality_escalations")
        self._last_prune_ms = 0.0
