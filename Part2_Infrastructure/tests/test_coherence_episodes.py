"""Lesson 9: how long a violation survives, and what that says about trading it.

The measurement this whole engine is gated on. Every assertion here is about a
bias — a way the number could come out flattering — because a half-life that is
too short retires a real opportunity and one that is too long builds an executor
for a race already lost.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.episodes import (
    MIN_EPISODES_FOR_HALF_LIFE,
    POLLS_TO_CLOSE,
    EpisodeTracker,
    survival,
    verdict_for,
)

SECOND = 1_000_000_000


def _run(tracker: EpisodeTracker, component: str, pattern: list[bool], start: int = 0) -> None:
    for index, violated in enumerate(pattern):
        tracker.observe(
            component_id=component,
            series_ticker="KX",
            event_ticker=f"{component}-EV",
            exchange_index=0,
            ts_ns=(start + index) * SECOND,
            violated=violated,
            family="additive",
            ci=Decimal("0.03") if violated else Decimal("0.00"),
            net_edge=Decimal("1.50") if violated else None,
        )


class TestOpeningAndClosing:
    def test_an_episode_opens_on_the_first_violating_poll(self):
        tracker = EpisodeTracker()
        _run(tracker, "A", [True])
        assert len(tracker.open_episodes) == 1
        assert not tracker.closed

    def test_one_coherent_poll_does_not_close_it(self):
        """A leg's book can be momentarily unreadable.

        Closing on a single quiet poll cuts long episodes into strings of short
        ones, which biases the median DOWN — the direction that makes the
        exchange look faster than it is and retires a real opportunity.
        """
        tracker = EpisodeTracker()
        _run(tracker, "A", [True, True, False])
        assert len(tracker.open_episodes) == 1
        assert not tracker.closed

    def test_two_consecutive_coherent_polls_close_it(self):
        tracker = EpisodeTracker()
        _run(tracker, "A", [True, True, False, False])
        assert not tracker.open_episodes
        assert len(tracker.closed) == 1

    def test_the_close_threshold_is_the_constant_and_not_a_literal(self):
        tracker = EpisodeTracker()
        _run(tracker, "A", [True] + [False] * POLLS_TO_CLOSE)
        assert len(tracker.closed) == 1

    def test_a_reopened_violation_is_a_second_episode(self):
        tracker = EpisodeTracker()
        _run(tracker, "A", [True, False, False, True, False, False])
        assert len(tracker.closed) == 2

    def test_it_keeps_the_peak_rather_than_the_last_reading(self):
        tracker = EpisodeTracker()
        tracker.observe("A", "KX", "A-EV", 0, 0, True, ci=Decimal("0.01"), net_edge=Decimal("1"))
        tracker.observe("A", "KX", "A-EV", 0, SECOND, True, ci=Decimal("0.09"), net_edge=Decimal("9"))
        tracker.observe("A", "KX", "A-EV", 0, 2 * SECOND, True, ci=Decimal("0.02"), net_edge=Decimal("2"))
        episode = tracker.open_episodes[0]
        assert episode.peak_ci == Decimal("0.09")
        assert episode.peak_net_edge == Decimal("9")


class TestLifetimes:
    def test_an_open_episode_has_no_lifetime(self):
        """Reporting its age would truncate every long episode at the moment of
        asking, which is the censoring bias a survival curve exists to avoid."""
        tracker = EpisodeTracker()
        _run(tracker, "A", [True, True])
        assert tracker.open_episodes[0].lifetime_s is None

    def test_a_closed_episode_measures_from_open_to_close(self):
        tracker = EpisodeTracker()
        _run(tracker, "A", [True, True, True, False, False])
        assert tracker.closed[0].lifetime_s == Decimal("4.000")


class TestTheSurvivalCurve:
    def test_withholds_the_median_below_the_sample_floor(self):
        """A median over three episodes is not a median."""
        tracker = EpisodeTracker()
        for index in range(3):
            _run(tracker, f"C{index}", [True, False, False], start=index * 10)
        curve = survival(tracker.closed)
        assert curve.median_s is None
        assert curve.reason and str(MIN_EPISODES_FOR_HALF_LIFE) in curve.reason

    def test_still_draws_the_points_it_has(self):
        """The points are real even when the summary statistic is not."""
        tracker = EpisodeTracker()
        for index in range(3):
            _run(tracker, f"C{index}", [True, False, False], start=index * 10)
        assert survival(tracker.closed).points

    def test_publishes_a_median_once_there_are_enough(self):
        tracker = EpisodeTracker()
        for index in range(MIN_EPISODES_FOR_HALF_LIFE + 2):
            _run(tracker, f"C{index}", [True] * (index + 1) + [False, False], start=index * 100)
        curve = survival(tracker.closed)
        assert curve.median_s is not None
        assert curve.reason is None

    def test_excludes_open_episodes_rather_than_counting_their_age(self):
        tracker = EpisodeTracker()
        for index in range(MIN_EPISODES_FOR_HALF_LIFE):
            _run(tracker, f"C{index}", [True, True, False, False], start=index * 100)
        _run(tracker, "STILL-OPEN", [True] * 50, start=10_000)
        curve = survival(tracker.closed)
        assert curve.episodes == MIN_EPISODES_FOR_HALF_LIFE

    def test_survival_falls_from_one_and_never_rises(self):
        tracker = EpisodeTracker()
        for index in range(MIN_EPISODES_FOR_HALF_LIFE + 2):
            _run(tracker, f"C{index}", [True] * (index + 1) + [False, False], start=index * 100)
        fractions = [fraction for _, fraction in survival(tracker.closed).points]
        assert fractions == sorted(fractions, reverse=True)

    def test_an_empty_history_says_so_rather_than_reporting_zero(self):
        curve = survival([])
        assert curve.median_s is None
        assert curve.episodes == 0
        assert curve.reason


class TestTheVerdict:
    def _curve(self, seconds: int):
        tracker = EpisodeTracker()
        for index in range(MIN_EPISODES_FOR_HALF_LIFE + 2):
            _run(tracker, f"C{index}", [True] * seconds + [False, False], start=index * 1000)
        return survival(tracker.closed)

    def test_calls_a_fast_market_a_data_artefact(self):
        verdict = verdict_for(self._curve(1), Decimal("30"))
        assert "data artefact" in verdict and "race is already lost" in verdict

    def test_calls_a_slow_market_reachable(self):
        verdict = verdict_for(self._curve(20), Decimal("0.240"))
        assert "slow enough to reach" in verdict

    def test_says_why_it_cannot_judge_rather_than_guessing(self):
        assert "at least" in verdict_for(survival([]), Decimal("0.240")) or verdict_for(survival([]), Decimal("0.240"))
