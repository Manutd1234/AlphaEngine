"""The size fields Kalshi publishes and this engine was dropping.

``/markets`` carries four figures that say how much is at stake — resting-order
dollars, contracts outstanding, contracts traded and what one contract pays —
and until this suite existed ``parse_market`` read none of them. The desk had
prices and no way to say whether anybody was trading at those prices.

**Zero is a measurement here, and that is what most of this file is about.**
Every one of the sixty markets in ``markets_crypto`` reports
``open_interest_fp: "0.00"`` and ``liquidity_dollars: "0.0000"`` — truthfully,
because it is a settled hourly BTC ladder that never traded. A parser that
turns an absent key into 0 invents an empty book; a surface that renders a
measured 0 as a dash hides the fact that the exchange looked and found nothing.
The two must stay distinguishable all the way to the wire, so they are asserted
separately here rather than through one "falsy" check.

The fields stay STRINGS, like every other fixed-point quantity on this path.
"""

from __future__ import annotations

import pytest
from coherence_fixtures import markets

from modules.coherence.drivers.kalshi_parse import REQUIRED_MARKET_FIELDS, Event, parse_market
from modules.coherence.syscalls.observe import MarketObservation, Observation
from modules.coherence.views import event_view, market_view

SIZE_FIELDS = ("open_interest", "liquidity", "volume", "notional_value")

# The wire names, which are NOT the field names. Kalshi spells the fixed-point
# counts `_fp` and the money `_dollars`, and the engine's own names drop both
# suffixes because the suffix describes the encoding, not the quantity.
WIRE = {
    "open_interest": "open_interest_fp",
    "liquidity": "liquidity_dollars",
    "volume": "volume_fp",
    "notional_value": "notional_value_dollars",
}


@pytest.fixture
def crypto() -> dict:
    """One real market off the recorded crypto ladder."""
    return markets("markets_crypto")[0]


class TestTheFieldsArrive:
    def test_parse_market_carries_all_four(self, crypto):
        market = parse_market(crypto)
        for field in SIZE_FIELDS:
            assert hasattr(market, field), f"Market drops {field}; the desk cannot size anything without it"

    def test_they_stay_strings_exactly_as_the_wire_sent_them(self, crypto):
        market = parse_market(crypto)
        for field in SIZE_FIELDS:
            value = getattr(market, field)
            assert isinstance(value, str), f"{field} arrived as {type(value).__name__}; binary64 rounds it"
            assert value == crypto[WIRE[field]], f"{field} was reformatted on the way in"

    def test_the_recorded_ladder_really_does_report_zero(self, crypto):
        """Guards the fixture, not the code.

        If a re-capture lands a ladder that HAS traded, the zero-versus-absent
        tests below stop testing what they claim to and would still pass.
        """
        assert crypto["open_interest_fp"] == "0.00"
        assert crypto["liquidity_dollars"] == "0.0000"


class TestZeroIsNotAbsence:
    def test_a_measured_zero_survives_as_a_zero(self, crypto):
        market = parse_market(crypto)
        assert market.open_interest == "0.00", "a measured zero became something else"
        assert market.liquidity == "0.0000"

    def test_an_absent_field_is_none_and_never_a_zero(self, crypto):
        """A protocol change drops the key. That is not an empty book."""
        stripped = {k: v for k, v in crypto.items() if k not in WIRE.values()}
        market = parse_market(stripped)
        for field in SIZE_FIELDS:
            assert getattr(market, field) is None, (
                f"{field} filled itself in when the venue stopped sending it — "
                "this is the defect the schema_probe exists to make loud"
            )

    def test_the_new_fields_are_not_required_to_parse(self):
        """A required field the venue omits fails the WHOLE universe read.

        ``parse_market`` raises on a missing required field, and the universe
        route parses every market of every watched family through it. One
        renamed size field would take the entire watchlist down rather than one
        figure, so these four must never join that tuple.
        """
        for field in WIRE.values():
            assert field not in REQUIRED_MARKET_FIELDS, (
                f"{field} is required; a venue that stops sending it now empties the tab"
            )


class TestTheyReachTheWire:
    def test_market_view_surfaces_all_four(self, crypto):
        market = parse_market(crypto)
        view = market_view(market, market.top)
        for field in SIZE_FIELDS:
            assert getattr(view, field) == getattr(market, field), f"{field} is parsed but never sent"

    def test_the_view_keeps_a_measured_zero_distinct_from_an_absent_one(self, crypto):
        measured = market_view(parse_market(crypto), parse_market(crypto).top)
        stripped_payload = {k: v for k, v in crypto.items() if k not in WIRE.values()}
        stripped = parse_market(stripped_payload)
        absent = market_view(stripped, stripped.top)
        assert measured.open_interest == "0.00"
        assert absent.open_interest is None
        assert measured.open_interest != absent.open_interest, (
            "the wire cannot tell 'nobody traded' from 'we did not ask'"
        )


class TestTheFamilyTotal:
    """A family's own size, which is the denominator every share is read against.

    Same discipline as ``basket_totals`` and for the same reason: a total built
    from the legs that answered understates the family by exactly the legs it
    skipped, and a share computed against an understated denominator reads too
    large. So a family missing one leg's figure reports no total at all.
    """

    def _observed(self, payloads: list[dict]) -> Observation:
        parsed = [parse_market(p) for p in payloads]
        return Observation(
            ts_ns=0,
            event=Event(
                event_ticker=parsed[0].event_ticker,
                series_ticker=parsed[0].series_ticker,
                title="",
                mutually_exclusive=False,
                exchange_index=0,
                settlement_sources=(),
                markets=tuple(parsed),
            ),
            markets=[MarketObservation(market=m, book=m.top) for m in parsed],
        )

    def test_a_whole_family_totals(self):
        payloads = markets("markets_crypto")[:3]
        view = event_view(self._observed(payloads))
        # Every leg of this ladder reports "0.00", so the total is a measured
        # zero — not an absence, and not a None.
        assert view.open_interest_total == "0.00"
        assert view.liquidity_total == "0.0000"

    def test_one_leg_without_a_figure_withholds_the_whole_total(self):
        payloads = [dict(m) for m in markets("markets_crypto")[:3]]
        del payloads[1]["open_interest_fp"]
        view = event_view(self._observed(payloads))
        assert view.open_interest_total is None, (
            "a total was built from the legs that answered; the share it "
            "denominates would read too large"
        )
        # The other field is unaffected — one absent figure withholds one total.
        assert view.liquidity_total == "0.0000"
