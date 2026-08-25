"""The round trip in the episodes verdict is measured, and says when it is not.

**WHAT THIS REPLACES.** `/api/coherence/episodes` declared
`round_trip_s: str = Query(default="0.240")`. Nothing on the desk ever passed
it, so the gateway echoed its own default back and the figure drew "round trip
240ms" as though something had timed it — while `verdict_for` decided the
engine's honest gate against it: *if the median violation lifetime is under the
round trip, the opportunity was never available*. A number nobody measured was
deciding whether an opportunity existed.

Four properties, and the third is the one that keeps this honest rather than
merely better:

**A FAILED CALL IS NOT A MEASUREMENT.** A read that timed out at eight seconds
measures this client's patience, not the venue's speed. Recording it would drag
the median toward the timeout and make every opportunity look untradeable —
which is the safe-looking direction and still a lie.

**NOTHING TIMED IS NOT ZERO, AND NOT 240ms EITHER.** Before any read lands the
window has no median, and the route says `assumed` rather than inventing one.
"We have not timed this" and "we timed it and it is 240ms" are different answers.

**A READ IS A LOWER BOUND ON AN ORDER.** An order carries a signature, is
written rather than read, and queues behind a matching engine. So a verdict
computed from a measured read is OPTIMISTIC, and `round_trip_source` travels
with the number precisely so no surface can present it as the cost of trading
without knowing which it has.

**THE OVERRIDE STILL WORKS AND STILL SAYS SO.** A caller passing their own
figure gets `assumed`, because their number is not this deployment's
measurement either.

Written before the implementation, per the slice's RED step.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.api import coherence_history as route_module
from modules.coherence import latency


@pytest.fixture(autouse=True)
def clean_window():
    """Each test owns the window; one suite's reads must not reach another."""
    latency.reset()
    yield
    latency.reset()


class TestTheWindow:
    def test_nothing_timed_has_no_median(self) -> None:
        # None rather than a default. The caller decides what to do without a
        # measurement; it does not get one invented here.
        assert latency.median_s() is None
        assert latency.count() == 0

    def test_it_reports_the_median_not_the_mean(self) -> None:
        # One slow call must not move the answer. A mean over these five is
        # 1.6448s; the median is 0.24s.
        for seconds in (0.20, 0.22, 0.24, 0.26, 8.0):
            latency.record(seconds)

        assert latency.median_s() == Decimal("0.24")
        assert latency.count() == 5

    def test_a_failed_call_records_nothing(self) -> None:
        # Guarded at the source: a non-positive or NaN duration is not a read.
        latency.record(0)
        latency.record(-1)
        latency.record(float("nan"))

        assert latency.count() == 0
        assert latency.median_s() is None

    def test_the_window_forgets(self) -> None:
        # The venue's latency is not stationary, so a mean over all history
        # describes a network that no longer exists.
        for index in range(latency.WINDOW + 50):
            latency.record(1.0 if index < 50 else 0.5)

        assert latency.count() == latency.WINDOW
        assert latency.median_s() == Decimal("0.5"), "the oldest reads were not the ones dropped"

    def test_it_is_quantised_to_a_millisecond(self) -> None:
        # A round trip reported to the microsecond over a public network claims
        # a precision the measurement does not have.
        latency.record(0.2374829)

        assert latency.median_s() == Decimal("0.237")


class TestTheVerdictUsesIt:
    @staticmethod
    async def ask(monkeypatch, override=None):
        class EmptyStore:
            def episodes(self, series_ticker=None, limit=500):
                return []
        monkeypatch.setattr(route_module, "get_store", lambda: EmptyStore())
        return await route_module.coherence_episodes(
            series=None, limit=10, round_trip_s=override, _actor="test"
        )

    @pytest.mark.asyncio
    async def test_an_untimed_deployment_says_assumed(self, monkeypatch) -> None:
        answer = await self.ask(monkeypatch)

        assert answer.round_trip_source == "assumed"
        assert answer.round_trip_s == "0.240"
        assert answer.round_trip_samples == 0, "a figure nobody measured must not claim a sample count"

    @pytest.mark.asyncio
    async def test_a_timed_deployment_uses_its_own_median(self, monkeypatch) -> None:
        for seconds in (0.30, 0.32, 0.34):
            latency.record(seconds)

        answer = await self.ask(monkeypatch)

        assert answer.round_trip_source == "measured"
        assert answer.round_trip_s == "0.32"
        assert answer.round_trip_samples == 3

    @pytest.mark.asyncio
    async def test_a_callers_override_is_still_assumed(self, monkeypatch) -> None:
        # Their number is not this deployment's measurement either.
        latency.record(0.30)

        answer = await self.ask(monkeypatch, override="1.500")

        assert answer.round_trip_s == "1.500"
        assert answer.round_trip_source == "assumed"
        assert answer.round_trip_samples == 0

    @pytest.mark.asyncio
    async def test_an_unparseable_override_falls_back_to_the_measurement(self, monkeypatch) -> None:
        # Not to the constant: a deployment that HAS timed itself should not be
        # pushed back onto a number nobody took because a caller sent nonsense.
        latency.record(0.30)

        answer = await self.ask(monkeypatch, override="not-a-number")

        assert answer.round_trip_source == "measured"
        assert answer.round_trip_s == "0.3"
