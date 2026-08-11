"""The registry floor: every command in the catalogue must actually answer.

Two defects motivated this file. `/backtest` was advertised in a card and in a
Next chain without a spec behind it, so a reader following the prompt reached
the unknown-command path. And roughly a third of the registry — the whole Risk
category among it — had no test at all, so a handler could raise on its first
real invocation and nothing would have noticed until a user found it.

The floor here is deliberately low and total: dispatch **every** spec's own
documented example and require a reply that is neither "Unknown command" nor
the generic failure card. An honest refusal counts as an answer — `/halt` with
no control allowlist replies with the allow-list card, `/job abcd` replies NOT
FOUND — because the contract is "the command works", not "the desk is in a
particular state". Depth lives in the targeted tests beside it; this catches
the class of bug where a spec exists and its handler does not.
"""

import pytest
from test_telegram import update

from modules.telegram import COMMAND_SPECS, TelegramBot


def test_every_spec_example_invokes_its_own_command():
    """`example` is documentation *and* the floor's input, so it must match.

    A spec whose example demonstrates a different command would silently test
    that other command twice and this one never.
    """
    for spec in COMMAND_SPECS:
        first = spec.example.split()[0]
        assert first == f"/{spec.name}", (
            f"/{spec.name} documents an example that invokes {first}"
        )


def test_every_handler_named_by_a_spec_exists():
    """Dispatch is `getattr(self, spec.handler)`, so a typo is a runtime 404."""
    for spec in COMMAND_SPECS:
        assert hasattr(TelegramBot, spec.handler), (
            f"/{spec.name} names handler {spec.handler}, which does not exist"
        )


@pytest.mark.asyncio
async def test_every_registered_command_answers_without_error(bot, fake_market_data):
    """Dispatch the whole catalogue and require a non-error reply from each."""
    failures: list[str] = []
    for index, spec in enumerate(COMMAND_SPECS, start=1000):
        bot.sent.clear()
        # The inbound limiter allows 15 commands per user per 10 seconds. Left
        # in place, iteration 16 onwards would be refused for rate rather than
        # for anything about the command — a flake that would look like a bug
        # in whichever command happened to land there.
        bot._rate_windows.clear()

        await bot.handle_update(update(spec.example, update_id=index))

        if not bot.sent:
            failures.append(f"/{spec.name}: no reply at all")
            continue
        reply = " ".join(bot.sent)
        if "Unknown command" in reply:
            failures.append(f"/{spec.name}: dispatched to the unknown-command path")
        elif "Command failed" in reply:
            failures.append(f"/{spec.name}: handler raised — {reply[:120]}")

    assert not failures, "commands that do not answer:\n" + "\n".join(failures)


@pytest.mark.asyncio
async def test_unauthorised_users_reach_only_the_bootstrap_commands(bot):
    """The floor must not be mistaken for an open door."""
    from modules.telegram import _BOOTSTRAP_COMMANDS

    for index, spec in enumerate(COMMAND_SPECS, start=2000):
        # The set stores the invocation, slash included.
        if f"/{spec.name}" in _BOOTSTRAP_COMMANDS:
            continue
        bot.sent.clear()
        bot._rate_windows.clear()
        await bot.handle_update(
            update(spec.example, user_id="999999", chat_id="999999", update_id=index)
        )
        reply = " ".join(bot.sent)
        assert "not authorised" in reply.lower() or "whoami" in reply.lower(), (
            f"/{spec.name} answered an unauthorised user: {reply[:160]}"
        )


@pytest.mark.asyncio
async def test_rate_limited_sends_wait_the_time_telegram_asks_for(bot, monkeypatch):
    """A 429 is honoured once, bounded, and never leaks the token.

    Chart commands answer with an album plus a caption — several sends in a
    burst — so 429 is a normal condition rather than an exotic one. Before
    this, the transport treated it as a plain failure and dropped the reply.
    """
    import modules.telegram as telegram_module

    slept: list[float] = []

    async def record_sleep(seconds):
        slept.append(seconds)

    class RateLimitedClient:
        """Refuses once with retry_after, then accepts."""

        def __init__(self):
            self.calls = 0

        async def post(self, url, **kwargs):
            self.calls += 1

            class Response:
                def __init__(self, payload):
                    self._payload = payload

                def json(self):
                    return self._payload

            if self.calls == 1:
                return Response({"ok": False, "error_code": 429,
                                 "description": "Too Many Requests",
                                 "parameters": {"retry_after": 3}})
            return Response({"ok": True, "result": {}})

    monkeypatch.setattr(telegram_module.asyncio, "sleep", record_sleep)
    client = RateLimitedClient()
    bot._client = client

    result = await telegram_module.TelegramBot._post(
        bot, "sendMessage", json_body={"chat_id": 1, "text": "hi"}, chat_id=1,
    )

    assert result["ok"] is True, "the retry must deliver the message"
    assert client.calls == 2, "exactly one retry, not a loop"
    assert 3 in slept, "waited the interval Telegram asked for"
    assert all(value <= 15 for value in slept), "retry_after stays bounded"
    assert "999:TEST" not in (bot.last_error or ""), "token never reaches last_error"
