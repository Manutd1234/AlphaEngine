"""Planning the bar capture around an announcement that has not happened yet.

The whole earnings arm rests on this, and on one fact about the free feeds: an
equity minute bar is available for about five days after it printed and not
afterwards. There is no historical minute data to buy back later, so a window
that is not captured while it is fresh is a window that never existed.

WHY THE CAPTURE IS SUBMITTED ONCE, AFTER THE WINDOW CLOSES. `run_backfill`
reaches the workspace with a BAR COUNT — "the newest N" — and then filters to
the requested range. That is a limit read, not a window read: a request made
while the window is still open returns bars from before the event, and a
request made weeks later returns bars from now. There is exactly one moment it
works, which is shortly after the window closes and before the vendor's reach
expires, so the plan submits one job per (event, symbol, interval) at
`release + post_days` and not a daily sweep.

That one-shot shape also keeps the Data tab quiet. `on_data_job_complete`
files a quality finding for every `data.*` job, and a daily sweep across
weekends and holidays would fill Quality with empty-bar failures that are
expected by construction. One job, timed to when there is something to fetch.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from modules.coherence.diffusion import tunables

_DAY_MS = 86_400_000

#: How long a free vendor will still serve a minute bar. Five days is
#: yfinance's own reach; the capture is deliberately inside it.
MINUTE_REACH_DAYS = 5


@dataclass(frozen=True)
class CaptureRequest:
    """One window to fetch, and the moment it becomes fetchable."""

    source_ref: str
    symbol: str
    interval: str
    from_ms: float
    to_ms: float
    due_at_ms: float
    reason: str | None = None

    @property
    def key(self) -> str:
        return f"coherence-capture-{self.source_ref}-{self.symbol}-{self.interval}"

    def as_backfill(self) -> dict[str, Any]:
        """The `DataBackfillRequest` shape, ISO in and epoch out."""
        return {
            "symbol": self.symbol,
            "interval": self.interval,
            "from_at": datetime.fromtimestamp(self.from_ms / 1000.0, tz=timezone.utc).isoformat(),
            "to_at": datetime.fromtimestamp(self.to_ms / 1000.0, tz=timezone.utc).isoformat(),
        }


@dataclass(frozen=True)
class CapturePlan:
    """What to fetch now, what to wait for, and what can no longer be had."""

    due: tuple[CaptureRequest, ...] = ()
    waiting: tuple[CaptureRequest, ...] = ()
    expired: tuple[CaptureRequest, ...] = ()

    @property
    def counts(self) -> dict[str, int]:
        return {"due": len(self.due), "waiting": len(self.waiting), "expired": len(self.expired)}


def plan_captures(
    events: list[dict[str, Any]],
    *,
    now_ms: float,
    symbols_for: Any = None,
    intervals: tuple[str, ...] = ("1m", "15m"),
    pre_days: int = 1,
    post_days: int = 2,
    market_symbol: str | None = None,
) -> CapturePlan:
    """One request per (event, symbol, interval), sorted into three states.

    `expired` is the state that matters and the one a daily sweep would hide:
    a minute window whose vendor reach has run out cannot be fetched by
    anybody, and the honest answer is to say so rather than to keep retrying a
    job that will return an empty series and file a failure.
    """
    benchmark = market_symbol if market_symbol is not None else tunables.DIFFUSION_MARKET_SYMBOL
    due: list[CaptureRequest] = []
    waiting: list[CaptureRequest] = []
    expired: list[CaptureRequest] = []

    for event in events:
        release_at = _number(event.get("release_at"))
        if release_at is None:
            continue
        symbol = str(event.get("symbol") or "").strip().upper()
        wanted = symbols_for(event) if symbols_for else _default_symbols(event, symbol, benchmark)
        window_end = release_at + post_days * _DAY_MS
        for asset in wanted:
            for interval in intervals:
                request = CaptureRequest(
                    source_ref=str(event.get("source_ref")), symbol=asset, interval=interval,
                    from_ms=release_at - pre_days * _DAY_MS, to_ms=window_end,
                    due_at_ms=window_end,
                )
                if now_ms < request.due_at_ms:
                    waiting.append(request)
                elif interval == "1m" and now_ms > release_at + MINUTE_REACH_DAYS * _DAY_MS:
                    expired.append(CaptureRequest(
                        **{**request.__dict__,
                           "reason": (f"a minute bar is served for about {MINUTE_REACH_DAYS} days "
                                      "and this window is older; it cannot be captured now")}))
                else:
                    due.append(request)
    return CapturePlan(tuple(due), tuple(waiting), tuple(expired))


def _default_symbols(event: dict[str, Any], symbol: str, benchmark: str) -> tuple[str, ...]:
    """The event's own asset plus the leg the abnormal return needs.

    An abnormal return is the asset minus a benchmark, so capturing the asset
    alone guarantees `market_adjusted: false` forever. A macro event has no
    single issuer, so it takes the configured macro assets instead.
    """
    if str(event.get("kind")) in {"fomc", "macro"}:
        return tuple(tunables.DIFFUSION_MACRO_ASSETS)
    if not symbol:
        return ()
    return (symbol, benchmark) if benchmark and benchmark != symbol else (symbol,)


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
