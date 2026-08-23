"""Reading the policy rate out of a statement, in all four ways it is written.

The reason this parser has to be thorough rather than adequate: the statements
it fails on are not a random sample. The zero-lower-bound years write "0 to 1/4
percent" with no whole number, so a parser that needs one drops the entire
pandemic period — the most violent repricing in the sample — and the study then
concludes something about a world with no March 2020 in it.
"""

from __future__ import annotations

import pytest

from modules.coherence.diffusion.policy import (
    PolicyRate,
    move_basis_points,
    parse_target_range,
    rate_path,
)


class TestEveryWordingSinceTwentyNineteen:
    @pytest.mark.parametrize(("text", "lower", "upper"), [
        ("the target range for the federal funds rate at 2.25 to 2.5 percent", 2.25, 2.5),
        ("the target range for the federal funds rate to 2-1/4 to 2-1/2 percent", 2.25, 2.5),
        ("the target range for the federal funds rate at 0 to 1/4 percent", 0.0, 0.25),
        ("the target range for the federal funds rate to 1 to 1-1/4 percent", 1.0, 1.25),
    ])
    def test_it_reads_the_range(self, text, lower, upper):
        found = parse_target_range(text)
        assert found == PolicyRate(lower, upper)

    def test_the_non_breaking_hyphen_the_fed_actually_uses_is_matched(self):
        # U+2011, which is what the HTML carries as often as the ASCII one.
        found = parse_target_range(
            "the target range for the federal funds rate to 1 to 1‑1/4 percent")
        assert found == PolicyRate(1.0, 1.25)

    def test_a_cut_announced_with_its_size_still_parses_the_destination(self):
        found = parse_target_range(
            "decided to lower the target range for the federal funds rate by 1/2 percentage "
            "point, to 1 to 1-1/4 percent")
        assert found == PolicyRate(1.0, 1.25)

    def test_the_midpoint_is_the_middle(self):
        assert PolicyRate(2.25, 2.5).midpoint == pytest.approx(2.375)


class TestItRefusesRatherThanGuessing:
    def test_a_statement_with_no_range_is_none(self):
        assert parse_target_range("The Committee decided to keep policy unchanged.") is None

    def test_empty_text_is_none_not_zero(self):
        assert parse_target_range("") is None

    def test_an_inverted_range_is_refused(self):
        assert parse_target_range(
            "the target range for the federal funds rate at 2.5 to 2.25 percent") is None

    def test_an_unknown_fraction_is_refused_rather_than_rounded(self):
        assert parse_target_range(
            "the target range for the federal funds rate at 1 to 1-1/3 percent") is None


class TestTheMoveIsSignedAndCanBeUnknown:
    def test_a_hike_is_positive_in_basis_points(self):
        assert move_basis_points(PolicyRate(2.0, 2.25), PolicyRate(2.25, 2.5)) == pytest.approx(25.0)

    def test_a_cut_is_negative(self):
        assert move_basis_points(PolicyRate(1.0, 1.25), PolicyRate(0.0, 0.25)) == pytest.approx(-100.0)

    def test_a_hold_is_zero_and_an_unknown_is_none(self):
        assert move_basis_points(PolicyRate(2.0, 2.25), PolicyRate(2.0, 2.25)) == 0.0
        assert move_basis_points(None, PolicyRate(2.0, 2.25)) is None


class TestThePathAcrossAMeetingSequence:
    @staticmethod
    def _statement(lower: str, upper: str) -> str:
        return f"the target range for the federal funds rate at {lower} to {upper} percent"

    def test_the_first_meeting_has_no_move_rather_than_a_zero_one(self):
        path = rate_path([("a", self._statement("2", "2-1/4"))])
        assert path["a"]["move_bp"] is None, "an unknown move and a hold are different facts"

    def test_moves_are_measured_against_the_previous_known_rate(self):
        path = rate_path([
            ("a", self._statement("2", "2-1/4")),
            ("b", self._statement("2-1/4", "2-1/2")),
            ("c", self._statement("2-1/4", "2-1/2")),
        ])
        assert path["b"]["move_bp"] == pytest.approx(25.0)
        assert path["c"]["move_bp"] == pytest.approx(0.0)

    def test_an_unparseable_statement_does_not_reset_the_path(self):
        path = rate_path([
            ("a", self._statement("2", "2-1/4")),
            ("b", "no range in this one"),
            ("c", self._statement("2-1/4", "2-1/2")),
        ])
        assert path["b"]["midpoint"] is None and path["b"]["move_bp"] is None
        assert path["c"]["move_bp"] == pytest.approx(25.0), (
            "the move must be measured against the last KNOWN rate, not against nothing"
        )
