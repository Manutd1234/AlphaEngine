"""Charts described by what they show.

The property under test is not prose quality — it is that a description never
claims a figure the run did not produce. A chart document that retrieves for a
drawdown query when the run never reported one is worse than a chart nobody
indexed.
"""

from __future__ import annotations

from modules.research_chartdoc import (
    describe_drawdown,
    describe_equity_curve,
    describe_gate_ladder,
    describe_run,
    describe_walk_forward,
)

METRICS = {
    "total_return_x": 1.032, "max_drawdown": -0.261, "sharpe": 0.26,
    "trades": 30, "time_in_market": 0.45, "benchmark_return_x": 0.593,
    "max_drawdown_bars": 210, "recovered": False,
}


def test_the_equity_description_carries_the_figures_the_chart_draws():
    doc = describe_equity_curve(METRICS)
    for fragment in ("1.03x", "-26.1%", "0.26", "30 trades", "45.0%", "0.59x"):
        assert fragment in doc.body, fragment


def test_a_run_with_no_terminal_value_produces_no_equity_document():
    # Indexing a chart without its own figures makes it retrievable for
    # questions it cannot answer.
    assert describe_equity_curve({"sharpe": 1.2, "trades": 4}) is None


def test_missing_optional_figures_are_omitted_rather_than_guessed():
    doc = describe_equity_curve({"total_return_x": 1.5})
    assert "1.50x" in doc.body
    assert "drawdown" not in doc.body
    assert "trades" not in doc.body


def test_the_drawdown_description_says_whether_it_recovered():
    assert "does not recover" in describe_drawdown(METRICS).body
    assert "and recovers" in describe_drawdown({**METRICS, "recovered": True}).body
    assert describe_drawdown({"sharpe": 1.0}) is None


def test_the_walk_forward_description_counts_the_positive_folds():
    # The figure a reader wants, and the one a picture of a fold table makes
    # them count by eye.
    doc = describe_walk_forward([
        {"oos_sharpe": 0.4}, {"oos_sharpe": -0.2}, {"oos_sharpe": 0.9},
    ])
    assert "2 of 3" in doc.body
    assert "-0.20 to 0.90" in doc.body


def test_folds_without_scores_produce_no_walk_forward_document():
    assert describe_walk_forward([]) is None
    assert describe_walk_forward([{"train_rows": 100}]) is None


def test_the_gate_ladder_names_the_check_that_refused():
    # "Rejected" is a state anyone can see; WHICH gate refused is the answer,
    # and on the chart it is a red bar somebody has to hover.
    doc = describe_gate_ladder([
        {"name": "max_order_notional", "passed": True},
        {"name": "est_slippage", "passed": False},
    ])
    assert "est_slippage" in doc.body
    assert "1 of 2 checks passed" in doc.body


def test_a_clean_ladder_says_all_checks_passed():
    doc = describe_gate_ladder([{"name": "a", "passed": True}, {"name": "b", "passed": True}])
    assert "passed all 2 checks" in doc.body


def test_describe_run_returns_only_the_charts_the_run_actually_produced():
    docs = describe_run({"metrics": METRICS, "folds": [], "gates": []})
    kinds = {d.chart for d in docs}
    assert kinds == {"equity_curve", "drawdown"}, "no folds and no gates means no such documents"


def test_an_empty_run_produces_no_documents_rather_than_empty_ones():
    assert describe_run({}) == []


def test_a_card_is_a_title_and_a_body():
    doc = describe_equity_curve(METRICS)
    card = doc.as_card()
    assert card.startswith("Equity curve\n")
    assert doc.body in card
