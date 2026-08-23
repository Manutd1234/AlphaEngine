"""The only channel on the venue that shows what makers DISAGREE about.

A book shows one number, and that number is the most aggressive opinion resting
on it. For a parlay there is usually no book at all. An RFQ gets several makers
to answer the same question privately and independently, and the spread between
their answers is a quantity nothing else on the exchange exposes — it is not
liquidity and not a bid-offer, it is disagreement, and it is the empirical
counterpart to the Fréchet band.

Two things must not be quietly averaged away. A quote whose two sides bid to
more than a dollar between them is the Lesson-0 identity failing, which means
the sides were priced at different moments — it is one maker's two moments, not
one view, and it leaves the panel. And a panel of one maker is not a
disagreement: its spread is ``None``, never zero, because zero would read as
perfect agreement among people who never spoke.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx
import pytest

from modules.coherence.drivers.kalshi_rest import KalshiClient
from modules.coherence.drivers.rfq import THIN_PANEL, Quote, disperse, parse_quotes, parse_rfqs, read_panel
from modules.coherence.scheduler.budget import ReadBudget

MARKET = "KXMVECROSSCATEGORY-SHARD1-S2026"


def quote(quote_id: str, yes_bid: str | None, no_bid: str | None, market: str = MARKET) -> dict[str, Any]:
    row: dict[str, Any] = {"id": quote_id, "rfq_id": "r1", "market_ticker": market, "created_ts": "2026-08-23T22:00:00Z"}
    if yes_bid is not None:
        row["yes_bid_dollars"] = yes_bid
    if no_bid is not None:
        row["no_bid_dollars"] = no_bid
    return row


def panel(*rows: dict[str, Any]) -> list[Quote]:
    return parse_quotes({"quotes": list(rows)})


def client(routes: dict[str, tuple[int, dict[str, Any]]]) -> KalshiClient:
    """The RFQ channel, at whichever status each of its two routes answers."""

    def handler(request: httpx.Request) -> httpx.Response:
        for fragment, (status, payload) in routes.items():
            if fragment in request.url.path:
                return httpx.Response(status, json=payload)
        return httpx.Response(404, json={"error": "unexpected path in test"})

    return KalshiClient(transport=httpx.MockTransport(handler), budget=ReadBudget())


class TestOneMakersAnswerIsAnInterval:
    """Both sides are BIDS, so a quote brackets its own estimate."""

    def test_a_two_sided_quote_brackets_the_estimate_between_the_two_bids(self):
        """Bidding 0.31 for YES and 0.63 for NO says "between 0.31 and 0.37"."""
        made = panel(quote("q1", "0.3100", "0.6300"))[0]
        assert made.implied_low == Decimal("0.3100")
        assert made.implied_high == Decimal("0.3700")
        assert made.estimate == Decimal("0.3400")
        assert made.width == Decimal("0.0600")

    def test_a_one_sided_quote_is_a_point_with_no_width(self):
        made = panel(quote("q1", "0.3100", None))[0]
        assert made.estimate == Decimal("0.3100")
        assert made.width is None
        assert not made.crossed

    def test_a_quote_bidding_only_the_no_side_is_read_from_the_other_end(self):
        made = panel(quote("q1", None, "0.6300"))[0]
        assert made.implied_low is None
        assert made.estimate == Decimal("0.3700")

    def test_a_bid_of_nothing_is_a_price_rather_than_an_absence(self):
        """Zero is a legal price on this exchange. A contract nobody believes in
        can be bid at nothing, and that is not the same as no bid."""
        made = panel(quote("q1", "0.0000", "0.9500"))[0]
        assert made.yes_bid == Decimal(0)
        assert made.estimate == Decimal("0.0250")

    def test_a_quote_with_neither_side_has_no_estimate_at_all(self):
        assert panel(quote("q1", None, None))[0].estimate is None


class TestACrossedQuoteIsTwoMomentsNotOneView:
    @pytest.fixture
    def quotes(self):
        """Three makers, one of whom bids 0.40 YES and 0.65 NO — $1.05 between
        the two sides, for a pair that returns exactly a dollar."""
        return panel(
            quote("q1", "0.3100", "0.6300"),
            quote("q2", "0.3400", "0.6000"),
            quote("q3", "0.4000", "0.6500"),
        )

    def test_the_crossed_quote_is_named_as_such(self, quotes):
        assert [item.crossed for item in quotes] == [False, False, True]

    def test_its_implied_interval_runs_backwards_which_is_the_tell(self, quotes):
        assert quotes[2].width == Decimal("-0.0500")

    def test_it_is_left_out_of_the_dispersion_and_counted(self, quotes):
        reading = disperse(MARKET, quotes)
        assert reading.quotes == 3
        assert reading.usable == 2
        assert reading.crossed == 1

    def test_the_spread_is_taken_over_the_makers_that_remain(self, quotes):
        """0.34 and 0.37, so three cents of disagreement. Including the crossed
        quote's 0.375 would have widened it on an artefact."""
        reading = disperse(MARKET, quotes)
        assert reading.lowest == Decimal("0.3400")
        assert reading.highest == Decimal("0.3700")
        assert reading.spread == Decimal("0.0300")

    def test_and_the_exclusion_is_said_out_loud(self, quotes):
        assert "bid over a dollar across both sides and were left out" in disperse(MARKET, quotes).detail

    def test_a_pair_summing_to_exactly_a_dollar_is_not_crossed(self):
        """Zero spread is a tight market, not a torn snapshot."""
        made = panel(quote("q1", "0.3100", "0.6900"))[0]
        assert not made.crossed
        assert made.width == 0


class TestAPanelOfOneIsNotADisagreement:
    def test_a_single_usable_quote_reports_no_spread_rather_than_a_spread_of_zero(self):
        """Zero would read as two makers agreeing exactly, which is the most
        flattering thing this pane could say about a market nobody quoted."""
        reading = disperse(MARKET, panel(quote("q1", "0.3100", "0.6300")))
        assert reading.usable == 1
        assert reading.spread is None
        assert reading.median_width is None
        assert reading.median == Decimal("0.3400"), "the one estimate is still worth showing"

    def test_a_market_nobody_quoted_reports_nothing_rather_than_zero(self):
        reading = disperse("KX-NOT-QUOTED", panel(quote("q1", "0.3100", "0.6300")))
        assert (reading.quotes, reading.usable) == (0, 0)
        assert reading.spread is None and reading.median is None
        assert reading.lowest is None and reading.highest is None

    def test_a_panel_whose_only_quotes_are_crossed_has_nothing_usable_left(self):
        reading = disperse(MARKET, panel(quote("q1", "0.4000", "0.6500"), quote("q2", "0.5000", "0.6000")))
        assert reading.quotes == 2 and reading.usable == 0
        assert reading.crossed == 2
        assert reading.spread is None

    def test_the_refusal_says_what_a_disagreement_needs(self):
        reading = disperse(MARKET, panel(quote("q1", "0.3100", "0.6300")))
        assert "at least two independent makers" in reading.detail

    def test_two_makers_produce_a_spread_and_are_still_called_thin(self):
        reading = disperse(MARKET, panel(quote("q1", "0.3100", "0.6300"), quote("q2", "0.3400", "0.6000")))
        assert reading.spread == Decimal("0.0300")
        assert reading.thin is True
        assert "fewer than three makers" in reading.detail

    def test_a_full_panel_is_not_thin(self):
        rows = [quote(f"q{index}", f"0.3{index}00", "0.6000") for index in range(1, THIN_PANEL + 1)]
        reading = disperse(MARKET, panel(*rows))
        assert reading.usable == THIN_PANEL
        assert reading.thin is False
        assert "fewer than three makers" not in reading.detail

    def test_the_spread_is_the_number_a_frechet_band_is_compared_against(self):
        """Same units — dollars of probability — which is the only reason this
        class exists rather than a bare pair of prices."""
        reading = disperse(MARKET, panel(quote("q1", "0.3100", "0.6300"), quote("q2", "0.3400", "0.6000")))
        assert reading.uses_band == reading.spread


class TestReadingTheChannel:
    ROUTE_RFQS = "/communications/rfqs"
    ROUTE_QUOTES = "/communications/quotes"

    @pytest.mark.anyio
    async def test_an_unsigned_read_is_no_view_rather_than_a_worse_one(self):
        made = client({self.ROUTE_RFQS: (401, {}), self.ROUTE_QUOTES: (401, {})})
        result = await read_panel(made)
        assert result["state"] == "refused"
        assert "a demo key signs demo, never production" in result["detail"]
        assert result["dispersions"] == []

    @pytest.mark.anyio
    async def test_a_server_fault_is_a_refusal_with_the_venues_own_reason(self):
        made = client({self.ROUTE_RFQS: (503, {}), self.ROUTE_QUOTES: (503, {})})
        result = await read_panel(made)
        assert result["state"] == "refused"
        assert result["rfqs"] == []

    @pytest.mark.anyio
    async def test_an_empty_sandbox_is_reported_as_empty_not_as_a_quiet_market(self):
        made = client({self.ROUTE_RFQS: (200, {"rfqs": []}), self.ROUTE_QUOTES: (200, {"quotes": []})})
        result = await read_panel(made)
        assert result["state"] == "empty"
        assert "makers do not quote a sandbox" in result["detail"]

    @pytest.mark.anyio
    async def test_quotes_in_hand_are_dispersed_per_market(self):
        made = client({
            self.ROUTE_RFQS: (200, {"rfqs": [{"id": "r1", "market_ticker": MARKET, "contracts": 100, "status": "open"}]}),
            self.ROUTE_QUOTES: (200, {"quotes": [
                quote("q1", "0.3100", "0.6300"),
                quote("q2", "0.3400", "0.6000"),
                quote("q3", "0.1000", "0.8000", market="KX-OTHER"),
            ]}),
        })
        result = await read_panel(made)
        assert result["state"] == "available"
        assert {item.market_ticker for item in result["dispersions"]} == {MARKET, "KX-OTHER"}
        assert "1 open request(s) and 3 quote(s) across 2 market(s)" in result["detail"]

    @pytest.mark.anyio
    async def test_a_market_named_only_by_a_quote_still_gets_a_row(self):
        """The request and the answers do not have to arrive in the same page."""
        made = client({
            self.ROUTE_RFQS: (200, {"rfqs": []}),
            self.ROUTE_QUOTES: (200, {"quotes": [quote("q1", "0.3100", "0.6300")]}),
        })
        result = await read_panel(made)
        assert [item.market_ticker for item in result["dispersions"]] == [MARKET]


class TestWhatTheParserRefusesToInvent:
    def test_a_payload_of_another_shape_yields_no_quotes(self):
        assert parse_quotes({}) == []
        assert parse_quotes({"quotes": "not a list"}) == []

    def test_a_row_that_is_not_an_object_is_skipped_rather_than_guessed_at(self):
        assert parse_quotes({"quotes": ["not an object", quote("q1", "0.31", "0.63")]}) != []
        assert len(parse_quotes({"quotes": ["not an object", quote("q1", "0.31", "0.63")]})) == 1

    def test_an_unparseable_price_is_absent_rather_than_zero(self):
        made = parse_quotes({"quotes": [{"id": "q1", "market_ticker": MARKET, "yes_bid_dollars": "not-a-price"}]})[0]
        assert made.yes_bid is None
        assert made.estimate is None

    def test_a_boolean_is_never_read_as_a_price(self):
        made = parse_quotes({"quotes": [{"id": "q1", "market_ticker": MARKET, "yes_bid_dollars": True}]})[0]
        assert made.yes_bid is None

    def test_a_request_carries_its_size_and_status(self):
        rows = parse_rfqs({"rfqs": [{"id": "r1", "market_ticker": MARKET, "contracts": 250, "status": "open"}]})
        assert rows[0].contracts == 250
        assert rows[0].status == "open"

    def test_a_request_with_a_non_integer_size_reports_none_rather_than_zero(self):
        rows = parse_rfqs({"rfqs": [{"id": "r1", "market_ticker": MARKET, "contracts": "lots"}]})
        assert rows[0].contracts is None
