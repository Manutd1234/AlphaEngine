"""``settlement`` — what the contract actually resolves against.

A thin syscall over ``drivers/livedata.py``: fetch the published index for a
watched series, and report the gap between its latest print and the window it
settles on. The gap is the point. Everything else here is shaping the result so
a pane can render "not covered" and "could not be read" differently.
"""

from __future__ import annotations

from typing import Any

from modules.coherence.drivers import livedata, weather_qc
from modules.coherence.drivers.kalshi_rest import KalshiClient

#: The window this module averages over, in minutes.
#:
#: An ASSUMPTION, not a reading. The weather endpoint publishes a per-minute
#: series, a config version and its units; it does not publish the averaging
#: window its contracts settle on, and the rules that do live in each series'
#: prose. So this is a configured convention, reported as one — the pane labels
#: the figure with this number rather than implying the venue supplied it, and
#: a series that settles on a different window will need this to move with it.
SETTLEMENT_WINDOW_MINUTES = 60


async def weather(client: KalshiClient, city: str) -> dict[str, Any]:
    try:
        index, raw = await livedata.fetch_weather(client, city)
    except livedata.LiveDataUnavailable as exc:
        return {"state": exc.kind, "detail": exc.reason, "city": city, "summary": None, "samples": []}
    summary = livedata.qc_summary(index)
    summary["window_minutes"] = SETTLEMENT_WINDOW_MINUTES
    summary["window_is_assumed"] = True

    # The station layer. This is what makes the feed worth reading: the
    # trailing minutes carry readings the exchange has not yet published an
    # index for, so the next value is arithmetic rather than a forecast — but
    # only under a formation rule that is tested here rather than assumed.
    minutes = weather_qc.parse_detailed(raw)
    formation = weather_qc.formation_check(minutes)
    summary["stations"] = sorted({s.station_id for m in minutes for s in m.stations if s.station_id})
    summary["formation_checked"] = formation.checked
    summary["formation_agreed"] = formation.agreed
    summary["formation_holds"] = formation.holds
    summary["formation_detail"] = formation.detail
    summary["quorum_gaps"] = weather_qc.quorum_gaps(minutes)
    pending = [
        {
            "ts_ms": minute.ts_ms,
            "provisional": str(minute.provisional()) if minute.provisional() is not None else None,
            "spread": str(minute.spread) if minute.spread is not None else None,
            "stations": len(minute.stations),
        }
        for minute in weather_qc.pending_minutes(minutes)
    ]
    return {
        "state": "available",
        "detail": "",
        "city": index.city,
        "summary": summary,
        "pending": pending,
        "samples": [
            {
                "ts_ms": sample.ts_ms,
                "value": str(sample.value),
                "contributors": sample.contributors,
                "status": sample.status,
            }
            for sample in index.samples
        ],
    }


async def event_index(client: KalshiClient, event_ticker: str) -> dict[str, Any]:
    try:
        index = await livedata.fetch_event_index(client, event_ticker)
    except livedata.LiveDataUnavailable as exc:
        return {"state": exc.kind, "detail": exc.reason, "event_ticker": event_ticker, "periods": {}}
    finest = index.finest
    return {
        "state": "available",
        "detail": (
            f"the exchange publishes {len(index.candles)} resolution(s) of the settlement variable "
            "for this event; these are averaged bars, not trade prints"
        ),
        "event_ticker": index.event_ticker,
        "default_range": index.default_range,
        "finest_period": finest[0] if finest else None,
        "latest_close": str(index.latest_close) if index.latest_close is not None else None,
        "periods": {
            period: [
                {
                    "ts_ms": candle.open_ts_ms,
                    "open": str(candle.open) if candle.open is not None else None,
                    "high": str(candle.high) if candle.high is not None else None,
                    "low": str(candle.low) if candle.low is not None else None,
                    "close": str(candle.close) if candle.close is not None else None,
                }
                for candle in candles
            ]
            for period, candles in index.candles.items()
        },
    }


async def reference_rate(client: KalshiClient) -> dict[str, Any]:
    """Whether the CF Benchmarks passthrough is open to this deployment."""
    return await livedata.cfbenchmarks_state(client)
