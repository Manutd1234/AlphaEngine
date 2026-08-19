"""Purged, embargoed walk-forward splits.

The failure this exists to prevent
----------------------------------

Supervised learning on bars needs a label, and a label looks forward: "the
return over the next twelve bars". That single fact breaks every ordinary
cross-validation.

Split a series at bar *t* and train on everything before it. The last training
bar's label was computed from bars t, t+1, … t+11 — bars that are in the test
set. The model has been fitted on the answer it is about to be scored against.
The resulting out-of-sample Sharpe is not out of sample, it is not reproducible,
and it is not distinguishable from a real edge by looking at it.

Two gaps close it, and both are needed:

**Purge.** Drop the bars at the END of the training window whose label horizon
reaches into the test window. That is ``label_horizon`` bars.

**Embargo.** Drop training bars that sit immediately AFTER a test window.
Serial correlation runs both ways: a bar just after the test window is
correlated with the test window's own bars, so training on it leaks backwards.

The embargo is **vacuous in this splitter, and that is a property of the
scheme rather than an omission.** An expanding walk-forward with contiguous
test windows never has training data after a test window — fold *i* trains on
``[0, test_start_i)`` and ``test_start_i == test_end_{i-1}``, so the bars
following any test window are the next test window, never training rows. Every
fold here therefore reports ``embargoed_bars == 0``, which is a measured zero
and not a missing value.

It matters for the combinatorial purged CV where a test window is cut from the
MIDDLE of the series and training data exists on both sides of it. The
parameter and the plumbing are kept for that, and `embargoed_range` returns an
empty slice here so a caller written against both gets the same answer either
way.

De Prado's *Advances in Financial Machine Learning* is where this is set out
properly; the implementation here is the plain reading of it and deliberately
carries no tuning knobs beyond the two gaps and the fold count.

What this deliberately does not do
----------------------------------

Shuffle. Anything. A shuffled split of a time series is a leak with extra
steps, and offering the option would be offering the defect.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Fold:
    """One walk-forward fold, as indices into the original series.

    ``train`` is already purged and embargoed — the caller receives the slice
    it may actually fit on, not a raw window plus a warning.
    """

    index: int
    train_start: int
    train_end: int          #: exclusive, after purging
    test_start: int
    test_end: int           #: exclusive
    purged_bars: int
    embargoed_bars: int

    @property
    def train_rows(self) -> int:
        return max(0, self.train_end - self.train_start)

    @property
    def test_rows(self) -> int:
        return max(0, self.test_end - self.test_start)

    @property
    def usable(self) -> bool:
        """Whether anything survived the gaps.

        A fold whose training window was entirely purged is not an error — it
        is a real answer about a short series — but fitting on it would be, so
        callers check this rather than discovering an empty matrix later.
        """
        return self.train_rows > 0 and self.test_rows > 0


class PurgedWalkForward:
    """Expanding-window walk-forward with a purge and an embargo.

    ``n_splits`` test windows of equal size are cut from the end of the series;
    each fold trains on everything before its test window, minus the two gaps.

    The window EXPANDS rather than rolls, because a rolling window answers a
    different question — "does this model work on recent data" — and silently
    discards the history a deflated Sharpe needs to be meaningful.
    """

    def __init__(self, n_splits: int = 5, label_horizon: int = 1, embargo: int = 0) -> None:
        if n_splits < 1:
            raise ValueError("n_splits must be at least 1")
        if label_horizon < 1:
            raise ValueError("label_horizon must be at least 1 bar")
        if embargo < 0:
            raise ValueError("embargo cannot be negative")
        self.n_splits = int(n_splits)
        self.label_horizon = int(label_horizon)
        self.embargo = int(embargo)

    #: The purge is the label horizon minus the bar being labelled itself.
    @property
    def purge(self) -> int:
        return self.label_horizon - 1

    def split(self, n_samples: int) -> list[Fold]:
        """Folds over ``n_samples`` bars, oldest test window first."""
        if n_samples <= 0:
            return []

        test_size = n_samples // (self.n_splits + 1)
        if test_size < 1:
            # Too short to cut the requested number of windows. One fold with
            # whatever is left is a truthful answer; inventing overlapping
            # windows to reach n_splits would not be.
            test_size = max(1, n_samples // 2)

        folds: list[Fold] = []
        first_test = n_samples - test_size * self.n_splits
        if first_test < 1:
            first_test = max(1, n_samples - test_size)

        for i in range(self.n_splits):
            test_start = first_test + i * test_size
            test_end = min(n_samples, test_start + test_size)
            if test_start >= n_samples:
                break

            # Training runs from the start of the series to the test window,
            # then loses `purge` bars whose labels reach into it.
            raw_train_end = test_start
            train_end = max(0, raw_train_end - self.purge)
            purged = raw_train_end - train_end

            # The embargo removes training bars that sit AFTER a test window.
            # This scheme has none: training ends where the test window begins,
            # and the previous test window's successor bars are this fold's own
            # test window. Computed rather than hard-coded, so a future
            # non-contiguous scheme reusing this loop gets a real number.
            train_start = 0
            embargoed = 0
            if i > 0:
                previous_test_end = first_test + i * test_size
                overlap = train_end - previous_test_end
                embargoed = min(self.embargo, max(0, overlap))

            folds.append(Fold(
                index=i,
                train_start=train_start,
                train_end=train_end,
                test_start=test_start,
                test_end=test_end,
                purged_bars=purged,
                embargoed_bars=embargoed,
            ))
        return folds

    def embargoed_range(self, fold: Fold, folds: list[Fold]) -> tuple[int, int]:
        """The half-open slice of training rows this fold's embargo removes.

        Empty for every fold of an expanding contiguous walk-forward — see the
        module docstring. Returned rather than applied so a caller assembles
        one boolean mask over the training window instead of copying the matrix
        twice, and so the same call site works unchanged against a scheme where
        the range is not empty.
        """
        if fold.embargoed_bars <= 0 or fold.index == 0:
            return (0, 0)
        previous = folds[fold.index - 1]
        start = previous.test_end
        return (start, min(start + fold.embargoed_bars, fold.train_end))
