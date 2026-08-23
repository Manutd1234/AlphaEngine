"""The instrument: information as a density over resolution.

`i(x;c)` is estimated as the integral over log-SNR of the squared gap between
two denoisers — one that sees `c` and one that does not:

    i(x;c) = 1/2 integral E_eps || eps_hat(z_a | c) - eps_hat(z_a | null) ||^2 da

What this module adds to that number is the INTEGRAND. `g(alpha)` is
non-negative and integrates to the information, so it is a density over
resolution: mass at low alpha means the conditioning explains structure that
survives heavy noise — the coarse, headline-shaped part — and mass at high
alpha means it explains detail that only appears once the noise is nearly
gone. The centroid of `g` therefore says *at what resolution* one text explains
another, which is a different question from how much, and is the question this
project is about.

Three properties make it usable where an absolute density is not. It is a
DIFFERENCE of two denoisers, so the bias from truncating the integral largely
cancels — the manifold problem that makes `-log p` ill-posed on embeddings does
not bite here. It needs no cut point between coarse and fine, because it is a
distribution rather than a split. And it is computable from text alone at the
moment the text appears, so nothing about it requires knowing the price
response.

PAIRED NOISE IS THE VARIANCE REDUCTION. Both conditions see the same `(alpha,
eps)` draw, so the difference is between two denoisers rather than between two
noise realisations. Dropping it multiplies the standard error several-fold;
`paired=False` exists only so a test can measure that.

The estimator is non-negative and biased UPWARD: two imperfect denoisers differ
even when the conditioning carries nothing. So a small positive number is not
evidence of information, and `spectrum_moments` refuses a centroid below a
floor the caller has to supply from a shuffled null rather than from the
standard error, which measures noise around the biased mean and not the bias.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

import numpy as np

#: `(z, alpha, condition) -> eps_hat`, with `condition=None` meaning the null.
Denoiser = Callable[[np.ndarray, np.ndarray, np.ndarray | None], np.ndarray]

MomentState = Literal["ok", "no_information", "too_few_points"]


@dataclass(frozen=True)
class InformationSpectrum:
    """The density, its integral, and the per-dimension split of the integral."""

    alpha: np.ndarray
    density: np.ndarray
    density_stderr: np.ndarray
    per_dimension: np.ndarray
    total_nats: float
    total_stderr: float
    draws: int
    paired: bool


@dataclass(frozen=True)
class SpectrumMoments:
    """Where the information sits on the resolution axis."""

    state: MomentState
    centroid: float | None = None
    q25: float | None = None
    q50: float | None = None
    q75: float | None = None
    fine_fraction: float | None = None
    reason: str | None = None


def mse_curve(denoiser: Denoiser, x: np.ndarray, alpha: np.ndarray, *, draws: int,
              rng: np.random.Generator, condition: np.ndarray | None = None) -> np.ndarray:
    """Mean squared epsilon error at each grid point, summed over dimensions."""
    from modules.coherence.diffusion.sampler import noisy_channel

    out = np.empty(alpha.size, dtype=np.float64)
    for index, value in enumerate(alpha):
        repeated = np.repeat(x, draws, axis=0)
        stamps = np.full(repeated.shape[0], float(value))
        eps = rng.standard_normal(repeated.shape)
        z = noisy_channel(repeated, stamps, eps)
        cond = None if condition is None else np.repeat(condition, draws, axis=0)
        out[index] = float(np.mean(np.sum((eps - denoiser(z, stamps, cond)) ** 2, axis=1)))
    return out


def nll_nats(curve: np.ndarray, reference_mmse: np.ndarray, entropy_nats: float,
             weights: np.ndarray) -> float:
    """`-log p(x)` against the matched Gaussian, with the clamp that is the ensemble.

    The gap is clamped at zero because the estimate is a bound and the Gaussian
    is one of the models it is bounded by: where the learned denoiser is worse
    than the closed form, the closed form is used. That is not a patch over a
    bad fit, it is what the ensemble means, and it is why a strict
    "must beat the Gaussian everywhere" gate contradicts the method.
    """
    gap = np.maximum(reference_mmse - curve, 0.0)
    return float(entropy_nats - 0.5 * np.mean(weights * gap))


def pointwise_information(
    denoiser: Denoiser,
    x: np.ndarray,
    alpha: np.ndarray,
    weights: np.ndarray,
    *,
    condition: np.ndarray | None,
    null_condition: np.ndarray | None = None,
    draws: int,
    rng: np.random.Generator,
    paired: bool = True,
) -> InformationSpectrum:
    """The density over resolution, its integral, and the per-dimension split."""
    from modules.coherence.diffusion.sampler import noisy_channel

    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    rows, dim = x.shape
    density = np.empty(alpha.size, dtype=np.float64)
    stderr = np.empty(alpha.size, dtype=np.float64)
    per_dimension = np.zeros(dim, dtype=np.float64)

    for index, value in enumerate(alpha):
        repeated = np.repeat(x, draws, axis=0)
        stamps = np.full(repeated.shape[0], float(value))
        eps = rng.standard_normal(repeated.shape)
        z = noisy_channel(repeated, stamps, eps)
        with_condition = denoiser(z, stamps, _tile(condition, rows, draws))
        if paired:
            without = denoiser(z, stamps, _tile(null_condition, rows, draws))
        else:
            other_eps = rng.standard_normal(repeated.shape)
            other_z = noisy_channel(repeated, stamps, other_eps)
            without = denoiser(other_z, stamps, _tile(null_condition, rows, draws))
        squared = (with_condition - without) ** 2
        per_sample = np.sum(squared, axis=1)
        density[index] = 0.5 * float(np.mean(per_sample))
        stderr[index] = 0.5 * float(np.std(per_sample, ddof=1) / np.sqrt(per_sample.size))
        per_dimension += 0.5 * weights[index] * np.mean(squared, axis=0) / alpha.size

    total = float(np.mean(weights * density))
    total_stderr = float(np.sqrt(np.mean((weights * stderr) ** 2) / alpha.size))
    return InformationSpectrum(
        alpha=alpha, density=density, density_stderr=stderr, per_dimension=per_dimension,
        total_nats=total, total_stderr=total_stderr, draws=draws, paired=paired,
    )


def _tile(condition: np.ndarray | None, rows: int, draws: int) -> np.ndarray | None:
    if condition is None:
        return None
    condition = np.atleast_2d(np.asarray(condition, dtype=np.float64))
    if condition.shape[0] == 1 and rows > 1:
        condition = np.repeat(condition, rows, axis=0)
    return np.repeat(condition, draws, axis=0)


def spectrum_moments(spectrum: InformationSpectrum, *, floor_nats: float,
                     fine_threshold: float) -> SpectrumMoments:
    """Where the mass sits, or a refusal when there is no mass to speak of.

    `floor_nats` comes from a shuffled null, not from the standard error. The
    estimator is a squared difference and is therefore positive under the null;
    an interval around its mean says nothing about how far that mean is from
    zero in expectation.
    """
    mass = spectrum.density * np.mean(np.diff(spectrum.alpha)) if spectrum.alpha.size > 1 else None
    if mass is None:
        return SpectrumMoments("too_few_points", reason="a spectrum needs more than one grid point")
    if spectrum.total_nats <= floor_nats:
        return SpectrumMoments(
            "no_information",
            reason=(f"{spectrum.total_nats:.4g} nats is at or below the shuffled floor of "
                    f"{floor_nats:.4g}; a centroid of nothing is not a resolution"),
        )
    weight = np.maximum(spectrum.density, 0.0)
    if not np.any(weight > 0):
        return SpectrumMoments("no_information", reason="the density is zero everywhere")
    centroid = float(np.sum(spectrum.alpha * weight) / np.sum(weight))
    cumulative = np.cumsum(weight) / np.sum(weight)
    quantile = {
        level: float(np.interp(level, cumulative, spectrum.alpha)) for level in (0.25, 0.5, 0.75)
    }
    above = float(np.sum(weight[spectrum.alpha > fine_threshold]) / np.sum(weight))
    return SpectrumMoments("ok", centroid=centroid, q25=quantile[0.25], q50=quantile[0.5],
                           q75=quantile[0.75], fine_fraction=above)
