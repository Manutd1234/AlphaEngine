"""Planning a capture around an event, and knowing when it is too late.

The constraint the whole earnings arm lives under: a free equity minute bar is
served for about five days and then it is gone. A plan that does not model that
either fetches nothing useful or retries forever against a vendor that will
never answer, and both look like a working scheduler.
"""

from __future__ import annotations

from modules.coherence.diffusion.capture import MINUTE_REACH_DAYS, CaptureRequest, plan_captures

DAY = 86_400_000
RELEASE = 1_700_000_000_000.0


def _event(**overrides) -> dict:
    event = {"source_ref": "yf:AVGO:2026-09-02", "symbol": "AVGO", "kind": "earnings",
             "release_at": RELEASE}
    event.update(overrides)
    return event


class TestTheWindowIsPlannedAroundTheEvent:
    def test_it_spans_the_days_asked_for(self):
        plan = plan_captures([_event()], now_ms=RELEASE + 3 * DAY, pre_days=1, post_days=2,
                             intervals=("1m",))
        request = plan.due[0]
        assert request.from_ms == RELEASE - DAY
        assert request.to_ms == RELEASE + 2 * DAY

    def test_one_request_per_symbol_and_interval(self):
        plan = plan_captures([_event()], now_ms=RELEASE + 3 * DAY, intervals=("1m", "15m"),
                             market_symbol="SPY")
        assert len(plan.due) == 4, "two symbols times two intervals"
        assert {r.symbol for r in plan.due} == {"AVGO", "SPY"}

    def test_the_benchmark_leg_is_captured_or_the_abnormal_return_is_impossible(self):
        plan = plan_captures([_event()], now_ms=RELEASE + 3 * DAY, intervals=("1m",),
                             market_symbol="SPY")
        assert "SPY" in {r.symbol for r in plan.due}, (
            "capturing the asset alone leaves market_adjusted false forever"
        )

    def test_a_macro_event_takes_the_macro_assets_rather_than_a_symbol(self):
        plan = plan_captures([_event(kind="fomc", symbol=None)], now_ms=RELEASE + 3 * DAY,
                             intervals=("1m",))
        assert {r.symbol for r in plan.due} == {"BTCUSDT", "ETHUSDT"}

    def test_the_key_is_stable_and_identifies_the_window(self):
        plan = plan_captures([_event()], now_ms=RELEASE + 3 * DAY, intervals=("1m",),
                             market_symbol="")
        assert plan.due[0].key == "coherence-capture-yf:AVGO:2026-09-02-AVGO-1m"


class TestTheThreeStatesAreDistinct:
    """One symbol only, so the counts are about the state and not the roster."""

    def test_before_the_window_closes_it_is_waiting_not_due(self):
        plan = plan_captures([_event()], now_ms=RELEASE + DAY, post_days=2, intervals=("1m",),
                             market_symbol="")
        assert plan.counts["waiting"] and not plan.counts["due"], (
            "submitting while the window is open reads the newest N bars, not the window"
        )

    def test_just_after_the_window_closes_it_is_due(self):
        plan = plan_captures([_event()], now_ms=RELEASE + 2 * DAY + 1, post_days=2,
                             intervals=("1m",), market_symbol="")
        assert plan.counts["due"] == 1

    def test_past_the_vendor_reach_a_minute_window_is_expired_with_the_reason(self):
        plan = plan_captures([_event()], now_ms=RELEASE + (MINUTE_REACH_DAYS + 3) * DAY,
                             post_days=2, intervals=("1m",), market_symbol="")
        assert plan.counts["expired"] == 1 and not plan.counts["due"]
        assert "cannot be captured now" in (plan.expired[0].reason or "")

    def test_a_coarser_interval_outlives_the_minute_reach(self):
        plan = plan_captures([_event()], now_ms=RELEASE + (MINUTE_REACH_DAYS + 3) * DAY,
                             post_days=2, intervals=("15m",), market_symbol="")
        assert plan.counts["due"] == 1, "only the minute feed has the five-day reach"


class TestTheRequestTranslatesToABackfill:
    def test_it_carries_iso_bounds_the_job_understands(self):
        request = CaptureRequest("yf:AVGO:2026-09-02", "AVGO", "1m", RELEASE, RELEASE + DAY,
                                 RELEASE + DAY)
        payload = request.as_backfill()
        assert payload["symbol"] == "AVGO" and payload["interval"] == "1m"
        assert payload["from_at"].endswith("+00:00") and payload["to_at"].endswith("+00:00")


class TestAnUndatableEventIsSkipped:
    def test_no_release_time_means_no_window(self):
        assert plan_captures([_event(release_at=None)], now_ms=RELEASE).counts == {
            "due": 0, "waiting": 0, "expired": 0}
