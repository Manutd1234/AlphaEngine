"""The variable a contract settles on, which is not the price anyone watches.

Kalshi does not settle a temperature contract on the latest reading. It settles
on an average over a window, published per minute with a contributor count and
a quality flag on every sample. Three facts follow, and each is asserted below
against the recorded Miami index rather than against a hand-built series:
the index is time-averaged, so spot and settlement differ; it is quality
controlled, so a degraded minute is neither a normal one nor a missing one; and
it is not published everywhere, so a city the venue does not cover is a fact
about coverage rather than an empty temperature series.

The refusals are the other half. ``entitlement_required``, ``not_covered`` and
``unavailable`` are three different problems and only the last is worth
retrying, so they are read back from the exception rather than flattened.
"""

from __future__ import annotations

from decimal import Decimal

import httpx
import pytest
from coherence_fixtures import body

from modules.coherence.drivers import livedata
from modules.coherence.drivers.kalshi_rest import KalshiClient
from modules.coherence.drivers.livedata import (
    KNOWN_WEATHER_CITIES,
    LiveDataUnavailable,
    covered_cities,
    parse_event_index,
    parse_weather,
    qc_summary,
)
from modules.coherence.scheduler.budget import ReadBudget

MIAMI = "live_data_weather_miami"


def client(status: int, payload: dict | None = None) -> KalshiClient:
    """The venue at one status code, through an injected transport."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=payload if payload is not None else {"error": "refused"})

    return KalshiClient(transport=httpx.MockTransport(handler), budget=ReadBudget())


def sample(ts_ms: int, value: str, contributors: int = 5, status: str = "normal") -> dict:
    return {"t": ts_ms, "v": float(value), "contributors": contributors, "status": status}


def index_of(rows: list[dict]) -> livedata.WeatherIndex:
    return parse_weather("miami", {"config_version": "test-v1", "timeseries": rows})


class TestTheRecordedMiamiIndex:
    """1,435 published minutes, five contributors throughout, two degraded."""

    @pytest.fixture
    def index(self):
        return parse_weather("miami", body(MIAMI))

    def test_every_published_minute_survives_the_parse(self, index):
        assert len(index.samples) == 1435
        assert index.config_version == "miami-temperature-v1.0-qc-20260818"

    def test_the_two_degraded_minutes_are_kept_and_flagged(self, index):
        """A degraded minute is not a missing minute and not a normal one.
        Collapsing the three loses the only signal there is about whether the
        number can be trusted."""
        assert len(index.degraded) == 2
        assert [str(item.value) for item in index.degraded] == ["90.03", "86.5"]
        assert all(item.status == "degraded" for item in index.degraded)

    def test_the_contributor_count_is_reported_as_a_range(self, index):
        assert index.contributor_range == (5, 5)

    def test_the_settlement_average_is_not_the_latest_print(self, index):
        """The point of the whole module. A position taken against the last
        reading carries exactly this much basis, whether or not anyone notices."""
        assert index.latest is not None and index.latest.value == Decimal("88.52")
        assert index.window_average(60) == Decimal("87.812")
        assert index.spot_minus_window == Decimal("0.708")

    def test_the_samples_come_back_in_time_order(self, index):
        stamps = [item.ts_ms for item in index.samples]
        assert stamps == sorted(stamps)

    def test_the_summary_reports_both_averages_so_the_flags_can_be_judged(self, index):
        summary = qc_summary(index)
        assert summary["samples"] == 1435
        assert summary["degraded_samples"] == 2
        assert summary["hour_average"] == "87.812"
        assert summary["hour_average_clean"] == "87.812", "today's degraded minutes are outside the window"
        assert summary["spot_minus_window"] == "0.708"


class TestTheQualityControlChangesTheNumber:
    def test_excluding_the_flagged_minutes_gives_a_different_average(self):
        """Which is how you find out whether the flags matter today. On Miami's
        index they did not; on a window that contains one, they do."""
        rows = [sample(60_000 * n, "80") for n in range(59)] + [sample(60_000 * 59, "100", status="degraded")]
        index = index_of(rows)
        assert index.window_average(60) == Decimal("80.33333333333333333333333333")
        assert index.window_average(60, include_degraded=False) == Decimal(80)

    def test_a_window_of_nothing_but_flagged_minutes_reports_none_not_zero(self):
        index = index_of([sample(60_000 * n, "80", status="degraded") for n in range(3)])
        assert index.window_average(3, include_degraded=False) is None
        assert index.window_average(3) == Decimal(80)

    def test_an_unrecognised_flag_is_unknown_rather_than_assumed_normal(self):
        index = index_of([sample(0, "80", status="provisional"), sample(60_000, "81")])
        assert [item.status for item in index.samples] == ["unknown", "normal"]
        assert index.degraded == ()

    def test_an_empty_series_has_no_average_and_no_range(self):
        index = index_of([])
        assert index.window_average(60) is None
        assert index.contributor_range is None
        assert index.latest is None
        assert index.spot_minus_window is None

    def test_a_window_of_no_minutes_is_refused_rather_than_divided_by_zero(self):
        index = index_of([sample(0, "80")])
        assert index.window_average(0) is None


class TestWhatTheParserRefusesToInvent:
    def test_a_row_with_no_value_is_dropped_rather_than_read_as_zero(self):
        index = index_of([sample(0, "80"), {"t": 60_000, "contributors": 5, "status": "normal"}])
        assert len(index.samples) == 1

    def test_a_row_with_no_timestamp_cannot_be_placed_on_the_clock(self):
        index = index_of([sample(0, "80"), {"t": "not-a-stamp", "v": 81.0}])
        assert len(index.samples) == 1

    def test_a_missing_contributor_count_reads_as_none_contributing(self):
        index = index_of([{"t": 0, "v": 80.0, "status": "normal"}])
        assert index.samples[0].contributors == 0

    def test_a_payload_with_no_series_at_all_is_an_empty_index_not_an_error(self):
        assert parse_weather("miami", {}).samples == ()

    def test_the_venue_value_does_not_travel_through_binary(self):
        """Converting via ``str`` keeps the shortest representation that round
        trips instead of adding seventeen digits of binary artefact."""
        index = index_of([sample(0, "89.96"), sample(60_000, "89.96")])
        assert str(index.samples[0].value) == "89.96"


class TestTheEventCandles:
    PAYLOAD = {
        "live_data": {
            "default_range": "1h",
            "details": {
                "candlesticks": {
                    "60": [
                        {"open_ts_ms": 2_000, "open": 77_100.0, "high": 77_300.0, "low": 77_000.0, "close": 77_185.0},
                        {"open_ts_ms": 1_000, "open": 77_000.0, "high": 77_150.0, "low": 76_900.0, "close": 77_100.0},
                    ],
                    "1": [{"open_ts_ms": 3_000, "open": 77_180.0, "high": 77_200.0, "low": 77_150.0, "close": 77_190.0}],
                }
            },
        }
    }

    def test_the_bars_come_back_in_time_order_whatever_order_they_arrived_in(self):
        index = parse_event_index("KXBTCD-1", self.PAYLOAD)
        assert [candle.open_ts_ms for candle in index.candles["60"]] == [1_000, 2_000]

    def test_the_finest_resolution_is_the_one_closest_to_the_tape(self):
        index = parse_event_index("KXBTCD-1", self.PAYLOAD)
        finest = index.finest
        assert finest is not None and finest[0] == "1"
        assert index.latest_close == Decimal("77190.0")

    def test_a_candle_close_is_an_average_and_its_range_says_how_wide(self):
        """A fifteen-minute candle closing at 77,185 is not a print at 77,185.
        A basket priced off a spot tick is priced off a different variable."""
        index = parse_event_index("KXBTCD-1", self.PAYLOAD)
        latest = index.candles["60"][-1]
        assert latest.close == Decimal("77185.0")
        assert latest.range == Decimal("300.0")

    def test_a_bar_missing_a_side_has_no_range_rather_than_a_range_of_zero(self):
        index = parse_event_index("KXBTCD-1", {"live_data": {"details": {"candlesticks": {
            "60": [{"open_ts_ms": 1_000, "close": 77_100.0}]
        }}}})
        candle = index.candles["60"][0]
        assert candle.high is None and candle.low is None
        assert candle.range is None

    def test_an_empty_resolution_is_left_out_rather_than_listed_empty(self):
        index = parse_event_index("KXBTCD-1", {"live_data": {"details": {"candlesticks": {"60": []}}}})
        assert index.candles == {}
        assert index.finest is None
        assert index.latest_close is None

    def test_a_payload_of_another_shape_is_an_empty_index(self):
        index = parse_event_index("KXBTCD-1", {"live_data": "not a mapping"})
        assert index.candles == {} and index.default_range == ""


class TestThreeRefusalsThatAreNotTheSameProblem:
    @pytest.mark.anyio
    async def test_a_signed_only_feed_answering_401_needs_an_entitlement(self):
        with pytest.raises(LiveDataUnavailable) as caught:
            await livedata.fetch_weather(client(401), "miami")
        assert caught.value.kind == "entitlement_required"

    @pytest.mark.anyio
    async def test_a_server_fault_is_the_only_one_worth_retrying(self):
        with pytest.raises(LiveDataUnavailable) as caught:
            await livedata.fetch_event_index(client(500), "KXBTCD-1")
        assert caught.value.kind == "unavailable"

    @pytest.mark.anyio
    async def test_an_unnamed_city_is_refused_before_a_request_is_spent(self):
        with pytest.raises(LiveDataUnavailable) as caught:
            await livedata.fetch_weather(client(200, {}), "   ")
        assert caught.value.kind == "not_covered"
        assert caught.value.reason == "no city was named"

    @pytest.mark.anyio
    async def test_a_city_the_venue_does_not_publish_is_a_coverage_fact(self):
        with pytest.raises(LiveDataUnavailable) as caught:
            await livedata.fetch_weather(client(400, {"error": "weather is published for: miami"}), "chicago")
        assert caught.value.kind == "not_covered"

    @pytest.mark.anyio
    async def test_the_recorded_city_reads_back_through_the_client_whole(self):
        index = await livedata.fetch_weather(client(200, body(MIAMI)), "Miami")
        assert index.city == "miami", "the slug is lowered before the request"
        assert len(index.samples) == 1435


class TestTheReferenceRateIsReportedRatherThanRaised:
    """"We cannot see the reference rate" is a standing property of a
    deployment, not an error that should interrupt a poll."""

    @pytest.mark.anyio
    async def test_a_401_is_an_entitlement_and_never_a_network_fault(self):
        state = await livedata.cfbenchmarks_state(client(401))
        assert state["state"] == "entitlement_required"
        assert "gated on an account entitlement rather than on signing" in state["detail"]

    @pytest.mark.anyio
    async def test_a_server_fault_stays_unavailable(self):
        assert (await livedata.cfbenchmarks_state(client(503)))["state"] == "unavailable"

    @pytest.mark.anyio
    async def test_a_reachable_passthrough_hands_the_payload_back(self):
        state = await livedata.cfbenchmarks_state(client(200, {"values": [{"id": "BRTI"}]}))
        assert state["state"] == "available"
        assert state["payload"] == {"values": [{"id": "BRTI"}]}


class TestWhatTheVenueCovers:
    def test_the_known_list_is_a_note_rather_than_a_whitelist_the_code_enforces(self):
        assert covered_cities() == KNOWN_WEATHER_CITIES == ("miami",)

    def test_a_probe_replaces_it_rather_than_being_filtered_through_it(self):
        assert covered_cities(["miami", "chicago"]) == ("miami", "chicago")
