"""Telegram is a notification companion, not a component of the order path.

The desk was told "Trading path: Degraded" because a chat transport hiccuped.
The chain was three links long: ``_telegram_snapshot`` folded a latched
``last_error`` into a degraded Telegram status, ``build_operations_snapshot``
folded *that* into ``platform.status``, and the web's ``tradingPosture`` read
the rollup. Nothing on the order path had moved — the risk gateway still gated,
market data still flowed, orders still routed.

The obvious fix was the wrong one. Telegram had no other surface on the web, so
deleting the clause would have swapped a false alarm for a silent failure, and
this codebase reports empty and unavailable results rather than hiding them.
So the clause is gone from the rollup *and* the companion reports on a
notification plane of its own — ``notificationsPosture`` in
``web/lib/reliability.ts``, rendered beside the trading and research planes.

``tests/degraded-cause.test.ts`` guards the same boundary from the web side.
"""

from __future__ import annotations

from types import SimpleNamespace

from modules.operations import _telegram_snapshot, build_operations_snapshot

_NOMINAL_FEED = {
    "venue": "binance",
    "connected": True,
    "uptime_s": 600.0,
    "symbols": {"BTCUSDT": {"age_s": 0.2, "updates": 300, "rate_hz": 4.0, "stale": False}},
}


def _snapshot(telegram: dict[str, object], **overrides: object):
    """One healthy deployment, with only the named thing varied."""
    market = {"enabled": True, "uptime_s": 600.0, "feeds": [_NOMINAL_FEED]}
    market.update(overrides.get("market", {}))  # type: ignore[arg-type]
    risk = SimpleNamespace(
        halted_symbols=[], kill_switch_active=False,
        reduce_only=bool(overrides.get("reduce_only")),
        orders_accepted=0, orders_rejected=0, working_orders=0,
        orders_last_second=0.0, daily_drawdown_pct=0.0,
        drawdown_budget_used_pct=0.0, equity=0.0, gross_exposure=0.0,
    )
    queue = dict({"backend": "celery", "workers": 1, "broker_configured": True}, **overrides.get("queue", {}))  # type: ignore[arg-type]
    return build_operations_snapshot(
        tca=SimpleNamespace(health=lambda: market),
        gateway=SimpleNamespace(state=lambda: risk),
        queue=SimpleNamespace(stats=lambda: queue),
        audit=SimpleNamespace(health=lambda: {"backend": "duckdb", "available": True}),
        bot=SimpleNamespace(health=lambda: telegram),
    )


class TestTheCategoryError:
    """A chat-transport blip may not describe the money path."""

    def test_a_telegram_outage_leaves_the_platform_rollup_nominal(self):
        snapshot = _snapshot({"enabled": True, "uptime_s": 42.0, "last_error": "getUpdates: ReadTimeout"})
        assert snapshot.status == "nominal", (
            "a Telegram error reached platform.status again — that is the chain "
            "that told a trader their TRADING path was degraded"
        )

    def test_the_outage_is_still_reported_on_the_wire(self):
        """Not lying is not the same as saying nothing."""
        snapshot = _snapshot({"enabled": True, "uptime_s": 42.0, "last_error": "getUpdates: ReadTimeout"})
        assert snapshot.telegram.status == "degraded"
        assert snapshot.telegram.last_error_present is True

    def test_the_rollup_still_degrades_for_conditions_that_are_on_the_order_path(self):
        """The clause was removed, not the rollup. These three must still fire."""
        assert _snapshot({"enabled": False}, market={"enabled": False}).status == "degraded"
        assert _snapshot({"enabled": False}, reduce_only=True).status == "degraded"
        assert _snapshot({"enabled": False}, queue={"backend": "in-process"}).status == "degraded"


class TestStartingIsNotDegraded:
    """An enabled bot with no error that has not finished starting is starting."""

    def test_no_uptime_and_no_error_is_starting(self):
        assert _telegram_snapshot({"enabled": True, "uptime_s": 0.0, "last_error": None}).status == "starting"

    def test_an_error_is_still_degraded(self):
        assert _telegram_snapshot({"enabled": True, "uptime_s": 30.0, "last_error": "boom"}).status == "degraded"

    def test_a_started_bot_is_running(self):
        assert _telegram_snapshot({"enabled": True, "uptime_s": 30.0, "last_error": None}).status == "running"

    def test_a_bot_that_is_off_is_disabled_not_starting(self):
        """Off is a configuration; starting is a moment. They are not the same."""
        assert _telegram_snapshot({"enabled": False, "uptime_s": 0.0}).status == "disabled"

    def test_a_starting_bot_does_not_degrade_the_platform(self):
        assert _snapshot({"enabled": True, "uptime_s": 0.0, "last_error": None}).status == "nominal"
