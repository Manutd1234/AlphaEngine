"""Lesson 1, second half: valid prices come from ``price_ranges``, never a name.

Kalshi retired the scalar ``tick_size``. What replaced it is a list of bands,
and the temptation this suite exists to kill is reading the *structure name*
instead — ``linear_cent`` looks like it means a penny grid, and on the day a
new structure ships that reading prices every market on it wrong.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from coherence_fixtures import markets

from modules.coherence.kernel.grid import GridError, parse_price_ranges

# A tapered structure of the shape the changelog describes: fine at the edges
# where a cent is a large share of the price, coarse in the middle.
TAPERED = [
    {"start": "0.0000", "end": "0.0100", "step": "0.0001"},
    {"start": "0.0100", "end": "0.9900", "step": "0.0100"},
    {"start": "0.9900", "end": "1.0000", "step": "0.0001"},
]


class TestAgainstTheRecordedExchange:
    def test_every_captured_market_publishes_a_grid_we_can_read(self):
        rows = markets("markets_ladder") + markets("markets_crypto")
        assert rows, "the market fixtures are empty; re-run tools/capture_kalshi_fixtures.py"
        for market in rows:
            grid = parse_price_ranges(market.get("price_ranges"), market.get("price_level_structure"))
            assert grid.bands, f"{market['ticker']} parsed to no bands"

    def test_the_quoted_prices_sit_on_the_grid_the_market_published(self):
        """If this fails, either our snapping is wrong or the venue changed."""
        for market in markets("markets_ladder"):
            grid = parse_price_ranges(market.get("price_ranges"), market.get("price_level_structure"))
            for field in ("yes_bid_dollars", "yes_ask_dollars", "no_bid_dollars", "no_ask_dollars"):
                quoted = market.get(field)
                if quoted is None:
                    continue
                assert grid.is_valid(Decimal(quoted)), f"{market['ticker']} {field}={quoted} is off its own grid"


class TestSnapping:
    def test_a_price_already_on_the_grid_does_not_move(self):
        grid = parse_price_ranges(TAPERED, "tapered")
        assert grid.snap(Decimal("0.5000"), "buy") == Decimal("0.5000")
        assert grid.snap(Decimal("0.5000"), "sell") == Decimal("0.5000")

    def test_a_buy_snaps_up_and_a_sell_snaps_down(self):
        """Never toward the price that flatters the trade.

        A buy that assumed the cheaper valid price would book edge it cannot
        fill at; the exchange rejects the off-grid price outright.
        """
        grid = parse_price_ranges(TAPERED, "tapered")
        assert grid.snap(Decimal("0.5050"), "buy") == Decimal("0.5100")
        assert grid.snap(Decimal("0.5050"), "sell") == Decimal("0.5000")

    def test_the_edge_bands_keep_their_finer_step(self):
        """The whole reason bands exist: a cent is 25% of a four-cent contract."""
        grid = parse_price_ranges(TAPERED, "tapered")
        assert grid.is_valid(Decimal("0.0037"))
        assert grid.snap(Decimal("0.0037"), "buy") == Decimal("0.0037")

    def test_the_same_price_is_invalid_on_a_penny_grid(self):
        """Same number, different market, different answer — hence the lookup."""
        penny = parse_price_ranges([{"start": "0.0000", "end": "1.0000", "step": "0.0100"}], "linear_cent")
        assert not penny.is_valid(Decimal("0.0037"))
        assert penny.snap(Decimal("0.0037"), "buy") == Decimal("0.0100")

    def test_snapping_stays_inside_the_band_it_started_in(self):
        grid = parse_price_ranges(TAPERED, "tapered")
        assert grid.snap(Decimal("1.0000"), "buy") == Decimal("1.0000")
        assert grid.snap(Decimal("0.0000"), "sell") == Decimal("0.0000")

    def test_reports_the_finest_step_across_every_band(self):
        assert parse_price_ranges(TAPERED, "tapered").finest_step == Decimal("0.0001")


class TestRefusals:
    def test_a_market_with_no_price_ranges_raises_rather_than_assuming_pennies(self):
        """A fallback that produces a confident answer is worse than an error.

        A penny default would be right for most markets today and wrong for
        exactly the sub-penny ones where the engine's margins are tightest.
        """
        with pytest.raises(GridError, match="no price_ranges"):
            parse_price_ranges(None, "linear_cent")

    @pytest.mark.parametrize(
        "band",
        [
            {"start": "0.0000", "end": "1.0000"},
            {"start": "0.0000", "end": "1.0000", "step": "0.0000"},
            {"start": "0.9000", "end": "0.1000", "step": "0.0100"},
        ],
    )
    def test_a_malformed_band_raises(self, band):
        with pytest.raises(GridError):
            parse_price_ranges([band], "broken")

    def test_a_price_outside_every_band_is_not_snapped_to_the_nearest_one(self):
        narrow = parse_price_ranges([{"start": "0.1000", "end": "0.9000", "step": "0.0100"}], "narrow")
        assert not narrow.is_valid(Decimal("0.0500"))
        with pytest.raises(GridError, match="outside every published band"):
            narrow.snap(Decimal("0.0500"), "buy")

    def test_the_structure_name_is_carried_for_the_reader_and_never_branched_on(self):
        """It appears in the certificate so a reader knows which grid a quote sat on."""
        grid = parse_price_ranges(TAPERED, "center_whole_edge_centi_cent")
        assert grid.structure == "center_whole_edge_centi_cent"
        unnamed = parse_price_ranges(TAPERED, None)
        assert unnamed.bands == grid.bands, "the bands decide, not the name"
