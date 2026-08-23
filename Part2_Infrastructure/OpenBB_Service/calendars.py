"""The announcement calendar, from the one dependency this service already has.

A deliberate deviation from `provider.py`, and it is recorded here because that
file's own docstring states the rule it breaks: everything else in this service
goes through an `openbb_yfinance` fetcher class rather than through yfinance
directly. There is no calendar fetcher in `openbb-yfinance` — no
`calendar_earnings`, no `economic_calendar`, none — so honouring the rule would
mean adding `openbb-fmp` or `openbb-nasdaq` to a five-package pin that
`tests/test_provider.py` asserts, for data the pinned `yfinance` already
returns. The cheaper deviation is this one, and it costs no package at all.

Two calendars, both keyed by a window:

* **earnings** — symbol, company, the event's UTC start, and the TIMING word
  (BMO, AMC, TAS, TNS). The timing word is the only signal a free feed gives
  about whether a release lands before an open or after a close, so it travels
  verbatim and is never folded into the timestamp.
* **economic** — the macro release list, from which an FOMC decision is one row
  among many. Kept because the desk's own FOMC seed is verified against the
  Federal Reserve rather than against this, and a second opinion that disagrees
  is worth seeing.

`get_earnings_dates` is NOT used: it parses HTML and needs `lxml`, which this
service does not have. The `Calendars` API answers JSON.
"""

from __future__ import annotations

import asyncio
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

from provider import _FETCH_BULKHEAD, FETCH_TIMEOUT_SECONDS, ProviderUnavailable

#: Yahoo caps a calendar page at one hundred rows whatever is asked for.
MAX_ROWS = 100

#: How far ahead a caller may look. A calendar is for events that have not
#: happened; a year of them is more than any capture window needs.
MAX_HORIZON_DAYS = 400


def _clean(value: Any) -> Any:
    """NaN into None. A missing estimate is missing, not zero."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def _stamp(value: Any) -> str | None:
    if value is None:
        return None
    try:
        moment = value.to_pydatetime() if hasattr(value, "to_pydatetime") else value
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(moment, datetime):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat()


def _window(start: str | None, end: str | None) -> tuple[date, date]:
    today = datetime.now(timezone.utc).date()
    begin = date.fromisoformat(start) if start else today
    finish = date.fromisoformat(end) if end else begin + timedelta(days=14)
    if finish < begin:
        raise ProviderUnavailable("the calendar window ends before it starts")
    if (finish - begin).days > MAX_HORIZON_DAYS:
        raise ProviderUnavailable(f"a calendar window may not exceed {MAX_HORIZON_DAYS} days")
    return begin, finish


def _rows(frame: Any, mapping: dict[str, str], *, index_as: str | None = None) -> list[dict[str, Any]]:
    if frame is None or getattr(frame, "empty", True):
        return []
    out: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        record: dict[str, Any] = {}
        if index_as:
            record[index_as] = str(index)
        for source, target in mapping.items():
            if source not in frame.columns:
                continue
            value = row[source]
            record[target] = _stamp(value) if target.endswith("_at") else _clean(value)
        out.append(record)
    return out


def _calendars(start: date, end: date) -> Any:
    import yfinance

    return yfinance.Calendars(start=start, end=end)


async def earnings_calendar(start: str | None, end: str | None, limit: int) -> list[dict[str, Any]]:
    """Upcoming and recent earnings, with the session-placement word kept."""
    begin, finish = _window(start, end)
    bounded = max(1, min(int(limit), MAX_ROWS))

    def fetch() -> list[dict[str, Any]]:
        frame = _calendars(begin, finish).get_earnings_calendar(limit=bounded)
        return _rows(frame, {
            "Company": "company",
            "Event Name": "event_name",
            "Event Start Date": "start_at",
            "Timing": "timing",
            "EPS Estimate": "eps_estimate",
            "Reported EPS": "eps_actual",
            "Surprise(%)": "surprise_pct",
            "Marketcap": "market_cap",
        }, index_as="symbol")

    return await _off_loop(fetch)


async def economic_calendar(start: str | None, end: str | None, limit: int) -> list[dict[str, Any]]:
    """Macro releases in the window. An FOMC decision is one row among many."""
    begin, finish = _window(start, end)
    bounded = max(1, min(int(limit), MAX_ROWS))

    def fetch() -> list[dict[str, Any]]:
        frame = _calendars(begin, finish).get_economic_events_calendar(limit=bounded)
        return _rows(frame, {
            "Event Name": "event_name",
            "Event Start Date": "start_at",
            "Country": "country",
            "Period": "period",
            "Actual": "actual",
            "Consensus": "consensus",
            "Prior": "prior",
        })

    return await _off_loop(fetch)


async def _off_loop(work: Any) -> list[dict[str, Any]]:
    """The same bulkhead and timeout every other fetch in this service uses."""
    async with _FETCH_BULKHEAD:
        try:
            return await asyncio.wait_for(asyncio.to_thread(work), timeout=FETCH_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as exc:
            raise ProviderUnavailable("the calendar source did not answer in time") from exc
        except ProviderUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ProviderUnavailable(f"the calendar source failed: {exc}") from exc
