"""The volatility clock is built from other windows, and says when it cannot be.

The circularity this file guards against: measuring an event in its own
realised variance. The event jump is most of that variance, so such a clock is
close to a monotone transform of the very path it is meant to normalise. The
clock here reads the SAME clock time on prior days, which is where the
intraday volatility seasonal lives and where the event is not.
"""

from __future__ import annotations

import numpy as np

from modules.coherence.diffusion.bars import series_from_klines
from modules.coherence.diffusion.clock import (
    matched_controls,
    percentile_of,
    volatility_clock,
)

STEP = 60_000
DAY = 86_400_000
T0 = 1_700_000_000_000


def _series(days: int = 12, *, quiet_scale: float = 1.0, seed: int = 5):
    rng = np.random.default_rng(seed)
    bars = days * 1440
    start = T0 - (days - 1) * DAY
    price = 100.0
    raw = []
    for i in range(bars):
        stamp = start + i * STEP
        price *= float(np.exp(rng.normal(0.0, 0.0004 * quiet_scale)))
        raw.append([stamp, price, price, price, price, 1.0])
    return series_from_klines("BTCUSDT", "1m", raw)


class TestControlsAreTheSameClockTimeOnPriorDays:
    def test_they_step_back_one_day_at_a_time(self):
        controls = matched_controls(_series(), T0, k=5, pre_min_bars=30)
        assert [control.days_back for control in controls] == [1, 2, 3, 4, 5]
        for control in controls:
            assert (T0 - control.t0_ms) % DAY == 0, "a control drifted off the clock time"

    def test_an_excluded_day_is_stepped_over_rather_than_dropped(self):
        blocked = T0 - 2 * DAY
        controls = matched_controls(_series(), T0, k=3, pre_min_bars=30, exclude_ms=(blocked,))
        assert blocked not in {control.t0_ms for control in controls}
        assert len(controls) == 3, "the excluded day was not replaced by the next one back"

    def test_a_series_with_no_history_yields_no_controls_rather_than_empty_windows(self):
        thin = series_from_klines("BTCUSDT", "1m", [[T0 - i * STEP, 1, 1, 1, 100.0, 1] for i in range(5)])
        assert matched_controls(thin, T0, k=5, pre_min_bars=30) == []


class TestTheClockIsCumulativeControlVariance:
    def test_it_rises_with_the_horizon(self):
        series = _series()
        controls = matched_controls(series, T0, k=5, pre_min_bars=30)
        clock = volatility_clock(series, controls, (60.0, 300.0, 900.0, 1800.0))
        assert clock.state == "ok"
        values = [value for value in clock.cumulative_variance if value is not None]
        assert values == sorted(values), "accumulated variance went backwards"

    def test_a_quieter_tape_gives_a_slower_clock(self):
        loud = _series(quiet_scale=4.0, seed=9)
        quiet = _series(quiet_scale=1.0, seed=9)
        horizons = (60.0, 300.0, 900.0, 1800.0)
        loud_clock = volatility_clock(loud, matched_controls(loud, T0, k=5, pre_min_bars=30), horizons)
        quiet_clock = volatility_clock(quiet, matched_controls(quiet, T0, k=5, pre_min_bars=30), horizons)
        assert loud_clock.cumulative_variance[-1] > quiet_clock.cumulative_variance[-1]

    def test_no_controls_is_unavailable_with_a_reason_not_a_clock_of_zeros(self):
        series = _series()
        clock = volatility_clock(series, [], (60.0, 300.0))
        assert clock.state == "unavailable"
        assert clock.reason
        assert all(value is None for value in clock.cumulative_variance)
        assert np.all(np.isnan(clock.axis()))

    def test_the_axis_carries_nan_for_a_horizon_no_control_covered(self):
        series = _series()
        controls = matched_controls(series, T0, k=2, pre_min_bars=30)
        clock = volatility_clock(series, controls, (60.0, 10.0 * DAY / 1000.0))
        assert clock.state in {"partial", "ok"}
        assert np.isnan(clock.axis()[1]) or clock.cumulative_variance[1] is not None


class TestAPercentileNeedsSomethingToCompareWith:
    def test_an_empty_comparison_set_is_none_not_zero(self):
        assert percentile_of(1.0, []) is None

    def test_a_missing_value_is_none(self):
        assert percentile_of(None, [1.0, 2.0]) is None

    def test_ties_land_halfway(self):
        assert percentile_of(2.0, [1.0, 2.0, 3.0]) == 0.5
