"""The read models the desk and the web workspace are served from.

Every method here is a SELECT and nothing else. They are grouped because they
share an obligation the writers do not: a blotter that shows *that* an order
was rejected without showing *which gate* rejected it sends the trader to the
logs, which is the thing the audit log exists to avoid.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from modules.audit.store import AuditStore


class ReadModels(AuditStore):
    """Blotter, event feed, experiment history, TCA series and cost rollups."""

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
