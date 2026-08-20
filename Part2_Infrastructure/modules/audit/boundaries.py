"""The two durable replay boundaries, written and read back.

``book_reset`` and ``session_rollover`` are the only rows in this store that a
restarted gateway *has* to find. Everything else it can rebuild from the fills;
these two carry what replay alone cannot reach — that the book was flattened,
and what the sessions before this one banked.

Write and read live together on purpose. Both writes are strict where the rest
of the ledger is best-effort, and both reads refuse an exact timestamp tie
rather than guess which of the two happened second; those are one rule seen
from two sides, and splitting them would leave each half looking like an
over-reaction on its own.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from modules.audit.clock import _audit_timestamp, utcnow
from modules.audit.store import AuditStore

log = logging.getLogger("alphaengine.audit")


class ReplayBoundaries(AuditStore):
    """Durable session/reset boundaries: the strict writes and the strict reads."""

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
                raise RuntimeError("session rollover and book reset share an ambiguous audit timestamp")
            if rollover_at < reset_time:
                return None

        try:
            payload = json.loads(row[1] or "")
        except (TypeError, ValueError) as exc:
            raise RuntimeError("session rollover record has an unreadable payload") from exc
        if not isinstance(payload, dict):
            raise RuntimeError(f"session rollover record has a non-object payload: {payload!r}")
        return payload

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
                    utcnow(), "book_reset", "info", actor, None,
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
