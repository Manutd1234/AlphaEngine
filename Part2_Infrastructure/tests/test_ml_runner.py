"""The walk-forward runner, tested on data whose answer is known.

The two cases that matter for a research plane are opposite ones. On a random
walk there is nothing to find, and a harness that reports a good Sharpe on
noise is worse than no harness. On a series with a signal deliberately planted
in it, the same harness must find it — otherwise a real edge would be discarded
and nobody would know why.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

import modules.ml.runner as runner_module
from modules.backtester import bars_per_year
from modules.backtester.statistics import deflated_sharpe_ratio, dsr_verdict
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


def test_the_deflation_is_computed_per_bar_not_annualised():
    """The units the DSR is computed in, pinned.

    ``probabilistic_sharpe_ratio`` is documented per-observation, and the runner
    scores candidates annualised — ``_score`` multiplies by √ann. Handing those
    figures straight to ``deflated_sharpe_ratio`` inflated (sr − sr*)·√(n−1) by
    √(bars per year) and mixed an annualised Sharpe into a variance term built
    from per-bar skew and kurtosis. On an hourly interval that is a factor of
    ~94, which saturated the statistic: a mediocre winner over a 24-candidate
    grid reported DSR 1.0000 and a verdict of PASS where the honest figure was
    0.54 and a FAIL. The gate that exists to catch selection bias passed
    everything it was shown.

    ``modules/backtester/run.py`` always de-annualised before this call, and
    ``_min_track_record_bars`` in the runner itself warns about exactly this
    factor — so the convention was never in doubt, only unapplied here.
    """
    ann = bars_per_year("1h")
    root = math.sqrt(ann)
    n = 2000
    rng = np.random.default_rng(7)
    candidates_ann = rng.normal(0.4, 0.8, 24)
    selected_ann = float(candidates_ann.max())

    annualised = deflated_sharpe_ratio(candidates_ann, selected_ann, n, -0.3, 4.5)
    per_bar = deflated_sharpe_ratio(candidates_ann / root, selected_ann / root, n, -0.3, 4.5)

    # The defect, stated as the thing that must not come back.
    assert annualised[0] > 0.999, "the mis-scaled call saturates against the PASS threshold"
    assert per_bar[0] < 0.95, "the honest figure does not clear the PASS threshold"
    assert dsr_verdict(annualised[0]).startswith("PASS")
    assert dsr_verdict(per_bar[0]).startswith("FAIL")


def test_the_runner_calls_dsr_in_per_bar_units_and_reannualises_the_hurdle_once(monkeypatch):
    """Pin the production call site, not only the statistic in isolation."""
    captured: dict[str, object] = {}
    expected_max_per_bar = 0.012345

    def record_dsr(candidates, selected, n_obs, skew, kurt):
        captured.update(
            candidates=np.asarray(candidates).copy(), selected=selected,
            n_obs=n_obs, skew=skew, kurt=kurt,
        )
        return 0.42, 0.43, expected_max_per_bar

    monkeypatch.setattr(runner_module, "deflated_sharpe_ratio", record_dsr)
    builder = _builder()
    data = builder.build(**_bars(_with_momentum()))
    interval = "1h"
    result = MLWalkForward(Ridge(alpha=1.0), interval=interval).run(
        data, builder.splitter(5),
    )

    root_ann = math.sqrt(bars_per_year(interval))
    expected_candidates = np.asarray(
        [fold.oos_sharpe for fold in result.folds], dtype=np.float64,
    ) / root_ann
    np.testing.assert_allclose(captured["candidates"], expected_candidates)
    assert captured["selected"] == pytest.approx(result.oos_sharpe / root_ann)
    assert captured["n_obs"] == result.oos_returns.size
    assert result.expected_max_sharpe == pytest.approx(expected_max_per_bar * root_ann)
    assert result.expected_max_sharpe != pytest.approx(expected_max_per_bar)
    assert result.expected_max_sharpe != pytest.approx(expected_max_per_bar * root_ann**2)


def test_the_expected_max_sharpe_is_reported_in_the_same_unit_as_oos_sharpe():
    # The hurdle sits on `MLRunResult` beside an annualised `oos_sharpe`. A
    # per-bar figure under a name that does not say per-bar is the unit blend
    # this codebase treats as the defect, so the runner re-annualises it after
    # deflating. Same plane, or the comparison a reader makes is meaningless.
    builder = _builder()
    data = builder.build(**_bars(_with_momentum()))
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, builder.splitter(5))
    if result.expected_max_sharpe > 0.0:
        # Per-bar hurdles on an intraday interval are ~1e-2; annualised ones are
        # order 1. The boundary is loose on purpose — this pins the plane, not
        # the value.
        assert result.expected_max_sharpe > 0.05


@pytest.mark.parametrize("splits", [1, 3, 8])
def test_the_fold_count_is_honoured_where_the_series_allows(splits):
    builder = _builder()
    data = builder.build(**_bars(_random_walk(n=2000)))
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, builder.splitter(splits))
    assert result.usable_folds == splits
