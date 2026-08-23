"""The calendar route, against a frame rather than against Yahoo.

The service's own suite may not reach the network, so the source is faked at
the one place that touches it. What the tests are about is the shape the
gateway depends on: a missing estimate is null and never zero, a timestamp is
UTC, and the session-placement word survives verbatim.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import calendars as calendar_module
import pandas as pd
import pytest
from calendars import earnings_calendar, economic_calendar
from provider import ProviderUnavailable


class _FakeCalendars:
    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame

    def get_earnings_calendar(self, limit: int = 12) -> pd.DataFrame:
        return self._frame.head(limit)

    def get_economic_events_calendar(self, limit: int = 12) -> pd.DataFrame:
        return self._frame.head(limit)


def _earnings_frame() -> pd.DataFrame:
    frame = pd.DataFrame(
        {
            "Company": ["Broadcom Inc.", "Marvell Technology, Inc."],
            "Marketcap": [1.75e12, 2.13e11],
            "Event Name": ["Q3 2026 Earnings", "Q2 2027 Earnings"],
            "Event Start Date": [
                datetime(2026, 9, 2, 20, 0, tzinfo=timezone.utc),
                datetime(2026, 8, 27, 20, 0, tzinfo=timezone.utc),
            ],
            "Timing": ["AMC", "BMO"],
            "EPS Estimate": [3.24, 0.93],
            "Reported EPS": [float("nan"), 0.91],
            "Surprise(%)": [float("nan"), -2.1],
        },
        index=pd.Index(["AVGO", "MRVL"], name="Symbol"),
    )
    return frame


@pytest.fixture()
def fake(monkeypatch):
    def install(frame: pd.DataFrame):
        monkeypatch.setattr(calendar_module, "_calendars", lambda start, end: _FakeCalendars(frame))

    return install


class TestTheEarningsRowsKeepWhatMatters:
    def test_the_symbol_comes_off_the_index(self, fake):
        fake(_earnings_frame())
        rows = asyncio.run(earnings_calendar(None, None, 10))
        assert [row["symbol"] for row in rows] == ["AVGO", "MRVL"]

    def test_the_session_word_survives_verbatim(self, fake):
        fake(_earnings_frame())
        rows = asyncio.run(earnings_calendar(None, None, 10))
        assert [row["timing"] for row in rows] == ["AMC", "BMO"]

    def test_a_missing_estimate_is_null_and_never_zero(self, fake):
        fake(_earnings_frame())
        rows = asyncio.run(earnings_calendar(None, None, 10))
        assert rows[0]["eps_actual"] is None, "NaN became a number"
        assert rows[0]["surprise_pct"] is None
        assert rows[1]["eps_actual"] == 0.91

    def test_the_timestamp_is_utc_iso(self, fake):
        fake(_earnings_frame())
        rows = asyncio.run(earnings_calendar(None, None, 10))
        assert rows[0]["start_at"] == "2026-09-02T20:00:00+00:00"

    def test_an_empty_calendar_is_an_empty_list_not_an_error(self, fake):
        fake(pd.DataFrame())
        assert asyncio.run(earnings_calendar(None, None, 10)) == []

    def test_the_limit_is_bounded_by_the_page_cap(self, fake):
        fake(_earnings_frame())
        rows = asyncio.run(earnings_calendar(None, None, 10_000))
        assert len(rows) <= 100


class TestTheWindowIsChecked:
    def test_an_inverted_window_is_refused(self, fake):
        fake(_earnings_frame())
        with pytest.raises(ProviderUnavailable, match="ends before it starts"):
            asyncio.run(earnings_calendar("2026-09-01", "2026-08-01", 10))

    def test_a_window_past_the_horizon_is_refused(self, fake):
        fake(_earnings_frame())
        with pytest.raises(ProviderUnavailable, match="may not exceed"):
            asyncio.run(earnings_calendar("2020-01-01", "2026-01-01", 10))


class TestTheSourceFailingIsAProviderFailure:
    def test_an_exception_becomes_provider_unavailable(self, monkeypatch):
        def boom(start, end):
            raise RuntimeError("yahoo said no")

        monkeypatch.setattr(calendar_module, "_calendars", boom)
        with pytest.raises(ProviderUnavailable, match="calendar source failed"):
            asyncio.run(earnings_calendar(None, None, 10))


class TestTheEconomicCalendarSharesTheShape:
    def test_it_returns_named_events_without_a_symbol(self, fake):
        frame = pd.DataFrame({
            "Event Name": ["Fed Interest Rate Decision"],
            "Event Start Date": [datetime(2026, 9, 16, 18, 0, tzinfo=timezone.utc)],
            "Country": ["US"],
            "Period": ["Sep"],
            "Actual": [float("nan")],
            "Consensus": ["4.00%"],
            "Prior": ["4.25%"],
        })
        fake(frame)
        rows = asyncio.run(economic_calendar(None, None, 10))
        assert rows[0]["event_name"] == "Fed Interest Rate Decision"
        assert rows[0]["actual"] is None
        assert "symbol" not in rows[0]
