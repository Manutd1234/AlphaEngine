"""Text embeddings down to a latent the estimator can work in — unwhitened.

384 dimensions of sentence embedding is too many to fit a covariance to from a
few hundred announcements, so the estimator works in a projection. The
projection is a plain principal-components rotation with the components kept at
their own scale.

NOT WHITENED, and this is the load-bearing decision in the file. Whitening is
the reflex — it is what makes a covariance well-conditioned and what most
downstream code wants — and here it destroys the measurement. The instrument
reads a density over log-SNR, and where a direction sits on that axis is set by
`-log lambda_i`: a high-variance direction is resolved under heavy noise and a
low-variance one only when the noise is nearly gone. Whitening sets every
`log lambda_i` to zero, which collapses the spectrum to one bump at the origin
and makes every event's centroid identical. The resolution axis IS the variance
spectrum.

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

    @property
    def dim(self) -> int:
        return int(self.components.shape[0])

    def digest(self) -> str:
        stamp = sha256()
        stamp.update(f"{self.source_dim}->{self.dim}|{self.fitted_on}".encode())
        stamp.update(np.ascontiguousarray(self.mean, dtype=np.float64).tobytes())
        stamp.update(np.ascontiguousarray(self.components, dtype=np.float64).tobytes())
        return stamp.hexdigest()

    def project(self, embeddings: np.ndarray) -> np.ndarray:
        """Rotate into the basis. Scale is preserved; nothing is divided out."""
        rows = np.atleast_2d(np.asarray(embeddings, dtype=np.float64))
        return (rows - self.mean) @ self.components.T


@dataclass(frozen=True)
class LatentRefusal:
    reason: str
    fitted_on: int
    dim: int


def fit_pca(embeddings: np.ndarray, dim: int, *, min_rows_per_dim: float = 2.0
            ) -> PcaBasis | LatentRefusal:
    """Fit the projection, or refuse with the count that was short."""
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
    return PcaBasis(mean=mean, components=right[:dim], explained_variance=variance[:dim],
                    fitted_on=count, source_dim=source_dim)


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
