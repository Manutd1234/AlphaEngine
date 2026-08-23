"""Headline arrivals as a cascade, and the precision it is allowed to claim.

The failure this file guards against is a number that looks finer than the
instrument that produced it: a media half-life in seconds read off a poller
that fires every fifteen minutes, or a growth figure of zero that is really an
empty window.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.coherence.diffusion.media import MIN_ARRIVALS, cascade, coherence

T0 = 1_700_000_000_000.0


def _items(offsets_s, *, latency_s: float = 0.0):
    return [{"published_at": T0 + offset * 1000.0,
             "first_seen_at": T0 + (offset + latency_s) * 1000.0} for offset in offsets_s]


class TestAnEmptyWindowIsAStateNotAZero:
    def test_no_headline_is_no_headlines(self):
        got = cascade([], T0)
        assert got.state == "no_headlines"
        assert got.log_growth is None, "log1p(0) - log1p(0) is 0.0 and means nothing"
        assert got.half_life_first_seen_s is None

    def test_too_few_arrivals_is_refused_with_the_floor(self):
        got = cascade(_items([10, 20, 30]), T0)
        assert got.state == "insufficient"
        assert str(MIN_ARRIVALS) in (got.reason or "")
        assert got.half_life_first_seen_s is None

    def test_headlines_outside_the_window_do_not_count(self):
        got = cascade(_items([10, 20, 30, 40, 50, 10_000_000]), T0, prediction_s=86_400)
        assert got.arrivals == 5

    def test_a_headline_before_the_event_is_not_a_response_to_it(self):
        got = cascade(_items([-500, 10, 20, 30, 40, 50]), T0)
        assert got.arrivals == 5


class TestTheCascadeDescribesItsGrowth:
    def test_growth_is_the_log_ratio_between_the_two_windows(self):
        got = cascade(_items([10, 20, 30, 40, 50, 7_000, 8_000]), T0,
                      observation_s=3_600, prediction_s=86_400)
        assert got.size_at_observation == 5 and got.size_at_prediction == 7
        assert got.log_growth == pytest.approx(float(np.log1p(7) - np.log1p(5)))

    def test_a_cascade_that_did_not_grow_reads_zero_and_is_not_empty(self):
        got = cascade(_items([10, 20, 30, 40, 50]), T0, observation_s=3_600)
        assert got.state == "ok" and got.log_growth == pytest.approx(0.0)
        assert got.arrivals == 5, "zero growth over five arrivals is a measurement"


class TestTheHalfLifeIsInterpolatedNotSnapped:
    def test_it_lands_between_the_bracketing_arrivals(self):
        got = cascade(_items([0, 100, 200, 300, 400, 500]), T0)
        assert got.half_life_first_seen_s == pytest.approx(250.0)

    def test_an_odd_count_lands_on_the_middle_arrival(self):
        got = cascade(_items([0, 100, 200, 300, 400]), T0)
        assert got.half_life_first_seen_s == pytest.approx(200.0)

    def test_a_faster_cascade_halves_sooner(self):
        quick = cascade(_items([1, 2, 3, 4, 5, 6]), T0)
        slow = cascade(_items([100, 200, 300, 400, 500, 600]), T0)
        assert quick.half_life_first_seen_s < slow.half_life_first_seen_s


class TestBothClocksAreReportedBecauseTheyDiffer:
    def test_vendor_latency_is_the_gap_between_them(self):
        got = cascade(_items([10, 20, 30, 40, 50, 60], latency_s=45.0), T0)
        assert got.half_life_first_seen_s > got.half_life_published_s
        assert got.vendor_latency_s == pytest.approx(45.0)

    def test_with_no_publication_stamp_the_published_clock_is_none(self):
        items = [{"first_seen_at": T0 + i * 1000.0, "published_at": None} for i in range(1, 8)]
        got = cascade(items, T0)
        assert got.state == "ok"
        assert got.half_life_published_s is None and got.vendor_latency_s is None

    def test_the_poll_resolution_travels_with_the_number(self):
        got = cascade(_items([10, 20, 30, 40, 50, 60]), T0, resolution_s=900.0)
        assert got.resolution_s == 900.0, (
            "a half-life of ninety seconds off a fifteen-minute poller is not ninety seconds"
        )


class TestCoherenceNeedsBothSidesAndAName:
    def test_too_few_shared_events_is_refused_with_the_count(self):
        got = coherence({"a": 1.0}, {"a": 2.0}, min_events=12)
        assert got.state == "insufficient" and "1 of 12" in (got.reason or "")

    def test_a_perfect_rank_agreement_is_one(self):
        price = {f"e{i}": float(i) for i in range(14)}
        media = {f"e{i}": float(i) * 3 + 1 for i in range(14)}
        got = coherence(price, media, min_events=12)
        assert got.state == "ok" and got.rho == pytest.approx(1.0)

    def test_the_shuffled_figure_is_reported_beside_the_real_one(self):
        price = {f"e{i}": float(i) for i in range(20)}
        media = {f"e{i}": float(i) for i in range(20)}
        got = coherence(price, media, min_events=12)
        assert got.shuffled_rho is not None
        assert got.shuffled_rho < abs(got.rho)

    def test_only_events_with_both_halves_are_counted(self):
        price = {f"e{i}": float(i) for i in range(20)}
        media = {f"e{i}": float(i) for i in range(14)}
        assert coherence(price, media, min_events=12).n == 14
