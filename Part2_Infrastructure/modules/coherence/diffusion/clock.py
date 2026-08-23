"""A clock that is not made of the event, and the controls that supply it.

The identification problem this file exists for: a price path that stops moving
may have finished absorbing the news, or may simply have run out of
volatility. Wall-clock half-life cannot tell those apart, and the obvious
repair — measure time in the event's own realised variance — is circular. The
event jump IS most of that variance, so cumulative RV and the abnormal return
are two functions of the same returns, and the "clock" ends up a monotone
transform of the thing it was supposed to normalise.

So the clock is built from OTHER windows: the same clock time on the nearest
prior days, which is where the intraday volatility seasonal lives. A horizon's
position on this clock is the variance those windows had accumulated by then.
An event that finishes moving because the whole hour is quiet reads as *slow*
on the wall clock and *ordinary* on this one, which is the distinction the
verdict needs.

The same controls do a second job. Running the entire measurement on them —
same anchoring, same grid, same gate, no announcement — is the placebo. If a
control window produces half-lives that look like the event windows, the
pipeline is measuring its own arithmetic.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from modules.coherence.diffusion.bars import BarSeries, log_returns

_DAY_MS = 86_400_000


@dataclass(frozen=True)
class ControlWindow:
    """One non-event window used as a clock reference and as a placebo."""

    t0_ms: int
    days_back: int
    sigma_per_bar: float | None
    bars: int


@dataclass(frozen=True)
class VolatilityClock:
    """Cumulative control variance at each horizon, and how many made it."""

    horizon_seconds: tuple[float, ...]
    cumulative_variance: tuple[float | None, ...]
    controls_used: int
    state: str
    reason: str | None = None

    def axis(self) -> np.ndarray:
        """The clock as an x-axis, with unmeasured horizons as NaN."""
        return np.asarray(
            [np.nan if value is None else value for value in self.cumulative_variance],
            dtype=np.float64,
        )


def matched_controls(
    series: BarSeries,
    t0_ms: int,
    *,
    k: int,
    pre_min_bars: int,
    lookback_ms: int = _DAY_MS,
    exclude_ms: tuple[int, ...] = (),
    exclude_window_ms: int = _DAY_MS,
) -> list[ControlWindow]:
    """The `k` nearest prior days at the same clock time, skipping event days.

    Same clock time rather than a random offset, because the thing being
    controlled for is the time-of-day volatility seasonal: an FOMC statement
    always lands in the New York afternoon, and comparing it with a window
    drawn uniformly from the day would compare it with Tokyo lunchtime.

    `lookback_ms` is how far back a candidate looks for its OWN volatility,
    which is a filter and a diagnostic rather than an input to the clock. It is
    a parameter because it sets how much history the caller must fetch, and at
    one minute the difference between a day and three weeks is a page and
    thirty pages.
    """
    controls: list[ControlWindow] = []
    days_back = 1
    attempts = 0
    while len(controls) < k and attempts < k * 6:
        attempts += 1
        candidate = t0_ms - days_back * _DAY_MS
        days_back += 1
        if any(abs(candidate - blocked) < exclude_window_ms for blocked in exclude_ms):
            continue
        window = series.slice(candidate - lookback_ms, candidate - series.step_ms)
        returns = log_returns(window)
        if returns.size < pre_min_bars:
            continue
        controls.append(ControlWindow(
            t0_ms=candidate, days_back=days_back - 1,
            sigma_per_bar=float(np.std(returns, ddof=1)), bars=int(returns.size),
        ))
    return controls


def volatility_clock(
    series: BarSeries,
    controls: list[ControlWindow],
    horizon_seconds: tuple[float, ...],
) -> VolatilityClock:
    """Variance the control windows had accumulated by each horizon.

    Pooled as a mean across controls. A horizon no control covered is `None`
    rather than zero — zero variance would place it at the origin of the clock
    and make every event look instantaneous there.
    """
    if not controls:
        return VolatilityClock(horizon_seconds, tuple(None for _ in horizon_seconds), 0,
                               "unavailable", "no control window met the pre-window floor")
    accumulated: list[float | None] = []
    used = 0
    for seconds in horizon_seconds:
        per_control: list[float] = []
        for control in controls:
            end = control.t0_ms + int(seconds * 1000)
            window = series.slice(control.t0_ms, end)
            returns = log_returns(window)
            if returns.size == 0:
                continue
            per_control.append(float(np.sum(returns**2)))
        if per_control:
            accumulated.append(float(np.mean(per_control)))
            used = max(used, len(per_control))
        else:
            accumulated.append(None)
    measured = sum(1 for value in accumulated if value is not None)
    if measured == 0:
        return VolatilityClock(horizon_seconds, tuple(accumulated), 0, "unavailable",
                               "no control window produced a return inside any horizon")
    state = "ok" if measured == len(horizon_seconds) else "partial"
    reason = None if state == "ok" else f"{measured} of {len(horizon_seconds)} horizons had control variance"
    return VolatilityClock(horizon_seconds, tuple(accumulated), used, state, reason)


def percentile_of(value: float | None, comparisons: list[float]) -> float | None:
    """Where `value` sits inside the control distribution, or None.

    None when there is nothing to compare against — a percentile computed
    against an empty set is not a small percentile, it is not a percentile.
    """
    if value is None or not comparisons:
        return None
    ordered = np.sort(np.asarray(comparisons, dtype=np.float64))
    below = float(np.count_nonzero(ordered < value))
    ties = float(np.count_nonzero(ordered == value))
    return float((below + 0.5 * ties) / ordered.size)
