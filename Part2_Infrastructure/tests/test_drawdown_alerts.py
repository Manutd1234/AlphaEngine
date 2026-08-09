"""The drawdown warning fires on the edge, not on every tick.

The monitor loop now runs at 1s rather than 5s so the circuit breaker reacts
sooner. That change is only safe because of what is tested here: the warning
used to alert on *every* tick the drawdown spent above 80% of the limit, which
was already ~720 Telegram messages an hour and would have become ~3,600.

A warning that repeats every second is not a warning. It is the reason the next
real one is ignored, and the alert transport is the same one the kill switch
uses.
"""

from __future__ import annotations

import asyncio
import contextlib

import pytest

from config import settings
from modules.risk_proxy import RiskGateway


@pytest.fixture
def gateway() -> RiskGateway:
    return RiskGateway(tca_engine=None, audit=None)


@pytest.fixture
def fast_monitor():
    """Shrink the tick so a 60-iteration test runs in milliseconds.

    `settings` is a frozen dataclass — configuration is immutable by design, and
    that is worth preserving rather than working around, so this reaches through
    `object.__setattr__` and puts the real value back afterwards. The interval
    is the only thing being faked; the loop under test is the real one.
    """
    original = settings.risk_monitor_interval_s
    object.__setattr__(settings, "risk_monitor_interval_s", 0.001)
    yield
    object.__setattr__(settings, "risk_monitor_interval_s", original)


def drive(gw: RiskGateway, drawdowns: list[float]) -> list[tuple[str, str]]:
    """Feed a drawdown sequence through the **real** `_monitor_loop`.

    Deliberately not a reimplementation of the loop's branch. A test that
    restates the logic it is checking passes whenever the copy is
    self-consistent, including when production has drifted away from it — which
    for alert-suppression means the test still looks green while the desk has
    gone silent. So this runs the actual coroutine and only stubs its inputs:
    the drawdown reading, and the two side effects that need a real audit store.
    """
    seen: list[tuple[str, str]] = []
    remaining = list(drawdowns)

    async def capture(severity: str, message: str) -> None:
        seen.append((severity, message))

    def next_drawdown() -> float:
        # Ends the loop deterministically once the sequence is spent, rather
        # than relying on a timeout to decide when the test is over.
        if not remaining:
            raise asyncio.CancelledError
        return remaining.pop(0)

    gw._alert_hooks = [capture]
    gw.daily_drawdown_pct = next_drawdown          # type: ignore[method-assign]
    gw.snapshot_equity = lambda: None              # type: ignore[method-assign]

    async def run() -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await gw._monitor_loop()

    asyncio.run(asyncio.wait_for(run(), timeout=10))
    return seen


def test_one_warning_no_matter_how_long_it_stays_in_the_band(gateway, fast_monitor):
    limit = settings.max_daily_drawdown_pct
    # Sixty consecutive ticks inside the warning band: one minute at the new
    # cadence. The old code produced sixty alerts.
    alerts = drive(gateway, [limit * 0.85] * 60)
    assert len(alerts) == 1, f"{len(alerts)} alerts for one continuous breach"
    assert alerts[0][0] == "warning"


def test_hysteresis_stops_a_drawdown_on_the_threshold_from_flapping(gateway, fast_monitor):
    limit = settings.max_daily_drawdown_pct
    # Oscillating either side of the 80% trigger. Without a lower rearm point
    # this alternates warn/recover once per tick, which at 1s is worse than the
    # bug it replaced.
    alerts = drive(gateway, [limit * 0.81, limit * 0.79] * 25)
    assert len(alerts) == 1, "the alert flapped across the trigger threshold"


def test_it_rearms_once_the_drawdown_genuinely_recovers(gateway, fast_monitor):
    limit = settings.max_daily_drawdown_pct
    alerts = drive(gateway, [
        limit * 0.85,   # warn
        limit * 0.85,   # silent
        limit * 0.50,   # recovered, below the 70% rearm
        limit * 0.85,   # a genuinely new breach must warn again
    ])
    assert [a[0] for a in alerts] == ["warning", "info", "warning"]


def test_a_new_session_starts_unwarned(gateway):
    """Otherwise a desk that ended yesterday in the band stays silent today.

    The latch is session state, and every other piece of session state is reset
    at the rollover. Leaving this one set would suppress the first real warning
    of a new trading day — silence that looks exactly like safety.
    """
    gateway._drawdown_warned = True
    gateway.session_date = "1970-01-01"
    gateway._roll_session_if_needed()
    assert gateway._drawdown_warned is False


def test_the_monitor_interval_is_configurable_and_defaults_to_one_second():
    """1s is the desk's reaction time to its own losses, and the floor for how
    fresh any pushed P&L can be — streaming faster only re-sends one number."""
    assert settings.risk_monitor_interval_s == pytest.approx(1.0)
