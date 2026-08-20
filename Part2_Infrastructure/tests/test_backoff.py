"""The shape four hand-rolled loops each wrote separately."""

from __future__ import annotations

import pytest

from modules.backoff import Backoff


class TestTheCurve:
    def test_healthy_waits_the_base_interval(self):
        assert Backoff(base_s=2.5, ceiling_s=30.0).delay_s == 2.5

    def test_it_doubles_per_consecutive_failure(self):
        b = Backoff(base_s=1.0, ceiling_s=64.0)
        assert [b.failed() for _ in range(4)] == [2.0, 4.0, 8.0, 16.0]

    def test_the_ceiling_holds(self):
        b = Backoff(base_s=1.0, ceiling_s=30.0)
        for _ in range(50):
            b.failed()
        assert b.delay_s == 30.0, "an uncapped curve reaches hours and the loop is dead in silence"

    def test_a_very_long_outage_does_not_overflow_before_the_clamp(self):
        b = Backoff(base_s=1.0, ceiling_s=30.0)
        b.failures = 5_000
        assert b.delay_s == 30.0


class TestRecovery:
    def test_success_restores_the_base_immediately(self):
        b = Backoff(base_s=1.0, ceiling_s=30.0)
        for _ in range(3):
            b.failed()
        assert b.delay_s > 1.0
        b.succeeded()
        assert b.delay_s == 1.0, "a recovered loop is still reporting an outage that has ended"


class TestExhaustion:
    def test_it_says_when_it_has_stopped_recovering(self):
        b = Backoff(base_s=1.0, ceiling_s=4.0)
        assert not b.exhausted
        for _ in range(2):
            b.failed()
        assert b.exhausted


class TestRefusals:
    @pytest.mark.parametrize(("base", "ceiling"), [(0.0, 10.0), (-1.0, 10.0), (10.0, 1.0)])
    def test_a_nonsense_configuration_is_refused_at_construction(self, base, ceiling):
        with pytest.raises(ValueError):
            Backoff(base_s=base, ceiling_s=ceiling)
