"""Text embeddings down to a latent the estimator can work in.

384 dimensions of sentence embedding is too many to fit a covariance to from a
few dozen announcements, so the estimator works in a projection.

WHITENING: THIS FILE PREVIOUSLY REFUSED IT, AND THAT WAS WRONG. The argument
was that the instrument reads a density over log-SNR, that a direction's place
on that axis is set by `-log lambda_i`, and that setting every eigenvalue to one
therefore collapses the spectrum to a single bump. The first two clauses are
right and the conclusion does not follow, which a measurement settled: the
information density is

    g(alpha) = 1/2 sum_i [ sigmoid(alpha + log lambda_i) - sigmoid(alpha + log mu_i) ]

— a DIFFERENCE between the unconditional and conditional spectra. Whitening
sends `log lambda_i` to zero and leaves `log mu_i` alone, so the density keeps
its width and its meaning changes for the better: resolution stops meaning "how
much variance this direction has" and starts meaning "how strongly the
condition explains it", which is the question being asked. On a construction
with an 898x eigenvalue spread the whitened spectrum's inter-quartile width was
2.18 against the raw 2.42 — the same shape — while the effective rank went from
2.89 of 8 to 8.00 of 8.

That rank is not cosmetic. Sentence embeddings of one issuer's statements are
dominated by two directions; unwhitened, an effective rank of 5.5 out of 10
means half the latent is doing nothing and the covariance the estimator inverts
is badly conditioned. Whitened it is 9.9 out of 10.

Whitening is therefore the default and the option exists to turn it off, with
the caveat that off is the setting that was measured to be worse.

The basis is fitted once per version, frozen, and keyed by as-of date, because
two events projected through two different bases are not comparable and the
whole cross-sectional claim rests on their being comparable.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256

import numpy as np


@dataclass(frozen=True)
class PcaBasis:
    """A frozen projection, with enough provenance to know it is the same one."""

    mean: np.ndarray
    components: np.ndarray
    explained_variance: np.ndarray
    fitted_on: int
    source_dim: int
    #: Per-direction divisor. Ones when the basis is not whitened.
    scale: np.ndarray | None = None

    @property
    def dim(self) -> int:
        return int(self.components.shape[0])

    def digest(self) -> str:
        stamp = sha256()
        stamp.update(f"{self.source_dim}->{self.dim}|{self.fitted_on}".encode())
        stamp.update(np.ascontiguousarray(self.mean, dtype=np.float64).tobytes())
        stamp.update(np.ascontiguousarray(self.components, dtype=np.float64).tobytes())
        return stamp.hexdigest()

    @property
    def whitened(self) -> bool:
        return self.scale is not None

    def project(self, embeddings: np.ndarray) -> np.ndarray:
        """Rotate into the basis, dividing by the frozen per-direction scale.

        The scale is FROZEN with the basis rather than recomputed per batch.
        Dividing by the batch's own spread would make one event's coordinates
        depend on the others scored beside it, which is the look-ahead the
        point-in-time discipline exists to prevent.
        """
        rows = np.atleast_2d(np.asarray(embeddings, dtype=np.float64))
        rotated = (rows - self.mean) @ self.components.T
        return rotated if self.scale is None else rotated / self.scale


@dataclass(frozen=True)
class LatentRefusal:
    reason: str
    fitted_on: int
    dim: int


def fit_pca(embeddings: np.ndarray, dim: int, *, min_rows_per_dim: float = 2.0,
            whiten: bool = True, scale_rows: np.ndarray | None = None
            ) -> PcaBasis | LatentRefusal:
    """Fit the projection, or refuse with the count that was short.

    `scale_rows` is the sample the whitening divisor is taken from. It exists
    because the basis is usually fitted on two channels stacked together — a
    statement and the statement before it — while the thing being whitened is
    the TARGET channel alone. Whitening by the stacked spread leaves the target
    only approximately unit-variance, which is how an effective rank of 9.9
    becomes 5.6.
    """
    rows = np.atleast_2d(np.asarray(embeddings, dtype=np.float64))
    count, source_dim = rows.shape
    if dim < 1 or dim > source_dim:
        return LatentRefusal(f"cannot project {source_dim} dimensions onto {dim}", count, dim)
    if count < min_rows_per_dim * dim:
        return LatentRefusal(
            f"{count} embeddings for a {dim}-dimensional basis is below "
            f"{min_rows_per_dim:g} per dimension", count, dim)
    mean = rows.mean(axis=0)
    centred = rows - mean
    _u, singular, right = np.linalg.svd(centred, full_matrices=False)
    variance = (singular**2) / max(count - 1, 1)
    components = right[:dim]
    scale: np.ndarray | None = None
    if whiten:
        target = np.atleast_2d(np.asarray(scale_rows, dtype=np.float64)) \
            if scale_rows is not None else rows
        projected = (target - mean) @ components.T
        spread = projected.std(axis=0, ddof=1)
        floor = max(float(np.max(spread)) * 1e-9, 1e-300)
        scale = np.maximum(spread, floor)
        variance = (variance[:dim] / scale**2)
    return PcaBasis(mean=mean, components=components,
                    explained_variance=variance[:dim] if not whiten else variance,
                    fitted_on=count, source_dim=source_dim, scale=scale)


def effective_rank(values: np.ndarray) -> float:
    """The spectrum's entropy, exponentiated: how many directions really carry it.

    A latent that has collapsed onto a handful of directions reports an
    effective rank far below its nominal one, and a density estimate over it is
    describing a manifold rather than a distribution.
    """
    values = np.asarray(values, dtype=np.float64)
    positive = values[values > 0]
    if positive.size == 0:
        return 0.0
    share = positive / positive.sum()
    return float(np.exp(-np.sum(share * np.log(share))))


def participation_ratio(values: np.ndarray) -> float:
    """The other spread measure, kept because the two disagree informatively."""
    values = np.asarray(values, dtype=np.float64)
    positive = values[values > 0]
    if positive.size == 0:
        return 0.0
    return float(positive.sum() ** 2 / np.sum(positive**2))


def fingerprint(pairs: list[tuple[str, str]]) -> str:
    """A digest over (event id, embedding digest), sorted.

    Not `dataset_fingerprint`: that one keys off OHLC column names on a frame
    and degenerates to first/last/length on anything without them, so two
    disjoint embedding sets of the same size would share a hash. The provenance
    token for a fit has to depend on the data the fit saw.
    """
    stamp = sha256()
    for identifier, digest in sorted(pairs):
        stamp.update(identifier.encode())
        stamp.update(b"\x00")
        stamp.update(digest.encode())
        stamp.update(b"\n")
    return stamp.hexdigest()
