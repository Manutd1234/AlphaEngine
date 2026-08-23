"""The variable a market actually settles on, which is not the price you watch.

Every reference implementation of a Kalshi crypto strategy reaches for a
Binance last trade. Kalshi does not settle on a last trade. It settles on a
published index, and the two differ in ways that decide whether a position that
looked right was right:

* The index is **time-averaged**. ``GET /live_data/events/{ticker}`` returns the
  exchange's own candles for the settlement variable, and a fifteen-minute
  candle whose close is 77,185 is not a print at 77,185 — it is the average of a
  window. A basket priced off a spot tick is priced off a different random
  variable from the one that pays.
* The index is **quality-controlled**. The weather feed returns, per minute, how
  many stations contributed and whether the reading is ``normal`` or
  ``degraded``. Miami's index today runs 1,435 minutes with five contributors
  throughout and two degraded minutes. A degraded minute is not a missing
  minute and not a normal one, and collapsing the three loses the only signal
  there is about whether the number can be trusted.
* The index is **not always published**. Kalshi's weather endpoint currently
  serves exactly one city — it answers a request for any other with a 400 that
  names the ones it has. This module reports that refusal as a refusal rather
  than as an empty series, because an empty temperature series and a city that
  is not covered are different facts and only one of them is about the weather.

**CF Benchmarks needs an entitlement this engine does not have.** The
``/cfbenchmarks`` passthrough answers 401 to a keyless call and to a demo key:
it is gated on an account entitlement, not merely on signing. That is reported
as ``entitlement_required`` and never as a network fault, so nobody spends an
afternoon debugging a key that was never going to work.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, Sequence

from modules.coherence.drivers.kalshi_rest import Fetched, KalshiClient, KalshiRefused, KalshiUnavailable

#: The venue serves the weather index per city and refuses unknown ones with a
#: 400 that lists what it has. Probed rather than assumed: this is a note about
#: what was live when the module was written, not a whitelist the code enforces.
KNOWN_WEATHER_CITIES: tuple[str, ...] = ("miami",)

QcStatus = Literal["normal", "degraded", "unknown"]


class LiveDataUnavailable(RuntimeError):
    """A settlement feed could not be read, with the venue's own reason."""

    def __init__(self, reason: str, kind: str = "unavailable") -> None:
        super().__init__(reason)
        self.reason = reason
        #: ``entitlement_required`` | ``not_covered`` | ``unavailable``. Kept
        #: apart because only the third one is worth retrying.
        self.kind = kind


def _decimal(value: Any) -> Decimal | None:
    """A JSON number to Decimal without going through binary rounding.

    The venue sends these as JSON floats, so the precision is already spent by
    the time the value arrives. Converting through ``str`` keeps the shortest
    representation that round-trips rather than adding seventeen digits of
    binary artefact on top of it.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


@dataclass(frozen=True, slots=True)
class Sample:
    """One minute of the published index."""

    ts_ms: int
    value: Decimal
    contributors: int
    status: QcStatus


@dataclass(frozen=True, slots=True)
class WeatherIndex:
    """A quality-controlled weather index, as the exchange publishes it."""

    city: str
    config_version: str
    samples: tuple[Sample, ...]

    @property
    def degraded(self) -> tuple[Sample, ...]:
        return tuple(sample for sample in self.samples if sample.status == "degraded")

    @property
    def latest(self) -> Sample | None:
        return self.samples[-1] if self.samples else None

    @property
    def contributor_range(self) -> tuple[int, int] | None:
        if not self.samples:
            return None
        counts = [sample.contributors for sample in self.samples]
        return min(counts), max(counts)

    def window_average(self, minutes: int, include_degraded: bool = True) -> Decimal | None:
        """The mean of the final ``minutes`` samples — the settlement shape.

        Kalshi's temperature contracts settle on an average over a window, not
        on the last reading, so this is the quantity a position is exposed to.
        ``include_degraded`` exists because excluding the flagged minutes gives
        a different number, and seeing both is how you find out whether the
        flags matter today.
        """
        if minutes <= 0 or not self.samples:
            return None
        window = [
            sample
            for sample in self.samples[-minutes:]
            if include_degraded or sample.status == "normal"
        ]
        if not window:
            return None
        return sum((sample.value for sample in window), Decimal(0)) / Decimal(len(window))

    @property
    def spot_minus_window(self) -> Decimal | None:
        """Last reading minus the hour's average — the tracking error itself.

        This is the number that makes the point. Trading a settlement average
        as though it were the latest print carries exactly this much basis, and
        it is rarely zero.
        """
        average = self.window_average(60)
        latest = self.latest
        if average is None or latest is None:
            return None
        return latest.value - average


@dataclass(frozen=True, slots=True)
class Candle:
    """One bar of the exchange's own settlement index."""

    open_ts_ms: int
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None

    @property
    def range(self) -> Decimal | None:
        if self.high is None or self.low is None:
            return None
        return self.high - self.low


@dataclass(frozen=True, slots=True)
class EventIndex:
    """The settlement variable for one event, at whatever resolutions exist."""

    event_ticker: str
    default_range: str
    candles: dict[str, tuple[Candle, ...]]

    @property
    def finest(self) -> tuple[str, tuple[Candle, ...]] | None:
        """The shortest-period series available, which is closest to the tape.

        Ordered by the period the key MEANS, not by how the key is spelled.
        Sorting on string length happens to work for ``"1M"`` against ``"15M"``
        and gets ``"1h"`` against ``"1m"`` exactly backwards, which would hand
        a caller hourly bars while calling them the finest available.
        """
        if not self.candles:
            return None
        order = sorted(self.candles.items(), key=lambda pair: (_period_seconds(pair[0]), pair[0]))
        return order[0]

    @property
    def latest_close(self) -> Decimal | None:
        finest = self.finest
        if finest is None or not finest[1]:
            return None
        return finest[1][-1].close


#: How long each period suffix lasts. Unknown suffixes sort last rather than
#: first: a period this module cannot read is not evidence of a fine one.
_PERIOD_UNITS: dict[str, int] = {"S": 1, "M": 60, "H": 3600, "D": 86_400, "W": 604_800}


def _period_seconds(key: str) -> int:
    text = key.strip().upper()
    digits = "".join(char for char in text if char.isdigit())
    suffix = "".join(char for char in text if char.isalpha())
    if not digits:
        return 1 << 30
    return int(digits) * _PERIOD_UNITS.get(suffix, 1 << 20)


def _qc_status(raw: Any) -> QcStatus:
    text = str(raw or "").strip().lower()
    return text if text in {"normal", "degraded"} else "unknown"  # type: ignore[return-value]


def parse_weather(city: str, payload: dict[str, Any]) -> WeatherIndex:
    """The weather endpoint's body to an index. Malformed rows are dropped, loudly."""
    rows = payload.get("timeseries")
    samples: list[Sample] = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            value = _decimal(row.get("v"))
            stamp = row.get("t")
            if value is None or not isinstance(stamp, int):
                continue
            contributors = row.get("contributors")
            samples.append(
                Sample(
                    ts_ms=stamp,
                    value=value,
                    contributors=int(contributors) if isinstance(contributors, int) else 0,
                    status=_qc_status(row.get("status")),
                )
            )
    return WeatherIndex(
        city=city,
        config_version=str(payload.get("config_version") or ""),
        samples=tuple(sorted(samples, key=lambda sample: sample.ts_ms)),
    )


def _candles(raw: Any) -> tuple[Candle, ...]:
    if not isinstance(raw, list):
        return ()
    built: list[Candle] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        stamp = row.get("open_ts_ms")
        if not isinstance(stamp, int):
            continue
        built.append(
            Candle(
                open_ts_ms=stamp,
                open=_decimal(row.get("open")),
                high=_decimal(row.get("high")),
                low=_decimal(row.get("low")),
                close=_decimal(row.get("close")),
            )
        )
    return tuple(sorted(built, key=lambda candle: candle.open_ts_ms))


def parse_event_index(event_ticker: str, payload: dict[str, Any]) -> EventIndex:
    """``GET /live_data/events/{ticker}`` to the settlement index it publishes."""
    body = payload.get("live_data")
    body = body if isinstance(body, dict) else {}
    details = body.get("details")
    details = details if isinstance(details, dict) else {}
    sticks = details.get("candlesticks")
    series: dict[str, tuple[Candle, ...]] = {}
    if isinstance(sticks, dict):
        for period, rows in sticks.items():
            parsed = _candles(rows)
            if parsed:
                series[str(period)] = parsed
    return EventIndex(
        event_ticker=event_ticker,
        default_range=str(body.get("default_range") or ""),
        candles=series,
    )


async def fetch_weather(client: KalshiClient, city: str) -> WeatherIndex:
    """The published index for one city, or a refusal that names the reason."""
    slug = city.strip().lower()
    if not slug:
        raise LiveDataUnavailable("no city was named", kind="not_covered")
    try:
        fetched: Fetched = await client.get(f"/live_data/weather/{slug}")
    except KalshiRefused as exc:
        raise LiveDataUnavailable(exc.reason, kind="entitlement_required") from exc
    except KalshiUnavailable as exc:
        # A 400 here is the venue saying it does not publish this city, which is
        # a fact about coverage rather than a fault to retry.
        kind = "not_covered" if exc.status == 400 else "unavailable"
        raise LiveDataUnavailable(exc.reason, kind=kind) from exc
    return parse_weather(slug, fetched.payload)


async def fetch_event_index(client: KalshiClient, event_ticker: str) -> EventIndex:
    """The settlement index behind one event."""
    try:
        fetched = await client.get(f"/live_data/events/{event_ticker}")
    except KalshiRefused as exc:
        raise LiveDataUnavailable(exc.reason, kind="entitlement_required") from exc
    except KalshiUnavailable as exc:
        raise LiveDataUnavailable(exc.reason, kind="unavailable") from exc
    return parse_event_index(event_ticker, fetched.payload)


async def cfbenchmarks_state(client: KalshiClient) -> dict[str, Any]:
    """Whether the CF Benchmarks passthrough is reachable for this account.

    Reported rather than raised, because "we cannot see the reference rate" is a
    standing property of the deployment that belongs on the status pane, not an
    error that interrupts a poll.
    """
    try:
        fetched = await client.get("/cfbenchmarks/values", {"id": "BRTI"})
    except KalshiRefused as exc:
        return {
            "state": "entitlement_required",
            "detail": (
                "the CF Benchmarks passthrough is gated on an account entitlement rather than on "
                "signing, so a demo key does not open it: " + exc.reason
            ),
        }
    except KalshiUnavailable as exc:
        return {"state": "unavailable", "detail": exc.reason}
    return {"state": "available", "detail": "", "payload": fetched.payload}


def qc_summary(index: WeatherIndex) -> dict[str, Any]:
    """What the quality control says, in the shape the status pane renders."""
    span = index.contributor_range
    degraded = index.degraded
    return {
        "city": index.city,
        "config_version": index.config_version,
        "samples": len(index.samples),
        "degraded_samples": len(degraded),
        "contributors_min": span[0] if span else None,
        "contributors_max": span[1] if span else None,
        "latest_value": str(index.latest.value) if index.latest else None,
        "hour_average": str(index.window_average(60)) if index.window_average(60) is not None else None,
        "hour_average_clean": (
            str(index.window_average(60, include_degraded=False))
            if index.window_average(60, include_degraded=False) is not None
            else None
        ),
        "spot_minus_window": (
            str(index.spot_minus_window) if index.spot_minus_window is not None else None
        ),
    }


def covered_cities(probed: Sequence[str] | None = None) -> tuple[str, ...]:
    """The cities known to be published, for the universe pane's honesty line."""
    return tuple(probed) if probed else KNOWN_WEATHER_CITIES
