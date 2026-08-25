"""Two different empty tapes, told apart — and neither blames a variable that is set.

`GET /api/coherence/books` reads the tape and can come back with nothing for two
entirely different reasons, and until now it said the same sentence for both:

    "the tape holds no books yet; the recorder writes them once
     COHERENCE_POLL_S is set"

That is true of a cold tape. It is FALSE of a tape holding twenty-five thousand
snapshots when the caller asked for a ticker that is not among them — and it is
false in the most expensive direction, because it names a configuration variable
as the cause. A reader who meets it goes and sets `COHERENCE_POLL_S`, finds it
already set, and concludes the recorder is broken.

That is not hypothetical. It cost a peer session an hour tonight: it read the
sentence, believed the recorder was off, and asked another session to turn on a
recorder that had already written 8,358 books.

This is the house's own rule at the seam where it is easiest to lose — the four
absences that every pane on this engine tells apart (in flight, failed, answered
with nothing, and never asked) collapsing into one sentence at the route that
feeds them. A pane cannot distinguish what the route has already merged.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import main
from modules.api import coherence as coherence_api
from modules.coherence.fs.store import BookRow, CoherenceStore
from modules.coherence.kernel.book import Book, Level


@pytest.fixture
def store(tmp_path, monkeypatch) -> CoherenceStore:
    """A private tape, and the route pointed at it."""
    made = CoherenceStore(tmp_path / "coherence.duckdb")
    monkeypatch.setattr(coherence_api, "get_store", lambda: made)
    return made


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def a_book(ticker: str) -> BookRow:
    ladder = (Level(price=Decimal("0.6000"), size_hundredths=1000),)
    return BookRow(
        ts_ns=1_700_000_000_000_000_000,
        ticker=ticker,
        event_ticker="KXTEST-26AUG25",
        series_ticker="KXTEST",
        exchange_index=0,
        mutually_exclusive=True,
        book=Book(ticker=ticker, yes_bids=ladder, no_bids=ladder),
        source="test",
    )


class TestTheTwoEmpties:
    def test_a_cold_tape_says_the_recorder_has_not_written(self, client, store) -> None:
        # The one case where naming the variable is right: nothing has ever been
        # recorded, so the reader's next move really is to switch it on.
        body = client.get("/api/coherence/books").json()

        assert body["state"] == "empty"
        assert body["books"] == []
        assert any("COHERENCE_POLL_S" in note for note in body["notes"]), body["notes"]

    def test_a_filter_that_matches_nothing_does_not_blame_the_recorder(self, client, store) -> None:
        # The defect. The tape HAS books; the caller asked for a ticker that is
        # not among them. Sending them to a configuration variable that is
        # already set is the most expensive wrong answer available.
        store.record_books([a_book("KXTEST-26AUG25-T100")])

        body = client.get("/api/coherence/books?tickers=KXNOTONTHETAPE-1").json()

        assert body["state"] == "empty"
        assert body["books"] == []
        joined = " ".join(body["notes"])
        assert "COHERENCE_POLL_S" not in joined, (
            "a filter matching nothing is being reported as an unconfigured recorder: " + joined
        )

    def test_and_it_says_what_it_did_ask_for_and_what_the_tape_holds(self, client, store) -> None:
        # A refusal has to be actionable. Naming the tickers asked for and the
        # size of the tape is what turns "empty" into "you asked for the wrong
        # thing" rather than "something is broken".
        store.record_books([a_book("KXTEST-26AUG25-T100"), a_book("KXTEST-26AUG25-T200")])

        body = client.get("/api/coherence/books?tickers=KXNOTONTHETAPE-1").json()
        joined = " ".join(body["notes"])

        assert "KXNOTONTHETAPE-1" in joined, f"the note does not say what was asked for: {joined}"
        assert "2" in joined, f"the note does not say what the tape does hold: {joined}"

    def test_an_unfiltered_read_of_a_full_tape_still_answers(self, client, store) -> None:
        # The guard against fixing the message by breaking the route.
        store.record_books([a_book("KXTEST-26AUG25-T100")])

        body = client.get("/api/coherence/books").json()

        assert body["state"] == "ok"
        assert [book["ticker"] for book in body["books"]] == ["KXTEST-26AUG25-T100"]
