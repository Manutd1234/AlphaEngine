"""The ML-run card: what it says, and what it refuses to guess.

A card IS the embedded text — research_documents.body stores exactly what was
embedded, so a renderer change silently invalidates stored vectors unless the
document is re-embedded. That makes what goes in here a retrieval decision, not
a formatting one.
"""

from __future__ import annotations

from modules.research_rag import render_ml_card

RUN = {
    "symbol": "BTCUSDT", "interval": "4h", "model": "ridge", "seed": 42,
    "engine": "numpy", "status": "succeeded",
    "oos_sharpe": 0.41, "deflated_sharpe": 0.12, "pbo": 0.38,
    "data_hash": "9f9602c7", "git_sha": "abcdef1234567890",
    "folds": [
        {"purge_bars": 3, "oos_sharpe": 0.5},
        {"purge_bars": 3, "oos_sharpe": -0.2},
        {"purge_bars": 3, "oos_sharpe": 0.7},
    ],
    "features": {"feature_count": 6, "label": "return", "label_horizon_bars": 4,
                 "spec_hash": "0123456789abcdef"},
}


def test_the_title_identifies_the_run_without_reading_the_body():
    title, body = render_ml_card(RUN)
    assert title == "ML run BTCUSDT 4h ridge seed 42"
    assert body.startswith(title), "the card leads with its own title, like every other kind"


def test_the_three_facts_a_sweep_has_no_equivalent_for_are_present():
    _, body = render_ml_card(RUN)
    # The engine, because a run that fell back to the hand-rolled models is a
    # different run and must not be ranked as though it were not.
    assert "Engine: numpy" in body
    # The spec hash, because it is what makes two runs comparable at all.
    assert "spec 01234567" in body
    # The purge, because an out-of-sample Sharpe from an unpurged fold is not
    # an out-of-sample Sharpe.
    assert "Purge per fold: 3 bars" in body


def test_the_fold_line_counts_the_positive_ones():
    _, body = render_ml_card(RUN)
    assert "Folds: 2 of 3 positive out-of-sample" in body


def test_a_varying_purge_is_reported_as_a_range_rather_than_one_number():
    varied = {**RUN, "folds": [
        {"purge_bars": 3, "oos_sharpe": 0.1},
        {"purge_bars": 11, "oos_sharpe": 0.2},
    ]}
    _, body = render_ml_card(varied)
    assert "Purge per fold: 3–11 bars" in body


def test_missing_figures_say_so_rather_than_reading_as_zero():
    # The rule the whole corpus follows: an absent number is not a small one.
    # A card claiming "DSR 0" for a run that never computed one would retrieve
    # for "runs that failed deflation" and be wrong.
    sparse = {k: v for k, v in RUN.items() if k not in
              ("deflated_sharpe", "pbo", "oos_sharpe", "data_hash", "git_sha")}
    _, body = render_ml_card(sparse)
    assert "Deflated Sharpe (DSR): not computed" in body
    assert "Overfit probability (PBO): not computed" in body
    assert "Out-of-sample Sharpe: not computed" in body
    assert "Data hash: unrecorded" in body
    assert "Build: unrecorded" in body
    assert " 0" not in body.split("Deflated")[1].split("\n")[0]


def test_a_run_with_no_folds_says_none_recorded_rather_than_zero_of_zero():
    _, body = render_ml_card({**RUN, "folds": []})
    assert "Folds: none recorded" in body
    assert "Purge per fold: no folds recorded" in body


def test_a_run_with_no_feature_row_says_unrecorded():
    _, body = render_ml_card({**RUN, "features": None})
    assert "Features: unrecorded" in body


def test_the_card_reads_in_the_same_vocabulary_as_a_sweep_card():
    # An ML run and a sweep retrieved by one query should read as two answers
    # to a question, not two kinds of document.
    _, body = render_ml_card(RUN)
    for shared in ("Deflated Sharpe (DSR)", "Overfit probability (PBO)", "Data hash"):
        assert shared in body, shared
