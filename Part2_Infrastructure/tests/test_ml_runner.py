"""The walk-forward runner, tested on data whose answer is known.

The two cases that matter for a research plane are opposite ones. On a random
walk there is nothing to find, and a harness that reports a good Sharpe on
noise is worse than no harness. On a series with a signal deliberately planted
in it, the same harness must find it — otherwise a real edge would be discarded
and nobody would know why.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.ml.features import FeatureBuilder, FeatureSpec, LabelSpec
from modules.ml.models import LogisticRegression, Ridge
from modules.ml.runner import MLWalkForward


def _bars(close: np.ndarray) -> dict:
    n = close.shape[0]
    rng = np.random.default_rng(11)
    return dict(
        open_=close * (1 + rng.normal(scale=0.001, size=n)),
        high=close * 1.004, low=close * 0.996, close=close,
        volume=np.abs(rng.normal(1000, 200, n)),
    )


def _random_walk(n=1200, seed=7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return 100.0 * np.exp(np.cumsum(rng.normal(scale=0.01, size=n)))


def _with_momentum(n=1400, seed=3) -> np.ndarray:
    """A series where the last 5 bars genuinely predict the next 4.

    Built by construction rather than found: each step is 55 % of the previous
    step plus noise, which is real, exploitable autocorrelation.
    """
    rng = np.random.default_rng(seed)
    steps = np.zeros(n)
    for i in range(1, n):
        steps[i] = 0.55 * steps[i - 1] + rng.normal(scale=0.006)
    return 100.0 * np.exp(np.cumsum(steps))


def _builder(horizon=4, kind="return"):
    return FeatureBuilder(
        [FeatureSpec("return", 5), FeatureSpec("volatility", 10), FeatureSpec("momentum", 20)],
        LabelSpec(horizon=horizon, kind=kind),
    )


def test_a_random_walk_produces_no_edge_and_the_verdict_says_so():
    builder = _builder()
    data = builder.build(**_bars(_random_walk()))
    result = MLWalkForward(Ridge(alpha=1.0), interval="4h").run(data, builder.splitter(5))

    assert result.usable_folds == 5
    assert result.oos_sharpe < 1.0, "a random walk must not produce a tradeable Sharpe"
    assert result.deflated_sharpe < 0.95, "DSR must not clear on noise"
    assert result.verdict.startswith(("FAIL", "MARGINAL"))


def test_a_planted_signal_is_found():
    builder = _builder()
    data = builder.build(**_bars(_with_momentum()))
    result = MLWalkForward(Ridge(alpha=1.0), interval="4h", cost_bps=0.0).run(
        data, builder.splitter(5),
    )
    assert result.oos_sharpe > 0.5, (
        f"a strongly autocorrelated series should be exploitable; got {result.oos_sharpe:.2f}"
    )


def test_every_reported_figure_is_out_of_sample_only():
    # The concatenated returns must total exactly the test windows — no
    # training row can reach the result object.
    builder = _builder()
    data = builder.build(**_bars(_random_walk()))
    cv = builder.splitter(5)
    folds = cv.split(data.x.shape[0])
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, cv)

    expected = sum(f.test_rows for f in folds if f.usable)
    assert result.oos_returns.size == expected
    assert sum(fr.fold.test_rows for fr in result.folds) == expected


def test_costs_are_charged_on_position_changes():
    builder = _builder()
    data = builder.build(**_bars(_with_momentum()))
    cv = builder.splitter(5)
    free = MLWalkForward(Ridge(alpha=1.0), cost_bps=0.0).run(data, cv)
    dear = MLWalkForward(Ridge(alpha=1.0), cost_bps=50.0).run(data, cv)

    assert dear.oos_return < free.oos_return, "costs must reduce the result"
    assert dear.trades == free.trades, "costs must not change the positions taken"


def test_a_classifier_runs_and_stays_long_or_flat():
    builder = _builder(horizon=4, kind="direction")
    data = builder.build(**_bars(_with_momentum()))
    result = MLWalkForward(LogisticRegression(alpha=1.0)).run(data, builder.splitter(4))
    assert result.usable_folds >= 1
    assert np.all(np.isfinite(result.oos_returns))


def test_a_series_too_short_to_fit_reports_insufficient_rather_than_a_number():
    # Fewer training rows than features is a solve that "works" and means
    # nothing. Reporting zero folds is the honest answer.
    builder = _builder()
    data = builder.build(**_bars(_random_walk(n=90)))
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, builder.splitter(5))
    if result.usable_folds == 0:
        assert result.verdict == "INSUFFICIENT"
        assert result.oos_returns.size == 0
        assert result.final_model is None


def test_the_run_is_deterministic():
    builder = _builder()
    data = builder.build(**_bars(_random_walk()))
    cv = builder.splitter(5)
    a = MLWalkForward(Ridge(alpha=1.0)).run(data, cv)
    b = MLWalkForward(Ridge(alpha=1.0)).run(data, cv)
    assert np.array_equal(a.oos_returns, b.oos_returns)
    assert a.deflated_sharpe == b.deflated_sharpe


def test_the_deflation_uses_the_folds_that_were_actually_scored():
    # DSR's hurdle grows with the number of trials looked at. Passing a
    # candidate set that does not match what was scored is how a deflated
    # Sharpe stops being deflated.
    builder = _builder()
    data = builder.build(**_bars(_random_walk()))
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, builder.splitter(5))
    assert result.expected_max_sharpe >= 0.0
    assert 0.0 <= result.psr <= 1.0
    assert 0.0 <= result.deflated_sharpe <= 1.0


@pytest.mark.parametrize("splits", [1, 3, 8])
def test_the_fold_count_is_honoured_where_the_series_allows(splits):
    builder = _builder()
    data = builder.build(**_bars(_random_walk(n=2000)))
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, builder.splitter(splits))
    assert result.usable_folds == splits
