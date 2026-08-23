"""Normalising a calendar envelope, and refusing to invent what it lacks.

Two hazards, one test class each. A vendor stamp that cannot be parsed must
never become the fetch clock — that is silent look-ahead, and it is the
documented defect on the web side. And the second stage of an earnings event is
not published by anyone free, so the row that carries it must say it was
assumed.
"""

from __future__ import annotations

import httpx
import pytest

from modules.coherence.diffusion.calendar import earnings_events, fetch_earnings


def _envelope(*rows) -> dict:
    return {"ok": True, "data": list(rows)}


def _row(**overrides) -> dict:
    row = {
        "symbol": "AVGO", "company": "Broadcom Inc.", "event_name": "Q3 2026 Earnings",
        "start_at": "2026-09-02T20:00:00+00:00", "timing": "AMC",
        "eps_estimate": 3.24, "eps_actual": None, "surprise_pct": None,
    }
    row.update(overrides)
    return row


class TestARowBecomesAnEvent:
    def test_the_reference_carries_the_symbol_and_the_date(self):
        read = earnings_events(_envelope(_row()))
        assert read.state == "ok"
        assert read.events[0].source_ref == "yf:AVGO:2026-09-02"
        assert read.events[0].kind == "earnings"

    def test_the_session_word_survives(self):
        assert earnings_events(_envelope(_row(timing="BMO"))).events[0].release_timing == "BMO"

    def test_an_unknown_session_word_is_dropped_rather_than_kept_as_noise(self):
        assert earnings_events(_envelope(_row(timing="whenever"))).events[0].release_timing is None

    def test_a_missing_estimate_stays_missing(self):
        event = earnings_events(_envelope(_row(eps_estimate=None))).events[0]
        assert event.eps_estimate is None, "a missing estimate became a number"

    def test_a_nan_never_reaches_the_ledger(self):
        event = earnings_events(_envelope(_row(eps_actual=float("nan")))).events[0]
        assert event.eps_actual is None


class TestTheSecondStageIsMarkedAsAssumed:
    def test_it_is_the_release_plus_the_configured_offset(self):
        event = earnings_events(_envelope(_row()), offset_min=45.0).events[0]
        assert event.call_at == event.release_at + 45.0 * 60_000
        assert event.call_offset_min == 45.0

    def test_the_source_says_it_was_estimated(self):
        event = earnings_events(_envelope(_row())).events[0]
        assert event.call_at_source == "estimated_offset", (
            "a horizon measured from a guessed start must not look like a recorded one"
        )


class TestAnUndatableRowIsDroppedNotDated:
    def test_an_unparseable_stamp_is_skipped_and_counted(self):
        read = earnings_events(_envelope(_row(start_at="not a date"), _row(symbol="MRVL")))
        assert read.skipped == 1
        assert [event.symbol for event in read.events] == ["MRVL"]

    def test_a_missing_stamp_never_becomes_now(self):
        read = earnings_events(_envelope(_row(start_at=None)))
        assert read.events == () and read.skipped == 1

    def test_a_row_with_no_symbol_is_skipped(self):
        assert earnings_events(_envelope(_row(symbol=""))).skipped == 1


class TestTheEnvelopeStatesAreDistinct:
    def test_an_empty_window_is_empty_rather_than_unavailable(self):
        read = earnings_events({"ok": True, "data": []})
        assert read.state == "empty" and read.events == ()

    def test_a_refusing_source_is_unavailable_with_its_own_message(self):
        read = earnings_events({"ok": False, "error": "yahoo said no"})
        assert read.state == "unavailable" and "yahoo said no" in (read.reason or "")

    def test_a_body_that_is_not_an_envelope_is_unavailable(self):
        assert earnings_events(["not", "an", "envelope"]).state == "unavailable"


class TestFetchingSaysWhyItCouldNot:
    def test_no_configured_source_is_unconfigured_not_empty(self):
        read = fetch_earnings("")
        assert read.state == "unconfigured"
        assert "no calendar source is configured" in (read.reason or "")

    def test_a_good_response_is_normalised(self):
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=_envelope(_row()))))
        try:
            read = fetch_earnings("https://service.test", client=client)
        finally:
            client.close()
        assert read.state == "ok" and read.events[0].symbol == "AVGO"

    def test_a_transport_failure_is_unavailable_with_the_reason(self):
        def boom(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        client = httpx.Client(transport=httpx.MockTransport(boom))
        try:
            read = fetch_earnings("https://service.test", client=client)
        finally:
            client.close()
        assert read.state == "unavailable" and "no route" in (read.reason or "")

    def test_the_window_reaches_the_query(self):
        seen: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(dict(request.url.params))
            return httpx.Response(200, json=_envelope(_row()))

        client = httpx.Client(transport=httpx.MockTransport(handler))
        try:
            fetch_earnings("https://service.test", start="2026-08-01", end="2026-09-01",
                           limit=25, client=client)
        finally:
            client.close()
        assert seen["kind"] == "earnings" and seen["start"] == "2026-08-01"
        assert seen["limit"] == "25"


@pytest.mark.parametrize("timing", ["BMO", "AMC", "TAS", "TNS"])
def test_every_vendor_timing_word_is_accepted(timing):
    assert earnings_events(_envelope(_row(timing=timing))).events[0].release_timing == timing
