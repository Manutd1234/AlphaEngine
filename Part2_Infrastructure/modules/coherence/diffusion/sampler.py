"""Importance sampling over log-SNR, with the truncation the source forgot.

Every integral in this package is over `alpha = log SNR`, and none of them is
computed by quadrature. The density that makes the variance tolerable is a
logistic over alpha, truncated at `clip` scale units; a draw carries the weight
`1/q(alpha)` so that

    integral of f  ~=  mean over draws of w_i * f(alpha_i)

MEAN, not sum. Writing `sum(w_i * f_i)` overstates every quantity by the number
of grid points, which for the reference setting of one hundred is two orders of
magnitude, and every known-answer test in this package fails loudly if it
creeps back in.

`clip` is a parameter and it is passed. The upstream implementation accepts a
`--clip` flag, threads it through one of its three estimators and silently
drops it in the other two, so its published numbers ran at the default of 4
rather than the 3 its own README documents. A truncation that is not honoured
is a truncation nobody can reproduce, so there is a regression test here that
two different clips give two different supports.

The grid is quantile MIDPOINTS rather than sorted random draws. The upstream
calls a seeded random sample `deterministic=True`, which reproduces but does
not equidistribute: it leaves gaps and clusters that a quantile grid does not,
and the estimate is then noisier for the same number of denoiser evaluations.
"""

from __future__ import annotations

import numpy as np


def _logit(probability: np.ndarray) -> np.ndarray:
    return np.log(probability) - np.log1p(-probability)


def logistic_grid(points: int, loc: float, scale: float, clip: float) -> tuple[np.ndarray, np.ndarray]:
    """A fixed, equidistributed grid over the truncated logistic, and its weights.

    Shared across every event in a panel so that two information numbers differ
    because their denoisers differ and not because they were integrated at
    different places.
    """
    if points < 1:
        raise ValueError(f"a grid needs at least one point, got {points}")
    low, high = _sigmoid(-clip), _sigmoid(clip)
    quantiles = (np.arange(points, dtype=np.float64) + 0.5) / points
    probabilities = low + (high - low) * quantiles
    alpha = loc + scale * _logit(probabilities)
    return alpha, _weights(alpha, loc, scale, clip)


def logistic_draw(points: int, loc: float, scale: float, clip: float,
                  rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Random draws from the same density, for a training step."""
    low, high = _sigmoid(-clip), _sigmoid(clip)
    probabilities = low + (high - low) * rng.random(points)
    alpha = loc + scale * _logit(probabilities)
    return alpha, _weights(alpha, loc, scale, clip)


def _weights(alpha: np.ndarray, loc: float, scale: float, clip: float) -> np.ndarray:
    """`1/q(alpha)` for the truncated logistic, so the mean is the integral."""
    standardised = (alpha - loc) / scale
    density = _sigmoid(standardised) * _sigmoid(-standardised)
    return scale * np.tanh(clip / 2.0) / density


def support(loc: float, scale: float, clip: float) -> tuple[float, float]:
    """The interval the truncation actually integrates over."""
    return loc - clip * scale, loc + clip * scale


def _sigmoid(value: np.ndarray | float) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.asarray(value, dtype=np.float64)))


def sigmoid(value: np.ndarray | float) -> np.ndarray:
    """The variance-preserving channel's signal share at a given log-SNR."""
    return _sigmoid(value)


def noisy_channel(x: np.ndarray, alpha: np.ndarray, eps: np.ndarray) -> np.ndarray:
    """`z = sqrt(sigmoid(a)) x + sqrt(sigmoid(-a)) eps`, broadcasting over rows."""
    share = sigmoid(alpha)
    if x.ndim == 2 and np.ndim(share) == 1:
        share = share[:, None]
    return np.sqrt(share) * x + np.sqrt(1.0 - share) * eps
