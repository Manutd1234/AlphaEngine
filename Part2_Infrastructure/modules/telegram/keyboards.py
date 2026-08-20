"""The callback-data grammar, and the standard keyboards built on top of it.

Every button is a shortcut for a typed command and never a capability of its
own — see the banner comments preserved below.
"""

from __future__ import annotations

import re
from typing import Any

from config import settings
from modules.telegram.registry import _COMMAND_BY_NAME, _category_names

# --------------------------------------------------------------------------- #
# Inline keyboards — the callback-data grammar
# --------------------------------------------------------------------------- #
#
# Stateless on purpose: `v1|<command-name>|<arg>|<arg>...`, at most 64 utf-8
# bytes (Telegram's own cap). The command is a spec NAME — never an alias, so a
# renamed alias cannot re-route a button — and the args are the same positional
# tokens the typed command takes. No secrets and no chat ids ride in a button:
# authorisation happens at tap time against the TAPPER's user id, exactly as it
# would for the typed command. A button is a shortcut, never a capability.
_CALLBACK_RE = re.compile(r"^v1\|[a-z][a-z0-9_]*(\|[A-Za-z0-9_.\-=%+:]*)*$")
_CALLBACK_ARG_RE = re.compile(r"^[A-Za-z0-9_.\-=%+:]*$")
_CALLBACK_MAX_BYTES = 64


def cb(command: str, *args: Any) -> str:
    """Build callback data for `command`, validated at build time.

    Raising here rather than at tap time means a bad button is a red test, not
    a dead button in production a user finds first.
    """
    tokens = [str(arg) for arg in args]
    for token in tokens:
        # Per-token, before joining: an arg containing the separator would
        # otherwise join into DIFFERENT valid data — "A|B" arriving as two
        # arguments — which the whole-string grammar cannot see.
        if not _CALLBACK_ARG_RE.fullmatch(token):
            raise ValueError(f"callback argument fails the grammar: {token!r}")
    data = "|".join(["v1", str(command), *tokens])
    if not _CALLBACK_RE.fullmatch(data):
        raise ValueError(f"callback data fails the grammar: {data!r}")
    if len(data.encode("utf-8")) > _CALLBACK_MAX_BYTES:
        raise ValueError(f"callback data exceeds {_CALLBACK_MAX_BYTES} utf-8 bytes: {data!r}")
    spec = _COMMAND_BY_NAME.get(f"/{command}")
    if spec is None or spec.name != command:
        raise ValueError(f"callback command must be a registered spec name, never an alias: {command!r}")
    return data


def parse_callback(data: str) -> tuple[str, list[str]] | None:
    """`(command, args)` for well-formed v1 data; None for anything else.

    None rather than an exception: inbound data is attacker-controlled (any
    client can press a button that never existed), and the caller answers an
    ill-formed tap with a toast, not a traceback.
    """
    if not isinstance(data, str) or not _CALLBACK_RE.fullmatch(data):
        return None
    if len(data.encode("utf-8")) > _CALLBACK_MAX_BYTES:
        return None
    parts = data.split("|")
    return parts[1], parts[2:]


def kb(rows: list[list[tuple[str, str]]]) -> dict[str, Any]:
    """An inline_keyboard reply markup from `(label, callback_data)` rows.

    Enforces Telegram's own ceilings — 8 buttons a row, 100 a keyboard, labels
    1-40 characters — and re-checks every callback datum against the grammar,
    so a keyboard that would be refused by the API is refused here first.
    """
    keyboard: list[list[dict[str, str]]] = []
    total = 0
    for row in rows:
        if not row:
            continue
        if len(row) > 8:
            raise ValueError(f"a keyboard row carries at most 8 buttons, got {len(row)}")
        buttons: list[dict[str, str]] = []
        for label, data in row:
            text = str(label)
            if not 1 <= len(text) <= 40:
                raise ValueError(f"button labels are 1-40 characters, got {text!r}")
            if not _CALLBACK_RE.fullmatch(data) or len(data.encode("utf-8")) > _CALLBACK_MAX_BYTES:
                raise ValueError(f"button callback data fails validation: {data!r}")
            buttons.append({"text": text, "callback_data": data})
        total += len(buttons)
        keyboard.append(buttons)
    if total > 100:
        raise ValueError(f"a keyboard carries at most 100 buttons, got {total}")
    return {"inline_keyboard": keyboard}

# --------------------------------------------------------------------------- #
# Standard keyboards
# --------------------------------------------------------------------------- #
#
# Keyboards are additive: every card that carries one still lists its typed
# equivalents in the `Next:` line, and every button resolves to a registered
# command name. Keyboards live on text cards or single-photo cards; albums
# never carry keyboards — Telegram has nowhere to hang one on a media group.

_INTERVALS = ("15m", "1h", "4h", "1d")


def _menu_keyboard() -> dict[str, Any]:
    """The desk menu: one button per role tab, plus the daily traffic."""
    return kb([
        [
            ("🌐 Overview", cb("overview")),
            ("🔬 Research", cb("research")),
            ("⚡ Execution", cb("execution")),
            ("📁 Portfolio", cb("portfolio")),
        ],
        [
            ("🛡 Risk", cb("risk")),
            ("📊 Data", cb("data")),
            ("🛡️ Reliability", cb("reliability")),
            ("💻 Developer", cb("developer")),
        ],
        [
            ("🗞 Digest", cb("digest")),
            ("⚙️ Status", cb("status")),
            ("ℹ️ Help", cb("help")),
        ],
    ])


def _tab_footer(
    tab: str,
    sections: list[tuple[str, str]],
    *,
    refresh: str,
    extra_rows: list[list[tuple[str, str]]] | None = None,
) -> dict[str, Any]:
    """A tab card's footer: its sections in rows of four, then refresh + menu.

    `tab` names the card the footer belongs to — carried for callers and logs
    rather than rendered. `extra_rows` (a symbol row, an interval row) slot in
    between the sections and the refresh row so validation stays in `kb`.
    """
    del tab  # identification only; the layout does not render it
    rows: list[list[tuple[str, str]]] = [sections[i:i + 4] for i in range(0, len(sections), 4)]
    if extra_rows:
        rows.extend(extra_rows)
    rows.append([("↻ Refresh", refresh), ("⌂ Menu", cb("menu"))])
    return kb(rows)


def _interval_row(command: str, symbol: str, current: str, *tail: str) -> list[tuple[str, str]]:
    """One button per supported interval; the active one is bulleted."""
    return [
        (f"• {interval}" if interval == current else interval, cb(command, symbol, interval, *tail))
        for interval in _INTERVALS
    ]


def _symbol_row(command: str, current: str, *tail: str) -> list[tuple[str, str]]:
    """One button per tracked symbol (at most 6); the active one is bulleted."""
    row: list[tuple[str, str]] = []
    for symbol in [value.upper() for value in settings.symbols][:6]:
        row.append((f"• {symbol}" if symbol == current else symbol, cb(command, symbol, *tail)))
    return row


def _choice_row(
    command: str,
    choices: list[tuple[str, str]],
    current: str,
    prefix_args: tuple = (),
    suffix_args: tuple = (),
) -> list[tuple[str, str]]:
    """One button per `(label, value)` choice; the active value is bulleted."""
    return [
        (f"• {label}" if value == current else label, cb(command, *prefix_args, value, *suffix_args))
        for label, value in choices
    ]


def _category_keyboard() -> dict[str, Any]:
    """One button per help category, in rows of three."""
    buttons = [(category, cb("help", category.lower())) for category in _category_names()]
    return kb([buttons[i:i + 3] for i in range(0, len(buttons), 3)])
