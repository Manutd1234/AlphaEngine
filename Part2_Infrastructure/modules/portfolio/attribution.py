"""Attribution: which session, which sleeve, which symbol produced the P&L.

Split out of ``modules/portfolio.py``. ``session_attribution`` is scoped to one
day on purpose — subtracting a lifetime fee total from one session's P&L reports
a loss the desk did not take — and ``realized_pnl_by_strategy`` replays fills
through the same average-cost accounting the live book uses, so a sleeve's P&L
reconciles with the book rather than approximating it.
"""

from __future__ import annotations

from typing import Any


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
