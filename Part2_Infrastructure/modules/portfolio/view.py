"""``build_portfolio`` — the desk seen from above, at one instant.

Split out of ``modules/portfolio.py``. Live state (positions, marks, drawdown)
comes from the risk gateway; realised history comes from the append-only audit
log. Nothing here caches: a PM asking "why does this say that?" gets a SQL
query for an answer.
"""

from __future__ import annotations

from typing import Any

from config import settings
from modules.portfolio._common import _headroom, _pct, _utcnow
from modules.portfolio.attribution import realized_pnl_by_strategy, session_attribution


def build_portfolio(gateway, audit) -> dict[str, Any]:
    """Portfolio-level view: exposure, concentration, headroom, attribution."""
    state = gateway.state()

    # ---- exposure by symbol ------------------------------------------- #
    gross = state.gross_exposure
    positions: list[dict[str, Any]] = []
    for pos in state.positions:
        notional = pos.notional
        positions.append({
            "symbol": pos.symbol,
            "side": "LONG" if pos.quantity > 0 else "SHORT" if pos.quantity < 0 else "FLAT",
            "quantity": pos.quantity,
            "avg_price": pos.avg_price,
            "mark_price": pos.mark_price,
            "notional": round(notional, 2),
            # Share of the book: the number that says "this IS the portfolio".
            "share_of_gross": round(_pct(notional, gross), 4),
            "unrealized_pnl": round(pos.unrealized_pnl, 2),
            "realized_pnl": round(pos.realized_pnl, 2),
            "total_pnl": round(pos.unrealized_pnl + pos.realized_pnl, 2),
            # Headroom against the per-symbol cap, so a PM can see which position
            # is about to stop accepting orders before a trader discovers it.
            "symbol_limit": _headroom(notional, settings.max_symbol_notional_usd),
        })
    positions.sort(key=lambda p: -p["notional"])

    # ---- concentration ------------------------------------------------- #
    # Largest share and HHI together: one large position and many equal ones are
    # both "concentrated" in different ways, and a single metric hides one of them.
    shares = [p["share_of_gross"] for p in positions]
    hhi = sum(s * s for s in shares)
    concentration = {
        "positions": len(positions),
        "largest_symbol": positions[0]["symbol"] if positions else None,
        "largest_share": round(shares[0], 4) if shares else 0.0,
        "top_two_share": round(sum(sorted(shares, reverse=True)[:2]), 4),
        # Herfindahl-Hirschman index: 1.0 = the whole book is one position,
        # 1/n = perfectly spread across n. Scale-free, so it is comparable
        # day to day as the book grows.
        "hhi": round(hhi, 4),
        "effective_positions": round(1 / hhi, 2) if hhi > 0 else 0.0,
    }

    # ---- risk budget ---------------------------------------------------- #
    limits = state.limits
    risk_budget = {
        "gross_exposure": _headroom(gross, limits["max_gross_exposure_usd"]),
        "daily_drawdown": {
            "used_pct": round(state.daily_drawdown_pct, 4),
            "limit_pct": round(limits["max_daily_drawdown_pct"], 4),
            "utilisation": round(state.drawdown_budget_used_pct, 4),
            "equity_at_halt": round(
                state.start_of_day_equity * (1 - limits["max_daily_drawdown_pct"]), 2
            ),
            "cushion_usd": round(
                state.equity - state.start_of_day_equity * (1 - limits["max_daily_drawdown_pct"]), 2
            ),
        },
        # The binding constraint is the one that matters — a PM should not have to
        # scan four gauges to find out which limit stops trading first.
        "binding_constraint": max(
            [
                ("gross_exposure", _pct(gross, limits["max_gross_exposure_usd"])),
                ("daily_drawdown", state.drawdown_budget_used_pct),
                *[
                    (f"symbol:{p['symbol']}", p["symbol_limit"]["utilisation"])
                    for p in positions
                ],
            ],
            key=lambda kv: kv[1],
        ),
    }

    # ---- attribution from the audit log --------------------------------- #
    by_strategy = audit.query(
        "SELECT strategy, "
        "       count(*) AS orders, "
        "       sum(CASE WHEN accepted THEN 1 ELSE 0 END) AS filled, "
        "       sum(COALESCE(notional, 0)) AS notional, "
        "       sum(COALESCE(fee_usd, 0)) AS fees, "
        "       avg(slippage_bps) AS avg_slippage_bps "
        "FROM orders GROUP BY strategy ORDER BY notional DESC"
    ) if audit else []

    # Flow says how much a sleeve traded; P&L says whether it should have.
    realized = realized_pnl_by_strategy(audit)
    for strategy_row in by_strategy:
        sleeve = realized.get(strategy_row.get("strategy") or "manual", {})
        strategy_row["realized_pnl"] = sleeve.get("realized_pnl")
        strategy_row["win_rate"] = sleeve.get("win_rate")
        strategy_row["closed_trades"] = sleeve.get("closes")
        # Realized P&L excludes open inventory, so a sleeve still holding risk
        # is only partly scored — say so rather than let it read as final.
        strategy_row["has_open_inventory"] = sleeve.get("has_open_inventory", False)

    by_symbol_flow = audit.query(
        "SELECT symbol, "
        "       count(*) AS orders, "
        "       sum(CASE WHEN accepted THEN 1 ELSE 0 END) AS filled, "
        "       sum(CASE WHEN accepted THEN 0 ELSE 1 END) AS rejected, "
        "       sum(COALESCE(fee_usd, 0)) AS fees, "
        "       avg(latency_ms) AS avg_latency_ms "
        "FROM orders GROUP BY symbol ORDER BY filled DESC"
    ) if audit else []

    return {
        "as_of": _utcnow().isoformat(),
        "session_date": state.session_date,
        "trading_halted": state.kill_switch_active,
        "halted_symbols": state.halted_symbols,
        "equity": {
            "current": round(state.equity, 2),
            "start_of_day": round(state.start_of_day_equity, 2),
            "daily_pnl": round(state.daily_pnl, 2),
            "daily_return": round(_pct(state.daily_pnl, state.start_of_day_equity), 5),
            "realized_pnl": round(state.realized_pnl, 2),
            "unrealized_pnl": round(state.unrealized_pnl, 2),
            # `realized_pnl` above is this session's — the gateway zeroes the
            # per-position counters at every UTC rollover. Everything banked
            # before today is this term, named rather than left implicit: without
            # it `current` exceeds `starting + realized + unrealized` by an
            # amount the block gives a PM no way to account for.
            "banked_prior_sessions": round(state.carried_realized_pnl, 2),
        },
        "exposure": {
            "gross": round(gross, 2),
            # Net tells you directional risk; gross tells you how much is at work.
            # A market-neutral book has large gross and ~zero net.
            "net": round(sum(p["notional"] if p["side"] == "LONG" else -p["notional"]
                             for p in positions), 2),
            "leverage": round(_pct(gross, state.equity), 3),
            "positions": positions,
        },
        "concentration": concentration,
        "risk_budget": risk_budget,
        "attribution": {
            "by_strategy": by_strategy,
            "by_symbol": by_symbol_flow,
            "session": session_attribution(audit, state),
        },
        "execution_quality": audit.execution_stats() if audit else {},
        "working": {
            "orders": state.working_orders,
            "notional": round(state.working_notional, 2),
        },
    }
