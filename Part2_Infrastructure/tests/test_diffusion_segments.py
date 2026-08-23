"""Pulling the decision out of the boilerplate, and counting who voted against.

Both extractors were wrong in a way that only real statements revealed, and
each test below names the case that caught it. The dissent counter is the
sharper lesson: two plausible sentence boundaries — the full stop inside
"0.5 percentage point" and the one inside "Esther L. George" — each silently
deleted dissenters, and a count that is quietly too low looks exactly like a
unanimous Committee.
"""

from __future__ import annotations

import pytest

from modules.coherence.diffusion.segments import count_dissenters, extract

DECISION = ("In support of these goals, the Committee decided to raise the target range for "
            "the federal funds rate to 3 to 3-1/4 percent.")
GUIDANCE = ("In determining the extent of future increases, the Committee will take into "
            "account the cumulative tightening of monetary policy.")
ASSESSMENT = ("Recent indicators point to modest growth in spending and production. Job gains "
              "have been robust in recent months and the unemployment rate has remained low.")


class TestTheDecisionIsSeparatedFromTheAssessment:
    def test_it_finds_the_sentence_that_states_the_range(self):
        found = extract(f"{ASSESSMENT} {DECISION} {GUIDANCE}")
        assert found.decision is not None
        assert "3 to 3-1/4 percent" in found.decision
        assert "unemployment" not in found.decision

    def test_the_decision_is_a_small_fraction_of_the_statement(self):
        text = f"{ASSESSMENT} {DECISION} {GUIDANCE}"
        found = extract(text)
        assert found.decision_chars < len(text) / 2, (
            "the whole point is that the decision is a minority of the words"
        )

    def test_guidance_is_found_separately(self):
        found = extract(f"{ASSESSMENT} {DECISION} {GUIDANCE}")
        assert found.guidance is not None and "future increases" in found.guidance

    def test_a_statement_with_no_decision_sentence_reports_none(self):
        assert extract(ASSESSMENT).decision is None

    def test_a_named_channel_can_be_asked_for(self):
        found = extract(f"{ASSESSMENT} {DECISION}")
        assert found.channel("decision") == found.decision
        assert found.channel("nonsense") is None


class TestCountingWhoVotedAgainst:
    def test_a_unanimous_vote_has_no_dissenters(self):
        assert count_dissenters(
            "Voting for the monetary policy action were Jerome H. Powell, Chair; "
            "John C. Williams, Vice Chair.") == 0

    def test_one_dissenter_is_one(self):
        assert count_dissenters(
            "Voting for the monetary policy action were Jerome H. Powell, Chair. "
            "Voting against the action was James Bullard, who preferred to lower the target "
            "range.") == 1

    def test_three_dissenters_across_two_clauses(self):
        """September 2019: Bullard wanted a cut, George and Rosengren a hold."""
        assert count_dissenters(
            "Voting for the monetary policy action were Jerome H. Powell, Chair. "
            "Voting against the action were James Bullard, who preferred at this meeting to "
            "lower the target range for the federal funds rate to 1-1/2 to 1-3/4 percent; and "
            "Esther L. George and Eric S. Rosengren, who preferred to maintain the target range "
            "at 2 percent to 2-1/4 percent.") == 3

    def test_a_middle_initial_is_not_a_sentence_boundary(self):
        """The bug that turned three dissenters into one.

        "Esther L. George" carries a full stop followed by a space and a
        capital, which is indistinguishable from the end of a sentence unless
        the initial is excluded explicitly.
        """
        assert count_dissenters(
            "Voting against the action were Esther L. George and Eric S. Rosengren, who "
            "preferred to maintain the target range.") == 2

    def test_a_decimal_point_is_not_a_sentence_boundary_either(self):
        assert count_dissenters(
            "Voting against the action was James Bullard, who preferred to raise the target "
            "range by 0.5 percentage point to 1/2 to 3/4 percent.") == 1

    def test_an_alternate_voter_is_not_a_dissenter(self):
        """The bug that turned an 8-1 vote into two dissents."""
        assert count_dissenters(
            "Voting against the action was James Bullard, who preferred to raise the target "
            "range by 0.5 percentage point to 1/2 to 3/4 percent. Patrick Harker voted as an "
            "alternate member at this meeting.") == 1

    def test_no_voting_sentence_at_all_is_zero_rather_than_an_error(self):
        assert count_dissenters("") == 0
        assert count_dissenters("The Committee met and agreed.") == 0

    @pytest.mark.parametrize("phrasing", ["was", "were"])
    def test_both_verb_forms_are_matched(self, phrasing):
        assert count_dissenters(
            f"Voting against the action {phrasing} James Bullard, who preferred a cut.") == 1
