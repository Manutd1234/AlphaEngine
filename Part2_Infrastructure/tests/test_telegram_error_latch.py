"""`last_error` is a latch, and a latched error painted the gateway amber.

`telegram.status` is `has_error` over `TelegramBot.health()`. It used to be one
of the four disjuncts behind `platform.status`, which is how a latched error
reached the Developer console's gateway card and, through it, the web's TRADING
verdict — a category error now fixed in `tests/test_notification_plane.py`. The
companion reports on its own notification plane instead, but this latch is still
what decides whether that plane reads degraded, so clearing it still matters.

`last_error` was assigned in exactly two places and cleared in none. The bot
runs a 25-second `getUpdates` long poll against api.telegram.org for the life
of the process, so a single ReadTimeout, one 502 from Telegram's edge or one
DNS blip set it once and it stayed set — and the gateway card stayed amber
until someone restarted the process. Nothing was wrong by then: `_post`
retries and the next poll succeeds.

`VenueFeed._mark_connected` (`tca_engine.py:477`) already does the opposite
and clears its own `last_error` on a good connect. This asserts `_post` does
the same, so recovery is observable rather than requiring a restart.
"""

from __future__ import annotations

import pytest

from modules.telegram import TelegramBot


@pytest.mark.asyncio
async def test_a_success_clears_a_previous_transport_error(bot):
    """One blip, then recovery — the bot must stop reporting the blip."""

    class FlakyClient:
        def __init__(self) -> None:
            self.calls = 0

        async def post(self, *_args, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("connection reset")
            return _Ok()

    class _Ok:
        @staticmethod
        def json() -> dict[str, object]:
            return {"ok": True, "result": {}}

    bot._client = FlakyClient()  # type: ignore[assignment]

    await TelegramBot.api(bot, "getUpdates")
    assert bot.last_error is not None, "a transport failure must be recorded"
    assert "RuntimeError" in bot.last_error

    await TelegramBot.api(bot, "getUpdates")
    assert bot.last_error is None, (
        "the bot recovered and still reported the old error — this is what kept "
        "the gateway card amber for the life of the process"
    )


def test_operations_reads_the_latch_as_a_live_fault():
    """The latch matters because `operations.py` turns it into a reported status.

    Called on plain dicts rather than through the `bot` fixture on purpose:
    `StubBot.health()` is a double and is narrower than the real one, so a test
    routed through it would assert the double's shape, not the gateway's.
    """
    from modules.operations import _telegram_snapshot

    healthy = {"enabled": True, "uptime_s": 30.0, "last_error": None}
    blipped = {"enabled": True, "uptime_s": 30.0, "last_error": "getUpdates: transport ReadTimeout"}

    assert _telegram_snapshot(blipped).status == "degraded"
    assert _telegram_snapshot(healthy).status != "degraded", (
        "with the latch cleared on success, a recovered bot reports healthy and "
        "the notification plane goes green again without a restart"
    )
