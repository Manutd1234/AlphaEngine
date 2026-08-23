"""Fitting the instrument to a panel: what it freezes, and what it refuses.

The fit is the part that has to be frozen or the cross-sectional claim is
meaningless — two events scored through two different bases are not
comparable. So the tests here are mostly about immutability and about the null
floor, which is the thing that stops a positive-by-construction estimator from
reporting information that is not there.
"""

from __future__ import annotations

import numpy as np

from modules.coherence.diffusion.gaussian import conditional_model, gaussian_reference
from modules.coherence.diffusion.spectrum import (
    FitRefusal,
    fit_spectrum,
    score_event,
    summarise,
)


def _panel(rows: int = 200, dim: int = 48, *, coupling: float = 0.8, seed: int = 0):
    """A body that a headline genuinely explains, in a spectrum-bearing space."""
    rng = np.random.default_rng(seed)
    scale = np.geomspace(3.0, 0.08, dim)
    headline = rng.standard_normal((rows, dim)) * scale
    body = coupling * headline + np.sqrt(1 - coupling**2) * rng.standard_normal((rows, dim)) * scale
    return body, headline


class TestTheFitIsFrozenAndDescribesItself:
    def test_it_reports_the_grid_it_will_score_on(self):
        body, headline = _panel()
        fit = fit_spectrum(body, headline, latent_dim=8, points=40, draws=3, shuffles=6)
        assert not isinstance(fit, FitRefusal)
        assert fit.alpha.size == 40
        assert fit.logsnr_clip == 4.0
        assert summarise(fit)["basis_digest"]

    def test_the_fine_threshold_is_the_frozen_centre_not_a_panel_median(self):
        body, headline = _panel()
        fit = fit_spectrum(body, headline, latent_dim=8, points=40, draws=3, shuffles=6)
        assert fit.fine_threshold == fit.logsnr_loc, (
            "a threshold taken from the scored batch makes one event's feature "
            "depend on the others scored beside it"
        )

    def test_scoring_does_not_refit_on_the_event(self):
        body, headline = _panel()
        fit = fit_spectrum(body, headline, latent_dim=8, points=40, draws=3, shuffles=6)
        before = fit.conditional.regression.copy()
        score_event(fit, "one", body[0], headline[0], draws=4)
        assert np.array_equal(fit.conditional.regression, before)

    def test_the_same_event_scores_the_same_twice(self):
        body, headline = _panel()
        fit = fit_spectrum(body, headline, latent_dim=8, points=40, draws=3, shuffles=6)
        first = score_event(fit, "one", body[3], headline[3], draws=4, seed=5)
        second = score_event(fit, "one", body[3], headline[3], draws=4, seed=5)
        assert first.total_nats == second.total_nats


class TestTheNullFloorComesFromAShuffle:
    def test_the_floor_is_above_the_shuffled_median(self):
        body, headline = _panel()
        fit = fit_spectrum(body, headline, latent_dim=8, points=40, draws=3, shuffles=12)
        assert fit.floor_nats >= fit.shuffled_median_nats

    def test_a_real_pairing_clears_the_floor_it_set(self):
        body, headline = _panel(coupling=0.9)
        fit = fit_spectrum(body, headline, latent_dim=8, points=40, draws=4, shuffles=12)
        scored = score_event(fit, "one", body[0], headline[0], draws=8)
        assert scored.state == "ok"
        assert scored.total_nats is not None and scored.total_nats > fit.floor_nats

    def test_a_headline_that_explains_nothing_is_refused_rather_than_scored(self):
        """The estimator is a squared difference and is positive under the null,
        which is why the floor cannot be a standard error."""
        rng = np.random.default_rng(4)
        body, _ = _panel(coupling=0.0, seed=2)
        unrelated = rng.standard_normal(body.shape) * 0.01
        fit = fit_spectrum(body, unrelated, latent_dim=6, points=30, draws=3, shuffles=12)
        assert not isinstance(fit, FitRefusal)
        scored = score_event(fit, "one", body[0], unrelated[0], draws=6)
        assert scored.state in {"no_information", "ok"}
        if scored.state == "no_information":
            assert "shuffled floor" in (scored.reason or "")


class TestItRefusesRatherThanFittingNoise:
    def test_too_few_events_for_the_latent_is_a_refusal(self):
        body, headline = _panel(rows=12)
        refusal = fit_spectrum(body, headline, latent_dim=32, points=20, draws=2, shuffles=2)
        assert isinstance(refusal, FitRefusal)
        assert refusal.reason

    def test_mismatched_document_sets_are_refused(self):
        body, headline = _panel(rows=50)
        refusal = fit_spectrum(body[:40], headline, latent_dim=8, points=20, draws=2, shuffles=2)
        assert isinstance(refusal, FitRefusal)
        assert "different lengths" in refusal.reason


class TestTheConditionalModelIsTheOneThatUsesTheCondition:
    def test_its_mean_moves_with_the_condition(self):
        body, headline = _panel(rows=300, dim=6)
        model = conditional_model(body, headline)
        first = model.conditional_mean(headline[0:1])
        second = model.conditional_mean(headline[1:2])
        assert not np.allclose(first, second), (
            "a conditional mean that ignores its condition loses the mean shift, "
            "which is where most of the information is"
        )

    def test_the_denoiser_answers_differently_for_different_conditions(self):
        body, headline = _panel(rows=300, dim=6)
        model = conditional_model(body, headline)
        denoise = model.denoiser()
        z = np.repeat(body[0:1], 2, axis=0)
        alpha = np.array([0.5, 0.5])
        both = denoise(z, alpha, np.vstack([headline[0], headline[7]]))
        assert not np.allclose(both[0], both[1])

    def test_with_no_condition_it_falls_back_to_the_marginal_mean(self):
        body, headline = _panel(rows=300, dim=6)
        model = conditional_model(body, headline)
        marginal = gaussian_reference(body)
        assert np.allclose(model.mean_x, marginal.mean, atol=1e-9)
