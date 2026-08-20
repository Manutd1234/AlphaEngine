"""The persisted equity curve and the period returns derived from it.

Split out of ``modules/portfolio.py``. Everything here is derived from
``equity_snapshots`` rather than recomputed, so the chart and the period numbers
can never disagree. A period with no opening mark reports ``None``, never 0.
"""

from __future__ import annotations

from typing import Any

from config import settings
from modules.portfolio._common import _pct


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
