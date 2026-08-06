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


def session_attribution(audit, state) -> dict[str, Any]:
    """The costs and realised P&L of *this* session, scoped to it.

    Everything else under ``attribution`` is lifetime, because a PM reading flow
    wants the whole record. A day's P&L cannot be decomposed with those figures:
    subtracting a lifetime fee total from one session's P&L reports a loss the
    desk did not take. So this block exists separately and names the day it
    covers.

    ``basis`` is what a consumer keys off. ``audited`` means every number here was
    replayed from fills; a caller that finds anything else must not draw it as a
    measured leg.
    """
    if audit is None:
        return {}
    costs = audit.session_costs(state.session_date)
    sleeves = realized_pnl_by_strategy(audit, session_date=state.session_date)
    return {
        "session_date": state.session_date,
        "fills": int(costs.get("fills") or 0),
        "notional": round(float(costs.get("notional") or 0.0), 2),
        "fees": round(float(costs.get("fees") or 0.0), 2),
        "slippage_cost": round(float(costs.get("slippage_cost") or 0.0), 2),
        # A fill whose slippage was never measured makes the cost leg a lower
        # bound. Treating the gap as zero would understate what execution cost.
        "fills_without_slippage": int(costs.get("fills_without_slippage") or 0),
        "realized_pnl": round(
            sum(float(s.get("realized_pnl") or 0.0) for s in sleeves.values()), 2,
        ),
        "unrealized_pnl": round(state.unrealized_pnl, 2),
        "basis": "audited",
    }


def realized_pnl_by_strategy(audit, session_date: str | None = None) -> dict[str, dict[str, Any]]:
    """Replay accepted fills to get realized P&L per strategy sleeve.

    The audit log stores flow (fills, notional, fees) grouped by strategy, but
    "which sleeve made money" cannot be read off flow: the same $1m of turnover
    is a winner or a loser depending on the prices. So the fills are replayed
    through the same average-cost accounting the live book uses — one position
    per (strategy, symbol) — which is why a strategy's P&L here reconciles with
    the gateway's per-symbol figures rather than approximating them.

    Only closed quantity contributes. Open inventory is carried at cost and
    reported separately, because marking it needs a live price the audit log
    does not have.
    """
    from modules.risk_proxy import PositionState

    if not audit:
        return {}

    where = "WHERE accepted AND fill_qty IS NOT NULL"
    params: tuple[Any, ...] = ()
    if session_date:
        where += " AND CAST(ts AS VARCHAR) LIKE ?"
        params = (f"{session_date}%",)

    # `where` is assembled from literals above; the session date travels as a
    # bound parameter, never as SQL text.
    sql = (
        "SELECT strategy, symbol, side, fill_qty, fill_price, fee_usd, notional "  # noqa: S608
        f"FROM orders {where} ORDER BY ts ASC, order_id ASC"
    )
    rows = audit.query(sql, params)

    books: dict[tuple[str, str], Any] = {}
    summary: dict[str, dict[str, Any]] = {}

    for row in rows:
        strategy = row.get("strategy") or "manual"
        symbol = row.get("symbol") or "?"
        key = (strategy, symbol)
        book = books.get(key)
        if book is None:
            book = books[key] = PositionState(symbol=symbol)

        before = book.realized_pnl
        quantity_before = book.quantity
        side = str(row.get("side"))
        book.apply_fill(
            side,
            float(row.get("fill_qty") or 0.0),
            float(row.get("fill_price") or 0.0),
            float(row.get("fee_usd") or 0.0),
        )

        bucket = summary.setdefault(strategy, {
            "strategy": strategy,
            "realized_pnl": 0.0,
            "fees": 0.0,
            "fills": 0,
            "notional": 0.0,
            "wins": 0,
            "closes": 0,
            "symbols": set(),
        })
        bucket["realized_pnl"] = round(bucket["realized_pnl"] + (book.realized_pnl - before), 2)
        bucket["fees"] = round(bucket["fees"] + float(row.get("fee_usd") or 0.0), 2)
        bucket["fills"] += 1
        bucket["notional"] = round(bucket["notional"] + float(row.get("notional") or 0.0), 2)
        bucket["symbols"].add(symbol)

        # A close is a fill that traded against an existing position — decided
        # from the position, not from the P&L. A round trip that scratches at
        # its entry price moves P&L by nothing and is still a closed trade.
        opposed = quantity_before != 0 and (quantity_before > 0) != (side == "BUY")
        if opposed:
            bucket["closes"] += 1
            # Gross of fees: whether the trade idea worked is a separate
            # question from whether it cleared its costs, and a win rate that
            # counted fees would answer neither cleanly.
            if book.realized_pnl - before + float(row.get("fee_usd") or 0.0) > 0:
                bucket["wins"] += 1

    for strategy, bucket in summary.items():
        open_qty = sum(
            abs(book.quantity) for (strat, _sym), book in books.items()
            if strat == strategy and abs(book.quantity) > 1e-12
        )
        bucket["symbols"] = sorted(bucket["symbols"])
        bucket["win_rate"] = round(bucket["wins"] / bucket["closes"], 4) if bucket["closes"] else None
        bucket["has_open_inventory"] = open_qty > 0

    return summary


def build_equity_history(audit, limit: int = 500, session_date: str | None = None) -> dict[str, Any]:
    """Persisted equity curve plus the period returns derived from it.

    Day P&L is available live from the gateway; month-to-date and
    since-inception are not, because they need history the process does not
    keep in memory. Everything here is derived from ``equity_snapshots`` rather
    than recomputed, so the chart and the period numbers can never disagree.
    """
    rows = audit.equity_history(limit=limit, session_date=session_date) if audit else []

    points = [
        {
            "ts": row["ts"].isoformat() if hasattr(row["ts"], "isoformat") else str(row["ts"]),
            "session_date": row.get("session_date"),
            "equity": round(float(row.get("equity") or 0.0), 2),
            "start_of_day": round(float(row.get("start_of_day") or 0.0), 2),
            "daily_pnl": round(float(row.get("daily_pnl") or 0.0), 2),
            "gross_exposure": round(float(row.get("gross_exposure") or 0.0), 2),
            "drawdown_pct": round(float(row.get("drawdown_pct") or 0.0), 5),
            "open_positions": int(row.get("open_positions") or 0),
            "kill_switch": bool(row.get("kill_switch")),
        }
        for row in rows
    ]

    periods: dict[str, Any] = {}
    if points:
        latest = points[-1]
        current = latest["equity"]
        today = latest["session_date"]
        month = str(today)[:7] if today else None

        def _first_equity(predicate) -> float | None:
            for point in points:
                if predicate(point):
                    return point["equity"]
            return None

        # The day's opening mark comes from the row itself, not from the oldest
        # point in the returned window. The window is the newest `limit` rows,
        # so on a long-running gateway it can start hours into the session —
        # deriving "day P&L" from its first point would silently report the last
        # few hours instead, and look entirely plausible doing it.
        day_open = latest.get("start_of_day") or None

        # Month-to-date and inception have no stored equivalent, so they *are*
        # window-bounded and say so via `observed_from`. Inventing an opening
        # mark for a period the gateway did not observe would report a return
        # the book never earned.
        month_open = _first_equity(lambda p: month and str(p["session_date"]).startswith(month))
        inception = points[0]["equity"]

        periods = {
            "current_equity": current,
            "day": _period(current, day_open),
            "month_to_date": _period(current, month_open),
            "since_first_snapshot": _period(current, inception),
            "observed_from": points[0]["ts"],
            "observed_to": latest["ts"],
            "peak_equity": round(max(p["equity"] for p in points), 2),
            # Each snapshot's drawdown against *its own* start-of-day, so this
            # is the worst intraday drawdown observed — not a peak-to-trough
            # figure across the whole window, which would be a different number.
            "worst_daily_drawdown_pct": round(max((p["drawdown_pct"] for p in points), default=0.0), 5),
            "window_bounded": ["month_to_date", "since_first_snapshot"],
        }

    return {
        "points": points,
        "periods": periods,
        "sample_count": len(points),
        # Naming the sampler makes the resolution of the curve self-evident;
        # a chart with 60s points should not be read as a tick-level record.
        "interval_s": settings.equity_snapshot_interval_s,
    }


def _period(current: float, opening: float | None) -> dict[str, Any]:
    if opening is None:
        return {"pnl": None, "return": None, "opening_equity": None}
    return {
        "pnl": round(current - opening, 2),
        "return": round(_pct(current - opening, opening), 5),
        "opening_equity": round(opening, 2),
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
