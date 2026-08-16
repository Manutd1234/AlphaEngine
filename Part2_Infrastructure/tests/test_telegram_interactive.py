"""The interactivity layer: callback grammar, tap gating, and in-place editing.

Three claims are defended here, because each has a quiet failure mode:

1. **Every button resolves.** Callback data is built by `cb()` against the
   registry at build time and re-parsed at tap time, so a button that points at
   nothing is a red test rather than a dead button a user finds first. The
   sweep at the bottom dispatches every spec's own example, harvests every
   keyboard actually sent, and re-dispatches every button as a tap.

2. **A tap is gated like a typed command — on the TAPPER.** Authorisation
   reads ``callback["from"]``, never the tapped message's author, and the
   Controls category is refused outright: no challenge is ever issued from a
   button.

3. **Editing in place degrades to sending.** A refresh edits the tapped card;
   "message is not modified" means the tap already succeeded and nothing is
   resent; any other refusal falls through to a fresh send, because the answer
   matters more than the tidiness.
"""

from __future__ import annotations

import json
import time
from collections import deque

import pytest
from test_telegram import CHAT, USER, update

from config import settings
from modules.telegram import (
    _COMMAND_BY_NAME,
    COMMAND_SPECS,
    CommandSpec,
    ReplyTarget,
    TelegramBot,
    _build_command_index,
    _choice_row,
    _interval_row,
    _menu_keyboard,
    _reply_target,
    _symbol_row,
    _tab_footer,
    cb,
    kb,
    parse_callback,
)


def callback_update(
    data: str,
    *,
    user_id: str = USER,
    chat_id: str = CHAT,
    update_id: int = 1,
    message_id: int = 42,
    photo: bool = False,
    with_message: bool = True,
) -> dict:
    """A callback_query update the way Telegram delivers one."""
    query: dict = {
        "id": f"cbq-{update_id}",
        "from": {"id": int(user_id), "username": "operator"},
        "data": data,
    }
    if with_message:
        message: dict = {"message_id": message_id, "chat": {"id": int(chat_id)}, "text": "card"}
        if photo:
            message["photo"] = [{"file_id": "photo-1"}]
        query["message"] = message
    return {"update_id": update_id, "callback_query": query}


def toasts(bot) -> list[str]:
    """Every answerCallbackQuery text the bot sent, in order ('' when silent)."""
    return [
        str(params.get("text") or "")
        for method, params in bot.api_calls
        if method == "answerCallbackQuery"
    ]


# --------------------------------------------------------------------------- #
# The grammar
# --------------------------------------------------------------------------- #


class TestCallbackGrammar:
    def test_cb_builds_versioned_positional_data(self):
        assert cb("overview") == "v1|overview"
        assert cb("quote", "AAPL") == "v1|quote|AAPL"
        assert cb("tca", "BTCUSDT", "100000", "BUY") == "v1|tca|BTCUSDT|100000|BUY"

    def test_cb_refuses_what_the_registry_does_not_hold(self):
        with pytest.raises(ValueError):
            cb("frobnicate")  # not registered
        with pytest.raises(ValueError):
            cb("health")  # alias of /status — a button must carry the NAME
        with pytest.raises(ValueError):
            cb("bookstate")  # alias of /portfolio

    def test_cb_refuses_data_that_breaks_the_grammar(self):
        with pytest.raises(ValueError):
            cb("quote", "A B")  # whitespace
        with pytest.raises(ValueError):
            cb("quote", "A|B")  # the separator itself
        with pytest.raises(ValueError):
            cb("quote", "x" * 70)  # over 64 utf-8 bytes

    def test_parse_callback_is_none_for_anything_not_v1(self):
        assert parse_callback("v1|quote|AAPL") == ("quote", ["AAPL"])
        assert parse_callback("v1|overview") == ("overview", [])
        assert parse_callback("v0|halt") is None
        assert parse_callback("garbage") is None
        assert parse_callback("v1|") is None
        assert parse_callback("v1|Bad") is None
        assert parse_callback("v1|quote|A B") is None
        assert parse_callback("v1|quote|" + "x" * 70) is None

    def test_kb_enforces_telegram_ceilings(self):
        button = ("Overview", cb("overview"))
        markup = kb([[button, ("Risk", cb("risk"))]])
        assert markup == {"inline_keyboard": [[
            {"text": "Overview", "callback_data": "v1|overview"},
            {"text": "Risk", "callback_data": "v1|risk"},
        ]]}
        with pytest.raises(ValueError):
            kb([[button] * 9])  # more than 8 a row
        with pytest.raises(ValueError):
            kb([[button] * 8] * 13)  # more than 100 a keyboard
        with pytest.raises(ValueError):
            kb([[("", cb("overview"))]])  # empty label
        with pytest.raises(ValueError):
            kb([[("x" * 41, cb("overview"))]])  # oversized label
        with pytest.raises(ValueError):
            kb([[("Old", "v0|overview")]])  # data that fails the grammar

    def test_registry_collisions_fail_the_import_not_the_user(self):
        """The /research defect, generalised: a collision must raise."""
        tab = CommandSpec("research", "d", "Tabs", "/research", "/research", "_cmd_tab_research")
        thief = CommandSpec("snapshot", "d", "Markets", "/snapshot", "/snapshot", "_cmd_snapshot", ("research",))
        with pytest.raises(RuntimeError, match="collision"):
            _build_command_index((tab, thief))

    def test_no_name_or_alias_collides_across_the_registry(self):
        seen: set[str] = set()
        for spec in COMMAND_SPECS:
            for name in (spec.name, *spec.aliases):
                assert name not in seen, f"/{name} is claimed twice"
                seen.add(name)

    def test_research_dispatches_to_the_research_tab(self):
        """The defect itself: /research is the Tab command, not /snapshot."""
        assert _COMMAND_BY_NAME["/research"].name == "research"
        assert _COMMAND_BY_NAME["/research"].handler == "_cmd_tab_research"
        # The stolen aliases are gone, not merely re-ordered.
        assert "research" not in _COMMAND_BY_NAME["/snapshot"].aliases
        assert "/providers" not in _COMMAND_BY_NAME
        assert _COMMAND_BY_NAME["/openbb"].aliases == ()

    def test_row_builders_mark_the_active_choice(self):
        interval_row = _interval_row("bars", "BTCUSDT", "1h")
        assert [label for label, _ in interval_row] == ["15m", "• 1h", "4h", "1d"]
        assert all(parse_callback(data) is not None for _, data in interval_row)

        symbol_row = _symbol_row("research", "BTCUSDT")
        assert len(symbol_row) <= 6
        assert symbol_row[0][0] == "• BTCUSDT"
        assert symbol_row[0][1] == "v1|research|BTCUSDT"

        choice_row = _choice_row("var", [("1d", "1d"), ("4h", "4h")], "1d")
        assert [label for label, _ in choice_row] == ["• 1d", "4h"]
        assert choice_row[1][1] == "v1|var|4h"

    def test_standard_keyboards_are_valid(self):
        for markup in (
            _menu_keyboard(),
            _tab_footer("overview", [("Risk", cb("risk"))], refresh=cb("overview")),
        ):
            assert "inline_keyboard" in markup
            for row in markup["inline_keyboard"]:
                assert 1 <= len(row) <= 8
                for button in row:
                    assert parse_callback(button["callback_data"]) is not None
        # The footer's last row is always refresh + menu.
        footer = _tab_footer("data", [("Feeds", cb("feedstatus"))], refresh=cb("data"))
        last = footer["inline_keyboard"][-1]
        assert [button["text"] for button in last] == ["↻ Refresh", "⌂ Menu"]
        assert last[1]["callback_data"] == "v1|menu"


# --------------------------------------------------------------------------- #
# The gates
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
class TestCallbackGates:
    async def test_authorisation_reads_the_tapper_never_the_card_author(self, bot):
        # The card sits in an authorised chat; the TAPPER is not authorised.
        await bot.handle_update(callback_update("v1|portfolio", user_id="999999", update_id=600))
        assert toasts(bot) == ["Not authorised — send /whoami"]
        assert bot.sent == [], "an unauthorised tap must not dispatch"

    async def test_bootstrap_commands_answer_unauthorised_taps(self, bot):
        await bot.handle_update(callback_update("v1|help", user_id="999999", update_id=601))
        assert toasts(bot) == [""], "a valid tap is acknowledged without a toast"
        assert "AlphaEngine Companion" in bot.last

    async def test_rate_limited_taps_get_a_toast_not_a_card(self, bot):
        window = bot._rate_windows.setdefault(USER, deque())
        now = time.monotonic()
        for _ in range(15):
            window.append(now)
        await bot.handle_update(callback_update("v1|ping", update_id=602))
        assert toasts(bot) == ["Rate limited: 15 taps per 10 s"]
        assert bot.sent == []

    async def test_stale_and_malformed_buttons_get_the_older_build_toast(self, bot):
        await bot.handle_update(callback_update("v0|status", update_id=603))
        await bot.handle_update(callback_update("v1|frobnicate", update_id=604))
        await bot.handle_update(callback_update("not a callback", update_id=605))
        assert toasts(bot) == [
            "This button is from an older build. Send the command instead."
        ] * 3
        assert bot.sent == []

    async def test_a_tap_without_a_message_is_signposted(self, bot):
        await bot.handle_update(callback_update("v1|ping", update_id=606, with_message=False))
        assert toasts(bot) == ["Open the chat and send the command."]
        assert bot.sent == []

    async def test_controls_are_typed_never_tapped(self, bot):
        # Even for a user ON the control allow-list: a tap is easier to fire by
        # accident than a typed command, so no challenge is ever issued from a
        # button — not even the first step of one.
        saved = list(settings.telegram_control_user_ids)
        object.__setattr__(settings, "telegram_control_user_ids", [USER])
        try:
            await bot.handle_update(callback_update("v1|halt", update_id=607))
        finally:
            object.__setattr__(settings, "telegram_control_user_ids", saved)
        assert toasts(bot) == ["Controls are typed, never tapped. Send /halt."]
        assert bot._challenges == {}, "a button must never open a challenge"
        assert bot.sent == [], "no card either — the toast is the whole answer"

    async def test_a_valid_tap_is_acknowledged_and_dispatched(self, bot):
        await bot.handle_update(callback_update("v1|ping", update_id=608))
        assert toasts(bot) == [""], "the spinner clears before the handler runs"
        assert "Command path" in bot.last, "the tap ran the same handler as /ping"
        assert bot.callbacks_handled == 1


# --------------------------------------------------------------------------- #
# Editing in place
# --------------------------------------------------------------------------- #


class TransportBot(TelegramBot):
    """A real TelegramBot whose single HTTP funnel records instead of sending."""

    def __init__(self, responses: dict[str, dict] | None = None):
        super().__init__()
        self.token = "999:TEST"
        self.calls: list[tuple[str, dict]] = []
        self.responses = responses or {}
        # Truthy so no real httpx client is ever constructed.
        self._client = object()  # type: ignore[assignment]

    async def _post(self, method, *, json_body=None, data=None, files=None, chat_id=None, pace=True, attempts=3):
        self.calls.append((method, {"json_body": json_body, "data": data, "files": files}))
        return dict(self.responses.get(method, {"ok": True, "result": {}}))

    @property
    def methods(self) -> list[str]:
        return [method for method, _ in self.calls]


@pytest.fixture
def with_text_target():
    token = _reply_target.set(ReplyTarget(chat_id=CHAT, message_id=7, kind="text"))
    yield
    _reply_target.reset(token)


@pytest.mark.asyncio
class TestEditInPlace:
    async def test_send_message_edits_the_tapped_text_card(self, with_text_target):
        bot = TransportBot()
        await bot.send_message(CHAT, "fresh card", reply_markup=kb([[("Menu", cb("menu"))]]))
        assert bot.methods == ["editMessageText"]
        body = bot.calls[0][1]["json_body"]
        assert body["message_id"] == 7 and body["text"] == "fresh card"
        assert json.loads(body["reply_markup"])["inline_keyboard"]
        assert _reply_target.get().consumed is True

    async def test_an_uneditable_message_falls_back_to_a_fresh_send(self, with_text_target):
        bot = TransportBot({"editMessageText": {"ok": False, "description": "message can't be edited"}})
        await bot.send_message(CHAT, "fresh card")
        assert bot.methods == ["editMessageText", "sendMessage"]
        assert bot.calls[1][1]["json_body"]["text"] == "fresh card"

    async def test_not_modified_means_done_not_resend(self, with_text_target):
        bot = TransportBot({"editMessageText": {
            "ok": False, "description": "Bad Request: message is not modified",
        }})
        await bot.send_message(CHAT, "identical card")
        assert bot.methods == ["editMessageText"], "the card is already this text"

    async def test_without_a_target_the_keyboard_rides_the_last_chunk(self):
        bot = TransportBot()
        long_text = "\n".join(f"<b>Section {index}</b> " + "x" * 120 for index in range(80))
        await bot.send_message(CHAT, long_text, reply_markup=kb([[("Menu", cb("menu"))]]))
        sends = [params for method, params in bot.calls if method == "sendMessage"]
        assert len(sends) > 1
        assert all("reply_markup" not in (params["json_body"] or {}) for params in sends[:-1])
        assert "reply_markup" in sends[-1]["json_body"]

    async def test_a_photo_tap_edits_the_media_in_place(self):
        token = _reply_target.set(ReplyTarget(chat_id=CHAT, message_id=9, kind="photo"))
        try:
            bot = TransportBot()
            await bot.send_photo(CHAT, b"\x89PNG", caption="chart", reply_markup=kb([[("Menu", cb("menu"))]]))
        finally:
            _reply_target.reset(token)
        assert bot.methods == ["editMessageMedia"]
        data = bot.calls[0][1]["data"]
        media = json.loads(data["media"])
        assert media["type"] == "photo" and media["media"] == "attach://photo"
        assert media["caption"] == "chart"
        assert bot.calls[0][1]["files"]["photo"][0] == "chart.png"

    async def test_album_with_keyboard_sends_caption_separately(self):
        bot = TransportBot()
        photos = [("a", b"\x89PNG-a"), ("b", b"\x89PNG-b")]
        await bot.send_media_group(CHAT, photos, caption="the numbers", reply_markup=kb([[("Menu", cb("menu"))]]))
        assert bot.methods == ["sendMediaGroup", "sendMessage"]
        media = json.loads(bot.calls[0][1]["data"]["media"])
        assert len(media) == 2
        assert all("caption" not in item for item in media), "albums never carry the caption when a keyboard follows"
        follow_up = bot.calls[1][1]["json_body"]
        assert follow_up["text"] == "the numbers"
        assert "reply_markup" in follow_up

    async def test_album_after_a_tap_detaches_the_stale_keyboard_first(self, with_text_target):
        bot = TransportBot()
        photos = [("a", b"\x89PNG-a"), ("b", b"\x89PNG-b")]
        await bot.send_media_group(CHAT, photos, caption="the numbers", reply_markup=kb([[("Menu", cb("menu"))]]))
        assert bot.methods == ["editMessageReplyMarkup", "sendMediaGroup", "sendMessage"]
        detach = bot.calls[0][1]["json_body"]
        assert detach["message_id"] == 7
        assert json.loads(detach["reply_markup"]) == {"inline_keyboard": []}

    async def test_album_without_keyboard_keeps_todays_shape(self):
        bot = TransportBot()
        photos = [("a", b"\x89PNG-a"), ("b", b"\x89PNG-b")]
        await bot.send_media_group(CHAT, photos, caption="the numbers")
        assert bot.methods == ["sendMediaGroup"]
        media = json.loads(bot.calls[0][1]["data"]["media"])
        assert media[0]["caption"] == "the numbers", "without a keyboard the caption rides the album"


# --------------------------------------------------------------------------- #
# The resolution sweep
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
class TestKeyboardResolutionSweep:
    async def test_every_button_sent_resolves_and_redispatches(self, bot, fake_market_data):
        """Harvest every keyboard the catalogue actually sends, then tap it all.

        Build-time validation in `cb()` covers buttons that are constructed;
        this covers the ones that are SENT — and proves the tap path answers
        for each of them, so a button cannot point at a command that refuses
        its own arguments.
        """
        for index, spec in enumerate(COMMAND_SPECS, start=3000):
            bot._rate_windows.clear()
            await bot.handle_update(update(spec.example, update_id=index))

        buttons: list[str] = []
        for keyboard in bot.keyboards:
            if not keyboard:
                continue
            for row in keyboard["inline_keyboard"]:
                for button in row:
                    buttons.append(button["callback_data"])
        assert buttons, "no keyboard was sent by any example"

        unique = sorted(set(buttons))
        for data in unique:
            parsed = parse_callback(data)
            assert parsed is not None, f"unparseable button: {data!r}"
            command, _ = parsed
            spec = _COMMAND_BY_NAME.get(f"/{command}")
            assert spec is not None and spec.name == command, f"button names an unregistered command: {data!r}"
            assert len(data.encode("utf-8")) <= 64, f"button data over 64 bytes: {data!r}"

        failures: list[str] = []
        for offset, data in enumerate(unique):
            bot.sent.clear()
            bot.api_calls.clear()
            bot._rate_windows.clear()
            await bot.handle_update(callback_update(data, update_id=9000 + offset))
            if not toasts(bot):
                failures.append(f"{data}: tap never acknowledged")
                continue
            reply = " ".join(bot.sent)
            if not reply:
                failures.append(f"{data}: no card at all")
            elif "Command failed" in reply:
                failures.append(f"{data}: handler raised — {reply[:120]}")
            elif "Unknown command" in reply:
                failures.append(f"{data}: dispatched to the unknown-command path")
        assert not failures, "buttons that do not answer:\n" + "\n".join(failures)
