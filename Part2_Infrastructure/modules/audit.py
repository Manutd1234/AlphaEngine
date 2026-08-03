"""
Immutable-by-convention audit log (DuckDB, SQLite fallback).
============================================================

Every risk decision, kill-switch event, TCA snapshot and backtest run is written
here. The table set is intentionally append-only: nothing in the application
issues UPDATE or DELETE against ``orders``/``risk_events``, so the log can be
replayed to reconstruct the exact state the gateway was in when it accepted or
rejected any order — which is what a compliance review actually asks for.

DuckDB is used because the same file is directly queryable with analytical SQL
(``SELECT quantile(latency_ms, 0.99) FROM orders``) without an ETL step. A
single connection guarded by a lock is used; all writes are dispatched off the
event loop via ``asyncio.to_thread`` by the callers that care about latency.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings

log = logging.getLogger("alphaengine.audit")

_DDL = [
    """
    CREATE TABLE IF NOT EXISTS orders (
        ts              TIMESTAMP,
        order_id        VARCHAR,
        client_order_id VARCHAR,
        strategy        VARCHAR,
        symbol          VARCHAR,
        side            VARCHAR,
        order_type      VARCHAR,
        quantity        DOUBLE,
        notional        DOUBLE,
        limit_price     DOUBLE,
        accepted        BOOLEAN,
        rejected_by     VARCHAR,
        reason          VARCHAR,
        latency_ms      DOUBLE,
        fill_price      DOUBLE,
        fill_qty        DOUBLE,
        fee_usd         DOUBLE,
        slippage_bps    DOUBLE,
        venue           VARCHAR,
        checks_json     VARCHAR,
        source          VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS risk_events (
        ts        TIMESTAMP,
        event     VARCHAR,
        severity  VARCHAR,
        actor     VARCHAR,
        symbol    VARCHAR,
        detail    VARCHAR,
        payload   VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tca_snapshots (
        ts             TIMESTAMP,
        symbol         VARCHAR,
        venue          VARCHAR,
        best_bid       DOUBLE,
        best_ask       DOUBLE,
        mid            DOUBLE,
        spread_bps     DOUBLE,
        depth_usd_bid  DOUBLE,
        depth_usd_ask  DOUBLE,
        probe_notional DOUBLE,
        buy_slip_bps   DOUBLE,
        sell_slip_bps  DOUBLE,
        synthetic      BOOLEAN
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS backtest_runs (
        ts            TIMESTAMP,
        job_id        VARCHAR,
        symbol        VARCHAR,
        interval      VARCHAR,
        strategy      VARCHAR,
        engine        VARCHAR,
        combos_tested INTEGER,
        best_fast     INTEGER,
        best_slow     INTEGER,
        sharpe        DOUBLE,
        total_return  DOUBLE,
        max_drawdown  DOUBLE,
        dsr           DOUBLE,
        oos_sharpe    DOUBLE,
        duration_s    DOUBLE,
        request_json  VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        job_id       VARCHAR,
        kind         VARCHAR,
        status       VARCHAR,
        submitted_at TIMESTAMP,
        finished_at  TIMESTAMP,
        backend      VARCHAR,
        error        VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS subscribers (
        chat_id       VARCHAR,
        username      VARCHAR,
        subscribed_at TIMESTAMP,
        alerts        BOOLEAN,
        watches       VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ohlcv_cache (
        symbol   VARCHAR,
        interval VARCHAR,
        ts       TIMESTAMP,
        open     DOUBLE,
        high     DOUBLE,
        low      DOUBLE,
        close    DOUBLE,
        volume   DOUBLE
    )
    """,
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuditLog:
    """Thin, thread-safe wrapper over DuckDB with a SQLite fallback."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = Path(db_path or settings.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._closed = False
        self.backend = "duckdb"
        self._conn = self._connect()
        self._migrate()

    # -- connection ------------------------------------------------------- #
    def _connect(self):
        try:
            import duckdb

            return duckdb.connect(str(self.db_path))
        except Exception as exc:  # pragma: no cover - environment dependent
            log.warning("DuckDB unavailable (%s); falling back to SQLite", exc)
            import sqlite3

            self.backend = "sqlite"
            return sqlite3.connect(str(self.db_path.with_suffix(".sqlite")), check_same_thread=False)

    def _migrate(self) -> None:
        with self._lock:
            for ddl in _DDL:
                stmt = ddl
                if self.backend == "sqlite":
                    stmt = stmt.replace("TIMESTAMP", "TEXT").replace("DOUBLE", "REAL")
                self._conn.execute(stmt)
            if self.backend == "sqlite":
                self._conn.commit()

    # -- primitives ------------------------------------------------------- #
    def _exec(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        # A worker thread can outlive shutdown; writing to a closed handle is an
        # expected race, not an incident. Drop it quietly rather than log-spam.
        if self._closed:
            log.debug("audit write after close ignored")
            return
        if self.backend == "sqlite":
            sql = sql.replace("?", "?")
            params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)
        try:
            with self._lock:
                self._conn.execute(sql, params)
                if self.backend == "sqlite":
                    self._conn.commit()
        except Exception as exc:  # never let audit failures break the trade path
            log.error("audit write failed: %s", exc)

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        if self._closed:
            return []
        try:
            with self._lock:
                cur = self._conn.execute(sql, params)
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall()
            return [dict(zip(cols, row)) for row in rows]
        except Exception as exc:
            log.error("audit query failed: %s", exc)
            return []

    # -- writers ---------------------------------------------------------- #
    def record_order(self, decision, request, source: str = "api") -> None:
        fill = decision.fill
        self._exec(
            """INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                decision.timestamp.replace(tzinfo=None),
                decision.order_id,
                decision.client_order_id,
                getattr(request, "strategy", "manual"),
                decision.symbol,
                decision.side,
                getattr(request, "order_type", "MARKET"),
                decision.quantity,
                decision.notional,
                getattr(request, "limit_price", None),
                decision.accepted,
                ",".join(decision.rejected_by) or None,
                decision.reason,
                decision.latency_ms,
                fill.price if fill else None,
                fill.quantity if fill else None,
                fill.fee_usd if fill else None,
                fill.slippage_bps if fill else None,
                fill.venue if fill else None,
                json.dumps([c.model_dump() for c in decision.checks]),
                source,
            ),
        )

    def record_risk_event(
        self,
        event: str,
        *,
        severity: str = "info",
        actor: str = "system",
        symbol: str | None = None,
        detail: str = "",
        payload: dict[str, Any] | None = None,
    ) -> None:
        self._exec(
            "INSERT INTO risk_events VALUES (?,?,?,?,?,?,?)",
            (_utcnow(), event, severity, actor, symbol, detail, json.dumps(payload or {}, default=str)),
        )

    def record_tca_snapshot(self, row: dict[str, Any]) -> None:
        self._exec(
            "INSERT INTO tca_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                _utcnow(),
                row.get("symbol"),
                row.get("venue"),
                row.get("best_bid"),
                row.get("best_ask"),
                row.get("mid"),
                row.get("spread_bps"),
                row.get("depth_usd_bid"),
                row.get("depth_usd_ask"),
                row.get("probe_notional"),
                row.get("buy_slip_bps"),
                row.get("sell_slip_bps"),
                bool(row.get("synthetic", False)),
            ),
        )

    def record_backtest(self, result, duration_s: float) -> None:
        best = result.best
        self._exec(
            "INSERT INTO backtest_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                _utcnow(),
                result.job_id,
                result.request.symbol,
                result.request.interval,
                result.request.strategy,
                result.engine,
                result.combos_tested,
                best.fast,
                best.slow,
                best.sharpe,
                best.total_return,
                best.max_drawdown,
                result.deflated_sharpe_ratio,
                result.walk_forward_oos_sharpe,
                duration_s,
                result.request.model_dump_json(),
            ),
        )

    def record_job(self, job_id: str, kind: str, status: str, submitted_at, finished_at, backend: str, error) -> None:
        self._exec(
            "INSERT INTO jobs VALUES (?,?,?,?,?,?,?)",
            (job_id, kind, status, submitted_at, finished_at, backend, error),
        )

    # -- Notification subscribers ----------------------------------------- #
    # Kept in the same store as everything else so a restart does not silently
    # stop delivering risk alerts — the failure mode where nobody notices the
    # kill switch tripped because the alert list was in memory.
    def upsert_subscriber(self, chat_id: str, username: str | None,
                          alerts: bool = True, watches: list[dict] | None = None) -> None:
        existing = self.get_subscriber(chat_id)
        payload = json.dumps(watches if watches is not None else (existing or {}).get("watches", []))
        self._exec("DELETE FROM subscribers WHERE chat_id = ?", (str(chat_id),))
        self._exec(
            "INSERT INTO subscribers VALUES (?,?,?,?,?)",
            (str(chat_id), username,
             (existing or {}).get("subscribed_at") or _utcnow(), alerts, payload),
        )

    def get_subscriber(self, chat_id: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM subscribers WHERE chat_id = ?", (str(chat_id),))
        if not rows:
            return None
        row = rows[0]
        row["watches"] = json.loads(row.get("watches") or "[]")
        return row

    def list_subscribers(self, alerts_only: bool = True) -> list[dict[str, Any]]:
        sql = "SELECT * FROM subscribers" + (" WHERE alerts" if alerts_only else "")
        rows = self.query(sql)
        for row in rows:
            row["watches"] = json.loads(row.get("watches") or "[]")
        return rows

    def remove_subscriber(self, chat_id: str) -> None:
        self._exec("DELETE FROM subscribers WHERE chat_id = ?", (str(chat_id),))

    # -- OHLCV cache ------------------------------------------------------ #
    def cache_ohlcv(self, symbol: str, interval: str, rows: list[tuple]) -> None:
        if not rows or self._closed:
            return
        self._exec("DELETE FROM ohlcv_cache WHERE symbol = ? AND interval = ?", (symbol, interval))
        try:
            with self._lock:
                self._conn.executemany(
                    "INSERT INTO ohlcv_cache VALUES (?,?,?,?,?,?,?,?)",
                    [(symbol, interval, *r) for r in rows],
                )
                if self.backend == "sqlite":
                    self._conn.commit()
        except Exception as exc:
            log.error("ohlcv cache write failed: %s", exc)

    def load_ohlcv(self, symbol: str, interval: str, limit: int) -> list[dict[str, Any]]:
        return self.query(
            "SELECT ts, open, high, low, close, volume FROM ohlcv_cache "
            "WHERE symbol = ? AND interval = ? ORDER BY ts DESC LIMIT ?",
            (symbol, interval, limit),
        )

    # -- read models used by the UI --------------------------------------- #
    def recent_orders(self, limit: int = 50) -> list[dict[str, Any]]:
        return self.query(
            "SELECT ts, order_id, symbol, side, quantity, notional, accepted, rejected_by, reason, "
            "latency_ms, fill_price, slippage_bps, venue, source "
            "FROM orders ORDER BY ts DESC LIMIT ?",
            (limit,),
        )

    def recent_events(self, limit: int = 50) -> list[dict[str, Any]]:
        return self.query(
            "SELECT ts, event, severity, actor, symbol, detail FROM risk_events ORDER BY ts DESC LIMIT ?",
            (limit,),
        )

    def recent_backtests(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.query(
            "SELECT ts, job_id, symbol, interval, strategy, best_fast, best_slow, sharpe, "
            "total_return, max_drawdown, dsr, oos_sharpe, duration_s "
            "FROM backtest_runs ORDER BY ts DESC LIMIT ?",
            (limit,),
        )

    def execution_stats(self) -> dict[str, Any]:
        rows = self.query(
            "SELECT count(*) AS total, "
            "sum(CASE WHEN accepted THEN 1 ELSE 0 END) AS accepted, "
            "avg(latency_ms) AS avg_latency_ms, "
            "max(latency_ms) AS max_latency_ms, "
            "avg(slippage_bps) AS avg_slippage_bps, "
            "sum(fee_usd) AS total_fees "
            "FROM orders"
        )
        return rows[0] if rows else {}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            try:
                self._conn.close()
            except Exception:
                pass


_audit: AuditLog | None = None


def get_audit() -> AuditLog:
    global _audit
    if _audit is None:
        _audit = AuditLog()
    return _audit
