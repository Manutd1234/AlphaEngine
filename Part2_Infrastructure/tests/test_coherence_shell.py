"""The watched universe as a filesystem, because it already is one.

Shards contain series, series contain events, events contain markets, and each
event has readings you can ``cat``. Naming the structure that way makes two
things visible that a dashboard hides: that where a market lives is a cost — a
portfolio spanning two shards cannot be protected by an order group, and the
path says so — and that a derived number is a file, so it can be missing.

``missing`` and ``unavailable`` are the pair this file is most careful about.
A path that names nothing is missing. A file that exists and could not be
computed for this event is unavailable, with the reason the computation gave.
Answering the first with the second would invent a reading; answering the
second with the first would say the tree is smaller than it is.
"""

from __future__ import annotations

import pytest
from coherence_fixtures import body, markets

from modules.coherence.drivers.kalshi_parse import parse_event, parse_orderbooks
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.observe import MarketObservation, Observation
from modules.coherence.syscalls.shell import EVENT_FILES, cat, ls

NOW = 1_700_000_000_000_000_000
WEATHER = "KXHIGHNY-26AUG23"
CRYPTO = "KXBTCD-26AUG2306"
WEATHER_PATH = f"/shards/0/KXHIGHNY/{WEATHER}"
CRYPTO_PATH = f"/shards/2/KXBTCD/{CRYPTO}"


def _event(ticker: str, series: str, exclusive: bool, shard: int, rows: list[dict]) -> dict:
    return {
        "event": {
            "event_ticker": ticker,
            "series_ticker": series,
            "title": f"{series} family",
            "mutually_exclusive": exclusive,
            "exchange_index": shard,
            "settlement_sources": [{"name": "The Weather Company"}],
            "markets": rows,
        },
        "markets": [],
    }


def weather_observation() -> Observation:
    """The recorded six-market NYC daily-high event, with its recorded books."""
    event = parse_event(_event(WEATHER, "KXHIGHNY", True, 0, markets("markets_ladder")))
    books = parse_orderbooks(body("orderbook_bulk"))
    return Observation(
        ts_ns=NOW,
        event=event,
        markets=[MarketObservation(market=market, book=books[market.ticker]) for market in event.markets],
    )


def crypto_observation() -> Observation:
    """A recorded sixty-strike BTC ladder, read at top of book.

    Placed on shard 2, which is where this series trades and what makes the
    root listing two directories rather than one. Its books are the market
    objects' own top-of-book fields, so the observation declares that depth.
    """
    event = parse_event(_event(CRYPTO, "KXBTCD", False, 2, markets("markets_crypto")))
    return Observation(
        ts_ns=NOW,
        event=event,
        markets=[MarketObservation(market=market, book=market.top) for market in event.markets],
        depth="top_of_book",
    )


def inverted_observation() -> Observation:
    """Three recorded strikes, re-offered so the survival function CLIMBS.

    The prices are edited on the recorded market payloads rather than a
    hand-built market, so everything except the three numbers under test is the
    shape the venue sends.
    """
    rows = []
    lowest_first = list(reversed(markets("markets_crypto")[-3:]))
    for row, ask in zip(lowest_first, ("0.3000", "0.4200", "0.2000"), strict=True):
        rows.append({**row, "yes_ask_dollars": ask, "yes_ask_size_fp": "100.00"})
    event = parse_event(_event(CRYPTO, "KXBTCD", False, 2, rows))
    return Observation(
        ts_ns=NOW,
        event=event,
        markets=[MarketObservation(market=market, book=market.top) for market in event.markets],
        depth="top_of_book",
    )


@pytest.fixture
def universe() -> list[Observation]:
    return [weather_observation(), crypto_observation()]


class TestLsAtEveryDepth:
    def test_the_root_groups_the_watchlist_by_exchange_instance(self, universe):
        listing = ls(universe, "/")
        assert listing.path == "/shards"
        assert [entry.name for entry in listing.entries] == ["0", "2"]
        assert all(entry.kind == "dir" for entry in listing.entries)

    def test_the_root_says_it_is_the_watchlist_rather_than_the_exchange(self, universe):
        """Kalshi lists some thirteen thousand series. A tree that showed a
        fraction of them without saying so would be worse than one that does."""
        assert "the watchlist, not the exchange" in ls(universe, "/shards").detail

    def test_a_shard_lists_its_series_with_a_count_each(self, universe):
        listing = ls(universe, "/shards/2")
        assert [entry.name for entry in listing.entries] == ["KXBTCD"]
        assert listing.entries[0].detail == "1 watched event(s)"

    def test_a_series_lists_its_events_and_whether_they_are_exhaustive(self, universe):
        listing = ls(universe, "/shards/0/KXHIGHNY")
        assert [entry.name for entry in listing.entries] == [WEATHER]
        assert "6 market(s)" in listing.entries[0].detail
        assert "mutually exclusive" in listing.entries[0].detail

    def test_a_ladder_says_it_is_not_marked_exclusive(self, universe):
        listing = ls(universe, "/shards/2/KXBTCD")
        assert "not marked exclusive" in listing.entries[0].detail

    def test_an_event_lists_its_markets_and_the_readings_derived_from_them(self, universe):
        listing = ls(universe, WEATHER_PATH)
        names = [entry.name for entry in listing.entries]
        assert names[:6] == [market.ticker for market in weather_observation().event.markets]
        assert names[6:] == [name for name, _detail in EVENT_FILES]
        assert all(entry.kind == "file" for entry in listing.entries)

    def test_a_market_carries_its_own_words_rather_than_its_ticker(self, universe):
        listing = ls(universe, WEATHER_PATH)
        assert listing.entries[0].detail == "88° or above"

    def test_the_root_is_reached_by_either_spelling(self, universe):
        assert ls(universe, "/").entries == ls(universe, "/shards").entries
        assert ls(universe, "").entries == ls(universe, "/shards/").entries


class TestWhereALsFindsNothing:
    def test_a_shard_nobody_watches_does_not_exist(self, universe):
        listing = ls(universe, "/shards/9")
        assert listing.exists is False
        assert listing.entries == ()
        assert "no watched event trades on shard 9" in listing.detail

    def test_a_series_nobody_watches_does_not_exist(self, universe):
        listing = ls(universe, "/shards/0/KXNOTREAL")
        assert listing.exists is False
        assert "KXNOTREAL has no watched event" in listing.detail

    def test_an_event_nobody_watches_does_not_exist(self, universe):
        listing = ls(universe, "/shards/0/KXHIGHNY/KXHIGHNY-99DEC99")
        assert listing.exists is False
        assert "is not a watched event" in listing.detail

    def test_the_tree_has_one_root_and_says_so(self, universe):
        listing = ls(universe, "/markets/KXHIGHNY")
        assert listing.exists is False
        assert listing.detail == "the tree has one root, /shards"

    def test_a_shard_that_is_not_a_number_is_not_an_exchange_instance(self, universe):
        listing = ls(universe, "/shards/east")
        assert listing.exists is False
        assert "east is not an exchange instance" in listing.detail

    def test_ls_on_a_file_says_to_read_it_instead_of_listing_nothing(self, universe):
        listing = ls(universe, f"{WEATHER_PATH}/implied_pmf")
        assert listing.exists is False
        assert listing.detail == "implied_pmf is a file; read it with cat"


class TestCatOfEachDerivedFile:
    def test_the_implied_pmf_prints_a_mass_per_interval(self, universe):
        read = cat(universe, f"{WEATHER_PATH}/implied_pmf")
        assert read.state == "ok"
        assert "interval" in read.body and "mass" in read.body
        assert "86° to 87°" in read.body
        assert "read off the ask of each book" in read.body

    def test_a_pmf_with_no_bounded_bin_priced_says_it_has_no_mean(self, universe):
        """The recorded BTC ladder is offered at a cent all the way up, so every
        interior bin holds nothing and the wings hold it all. A mean printed
        there would be a mean of a distribution nobody quoted."""
        read = cat(universe, f"{CRYPTO_PATH}/implied_pmf")
        assert read.state == "ok"
        assert "no mean: fewer than two priced bins sit on a numeric axis" in read.body

    def test_a_negative_bin_is_named_in_the_body_rather_than_only_drawn(self):
        """A monotonicity violation is a bar below the axis on a chart and a
        word in the text; a reader of either must not have to infer it."""
        read = cat([inverted_observation()], f"{CRYPTO_PATH}/implied_pmf")
        assert read.state == "ok"
        assert "-0.1200  NEGATIVE MASS" in read.body

    def test_the_survival_file_prints_the_curve_the_ladder_samples(self, universe):
        read = cat(universe, f"{CRYPTO_PATH}/survival")
        assert read.state == "ok"
        assert "P(above)" in read.body
        assert "threshold market KXBTCD-26AUG2306-T" in read.body

    def test_a_bucket_family_samples_no_survival_curve_and_says_so(self, universe):
        """Unavailable rather than missing: the file exists for every event, and
        this one has no answer to give."""
        read = cat(universe, f"{WEATHER_PATH}/survival")
        assert read.state == "unavailable"
        assert read.body == ""
        assert "quotes its outcomes as intervals" in read.detail
        assert "no curve to read off it" in read.detail

    def test_the_lattice_prints_every_relation_and_the_reason_for_it(self, universe):
        read = cat(universe, f"{WEATHER_PATH}/lattice")
        assert read.state == "ok"
        assert "6 market(s)" in read.body
        assert "[exclusive]" in read.body
        assert "so exactly one outcome resolves YES" in read.body
        assert read.detail == "built from the exchange's own metadata"

    def test_the_books_file_renders_an_empty_side_as_a_dash(self, universe):
        """Never as a price of zero. Zero is a legal Kalshi price, and the two
        are different facts about a market."""
        read = cat(universe, f"{CRYPTO_PATH}/books")
        assert read.state == "ok"
        assert "an empty side reads as a dash, never as a price of zero" in read.body
        assert "         -" in read.body
        assert read.detail == "depth: top_of_book"

    def test_the_certificate_is_unavailable_when_none_was_computed_in_this_read(self, universe):
        read = cat(universe, f"{WEATHER_PATH}/certificate")
        assert read.state == "unavailable"
        assert read.detail == "no certificate was computed for this event in this read"

    def test_the_certificate_prints_its_proof_when_one_was(self, universe):
        certificate = certify(weather_observation(), FeeSchedule())
        read = cat(universe, f"{WEATHER_PATH}/certificate", certificate=certificate)
        assert read.state == "ok"
        assert read.body
        assert read.detail == f"engine: {certificate.engine}"

    def test_every_name_the_event_directory_offers_can_be_read(self, universe):
        """The listing and the reader must agree, or a saved command line points
        at a file that does not open."""
        for name, _detail in EVENT_FILES:
            read = cat(universe, f"{WEATHER_PATH}/{name}")
            assert read.state in {"ok", "unavailable"}, f"{name} reported {read.state}"


class TestMissingIsNotUnavailable:
    def test_a_name_that_is_not_a_file_in_this_event_is_missing(self, universe):
        read = cat(universe, f"{WEATHER_PATH}/implied_cdf")
        assert read.state == "missing"
        assert read.detail == "no file called implied_cdf in this event"

    def test_an_event_nobody_watches_is_missing(self, universe):
        read = cat(universe, "/shards/0/KXHIGHNY/KXHIGHNY-99DEC99/implied_pmf")
        assert read.state == "missing"
        assert "is not a watched event" in read.detail

    def test_a_path_that_is_not_a_file_path_is_missing_with_the_shape_that_is(self, universe):
        read = cat(universe, WEATHER_PATH)
        assert read.state == "missing"
        assert read.detail == "a readable file lives at /shards/<n>/<series>/<event>/<name>"

    def test_a_path_outside_the_tree_is_missing(self, universe):
        assert cat(universe, "/etc/passwd").state == "missing"

    def test_a_market_is_a_directory_entry_and_not_yet_a_readable_file(self, universe):
        """Unavailable, not missing: the name is real and the reader has nothing
        to print for it, which is a different sentence from 'no such file'."""
        read = cat(universe, f"{WEATHER_PATH}/{WEATHER}-T87")
        assert read.state == "unavailable"
        assert read.detail == "a single market is a directory entry, not a readable file yet"

    def test_a_missing_file_never_carries_a_body(self, universe):
        for path in (f"{WEATHER_PATH}/implied_cdf", "/etc/passwd", WEATHER_PATH):
            assert cat(universe, path).body == ""


class TestAnEmptyWatchlist:
    def test_the_root_of_nothing_lists_nothing_and_still_says_what_it_is(self):
        listing = ls([], "/")
        assert listing.entries == ()
        assert listing.exists is True, "the root exists even when the watchlist is empty"

    def test_and_nothing_in_it_can_be_read(self):
        assert cat([], f"{WEATHER_PATH}/implied_pmf").state == "missing"
