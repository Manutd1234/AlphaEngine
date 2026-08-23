"""Half-life, and the two parametric fits that are not allowed to be the verdict.

The Phase 0 statistic is non-parametric on purpose. A half-life read by
interpolating the absorbed-fraction curve makes one assumption — that the curve
is monotone between the two horizons it crosses 0.5 between — and an
exponential fit makes several, any of which can manufacture a difference
between two stages that the data does not contain. The fits are reported
because the shape is interesting; they are never the number a verdict turns on.

Interpolation is in LOG horizon. The grid is roughly geometric (1m, 2m, 5m,
10m, 15m, 30m), so linear interpolation between 15m and 30m would place a
crossing at the arithmetic midpoint of a cell that spans a doubling. Snapping
to the later horizon instead — the other obvious choice — quantises every
half-life onto the grid and makes the distribution a picture of the sampler
rather than of the market.

Both fits are selected and scored in u-SPACE, where `u = 1 - absorbed` is the
unpriced fraction. Fitting `log(u - u_inf)` and then choosing `u_inf` by the
residual of THAT regression is the trap: the log compresses the residual range
as `u_inf` rises, so the search walks the asymptote up until the fit looks
good. The linearisation is still used to get `tau` in closed form; the
selection is on the sum of squares of what was actually asked.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

FitModel = Literal["exponential", "power", "none"]
HalfLifeState = Literal["ok", "at_or_before_first", "never_reached", "too_few_points"]


@dataclass(frozen=True)
class HalfLife:
    """A crossing, or the reason there is not one."""

    state: HalfLifeState
    value: float | None = None
    #: The two grid points the crossing sits between, for a reader who wants to
    #: know how much of the number is interpolation.
    lower: float | None = None
    upper: float | None = None
    reason: str | None = None


@dataclass(frozen=True)
class DecayFit:
    model: FitModel
    half_life: float | None = None
    terminal_unpriced_fraction: float | None = None
    #: Sum of squares in u-space, so the two models are comparable.
    sse: float | None = None
    n_points: int = 0
    overshoot_points: int = 0
    reason: str | None = None


def half_life(x: np.ndarray, absorbed: np.ndarray, *, level: float = 0.5) -> HalfLife:
    """Where `absorbed` first reaches `level`, interpolated in log-x.

    `x` is whatever clock the caller is measuring in — seconds for the wall
    clock, accumulated control variance for the volatility clock. The function
    does not care, which is the point: the two are the same arithmetic on two
    different axes and must not drift apart in two implementations.
    """
    x = np.asarray(x, dtype=np.float64)
    absorbed = np.asarray(absorbed, dtype=np.float64)
    finite = np.isfinite(x) & np.isfinite(absorbed) & (x > 0)
    x, absorbed = x[finite], absorbed[finite]
    if x.size < 2:
        return HalfLife("too_few_points", reason=f"{x.size} measured horizons is not a curve")
    order = np.argsort(x)
    x, absorbed = x[order], absorbed[order]
    if absorbed[0] >= level:
        return HalfLife("at_or_before_first", value=float(x[0]), upper=float(x[0]),
                        reason="the first measured horizon was already past the level, "
                               "so the crossing is not resolved by this grid")
    crossings = np.nonzero(absorbed >= level)[0]
    if crossings.size == 0:
        return HalfLife("never_reached", lower=float(x[-1]),
                        reason=f"the path never reached {level:g} of its terminal move inside the window")
    index = int(crossings[0])
    lo_x, hi_x = float(x[index - 1]), float(x[index])
    lo_a, hi_a = float(absorbed[index - 1]), float(absorbed[index])
    if hi_a == lo_a:
        return HalfLife("ok", value=hi_x, lower=lo_x, upper=hi_x)
    weight = (level - lo_a) / (hi_a - lo_a)
    value = float(np.exp(np.log(lo_x) + weight * (np.log(hi_x) - np.log(lo_x))))
    return HalfLife("ok", value=value, lower=lo_x, upper=hi_x)


def _u_space_sse(seconds: np.ndarray, unpriced: np.ndarray, predicted: np.ndarray) -> float:
    _ = seconds
    return float(np.sum((unpriced - predicted) ** 2))


def fit_exponential(seconds: np.ndarray, absorbed: np.ndarray, *,
                    asymptotes: np.ndarray | None = None) -> DecayFit:
    """`u(h) = u_inf + (1 - u_inf) e^{-h/tau}`, selected on u-space residual."""
    seconds = np.asarray(seconds, dtype=np.float64)
    unpriced = 1.0 - np.asarray(absorbed, dtype=np.float64)
    finite = np.isfinite(seconds) & np.isfinite(unpriced) & (seconds > 0)
    seconds, unpriced = seconds[finite], unpriced[finite]
    overshoot = int(np.count_nonzero(unpriced < 0))
    if seconds.size < 3:
        return DecayFit("none", n_points=int(seconds.size), overshoot_points=overshoot,
                        reason="fewer than three measured horizons")
    grid = np.arange(0.0, 0.81, 0.05) if asymptotes is None else np.asarray(asymptotes, dtype=np.float64)
    best: DecayFit | None = None
    for u_inf in grid:
        usable = unpriced > u_inf + 1e-9
        if int(np.count_nonzero(usable)) < 3:
            continue
        design = np.column_stack([seconds[usable], np.ones(int(np.count_nonzero(usable)))])
        slope, intercept = np.linalg.lstsq(design, np.log(unpriced[usable] - u_inf), rcond=None)[0]
        if slope >= 0:
            continue
        tau = -1.0 / float(slope)
        predicted = u_inf + float(np.exp(intercept)) * np.exp(-seconds / tau)
        sse = _u_space_sse(seconds, unpriced, predicted)
        if best is None or (best.sse is not None and sse < best.sse):
            best = DecayFit("exponential", half_life=tau * float(np.log(2.0)),
                            terminal_unpriced_fraction=float(u_inf), sse=sse,
                            n_points=int(seconds.size), overshoot_points=overshoot)
    if best is None:
        return DecayFit("none", n_points=int(seconds.size), overshoot_points=overshoot,
                        reason="no asymptote left three points above it with a decaying fit")
    return best


def fit_power(seconds: np.ndarray, absorbed: np.ndarray) -> DecayFit:
    """`u(h) = c h^{-b}`, scored in u-space so it compares with the exponential."""
    seconds = np.asarray(seconds, dtype=np.float64)
    unpriced = 1.0 - np.asarray(absorbed, dtype=np.float64)
    finite = np.isfinite(seconds) & np.isfinite(unpriced) & (seconds > 0)
    seconds, unpriced = seconds[finite], unpriced[finite]
    overshoot = int(np.count_nonzero(unpriced < 0))
    usable = unpriced > 1e-9
    if int(np.count_nonzero(usable)) < 3:
        return DecayFit("none", n_points=int(seconds.size), overshoot_points=overshoot,
                        reason="fewer than three horizons with a positive unpriced fraction")
    design = np.column_stack([np.log(seconds[usable]), np.ones(int(np.count_nonzero(usable)))])
    slope, intercept = np.linalg.lstsq(design, np.log(unpriced[usable]), rcond=None)[0]
    coefficient = float(np.exp(intercept))
    predicted = coefficient * seconds ** float(slope)
    sse = _u_space_sse(seconds, unpriced, predicted)
    life: float | None = None
    if slope < 0 and coefficient > 0:
        life = float((0.5 / coefficient) ** (1.0 / float(slope)))
    return DecayFit("power", half_life=life, terminal_unpriced_fraction=None, sse=sse,
                    n_points=int(seconds.size), overshoot_points=overshoot,
                    reason=None if life is not None else "the fitted exponent does not decay")
