"""The tape: append-only, newest-per-ticker, and honest when it cannot open.

The store's job is to make a question answerable later that is unanswerable
now. So the assertions are about what survives a round trip — whole ladders,
not summary prices — and about the states it reports when it cannot help.
"""

from __future__ import annotations

import json
from decimal import Decimal

import pytest
from coherence_fixtures import body

from modules.coherence.drivers.kalshi_parse import parse_orderbooks
from modules.coherence.fs.store import BookRow, CoherenceStore, TapeUnavailable

NOW = 1_700_000_000_000_000_000


@pytest.fixture
def store(tmp_path):
    tape = CoherenceStore(tmp_path / "tape.duckdb")
    yield tape
    tape.close()


def _rows(ts_ns: int) -> list[BookRow]:
    books = parse_orderbooks(body("orderbook_bulk"))
    return [
        BookRow(
            ts_ns=ts_ns,
            ticker=ticker,
            event_ticker="KXHIGHNY-26AUG23",
            series_ticker="KXHIGHNY",
            exchange_index=0,
            book=book,
            source="fixture",
        )
        for ticker, book in books.items()
    ]


class TestTheTape:
    def test_records_a_poll_and_says_how_many_landed(self, store):
        rows = _rows(NOW)
        assert store.record_books(rows) == len(rows)
        assert store.counts()["book_snapshots"] == len(rows)

    def test_keeps_whole_ladders_not_just_the_best_price(self, store):
        """A summary price cannot answer 'what size rested at $0.47 an hour ago'."""
        store.record_books(_rows(NOW))
        recorded = store.latest_books()
        deep = max(recorded, key=lambda row: len(json.loads(row["no_ladder"])))
        assert len(json.loads(deep["no_ladder"])) > 1, "the ladder was flattened on the way in"

    def test_a_ladder_round_trips_in_the_venues_own_shape(self, store):
        """So a row read years from now needs nothing but Kalshi's documentation."""
        store.record_books(_rows(NOW))
        ladder = json.loads(store.latest_books()[0]["no_ladder"])
        assert all(isinstance(level, list) and len(level) == 2 for level in ladder)
        assert all(isinstance(part, str) for level in ladder for part in level)

    def test_appends_rather_than_replaces_and_reads_back_the_newest(self, store):
        store.record_books(_rows(NOW))
        store.record_books(_rows(NOW + 1_000_000_000))
        assert store.counts()["book_snapshots"] == 12
        latest = store.latest_books()
        assert len(latest) == 6, "latest_books should collapse to one row per ticker"
        assert {row["ts_ns"] for row in latest} == {NOW + 1_000_000_000}

    def test_filters_to_the_tickers_asked_for(self, store):
        store.record_books(_rows(NOW))
        wanted = store.latest_books()[0]["ticker"]
        assert [row["ticker"] for row in store.latest_books(tickers=[wanted])] == [wanted]

    def test_an_empty_poll_writes_nothing_and_says_so(self, store):
        assert store.record_books([]) == 0


class TestTheIndex:
    def test_records_a_reading_with_the_engine_that_produced_it(self, store):
        store.record_index(NOW, "KXHIGHNY", "KXHIGHNY-26AUG23", 0, Decimal("0.0300"), "closed_form", "asks sum 1.03")
        row = store.index_series()[0]
        assert row["ci"] == Decimal("0.030000")
        assert row["engine"] == "closed_form"

    def test_an_unreadable_event_stores_a_null_index_not_a_zero(self, store):
        """Zero would read as perfectly coherent — the most misleading value here."""
        store.record_index(NOW, "KXBTCD", "KXBTCD-X", 2, None, "unavailable", "books unreadable")
        assert store.index_series()[0]["ci"] is None

    def test_filters_by_series_and_by_time(self, store):
        store.record_index(NOW, "A", "A-1", 0, Decimal("0.01"), "closed_form")
        store.record_index(NOW + 1_000_000_000, "B", "B-1", 0, Decimal("0.02"), "closed_form")
        assert len(store.index_series(series_ticker="A")) == 1
        assert len(store.index_series(since_ts_ns=NOW + 1)) == 1

    def test_returns_oldest_first_so_a_chart_can_plot_it(self, store):
        store.record_index(NOW + 1_000_000_000, "A", "A-1", 0, Decimal("0.02"), "closed_form")
        store.record_index(NOW, "A", "A-1", 0, Decimal("0.01"), "closed_form")
        assert [row["ts_ns"] for row in store.index_series()] == [NOW, NOW + 1_000_000_000]


class TestWhenItCannotHelp:
    def test_reports_unavailable_rather_than_writing_a_second_tape(self, tmp_path):
        """A fallback file would split the tape in two and neither half would
        be complete — the opposite of what a tape is for."""
        blocked = tmp_path / "not-a-directory"
        blocked.write_text("this is a file, so a database cannot be made inside it")
        tape = CoherenceStore(blocked / "tape.duckdb")
        health = tape.health()
        assert health["state"] == "unavailable"
        assert health["reason"], "an unavailable tape must say why"
        with pytest.raises(TapeUnavailable):
            tape.record_books(_rows(NOW))

    def test_a_healthy_tape_reports_its_counts(self, store):
        store.record_books(_rows(NOW))
        health = store.health()
        assert health["state"] == "ok"
        assert health["tickers_seen"] == 6
