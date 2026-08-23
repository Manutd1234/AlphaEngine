"""Two long-pollers on one bot token, and what each side should say about it.

Observed 2026-08-23: the deployed gateway and a developer's laptop gateway were
started from the same ``.env`` and both ran ``TELEGRAM_MODE=polling``. Telegram
hands a bot's updates to exactly one ``getUpdates`` consumer, so the two took
turns being refused with ``409 Conflict: terminated by other getUpdates
request`` — and because each refusal latches ``last_error`` on whichever
instance lost, BOTH reported the notification plane degraded for 13 hours, and
the desk's Triage list called it "a transport error". It was not one: the
network was fine and Telegram answered every call.

Three things fixed, three things asserted:

1. ``_post`` classifies the failure (``last_error_kind``), and a 409 on
   ``getUpdates`` is a ``conflict``, not an ``api`` refusal and not ``transport``.
2. The poll loop, on a conflict, waits the full 30 seconds rather than retrying
   in one — a one-second retry only takes the poll off the other instance and
   hands the 409 straight back.
3. ``TELEGRAM_MODE=send-only`` starts the alert loops and no poll, so a second
   process can keep the token for outbound alerts without contending for the
   updates at all. The operations snapshot carries the kind to the web.
"""

from __future__ import annotations

import asyncio

import pytest

from modules.operations import _telegram_snapshot
from modules.telegram import TelegramBot
from modules.telegram.transport import _is_poll_conflict

CONFLICT = {
    "ok": False,
    "error_code": 409,
    "description": "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
}


class _Answer:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _Client:
    """Answers every POST with the next scripted payload, or raises it."""

    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.calls = 0

    async def post(self, *_args, **_kwargs):
        self.calls += 1
        item = self.script.pop(0) if self.script else {"ok": True, "result": []}
        if isinstance(item, BaseException):
            raise item
        return _Answer(item)


class TestTheKindOfError:
    def test_a_409_on_getupdates_is_a_conflict(self):
        assert _is_poll_conflict("getUpdates", CONFLICT)
        assert _is_poll_conflict("getUpdates", {"ok": False, "description": "Conflict: terminated by other getUpdates request"})

    def test_a_409_elsewhere_is_not(self):
        """setWebhook can 409 too; that is a different mistake with a different remedy."""
        assert not _is_poll_conflict("setWebhook", CONFLICT)
        assert not _is_poll_conflict("getUpdates", {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"})

    @pytest.mark.asyncio
    async def test_post_records_the_kind_beside_the_text(self, bot):
        bot._client = _Client([CONFLICT, RuntimeError("connection reset"), {"ok": False, "description": "Bad Request: chat not found"}, {"ok": True, "result": []}])

        await TelegramBot.api(bot, "getUpdates")
        assert bot.last_error_kind == "conflict"
        assert "Conflict" in (bot.last_error or "")

        await TelegramBot.api(bot, "getUpdates")
        assert bot.last_error_kind == "transport"

        await TelegramBot.api(bot, "sendMessage", chat_id="1", text="x")
        assert bot.last_error_kind == "api"

        await TelegramBot.api(bot, "getUpdates")
        assert bot.last_error is None and bot.last_error_kind is None, "a success clears both halves of the latch"


class TestThePollLoopOnAConflict:
    @pytest.mark.asyncio
    async def test_waits_the_full_thirty_seconds_rather_than_snatching_the_poll_back(self, bot, monkeypatch):
        bot._client = _Client([CONFLICT, CONFLICT])
        sleeps: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)
            if len(sleeps) == 2:
                raise asyncio.CancelledError

        monkeypatch.setattr("modules.telegram.runtime.asyncio.sleep", fake_sleep)
        # Restore the real transport on the stub, which otherwise answers ok to everything.
        monkeypatch.setattr(type(bot), "api", TelegramBot.api)

        with pytest.raises(asyncio.CancelledError):
            await TelegramBot._poll_loop(bot)

        assert sleeps == [30.0, 30.0], (
            "the first refusal must already wait 30s; the old 1s-then-double ladder "
            "took the poll off the other instance every second and kept both degraded"
        )

    @pytest.mark.asyncio
    async def test_an_ordinary_failure_still_climbs_the_ladder(self, bot, monkeypatch):
        bot._client = _Client([{"ok": False, "description": "Bad Gateway"}] * 3)
        sleeps: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)
            if len(sleeps) == 3:
                raise asyncio.CancelledError

        monkeypatch.setattr("modules.telegram.runtime.asyncio.sleep", fake_sleep)
        monkeypatch.setattr(type(bot), "api", TelegramBot.api)

        with pytest.raises(asyncio.CancelledError):
            await TelegramBot._poll_loop(bot)

        assert sleeps == [1.0, 2.0, 4.0]


class TestSendOnlyMode:
    @pytest.mark.asyncio
    async def test_starts_the_alert_loops_and_no_poll(self, bot, monkeypatch):
        bot.mode = "send-only"
        started: list[str] = []

        def fake_create_task(coro, *, name=None):
            started.append(name or "")
            coro.close()
            return None

        monkeypatch.setattr("modules.telegram.runtime.asyncio.create_task", fake_create_task)

        await TelegramBot.start(bot)

        methods = [method for method, _ in bot.api_calls]
        assert methods == ["getMe"], f"send-only must neither poll, set a webhook nor register commands; called {methods}"
        assert "telegram-poll" not in started
        assert {"telegram-watch", "telegram-risk", "telegram-live"} <= set(started), "the outbound alert loops still run"
        assert bot.health()["mode"] == "send-only"

    def test_the_mode_is_accepted_by_config(self, monkeypatch):
        from config import Settings

        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "999:TEST")
        monkeypatch.setenv("TELEGRAM_MODE", "send-only")
        assert Settings().resolved_telegram_mode == "send-only"


class TestTheSnapshotCarriesTheKind:
    def test_a_conflict_reaches_the_wire_as_a_conflict(self):
        snapshot = _telegram_snapshot({"enabled": True, "uptime_s": 30.0, "last_error": "getUpdates: Conflict: …", "last_error_kind": "conflict"})
        assert snapshot.status == "degraded"
        assert snapshot.last_error_kind == "conflict"

    def test_no_error_means_no_kind(self):
        """A stale kind beside a cleared error would be the latch bug again, one field over."""
        snapshot = _telegram_snapshot({"enabled": True, "uptime_s": 30.0, "last_error": None, "last_error_kind": "conflict"})
        assert snapshot.status == "running"
        assert snapshot.last_error_kind is None

    def test_an_older_bot_without_a_kind_is_degraded_and_unclassified(self):
        snapshot = _telegram_snapshot({"enabled": True, "uptime_s": 30.0, "last_error": "boom"})
        assert snapshot.status == "degraded"
        assert snapshot.last_error_kind is None

    def test_the_text_itself_stays_off_the_wire(self):
        """The ops snapshot is proxied to a public origin; the kind travels, Telegram's words do not."""
        snapshot = _telegram_snapshot({"enabled": True, "uptime_s": 30.0, "last_error": "sendMessage: Forbidden: bot was blocked", "last_error_kind": "api"})
        assert "Forbidden" not in snapshot.model_dump_json()
