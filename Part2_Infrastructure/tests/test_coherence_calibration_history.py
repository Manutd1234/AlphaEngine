"""The settled score OVER TIME, and the four ways it is allowed to say nothing.

`/api/coherence/calibration` answers one question about one moment: of the
contracts priced near a dime, how many paid — right now, over whatever has
settled. That is a snapshot, and a snapshot cannot answer the question a reader
asks next, which is whether the venue is getting better or worse. The Scorecard
has had no time axis at all because the payload has none.

So the recorder writes a score on its own cadence and this is the tape of them.
Three properties are worth a suite rather than a comment, and each is a way the
series could quietly start lying:

**A score that could not be taken is recorded as null with its reason.** The
corpus is empty on a cold tape and stays empty until something settles, which on
a daily series is a day. A run that wrote `brier = 0` there would put a perfect
forecaster at the start of every chart — the house's own worst defect, "we do not
know" rendered as "it is fine". The row is still written, because the fact that
scoring was attempted and refused is itself the record.

**The series accrues forward only.** Nothing back-fills it: the settled corpus
is scored as it is found, so the history begins when the recorder began and the
figure has to say so rather than implying the venue had no score before then.

**`engine` travels with every point.** `tape` is a forecast test and
`final_trade` is not (`CalibrationScore.tsx`'s banner is the whole argument), so
a chart that plotted both on one line without carrying the engine would draw a
convergence measurement and a foresight measurement as one series.

Written before the implementation, per the slice's RED step. Every assertion
here failed with an ImportError first.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence.fs import calibration_store
from modules.coherence.fs.store import CoherenceStore
from modules.coherence.kernel.calibration import Forecast, score


@pytest.fixture
def store(tmp_path) -> CoherenceStore:
    """A private DuckDB file per test, so the desk's tape is never touched."""
    return CoherenceStore(tmp_path / "coherence.duckdb")


def corpus(size: int = 40) -> list[Forecast]:
    """A small settled corpus with a real spread, so the score is not degenerate."""
    rows: list[Forecast] = []
    for index in range(size):
        price = Decimal("0.25") if index % 2 else Decimal("0.75")
        rows.append(
            Forecast(
                ticker=f"KXHIGHNY-{index}",
                series_ticker="KXHIGHNY",
                probability=price,
                outcome=(index % 4 == 0),
                horizon_s=3600,
            )
        )
    return rows


class TestTheRoundTrip:
    def test_a_scored_report_comes_back_with_its_figures(self, store: CoherenceStore) -> None:
        report = score(corpus(), engine="tape")
        calibration_store.record_calibration(store, report, now_ns=1_000)

        rows = calibration_store.calibration_history(store)

        assert len(rows) == 1
        row = rows[0]
        assert row["ts_ns"] == 1_000
        assert row["engine"] == "tape"
        assert row["markets"] == 40
        # Read back as the same value, not as a float that has been through
        # binary64: every decimal on this engine is fixed point for a reason.
        assert Decimal(str(row["brier"])) == report.brier
        assert Decimal(str(row["skill"])) == report.skill

    def test_the_series_comes_back_oldest_first(self, store: CoherenceStore) -> None:
        # A chart plots left to right. Returning newest-first would draw every
        # series backwards while every individual point stayed correct.
        report = score(corpus(), engine="tape")
        for ts in (3_000, 1_000, 2_000):
            calibration_store.record_calibration(store, report, now_ns=ts)

        assert [row["ts_ns"] for row in calibration_store.calibration_history(store)] == [
            1_000, 2_000, 3_000,
        ]

    def test_since_and_limit_narrow_the_read(self, store: CoherenceStore) -> None:
        report = score(corpus(), engine="tape")
        for ts in (1_000, 2_000, 3_000):
            calibration_store.record_calibration(store, report, now_ns=ts)

        assert [row["ts_ns"] for row in calibration_store.calibration_history(store, since_ts_ns=2_000)] == [
            2_000, 3_000,
        ]
        assert [row["ts_ns"] for row in calibration_store.calibration_history(store, limit=1)] == [1_000]


class TestTheWaysItSaysNothing:
    def test_an_empty_tape_is_an_empty_list_and_not_an_error(self, store: CoherenceStore) -> None:
        # The table has to exist before the first write, or the first READ of a
        # fresh deployment is a crash rather than an honest "nothing yet".
        assert calibration_store.calibration_history(store) == []

    def test_an_unscoreable_run_records_null_figures_and_its_reason(self, store: CoherenceStore) -> None:
        # The defect this whole suite exists for. `score([])` cannot produce a
        # Brier, and a zero there is a perfect forecaster at the origin of every
        # chart drawn afterwards.
        empty = score([], engine="unavailable")
        assert empty.brier is None, "the reference stopped refusing an empty corpus"

        calibration_store.record_calibration(store, empty, now_ns=7_000)
        row = calibration_store.calibration_history(store)[0]

        assert row["brier"] is None
        assert row["skill"] is None
        assert row["markets"] == 0
        assert row["detail"], "a refused score with no reason is indistinguishable from a bug"

    def test_the_engine_travels_with_every_point(self, store: CoherenceStore) -> None:
        # `final_trade` scores convergence, `tape` scores foresight. A chart
        # that lost this would plot two different measurements as one line.
        calibration_store.record_calibration(store, score(corpus(), engine="tape"), now_ns=1_000)
        calibration_store.record_calibration(store, score(corpus(), engine="final_trade"), now_ns=2_000)

        assert [row["engine"] for row in calibration_store.calibration_history(store)] == [
            "tape", "final_trade",
        ]

    def test_a_thin_corpus_is_flagged_rather_than_dropped(self, store: CoherenceStore) -> None:
        # A thin sample still gets a row: "too few to conclude from" is a
        # reading, and omitting it would leave a gap that looks like an outage.
        thin = score(corpus(size=4), engine="tape")
        assert thin.thin, "the reference stopped flagging a four-market corpus as thin"

        calibration_store.record_calibration(store, thin, now_ns=1_000)
        assert calibration_store.calibration_history(store)[0]["thin"] is True


class TestTheRoute:
    """`GET /api/coherence/calibration/history`, and the two states it answers in.

    It lives on the history router beside `/index` and `/episodes` rather than
    beside `/calibration` on the lab router, and that is the seam those two
    files already have: the lab answers "what is true of the exchange now", the
    history answers "what has been true of it over time". A new router file
    would also have moved the router count that
    `developer-custody-gateway.test.ts` and `GatewayContractCustodyChain.tsx`
    both pin, for a route that belongs to an existing one.
    """

    @pytest.fixture
    def client(self, store: CoherenceStore, monkeypatch):
        from fastapi.testclient import TestClient

        import main
        from modules.api import coherence_history

        # The router binds `get_store` into its own namespace at import, so
        # patching the store module's name would leave the route reading the
        # desk's real tape.
        monkeypatch.setattr(coherence_history, "get_store", lambda: store)
        return TestClient(main.app)

    def test_an_empty_tape_answers_empty_with_a_note_rather_than_ok(self, client) -> None:
        # "Nothing recorded yet" and "recorded nothing but nulls" are different
        # facts and the state has to tell them apart: the first is a recorder
        # that has not run, the second is a corpus that will not score.
        body = client.get("/api/coherence/calibration/history?limit=10").json()

        assert body["state"] == "empty"
        assert body["points"] == []
        assert body["notes"], "an empty history with no note cannot say why it is empty"

    def test_recorded_scores_come_back_as_points(self, client, store: CoherenceStore) -> None:
        calibration_store.record_calibration(store, score(corpus(), engine="tape"), now_ns=1_000)
        calibration_store.record_calibration(store, score([], engine="unavailable"), now_ns=2_000)

        body = client.get("/api/coherence/calibration/history?limit=10").json()

        assert body["state"] == "ok"
        assert [point["ts_ns"] for point in body["points"]] == [1_000, 2_000]
        assert [point["engine"] for point in body["points"]] == ["tape", "unavailable"]
        # Every decimal leaves as a string, the way the rest of this lab's wire
        # does: JSON numbers are binary64 and would round the last places that
        # decide whether a Brier of 0.00010533 is what was computed.
        assert isinstance(body["points"][0]["brier"], str)
        # And the refused run keeps its null rather than arriving as a zero.
        assert body["points"][1]["brier"] is None
        assert body["points"][1]["detail"]

    def test_the_read_is_bounded_and_says_it_starts_when_the_recorder_did(self, client, store) -> None:
        # The series accrues FORWARD ONLY; nothing back-fills it. A reader who
        # does not meet that reads the first point as the venue's first score.
        for ts in range(1, 6):
            calibration_store.record_calibration(store, score(corpus(), engine="tape"), now_ns=ts * 1_000)

        body = client.get("/api/coherence/calibration/history?limit=2").json()

        assert len(body["points"]) == 2
        assert any("forward" in note for note in body["notes"]), body["notes"]


class TestTheCadence:
    """When the recorder takes a score, and the two reasons it usually does not.

    The book poll is 300s and a score is not a 300s question — nothing settles
    that fast, so scoring on every poll would write three hundred identical rows
    a day and call it a series. It runs on its own slower cadence, and the
    cadence is OFF unless `COHERENCE_CALIBRATION_EVERY_S` is set, for the reason
    `COHERENCE_POLL_S` is off by default: a process that starts doing work the
    moment it boots is not something to enable by accident.

    WHEN THE LAST SCORE WAS TAKEN IS READ OFF THE TAPE, not held in
    `RecorderState`. Each recorded row IS a run, so the tape already answers it;
    a second copy in memory would be a weaker one that resets on restart and
    could disagree with the series it describes.

    AND IT COSTS NO EXCHANGE READ. `calibrate.score` is handed the store and
    nothing else — no client, no harvest — so it scores what has already settled
    on the tape. That is asserted on the signature below, because "does not call
    the exchange" is a property of the shape rather than of one run.
    """

    def _due(self, monkeypatch, seconds: int):
        from modules.coherence import tunables

        monkeypatch.setattr(tunables, "CALIBRATION_EVERY_SECONDS", seconds, raising=False)

    def test_it_takes_no_client_so_it_cannot_reach_the_exchange(self) -> None:
        import inspect

        from modules.coherence import recorder

        taken = set(inspect.signature(recorder.score_if_due).parameters)
        assert "client" not in taken, (
            "score_if_due grew a client; the cadence must score the tape it already has, "
            "or a slow scoring pass starts spending the exchange's token bucket"
        )

    def test_it_is_off_unless_the_cadence_is_set(self, store: CoherenceStore, monkeypatch) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 0)

        assert recorder.score_if_due(store, now_ns=10**12) is False
        assert calibration_store.calibration_history(store) == []

    def test_the_first_run_writes_because_the_tape_has_nothing_to_compare_to(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 600)

        assert recorder.score_if_due(store, now_ns=10**12) is True
        assert len(calibration_store.calibration_history(store)) == 1

    def test_a_score_taken_inside_the_cadence_does_not_write_again(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 600)
        now = 10**12
        assert recorder.score_if_due(store, now_ns=now) is True

        # Ten seconds later, on the next 300s book poll.
        assert recorder.score_if_due(store, now_ns=now + 10 * 10**9) is False
        assert len(calibration_store.calibration_history(store)) == 1

    def test_a_score_older_than_the_cadence_writes_the_next_one(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 600)
        now = 10**12
        assert recorder.score_if_due(store, now_ns=now) is True

        assert recorder.score_if_due(store, now_ns=now + 700 * 10**9) is True
        assert [row["ts_ns"] for row in calibration_store.calibration_history(store)] == [
            now, now + 700 * 10**9,
        ]

    def test_an_empty_corpus_still_writes_its_refusal(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        # A cold tape scores nothing for as long as it takes something to
        # settle. Those rows are the record that the recorder was running and
        # the corpus was not ready, which is a different fact from a gap.
        from modules.coherence import recorder

        self._due(monkeypatch, 600)
        assert recorder.score_if_due(store, now_ns=10**12) is True

        row = calibration_store.calibration_history(store)[0]
        assert row["brier"] is None
        assert row["markets"] == 0
        assert row["detail"]
