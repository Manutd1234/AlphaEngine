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
    # `_post` lives in `modules.telegram.transport`, and `monkeypatch.setattr`
    # binds to the module object that holds the reference. Patching
    # `modules.telegram` here would apply to nothing and the retry below would
    # really sleep three seconds — a passing test that measured the wall clock.
    import modules.telegram as telegram_module
    from modules.telegram import transport as transport_module

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

    monkeypatch.setattr(transport_module.asyncio, "sleep", record_sleep)
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


# ---------------------------------------------------------------------------
# Targeted content, for the categories the floor only proves *answer*.
#
# The floor asserts every command replies. These assert the reply says the
# right thing — chosen for the commands whose wrongness would be quietest: a
# risk figure with no sample behind it, a listing that renders an empty desk as
# a healthy one, a market card whose statistics contradict its own bars.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestRiskCategoryAnswersHonestly:
    """The whole Risk category had no test before this file existed."""

    async def test_var_and_friends_say_not_measurable_on_a_flat_book(self, bot):
        # A flat book has no covariance to estimate from. Each of these must
        # say so rather than reporting a confident zero.
        for index, command in enumerate(
            ["/var", "/riskcontrib", "/correlation", "/stress", "/varbacktest"], start=5000
        ):
            bot.sent.clear()
            bot._rate_windows.clear()
            await bot.handle_update(update(command, update_id=index))
            reply = " ".join(bot.sent).upper()
            assert any(
                phrase in reply
                for phrase in ("NOT MEASURABLE", "FLAT BOOK", "NEEDS", "NO ", "UNAVAILABLE")
            ), f"{command} reported a figure with nothing to compute it from: {reply[:160]}"

    async def test_size_explains_itself_before_it_sizes(self, bot):
        bot._rate_windows.clear()
        await bot.handle_update(update("/size", update_id=5100))
        assert "/size" in bot.last, "a bare /size must show its own usage"

    async def test_rebalance_and_regime_answer(self, bot):
        for index, command in enumerate(["/rebalance", "/regime"], start=5200):
            bot.sent.clear()
            bot._rate_windows.clear()
            await bot.handle_update(update(command, update_id=index))
            assert bot.sent, f"{command} said nothing at all"
            assert "Unknown command" not in " ".join(bot.sent)


@pytest.mark.asyncio
class TestListingsDistinguishEmptyFromBroken:
    async def test_empty_desks_are_reported_as_empty_not_as_healthy(self, bot):
        cases = {
            "/positions": ("FLAT", "NO POSITIONS", "NONE"),
            "/orders": ("NO ORDERS", "NONE", "EMPTY"),
            "/working": ("NONE RESTING", "NOTHING OPEN"),
            "/jobs": ("NO JOBS", "NONE", "EMPTY"),
            "/backtests": ("NO BACKTESTS", "NONE", "EMPTY"),
            "/incidents": ("NO INCIDENTS", "NONE", "CLEAR"),
        }
        for index, (command, expected) in enumerate(cases.items(), start=5300):
            bot.sent.clear()
            bot._rate_windows.clear()
            await bot.handle_update(update(command, update_id=index))
            reply = " ".join(bot.sent).upper()
            assert any(phrase in reply for phrase in expected) or "0" in reply, (
                f"{command} did not state its own emptiness: {reply[:160]}"
            )

    async def test_timeline_of_an_unknown_order_is_not_found_not_rejected(self, bot):
        bot._rate_windows.clear()
        await bot.handle_update(update("/timeline nosuchorder", update_id=5400))
        reply = bot.last
        assert "NOT FOUND" in reply
        # The distinction matters: an unknown id never reached the gates, and
        # calling that a rejection would invent a decision the desk never made.
        assert "never reached the gates" in reply


@pytest.mark.asyncio
class TestReferenceCommandsStayInSyncWithTheRegistry:
    async def test_help_and_commands_describe_the_live_catalogue(self, bot):
        from modules.telegram import COMMAND_SPECS

        bot._rate_windows.clear()
        await bot.handle_update(update("/commands", update_id=5500))
        catalogue = " ".join(bot.sent)
        # Spot-check across categories rather than all 76: this asserts the
        # catalogue is generated, not hand-maintained.
        for name in ("equity", "var", "backtest", "rag", "ops", "timeline"):
            assert f"/{name}" in catalogue, f"/{name} is registered but not listed"
        assert len(COMMAND_SPECS) >= 70

    async def test_about_states_the_control_count_it_actually_has(self, bot):
        from modules.telegram import COMMAND_SPECS

        controls = {s.name for s in COMMAND_SPECS if s.category == "Controls"}
        bot._rate_windows.clear()
        await bot.handle_update(update("/about", update_id=5600))
        reply = bot.last
        for name in controls:
            assert f"/{name}" in reply, f"/about omits the {name} control"
        # And the parity map, which is what a reader checks the bot against.
        assert "Web parity" in reply
        assert "Web-only" in reply


def test_every_command_a_reply_points_at_actually_exists():
    """No card may send a reader to a command that is not registered.

    This is the /backtest defect generalised. That one was advertised in a
    card body and a Next chain with no spec behind it, so a reader following
    the prompt reached the unknown-command path — the worst kind of dead end,
    because the product itself suggested it.

    Scans the module source for every `/name` token inside a `next_commands=`
    argument and requires each to resolve. Source-scan rather than runtime,
    so a chain on a rarely-reached branch is covered too.
    """
    import re
    from pathlib import Path

    import modules.telegram as telegram_module
    from modules.telegram import COMMAND_SPECS

    known = {spec.name for spec in COMMAND_SPECS}
    for spec in COMMAND_SPECS:
        known.update(spec.aliases or ())

    # The whole package, not just its `__init__.py`: `next_commands=` strings
    # live in the handler files, and scanning only `__file__` after the split
    # would have found nothing and reported it as "no dangling chains".
    package = Path(telegram_module.__file__).parent
    files = sorted(package.rglob("*.py"))
    assert len(files) > 1, "the package scan found only one file — did the layout change?"
    source = "\n".join(path.read_text() for path in files)
    dangling: list[str] = []
    # `next_commands="..."` and f-string variants; the value runs to the
    # closing quote of that argument.
    for match in re.finditer(r'next_commands=f?"([^"]*)"', source):
        for token in re.findall(r"/([a-z][a-z0-9_]*)", match.group(1)):
            if token not in known:
                dangling.append(token)

    assert not dangling, (
        "Next chains point at commands that do not exist: "
        + ", ".join(sorted(set(dangling)))
    )
