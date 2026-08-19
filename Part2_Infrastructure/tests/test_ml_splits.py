"""The leak guard, tested for the leak.

A purged walk-forward is one of those components whose bug is invisible: it
produces folds, the folds produce numbers, the numbers look good, and the only
symptom is that the strategy does not work. So these tests do not check that
splitting "works" — they check the specific overlaps that constitute a leak.
"""

from __future__ import annotations

import pytest

from modules.ml.splits import Fold, PurgedWalkForward


def test_a_test_window_never_overlaps_its_own_training_window():
    for horizon in (1, 5, 12):
        cv = PurgedWalkForward(n_splits=5, label_horizon=horizon)
        for fold in cv.split(1000):
            assert fold.train_end <= fold.test_start, (
                f"horizon {horizon} fold {fold.index}: trains past the test window"
            )


def test_the_purge_is_exactly_the_label_horizon_minus_the_labelled_bar():
    # A 12-bar label on bar t uses bars t..t+11, so the last 11 training bars
    # reach into the test window. Not 12: bar t itself is legitimately trainable
    # only if its whole horizon precedes the test window, which is what removing
    # 11 achieves.
    cv = PurgedWalkForward(n_splits=4, label_horizon=12)
    for fold in cv.split(1000):
        assert fold.purged_bars == 11
        assert fold.train_end == fold.test_start - 11


def test_a_one_bar_label_purges_nothing_and_says_so():
    cv = PurgedWalkForward(n_splits=4, label_horizon=1)
    folds = cv.split(1000)
    assert folds, "a 1000-bar series must produce folds"
    for fold in folds:
        # Zero is a claim, not an absence: this label does not reach forward.
        assert fold.purged_bars == 0
        assert fold.train_end == fold.test_start


def test_test_windows_are_in_time_order_and_do_not_overlap_each_other():
    cv = PurgedWalkForward(n_splits=5, label_horizon=3)
    folds = cv.split(1200)
    for earlier, later in zip(folds, folds[1:], strict=False):
        assert later.test_start >= earlier.test_end, "test windows overlap"
        assert later.index == earlier.index + 1


def test_the_window_expands_rather_than_rolls():
    # A rolling window answers "does this work lately" and discards the history
    # a deflated Sharpe needs. Every fold starts at the beginning of the series.
    cv = PurgedWalkForward(n_splits=5, label_horizon=4)
    for fold in cv.split(900):
        assert fold.train_start == 0
    assert [f.train_end for f in cv.split(900)] == sorted(f.train_end for f in cv.split(900))


def test_the_embargo_is_a_measured_zero_in_an_expanding_contiguous_scheme():
    """Not an omission — a property, and worth pinning so nobody "fixes" it.

    The embargo removes training bars sitting after a test window. An expanding
    walk-forward with contiguous windows has none: fold i trains on
    [0, test_start_i) and test_start_i == test_end_{i-1}, so the bars following
    any test window ARE the next test window. Asking for an embargo of 10 here
    is answered with a truthful 0 rather than by inventing rows to drop.
    """
    cv = PurgedWalkForward(n_splits=4, label_horizon=2, embargo=10)
    folds = cv.split(1000)
    for fold in folds:
        assert fold.embargoed_bars == 0
        assert cv.embargoed_range(fold, folds) == (0, 0)
    # And the reason it is zero: no training window reaches past a test window.
    for earlier, later in zip(folds, folds[1:], strict=False):
        assert later.train_end <= earlier.test_end + cv.purge + 1


def test_no_embargo_configured_means_no_bars_removed():
    cv = PurgedWalkForward(n_splits=4, label_horizon=2, embargo=0)
    folds = cv.split(1000)
    for fold in folds:
        assert fold.embargoed_bars == 0
        assert cv.embargoed_range(fold, folds) == (0, 0)


def test_a_series_too_short_to_split_answers_truthfully_rather_than_inventing_folds():
    cv = PurgedWalkForward(n_splits=5, label_horizon=20)
    folds = cv.split(12)
    # Whatever comes back must still be honest: no overlap, and a fold whose
    # training window was entirely purged is marked unusable rather than
    # returned as something to fit on.
    for fold in folds:
        assert fold.train_end <= fold.test_start
        if not fold.usable:
            assert fold.train_rows == 0 or fold.test_rows == 0


def test_an_empty_series_produces_no_folds():
    assert PurgedWalkForward().split(0) == []


@pytest.mark.parametrize("bad", [
    dict(n_splits=0),
    dict(label_horizon=0),
    dict(embargo=-1),
])
def test_nonsense_configuration_is_refused_at_construction(bad):
    with pytest.raises(ValueError):
        PurgedWalkForward(**bad)


def test_fold_row_counts_match_the_windows_they_describe():
    fold = Fold(index=0, train_start=0, train_end=100, test_start=110,
                test_end=150, purged_bars=10, embargoed_bars=0)
    assert fold.train_rows == 100
    assert fold.test_rows == 40
    assert fold.usable
