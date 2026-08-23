"""Fitting the instrument to a panel, and scoring one event with it.

The fit is one object — a PCA basis, a Gaussian reference over the body latents
and a conditional reference given the headline latents — and it is FROZEN. Two
events scored through two different bases are not comparable, and the whole
claim this module makes is cross-sectional, so a version is fitted once, keyed
by its as-of date, and every feature records which version produced it.

WHAT IS BEING ASKED. For each announcement there are two documents that were
both public at the same instant: the opening sentences, which is what a
headline scraper carries, and the full statement, which is what a person reads.
The instrument measures at what RESOLUTION the first explains the second — the
centroid of the information density over log-SNR. High centroid means the
headline pins the body down to its fine detail and there is little left for a
slow reader; low centroid means the headline conveys the gist and the detail is
elsewhere.

Nothing here conditions on the price. The features are computable at the moment
the text appears, which is the difference between a research artefact and
something a desk could act on.

THE FLOOR COMES FROM A SHUFFLE, NOT FROM A STANDARD ERROR. The estimator is a
squared difference between two imperfect denoisers, so it is positive even when
the conditioning carries nothing at all. An interval around that positive mean
says how precisely the bias was measured, not how far it is from zero. So the
fit also scores a shuffled panel — each body paired with somebody else's
headline — and the floor is a high quantile of that null.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from modules.coherence.diffusion.estimator import (
    pointwise_information,
    spectrum_moments,
)
from modules.coherence.diffusion.gaussian import (
    ConditionalModel,
    GaussianRef,
    Refusal,
    conditional_model,
    gaussian_information,
    gaussian_reference,
    loc_scale_from_spectrum,
    oracle_denoiser,
)
from modules.coherence.diffusion.latent import LatentRefusal, PcaBasis, effective_rank, fit_pca
from modules.coherence.diffusion.sampler import logistic_grid


@dataclass(frozen=True)
class SpectrumFit:
    """A frozen instrument: the basis, the two references, and the null floor."""

    basis: PcaBasis
    unconditional: GaussianRef
    conditional: ConditionalModel
    alpha: np.ndarray
    weights: np.ndarray
    logsnr_loc: float
    logsnr_scale: float
    logsnr_clip: float
    events_fitted: int
    latent_dim: int
    effective_rank: float
    panel_information_nats: float
    floor_nats: float
    shuffled_median_nats: float
    whitened: bool = True
    params_version: str = ""

    @property
    def fine_threshold(self) -> float:
        """Where `fine` starts: the sampler's own centre, frozen with the fit.

        Not the panel median of the scored events — that would make one event's
        feature depend on the others scored beside it, which is a look-ahead
        the whole point-in-time discipline exists to prevent.
        """
        return self.logsnr_loc


@dataclass(frozen=True)
class FitRefusal:
    reason: str
    events: int = 0
    latent_dim: int = 0


@dataclass(frozen=True)
class EventSpectrum:
    """One event's reading, or the reason there is not one."""

    source_ref: str
    state: str
    total_nats: float | None = None
    total_stderr: float | None = None
    alpha_centroid: float | None = None
    q25: float | None = None
    q50: float | None = None
    q75: float | None = None
    fine_fraction: float | None = None
    per_dimension: list[float] = field(default_factory=list)
    density: list[float] = field(default_factory=list)
    reason: str | None = None


def _denoiser(fit_conditional, marginal):
    def denoise(z, alpha, cond):
        return fit_conditional(z, alpha, cond) if cond is not None else marginal(z, alpha)

    return denoise


def fit_spectrum(
    body: np.ndarray,
    headline: np.ndarray,
    *,
    latent_dim: int,
    whiten: bool = True,
    clip: float = 4.0,
    points: int = 80,
    draws: int = 6,
    seed: int = 7,
    shuffles: int = 24,
    floor_quantile: float = 0.95,
) -> SpectrumFit | FitRefusal:
    """Fit the basis, the references and the null floor over a whole panel."""
    body = np.atleast_2d(np.asarray(body, dtype=np.float64))
    headline = np.atleast_2d(np.asarray(headline, dtype=np.float64))
    if body.shape[0] != headline.shape[0]:
        return FitRefusal("the two document sets have different lengths", body.shape[0], latent_dim)

    # Fitted on both channels so they share a space; whitened by the TARGET's
    # own spread so the target is exactly unit-variance in it. Whitening by the
    # stack instead leaves the target only approximately unit-variance, which
    # is how an effective rank of 9.9 turns into 5.6.
    basis = fit_pca(np.vstack([body, headline]), latent_dim, whiten=whiten, scale_rows=body)
    if isinstance(basis, LatentRefusal):
        return FitRefusal(basis.reason, body.shape[0], latent_dim)
    body_latent = basis.project(body)
    headline_latent = basis.project(headline)

    unconditional = gaussian_reference(body_latent)
    if isinstance(unconditional, Refusal):
        return FitRefusal(unconditional.reason, body.shape[0], latent_dim)
    conditional = conditional_model(body_latent, headline_latent)
    if isinstance(conditional, Refusal):
        return FitRefusal(conditional.reason, body.shape[0], latent_dim)

    loc, scale = loc_scale_from_spectrum(unconditional.log_eigs)
    alpha, weights = logistic_grid(points, loc, scale, clip)
    rng = np.random.default_rng(seed)

    shuffled = _shuffled_floor(body_latent, headline_latent, alpha, weights,
                               draws=draws, rng=rng, rounds=shuffles)
    floor = float(np.quantile(shuffled, floor_quantile)) if shuffled.size else 0.0

    return SpectrumFit(
        basis=basis, unconditional=unconditional, conditional=conditional,
        alpha=alpha, weights=weights, logsnr_loc=loc, logsnr_scale=scale, logsnr_clip=clip,
        events_fitted=body.shape[0], latent_dim=latent_dim,
        effective_rank=effective_rank(basis.explained_variance), whitened=bool(whiten),
        panel_information_nats=gaussian_information(unconditional, conditional.reference),
        floor_nats=floor,
        shuffled_median_nats=float(np.median(shuffled)) if shuffled.size else 0.0,
    )


def _shuffled_floor(body_latent: np.ndarray, headline_latent: np.ndarray, alpha: np.ndarray,
                    weights: np.ndarray, *, draws: int, rng: np.random.Generator,
                    rounds: int) -> np.ndarray:
    """What the estimator reads when the pairing carries nothing.

    Each round pairs every body with somebody else's headline and scores one
    event through the resulting instrument. The distribution of those readings
    is the null; a real reading has to clear its upper tail.
    """
    values: list[float] = []
    rows = body_latent.shape[0]
    if rows < 4:
        return np.asarray(values, dtype=np.float64)
    for _ in range(rounds):
        order = rng.permutation(rows)
        if np.any(order == np.arange(rows)):
            order = np.roll(order, 1)
        shuffled_model = conditional_model(body_latent, headline_latent[order])
        if isinstance(shuffled_model, Refusal):
            continue
        conditional_denoise = shuffled_model.denoiser()
        marginal = oracle_denoiser(gaussian_reference(body_latent))
        pick = int(rng.integers(rows))
        spectrum = pointwise_information(
            _denoiser(conditional_denoise, marginal), body_latent[pick:pick + 1], alpha, weights,
            condition=headline_latent[order][pick:pick + 1], null_condition=None,
            draws=draws, rng=rng,
        )
        values.append(spectrum.total_nats)
    return np.asarray(values, dtype=np.float64)


def score_event(fit: SpectrumFit, source_ref: str, body: np.ndarray, headline: np.ndarray, *,
                draws: int = 12, seed: int = 11) -> EventSpectrum:
    """One event through the frozen instrument."""
    body_latent = fit.basis.project(np.atleast_2d(body))
    headline_latent = fit.basis.project(np.atleast_2d(headline))
    # The FROZEN conditional, applied to this event's own headline. Nothing is
    # refitted here: the regression and the residual covariance come from the
    # panel, and only the condition is the event's.
    spectrum = pointwise_information(
        _denoiser(fit.conditional.denoiser(), oracle_denoiser(fit.unconditional)), body_latent,
        fit.alpha, fit.weights, condition=headline_latent, null_condition=None,
        draws=draws, rng=np.random.default_rng(seed),
    )
    moments = spectrum_moments(spectrum, floor_nats=fit.floor_nats,
                               fine_threshold=fit.fine_threshold)
    if moments.state != "ok":
        return EventSpectrum(source_ref, moments.state, total_nats=spectrum.total_nats,
                             total_stderr=spectrum.total_stderr,
                             density=[float(value) for value in spectrum.density],
                             reason=moments.reason)
    return EventSpectrum(
        source_ref, "ok", total_nats=spectrum.total_nats, total_stderr=spectrum.total_stderr,
        alpha_centroid=moments.centroid, q25=moments.q25, q50=moments.q50, q75=moments.q75,
        fine_fraction=moments.fine_fraction,
        per_dimension=[float(value) for value in spectrum.per_dimension],
        density=[float(value) for value in spectrum.density],
    )


def summarise(fit: SpectrumFit) -> dict[str, Any]:
    return {
        "events_fitted": fit.events_fitted, "latent_dim": fit.latent_dim,
        "effective_rank": fit.effective_rank,
        "effective_rank_index": round(10.0 * fit.effective_rank / max(fit.latent_dim, 1), 2),
        "whitened": fit.whitened,
        "logsnr_loc": fit.logsnr_loc, "logsnr_scale": fit.logsnr_scale,
        "logsnr_clip": fit.logsnr_clip,
        "panel_information_nats": fit.panel_information_nats,
        "floor_nats": fit.floor_nats, "shuffled_median_nats": fit.shuffled_median_nats,
        "basis_digest": fit.basis.digest(),
    }


def centroid_spread(centroids: list[float], fit: SpectrumFit) -> dict[str, float | None]:
    """How far the readings spread across the resolution axis.

    A feature whose values all sit within a hundredth of each other cannot
    predict anything, however well estimated each one is, and that failure
    looks exactly like a true null in a regression. So the spread is reported
    beside every result, in units of the sampler's own scale — which is the
    only unit that makes it comparable between two fits with different grids.

    The index is on the same nought-to-ten scale as the effective rank: ten
    means the readings span the sampler's scale or more.
    """
    values = [value for value in centroids if value is not None]
    if len(values) < 2:
        return {"span": None, "sd": None, "span_over_scale": None, "index": None}
    span = float(max(values) - min(values))
    ratio = span / fit.logsnr_scale if fit.logsnr_scale else None
    return {
        "span": span,
        "sd": float(np.std(values, ddof=1)),
        "span_over_scale": ratio,
        "index": None if ratio is None else round(min(10.0, 10.0 * ratio), 2),
    }
