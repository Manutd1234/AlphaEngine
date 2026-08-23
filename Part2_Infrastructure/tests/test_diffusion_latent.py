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


class TestWhiteningIsTheDefaultAndTheReasonIsMeasured:
    """This file used to refuse whitening, and the refusal was wrong.

    The argument was that a direction's place on the log-SNR axis is set by
    its log-eigenvalue, so flattening the spectrum must collapse the
    measurement. The premise is right and the conclusion does not follow: the
    information density is a DIFFERENCE between the unconditional and
    conditional spectra, and whitening moves only the first of them. The
    density keeps its width and its meaning improves — resolution stops
    meaning "how much variance this direction has" and starts meaning "how
    strongly the condition explains it".
    """

    def test_whitening_makes_the_target_exactly_unit_variance(self):
        rows = _embeddings()
        basis = fit_pca(rows, 16, whiten=True)
        assert basis.whitened
        assert np.allclose(basis.project(rows).var(axis=0, ddof=1), 1.0, rtol=1e-6)

    def test_that_is_what_takes_the_effective_rank_to_its_ceiling(self):
        rows = _embeddings()
        raw = fit_pca(rows, 16, whiten=False)
        white = fit_pca(rows, 16, whiten=True)
        # The ceiling is the dimension itself, and only whitening reaches it.
        # Asserted as a relation rather than against a fixed number, because
        # how far short the raw basis falls is a property of the fixture; on
        # the real statement embeddings it is 5.5 of 10.
        assert effective_rank(white.explained_variance) == pytest.approx(16.0, abs=0.01)
        assert effective_rank(raw.explained_variance) < effective_rank(white.explained_variance)

    def test_the_divisor_is_taken_from_the_target_not_the_stack(self):
        """Two channels share a basis; only one of them is being whitened.

        Whitening by the stacked spread leaves the target only approximately
        unit-variance, which is how an effective rank of 9.9 became 5.6.
        """
        rng = np.random.default_rng(2)
        target = _embeddings(seed=1)
        other = _embeddings(seed=2) * 3.0 + rng.standard_normal((600, 64))
        stacked = fit_pca(np.vstack([target, other]), 12, whiten=True)
        aimed = fit_pca(np.vstack([target, other]), 12, whiten=True, scale_rows=target)
        assert effective_rank(aimed.project(target).var(axis=0, ddof=1)) > \
               effective_rank(stacked.project(target).var(axis=0, ddof=1))

    def test_the_divisor_is_frozen_rather_than_recomputed_per_batch(self):
        rows = _embeddings()
        basis = fit_pca(rows, 8, whiten=True)
        half = basis.project(rows[:50])
        # A basis that re-whitened on what it was handed would send any batch
        # to unit variance; this one must not, or an event's coordinates would
        # depend on the events scored beside it.
        assert not np.allclose(half.var(axis=0, ddof=1), 1.0, rtol=1e-3)

    def test_unwhitened_still_works_and_keeps_its_ordering(self):
        basis = fit_pca(_embeddings(), 12, whiten=False)
        assert not basis.whitened
        assert list(basis.explained_variance) == sorted(basis.explained_variance, reverse=True)

    def test_the_mean_is_removed_either_way(self):
        for whiten in (False, True):
            basis = fit_pca(_embeddings(), 8, whiten=whiten)
            assert np.allclose(basis.project(_embeddings()).mean(axis=0), 0.0, atol=1e-8)


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
