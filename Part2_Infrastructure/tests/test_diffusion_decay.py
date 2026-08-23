"""Half-life and the two fits, against curves whose answer is known.

The recurring trap in this file's subject is a number that looks like a
measurement and is an artefact of the grid: a crossing snapped to the later
horizon, an asymptote chosen by a residual in the wrong space, two models
whose errors are not on the same scale. Each of those has a test here.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from modules.coherence.diffusion.decay import fit_exponential, fit_power, half_life

GRID = np.array([60.0, 120.0, 300.0, 600.0, 900.0, 1800.0])


def _exponential(tau: float, grid: np.ndarray = GRID) -> np.ndarray:
    raw = 1.0 - np.exp(-grid / tau)
    return raw / raw[-1]


class TestTheCrossingIsInterpolatedNotSnapped:
    def test_a_known_tau_comes_back_inside_its_own_cell(self):
        tau = 300.0
        found = half_life(GRID, _exponential(tau))
        assert found.state == "ok"
        assert found.value is not None
        assert found.lower == 120.0 and found.upper == 300.0
        assert abs(found.value - tau * math.log(2)) < 25.0, found

    def test_the_answer_is_not_a_grid_point(self):
        found = half_life(GRID, _exponential(300.0))
        assert found.value not in set(GRID.tolist()), (
            "snapping to the bracketing horizon quantises every half-life onto the grid"
        )

    def test_two_taus_an_octave_apart_come_back_an_octave_apart(self):
        quick = half_life(GRID, _exponential(150.0))
        slow = half_life(GRID, _exponential(300.0))
        assert quick.value is not None and slow.value is not None
        assert 1.6 < slow.value / quick.value < 2.4

    def test_a_curve_that_never_gets_there_says_so(self):
        found = half_life(GRID, np.array([0.01, 0.02, 0.03, 0.05, 0.08, 0.10]))
        assert found.state == "never_reached"
        assert found.value is None and found.lower == 1800.0

    def test_a_curve_already_past_the_level_does_not_pretend_to_resolve_it(self):
        found = half_life(GRID, np.array([0.7, 0.8, 0.9, 0.95, 0.98, 1.0]))
        assert found.state == "at_or_before_first"
        assert "not resolved by this grid" in (found.reason or "")

    def test_one_point_is_not_a_curve(self):
        assert half_life(np.array([60.0]), np.array([0.9])).state == "too_few_points"

    def test_the_clock_is_whatever_axis_it_is_handed(self):
        variance = np.array([1.0, 2.0, 5.0, 10.0, 15.0, 30.0])
        on_seconds = half_life(GRID, _exponential(300.0))
        on_variance = half_life(variance, _exponential(300.0))
        assert on_seconds.value is not None and on_variance.value is not None
        assert on_variance.value == pytest.approx(on_seconds.value / 60.0, rel=1e-9)


class TestTheFitsAreScoredWhereTheyWereAsked:
    def test_the_exponential_recovers_its_tau(self):
        fit = fit_exponential(GRID, _exponential(300.0))
        assert fit.model == "exponential"
        assert fit.half_life is not None
        assert abs(fit.half_life - 300.0 * math.log(2)) < 20.0

    def test_a_real_asymptote_is_found_rather_than_walked_up(self):
        floor = 0.30
        unpriced = floor + (1.0 - floor) * np.exp(-GRID / 300.0)
        fit = fit_exponential(GRID, 1.0 - unpriced)
        assert fit.terminal_unpriced_fraction is not None
        assert abs(fit.terminal_unpriced_fraction - floor) <= 0.10, fit

    def test_both_models_report_a_comparable_error(self):
        absorbed = _exponential(300.0)
        exponential = fit_exponential(GRID, absorbed)
        power = fit_power(GRID, absorbed)
        assert exponential.sse is not None and power.sse is not None
        assert exponential.sse < power.sse, "the true model must win on the shared scale"

    def test_overshoot_is_counted_rather_than_clipped(self):
        fit = fit_exponential(GRID, np.array([0.2, 0.5, 1.2, 1.1, 1.05, 1.0]))
        assert fit.overshoot_points == 3

    def test_too_few_points_is_a_refusal_with_a_reason(self):
        fit = fit_exponential(GRID[:2], np.array([0.2, 0.5]))
        assert fit.model == "none" and "three" in (fit.reason or "")
