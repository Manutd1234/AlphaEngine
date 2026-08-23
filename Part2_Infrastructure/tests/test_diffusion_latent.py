"""The latent keeps the variance spectrum, because the spectrum IS the axis.

The instrument reads a density over log-SNR, and where a direction sits on that
axis is set by its variance: a high-variance direction is resolved under heavy
noise, a low-variance one only when the noise is nearly gone. Whitening — the
reflex, and what most downstream code wants — sends every log-eigenvalue to
zero and collapses the whole spectrum to one bump at the origin. Every event
would then have the same centroid and the measurement would be gone.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.coherence.diffusion.latent import (
    LatentRefusal,
    effective_rank,
    fingerprint,
    fit_pca,
    participation_ratio,
)


def _embeddings(rows: int = 600, dim: int = 64, *, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    scale = np.geomspace(4.0, 0.05, dim)
    return rng.standard_normal((rows, dim)) * scale + 3.0


class TestTheProjectionIsNotWhitened:
    def test_the_explained_variances_are_not_all_one(self):
        basis = fit_pca(_embeddings(), 16)
        assert not isinstance(basis, LatentRefusal)
        spread = basis.explained_variance.max() / basis.explained_variance.min()
        # Whitening makes this exactly 1.0 and every event's centroid identical.
        # Measured on this construction it is about 8.9; the floor is set well
        # below that so the test fails on a flattening rather than on a tweak
        # to the fixture's spectrum.
        assert spread > 4.0, "the spectrum was flattened; the resolution axis is gone"

    def test_the_projection_preserves_the_scale_of_each_direction(self):
        basis = fit_pca(_embeddings(), 16)
        projected = basis.project(_embeddings())
        measured = projected.var(axis=0, ddof=1)
        assert np.allclose(measured, basis.explained_variance, rtol=0.05)

    def test_the_components_are_ordered_by_how_much_they_carry(self):
        basis = fit_pca(_embeddings(), 12)
        assert list(basis.explained_variance) == sorted(basis.explained_variance, reverse=True)

    def test_the_mean_is_removed_so_the_latent_is_centred(self):
        basis = fit_pca(_embeddings(), 8)
        projected = basis.project(_embeddings())
        assert np.allclose(projected.mean(axis=0), 0.0, atol=1e-8)


class TestItRefusesRatherThanFittingNoise:
    def test_too_few_rows_for_the_width_is_a_refusal_with_the_count(self):
        refusal = fit_pca(_embeddings(rows=20), 32)
        assert isinstance(refusal, LatentRefusal)
        assert "20 embeddings" in refusal.reason

    def test_a_projection_wider_than_the_source_is_refused(self):
        refusal = fit_pca(_embeddings(dim=16), 32)
        assert isinstance(refusal, LatentRefusal)
        assert "cannot project" in refusal.reason


class TestTheSpreadMeasuresSayWhenALatentHasCollapsed:
    def test_a_flat_spectrum_has_the_effective_rank_of_its_width(self):
        assert effective_rank(np.ones(16)) == pytest.approx(16.0)

    def test_a_rank_three_spectrum_reports_about_three(self):
        assert effective_rank(np.array([1.0, 1.0, 1.0] + [0.0] * 29)) == pytest.approx(3.0)

    def test_a_collapsed_spectrum_reports_close_to_one(self):
        assert effective_rank(np.array([100.0] + [1e-6] * 31)) < 1.05

    def test_nothing_positive_is_zero_rather_than_a_division(self):
        assert effective_rank(np.zeros(8)) == 0.0
        assert participation_ratio(np.zeros(8)) == 0.0


class TestTheFingerprintDependsOnTheDataItSaw:
    def test_two_different_sets_do_not_share_a_digest(self):
        first = fingerprint([("a", "1111"), ("b", "2222")])
        second = fingerprint([("a", "1111"), ("b", "3333")])
        assert first != second

    def test_order_does_not_change_it(self):
        assert fingerprint([("a", "1"), ("b", "2")]) == fingerprint([("b", "2"), ("a", "1")])

    def test_the_same_set_twice_is_the_same_digest(self):
        pairs = [("fed:2019-01-30", "abc"), ("fed:2019-03-20", "def")]
        assert fingerprint(pairs) == fingerprint(list(pairs))

    def test_the_basis_digest_moves_with_the_basis(self):
        first = fit_pca(_embeddings(seed=1), 8)
        second = fit_pca(_embeddings(seed=2), 8)
        assert first.digest() != second.digest()
