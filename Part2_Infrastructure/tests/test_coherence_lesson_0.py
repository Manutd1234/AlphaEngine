"""Lesson 0: ``yes_ask + no_ask = 1 + spread``, and the strategy it retires.

Kalshi publishes two BID ladders and no asks. An ask is a reading of the other
ladder. Substituting that definition collapses the "buy both sides for less
than a dollar" arbitrage that appears in two of the most-starred prediction
market bots on GitHub:

    yes_ask + no_ask = (1 - no_bid) + (1 - yes_bid) = 1 + spread  >= 1

It is not a rare opportunity or an unprofitable one. It cannot occur. This
suite proves it on the documentation's own example, on books recorded from the
live exchange, and on random ladders — and then shows that even if the branch
could fire at the $0.98 threshold those bots use, the fees would eat it.
"""

from __future__ import annotations

import random
from decimal import Decimal

import pytest
from coherence_fixtures import orderbook

from modules.coherence.kernel.book import Book, Level, lesson_zero_identity, parse_orderbook, top_of_book
from modules.coherence.kernel.money import ceil_to_centicent

# Kalshi's own orderbook example, from the fixed-point guide.
DOCS_EXAMPLE = {
    "yes_dollars": [["0.0100", "200.00"], ["0.4100", "10.00"], ["0.4200", "13.00"]],
    "no_dollars": [["0.0100", "100.00"], ["0.4500", "20.00"], ["0.5600", "17.00"]],
}


class TestTheDocumentedExample:
    def test_reads_the_best_bid_off_the_end_of_each_ascending_ladder(self):
        book = parse_orderbook("DOCS", DOCS_EXAMPLE)
        assert book.best_yes_bid == Decimal("0.4200")
        assert book.best_no_bid == Decimal("0.5600")

    def test_derives_the_asks_the_guide_derives(self):
        book = parse_orderbook("DOCS", DOCS_EXAMPLE)
        assert book.best_yes_ask == Decimal("0.4400")
        assert book.best_no_ask == Decimal("0.5800")
        assert book.spread == Decimal("0.0200")

    def test_the_identity_holds_and_the_sum_is_one_plus_the_spread(self):
        book = parse_orderbook("DOCS", DOCS_EXAMPLE)
        total, one_plus_spread = lesson_zero_identity(book)
        assert total == Decimal("1.0200")
        assert total == one_plus_spread

    def test_the_bundle_arbitrage_does_not_fire_here(self):
        book = parse_orderbook("DOCS", DOCS_EXAMPLE)
        total, _ = lesson_zero_identity(book)
        assert total >= Decimal(1)


class TestAgainstBooksRecordedFromTheExchange:
    def test_a_two_sided_book_satisfies_the_identity(self):
        ticker, payload = orderbook("orderbook_two_sided")
        book = parse_orderbook(ticker, payload)
        identity = lesson_zero_identity(book)
        assert identity is not None, f"{ticker} was recorded without both sides quoted"
        total, one_plus_spread = identity
        assert total == one_plus_spread
        assert total >= Decimal(1)

    def test_a_one_sided_book_reports_absence_rather_than_zero(self):
        """The honesty case, recorded from a real market.

        Nobody bids YES on "NYC high above 87F" in August, while the NO side is
        bid up to $0.99. The YES bid is *absent*: read as zero it would imply a
        one-cent market with a two-cent spread, which is a liquidity claim
        nobody made. Zero is itself a legal price here, so the two readings are
        genuinely different facts.
        """
        ticker, payload = orderbook("orderbook_one_sided")
        book = parse_orderbook(ticker, payload)
        assert book.best_yes_bid is None
        assert book.best_no_bid is not None
        assert book.spread is None
        assert book.mid is None
        assert lesson_zero_identity(book) is None

    def test_an_unquoted_side_still_yields_the_offers_that_do_exist(self):
        """Absence on one side is not absence of a market."""
        ticker, payload = orderbook("orderbook_one_sided")
        book = parse_orderbook(ticker, payload)
        assert book.best_yes_ask is not None
        assert book.asks("yes"), "the NO bids imply YES offers even with no YES bid"


class TestTheIdentityUnderRandomBooks:
    @pytest.mark.parametrize("seed", range(25))
    def test_no_random_book_ever_prices_the_bundle_under_a_dollar(self, seed):
        """Fuzzed rather than reasoned, because the claim is 'never'."""
        rng = random.Random(seed)
        yes_bid = rng.randrange(1, 98)
        no_bid = rng.randrange(1, 99 - yes_bid)
        book = Book(
            ticker=f"FUZZ-{seed}",
            yes_bids=(Level(price=Decimal(yes_bid) / 100, size_hundredths=100),),
            no_bids=(Level(price=Decimal(no_bid) / 100, size_hundredths=100),),
        )
        total, one_plus_spread = lesson_zero_identity(book)
        assert total == one_plus_spread
        assert total >= Decimal(1), f"seed {seed} produced a bundle under a dollar"


def test_even_at_the_threshold_those_bots_use_the_fees_exceed_the_edge():
    """The second reason the branch is dead: $0.98 is 1.5 cents short.

    One popular bot calls ``combined < $0.98`` risk-free, describing the two
    cents as a buffer for fees. Buying both sides near $0.49 costs two taker
    fees of about $0.0175 each — roughly $0.035 against a $0.02 gross. The
    "buffer" is smaller than the cost it is meant to cover.
    """
    price = Decimal("0.49")
    rate = Decimal("0.07")
    per_leg = ceil_to_centicent(rate * price * (Decimal(1) - price))
    both_legs = per_leg * 2
    gross = Decimal("1.00") - Decimal("0.98")
    assert both_legs > gross, "the premise of this test has changed"
    assert gross - both_legs < Decimal("-0.01")


def test_top_of_book_carries_its_own_shallowness():
    """The 401 fallback is a different kind of book and says so."""
    book = top_of_book("T", "0.2800", "35.00", "0.3100", "12.00")
    assert book.depth == "top_of_book"
    assert book.best_yes_bid == Decimal("0.2800")
    assert book.best_yes_ask == Decimal("0.3100")
    assert book.spread == Decimal("0.0300")
