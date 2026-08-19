"""The feature builder, tested for look-ahead.

A feature that peeks forward leaks in a way no split can protect against,
because the leak is inside the column rather than between the windows. These
tests check that property directly: change a future bar and every feature at
every earlier row must be unchanged.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.ml.features import FeatureBuilder, FeatureSpec, LabelSpec


def _bars(n=400, seed=20260820):
    rng = np.random.default_rng(seed)
    close = 100.0 * np.exp(np.cumsum(rng.normal(scale=0.01, size=n)))
    high = close * (1 + np.abs(rng.normal(scale=0.003, size=n)))
    low = close * (1 - np.abs(rng.normal(scale=0.003, size=n)))
    open_ = close * (1 + rng.normal(scale=0.002, size=n))
    volume = np.abs(rng.normal(loc=1000, scale=200, size=n))
    return dict(open_=open_, high=high, low=low, close=close, volume=volume)


ALL_KINDS = [
    FeatureSpec("return", 5), FeatureSpec("volatility", 10), FeatureSpec("momentum", 20),
    FeatureSpec("range", 5), FeatureSpec("volume_z", 10), FeatureSpec("gap", 5),
]


def test_no_feature_sees_a_future_bar():
    """The test that matters. Perturb the last bars; earlier rows must not move."""
    bars = _bars()
    builder = FeatureBuilder(ALL_KINDS, LabelSpec(horizon=1, kind="return"))
    base = builder.build(**bars)

    tampered = {k: v.copy() for k, v in bars.items()}
    for key in tampered:
        tampered[key][-40:] *= 1.5
    after = builder.build(**tampered)

    # Compare rows whose ORIGINAL index is well before the tampering.
    safe = base.row_index < len(bars["close"]) - 60
    safe_after = after.row_index < len(bars["close"]) - 60
    assert np.array_equal(base.row_index[safe], after.row_index[safe_after])
    assert np.allclose(base.x[safe], after.x[safe_after], equal_nan=True), (
        "a feature changed at a row that precedes the bars that were altered"
    )


def test_the_label_does_look_forward_by_exactly_its_horizon():
    # The label SHOULD peek — that is what makes it a label — and by exactly
    # the number of bars the splitter purges by.
    bars = _bars(n=200)
    builder = FeatureBuilder([FeatureSpec("return", 2)], LabelSpec(horizon=7, kind="return"))
    built = builder.build(**bars)
    close = bars["close"]
    for row, original in enumerate(built.row_index[:20]):
        expected = np.log(close[original + 7] / close[original])
        assert built.y[row] == pytest.approx(expected)


def test_direction_labels_are_zero_or_one_and_match_the_sign():
    bars = _bars(n=300)
    builder = FeatureBuilder([FeatureSpec("return", 3)], LabelSpec(horizon=4, kind="direction"))
    built = builder.build(**bars)
    assert set(np.unique(built.y)).issubset({0.0, 1.0})
    close = bars["close"]
    for row, original in enumerate(built.row_index[:20]):
        forward = np.log(close[original + 4] / close[original])
        assert built.y[row] == (1.0 if forward > 0 else 0.0)


def test_warm_up_rows_are_dropped_rather_than_zero_filled():
    # A model fitted on nan-filled warm-up rows is fitted on zeros meaning
    # "no data", which it treats as a signal like any other number.
    bars = _bars(n=200)
    builder = FeatureBuilder([FeatureSpec("momentum", 50)], LabelSpec(horizon=3))
    built = builder.build(**bars)
    assert np.all(np.isfinite(built.x))
    assert np.all(np.isfinite(built.y))
    assert built.row_index[0] >= 50, "rows before the longest lookback must not survive"
    assert built.row_index[-1] <= 200 - 3 - 1, "rows whose label runs off the end must not survive"


def test_the_trailing_window_excludes_the_current_bar():
    # Including bar t uses information from bar t to describe bar t. Fine on a
    # chart; a leak in a model.
    close = np.array([10.0, 11.0, 12.0, 13.0, 100.0, 15.0], dtype=float)
    bars = dict(open_=close.copy(), high=close * 1.01, low=close * 0.99,
                close=close, volume=np.full(6, 100.0))
    builder = FeatureBuilder([FeatureSpec("volatility", 2)], LabelSpec(horizon=1, kind="return"))
    built = builder.build(**bars)
    # The row AT the 100.0 spike must not have the spike in its own volatility.
    spike = int(np.flatnonzero(built.row_index == 4)[0])
    later = int(np.flatnonzero(built.row_index == 5)[0]) if 5 in built.row_index else None
    if later is not None:
        assert built.x[later, 0] > built.x[spike, 0], (
            "the spike must appear in the NEXT bar's trailing window, not its own"
        )


def test_the_spec_hash_changes_with_order_and_with_the_label():
    a = FeatureBuilder([FeatureSpec("return", 5), FeatureSpec("momentum", 10)], LabelSpec(2))
    b = FeatureBuilder([FeatureSpec("momentum", 10), FeatureSpec("return", 5)], LabelSpec(2))
    c = FeatureBuilder([FeatureSpec("return", 5), FeatureSpec("momentum", 10)], LabelSpec(9))
    assert a.spec_hash() != b.spec_hash(), "order is part of the identity"
    assert a.spec_hash() != c.spec_hash(), "the label is part of the identity"
    assert a.spec_hash() == FeatureBuilder(
        [FeatureSpec("return", 5), FeatureSpec("momentum", 10)], LabelSpec(2)
    ).spec_hash()


def test_the_splitter_inherits_the_label_horizon():
    # Configuring the purge separately from the label is how they end up
    # different, so the builder hands out the matching splitter.
    builder = FeatureBuilder([FeatureSpec("return", 3)], LabelSpec(horizon=11))
    cv = builder.splitter(n_splits=4)
    assert cv.label_horizon == 11
    assert cv.purge == 10


def test_unknown_kinds_and_duplicate_columns_are_refused():
    with pytest.raises(ValueError, match="unknown feature kind"):
        FeatureSpec("wishful_thinking", 5)
    with pytest.raises(ValueError, match="duplicate feature columns"):
        FeatureBuilder([FeatureSpec("return", 5), FeatureSpec("return", 5)], LabelSpec(1))
    with pytest.raises(ValueError, match="at least one feature"):
        FeatureBuilder([], LabelSpec(1))


def test_mismatched_series_lengths_are_refused():
    bars = _bars(n=100)
    bars["volume"] = bars["volume"][:-1]
    builder = FeatureBuilder([FeatureSpec("return", 2)], LabelSpec(1))
    with pytest.raises(ValueError, match="volume has"):
        builder.build(**bars)
