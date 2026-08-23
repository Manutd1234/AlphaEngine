"""The Gaussian everything else is measured against.

Three jobs, and the third is the one that makes the module shippable without
torch.

**The null.** A model that cannot beat a Gaussian fitted to the same covariance
has learned nothing, and the Gaussian's denoising error is closed form:
`mmse(alpha) = sum_i sigmoid(alpha + log lambda_i)` over the data's eigenvalues.
That curve is the automated gate, computed rather than eyeballed.

**The reference for the density.** Integrating the raw error over log-SNR
diverges at both ends; integrating the DIFFERENCE against a matched Gaussian
converges, which is the whole trick of the information-theoretic formulation.
`h_g` is that Gaussian's entropy and the density is a correction to it.

**A closed-form information spectrum.** For jointly Gaussian `(x, c)` the
pointwise information has an exact integrand,

    g(alpha) = 1/2 sum_i [ sigmoid(alpha + log lambda_i) - sigmoid(alpha + log mu_i) ]

with `lambda` the unconditional and `mu` the conditional eigenvalues, and

    integral g d(alpha) = 1/2 sum_i (log lambda_i - log mu_i) = I(x; c).

That identity is the known answer the estimator is tested against, and it is
also a real feature: the spectrum's centroid can be computed for every event
with no network, no training and no torch, so the instrument ships before the
model does. The oracle denoisers below are what turn it from a formula into
something `pointwise_information` can be handed, so the SAME code path produces
the Gaussian and the learned number.

THE LATENT IS NOT WHITENED, anywhere, and this is the sharpest thing in the
file. Whitening sends every `log lambda_i` to zero, which collapses the
spectrum to a single bump at `alpha = 0` and destroys the resolution axis the
whole instrument reads. A whitened latent is the natural thing to reach for and
it deletes the measurement.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from modules.coherence.diffusion.sampler import sigmoid

#: Below this many samples per dimension the covariance is not estimated.
MIN_SAMPLES_PER_DIM = 2.0


@dataclass(frozen=True)
class GaussianRef:
    """A matched Gaussian: its mean, its spectrum, and its entropy."""

    mean: np.ndarray
    covariance: np.ndarray
    log_eigs: np.ndarray
    samples: int

    @property
    def dim(self) -> int:
        return int(self.mean.size)

    @property
    def entropy_nats(self) -> float:
        """`h = d/2 log(2 pi e) + 1/2 sum log lambda_i`."""
        return float(0.5 * self.dim * np.log(2.0 * np.pi * np.e) + 0.5 * np.sum(self.log_eigs))

    def mmse(self, alpha: np.ndarray) -> np.ndarray:
        """Bayes-optimal squared error at each log-SNR, summed over dimensions."""
        return np.sum(sigmoid(alpha[:, None] + self.log_eigs[None, :]), axis=1)


@dataclass(frozen=True)
class Refusal:
    """Not enough data to fit a covariance, and how much was short."""

    reason: str
    samples: int
    dim: int


def gaussian_reference(x: np.ndarray, *, floor: float = MIN_SAMPLES_PER_DIM) -> GaussianRef | Refusal:
    """Fit the matched Gaussian, or refuse and say by how much.

    Refusing matters: with fewer samples than dimensions the covariance is
    singular, `log lambda` runs to negative infinity and the entropy comes back
    as a large negative number that looks like a confident answer.
    """
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    samples, dim = x.shape
    if samples < floor * dim:
        return Refusal(
            reason=f"{samples} samples for {dim} dimensions is below {floor:g} per dimension",
            samples=samples, dim=dim,
        )
    mean = x.mean(axis=0)
    centred = x - mean
    covariance = centred.T @ centred / (samples - 1)
    eigenvalues = np.linalg.eigvalsh(covariance)
    floor_value = max(float(np.max(eigenvalues)) * 1e-12, 1e-300)
    return GaussianRef(mean=mean, covariance=covariance,
                       log_eigs=np.log(np.maximum(eigenvalues, floor_value)), samples=samples)


def conditional_reference(x: np.ndarray, condition: np.ndarray,
                          *, floor: float = MIN_SAMPLES_PER_DIM) -> GaussianRef | Refusal:
    """The Gaussian of `x` given `c`, by the Schur complement.

    Homoscedastic, as a Gaussian conditional always is: the covariance does not
    depend on the value of `c`. The per-event variation therefore has to come
    from the oracle DENOISER, which does see `c` — which is why this returns a
    reference rather than a feature.
    """
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    condition = np.atleast_2d(np.asarray(condition, dtype=np.float64))
    joint = gaussian_reference(np.hstack([x, condition]), floor=floor)
    if isinstance(joint, Refusal):
        return joint
    dim = x.shape[1]
    sigma_xx = joint.covariance[:dim, :dim]
    sigma_xc = joint.covariance[:dim, dim:]
    sigma_cc = joint.covariance[dim:, dim:]
    solved = np.linalg.solve(sigma_cc + np.eye(sigma_cc.shape[0]) * 1e-12, sigma_xc.T)
    residual = sigma_xx - sigma_xc @ solved
    eigenvalues = np.linalg.eigvalsh((residual + residual.T) / 2.0)
    floor_value = max(float(np.max(eigenvalues)) * 1e-12, 1e-300)
    return GaussianRef(mean=joint.mean[:dim], covariance=residual,
                       log_eigs=np.log(np.maximum(eigenvalues, floor_value)), samples=joint.samples)


def gaussian_spectrum(alpha: np.ndarray, unconditional: GaussianRef,
                      conditional: GaussianRef) -> np.ndarray:
    """`g(alpha)`, the information density over resolution."""
    return 0.5 * (unconditional.mmse(alpha) - conditional.mmse(alpha))


def gaussian_information(unconditional: GaussianRef, conditional: GaussianRef) -> float:
    """`I(x;c)` in nats, by the exact integral of the spectrum."""
    return float(0.5 * (np.sum(unconditional.log_eigs) - np.sum(conditional.log_eigs)))


def loc_scale_from_spectrum(log_eigs: np.ndarray, *, constant: float = 3.0 / np.pi**2
                            ) -> tuple[float, float]:
    """Where to centre the sampler, from the data's own spectrum.

    `loc = -mean(log lambda)` puts the density where the error curve turns over.
    The paper derives `scale = sqrt(1 + 3/pi^2 var(log lambda))`; the reference
    implementation ships `3/pi`, which is roughly 1.6 times wider. Both are
    defensible starting points and neither survives the re-fit against the
    measured error curve, but the one that was frozen has to be recorded, so
    the constant is an argument rather than a literal.
    """
    log_eigs = np.asarray(log_eigs, dtype=np.float64)
    return float(-np.mean(log_eigs)), float(np.sqrt(1.0 + constant * np.var(log_eigs)))


def conditional_oracle(x: np.ndarray, condition: np.ndarray, *, floor: float = MIN_SAMPLES_PER_DIM):
    """A denoiser that uses the row's OWN condition, and the reference behind it.

    `conditional_reference` returns a homoscedastic covariance, which is all a
    Gaussian conditional has — but the conditional MEAN moves with `c`, and
    that mean shift carries most of the information. A denoiser built from the
    conditional covariance and the MARGINAL mean therefore recovers only the
    variance-reduction part and understates `i(x;c)` badly: measured on a
    jointly Gaussian construction with an analytic answer of 0.53 nats, it came
    back 0.40.

    So this returns a closure over the regression `E[x|c] = m_x + A (c - m_c)`
    and evaluates it per row. It is what makes the Gaussian engine a per-EVENT
    feature: the returned function is a function of the event's own condition.
    """
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    condition = np.atleast_2d(np.asarray(condition, dtype=np.float64))
    joint = gaussian_reference(np.hstack([x, condition]), floor=floor)
    if isinstance(joint, Refusal):
        return None, joint
    dim = x.shape[1]
    sigma_xx = joint.covariance[:dim, :dim]
    sigma_xc = joint.covariance[:dim, dim:]
    sigma_cc = joint.covariance[dim:, dim:]
    regression = np.linalg.solve(
        sigma_cc + np.eye(sigma_cc.shape[0]) * 1e-12, sigma_xc.T
    ).T
    residual = sigma_xx - regression @ sigma_xc.T
    residual = (residual + residual.T) / 2.0
    eigenvalues = np.linalg.eigvalsh(residual)
    floor_value = max(float(np.max(eigenvalues)) * 1e-12, 1e-300)
    reference = GaussianRef(mean=joint.mean[:dim], covariance=residual,
                            log_eigs=np.log(np.maximum(eigenvalues, floor_value)),
                            samples=joint.samples)
    mean_x, mean_c = joint.mean[:dim], joint.mean[dim:]
    eigen, basis = np.linalg.eigh(residual)
    eigen = np.maximum(eigen, 0.0)

    def denoise(z: np.ndarray, alpha: np.ndarray, cond: np.ndarray | None = None) -> np.ndarray:
        share = np.atleast_1d(sigmoid(np.asarray(alpha, dtype=np.float64)))
        if share.size == 1 and z.shape[0] > 1:
            share = np.repeat(share, z.shape[0])
        signal = share[:, None]
        root = np.sqrt(signal)
        noise = 1.0 - signal
        if cond is None:
            centre = np.broadcast_to(mean_x, z.shape)
        else:
            centre = mean_x + (np.atleast_2d(cond) - mean_c) @ regression.T
        rotated = (z - root * centre) @ basis
        gain = eigen[None, :] / (signal * eigen[None, :] + noise)
        x_hat = centre + (root * gain * rotated) @ basis.T
        return (z - root * x_hat) / np.sqrt(noise)

    return denoise, reference


def oracle_denoiser(reference: GaussianRef):
    """The Bayes-optimal epsilon predictor for this Gaussian.

    Given `z = sqrt(s) x + sqrt(1-s) eps` with `x ~ N(m, S)`, the posterior mean
    of `x` is available in closed form and `eps_hat` follows from it. Handing
    this to `pointwise_information` is what makes the Gaussian engine a real
    per-event feature rather than a panel constant: the returned function is a
    function of `z`, and `z` carries the event.
    """
    mean = reference.mean
    eigenvalues, basis = np.linalg.eigh(reference.covariance)
    eigenvalues = np.maximum(eigenvalues, 0.0)

    def denoise(z: np.ndarray, alpha: np.ndarray, _cond: np.ndarray | None = None) -> np.ndarray:
        # Solved in the covariance's own eigenbasis so the whole batch is three
        # matrix products rather than one linear solve per row: the posterior
        # mean is m + sqrt(s) U diag(l / (s l + 1 - s)) U^T (z - sqrt(s) m).
        share = np.atleast_1d(sigmoid(np.asarray(alpha, dtype=np.float64)))
        if share.size == 1 and z.shape[0] > 1:
            share = np.repeat(share, z.shape[0])
        signal = share[:, None]
        root = np.sqrt(signal)
        noise = 1.0 - signal
        rotated = (z - root * mean) @ basis
        gain = eigenvalues[None, :] / (signal * eigenvalues[None, :] + noise)
        x_hat = mean + (root * gain * rotated) @ basis.T
        return (z - root * x_hat) / np.sqrt(noise)

    return denoise
