"""
Immutable-by-convention audit log (DuckDB, SQLite fallback).
============================================================

Every risk decision, kill-switch event, TCA snapshot and backtest run is written
here. The table set is intentionally append-only: nothing in the application
issues UPDATE or DELETE against ``orders``/``risk_events``. Accepted fill rows
contain enough evidence to rebuild the current UTC session's paper position
book, and a ``session_rollover`` row carries the two figures that replay alone
cannot reach — what the sessions before this one banked, and the equity this one
opened on. Operational state such as an engaged kill switch is event history,
not a durable state snapshot, and is deliberately not inferred during that
replay.

``book_reset`` and ``session_rollover`` are both durable replay boundaries, read
back the same way: find the newest one inside the session window, refuse to
guess when two of them share a timestamp, and let the later one win.

DuckDB is used because the same file is directly queryable with analytical SQL
(``SELECT quantile(latency_ms, 0.99) FROM orders``) without an ETL step. A
single connection guarded by a lock is used; all writes are dispatched off the
event loop via ``asyncio.to_thread`` by the callers that care about latency.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
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
        source          VARCHAR,
        status          VARCHAR,
        time_in_force   VARCHAR,
        decided_at      TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS order_events (
        ts              TIMESTAMP,
        order_id        VARCHAR,
        client_order_id VARCHAR,
        event           VARCHAR,
        status          VARCHAR,
        symbol          VARCHAR,
        side            VARCHAR,
        order_type      VARCHAR,
        time_in_force   VARCHAR,
        quantity        DOUBLE,
        limit_price     DOUBLE,
        notional        DOUBLE,
        fill_price      DOUBLE,
        fill_qty        DOUBLE,
        fee_usd         DOUBLE,
        venue           VARCHAR,
        actor           VARCHAR,
        detail          VARCHAR,
        replaces        VARCHAR
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
        request_json  VARCHAR,
        data_hash     VARCHAR,
        label         VARCHAR,
        pbo           DOUBLE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS equity_snapshots (
        ts               TIMESTAMP,
        session_date     VARCHAR,
        equity           DOUBLE,
        start_of_day     DOUBLE,
        realized_pnl     DOUBLE,
        unrealized_pnl   DOUBLE,
        daily_pnl        DOUBLE,
        gross_exposure   DOUBLE,
        drawdown_pct     DOUBLE,
        open_positions   INTEGER,
        kill_switch      BOOLEAN
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
        watches       VARCHAR,
        user_id       VARCHAR,
        web_identity  VARCHAR,
        linked_at     TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS telegram_link_tokens (
        token_hash  VARCHAR,
        redeemed_at TIMESTAMP,
        expires_at  TIMESTAMP
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


#: Sentinel for "leave whatever is already stored alone".
#:
#: ``upsert_subscriber`` is a DELETE-then-INSERT, so any column it does not
#: carry forward is erased. ``/subscribe`` knows nothing about account linking
#: and must not unbind a chat merely by touching its alert preference — which is
#: exactly the defect a plain ``None`` default would have shipped.
_KEEP: Any = object()


def _audit_timestamp(value: Any, *, context: str) -> datetime:
    """A naive-UTC ``datetime`` from an audit column, or a refusal.

    DuckDB hands back a ``datetime``; the SQLite fallback hands back the ISO
    string it was given. Both have to become the same comparable value before a
    row can be placed on one side of a durable boundary — comparing a string
    against a ``datetime`` raises, and quietly failing to parse one would put
    every row on the wrong side of the boundary and say nothing about it.
    """
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.fromisoformat(str(value)).replace(tzinfo=None)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"invalid audit timestamp {context}: {value!r}") from exc


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

            # Subscriber delivery is authorised by Telegram *user* ID, never
            # by chat ID.  Older databases did not persist that ownership
            # metadata.  Add the column without inferring an owner from the
            # legacy ``username`` field: existing rows remain NULL and are
            # intentionally fail-closed until an authorised user explicitly
            # re-subscribes or updates their watch.
            subscriber_cursor = self._conn.execute("SELECT * FROM subscribers LIMIT 0")
            subscriber_columns = {
                str(column[0]).lower() for column in (subscriber_cursor.description or [])
            }
            if "user_id" not in subscriber_columns:
                self._conn.execute("ALTER TABLE subscribers ADD COLUMN user_id VARCHAR")

            # Which web desk pass bound this chat, and when. Same rule as the
            # column above: existing rows stay NULL, and a NULL ``web_identity``
            # grants nothing — a chat that predates linking is exactly as
            # unbound as it was before the column existed.
            #
            # ``linked_at`` rides alongside because a guest binding has to
            # expire. The desk pass it mirrors is a browser-session cookie the
            # gateway cannot watch die, so the grant carries its own clock
            # instead of an unbounded one nobody can revoke.
            for column, sql_type in (("web_identity", "VARCHAR"), ("linked_at", "TIMESTAMP")):
                if column not in subscriber_columns:
                    self._conn.execute(
                        f"ALTER TABLE subscribers ADD COLUMN {column} "  # noqa: S608
                        f"{'TEXT' if self.backend == 'sqlite' and sql_type == 'TIMESTAMP' else sql_type}"
                    )

            # Reproducibility metadata added after the first databases existed.
            # Older rows keep NULL rather than being back-filled with a guess: a
            # fabricated data hash would claim two runs saw the same bars.
            run_cursor = self._conn.execute("SELECT * FROM backtest_runs LIMIT 0")
            run_columns = {str(column[0]).lower() for column in (run_cursor.description or [])}
            for column, sql_type in (("data_hash", "VARCHAR"), ("label", "VARCHAR"), ("pbo", "DOUBLE")):
                if column not in run_columns:
                    self._conn.execute(
                        f"ALTER TABLE backtest_runs ADD COLUMN {column} "  # noqa: S608
                        f"{'REAL' if self.backend == 'sqlite' and sql_type == 'DOUBLE' else sql_type}"
                    )

            # Order lifecycle columns added when resting orders arrived. Legacy
            # rows keep NULL rather than being back-filled: before this schema
            # every accepted order filled in the same call, so a NULL status is
            # correctly read as "filled" by the blotter and — importantly — is
            # still treated as ambiguous by the rehydration guard below, which
            # fails closed on an accepted row with no fill evidence.
            order_cursor = self._conn.execute("SELECT * FROM orders LIMIT 0")
            order_columns = {str(column[0]).lower() for column in (order_cursor.description or [])}
            for column, sql_type in (
                ("status", "VARCHAR"),
                ("time_in_force", "VARCHAR"),
                ("decided_at", "TIMESTAMP"),
            ):
                if column not in order_columns:
                    self._conn.execute(
                        f"ALTER TABLE orders ADD COLUMN {column} "  # noqa: S608
                        f"{'TEXT' if self.backend == 'sqlite' and sql_type == 'TIMESTAMP' else sql_type}"
                    )

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
            return [dict(zip(cols, row, strict=True)) for row in rows]
        except Exception as exc:
            log.error("audit query failed: %s", exc)
            return []

    def health(self) -> dict[str, Any]:
        """Cheap process-local storage state without exposing its filesystem path.

        The operations snapshot is polled frequently, so it must not contend
        with order-path writes by issuing a probe query on every request. An
        open connection reports available; write failures remain authoritative
        in the audit error logs and metrics.
        """
        return {"backend": self.backend, "available": not self._closed}

    def accepted_fills_for_session(self, session_date: str) -> list[dict[str, Any]]:
        """Return ordered accepted fills for one UTC session, after its last reset.

        This is the strict read path used to rebuild risk state. Unlike the
        operator-facing ``query`` helper it raises on a closed or unreadable
        audit store: silently treating an audit failure as a flat book would
        understate exposure. ``book_reset`` is a durable replay boundary, so a
        reset remains a reset after process restart.

        Only same-day fills are returned. Everything a restarted gateway needs
        from *earlier* sessions is two numbers, and they come from
        ``latest_session_rollover`` instead: the P&L those sessions banked and
        the equity this one opened on. Overnight *positions* are still not
        reconstructed — that needs a durable position snapshot this schema does
        not carry.
        """
        try:
            start = datetime.strptime(session_date, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"invalid UTC session date: {session_date!r}") from exc
        end = start + timedelta(days=1)

        if self._closed:
            raise RuntimeError("audit store is closed")

        params: tuple[Any, ...] = (start, end)
        if self.backend == "sqlite":
            params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)

        try:
            with self._lock:
                reset_cur = self._conn.execute(
                    "SELECT max(ts) AS reset_at FROM risk_events "
                    "WHERE event = 'book_reset' AND ts >= ? AND ts < ?",
                    params,
                )
                reset_row = reset_cur.fetchone()
                reset_at = reset_row[0] if reset_row else None

                # `status IS NULL OR status = 'FILLED'` rather than a fill_qty
                # test. An accepted order that was cancelled or expired never
                # filled by design, and letting it through would make the caller
                # treat missing fill evidence as corruption and refuse to start.
                # Legacy rows carry a NULL status and keep failing closed on that
                # same check, which is the behaviour that guard was written for.
                cur = self._conn.execute(
                    "SELECT ts, order_id, symbol, side, fill_qty, fill_price, fee_usd "
                    "FROM orders WHERE accepted AND (status IS NULL OR status = 'FILLED') "
                    "AND ts >= ? AND ts < ? "
                    "ORDER BY ts ASC, order_id ASC",
                    params,
                )
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]
        except Exception as exc:
            raise RuntimeError("could not read accepted fills for position rehydration") from exc

        if reset_at is None:
            return rows

        reset_time = _audit_timestamp(reset_at, context="during position rehydration")
        out: list[dict[str, Any]] = []
        for row in rows:
            fill_time = _audit_timestamp(row.get("ts"), context="during position rehydration")
            if fill_time == reset_time:
                # The schema has timestamps but no cross-table sequence number.
                # Guessing whether this fill happened before or after the reset
                # could resurrect a position, so fail closed on the ambiguity.
                raise RuntimeError("fill and book reset share an ambiguous audit timestamp")
            if fill_time > reset_time:
                out.append(row)
        return out

    def has_activity_before(self, session_date: str) -> bool:
        """Did this audit store record anything at all before ``session_date``?

        The question ``latest_session_rollover`` cannot answer. It returns
        ``None`` for two opposite claims — "no session has ever closed here" and
        "a session closed while this process was down" — and a caller that reads
        both as the first hands a restarted gateway a clean slate it has not
        earned: nothing banked, opened on the configured starting balance, and
        therefore an entirely unspent drawdown budget after a week of losses.

        A process that was down across 00:00 UTC leaves exactly this trace: rows
        it wrote before the boundary, and no rollover record for the session it
        woke up in, because nothing was running to write one.
        """
        try:
            start = datetime.strptime(session_date, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"invalid UTC session date: {session_date!r}") from exc

        if self._closed:
            raise RuntimeError("audit store is closed")

        params: tuple[Any, ...] = (start, start)
        if self.backend == "sqlite":
            params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)

        try:
            with self._lock:
                cur = self._conn.execute(
                    "SELECT ("
                    "  (SELECT count(*) FROM orders WHERE ts < ?)"
                    "  + (SELECT count(*) FROM risk_events WHERE ts < ?)"
                    ") AS earlier",
                    params,
                )
                row = cur.fetchone()
        except Exception as exc:
            raise RuntimeError("could not check the audit store for earlier sessions") from exc

        return bool(row and row[0])

    def latest_session_rollover(self, session_date: str) -> dict[str, Any] | None:
        """The durable rollover record that opened one UTC session, after its last reset.

        The companion of ``accepted_fills_for_session``, and strict for the same
        reason: the replay covers *this* session's fills, so the P&L banked by
        every session before it and the equity this one opened on reach a
        restarted process only through this row. Read them wrong and the paper
        account moves without a trade behind it.

        ``None`` means no record, which is not an error — a first-ever session,
        or a restart before this session's first rollover, genuinely has nothing
        banked. An *unreadable* record is a different claim and raises; the
        caller decides what to do with the difference.

        ``book_reset`` is the other durable boundary in this table and it wins
        when it is the later of the two: a reset puts the paper account back on
        its opening balance, so a rollover it superseded would re-credit money
        the reset has already written off. An exact tie is refused rather than
        guessed at, exactly as a fill tying with a reset is.
        """
        try:
            start = datetime.strptime(session_date, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"invalid UTC session date: {session_date!r}") from exc
        end = start + timedelta(days=1)

        if self._closed:
            raise RuntimeError("audit store is closed")

        params: tuple[Any, ...] = (start, end)
        if self.backend == "sqlite":
            params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)

        try:
            with self._lock:
                reset_cur = self._conn.execute(
                    "SELECT max(ts) AS reset_at FROM risk_events "
                    "WHERE event = 'book_reset' AND ts >= ? AND ts < ?",
                    params,
                )
                reset_row = reset_cur.fetchone()
                reset_at = reset_row[0] if reset_row else None

                # Newest first, one row. The table is append-only and the roll
                # fires on a date-string inequality, so more than one record can
                # land in a single session's window; the last one written is the
                # one whose figures the session is actually running on.
                cur = self._conn.execute(
                    "SELECT ts, payload FROM risk_events "
                    "WHERE event = 'session_rollover' AND ts >= ? AND ts < ? "
                    "ORDER BY ts DESC LIMIT 1",
                    params,
                )
                row = cur.fetchone()
        except Exception as exc:
            raise RuntimeError("could not read the durable session rollover record") from exc

        if row is None:
            return None

        rollover_at = _audit_timestamp(row[0], context="on the session rollover record")
        if reset_at is not None:
            reset_time = _audit_timestamp(reset_at, context="on the book reset boundary")
            if rollover_at == reset_time:
                raise RuntimeError(
                    "session rollover and book reset share an ambiguous audit timestamp"
                )
            if rollover_at < reset_time:
                return None

        try:
            payload = json.loads(row[1] or "")
        except (TypeError, ValueError) as exc:
            raise RuntimeError("session rollover record has an unreadable payload") from exc
        if not isinstance(payload, dict):
            raise RuntimeError(f"session rollover record has a non-object payload: {payload!r}")
        return payload

    # -- writers ---------------------------------------------------------- #
    def record_order(
        self,
        decision,
        request,
        source: str = "api",
        *,
        outcome_at: datetime | None = None,
    ) -> None:
        """One row per order, written once, when the order reaches a terminal state.

        Named columns, not positional. ``record_backtest`` learned this the hard
        way: a positional INSERT silently writes the wrong value into the wrong
        column the first time the schema widens, and this table has now widened
        twice.

        ``ts`` is when the recorded outcome happened; ``decided_at`` is when the
        gates ran. For a MARKET order they are the same instant, which is why
        every pre-existing row stays correct. For a resting order they are not,
        and the blotter has to show the fill when it filled rather than an hour
        earlier when the order was accepted.
        """
        fill = decision.fill
        decided_at = decision.timestamp.replace(tzinfo=None)
        self._exec(
            """INSERT INTO orders (
                ts, order_id, client_order_id, strategy, symbol, side, order_type,
                quantity, notional, limit_price, accepted, rejected_by, reason,
                latency_ms, fill_price, fill_qty, fee_usd, slippage_bps, venue,
                checks_json, source, status, time_in_force, decided_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                (outcome_at.replace(tzinfo=None) if outcome_at else decided_at),
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
                json.dumps([asdict(c) for c in decision.checks]),
                source,
                getattr(decision, "status", None),
                getattr(decision, "time_in_force", None),
                decided_at,
            ),
        )

    def record_order_event(
        self,
        *,
        order_id: str,
        event: str,
        status: str,
        symbol: str,
        side: str,
        order_type: str = "LIMIT",
        time_in_force: str | None = None,
        quantity: float | None = None,
        limit_price: float | None = None,
        notional: float | None = None,
        fill_price: float | None = None,
        fill_qty: float | None = None,
        fee_usd: float | None = None,
        venue: str | None = None,
        client_order_id: str | None = None,
        actor: str = "system",
        detail: str = "",
        replaces: str | None = None,
        at: datetime | None = None,
    ) -> None:
        """One row per transition, appended and never revised.

        The ``orders`` table carries the outcome; this carries how the order got
        there. Keeping them apart is what lets ``orders`` stay one-row-per-order
        without the table ever being UPDATEd — which is the property the whole
        replay path depends on.
        """
        self._exec(
            """INSERT INTO order_events (
                ts, order_id, client_order_id, event, status, symbol, side, order_type,
                time_in_force, quantity, limit_price, notional, fill_price, fill_qty,
                fee_usd, venue, actor, detail, replaces
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                (at.replace(tzinfo=None) if at else _utcnow()),
                order_id, client_order_id, event, status, symbol, side, order_type,
                time_in_force, quantity, limit_price, notional, fill_price, fill_qty,
                fee_usd, venue, actor, detail, replaces,
            ),
        )

    def order_timeline(self, order_id: str) -> list[dict[str, Any]]:
        """Every transition one order made, oldest first."""
        return self.query(
            "SELECT ts, order_id, client_order_id, event, status, symbol, side, order_type, "
            "time_in_force, quantity, limit_price, notional, fill_price, fill_qty, fee_usd, "
            "venue, actor, detail, replaces "
            "FROM order_events WHERE order_id = ? ORDER BY ts ASC",
            (order_id,),
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

    def record_book_reset(self, actor: str) -> None:
        """Persist the replay boundary before the in-memory book is cleared.

        This write is intentionally strict. If it fails, ``RiskGateway`` leaves
        the current positions intact rather than clearing them now and silently
        resurrecting them on the next restart.
        """
        if self._closed:
            raise RuntimeError("audit store is closed")
        try:
            with self._lock:
                params: tuple[Any, ...] = (
                    _utcnow(), "book_reset", "info", actor, None,
                    "paper book flattened", json.dumps({}),
                )
                if self.backend == "sqlite":
                    params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)
                self._conn.execute("INSERT INTO risk_events VALUES (?,?,?,?,?,?,?)", params)
                if self.backend == "sqlite":
                    self._conn.commit()
        except Exception as exc:
            raise RuntimeError("could not persist the book reset replay boundary") from exc

    def record_session_rollover(
        self,
        session_date: str,
        *,
        carried_realized_pnl: float,
        start_of_day_equity: float,
        unrealized_at_rollover: float,
        at: datetime,
    ) -> None:
        """Persist the session boundary before the in-memory book crosses it.

        Strict for the same reason ``record_book_reset`` is, and the failure it
        prevents is that one's mirror image. A lost reset resurrects positions on
        the next restart; a lost rollover *deletes* money — the gateway banks the
        closing session's P&L in memory only, and the next restart replays the new
        session's fills against an opening balance that has forgotten every
        session before it. Equity then steps down by the whole carry with no order
        behind it, *inside* one session's curve, where nothing can explain it.
        ``record_risk_event`` would have swallowed that write failure and logged
        it, which is why this does not go through it.

        ``at`` is the clock reading that decided the roll, not a second one taken
        here. The row has to land inside the session window it opens, and a
        rollover that ran across 00:00 would otherwise be filed under the
        following day — a record nobody will ever query for is a record that does
        not exist.
        """
        if self._closed:
            raise RuntimeError("audit store is closed")
        try:
            with self._lock:
                params: tuple[Any, ...] = (
                    at.replace(tzinfo=None), "session_rollover", "info", "system", None,
                    f"session {session_date} opened",
                    json.dumps({
                        "session_date": session_date,
                        "carried_realized_pnl": carried_realized_pnl,
                        "start_of_day_equity": start_of_day_equity,
                        # Recorded separately because it is the one term of that
                        # baseline a restart cannot reproduce. `start_of_day_equity`
                        # includes the mark of positions open across the boundary,
                        # and the replay covers one UTC day, so those positions come
                        # back empty. A reader that applied the baseline whole would
                        # measure a smaller book against a larger opening balance and
                        # publish the difference as a loss nobody took.
                        "unrealized_at_rollover": unrealized_at_rollover,
                    }),
                )
                if self.backend == "sqlite":
                    params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)
                self._conn.execute("INSERT INTO risk_events VALUES (?,?,?,?,?,?,?)", params)
                if self.backend == "sqlite":
                    self._conn.commit()
        except Exception as exc:
            raise RuntimeError("could not persist the session rollover replay boundary") from exc

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
        # Named columns, not positional: this table now grows as reproducibility
        # metadata is added, and a positional INSERT silently writes the wrong
        # value into the wrong column the first time the schema widens.
        self._exec(
            "INSERT INTO backtest_runs "
            "(ts, job_id, symbol, interval, strategy, engine, combos_tested, best_fast, best_slow, "
            " sharpe, total_return, max_drawdown, dsr, oos_sharpe, duration_s, request_json, "
            " data_hash, label, pbo) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
                getattr(result, "data_hash", None),
                getattr(result.request, "label", None),
                getattr(result, "overfitting_probability", None),
            ),
        )

    def record_equity_snapshot(self, state) -> None:
        """Persist one mark-to-market observation of the book.

        The gateway serves the *current* equity; without this the curve exists
        only for as long as a browser tab stays open, so nobody can review what
        the book looked like when a limit was approached. Written from the risk
        monitor's existing mark loop, so a snapshot costs no extra valuation.
        """
        self._exec(
            "INSERT INTO equity_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                _utcnow(),
                state.session_date,
                state.equity,
                state.start_of_day_equity,
                state.realized_pnl,
                state.unrealized_pnl,
                state.daily_pnl,
                state.gross_exposure,
                state.daily_drawdown_pct,
                len(state.positions),
                bool(state.kill_switch_active),
            ),
        )

    def equity_history(self, limit: int = 500, session_date: str | None = None) -> list[dict[str, Any]]:
        """Oldest-first equity observations, newest ``limit`` rows.

        Ordered ascending because every consumer plots it; the inner query takes
        the most recent rows so a long-running gateway does not stream its whole
        history to draw one chart.
        """
        if session_date:
            rows = self.query(
                "SELECT * FROM (SELECT ts, session_date, equity, start_of_day, realized_pnl, "
                "unrealized_pnl, daily_pnl, gross_exposure, drawdown_pct, open_positions, kill_switch "
                "FROM equity_snapshots WHERE session_date = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
                (session_date, limit),
            )
        else:
            rows = self.query(
                "SELECT * FROM (SELECT ts, session_date, equity, start_of_day, realized_pnl, "
                "unrealized_pnl, daily_pnl, gross_exposure, drawdown_pct, open_positions, kill_switch "
                "FROM equity_snapshots ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
                (limit,),
            )
        return rows

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
                          alerts: bool = True, watches: list[dict] | None = None,
                          *, user_id: str | None = None,
                          web_identity: Any = _KEEP, linked_at: Any = _KEEP) -> None:
        existing = self.get_subscriber(chat_id) or {}
        payload = json.dumps(watches if watches is not None else existing.get("watches", []))
        owner_id = str(user_id) if user_id is not None else None
        identity = existing.get("web_identity") if web_identity is _KEEP else web_identity
        bound_at = existing.get("linked_at") if linked_at is _KEEP else linked_at
        self._exec("DELETE FROM subscribers WHERE chat_id = ?", (str(chat_id),))
        self._exec(
            "INSERT INTO subscribers "
            "(chat_id, username, subscribed_at, alerts, watches, user_id, web_identity, linked_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (str(chat_id), username,
             existing.get("subscribed_at") or _utcnow(), alerts, payload, owner_id,
             identity, bound_at),
        )

    def web_bindings(self) -> list[dict[str, Any]]:
        """Every chat bound to a web desk pass, with its Telegram owner and age.

        ``linked_at`` is normalised here rather than by the caller, for the
        reason ``_audit_timestamp`` exists: DuckDB returns a ``datetime`` and the
        SQLite fallback returns the ISO string it was handed, and an expiry
        policy comparing one against the other either raises or silently expires
        nothing at all.

        A row whose timestamp is missing or unreadable is dropped, not repaired.
        A binding that cannot be aged is a binding that could never be revoked.
        """
        rows = self.query(
            "SELECT chat_id, user_id, web_identity, linked_at FROM subscribers "
            "WHERE web_identity IS NOT NULL AND user_id IS NOT NULL"
        )
        bindings: list[dict[str, Any]] = []
        for row in rows:
            try:
                row["linked_at"] = _audit_timestamp(
                    row.get("linked_at"), context="subscribers.linked_at"
                )
            except RuntimeError as exc:
                log.error("dropping unreadable web binding: %s", exc)
                continue
            bindings.append(row)
        return bindings

    def claim_link_token(self, token_hash: str, expires_at: datetime) -> bool:
        """Spend a one-time link token. ``False`` if it was already spent.

        The read and the write are one critical section, which is the whole
        point: two ``/start`` messages carrying the same token — a double tap, a
        forwarded link — would otherwise both find an empty ledger and both
        bind. ``_exec``/``query`` each take the lock themselves, so this cannot
        be built from them without releasing it in between.

        Only the hash is stored. The ledger outlives the token it describes, and
        an audit file holding live credentials is a second place to leak them.

        Expired rows are pruned on the way past: this table only has to remember
        a token for as long as the token itself could still be presented.
        """
        if self._closed:
            return False
        now = _utcnow()
        stamp = now.isoformat() if self.backend == "sqlite" else now
        expiry = expires_at.isoformat() if self.backend == "sqlite" else expires_at
        try:
            with self._lock:
                self._conn.execute(
                    "DELETE FROM telegram_link_tokens WHERE expires_at < ?", (stamp,)
                )
                cursor = self._conn.execute(
                    "SELECT count(*) FROM telegram_link_tokens WHERE token_hash = ?",
                    (token_hash,),
                )
                already = int((cursor.fetchone() or [0])[0])
                if not already:
                    self._conn.execute(
                        "INSERT INTO telegram_link_tokens VALUES (?,?,?)",
                        (token_hash, stamp, expiry),
                    )
                if self.backend == "sqlite":
                    self._conn.commit()
            return not already
        except Exception as exc:
            # Fail closed. An unreadable ledger cannot prove a token is unspent,
            # and "probably fine" is not a property a single-use token has.
            log.error("link token claim failed: %s", exc)
            return False

    def get_subscriber(self, chat_id: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM subscribers WHERE chat_id = ?", (str(chat_id),))
        if not rows:
            return None
        row = rows[0]
        row["watches"] = json.loads(row.get("watches") or "[]")
        return row

    def list_subscribers(self, alerts_only: bool = True) -> list[dict[str, Any]]:
        # The only variable part is a fixed clause chosen by a boolean; no
        # caller-supplied value reaches the SQL text.
        sql = "SELECT * FROM subscribers" + (" WHERE alerts" if alerts_only else "")  # noqa: S608
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
        """The blotter read model.

        ``strategy``, ``client_order_id`` and the full ``checks_json`` vector are
        returned as well as the outcome: a blotter that shows *that* an order was
        rejected without showing *which gate* rejected it sends the trader to the
        logs, which is the thing the audit log exists to avoid.
        """
        return self.query(
            "SELECT ts, order_id, client_order_id, strategy, symbol, side, order_type, quantity, notional, "
            "accepted, rejected_by, reason, latency_ms, fill_price, fill_qty, fee_usd, slippage_bps, "
            "venue, checks_json, source, status, time_in_force, decided_at "
            "FROM orders ORDER BY ts DESC LIMIT ?",
            (limit,),
        )

    def recent_events(self, limit: int = 50) -> list[dict[str, Any]]:
        return self.query(
            "SELECT ts, event, severity, actor, symbol, detail FROM risk_events ORDER BY ts DESC LIMIT ?",
            (limit,),
        )

    def recent_backtests(self, limit: int = 20) -> list[dict[str, Any]]:
        """Server-side experiment history.

        ``request_json`` and ``data_hash`` are returned so a client can tell
        whether two runs tested the same idea on the same bars — the browser's
        local history has no way to know about a run made from another machine,
        and reconciling them needs the request, not just its result.
        """
        return self.query(
            "SELECT ts, job_id, symbol, interval, strategy, best_fast, best_slow, sharpe, "
            "total_return, max_drawdown, dsr, oos_sharpe, duration_s, request_json, "
            "data_hash, label, pbo "
            "FROM backtest_runs ORDER BY ts DESC LIMIT ?",
            (limit,),
        )

    def tca_history(
        self, symbol: str, venue: str | None = None, limit: int = 240
    ) -> list[dict[str, Any]]:
        """Oldest-first TCA snapshots for one symbol — the orphaned time series.

        ``record_tca_snapshot`` has been writing ``tca_snapshots`` on a timer
        with nothing ever reading it back. This is that reader: newest ``limit``
        rows taken, then returned ascending because every consumer plots them.
        ``venue`` narrows to one feed's own history when given.
        """
        if venue:
            return self.query(
                "SELECT * FROM (SELECT ts, venue, mid, spread_bps, depth_usd_bid, depth_usd_ask, "
                "buy_slip_bps, sell_slip_bps, synthetic FROM tca_snapshots "
                "WHERE symbol = ? AND venue = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
                (symbol, venue, limit),
            )
        return self.query(
            "SELECT * FROM (SELECT ts, venue, mid, spread_bps, depth_usd_bid, depth_usd_ask, "
            "buy_slip_bps, sell_slip_bps, synthetic FROM tca_snapshots "
            "WHERE symbol = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
            (symbol, limit),
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
        stats = rows[0] if rows else {}

        # Tail latency, not just the mean. An average decision time hides the
        # one order in a hundred that took long enough to miss the price, which
        # is the number an execution review actually argues about.
        if self.backend == "duckdb":
            tail = self.query(
                "SELECT quantile_cont(latency_ms, 0.5) AS p50_latency_ms, "
                "quantile_cont(latency_ms, 0.95) AS p95_latency_ms, "
                "quantile_cont(latency_ms, 0.99) AS p99_latency_ms "
                "FROM orders WHERE latency_ms IS NOT NULL"
            )
            if tail:
                stats.update(tail[0])
        return stats

    def session_costs(self, session_date: str) -> dict[str, Any]:
        """Fees and slippage actually paid during one UTC session, in dollars.

        ``execution_stats`` is lifetime and its ``avg_slippage_bps`` is an
        unweighted mean of basis points — neither can become a dollar leg of one
        day's P&L. Subtracting a lifetime fee total from a single session's P&L
        reports a loss the desk did not take, so the session figures are computed
        separately and name the day they cover.

        ``fills_without_slippage`` is the honesty field. A fill whose slippage was
        never measured makes the cost leg a *lower bound*, and a caller that
        treated the gap as zero would understate what execution cost.
        """
        try:
            start = datetime.strptime(session_date, "%Y-%m-%d")
        except ValueError:
            return {}
        end = start + timedelta(days=1)
        params: tuple[Any, ...] = (start, end)
        if self.backend == "sqlite":
            params = tuple(p.isoformat() for p in (start, end))

        rows = self.query(
            "SELECT count(*) AS fills, "
            "sum(COALESCE(notional, 0)) AS notional, "
            "sum(COALESCE(fee_usd, 0)) AS fees, "
            "sum(COALESCE(notional, 0) * COALESCE(slippage_bps, 0)) / 10000.0 AS slippage_cost, "
            "sum(CASE WHEN slippage_bps IS NULL THEN 1 ELSE 0 END) AS fills_without_slippage "
            "FROM orders WHERE accepted AND fill_qty IS NOT NULL AND ts >= ? AND ts < ?",
            params,
        )
        stats = dict(rows[0]) if rows else {}
        stats["session_date"] = session_date
        return stats

    def execution_quality_by(self, dimension: str) -> list[dict[str, Any]]:
        """Fill rate, cost and latency grouped by venue or strategy.

        A single desk-wide slippage number cannot tell a trader whether one
        venue or one strategy is doing the damage, which is the only actionable
        form of the question.
        """
        if dimension not in {"venue", "strategy"}:
            raise ValueError(f"unsupported grouping: {dimension!r}")
        return self.query(
            f"SELECT {dimension} AS bucket, "  # noqa: S608 - identifier from a fixed allow-list above
            "count(*) AS orders, "
            "sum(CASE WHEN accepted THEN 1 ELSE 0 END) AS filled, "
            "sum(COALESCE(notional, 0)) AS notional, "
            "sum(COALESCE(fee_usd, 0)) AS fees, "
            "avg(slippage_bps) AS avg_slippage_bps, "
            "avg(latency_ms) AS avg_latency_ms, "
            "max(latency_ms) AS max_latency_ms "
            f"FROM orders WHERE {dimension} IS NOT NULL "  # noqa: S608 - same allow-list
            f"GROUP BY {dimension} ORDER BY notional DESC"  # noqa: S608 - same allow-list
        )

    def close(self) -> None:
        with self._lock:
            self._closed = True
            try:
                self._conn.close()
            except Exception:  # noqa: S110 - shutdown must not raise
                # Reached only while the process is already going down, where a
                # raised error would mask whatever caused the shutdown. The
                # ``_closed`` flag above has already stopped new writes.
                pass


_audit: AuditLog | None = None


def get_audit() -> AuditLog:
    global _audit
    if _audit is None:
        _audit = AuditLog()
    return _audit
