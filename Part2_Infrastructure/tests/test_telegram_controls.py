"""
The Telegram control gates.

These three commands are the only ones in the companion that change risk state,
so what is pinned is every reason they should *refuse*. A chat message is an
unusually easy thing to send by accident and an unusually easy thing to forward,
which is why the confirmation is a single-use code bound to a user rather than a
word anyone could copy along with the command.
"""

from __future__ import annotations

import inspect
import re
import time

import pytest
from conftest import TELEGRAM_TEST_USER
from test_telegram import update

from config import settings
from modules.telegram import COMMAND_SPECS, TelegramBot, actor_user_id


@pytest.fixture()
def unwired() -> TelegramBot:
    """A bot with no engines behind it — enough for the allow-list arithmetic.

    Renamed from `bot` so this file can also reach conftest's wired StubBot,
    which is what the end-to-end tests at the bottom need. A fixture of the same
    name here would shadow it, and shadowing is precisely how the composite-actor
    bug survived: every control test in this repo tested a helper in isolation.
    """
    return TelegramBot()


# `settings` is a frozen dataclass, so the allow-lists are set through
# `object.__setattr__` and restored after each test. Patching the bot's
# properties instead would test the fixture rather than the wiring.
def _set(field: str, value: list[str]) -> None:
    object.__setattr__(settings, field, value)


@pytest.fixture(autouse=True)
def _restore_allow_lists():
    read = list(settings.telegram_allowed_user_ids)
    control = list(settings.telegram_control_user_ids)
    yield
    _set("telegram_allowed_user_ids", read)
    _set("telegram_control_user_ids", control)


# --------------------------------------------------------------------------- #
# The allow-list split
# --------------------------------------------------------------------------- #

def test_control_list_is_empty_by_default_and_fails_closed(unwired: TelegramBot):
    """An unconfigured deployment has a reporting bot, not a dormant kill switch."""
    _set("telegram_control_user_ids", [])
    assert unwired._may_control("12345") is False


def test_reading_the_book_does_not_imply_stopping_the_desk(unwired: TelegramBot):
    """
    The two allow-lists answer different questions. If they were the same list,
    every analyst added for /portfolio would silently gain a kill switch.
    """
    _set("telegram_allowed_user_ids", ["reader", "operator"])
    _set("telegram_control_user_ids", ["operator"])
    assert unwired._authorised("reader") is True
    assert unwired._may_control("reader") is False
    assert unwired._may_control("operator") is True


def test_control_commands_are_registered_in_their_own_category():
    controls = {s.name for s in COMMAND_SPECS if s.category == "Controls"}
    assert controls == {"halt", "resume", "flatten", "reduceonly", "resetbook"}
    # Kept out of the bootstrap set, which is reachable before authorisation.
    from modules.telegram import _BOOTSTRAP_COMMANDS
    assert not ({"/halt", "/resume", "/flatten"} & _BOOTSTRAP_COMMANDS)


# --------------------------------------------------------------------------- #
# The challenge
# --------------------------------------------------------------------------- #

def test_a_challenge_is_single_use(unwired: TelegramBot):
    code = unwired._issue_challenge("operator", "halt", None)
    ok, _, _ = unwired._consume_challenge("operator", "halt", code)
    assert ok is True
    # Replaying the same code — from a forwarded message, or a double tap.
    ok_again, _, reason = unwired._consume_challenge("operator", "halt", code)
    assert ok_again is False
    assert "No pending confirmation" in reason


def test_a_challenge_is_bound_to_the_user_who_asked(unwired: TelegramBot):
    """A forwarded `/halt 4821` must not fire from somebody else's chat."""
    code = unwired._issue_challenge("operator", "halt", None)
    ok, _, reason = unwired._consume_challenge("someone_else", "halt", code)
    assert ok is False
    assert "No pending confirmation" in reason


def test_a_challenge_is_bound_to_the_action_it_was_issued_for(unwired: TelegramBot):
    """A code obtained for /halt must not be able to fire /flatten."""
    code = unwired._issue_challenge("operator", "halt", None)
    ok, _, reason = unwired._consume_challenge("operator", "flatten", code)
    assert ok is False
    assert "/halt" in reason


def test_a_wrong_code_is_rejected_and_burns_the_challenge(unwired: TelegramBot):
    """
    Consuming on failure too, so a wrong guess cannot be followed by a brute
    force against a still-live four-digit code.
    """
    unwired._issue_challenge("operator", "halt", None)
    ok, _, reason = unwired._consume_challenge("operator", "halt", "0000")
    assert ok is False and reason == "Wrong code."
    ok_after, _, reason_after = unwired._consume_challenge("operator", "halt", "0000")
    assert ok_after is False
    assert "No pending confirmation" in reason_after


def test_a_challenge_expires(unwired: TelegramBot, monkeypatch: pytest.MonkeyPatch):
    code = unwired._issue_challenge("operator", "halt", None)
    later = time.monotonic() + unwired._CHALLENGE_TTL_SECONDS + 1
    monkeypatch.setattr(time, "monotonic", lambda: later)
    ok, _, reason = unwired._consume_challenge("operator", "halt", code)
    assert ok is False
    assert "expired" in reason


def test_the_challenge_carries_its_scope(unwired: TelegramBot):
    """
    The symbol is captured when the code is issued, not re-read on confirmation
    — otherwise `/halt BTCUSDT` then `/halt 4821` could halt the whole book.
    """
    code = unwired._issue_challenge("operator", "halt", "BTCUSDT")
    ok, symbol, _ = unwired._consume_challenge("operator", "halt", code)
    assert ok is True
    assert symbol == "BTCUSDT"


def test_codes_are_four_digits_so_the_arg_parser_can_tell_them_from_symbols(unwired: TelegramBot):
    for _ in range(50):
        code = unwired._issue_challenge("operator", "halt", None)
        assert code.isdigit() and len(code) == 4, f"unusable code {code!r}"


# --------------------------------------------------------------------------- #
# End to end, through the path a real message takes
#
# Everything above this line calls `_may_control` and `_consume_challenge`
# directly with bare ids, and every one of them passed for months while all five
# controls were dead. `handle_update` builds the actor as `tg:<id>:<username>`
# and `_control` compared that whole composite against a list of bare numeric
# ids — `"tg:12345:ian" in ["12345"]` is false for every configuration that can
# exist. The tests below go through `handle_update`, which is the only place the
# composite is assembled and therefore the only place the mismatch is visible.
# --------------------------------------------------------------------------- #

CONFIRM_RE = re.compile(r"/(\w+) (\d{4})")


@pytest.mark.asyncio
async def test_halt_fires_through_the_real_dispatch_path(bot):
    """A configured operator can actually stop the desk from a chat message."""
    _set("telegram_allowed_user_ids", [TELEGRAM_TEST_USER])
    _set("telegram_control_user_ids", [TELEGRAM_TEST_USER])

    await bot.handle_update(update("/halt", update_id=9001))
    assert "Confirm /halt" in bot.last, f"the allow-list refused a configured operator: {bot.last}"

    code = CONFIRM_RE.search(bot.last)
    assert code and code.group(1) == "halt", bot.last
    await bot.handle_update(update(f"/halt {code.group(2)}", update_id=9002))

    assert "/halt applied" in bot.last, bot.last
    # The card is not the assertion — the risk state is. A confirmation card
    # rendered over a gateway that never moved is the failure mode this whole
    # file exists to catch.
    assert bot.gateway.state().kill_switch_active is True


@pytest.mark.asyncio
async def test_the_composite_actor_is_parsed_rather_than_matched(bot):
    """
    The fix must be a parse, not a widening.

    Accepting `tg:7:operator` as a control id *as well* would make the config
    format ambiguous and would quietly re-authorise anyone whose composite
    happened to be pasted into the list. The allow-list takes bare numeric ids,
    documented as such in `.env.example`, and nothing else.
    """
    _set("telegram_allowed_user_ids", [TELEGRAM_TEST_USER])
    _set("telegram_control_user_ids", [f"tg:{TELEGRAM_TEST_USER}:operator"])

    await bot.handle_update(update("/halt", update_id=9003))
    assert "not permitted" in bot.last
    assert bot.gateway.state().kill_switch_active is False


@pytest.mark.asyncio
async def test_a_reader_without_the_control_list_is_refused_with_a_reason(bot):
    _set("telegram_allowed_user_ids", [TELEGRAM_TEST_USER])
    _set("telegram_control_user_ids", [])

    await bot.handle_update(update("/flatten", update_id=9004))
    assert "not permitted" in bot.last
    # The refusal now prints the bare id, which is exactly the value an operator
    # has to paste into TELEGRAM_CONTROL_USER_IDS. It used to print the
    # composite, which would not have worked if they had.
    assert f"<code>{TELEGRAM_TEST_USER}</code>" in bot.last
    assert "TELEGRAM_CONTROL_USER_IDS" in bot.last


def test_the_actor_format_and_its_parser_move_together():
    """
    A format mismatch caused this bug, so pin the format and the parser as a
    pair. Renaming the composite without updating `actor_user_id` fails here
    rather than in production, where it presents as five commands that answer
    "not permitted" to the people who configured them.
    """
    source = inspect.getsource(TelegramBot.handle_update)
    assert re.search(r'actor = f"tg:\{user_id\}:', source), "the actor format moved"
    assert actor_user_id("tg:12345:ian") == "12345"
    assert actor_user_id("tg:12345:") == "12345"
    # Anything else is no identity at all, never a name to compare.
    for rubbish in ("12345", "tg:12345", "", "tg::ian", "tg:0:ian"):
        assert actor_user_id(rubbish) == "", rubbish
