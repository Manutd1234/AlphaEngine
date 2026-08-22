"""The structured-runs executor, against the real ledger it reads.

`AuditLog` on a throwaway file, not a stand-in. The whole risk in this module is
that its SQL disagrees with the schema the desk actually writes — a column that
does not exist, a sign convention that is backwards, a NULL that arrives as a
zero — and a fake reader agrees with whatever the test author believed. The rows
go in through the store's own write primitive for the same reason: the writer
takes a whole `BacktestResult`, and building one here would be testing the
backtester, but the TABLE has to be the real one.

The null-honesty cases are the point of the file. A run whose Sharpe was never
recorded must not be compared as a zero, must not be counted in a mean, and must
be stated as absent — those are three separate assertions below because they
fail separately.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from modules.audit import AuditLog
from modules.research_structured import answer_structured

NOW = datetime(2026, 8, 22, 12, 0, tzinfo=UTC)


@pytest.fixture
def store(tmp_path):
    log = AuditLog(tmp_path / "structured.duckdb")
    yield log
    log.close()


def seed(store, rows):
    """Insert backtest runs through the store's own primitive.

    ``_exec`` rather than ``record_backtest_run`` because that writer takes a
    completed `BacktestResult` with a request model attached; assembling one
    would put the backtester's shape in the way of a test about counting. The
    table, its columns and its types are the production ones either way.
    """
    for row in rows:
        store._exec(
            "INSERT INTO backtest_runs (ts, job_id, symbol, interval, strategy, sharpe, "
            "total_return, max_drawdown, data_hash) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                row.get("ts", NOW), row.get("job_id", "job"), row.get("symbol", "BTCUSDT"),
                "1h", row.get("strategy", "ma_crossover"), row.get("sharpe"),
                row.get("total_return"), row.get("max_drawdown"), row.get("data_hash"),
            ),
        )


# -- counts ----------------------------------------------------------------- #
def test_a_count_is_computed_from_the_rows_rather_than_retrieved(store):
    seed(store, [{"job_id": f"j{i}"} for i in range(4)])
    answer = answer_structured("how many BTCUSDT runs are recorded", store)
    assert answer.state == "ok"
    assert answer.rows[0]["metrics"] == {"matched": 4, "recorded": 4}
    assert answer.rows[0]["source_ref"] == "audit_log:backtest_runs"
    assert "backtest_runs" in (answer.text or ""), "the ledger row must say what was asked"


def test_since_a_data_hash_counts_only_what_came_after_that_run(store):
    seed(store, [
        {"job_id": "old", "ts": NOW - timedelta(days=3), "data_hash": "3f8a9c21"},
        {"job_id": "new1", "ts": NOW - timedelta(days=1)},
        {"job_id": "new2", "ts": NOW},
    ])
    answer = answer_structured("how many runs since 3f8a9c21", store)
    assert answer.state == "ok"
    assert answer.rows[0]["metrics"]["matched"] == 2, "the anchoring run is not 'since' itself"
    assert answer.rows[0]["metrics"]["recorded"] == 3, "the denominator is the whole table"


def test_a_hash_no_run_carries_is_an_empty_answer_naming_it_not_a_count_of_everything(store):
    # The dangerous failure: widening "since X" to "ever" hands back a large,
    # true-looking number to a question nobody answered.
    seed(store, [{"job_id": "j1"}, {"job_id": "j2"}])
    answer = answer_structured("how many runs since deadbeef", store)
    assert answer.state == "empty"
    assert answer.rows == ()
    assert "deadbeef" in answer.detail and "anchor" in answer.detail


def test_an_empty_table_and_an_unreadable_store_are_different_states(store):
    empty = answer_structured("how many runs are recorded", store)
    assert empty.state == "empty" and "nothing to count" in empty.detail

    missing = answer_structured("how many runs are recorded", None)
    assert missing.state == "unavailable"

    class _Down:
        def query(self, sql, params=()):
            raise OSError("ledger unreachable")

    down = answer_structured("how many runs are recorded", _Down())
    assert down.state == "unavailable" and "OSError" in down.detail
    assert down.rows == (), "a store that could not answer reports no number at all"


def test_a_count_of_zero_over_a_populated_table_is_a_measurement(store):
    seed(store, [{"job_id": "j1", "symbol": "ETHUSDT"}])
    answer = answer_structured("how many BTCUSDT runs are recorded", store)
    assert answer.state == "ok", "the store answered; nothing matched, which is an answer"
    assert answer.rows[0]["metrics"] == {"matched": 0, "recorded": 1}


# -- extrema, and the nulls in them ----------------------------------------- #
def test_an_unmeasured_metric_is_excluded_from_the_extremum_and_reported(store):
    seed(store, [
        {"job_id": "measured-high", "sharpe": 1.4},
        {"job_id": "unmeasured", "sharpe": None},
        {"job_id": "measured-low", "sharpe": 0.5},
    ])
    best = answer_structured("which run had the best sharpe", store)
    assert best.state == "ok"
    assert best.rows[0]["metrics"]["sharpe"] == pytest.approx(1.4)
    assert best.rows[0]["metrics"]["measured"] == 2
    assert best.rows[0]["metrics"]["unmeasured"] == 1
    assert "do not and are not in this comparison" in best.rows[0]["body"]

    worst = answer_structured("which run had the worst sharpe", store)
    assert worst.rows[0]["metrics"]["sharpe"] == pytest.approx(0.5), (
        "a NULL Sharpe read as 0.0 would win 'worst' here — that is the coercion"
    )


def test_a_metric_nothing_recorded_is_an_empty_answer_not_a_zero(store):
    seed(store, [{"job_id": "j1", "sharpe": None}, {"job_id": "j2", "sharpe": None}])
    answer = answer_structured("best sharpe", store)
    assert answer.state == "empty"
    assert answer.rows == ()
    assert "not a zero" in answer.detail


def test_the_drawdown_sign_convention_is_the_one_the_backtester_writes(store):
    # `_max_drawdown` returns min(equity/peak - 1), so drawdowns are NEGATIVE and
    # the worst one is the smallest number. Backwards, this reports the
    # shallowest drawdown as the worst and reads perfectly plausibly.
    seed(store, [
        {"job_id": "shallow", "max_drawdown": -0.08},
        {"job_id": "deep", "max_drawdown": -0.42},
    ])
    worst = answer_structured("worst drawdown", store)
    assert worst.rows[0]["metrics"]["max_drawdown"] == pytest.approx(-0.42)
    best = answer_structured("best drawdown", store)
    assert best.rows[0]["metrics"]["max_drawdown"] == pytest.approx(-0.08)


def test_a_mean_covers_the_runs_that_have_the_metric_and_says_how_many(store):
    seed(store, [
        {"job_id": "j1", "sharpe": 2.0},
        {"job_id": "j2", "sharpe": None},
        {"job_id": "j3", "sharpe": 1.0},
    ])
    answer = answer_structured("average sharpe across runs", store)
    assert answer.rows[0]["metrics"]["sharpe"] == pytest.approx(1.5), (
        "a NULL counted as zero would make this 1.0"
    )
    assert answer.rows[0]["metrics"]["measured"] == 2
    assert answer.rows[0]["metrics"]["matched"] == 3


# -- what it declines to answer --------------------------------------------- #
def test_an_extremum_with_no_metric_named_is_skipped_rather_than_guessed(store):
    seed(store, [{"job_id": "j1", "sharpe": 1.0}])
    answer = answer_structured("which was the best run", store)
    assert answer.state == "skipped"
    assert "guessing" in answer.detail and answer.rows == ()


def test_a_strategy_named_average_is_not_a_request_for_a_mean(store):
    seed(store, [{"job_id": "j1", "sharpe": 1.0}])
    assert answer_structured("moving average crossover", store).state == "skipped"


def test_a_computed_row_carries_no_similarity(store):
    # It was not retrieved, it was calculated. A 0.0 here would rank the one
    # exact answer below every vague document the corpus returned, and a null
    # would be coerced to that 0.0 by the first caller reading it with `or`.
    seed(store, [{"job_id": "j1"}])
    row = answer_structured("how many runs are recorded", store).rows[0]
    assert "similarity" not in row
    assert row["kind"] == "structured_runs"
