"""AlphaEngine Telegram companion — independent operational updates in text, charts and buttons.

The Telegram bot is deliberately separate from every web interface. It does not
open a Mini App and it never authenticates the website — a binding runs one way,
from a web identity to a Telegram read. It reads the same authoritative gateway
state and OpenBB provider layer, then renders compact phone-friendly cards:
HTML text, real-data chart photos, and inline keyboards whose every button is
a shortcut for a typed command — never a capability of its own.

It IS able to change state, and this paragraph used to deny it: ``/halt`` and
``/resume`` move the kill switch, ``/flatten`` submits real closing MARKET
orders through the same pre-trade gates as any other order, and ``/backtest``
enqueues work on the shared jobs engine. The first three answer only to
``TELEGRAM_CONTROL_USER_IDS`` plus a single-use confirmation code; the last is
un-gated, matching the web, because a queued backtest spends compute and
touches no position.

Operational data is fail-closed behind two named grants, and only two:
``TELEGRAM_ALLOWED_USER_IDS``, and a chat bound to a web desk pass through the
workspace's Connect button. With neither, the bot exposes only bootstrap
commands such as ``/whoami`` so an operator can obtain their Telegram user ID
safely. A binding grants READING and never control — ``/halt``, ``/resume``,
``/flatten``, ``/reduceonly``, ``/resetbook`` and ``/replay`` read
``TELEGRAM_CONTROL_USER_IDS`` alone. See `TelegramBot._authorised` for why the
second grant is not an authentication bypass.

The module became a package. Nothing else changed: ``TelegramBot`` is still one
class, because `_dispatch` resolves a handler by STRING NAME off
`COMMAND_SPECS` and every ``_cmd_*`` reaches ``self.send_message``,
``self._authorised`` and ``self.gateway``. What moved is the *files*: one per
section banner the original already carried, assembled back into a single class
in ``bot.py``.

Two things a reader porting a patch needs to know. Function-scope imports stayed
function-scope — the Python import graph here is acyclic only because of them,
and hoisting one to the top of a new file recreates ``telegram/* -> metrics ->
telegram``. And ``monkeypatch.setattr`` binds to the module object that holds
the reference: a test stubbing the transport now patches
``modules.telegram.transport``, not this file.
"""

from __future__ import annotations

from modules.telegram._common import actor_user_id, log
from modules.telegram.bot import TelegramBot
from modules.telegram.format import (
    _BOOTSTRAP_COMMANDS,
    ReplyTarget,
    _reply_target,
    esc,
    split_telegram_html,
    text_card,
    utc_now_label,
)
from modules.telegram.help import HELP_TEXT, command_catalogue, help_text
from modules.telegram.keyboards import (
    _category_keyboard,
    _choice_row,
    _interval_row,
    _menu_keyboard,
    _symbol_row,
    _tab_footer,
    cb,
    kb,
    parse_callback,
)
from modules.telegram.link import (
    LINK_KIND_ACCOUNT,
    LINK_KIND_GUEST,
    LINK_PROBE_MAX_TTL_S,
    AccountLinkWrite,
    LinkToken,
    decode_link_probe,
    decode_link_token,
    link_probe_secret,
    link_token_fingerprint,
    mint_link_token,
)
from modules.telegram.registry import (
    _COMMAND_BY_NAME,
    BOT_COMMANDS,
    BOT_DESCRIPTION,
    BOT_SHORT_DESCRIPTION,
    COMMAND_SPECS,
    CommandSpec,
    _build_command_index,
)

_bot: TelegramBot | None = None


def get_bot() -> TelegramBot:
    global _bot
    if _bot is None:
        from modules.audit import get_audit
        from modules.jobs import get_queue
        from modules.risk_proxy import get_gateway
        from modules.tca_engine import get_engine

        _bot = TelegramBot(gateway=get_gateway(), tca=get_engine(), queue=get_queue(), audit=get_audit())
    return _bot


#: The names the rest of the gateway and the suite import off `modules.telegram`.
#: The public sixteen are the surface the module always had; the underscored
#: entries are re-exported because `tests/test_telegram*.py` reach for them by
#: that path, and a package boundary is not a reason to rewrite a test's subject.
__all__ = [
    "BOT_COMMANDS",
    "BOT_DESCRIPTION",
    "BOT_SHORT_DESCRIPTION",
    "COMMAND_SPECS",
    "HELP_TEXT",
    "LINK_KIND_ACCOUNT",
    "LINK_KIND_GUEST",
    "LINK_PROBE_MAX_TTL_S",
    "AccountLinkWrite",
    "CommandSpec",
    "LinkToken",
    "ReplyTarget",
    "TelegramBot",
    "_BOOTSTRAP_COMMANDS",
    "_COMMAND_BY_NAME",
    "_build_command_index",
    "_category_keyboard",
    "_choice_row",
    "_interval_row",
    "_menu_keyboard",
    "_reply_target",
    "_symbol_row",
    "_tab_footer",
    "actor_user_id",
    "cb",
    "command_catalogue",
    "decode_link_probe",
    "decode_link_token",
    "esc",
    "get_bot",
    "help_text",
    "kb",
    "link_probe_secret",
    "link_token_fingerprint",
    "log",
    "mint_link_token",
    "parse_callback",
    "split_telegram_html",
    "text_card",
    "utc_now_label",
]
