"""The estimator against answers that are known before it runs.

Every case here has a closed form. That is the point: an information estimate
over a learned model cannot be checked against anything, so the arithmetic
underneath it is checked against Gaussians whose entropy, mutual information
and conditional independence are all exact. If these pass, a later number that
looks wrong is a modelling problem rather than a bug in the integral.

The recurring trap in this subject is the importance weight. The integral is
`mean(w * f)` and not `sum(w * f)`; with a hundred grid points the second is a
hundred times the first and still looks like a plausible number of nats.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from modules.coherence.diffusion.estimator import (
    mse_curve,
    nll_nats,
    pointwise_information,
    spectrum_moments,
)
from modules.coherence.diffusion.gaussian import (
    Refusal,
    conditional_oracle,
    conditional_reference,
    gaussian_information,
    gaussian_reference,
    gaussian_spectrum,
    loc_scale_from_spectrum,
    oracle_denoiser,
)
from modules.coherence.diffusion.sampler import logistic_grid, sigmoid, support

#: The two-dimensional strongly correlated Gaussian whose entropy is 1.22 nats.
SCG_RHO = -0.4950 / 0.5050


def _scg(n: int = 40_000, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    cov = np.array([[1.0, SCG_RHO], [SCG_RHO, 1.0]])
    return rng.multivariate_normal([0.0, 0.0], cov, size=n)


class TestTheSamplerIntegrates:
    def test_the_weights_average_to_the_width_of_the_support(self):
        alpha, weights = logistic_grid(200, 0.0, 2.0, 4.0)
        low, high = support(0.0, 2.0, 4.0)
        assert float(np.mean(weights)) == pytest.approx(high - low, rel=0.01)

    def test_summing_instead_of_averaging_would_be_wrong_by_the_grid_size(self):
        _alpha, weights = logistic_grid(100, 0.0, 2.0, 4.0)
        assert float(np.sum(weights)) == pytest.approx(100 * float(np.mean(weights)))

    def test_the_clip_is_honoured_rather_than_ignored(self):
        narrow, _ = logistic_grid(64, 1.0, 2.0, 3.0)
        wide, _ = logistic_grid(64, 1.0, 2.0, 4.0)
        assert float(narrow.max()) < float(wide.max())
        assert float(narrow.min()) > float(wide.min())

    def test_the_grid_is_inside_its_own_support_and_sorted(self):
        alpha, _ = logistic_grid(50, 1.0, 2.0, 3.0)
        low, high = support(1.0, 2.0, 3.0)
        assert low < float(alpha.min()) and float(alpha.max()) < high
        assert list(alpha) == sorted(alpha)


class TestTheGaussianReferenceIsExact:
    def test_the_entropy_of_the_two_dimensional_case_is_one_and_a_quarter_nats(self):
        reference = gaussian_reference(_scg())
        assert not isinstance(reference, Refusal)
        true = 0.5 * math.log((2 * math.pi * math.e) ** 2 * (1 - SCG_RHO**2))
        assert reference.entropy_nats == pytest.approx(true, abs=0.02)
        assert true == pytest.approx(1.2185, abs=0.001), "the published value for this covariance"

    def test_a_thirty_two_dimensional_analogue_matches_its_closed_form(self):
        rng = np.random.default_rng(3)
        root = rng.standard_normal((32, 32))
        covariance = root @ root.T / 32 + np.eye(32) * 0.5
        sample = rng.multivariate_normal(np.zeros(32), covariance, size=8_000)
        reference = gaussian_reference(sample)
        # Summed log-eigenvalues rather than slogdet: the LAPACK path warns on
        # this build and the eigenvalues are what the reference itself uses.
        logdet = float(np.sum(np.log(np.linalg.eigvalsh(covariance))))
        true = 0.5 * (32 * math.log(2 * math.pi * math.e) + logdet)
        assert reference.entropy_nats == pytest.approx(true, rel=0.02)

    def test_fewer_samples_than_dimensions_is_refused_rather_than_infinite(self):
        rng = np.random.default_rng(1)
        refusal = gaussian_reference(rng.standard_normal((8, 32)))
        assert isinstance(refusal, Refusal)
        assert "per dimension" in refusal.reason

    def test_the_error_curve_runs_from_nothing_to_everything(self):
        reference = gaussian_reference(_scg())
        assert float(reference.mmse(np.array([-40.0]))[0]) == pytest.approx(0.0, abs=1e-6)
        assert float(reference.mmse(np.array([40.0]))[0]) == pytest.approx(2.0, abs=1e-6)


class TestTheSpectrumIntegratesToTheInformation:
    def test_the_closed_form_density_integrates_to_the_closed_form_information(self):
        rng = np.random.default_rng(4)
        condition = rng.standard_normal((30_000, 1))
        sample = np.hstack([
            0.8 * condition + 0.6 * rng.standard_normal((30_000, 1)),
            0.3 * condition + math.sqrt(0.91) * rng.standard_normal((30_000, 1)),
        ])
        unconditional = gaussian_reference(sample)
        conditional = conditional_reference(sample, condition)
        exact = gaussian_information(unconditional, conditional)
        loc, scale = loc_scale_from_spectrum(unconditional.log_eigs)
        alpha, weights = logistic_grid(400, loc, scale, 6.0)
        integrated = float(np.mean(weights * gaussian_spectrum(alpha, unconditional, conditional)))
        assert integrated == pytest.approx(exact, rel=0.05)

    def test_the_density_is_never_negative(self):
        rng = np.random.default_rng(5)
        condition = rng.standard_normal((20_000, 2))
        sample = condition @ rng.standard_normal((2, 3)) + rng.standard_normal((20_000, 3))
        unconditional = gaussian_reference(sample)
        conditional = conditional_reference(sample, condition)
        alpha, _ = logistic_grid(80, 0.0, 3.0, 4.0)
        assert float(np.min(gaussian_spectrum(alpha, unconditional, conditional))) >= -1e-9


class TestTheOracleReproducesTheAnalyticCurve:
    def test_the_denoiser_error_is_the_analytic_error(self):
        sample = _scg()
        reference = gaussian_reference(sample)
        alpha, _ = logistic_grid(24, 0.0, 2.0, 3.0)
        rng = np.random.default_rng(7)
        measured = mse_curve(oracle_denoiser(reference), sample[:1_500], alpha, draws=6, rng=rng)
        analytic = reference.mmse(alpha)
        assert float(np.max(np.abs(measured - analytic) / analytic)) < 0.10

    def test_the_null_denoiser_approaches_the_entropy_from_below(self):
        """The estimate is a BOUND, and the clamp is what makes it one.

        With the Bayes-optimal denoiser for N(0, I) the measured error equals
        the analytic error in expectation, so the gap the estimator integrates
        is zero in expectation and noise either side of it. `nll_nats` clamps
        the gap at zero — that clamp is the ensemble with the analytic Gaussian
        — so Monte-Carlo noise can only ever pull the answer DOWN. Asserting
        equality would be asserting that the bound is tight at a finite sample
        size, which it is not; the honest claims are the direction and the
        size of the shortfall.
        """
        rng = np.random.default_rng(8)
        sample = rng.standard_normal((6_000, 2))
        reference = gaussian_reference(sample)
        alpha, weights = logistic_grid(60, 0.0, 2.5, 4.0)

        def optimal(z, a, _cond=None):
            return np.sqrt(1.0 - sigmoid(a))[:, None] * z

        curve = mse_curve(optimal, sample[:2_000], alpha, draws=8, rng=rng)
        value = nll_nats(curve, reference.mmse(alpha), reference.entropy_nats, weights)
        assert value <= reference.entropy_nats + 1e-9, "an upper bound came out above the entropy"
        assert value == pytest.approx(reference.entropy_nats, rel=0.05)

    def test_more_samples_tighten_the_bound_rather_than_moving_it(self):
        rng = np.random.default_rng(12)
        sample = rng.standard_normal((6_000, 2))
        reference = gaussian_reference(sample)
        alpha, weights = logistic_grid(60, 0.0, 2.5, 4.0)

        def optimal(z, a, _cond=None):
            return np.sqrt(1.0 - sigmoid(a))[:, None] * z

        thin = nll_nats(mse_curve(optimal, sample[:200], alpha, draws=2, rng=rng),
                        reference.mmse(alpha), reference.entropy_nats, weights)
        thick = nll_nats(mse_curve(optimal, sample[:2_000], alpha, draws=8, rng=rng),
                         reference.mmse(alpha), reference.entropy_nats, weights)
        assert thick > thin, "the clamp's downward bias must shrink as the noise does"


class TestThePointwiseInformationRecoversAKnownAnswer:
    @staticmethod
    def _joint(n: int = 30_000, seed: int = 4):
        rng = np.random.default_rng(seed)
        condition = rng.standard_normal((n, 1))
        sample = np.hstack([
            0.8 * condition + 0.6 * rng.standard_normal((n, 1)),
            0.3 * condition + math.sqrt(0.91) * rng.standard_normal((n, 1)),
        ])
        return sample, condition

    def test_it_lands_on_the_analytic_mutual_information(self):
        sample, condition = self._joint()
        unconditional = gaussian_reference(sample)
        conditional = conditional_reference(sample, condition)
        exact = gaussian_information(unconditional, conditional)
        conditional_denoise, _ref = conditional_oracle(sample, condition)
        marginal_denoise = oracle_denoiser(unconditional)

        def denoiser(z, a, cond):
            return conditional_denoise(z, a, cond) if cond is not None else marginal_denoise(z, a)

        loc, scale = loc_scale_from_spectrum(unconditional.log_eigs)
        alpha, weights = logistic_grid(80, loc, scale, 4.0)
        spectrum = pointwise_information(
            denoiser, sample[:600], alpha, weights, condition=condition[:600],
            null_condition=None, draws=8, rng=np.random.default_rng(11),
        )
        assert spectrum.total_nats == pytest.approx(exact, rel=0.15), (spectrum.total_nats, exact)

    def test_the_marginal_mean_alone_would_understate_it_badly(self):
        """Why `conditional_oracle` exists rather than `oracle_denoiser(cond_ref)`.

        A Gaussian conditional is homoscedastic, so a denoiser built from the
        conditional covariance and the MARGINAL mean sees none of the mean
        shift — which is where most of the information is.
        """
        sample, condition = self._joint()
        unconditional = gaussian_reference(sample)
        conditional = conditional_reference(sample, condition)
        exact = gaussian_information(unconditional, conditional)
        wrong = oracle_denoiser(conditional)
        marginal = oracle_denoiser(unconditional)

        def denoiser(z, a, cond):
            return wrong(z, a) if cond is not None else marginal(z, a)

        loc, scale = loc_scale_from_spectrum(unconditional.log_eigs)
        alpha, weights = logistic_grid(80, loc, scale, 4.0)
        spectrum = pointwise_information(
            denoiser, sample[:600], alpha, weights, condition=condition[:600],
            null_condition=None, draws=8, rng=np.random.default_rng(11),
        )
        assert spectrum.total_nats < 0.85 * exact

    def test_the_per_dimension_split_sums_to_the_total(self):
        sample, condition = self._joint(n=8_000)
        unconditional = gaussian_reference(sample)
        conditional_denoise, _ = conditional_oracle(sample, condition)
        marginal = oracle_denoiser(unconditional)

        def denoiser(z, a, cond):
            return conditional_denoise(z, a, cond) if cond is not None else marginal(z, a)

        alpha, weights = logistic_grid(30, 0.0, 2.0, 3.0)
        spectrum = pointwise_information(
            denoiser, sample[:300], alpha, weights, condition=condition[:300],
            null_condition=None, draws=4, rng=np.random.default_rng(2),
        )
        assert float(spectrum.per_dimension.sum()) == pytest.approx(spectrum.total_nats, rel=1e-9)

    def test_paired_noise_is_the_variance_reduction_it_claims_to_be(self):
        sample, condition = self._joint(n=8_000)
        unconditional = gaussian_reference(sample)
        conditional_denoise, _ = conditional_oracle(sample, condition)
        marginal = oracle_denoiser(unconditional)

        def denoiser(z, a, cond):
            return conditional_denoise(z, a, cond) if cond is not None else marginal(z, a)

        alpha, weights = logistic_grid(30, 0.0, 2.0, 3.0)
        kwargs = dict(condition=condition[:300], null_condition=None, draws=4)
        paired = pointwise_information(denoiser, sample[:300], alpha, weights,
                                       rng=np.random.default_rng(3), paired=True, **kwargs)
        unpaired = pointwise_information(denoiser, sample[:300], alpha, weights,
                                         rng=np.random.default_rng(3), paired=False, **kwargs)
        assert paired.total_stderr < unpaired.total_stderr


class TestConditionalIndependenceReadsAsNoInformation:
    def test_a_condition_that_adds_nothing_given_another_is_near_zero(self):
        """`c -> x` and `c -> y`, so `i(x; y | c)` is exactly zero."""
        rng = np.random.default_rng(9)
        n = 20_000
        common = rng.standard_normal((n, 1))
        sample = common + 0.5 * rng.standard_normal((n, 2))
        other = common + 0.5 * rng.standard_normal((n, 1))
        with_both = conditional_reference(sample, np.hstack([other, common]))
        with_common = conditional_reference(sample, common)
        residual = gaussian_information(with_common, with_both)
        assert abs(residual) < 0.02, residual


class TestAMomentIsRefusedWhenThereIsNoMass:
    @staticmethod
    def _spectrum(total: float):
        from modules.coherence.diffusion.estimator import InformationSpectrum

        alpha = np.linspace(-4.0, 4.0, 40)
        density = np.exp(-((alpha - 1.0) ** 2)) * total
        return InformationSpectrum(alpha=alpha, density=density,
                                   density_stderr=np.full_like(density, 1e-4),
                                   per_dimension=np.zeros(2), total_nats=total,
                                   total_stderr=1e-4, draws=4, paired=True)

    def test_below_the_shuffled_floor_there_is_no_centroid(self):
        moments = spectrum_moments(self._spectrum(0.01), floor_nats=0.05, fine_threshold=0.0)
        assert moments.state == "no_information"
        assert moments.centroid is None
        assert "shuffled floor" in (moments.reason or "")

    def test_above_it_the_centroid_is_where_the_mass_is(self):
        moments = spectrum_moments(self._spectrum(1.0), floor_nats=0.05, fine_threshold=0.0)
        assert moments.state == "ok"
        assert moments.centroid == pytest.approx(1.0, abs=0.2)
        assert moments.q25 is not None and moments.q25 < moments.q75

    def test_the_fine_fraction_is_the_mass_above_the_threshold(self):
        moments = spectrum_moments(self._spectrum(1.0), floor_nats=0.05, fine_threshold=1.0)
        assert moments.fine_fraction == pytest.approx(0.5, abs=0.1)
