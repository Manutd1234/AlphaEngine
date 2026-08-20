"""Card rendering: escaping, number formatting, the card frame, and chunking.

The transport constants live here too because ``text_card`` and
``split_telegram_html`` are what decide whether a reply fits inside them.
"""

from __future__ import annotations

import html
import math
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from modules.telegram._common import _HTML_TAG_RE

_TELEGRAM_MESSAGE_LIMIT = 3900

# Telegram's published ceilings are ~30 sends a second overall and ~1 a second
# to one chat. These sit just inside both: an album command is five sends in a
# burst, and the 429 that earns costs more than the pause would have.
_GLOBAL_SEND_GAP = 1 / 25
_CHAT_SEND_GAP = 1.05
# `retry_after` is honoured, but capped — a command must not be parked
# indefinitely by one hostile or mistaken value.
_MAX_RETRY_AFTER = 15.0
_BOOTSTRAP_COMMANDS = {"/start", "/help", "/commands", "/about", "/whoami", "/version"}


@dataclass
class ReplyTarget:
    """The tapped message a callback's answer should edit in place.

    Carried in a ContextVar rather than threaded through eighty handler
    signatures: the handlers stay unaware that they are answering a button, and
    the senders — the only functions that talk to Telegram — decide whether to
    edit the tapped card or send a fresh one. ``consumed`` flips on first use so
    a handler that sends twice edits once and appends the rest.
    """

    chat_id: str
    message_id: int
    kind: str          # "text" | "photo"
    consumed: bool = False


_reply_target: ContextVar[ReplyTarget | None] = ContextVar("telegram_reply_target", default=None)


def esc(value: Any) -> str:
    """Escape user/provider text for Telegram's HTML parse mode."""
    return html.escape(str(value), quote=False)


def utc_now_label() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _median(values: list[float]) -> float | None:
    """The middle observation.

    Reported beside means throughout the market cards: one halt or one auction
    print drags an average somewhere no bar actually traded, and a reader
    comparing today against "the average" would be comparing against a value
    the instrument never had.
    """
    usable = sorted(value for value in values if value is not None and value == value)
    if not usable:
        return None
    middle = len(usable) // 2
    if len(usable) % 2:
        return usable[middle]
    return (usable[middle - 1] + usable[middle]) / 2


def _stdev(values: list[float]) -> float | None:
    """Sample standard deviation; None below two observations."""
    usable = [value for value in values if value is not None and value == value]
    if len(usable) < 2:
        return None
    mean = sum(usable) / len(usable)
    variance = sum((value - mean) ** 2 for value in usable) / (len(usable) - 1)
    return math.sqrt(variance)


def _money(value: Any, signed: bool = False) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    return f"${number:+,.0f}" if signed else f"${number:,.0f}"


def _number(value: Any, decimals: int = 2, signed: bool = False) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    sign = "+" if signed else ""
    return f"{number:{sign},.{decimals}f}"


def _percent(value: Any, decimals: int = 2, signed: bool = False) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    sign = "+" if signed else ""
    return f"{number:{sign}.{decimals}%}"


def text_card(
    title: str,
    status: str,
    lines: list[str],
    *,
    source: str,
    next_commands: str | None = None,
) -> str:
    """Consistent textual UI: title, freshness/state, metrics, provenance."""
    body = [f"<b>{title}</b>", f"<code>{esc(status)}</code>", "", *lines]
    body += ["", f"<i>{esc(source)} · {utc_now_label()}</i>"]
    if next_commands:
        body.append(f"<i>Next: {esc(next_commands)}</i>")
    return "\n".join(body)


def split_telegram_html(text: str, limit: int = _TELEGRAM_MESSAGE_LIMIT) -> list[str]:
    """Split on complete lines so a message never cuts an HTML tag/entity.

    Generated cards keep every HTML tag on one line. If an upstream value ever
    creates an oversized line, that one line is converted to escaped plain text
    before being split; Telegram then receives valid HTML for every chunk.
    """
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        if current:
            chunks.append("\n".join(current))
            current = []
            current_len = 0

    for line in text.splitlines():
        if len(line) > limit:
            flush()
            plain = esc(html.unescape(_HTML_TAG_RE.sub("", line)))
            for start in range(0, len(plain), limit):
                chunks.append(plain[start:start + limit])
            continue

        extra = len(line) + (1 if current else 0)
        if current and current_len + extra > limit:
            flush()
        current.append(line)
        current_len += len(line) + (1 if len(current) > 1 else 0)
    flush()
    return chunks or [""]
