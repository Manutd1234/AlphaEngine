"""The recorder harvests settlements on the scoring cadence, and the score says its horizon.

Two things a live desk taught on 2026-08-26. First, ``harvest`` had exactly one
caller: the calibration ROUTE, so the settlements table filled only while a
reader was looking at the Settlement pane — on the OCI gateway nobody does, and
the corpus never filled. Second, ``score_if_due`` records a run without saying
what horizon produced it, so a recorded series could not be read against the
snapshot the Scorecard shows.

``score_if_due`` keeps its signature — it takes no client, and
``test_coherence_calibration_history`` pins that — so the exchange read is a
SIBLING, ``harvest_if_due``, on the same cadence, called before it.

Written RED: ``harvest_if_due`` did not exist and ``calibration_scores`` had no
``horizon_s`` column.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

import httpx
import pytest
from coherence_lab_harness import exchange

from modules.coherence import tunables
from modules.coherence.drivers.kalshi_rest import KalshiClient
from modules.coherence.fs import calibration_store, corpus
from modules.coherence.fs.store import CoherenceStore
from modules.coherence.kernel.calibration import Forecast, score
from modules.coherence.scheduler.budget import ReadBudget

OLD_DDL = """
CREATE TABLE IF NOT EXISTS calibration_scores (
    ts_ns            BIGINT  NOT NULL,
    engine           VARCHAR NOT NULL,
    markets          INTEGER NOT NULL,
    brier            VARCHAR,
    skill            VARCHAR,
    base_rate        VARCHAR,
    uncertainty      VARCHAR,
    bias_slope       VARCHAR,
    median_horizon_s INTEGER,
    thin             BOOLEAN NOT NULL,
    detail           VARCHAR
)
"""


@pytest.fixture
def store(tmp_path) -> CoherenceStore:
    tape = CoherenceStore(tmp_path / "tape.duckdb")
    yield tape
    tape.close()


def _report():
    rows = [
        Forecast(ticker=f"T{i}", series_ticker="KXHIGHNY", probability=Decimal("0.25") if i % 2 else Decimal("0.75"),
                 outcome=(i % 4 == 0), horizon_s=3600)
        for i in range(40)
    ]
    return score(rows, engine="tape")


class TestTheHorizonColumn:
    def test_the_column_is_last_so_the_select_and_the_tuple_cannot_shift(self) -> None:
        assert calibration_store.COLUMNS[-1] == "horizon_s"

    def test_a_table_from_before_the_column_gains_it_on_first_read_and_old_rows_stay_null(self, store: CoherenceStore) -> None:
        # The live table has eleven columns and rows in it. The first read after
        # deploy must not be a missing-column error, and the rows written before
        # the column existed must read as null — never as 0, which would claim a
        # horizon nobody applied.
        with store.connection() as conn:
            conn.execute(OLD_DDL)
            conn.execute(
                "INSERT INTO calibration_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (1_000, "tape", 40, "0.1", "0.2", "0.3", "0.4", "1.0", 3600, False, "old row"),
            )
        rows = calibration_store.calibration_history(store)
        assert len(rows) == 1
        assert rows[0]["horizon_s"] is None
        assert rows[0]["median_horizon_s"] == 3600

    def test_a_new_run_records_the_horizon_it_applied(self, store: CoherenceStore) -> None:
        calibration_store.record_calibration(store, _report(), now_ns=2_000, horizon_s=1800)
        row = calibration_store.calibration_history(store)[0]
        assert row["horizon_s"] == 1800


def _client() -> KalshiClient:
    return KalshiClient(base_url=None, transport=httpx.MockTransport(exchange), budget=ReadBudget())


class TestHarvestOnTheCadence:
    def _due(self, monkeypatch, seconds: int) -> None:
        monkeypatch.setattr(tunables, "CALIBRATION_EVERY_SECONDS", seconds, raising=False)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",), raising=False)

    def test_it_is_off_unless_the_cadence_is_set(self, store: CoherenceStore, monkeypatch) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 0)
        assert asyncio.run(recorder.harvest_if_due(_client(), store, now_ns=10**12)) is False
        assert corpus.counts(store)["settlements"] == 0

    def test_it_reads_the_watched_series_when_due(self, store: CoherenceStore, monkeypatch) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 600)
        assert asyncio.run(recorder.harvest_if_due(_client(), store, now_ns=10**12)) is True
        # The stubbed venue settles twelve KXHIGHNY markets.
        assert corpus.counts(store)["settlements"] == 12

    def test_it_is_idempotent_on_the_settlements_table(self, store: CoherenceStore, monkeypatch) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 600)
        asyncio.run(recorder.harvest_if_due(_client(), store, now_ns=10**12))
        asyncio.run(recorder.harvest_if_due(_client(), store, now_ns=10**12 + 700 * 10**9))
        assert corpus.counts(store)["settlements"] == 12

    def test_the_score_that_follows_it_records_the_floor_it_applied(self, store: CoherenceStore, monkeypatch) -> None:
        from modules.coherence import recorder

        self._due(monkeypatch, 600)
        assert recorder.score_if_due(store, now_ns=10**12) is True
        row = calibration_store.calibration_history(store)[0]
        assert row["horizon_s"] == corpus.MIN_HORIZON_S

    def test_score_if_due_still_takes_no_client(self) -> None:
        import inspect

        from modules.coherence import recorder

        assert "client" not in inspect.signature(recorder.score_if_due).parameters
        assert "client" in inspect.signature(recorder.harvest_if_due).parameters
