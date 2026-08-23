"""The out-of-sample skill estimator, pinned at the properties it exists for.

Every test here is about a way the OLD estimator could be fooled. A test that
only checked "does it return a number" would pass on the version this replaces.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from modules.coherence.diffusion.skill import (
    MIN_MEETINGS,
    TERMINAL_MINUTES,
    absorption_clock,
    out_of_sample_r2,
    predictive_skill,
    residence_time,
    verdict,
)


def _cells(path: dict[str, float]) -> list[dict[str, object]]:
    return [{"horizon": horizon, "state": "ok", "abnormal_return": value}
            for horizon, value in path.items()]


class TestResidenceTime:
    def test_an_instant_move_costs_only_the_grid_it_was_measured_on(self):
        """Fully absorbed by the first measured horizon.

        The answer is half a minute, not zero, and that is the ledger speaking
        rather than the estimator: the first measured horizon is 1m, absorbed
        is anchored at 0 at t-zero, and a straight line between them spends
        half of that minute unabsorbed. No free bar source resolves inside a
        minute, so half a minute is the floor this instrument can report.
        """
        tau, terminal = residence_time(_cells({"1m": 1.0, "5m": 1.0, "30m": 1.0}))
        assert tau == pytest.approx(0.5, abs=1e-9)
        assert terminal == 1.0

    def test_a_move_that_only_arrives_at_the_end_spends_the_window_unabsorbed(self):
        tau, _ = residence_time(_cells({"1m": 0.0, "15m": 0.0, "30m": 1.0}))
        assert tau > 20.0

    def test_it_recovers_the_time_constant_of_an_exponential(self):
        """The claim the docstring makes, checked rather than asserted.

        For 1 - exp(-t/k) the area above the curve over [0, inf) is k. Over a
        30-minute window it is k(1 - exp(-30/k)), which for k = 5 is 4.99.
        """
        k = 5.0
        path = {h: float(1 - np.exp(-m / k))
                for h, m in (("1m", 1), ("2m", 2), ("5m", 5), ("10m", 10),
                             ("15m", 15), ("30m", 30))}
        tau, _ = residence_time(_cells(path))
        assert tau == pytest.approx(k * (1 - np.exp(-30 / k)), abs=0.35)

    def test_it_needs_no_signal_where_the_old_half_life_needed_one(self):
        """A move well under any noise floor still yields a residence time.

        This is the whole point of the change: `half_life_s` is null on rows
        like this one, and 36 of 62 release meetings are rows like this one.
        """
        tau, terminal = residence_time(_cells({"1m": 1e-9, "15m": 5e-9, "30m": 1e-8}))
        assert 0.0 <= tau <= TERMINAL_MINUTES
        assert terminal == 1e-8

    def test_a_path_that_never_reaches_the_terminal_horizon_is_refused(self):
        assert residence_time(_cells({"1m": 0.5, "15m": 1.0})) is None

    def test_a_zero_terminal_move_is_refused_rather_than_divided_by(self):
        assert residence_time(_cells({"1m": 0.0, "30m": 0.0})) is None

    def test_an_overshooting_path_is_clamped_into_the_window_it_was_measured_in(self):
        tau, _ = residence_time(_cells({"1m": -4.0, "15m": -2.0, "30m": 1.0}))
        assert 0.0 <= tau <= TERMINAL_MINUTES

    def test_unmeasured_horizons_are_skipped_not_read_as_zero(self):
        cells = _cells({"1m": 1.0, "30m": 1.0})
        cells.insert(1, {"horizon": "5m", "state": "unavailable", "abnormal_return": None})
        assert residence_time(cells) == residence_time(_cells({"1m": 1.0, "30m": 1.0}))


class TestAbsorptionClock:
    def _row(self, ref, stage, symbol, path, sigma):
        return {"source_ref": ref, "stage": stage, "symbol": symbol,
                "sigma_pre_per_bar": sigma, "points_json": json.dumps(_cells(path))}

    def test_two_assets_on_one_meeting_are_one_observation(self):
        clock = absorption_clock([
            self._row("m1", "release", "BTCUSDT", {"1m": 1.0, "30m": 1.0}, 0.01),
            self._row("m1", "release", "ETHUSDT", {"1m": 1.0, "30m": 1.0}, 0.01),
        ])
        assert list(clock) == [("m1", "release")]

    def test_the_better_measured_asset_carries_the_pooled_reading(self):
        """A loud move and a whisper disagree; the pooled tau sits by the loud one."""
        clock = absorption_clock([
            self._row("m1", "release", "BTCUSDT", {"1m": 1.0, "30m": 1.0}, 0.001),
            self._row("m1", "release", "ETHUSDT", {"1m": 0.0, "30m": 1e-6}, 0.001),
        ])
        tau, _ = clock[("m1", "release")]
        assert tau < 1.0

    def test_a_row_with_no_pre_window_sigma_cannot_be_weighted_so_is_dropped(self):
        assert absorption_clock([
            self._row("m1", "release", "BTCUSDT", {"1m": 1.0, "30m": 1.0}, None)]) == {}


class TestOutOfSampleR2:
    def test_a_pure_noise_target_scores_at_or_below_zero(self):
        rng = np.random.default_rng(3)
        n = 60
        design = np.column_stack([np.ones(n), rng.normal(size=n)])
        target = rng.normal(size=n)
        r2 = out_of_sample_r2(design, target, np.ones(n), np.arange(n))
        assert r2 <= 0.05

    def test_a_real_relationship_scores_well_above_zero(self):
        rng = np.random.default_rng(3)
        n = 60
        x = rng.normal(size=n)
        design = np.column_stack([np.ones(n), x])
        target = 2.0 * x + rng.normal(size=n) * 0.2
        assert out_of_sample_r2(design, target, np.ones(n), np.arange(n)) > 0.8

    def test_holding_out_the_meeting_not_the_row_is_what_stops_leakage(self):
        """Both stages of a meeting share a statement, so they must leave together.

        Constructed so the leak is visible rather than statistical. One meeting
        is worth 100 and every other is worth 0, and the lone predictor is the
        indicator of that meeting. Fold by MEETING and the column is all-zero
        in every training fold that matters, so nothing can be learned about
        the meeting from itself and its prediction stays near 0 — correctly
        useless. Fold by ROW and the meeting's own sibling is in the training
        set, the coefficient goes to 100, and the estimator reports having
        predicted something it was simply told.
        """
        meetings = np.repeat(np.arange(20), 2)
        indicator = (meetings == 0).astype(float)
        target = 100.0 * indicator
        design = np.column_stack([np.ones(40), indicator])
        weights = np.ones(40)
        by_meeting = out_of_sample_r2(design, target, weights, meetings)
        by_row = out_of_sample_r2(design, target, weights, np.arange(40))
        assert by_row > 0.9, "row folding should look like near-perfect skill"
        assert by_meeting < 0.0, "meeting folding should expose it as none"

class TestPredictiveSkill:
    def _inputs(self, n, *, informative):
        rng = np.random.default_rng(5)
        clock, moments, policy = {}, {}, {}
        for i in range(n):
            ref = f"m{i:03d}"
            signal = rng.normal()
            moments[ref] = [signal, rng.normal(), rng.normal(), rng.normal()]
            policy[ref] = {"move_bp": float(rng.integers(0, 4) * 25)}
            for stage, offset in (("release", 0.0), ("call", 5.0)):
                base = 8.0 + offset + (3.0 * signal if informative else 0.0)
                clock[(ref, stage)] = (float(base + rng.normal() * 0.5), 1.0)
        return clock, moments, policy

    def test_it_finds_a_predictor_that_is_really_there(self):
        skill = predictive_skill(*self._inputs(45, informative=True), draws=100, seed=1)
        assert skill["state"] == "ok"
        assert skill["gain"] > 0
        assert skill["predicts"] is True
        assert verdict(skill)["outcome"] == "predicts"

    def test_it_refuses_a_predictor_that_is_not(self):
        skill = predictive_skill(*self._inputs(45, informative=False), draws=100, seed=1)
        assert skill["predicts"] is False
        assert verdict(skill)["outcome"] == "does_not_predict"

    def test_the_stage_effect_is_reported_in_minutes_so_it_can_be_argued_with(self):
        skill = predictive_skill(*self._inputs(45, informative=False), draws=50, seed=1)
        assert skill["stage_minutes"] == pytest.approx(5.0, abs=1.0)

    def test_below_the_meeting_floor_it_refuses_rather_than_reporting_noise(self):
        skill = predictive_skill(*self._inputs(MIN_MEETINGS - 1, informative=True),
                                 draws=20, seed=1)
        assert skill["state"] == "too_few"
        assert verdict(skill)["outcome"] == "not_assessable"

    def test_a_meeting_with_no_rate_move_is_dropped_rather_than_read_as_a_hold(self):
        clock, moments, policy = self._inputs(30, informative=True)
        policy["m000"]["move_bp"] = None
        skill = predictive_skill(clock, moments, policy, draws=20, seed=1)
        assert skill["meetings"] == 29


class TestVerdict:
    def test_an_unpredictable_target_is_its_own_outcome_not_a_text_null(self):
        """The distinction the old two-outcome verdict could not make."""
        out = verdict({"state": "ok", "gain": -0.02, "baseline_r2": -0.3,
                       "shuffled_p": 0.7, "predicts": False})
        assert out["outcome"] == "target_unpredictable"
        assert "no null measured against it is evidence" in out["reason"]

    def test_a_text_null_says_the_clock_is_predictable_and_the_text_is_not(self):
        out = verdict({"state": "ok", "gain": -0.6, "baseline_r2": 0.14,
                       "shuffled_p": 0.9, "predicts": False})
        assert out["outcome"] == "does_not_predict"
        assert "IS predictable" in out["reason"]
