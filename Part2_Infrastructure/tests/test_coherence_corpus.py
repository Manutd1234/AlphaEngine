"""The forecast horizon: which tape price counts as a forecast of a settled market.

Written RED, against a constant nobody had tested. ``corpus.DEFAULT_HORIZON_S``
was 3,600 — "a snapshot quoted at least an hour before close" — and its own
docstring said that was "long enough that the answer is genuinely open on the
hourly crypto series". It was long enough to exclude them: an hourly market is
not listed an hour before its own close, so on the live tape 2,349 forecasts at
a 3,300 s horizon collapsed to ONE at 3,600 s. Everything downstream followed —
the fallback to last trades, a withheld bias slope, two hatched squares on the
Corpus composition, and 0 of 98 recorded runs carrying a skill. Persistence was
never the cause; the predicate discarded the corpus it was given.

The rule these tests pin: a forecast is the latest snapshot taken no later than
the midpoint of the market's OBSERVED life on the tape, and never inside a
floor. The tape already knows each market's listing life, so the rule needs no
watchlist knowledge and cannot go stale when the watchlist changes; the floor is
there because half of a 1,000 s life is not a forecast of anything.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from coherence_fixtures import body

from modules.coherence.drivers.kalshi_parse import parse_orderbooks
from modules.coherence.fs import corpus
from modules.coherence.fs.store import BookRow, CoherenceStore
from modules.coherence.syscalls import calibrate

S = 10**9
H = 3600 * S
CLOSE = 1_700_000_000 * S


@pytest.fixture
def store(tmp_path) -> CoherenceStore:
    tape = CoherenceStore(tmp_path / "tape.duckdb")
    yield tape
    tape.close()


def _book():
    # A TWO-SIDED book. The fixture's first market has no YES bids, and a
    # snapshot with a null best bid is not a forecast of zero — the store keeps
    # the null and `tape_forecasts` skips it, which is the honest behaviour and
    # exactly the wrong fixture for a test about which snapshot gets chosen.
    books = parse_orderbooks(body("orderbook_bulk"))
    return next(book for book in books.values() if book.yes_bids and book.no_bids)


def snapshot(store: CoherenceStore, ticker: str, ts_ns: int, series: str = "KXBTCD") -> None:
    store.record_books([
        BookRow(
            ts_ns=ts_ns, ticker=ticker, event_ticker=f"{series}-EV", series_ticker=series,
            exchange_index=0, mutually_exclusive=True, book=_book(), source="test",
        )
    ])


def settle(store: CoherenceStore, ticker: str, close_ts_ns: int = CLOSE, result: str = "yes",
           series: str = "KXBTCD", price: str = "0.5000") -> corpus.Settlement:
    row = corpus.Settlement(
        ticker=ticker, event_ticker=f"{series}-EV", series_ticker=series,
        close_ts_ns=close_ts_ns, result=result, last_price=Decimal(price),
    )
    corpus.record_settlements(store, [row], now_ns=close_ts_ns + S)
    return row


class TestTheRule:
    def test_the_floor_and_the_life_share_are_the_two_numbers_and_the_hour_is_gone(self) -> None:
        assert corpus.MIN_HORIZON_S == 1800
        assert corpus.HORIZON_LIFE_PERCENT == 50
        assert not hasattr(corpus, "DEFAULT_HORIZON_S"), "the hour that excluded the hourly series must not survive under its old name"

    def test_an_hourly_market_still_yields_a_forecast(self, store: CoherenceStore) -> None:
        # Listed 3,500 s before close; half its life is 1,750 s, under the floor,
        # so the floor of 1,800 s applies: the latest snapshot at least 1,800 s
        # out is the one at 1,900 s. Under the old hour, nothing.
        for back in (3400, 1900, 600):
            snapshot(store, "KXBTCD-H1", CLOSE - back * S)
        settle(store, "KXBTCD-H1")

        found = corpus.tape_forecasts(store)
        assert [(item.ticker, item.horizon_s) for item in found] == [("KXBTCD-H1", 1900)]

    def test_the_horizon_scales_with_the_markets_own_life(self, store: CoherenceStore) -> None:
        # Listed 48 h before close: half its life is 24 h, well above the floor,
        # so the chosen snapshot is the latest one at least a day out — 30 h, not
        # the 1 h one a fixed floor would have taken.
        for back_h in (47, 30, 20, 1):
            snapshot(store, "KXHIGHNY-D1", CLOSE - back_h * H, series="KXHIGHNY")
        settle(store, "KXHIGHNY-D1", series="KXHIGHNY")

        found = corpus.tape_forecasts(store)
        assert [item.horizon_s for item in found] == [30 * 3600]

    def test_the_floor_is_never_below_the_minimum(self, store: CoherenceStore) -> None:
        # Seen 1,000 s before close: half its life is 500 s, and a price quoted
        # 900 s before a market resolves is not a forecast of it.
        for back in (900, 400):
            snapshot(store, "KXBTCD-SHORT", CLOSE - back * S)
        settle(store, "KXBTCD-SHORT")

        assert corpus.tape_forecasts(store) == []

    def test_a_forecast_is_never_read_after_close(self, store: CoherenceStore) -> None:
        for back in (3400, 1900, -100):
            snapshot(store, "KXBTCD-LATE", CLOSE - back * S)
        settle(store, "KXBTCD-LATE")

        found = corpus.tape_forecasts(store)
        assert len(found) == 1
        assert found[0].horizon_s == 1900


def _tape_of(store: CoherenceStore, count: int) -> None:
    for index in range(count):
        ticker = f"KXBTCD-T{index}"
        snapshot(store, ticker, CLOSE - 2000 * S)
        settle(store, ticker, result="yes" if index % 3 else "no")


def _last_trades(count: int) -> list[corpus.Settlement]:
    return [
        corpus.Settlement(
            ticker=f"KXBTCD-F{index}", event_ticker="KXBTCD-EV", series_ticker="KXBTCD",
            close_ts_ns=CLOSE, result="yes" if index % 2 else "no",
            last_price=Decimal("0.7500") if index % 2 else Decimal("0.2500"),
        )
        for index in range(count)
    ]


class TestTheScoreSaysWhichSideOfTheFloorItWasOn:
    def test_below_the_floor_it_falls_back_and_says_so(self, store: CoherenceStore) -> None:
        _tape_of(store, calibrate.MIN_TAPE_FORECASTS - 1)

        report = calibrate.score(store, fallback=_last_trades(30))
        assert report.engine == "final_trade"
        assert f"below the floor of {calibrate.MIN_TAPE_FORECASTS}" in report.detail
        assert "19 tape forecast(s)" in report.detail

    def test_it_reports_the_horizon_it_applied(self, store: CoherenceStore) -> None:
        _tape_of(store, calibrate.MIN_TAPE_FORECASTS)

        report = calibrate.score(store)
        assert report.engine == "tape"
        assert f"at a horizon of at least {corpus.MIN_HORIZON_S} s" in report.detail
        assert "above the floor" in report.detail

    def test_an_empty_tape_still_names_its_basis(self, store: CoherenceStore) -> None:
        report = calibrate.score(store)
        assert report.engine == "unavailable"
        assert "0 tape forecast(s)" in report.detail
