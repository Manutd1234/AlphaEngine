"""The verdict function, and the false positive that taught it to be careful.

An earlier version said `predicts` as soon as any moment cleared |t| = 2, and
it duly did: on the real statements the spread moment reached t = -3.58 with a
shuffled p of 0.002, on both stages, agreeing in sign, and it survived a
control for the size of the policy move. It was still an artefact — re-fitting
at a latent width nobody can justify to the decimal moved one stage's
coefficient from +0.27 to -2.86, and half the sample carried the whole effect.

These tests pin the repair: clearing a threshold is necessary and not
sufficient, and a result that has not been re-fitted is reported as unchecked
rather than as a finding.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.diffusion_spectrum import _verdict  # noqa: E402

STABLE = {"stable": True, "widths": [8, 10, 14], "t_values": [-2.4, -2.9, -3.1],
          "reason": "the sign holds and the effect persists at other widths"}
UNSTABLE = {"stable": False, "widths": [8, 10, 14], "t_values": [0.27, -1.06, -3.83],
            "reason": "re-fitting gives t values [0.27, -1.06, -3.83], which change sign"}


class TestBelowTheThresholdIsSimple:
    def test_a_small_t_does_not_predict(self):
        got = _verdict({"t": 1.4}, None)
        assert got["outcome"] == "does_not_predict"
        assert "1.40" in got["reason"]

    def test_nothing_measurable_is_not_assessable(self):
        assert _verdict(None)["outcome"] == "not_assessable"


class TestAboveItTheThresholdIsNotEnough:
    def test_an_unchecked_result_is_not_reported_as_a_finding(self):
        got = _verdict({"t": -3.58}, None)
        assert got["outcome"] == "unstable_or_unchecked"
        assert "hyperparameter artefact" in got["reason"]

    def test_a_result_that_flips_sign_on_refitting_does_not_predict(self):
        got = _verdict({"t": -3.58}, UNSTABLE)
        assert got["outcome"] == "does_not_predict"
        assert "does NOT survive re-fitting" in got["reason"]
        assert got["stability"]["t_values"] == [0.27, -1.06, -3.83]

    def test_only_a_result_that_holds_across_widths_predicts(self):
        got = _verdict({"t": -3.58}, STABLE)
        assert got["outcome"] == "predicts"
        assert "holds its sign" in got["reason"]

    def test_the_measured_false_positive_is_rejected_by_this_function(self):
        """The exact numbers that fooled the earlier version."""
        assert _verdict({"t": -3.58}, UNSTABLE)["outcome"] != "predicts"
