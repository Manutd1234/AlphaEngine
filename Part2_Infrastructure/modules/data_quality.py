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
a cooldown. Acknowledging is optional and resolves nothing — an escalation
clears when the condition that raised it clears, not when someone takes it.
Taking one is recorded three ways: the Take button on Data > Incidents,
`POST /api/data-quality/escalations/{id}/ack`, and Telegram `/ack <ID>`. Only
the Telegram path records a person; the web path records a credential.


The file itself is a FACADE plus the ledger's own construction and raw-SQL
guard. The parts that grew are split out and re-exported here, because every
call site in the repository says ``from modules.data_quality import X``:

  * ``data_quality_models``      — the wire models pushed by the web tier
  * ``data_quality_schema``      — the DDL, the clock helpers, ``Escalation``
  * ``data_quality_rules``       — ingest and the two escalation rules
  * ``data_quality_read``        — the aggregate view and the findings page
  * ``data_quality_escalation``  — delivery, and the periodic resolver sweep

Each re-export is written ``X as X`` because ``ruff --fix`` deletes the plain
form as unused.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from config import settings
from modules.data_ops_backend import get_data_ops_store
from modules.data_ops_store import SqliteStore
from modules.data_quality_escalation import ESCALATION_ROLES as ESCALATION_ROLES  # noqa: F401
from modules.data_quality_escalation import publish_escalation as publish_escalation  # noqa: F401
from modules.data_quality_escalation import resolve_loop as resolve_loop  # noqa: F401
from modules.data_quality_models import CHECKS_PER_FINDING_CAP as CHECKS_PER_FINDING_CAP  # noqa: F401
from modules.data_quality_models import FINDINGS_BATCH_CAP as FINDINGS_BATCH_CAP  # noqa: F401
from modules.data_quality_models import FUTURE_SLACK_MS as FUTURE_SLACK_MS  # noqa: F401
from modules.data_quality_models import DataQualityCapabilityRow as DataQualityCapabilityRow  # noqa: F401
from modules.data_quality_models import DataQualityCounts as DataQualityCounts  # noqa: F401
from modules.data_quality_models import DataQualityEscalationView as DataQualityEscalationView  # noqa: F401
from modules.data_quality_models import DataQualityFindingsResponse as DataQualityFindingsResponse  # noqa: F401
from modules.data_quality_models import DataQualityFindingView as DataQualityFindingView  # noqa: F401
from modules.data_quality_models import DataQualityProviderRow as DataQualityProviderRow  # noqa: F401
from modules.data_quality_models import DataQualityView as DataQualityView  # noqa: F401
from modules.data_quality_models import WebContractCheck as WebContractCheck  # noqa: F401
from modules.data_quality_models import WebContractFinding as WebContractFinding  # noqa: F401
from modules.data_quality_read import DataQualityReadMixin
from modules.data_quality_rules import DataQualityRulesMixin
from modules.data_quality_schema import _AGGREGATE as _AGGREGATE  # noqa: F401
from modules.data_quality_schema import _DDL as _DDL  # noqa: F401
from modules.data_quality_schema import _ESCALATION_COLUMNS as _ESCALATION_COLUMNS  # noqa: F401
from modules.data_quality_schema import _PRUNE_EVERY_MS as _PRUNE_EVERY_MS  # noqa: F401
from modules.data_quality_schema import Escalation as Escalation  # noqa: F401
from modules.data_quality_schema import _dt as _dt  # noqa: F401
from modules.data_quality_schema import _now_ms as _now_ms  # noqa: F401

log = logging.getLogger("alphaengine.data_quality")


class DataQualityLedger(DataQualityRulesMixin, DataQualityReadMixin):
    """The quality ledger on whichever backend is configured.

    Composed rather than inheriting `SqliteStore`, for the reason the other two
    stores were converted: inheritance made SQLite the definition of the class
    instead of a setting.

    This store was the hardest of the three because most of its read path is
    aggregate — `GROUP BY provider`, `SUM(CASE WHEN passed=0 …)` — and PostgREST
    expresses neither. Those two live in Postgres as `data_quality_rollup` and
    `data_quality_provider_stats`; everything else goes through the row
    interface both backends share.
    """

    def __init__(
        self,
        store: Any,
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
        self._store = SqliteStore(store) if isinstance(store, (str, Path)) else store
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
        self._store.migrate(_DDL)
        self._add_missing_escalation_columns()

    @property
    def backend(self) -> str:
        return self._store.backend

    def close(self) -> None:
        self._store.close()

    # -- raw SQL, and the reason it is guarded ----------------------------- #
    #
    # These four exist because most of this store's read path is aggregate and
    # SQLite can express it directly. On Postgres the same questions are asked
    # through `data_quality_rollup` and `data_quality_provider_stats`, so any
    # call that reaches these on a Postgres backend is a path that was NOT
    # ported — and it must say so rather than fail with an AttributeError three
    # frames down.

    def _require_sqlite(self, what: str) -> None:
        if self._store.backend != "sqlite":
            raise NotImplementedError(
                f"{what} has no PostgREST form; it is answered by an RPC on the "
                f"postgres backend and this path should not have been reached"
            )

    def _sql_query(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        self._require_sqlite("this query")
        return self._store.query(sql, params)

    def _sql_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        self._require_sqlite("this query")
        return self._store.one(sql, params)

    def _sql_execute(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        self._require_sqlite("this statement")
        return self._store.execute(sql, params)

    def _sql_many(self, sql: str, rows: list[tuple[Any, ...]]) -> None:
        self._require_sqlite("this statement")
        self._store.executemany(sql, rows)

    def _provider_stats(self, provider: str, since: float) -> dict[str, int]:
        """Evaluated / failed / fatal counts for one provider in one window.

        SUM(CASE WHEN …) on SQLite; `data_quality_provider_stats` on Postgres.
        The two are pinned to the same three names by
        tests/test_data_quality_rollup.py.
        """
        if self._store.backend == "postgres":
            got = self._store.rpc("data_quality_provider_stats", {
                "p_desk_id": self._store.desk_id, "p_provider": provider, "p_since": since,
            }) or {}
        else:
            got = self._store.one(
                """
                SELECT COUNT(*) AS evaluated,
                       SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN fatal>0 THEN 1 ELSE 0 END) AS fatal_findings
                FROM data_quality_findings WHERE provider=? AND observed_at>=?
                """,
                (provider, since),
            ) or {}
        return {
            "evaluated": int(got.get("evaluated") or 0),
            "failed": int(got.get("failed") or 0),
            "fatal_findings": int(got.get("fatal_findings") or 0),
        }

    def _add_missing_escalation_columns(self) -> None:
        """Add columns to a table that already exists on disk.

        `migrate` only runs CREATE TABLE IF NOT EXISTS, so a column added after
        the table shipped never appears on an existing data volume. Same shape
        as `audit.py`'s subscriber migration: read the columns, add what is
        missing, leave what is there.
        """
        if self._store.backend != "sqlite":
            # Postgres declares acknowledged_at/acknowledged_by in the
            # migration, so there is nothing to add and no PRAGMA to read.
            return
        existing = {
            str(row["name"]).lower()
            for row in self._store.query("PRAGMA table_info(data_quality_escalations)")
        }
        for column, sql_type in _ESCALATION_COLUMNS:
            if column not in existing:
                self._store.execute(f"ALTER TABLE data_quality_escalations ADD COLUMN {column} {sql_type}")

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
        row = self._sql_one(
            "SELECT id, acknowledged_at FROM data_quality_escalations "
            "WHERE id=? AND resolved_at IS NULL",
            (escalation_id,),
        )
        if row is None:
            return False
        if row["acknowledged_at"] is not None:
            return True
        self._sql_execute(
            "UPDATE data_quality_escalations SET acknowledged_at=?, acknowledged_by=? WHERE id=?",
            (time.time() * 1000.0, actor[:120], escalation_id),
        )
        return True

    @classmethod
    def in_memory(cls, **kwargs: Any) -> "DataQualityLedger":
        return cls(":memory:", **kwargs)


_ledger: DataQualityLedger | None = None


def get_data_quality() -> DataQualityLedger:
    global _ledger
    if _ledger is None:
        _ledger = DataQualityLedger(get_data_ops_store())
    return _ledger

log = logging.getLogger("alphaengine.data_quality")
