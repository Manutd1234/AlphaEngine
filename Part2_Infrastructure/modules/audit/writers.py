"""The append-only writers, and the two read models that pair with them.

Every method here is best-effort by design: ``_exec`` logs a failure and
returns, because an audit write must never be the reason an order does not go
out. The two writes that are *not* best-effort — the durable replay boundaries
— are in ``boundaries.py`` for exactly that reason.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from typing import Any

from modules.audit.clock import utcnow
from modules.audit.store import AuditStore


class Writers(AuditStore):
    """One row per order, per transition, per snapshot, per run, per job."""

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
                (at.replace(tzinfo=None) if at else utcnow()),
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
            (utcnow(), event, severity, actor, symbol, detail, json.dumps(payload or {}, default=str)),
        )


    def record_tca_snapshot(self, row: dict[str, Any]) -> None:
        self._exec(
            "INSERT INTO tca_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                utcnow(),
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
                utcnow(),
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
                utcnow(),
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

    def list_jobs(self, limit: int = 25, kind_prefix: str | None = None) -> list[dict[str, Any]]:
        """Recent job rows, newest first.

        The `jobs` table was write-only. `record_job` had written to it since it
        was added and nothing anywhere ever ran a SELECT against it — a repo-wide
        search for `FROM jobs` returned nothing. So `GET /api/data/jobs` served
        the queue's in-process dict, which dies with the process: after a deploy
        the desk reported that no job had ever run.

        Terminal rows only, because that is all `record_job` writes — it is
        called once, from the runner's `finally`. A job that is still running is
        in the queue's memory and nowhere else, which is correct: it has no
        outcome to record yet.
        """
        # Two literal statements rather than one interpolated. `where` would
        # have been a fixed string either way, but a SELECT assembled with an
        # f-string is a shape a reader has to verify by hand every time, and
        # ruff's bandit rule is right to make that cost visible.
        if kind_prefix:
            return self.query(
                "SELECT job_id, kind, status, submitted_at, finished_at, backend, error "
                "FROM jobs WHERE kind LIKE ? ORDER BY submitted_at DESC LIMIT ?",
                (f"{kind_prefix}%", limit),
            )
        return self.query(
            "SELECT job_id, kind, status, submitted_at, finished_at, backend, error "
            "FROM jobs ORDER BY submitted_at DESC LIMIT ?",
            (limit,),
        )

    def record_job(self, job_id: str, kind: str, status: str, submitted_at, finished_at, backend: str, error) -> None:
        # One row per job, not per CALL: queued -> running -> succeeded listed
        # the same job three times. No UPSERT here, so delete first — the shape
        # upsert_subscriber uses. Events stay append-only; a job row is state.
        self._exec("DELETE FROM jobs WHERE job_id = ?", (job_id,))
        self._exec(
            "INSERT INTO jobs VALUES (?,?,?,?,?,?,?)",
            (job_id, kind, status, submitted_at, finished_at, backend, error),
        )
