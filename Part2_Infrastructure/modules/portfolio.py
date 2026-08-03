"""
Portfolio view — the desk seen from above.
==========================================

Who this is for
---------------
The gateway already answers the **trader's** question ("can I send this order,
and what will it cost?") and the **researcher's** question ("does this strategy
work?"). This module answers the **portfolio manager's** question, which is a
different one:

    Where am I exposed, how much of my risk budget is spent, what is making
    or losing money, and how close am I to a limit?

A trader looks at one order; a PM looks at the book. The same numbers do not
serve both — a list of positions is not a portfolio view. What a PM needs is
*concentration* (how much of the book is one bet), *headroom* (how much of each
limit is left before trading stops), and *attribution* (which symbol and which
strategy produced the P&L).

Where the numbers come from
---------------------------
Live state — positions, marks, drawdown — comes from the risk gateway, which is
the process that would actually block an order. Realised history — fills, fees,
slippage, per-strategy P&L — comes from the DuckDB audit log, which is
append-only. So the exposure figures are current and the attribution figures are
reconstructible: a PM can ask "why does this say that?" and the answer is a SQL
query, not a cache.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from config import settings

log = logging.getLogger("alphaengine.portfolio")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _pct(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def _headroom(used: float, limit: float) -> dict[str, float]:
    """How much of a limit is left, and how close we are to it."""
    return {
        "used": round(used, 2),
        "limit": round(limit, 2),
        "remaining": round(max(0.0, limit - used), 2),
        "utilisation": round(_pct(used, limit), 4),
    }


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
        "attribution": {"by_strategy": by_strategy, "by_symbol": by_symbol_flow},
        "execution_quality": audit.execution_stats() if audit else {},
    }


def format_for_telegram(p: dict[str, Any]) -> str:
    """Portfolio summary sized for a phone screen."""
    from modules.telegram import esc

    eq = p["equity"]
    ex = p["exposure"]
    conc = p["concentration"]
    rb = p["risk_budget"]
    constraint, utilisation = rb["binding_constraint"]

    lines = [
        f"<b>{'🛑 HALTED — ' if p['trading_halted'] else ''}📁 Portfolio</b>",
        f"<i>{p['session_date']}</i>",
        "",
        f"Equity        <code>${eq['current']:,.0f}</code>",
        f"Day P&amp;L      <code>{eq['daily_pnl']:+,.0f}</code> ({eq['daily_return']:+.2%})",
        f"  realised    <code>{eq['realized_pnl']:+,.0f}</code>",
        f"  unrealised  <code>{eq['unrealized_pnl']:+,.0f}</code>",
        "",
        f"Gross expo    <code>${ex['gross']:,.0f}</code>  (net <code>{ex['net']:+,.0f}</code>)",
        f"Leverage      <code>{ex['leverage']:.2f}x</code>",
    ]

    if ex["positions"]:
        lines += ["", "<b>Positions</b>"]
        for pos in ex["positions"][:6]:
            lines.append(
                f"  {esc(pos['symbol'])} {pos['side']}  <code>${pos['notional']:,.0f}</code> "
                f"({pos['share_of_gross']:.0%})  P&amp;L <code>{pos['total_pnl']:+,.0f}</code>"
            )
        lines.append(
            f"\n  Concentration: largest <code>{conc['largest_share']:.0%}</code>, "
            f"effective positions <code>{conc['effective_positions']:.1f}</code>"
        )
    else:
        lines += ["", "<i>Book is flat.</i>"]

    dd = rb["daily_drawdown"]
    bar_len = int(min(1.0, utilisation) * 12)
    lines += [
        "",
        "<b>Risk budget</b>",
        f"  Drawdown   <code>{dd['used_pct']:.2%}</code> of <code>{dd['limit_pct']:.2%}</code> "
        f"(cushion <code>${dd['cushion_usd']:,.0f}</code>)",
        f"  Gross      <code>{rb['gross_exposure']['utilisation']:.0%}</code> used, "
        f"<code>${rb['gross_exposure']['remaining']:,.0f}</code> left",
        "",
        f"  Binding limit: <b>{esc(constraint)}</b> at <code>{utilisation:.0%}</code>",
        f"  <code>{'█' * bar_len}{'░' * (12 - bar_len)}</code>",
    ]

    strat = [s for s in p["attribution"]["by_strategy"] if s.get("filled")]
    if strat:
        lines += ["", "<b>Flow by strategy</b>"]
        for s in strat[:4]:
            lines.append(
                f"  {esc(s['strategy'])}: <code>{s['filled']}</code> fills, "
                f"<code>${(s['notional'] or 0):,.0f}</code>, "
                f"slip <code>{(s['avg_slippage_bps'] or 0):+.1f}bps</code>"
            )
    return "\n".join(lines)
