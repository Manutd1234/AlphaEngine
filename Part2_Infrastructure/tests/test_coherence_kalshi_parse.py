"""The parsers, against payloads recorded from the live exchange.

Every assertion here is about a shape Kalshi actually sent, not one we designed.
The three that cost the most to learn are pinned first: the nested-markets
response carries an empty top-level ``markets`` beside a populated
``event.markets``; the bulk orderbook silently accepts a comma-joined ticker
list and answers 200 with empty ladders; and the market object's ``status``
vocabulary is not the ``status=`` filter's vocabulary.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from coherence_fixtures import body, markets

from modules.coherence.drivers.kalshi_parse import (
    ParseError,
    parse_event,
    parse_market,
    parse_orderbooks,
    parse_series_fees,
    schema_probe,
)


class TestTheTrapsWorthATest:
    def test_nested_markets_are_read_from_the_event_not_the_empty_top_level_list(self):
        """The recorded response carries BOTH keys, and the outer one is empty.

        ``payload["markets"]`` alone reads zero markets from an event that has
        five, with no error anywhere — the event simply looks unquoted.
        """
        payload = body("event_mee")
        assert payload["markets"] == [], "the fixture no longer shows this trap; re-read the response shape"
        assert payload["event"]["markets"], "the populated list moved"
        event = parse_event(payload)
        assert len(event.markets) == 5

    def test_a_comma_joined_bulk_request_is_caught_rather_than_read_as_empty_books(self):
        """HTTP 200, one entry, empty ladders — a whole exchange of 'no liquidity'."""
        with pytest.raises(ParseError, match="REPEATED query parameter"):
            parse_orderbooks(body("orderbook_bulk_comma_joined"))

    def test_the_repeated_form_returns_a_book_per_ticker(self):
        books = parse_orderbooks(body("orderbook_bulk"))
        assert len(books) >= 5
        assert all("," not in ticker for ticker in books)

    def test_the_status_field_says_active_where_the_filter_said_open(self):
        """Two vocabularies for one word. Comparing them matches nothing."""
        rows = markets("markets_ladder")
        assert rows, "market fixture is empty"
        assert {row["status"] for row in rows} == {"active"}
        parsed = [parse_market(row) for row in rows]
        assert all(market.is_open for market in parsed)


class TestMarkets:
    def test_reads_every_strike_vocabulary_the_exchange_actually_uses(self):
        """The spec named three; the exchange serves at least five."""
        kinds = {parse_market(row).strike_kind for row in markets("markets_ladder")}
        assert kinds <= {"greater", "greater_or_equal", "less", "less_or_equal", "between", "custom"}
        assert "between" in kinds and "greater" in kinds and "less" in kinds

    def test_an_unknown_strike_word_is_labelled_not_guessed(self):
        row = dict(markets("markets_ladder")[0], strike_type="parabolic_wagering")
        assert parse_market(row).strike_kind == "unknown"

    def test_strikes_become_decimals_without_passing_through_float(self):
        """``Decimal(87.3)`` is not 87.3, and strikes are compared to each other."""
        row = dict(markets("markets_ladder")[0], floor_strike=87.3)
        assert parse_market(row).floor_strike == Decimal("87.3")

    def test_a_payload_missing_the_fixed_point_fields_raises(self):
        """The March 2026 migration removed the integer fields; a pre-migration
        client parses today's payload into a book of zeros without erroring."""
        legacy = {"ticker": "X", "yes_bid": 42, "yes_ask": 44, "tick_size": 1}
        with pytest.raises(ParseError, match="not the schema"):
            parse_market(legacy)

    def test_carries_the_shard_because_collateral_is_per_shard(self):
        assert parse_market(markets("markets_ladder")[0]).exchange_index in (0, 1, 2, 3)


class TestEventsAndFees:
    def test_reads_the_exchanges_own_mutual_exclusivity_flag(self):
        """The licence for 'these prices sum to one' is this boolean, not our
        arithmetic over floor/cap — buckets need not tile in general."""
        assert parse_event(body("event_mee")).mutually_exclusive is True

    def test_settlement_sources_are_sorted_so_comparison_is_order_independent(self):
        sources = parse_event(body("event_mee")).settlement_sources
        assert sources == tuple(sorted(sources))
        assert sources, "the MEE fixture lost its settlement sources"

    def test_the_fee_multiplier_is_a_multiplier_not_a_rate(self):
        """Live it is 1 on almost every series. Read as a rate it prices every
        fee at seven cents on the dollar too low."""
        fees = parse_series_fees(body("series_ladder"))
        assert fees.fee_multiplier == Decimal(1)
        assert fees.fee_type.startswith("quadratic")


class TestTheSchemaProbe:
    def test_recognises_the_payload_the_engine_was_written_against(self):
        assert schema_probe(markets("markets_ladder")[0])["schema"] == "fp-2026"

    def test_names_what_is_missing_when_the_shape_is_wrong(self):
        report = schema_probe({"ticker": "X", "yes_bid": 42, "tick_size": 1})
        assert report["schema"] == "unexpected"
        assert "yes_bid_dollars" in report["missing"]
        assert report["legacy_fields_present"] == ["yes_bid", "tick_size"]

    def test_reports_absence_as_absence(self):
        assert schema_probe(None)["schema"] == "unavailable"
