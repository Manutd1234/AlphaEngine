"""
The Telegram control gates.

These three commands are the only ones in the companion that change risk state,
so what is pinned is every reason they should *refuse*. A chat message is an
unusually easy thing to send by accident and an unusually easy thing to forward,
which is why the confirmation is a single-use code bound to a user rather than a
word anyone could copy along with the command.
"""

from __future__ import annotations

import time

import pytest

from config import settings
from modules.telegram import COMMAND_SPECS, TelegramBot


@pytest.fixture()
def bot() -> TelegramBot:
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

def test_control_list_is_empty_by_default_and_fails_closed(bot: TelegramBot):
    """An unconfigured deployment has a reporting bot, not a dormant kill switch."""
    _set("telegram_control_user_ids", [])
    assert bot._may_control("12345") is False


def test_reading_the_book_does_not_imply_stopping_the_desk(bot: TelegramBot):
    """
    The two allow-lists answer different questions. If they were the same list,
    every analyst added for /portfolio would silently gain a kill switch.
    """
    _set("telegram_allowed_user_ids", ["reader", "operator"])
    _set("telegram_control_user_ids", ["operator"])
    assert bot._authorised("reader") is True
    assert bot._may_control("reader") is False
    assert bot._may_control("operator") is True


def test_control_commands_are_registered_in_their_own_category():
    controls = {s.name for s in COMMAND_SPECS if s.category == "Controls"}
    assert controls == {"halt", "resume", "flatten"}
    # Kept out of the bootstrap set, which is reachable before authorisation.
    from modules.telegram import _BOOTSTRAP_COMMANDS
    assert not ({"/halt", "/resume", "/flatten"} & _BOOTSTRAP_COMMANDS)


# --------------------------------------------------------------------------- #
# The challenge
# --------------------------------------------------------------------------- #

def test_a_challenge_is_single_use(bot: TelegramBot):
    code = bot._issue_challenge("operator", "halt", None)
    ok, _, _ = bot._consume_challenge("operator", "halt", code)
    assert ok is True
    # Replaying the same code — from a forwarded message, or a double tap.
    ok_again, _, reason = bot._consume_challenge("operator", "halt", code)
    assert ok_again is False
    assert "No pending confirmation" in reason


def test_a_challenge_is_bound_to_the_user_who_asked(bot: TelegramBot):
    """A forwarded `/halt 4821` must not fire from somebody else's chat."""
    code = bot._issue_challenge("operator", "halt", None)
    ok, _, reason = bot._consume_challenge("someone_else", "halt", code)
    assert ok is False
    assert "No pending confirmation" in reason


def test_a_challenge_is_bound_to_the_action_it_was_issued_for(bot: TelegramBot):
    """A code obtained for /halt must not be able to fire /flatten."""
    code = bot._issue_challenge("operator", "halt", None)
    ok, _, reason = bot._consume_challenge("operator", "flatten", code)
    assert ok is False
    assert "/halt" in reason


def test_a_wrong_code_is_rejected_and_burns_the_challenge(bot: TelegramBot):
    """
    Consuming on failure too, so a wrong guess cannot be followed by a brute
    force against a still-live four-digit code.
    """
    bot._issue_challenge("operator", "halt", None)
    ok, _, reason = bot._consume_challenge("operator", "halt", "0000")
    assert ok is False and reason == "Wrong code."
    ok_after, _, reason_after = bot._consume_challenge("operator", "halt", "0000")
    assert ok_after is False
    assert "No pending confirmation" in reason_after


def test_a_challenge_expires(bot: TelegramBot, monkeypatch: pytest.MonkeyPatch):
    code = bot._issue_challenge("operator", "halt", None)
    later = time.monotonic() + bot._CHALLENGE_TTL_SECONDS + 1
    monkeypatch.setattr(time, "monotonic", lambda: later)
    ok, _, reason = bot._consume_challenge("operator", "halt", code)
    assert ok is False
    assert "expired" in reason


def test_the_challenge_carries_its_scope(bot: TelegramBot):
    """
    The symbol is captured when the code is issued, not re-read on confirmation
    — otherwise `/halt BTCUSDT` then `/halt 4821` could halt the whole book.
    """
    code = bot._issue_challenge("operator", "halt", "BTCUSDT")
    ok, symbol, _ = bot._consume_challenge("operator", "halt", code)
    assert ok is True
    assert symbol == "BTCUSDT"


def test_codes_are_four_digits_so_the_arg_parser_can_tell_them_from_symbols(bot: TelegramBot):
    for _ in range(50):
        code = bot._issue_challenge("operator", "halt", None)
        assert code.isdigit() and len(code) == 4, f"unusable code {code!r}"
