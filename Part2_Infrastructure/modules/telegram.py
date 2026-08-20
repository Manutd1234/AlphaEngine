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
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import html
import json
import logging
import math
import re
import secrets
import time
import uuid
from collections import deque
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from config import settings
from modules.telegram_charts import (
    generate_bars_chart_png,
    generate_cone_png,
    generate_depth_chart_png,
    generate_drawdown_chart_png,
    generate_equity_chart_png,
    generate_gate_ladder_png,
    generate_heatmap_png,
    generate_histogram_png,
    generate_latency_cdf_png,
    generate_multi_series_png,
    generate_paired_bars_png,
    generate_pipeline_png,
    generate_scatter_png,
    generate_series_chart_png,
    generate_status_grid_png,
    generate_var_breach_png,
)

log = logging.getLogger("alphaengine.telegram")

_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,20}$")
_HTML_TAG_RE = re.compile(r"</?(?:b|i|code|pre|u|s)(?:\s[^>]*)?>", re.IGNORECASE)
_TELEGRAM_ACTOR_RE = re.compile(r"^tg:([1-9][0-9]*):")


def actor_user_id(actor: Any) -> str:
    """The bare numeric Telegram user id inside a ``tg:<id>:<username>`` actor.

    Empty string when the actor is not that shape, and every caller must treat
    that as "no identity" rather than as a name. The composite exists because
    the audit log wants a readable actor; every allow-list in this module
    compares bare ids, and handing one of them the whole string is how `/halt`
    spent months answering "not permitted" to the operators who configured it.
    """
    match = _TELEGRAM_ACTOR_RE.match(str(actor))
    return match.group(1) if match else ""


# --------------------------------------------------------------------------- #
# Desk-pass → Telegram link tokens
# --------------------------------------------------------------------------- #
#
# A ``t.me/<bot>?start=<token>`` payload may be at most 64 characters from
# ``[A-Za-z0-9_-]``, which rules out anything JSON-shaped: a bare UUID in text
# is already 36 of them. So the token is packed binary, then base64url'd —
# 38 bytes in, 51 characters out, comfortably inside Telegram's ceiling:
#
#     version(1) ‖ kind(1) ‖ expires_at(4, big-endian) ‖ nonce(4) ‖ uuid(16)
#     ‖ HMAC-SHA256(secret, everything above)[:12]
#
# Self-describing and signed rather than a handle into a table, because the two
# ends are different processes on different hosts: the web app mints, the
# gateway verifies, and they share a secret rather than a database. That also
# gives the property the in-process `_challenges` dict cannot — a gateway
# restart between the tap and the ``/start`` does not silently void the link.
#
# Single use is enforced where it has to be, at redemption, by a persisted
# ledger in the audit store (``AuditLog.claim_link_token``). Minting writes
# nothing, so a page that mints a fresh token on every hover costs one HMAC.
_LINK_TOKEN_VERSION = 1
LINK_KIND_ACCOUNT = "account"
LINK_KIND_GUEST = "guest"
_LINK_KIND_BYTE = {LINK_KIND_ACCOUNT: 1, LINK_KIND_GUEST: 2}
_LINK_KIND_NAME = {value: name for name, value in _LINK_KIND_BYTE.items()}
_LINK_MAC_BYTES = 12
_LINK_PAYLOAD_BYTES = 26
_LINK_TOKEN_BYTES = _LINK_PAYLOAD_BYTES + _LINK_MAC_BYTES
_LINK_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class LinkToken:
    """A verified link token: who minted it, on which side of the desk, and until when."""

    kind: str
    identity: str
    expires_at: datetime

    @property
    def web_identity(self) -> str:
        """The value stored against the binding — kind included, deliberately.

        A guest UUID and an account UUID are both 16 bytes and neither carries
        its own provenance. Storing ``guest:…`` alongside ``account:…`` means the
        expiry policy can read the row rather than infer from a lookup that may
        no longer be possible.
        """
        return f"{self.kind}:{self.identity}"


@dataclass(frozen=True)
class AccountLinkWrite:
    """What happened when the durable copy was attempted, and why.

    ``ok`` is tri-state on purpose: ``True`` written, ``False`` refused,
    ``None`` never attempted because this gateway holds no Supabase
    credentials. Collapsing the last two into ``False`` is what made a
    deployment with no credentials indistinguishable from a deployment whose
    write was rejected — the confirmation card said the same thing for both.
    """

    ok: bool | None
    reason: str | None = None
    #: The desk identity whose binding this write destroyed, if it destroyed one.
    replaced: str | None = None


def _postgrest_reason(response: httpx.Response) -> str:
    """The sentence PostgREST put in the body, or a description of the silence.

    PostgREST answers a missing table and an unauthorised key with bodies that
    differ only in their text; the status codes overlap. Returning ``message``
    is the difference between "run the migration" and "rotate the key" showing
    up on the operator's screen instead of in nobody's log.
    """
    body = (response.text or "").strip()
    if not body:
        return f"Supabase refused the write with HTTP {response.status_code} and no body."
    try:
        parsed = json.loads(body)
    except ValueError:
        return _clip(body)
    if isinstance(parsed, dict):
        # `message` is the human sentence; `hint` is often the actionable half
        # ("Perhaps you meant …"), so it travels when present.
        message = str(parsed.get("message") or "").strip()
        hint = str(parsed.get("hint") or "").strip()
        if message:
            return _clip(f"{message} {hint}".strip())
    return _clip(body)


def _clip(text: str, limit: int = 220) -> str:
    """Keep a reason readable inside a Telegram card."""
    collapsed = " ".join(text.split())
    return collapsed if len(collapsed) <= limit else collapsed[: limit - 1] + "…"


def _replaced_identity(response: httpx.Response, incoming: str) -> str | None:
    """The desk identity a delete just unbound, when it was somebody else's.

    Reconnecting from the same account is a refresh and needs no announcement.
    Reconnecting from a *different* one destroys a binding that a previous card
    promised would last, so that card's promise has to be retracted out loud.
    """
    try:
        rows = json.loads(response.text or "[]")
    except ValueError:
        return None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            continue
        previous = str(row.get("user_id") or "").strip()
        if previous and previous != incoming:
            return previous
    return None


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _link_mac(payload: bytes, secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()[:_LINK_MAC_BYTES]


def link_token_fingerprint(token: str) -> str:
    """What the single-use ledger stores instead of the token itself."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def mint_link_token(
    kind: str,
    identity: str,
    secret: str,
    ttl_s: float,
    *,
    now: float | None = None,
    nonce: bytes | None = None,
) -> str:
    """Mint a deep-link token for a web identity. The web app is the usual minter.

    Present here as well so the format has one executable definition on this
    side of the wire, and so `tests/test_telegram_link.py` can pin the exact
    bytes against the TypeScript minter's own vector.
    """
    if kind not in _LINK_KIND_BYTE:
        raise ValueError(f"unknown link kind {kind!r}")
    identity_bytes = uuid.UUID(identity).bytes
    expires_at = int((time.time() if now is None else now) + ttl_s)
    payload = (
        bytes([_LINK_TOKEN_VERSION, _LINK_KIND_BYTE[kind]])
        + expires_at.to_bytes(4, "big")
        + (nonce or secrets.token_bytes(4))
        + identity_bytes
    )
    return _b64url_encode(payload + _link_mac(payload, secret))


def decode_link_token(token: str, secret: str, *, now: float | None = None) -> LinkToken:
    """Verify a token and return what it claims. ``ValueError`` carries the refusal text.

    Every failure message is written to be shown to whoever presented it: a
    refusal that does not say which of "malformed", "not ours" and "too old"
    happened sends the reader to an operator instead of back to the button.
    """
    if not _LINK_TOKEN_RE.fullmatch(token or ""):
        raise ValueError("That start code is not in the format this desk issues.")
    try:
        raw = _b64url_decode(token)
    except (ValueError, TypeError) as exc:
        raise ValueError("That start code is not in the format this desk issues.") from exc
    if len(raw) != _LINK_TOKEN_BYTES or raw[0] != _LINK_TOKEN_VERSION:
        raise ValueError("That start code is not in the format this desk issues.")

    payload, mac = raw[:_LINK_PAYLOAD_BYTES], raw[_LINK_PAYLOAD_BYTES:]
    # Constant time: the verifier is a pure function an attacker can call as
    # often as they like, so a comparison that returns early on the first wrong
    # byte is a byte-at-a-time oracle for the signature.
    if not hmac.compare_digest(mac, _link_mac(payload, secret)):
        raise ValueError("That start code was not issued by this desk.")

    kind = _LINK_KIND_NAME.get(payload[1])
    if kind is None:
        raise ValueError("That start code is not in the format this desk issues.")
    expires_at = int.from_bytes(payload[2:6], "big")
    if (time.time() if now is None else now) > expires_at:
        raise ValueError("That connect link has expired. Tap Connect on the desk again.")
    return LinkToken(
        kind=kind,
        identity=str(uuid.UUID(bytes=payload[10:26])),
        expires_at=datetime.fromtimestamp(expires_at, timezone.utc).replace(tzinfo=None),
    )


# --------------------------------------------------------------------------- #
# Read-only status probes
# --------------------------------------------------------------------------- #
#
# The desk needs to answer one question it could not answer before: "is the
# browser I am holding already bound to a chat?". For an account the web app can
# read its own Supabase row under RLS; for a GUEST the binding exists only in
# this process's store, so the chip could never turn green and a guest was
# invited to reconnect a chat they had already connected.
#
# The probe closes that, and it reuses the link token's exact layout on purpose
# — one packed format, one verifier, one set of failure messages — with ONE
# difference that carries the whole security argument: it is signed with a
# DIFFERENT KEY, derived from the same shared secret by domain separation.
#
#     probe key = HMAC-SHA256(TELEGRAM_LINK_SECRET, "alphaengine/telegram-link-probe/v1")
#
# So a probe presented to ``/start`` fails as "not issued by this desk", and a
# link token presented to the status endpoint fails the same way. That matters
# because the two travel differently: a link token is a bearer credential that
# BINDS a chat, while a probe only asks a yes/no question, and the probe is the
# one that will sit in server-to-server request bodies and proxy logs. Without
# the separation, anything that could read a probe in flight could redeem it as
# a link and bind its own Telegram account to somebody else's desk pass.
_LINK_PROBE_CONTEXT = b"alphaengine/telegram-link-probe/v1"

#: A probe is minted server-side and spent in the same request, so its whole
#: legitimate life is one round trip. The ceiling is enforced HERE rather than
#: trusted to the minter: a bug or a compromise on the web side must not be able
#: to issue a probe that answers the same question for a week.
LINK_PROBE_MAX_TTL_S = 300


def link_probe_secret(secret: str) -> str:
    """The key a status probe is signed with — never the key a link is signed with.

    Domain separation, so the two token families cannot be swapped for one
    another. See the block comment above for why that is the load-bearing part.
    Mirrored by ``linkProbeSecret`` in ``web/lib/telegram-link.ts``; both suites
    pin the same known-answer vector.
    """
    return hmac.new(secret.encode("utf-8"), _LINK_PROBE_CONTEXT, hashlib.sha256).hexdigest()


def decode_link_probe(token: str, secret: str, *, now: float | None = None) -> LinkToken:
    """Verify a status probe. ``ValueError`` carries the refusal text, as above."""
    probe = decode_link_token(token, link_probe_secret(secret), now=now)
    horizon = (time.time() if now is None else now) + LINK_PROBE_MAX_TTL_S
    if probe.expires_at.replace(tzinfo=timezone.utc).timestamp() > horizon:
        raise ValueError("That status probe is valid for longer than this desk accepts.")
    return probe


"""The gates the deploy workflow actually runs before it will ship a build.

This replaced three hardcoded assertion counts (342/680/13) that drifted the
moment anyone added a test — including the tests added to cover this very
module. A number nobody updates is worse than no number, because it keeps
looking authoritative. These are names, not counts: they are checkable against
`.github/workflows/deploy.yml` by reading it.
"""
_VERIFY_GATES: tuple[str, ...] = (
    "ruff check .",
    "python -m pytest",
    "tools/export_openapi.py --check",
    "tools/synthetic_probe.py",
)


def _committed_route_counts() -> list[tuple[str, float]]:
    """Routes per tag, parsed from the committed OpenAPI snapshot.

    Real committed data that updates itself when a route lands, rather than a
    figure maintained by hand. Returns an empty list when the snapshot is not
    in the image, so the caller can say so rather than draw a lie.
    """
    snapshot = Path(__file__).resolve().parent.parent / "tools" / "openapi.json"
    try:
        document = json.loads(snapshot.read_text())
    except (OSError, ValueError):
        return []
    counts: dict[str, int] = {}
    for operations in document.get("paths", {}).values():
        for operation in operations.values():
            if not isinstance(operation, dict):
                continue
            for tag in operation.get("tags", ["untagged"]):
                counts[str(tag)] = counts.get(str(tag), 0) + 1
    return sorted(((tag, float(n)) for tag, n in counts.items()), key=lambda row: -row[1])


def _openapi_operations_by_tag() -> dict[str, list[tuple[str, str, str]]]:
    """``tag -> [(METHOD, path, summary)]`` from the committed OpenAPI snapshot.

    A synchronous file read on purpose: the ``/apis`` handler is async and
    ruff's ASYNC rules (rightly) refuse a blocking read inside a coroutine, so
    the disk touch is isolated here where it is plainly synchronous. Empty when
    the snapshot is not in the image.
    """
    snapshot = Path(__file__).resolve().parent.parent / "tools" / "openapi.json"
    try:
        document = json.loads(snapshot.read_text())
    except (OSError, ValueError):
        return {}
    by_tag: dict[str, list[tuple[str, str, str]]] = {}
    for path, operations in (document.get("paths") or {}).items():
        for method, operation in operations.items():
            if not isinstance(operation, dict):
                continue
            for tag in operation.get("tags", ["untagged"]):
                by_tag.setdefault(str(tag), []).append(
                    (method.upper(), str(path), str(operation.get("summary") or ""))
                )
    return by_tag


def _codebase_line_counts() -> list[tuple[str, int, int]]:
    """``(area, files, lines)`` for the Python that ships, walked from disk.

    Synchronous, and called from the async ``/codebase`` handler for the same
    reason ``_openapi_operations_by_tag`` is: the walk blocks, so it stays out
    of the coroutine.
    """
    import os

    root = Path(__file__).resolve().parent.parent
    areas = {"modules": root / "modules", "tools": root / "tools", "tests": root / "tests"}
    counts: list[tuple[str, int, int]] = []
    for name, path in areas.items():
        files = 0
        total_lines = 0
        if path.exists():
            for dirpath, _dirs, filenames in os.walk(path):
                if "__pycache__" in dirpath:
                    continue
                for filename in filenames:
                    if not filename.endswith(".py"):
                        continue
                    files += 1
                    try:
                        with (Path(dirpath) / filename).open("r", encoding="utf-8", errors="ignore") as handle:
                            total_lines += sum(1 for _ in handle)
                    except OSError:
                        pass
        counts.append((name, files, total_lines))
    main = root / "main.py"
    if main.exists():
        with main.open("r", encoding="utf-8", errors="ignore") as handle:
            counts.append(("main.py", 1, sum(1 for _ in handle)))
    return counts


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


@dataclass(frozen=True)
class CommandSpec:
    name: str
    description: str
    category: str
    usage: str
    example: str
    handler: str
    aliases: tuple[str, ...] = ()
    #: Whether the command appears in Telegram's own "/" command menu, which
    #: caps out at 100 entries. Every command dispatches either way; /commands
    #: lists the complete catalogue. Kept False for the niche reference and
    #: duplicate-view commands so the menu stays under the cap as the
    #: catalogue grows.
    in_menu: bool = True


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    # 8 Desk Role Tabs (Explicit Vercel UI Tab mapping with Visual Charts)
    CommandSpec("overview", "Overview (All Roles) · System signal & cross-role dashboard + chart", "Tabs", "/overview", "/overview", "_cmd_tab_overview", ("tab_overview", "dashboard")),
    CommandSpec("research", "Research (Quant Researcher) · Strategy sweep & tearsheet + chart", "Tabs", "/research [SYMBOL]", "/research BTCUSDT", "_cmd_tab_research", ("tab_research", "lab")),
    CommandSpec("execution", "Execution (Quant Trader) · Live L2 book & routing + chart", "Tabs", "/execution [SYMBOL]", "/execution BTCUSDT", "_cmd_tab_execution", ("tab_execution", "trade")),
    CommandSpec("data", "Data (Data Engineer) · Quality, freshness & failover + chart", "Tabs", "/data", "/data", "_cmd_tab_data", ("tab_data", "dataeng")),
    CommandSpec("reliability", "Reliability (DevOps/SRE) · Telemetry & latency + chart", "Tabs", "/reliability", "/reliability", "_cmd_tab_reliability", ("tab_reliability", "sre")),
    CommandSpec("developer", "Developer (Quant Developer) · CI/CD, OpenAPI & repo posture + chart", "Tabs", "/developer", "/developer", "_cmd_tab_developer", ("tab_developer", "dev")),

    # Essentials
    CommandSpec("start", "Essentials · Open the command centre", "Essentials", "/start", "/start", "_cmd_start"),
    CommandSpec("menu", "Essentials · Tappable desk menu", "Essentials", "/menu", "/menu", "_cmd_menu", ("home", "tabs")),
    CommandSpec("help", "Essentials · Help by category or command", "Essentials", "/help [CATEGORY|COMMAND]", "/help markets", "_cmd_help"),
    CommandSpec("commands", "Essentials · List the complete command catalogue", "Essentials", "/commands", "/commands", "_cmd_commands"),
    CommandSpec("status", "Essentials · Gateway, feeds, queue and OpenBB", "Essentials", "/status", "/status", "_cmd_status", ("health",)),
    CommandSpec("about", "Essentials · What this independent bot does", "Essentials", "/about", "/about", "_cmd_about"),
    CommandSpec("whoami", "Essentials · Show Telegram user and chat IDs", "Essentials", "/whoami", "/whoami", "_cmd_whoami"),
    CommandSpec("version", "Essentials · Runtime version and bot mode", "Essentials", "/version", "/version", "_cmd_version", in_menu=False),
    CommandSpec("ping", "Essentials · Check command-path responsiveness", "Essentials", "/ping", "/ping", "_cmd_ping", in_menu=False),

    # Portfolio manager. /portfolio and /risk are the 7th and 8th tab commands —
    # category "Tabs" so the README's "8 tab commands" is literally true and both
    # carry a `_tab_footer` mapping to their web rail sections.
    CommandSpec("portfolio", "Portfolio (Portfolio Manager) · Whole-book PM summary + charts", "Tabs", "/portfolio", "/portfolio", "_cmd_portfolio", ("bookstate",)),
    CommandSpec("equity", "Portfolio · Persisted equity curve and period returns", "Portfolio", "/equity [LIMIT]", "/equity", "_cmd_equity", ("curve", "history")),
    CommandSpec("positions", "Portfolio · Open positions and marks", "Portfolio", "/positions [SYMBOL]", "/positions BTCUSDT", "_cmd_positions", ("toppositions", "position")),
    CommandSpec("pnl", "Portfolio · Realised and unrealised P&L", "Portfolio", "/pnl", "/pnl", "_cmd_pnl"),
    CommandSpec("exposure", "Portfolio · Gross, net and leverage", "Portfolio", "/exposure", "/exposure", "_cmd_exposure"),
    CommandSpec("concentration", "Portfolio · Largest weights and effective bets", "Portfolio", "/concentration", "/concentration", "_cmd_concentration"),
    CommandSpec("headroom", "Portfolio · Remaining capacity before limits", "Portfolio", "/headroom", "/headroom", "_cmd_headroom"),
    CommandSpec("risk", "Risk (Risk Manager) · Drawdown, gateway budget & limit utilisation + charts", "Tabs", "/risk", "/risk", "_cmd_risk"),
    CommandSpec("limits", "Portfolio · Deployed hard risk limits", "Portfolio", "/limits", "/limits", "_cmd_limits"),
    CommandSpec("attribution", "Portfolio · Flow and costs by strategy", "Portfolio", "/attribution", "/attribution", "_cmd_attribution"),
    CommandSpec("allocation", "Portfolio · Current vs target weights and the rebalance trades", "Portfolio", "/allocation [ew|iv|erc|mv]", "/allocation", "_cmd_allocation", ("alloc",)),
    CommandSpec("performance", "Portfolio · Realised P&L and fees by strategy sleeve", "Portfolio", "/performance", "/performance", "_cmd_performance", ("perf",)),

    # Market data / OpenBB
    CommandSpec("openbb", "Markets · OpenBB provider readiness", "Markets", "/openbb", "/openbb", "_cmd_openbb"),
    CommandSpec("quote", "Markets · OpenBB quote", "Markets", "/quote SYMBOL [equity|crypto]", "/quote AAPL", "_cmd_quote", ("market",)),
    CommandSpec("bars", "Markets · Recent OpenBB OHLCV rows", "Markets", "/bars SYMBOL [15m|1h|4h|1d] [COUNT]", "/bars AAPL 1d 5", "_cmd_bars"),
    CommandSpec("trend", "Markets · Return and direction over recent bars", "Markets", "/trend SYMBOL [INTERVAL] [COUNT]", "/trend NVDA 1d 20", "_cmd_trend"),
    CommandSpec("range", "Markets · High/low range over recent bars", "Markets", "/range SYMBOL [INTERVAL] [COUNT]", "/range BTCUSDT 4h 12", "_cmd_range", in_menu=False),
    CommandSpec("volume", "Markets · Latest and average volume", "Markets", "/volume SYMBOL [INTERVAL] [COUNT]", "/volume MSFT 1d 20", "_cmd_volume", in_menu=False),
    CommandSpec("news", "Markets · Latest company headlines", "Markets", "/news SYMBOL [COUNT]", "/news AAPL 5", "_cmd_news"),
    CommandSpec("fundamentals", "Markets · Company profile and key metrics", "Markets", "/fundamentals SYMBOL", "/fundamentals NVDA", "_cmd_fundamentals", ("profile", "valuation")),
    CommandSpec("snapshot", "Markets · Quote, fundamentals and headlines", "Markets", "/snapshot SYMBOL [equity|crypto]", "/snapshot AAPL", "_cmd_snapshot"),
    CommandSpec("symbols", "Markets · Tracked instruments and examples", "Markets", "/symbols", "/symbols", "_cmd_symbols", in_menu=False),
    CommandSpec("compare", "Markets · Normalised price overlay across instruments", "Markets", "/compare SYM1 SYM2 [SYM3…] [INTERVAL]", "/compare BTCUSDT ETHUSDT", "_cmd_compare", ("overlay",)),

    # Execution analytics (read-only)
    CommandSpec("book", "Execution · Top of book across venues", "Execution", "/book [SYMBOL]", "/book BTCUSDT", "_cmd_book"),
    CommandSpec("spread", "Execution · Venue and consolidated spreads", "Execution", "/spread [SYMBOL]", "/spread BTCUSDT", "_cmd_spread"),
    CommandSpec("depth", "Execution · Bid/ask depth by venue", "Execution", "/depth [SYMBOL]", "/depth ETHUSDT", "_cmd_depth"),
    CommandSpec("tca", "Execution · VWAP, slippage and smart route", "Execution", "/tca [SYMBOL] [NOTIONAL] [BUY|SELL]", "/tca BTCUSDT 100000 BUY", "_cmd_tca", ("cost",)),
    CommandSpec("route", "Execution · Smart-route allocation only", "Execution", "/route [SYMBOL] [NOTIONAL] [BUY|SELL]", "/route BTCUSDT 50000 SELL", "_cmd_route"),
    CommandSpec("liquidity", "Execution · Fillability and route capacity", "Execution", "/liquidity [SYMBOL] [NOTIONAL]", "/liquidity BTCUSDT 250000", "_cmd_liquidity"),
    CommandSpec("venues", "Execution · Venue connectivity overview", "Execution", "/venues", "/venues", "_cmd_venues"),
    CommandSpec("feedstatus", "Execution · Detailed market-feed health", "Execution", "/feedstatus", "/feedstatus", "_cmd_feedstatus"),
    CommandSpec("orders", "Execution · Recent gateway decisions", "Execution", "/orders [COUNT]", "/orders 10", "_cmd_orders"),
    CommandSpec("fills", "Execution · Recent accepted fills", "Execution", "/fills [COUNT]", "/fills 10", "_cmd_fills"),
    CommandSpec("rejections", "Execution · Recent rejected orders", "Execution", "/rejections [COUNT]", "/rejections 10", "_cmd_rejections"),
    CommandSpec("slippage", "Execution · Aggregate execution slippage", "Execution", "/slippage", "/slippage", "_cmd_slippage", in_menu=False),
    CommandSpec("fees", "Execution · Aggregate execution fees", "Execution", "/fees", "/fees", "_cmd_fees", in_menu=False),

    # Research and audit monitoring (no job submission)
    CommandSpec("researchstatus", "Research · OpenBB and job-system status", "Research", "/researchstatus", "/researchstatus", "_cmd_research_status", in_menu=False),
    CommandSpec("jobs", "Research · Recent research jobs", "Research", "/jobs [COUNT]", "/jobs 10", "_cmd_jobs"),
    CommandSpec("job", "Research · Inspect one job", "Research", "/job JOB_ID", "/job abcd1234", "_cmd_job", in_menu=False),
    CommandSpec("backtests", "Research · Completed backtest history", "Research", "/backtests [COUNT]", "/backtests 10", "_cmd_backtests", ("runs", "experiments")),
    CommandSpec("timeline", "Execution · Lifecycle of one order from the audit trail", "Execution", "/timeline ORDER_ID", "/timeline abc123", "_cmd_timeline", ("ordertrace",)),
    CommandSpec("working", "Execution · Orders resting on the book right now", "Execution", "/working [SYMBOL]", "/working", "_cmd_working"),
    CommandSpec("ops", "Essentials · Structured reliability snapshot", "Essentials", "/ops", "/ops", "_cmd_ops"),
    CommandSpec("backtest", "Research · Queue a parameter sweep on the shared jobs engine", "Research", "/backtest SYMBOL [INTERVAL] [STRATEGY]", "/backtest BTCUSDT 1h ma_cross", "_cmd_backtest", ("sweep",)),
    CommandSpec("rag", "Research · Similarity search over this desk's own runs and incidents", "Research", "/rag QUERY", "/rag momentum drawdown", "_cmd_rag", ("similar", "recall")),
    CommandSpec("strategies", "Research · Supported strategy catalogue", "Research", "/strategies [STRATEGY]", "/strategies", "_cmd_strategies", ("codex", "guide")),
    CommandSpec("intervals", "Research · Supported market horizons", "Research", "/intervals", "/intervals", "_cmd_intervals", in_menu=False),
    CommandSpec("events", "Research · Recent risk/audit events", "Research", "/events [COUNT]", "/events 10", "_cmd_events"),
    CommandSpec("incidents", "Research · Warning and critical events", "Research", "/incidents [COUNT]", "/incidents 10", "_cmd_incidents"),

    # Notification preferences
    CommandSpec("subscribe", "Alerts · Receive operational notifications", "Alerts", "/subscribe", "/subscribe", "_cmd_subscribe", ("unmute",)),
    CommandSpec("unsubscribe", "Alerts · Stop optional notifications", "Alerts", "/unsubscribe", "/unsubscribe", "_cmd_unsubscribe", ("mute",)),
    CommandSpec("subscriptions", "Alerts · Show notification state", "Alerts", "/subscriptions", "/subscriptions", "_cmd_subscriptions", ("alerts",), in_menu=False),
    CommandSpec("role", "Alerts · Set this chat's desk role for targeted alerts", "Alerts", "/role [pm|risk|trader|dev|any]", "/role pm", "_cmd_role", ("desk",)),
    CommandSpec("thresholds", "Alerts · Risk rules, their limits and what they read now", "Alerts", "/thresholds", "/thresholds", "_cmd_thresholds", ("rules",)),
    CommandSpec("live", "Alerts · Stream the desk into one message that updates itself", "Alerts", "/live [on|off]", "/live on", "_cmd_live", ("stream",)),
    CommandSpec("livestatus", "Alerts · What is streaming, and how often", "Alerts", "/livestatus", "/livestatus", "_cmd_livestatus", in_menu=False),
    CommandSpec("probe", "Execution · Cost of the default probe, no arguments needed", "Execution", "/probe [NOTIONAL] [BUY|SELL]", "/probe", "_cmd_probe", ("cost_probe",)),
    CommandSpec("engine", "Developer · Which decision engine is running, and its measured cost", "Developer", "/engine", "/engine", "_cmd_engine", ("core",)),
    CommandSpec("refresh", "Overview · Re-read the desk from the gateway right now", "Overview", "/refresh", "/refresh", "_cmd_refresh", ("resync",)),
    CommandSpec("watch", "Alerts · Watch execution-cost deterioration", "Alerts", "/watch SYMBOL [NOTIONAL] [MAX_BPS]", "/watch BTCUSDT 100000 25", "_cmd_watch"),
    CommandSpec("unwatch", "Alerts · Remove one or all liquidity watches", "Alerts", "/unwatch [SYMBOL]", "/unwatch BTCUSDT", "_cmd_unwatch", in_menu=False),
    CommandSpec("watches", "Alerts · Show active liquidity watches", "Alerts", "/watches", "/watches", "_cmd_watches", in_menu=False),
    CommandSpec("digest", "Alerts · On-demand portfolio and systems digest", "Alerts", "/digest", "/digest", "_cmd_digest"),

    # Quant risk — read-only, computed by modules/quant_risk.py against the
    # gateway's own book so a number quoted here matches the web tab's.
    CommandSpec("var", "Risk · Portfolio VaR and expected shortfall", "Risk", "/var [1d|4h|1h]", "/var", "_cmd_var", ("cvar",)),
    CommandSpec("riskcontrib", "Risk · Which position carries the risk", "Risk", "/riskcontrib [INTERVAL]", "/riskcontrib", "_cmd_riskcontrib", ("contrib",)),
    CommandSpec("correlation", "Risk · Cross-position correlation matrix", "Risk", "/correlation [INTERVAL]", "/correlation", "_cmd_correlation", ("corr",)),
    CommandSpec("stress", "Risk · Scenario loss on the current book", "Risk", "/stress [SCENARIO]", "/stress", "_cmd_stress", ("scenario",)),
    CommandSpec("varbacktest", "Risk · Has the VaR model been right?", "Risk", "/varbacktest [INTERVAL]", "/varbacktest", "_cmd_varbacktest", ("kupiec",)),
    CommandSpec("rebalance", "Risk · Target weights and the trades to reach them", "Risk", "/rebalance [ew|iv|erc|mv]", "/rebalance", "_cmd_rebalance", ("targets",)),
    CommandSpec("regime", "Risk · Volatility regime for an instrument", "Risk", "/regime SYMBOL [INTERVAL]", "/regime BTCUSDT", "_cmd_regime"),
    CommandSpec("size", "Risk · Kelly position sizing from a win rate", "Risk", "/size WIN_RATE PAYOFF [EQUITY]", "/size 0.55 1.8", "_cmd_size", ("kelly",), in_menu=False),
    CommandSpec("dislocation", "Risk · Cross-venue crossed-book check", "Risk", "/dislocation SYMBOL", "/dislocation BTCUSDT", "_cmd_dislocation", ("arb",), in_menu=False),
    CommandSpec("montecarlo", "Risk · Bootstrapped terminal-P&L cone over a horizon", "Risk", "/montecarlo [1|5|20] [BLOCK]", "/montecarlo 5 10", "_cmd_montecarlo", ("mc", "cone")),
    CommandSpec("beta", "Risk · Beta and hedge ratio of a symbol against a reference", "Risk", "/beta SYM [REF]", "/beta ETHUSDT BTCUSDT", "_cmd_beta", ("hedge",)),

    # Research fold detail — reads the newest in-process completed backtest and
    # falls back to the audit history with an honest note when the run happened
    # in another process.
    CommandSpec("walkforward", "Research · In-sample vs out-of-sample Sharpe per fold", "Research", "/walkforward SYMBOL [STRATEGY]", "/walkforward BTCUSDT", "_cmd_walkforward", ("wf",)),
    CommandSpec("stability", "Research · Parameter-grid heatmap and the stable region", "Research", "/stability SYMBOL [STRATEGY]", "/stability BTCUSDT", "_cmd_stability", ("surface", "paramgrid")),
    CommandSpec("overfit", "Research · DSR, PSR, PBO and the minimum track record", "Research", "/overfit SYMBOL [STRATEGY]", "/overfit BTCUSDT", "_cmd_overfit", ("pbo", "dsr")),
    CommandSpec("decision", "Research · Promotion gates and sizing for a candidate", "Research", "/decision SYMBOL [STRATEGY]", "/decision BTCUSDT", "_cmd_decision", ("promote",)),

    # Execution / operations analytics — read-only reads of live state and audit.
    CommandSpec("lineage", "Execution · Signal path OpenBB→feeds→book→gates→decisions→audit", "Execution", "/lineage [SYMBOL]", "/lineage", "_cmd_lineage", ("signalpath", "loop")),
    CommandSpec("gates", "Execution · Dry-run the 17 pre-trade gates against current state", "Execution", "/gates [SYMBOL] [NOTIONAL] [BUY|SELL]", "/gates BTCUSDT", "_cmd_gates", ("pretrade", "preflight")),
    CommandSpec("quality", "Execution · Fill quality by venue or strategy", "Execution", "/quality [venue|strategy]", "/quality", "_cmd_quality", ("fillquality",)),
    CommandSpec("imbalance", "Execution · Order-book imbalance per venue", "Execution", "/imbalance SYMBOL", "/imbalance BTCUSDT", "_cmd_imbalance", ("imb", "pressure")),
    CommandSpec("costs", "Execution · Session fees versus slippage", "Execution", "/costs [YYYY-MM-DD]", "/costs", "_cmd_costs", ("sessioncosts",)),
    CommandSpec("latency", "Execution · Decision-latency CDF and route tail", "Execution", "/latency", "/latency", "_cmd_latency", ("decisionlatency", "tail")),
    CommandSpec("blotter", "Execution · Merged recent orders and working, rejections by gate", "Execution", "/blotter [all|fills|rejects|working] [N]", "/blotter", "_cmd_blotter", ("tape",)),
    CommandSpec("spreadhistory", "Execution · Spread, slippage or depth history per venue", "Execution", "/spreadhistory SYMBOL [VENUE] [spread|slip|depth]", "/spreadhistory BTCUSDT", "_cmd_spreadhistory", ("tcahistory", "liqhistory")),

    # Data engineer — feed trust, provenance and the web telemetry ledger.
    CommandSpec("trust", "Data · Feed trust verdict and book-age freshness", "Data", "/trust", "/trust", "_cmd_trust", ("datatrust",)),
    CommandSpec("dataquality", "Data · Feed degrade/recover events and reconnect counts", "Data", "/dataquality [N]", "/dataquality", "_cmd_dataquality", ("dq", "quarantine"), in_menu=False),
    CommandSpec("payload", "Data · Per-venue provenance for one symbol", "Data", "/payload SYMBOL", "/payload BTCUSDT", "_cmd_payload", ("lineagepayload", "provenance"), in_menu=False),
    CommandSpec("providers", "Data · OpenBB, venue feeds and web-ops quota/outages", "Data", "/providers", "/providers", "_cmd_providers"),
    CommandSpec("tasks", "Data · The persisted Data work queue by status, and the research jobs engine", "Data", "/tasks", "/tasks", "_cmd_tasks", ("queue", "work"), in_menu=False),

    # DevOps / SRE — SLIs, dependency planes, breakers, traces and the runbook.
    CommandSpec("sli", "Reliability · Service-level indicators and the native core's latency", "Reliability", "/sli", "/sli", "_cmd_sli", ("slis", "attention")),
    CommandSpec("planes", "Reliability · Provider, platform and evidence dependency planes", "Reliability", "/planes", "/planes", "_cmd_planes", ("dependencies", "deps")),
    CommandSpec("circuits", "Reliability · Risk breakers as a headroom ladder", "Reliability", "/circuits", "/circuits", "_cmd_circuits", ("breakers",)),
    CommandSpec("traces", "Reliability · Recent audit events merged with web outages", "Reliability", "/traces [N]", "/traces", "_cmd_traces", ("logs",), in_menu=False),
    CommandSpec("remediation", "Reliability · The five typed controls, their scope and live state", "Reliability", "/remediation", "/remediation", "_cmd_remediation", ("runbook",), in_menu=False),
    CommandSpec("webops", "Reliability · Web telemetry ledger: p50/p99, outages, quota", "Reliability", "/webops", "/webops", "_cmd_webops", ("webtelemetry",), in_menu=False),

    # Quant developer — launch readiness, CI gates, the API surface and the repo.
    CommandSpec("readiness", "Developer · Launch-readiness grid across runtime and backends", "Developer", "/readiness", "/readiness", "_cmd_readiness", ("launchgates",)),
    CommandSpec("cicd", "Developer · The verify gates a deploy must pass", "Developer", "/cicd", "/cicd", "_cmd_cicd", ("verify", "pipeline"), in_menu=False),
    CommandSpec("apis", "Developer · OpenAPI surface by tag, or one tag's operations", "Developer", "/apis [TAG]", "/apis", "_cmd_apis", ("routes", "openapi"), in_menu=False),
    CommandSpec("codebase", "Developer · Python file and line counts by area", "Developer", "/codebase", "/codebase", "_cmd_codebase", ("repo",), in_menu=False),

    # Controls — gated by TELEGRAM_CONTROL_USER_IDS and a typed challenge.
    CommandSpec("halt", "Controls · Engage the kill switch", "Controls", "/halt [SYMBOL] | /halt CODE", "/halt", "_cmd_halt"),
    CommandSpec("resume", "Controls · Release the kill switch", "Controls", "/resume [SYMBOL] | /resume CODE", "/resume", "_cmd_resume"),
    CommandSpec("flatten", "Controls · Close every open position", "Controls", "/flatten [SYMBOL] | /flatten CODE", "/flatten", "_cmd_flatten"),
    CommandSpec("reduceonly", "Controls · Accept only risk-reducing orders", "Controls", "/reduceonly [on|off] | /reduceonly CODE", "/reduceonly on", "_cmd_reduceonly", ("softhalt",)),
    CommandSpec("resetbook", "Controls · Reset the paper book and session accounting", "Controls", "/resetbook | /resetbook CODE", "/resetbook", "_cmd_resetbook"),
    CommandSpec("replay", "Controls · Re-fetch a capability through the validated path and record the contract result", "Controls", "/replay [SYMBOL] | /replay CODE", "/replay BTCUSDT", "_cmd_replay", ("refetch",)),
)

def _build_command_index(specs: tuple[CommandSpec, ...]) -> dict[str, CommandSpec]:
    """One name, one spec — a collision fails the import, not the user.

    The loop this replaces let a later alias silently overwrite an earlier
    command: `snapshot` carried the alias "research", so `/research` — a
    registered Tab command with its own handler — dispatched to `/snapshot`
    for as long as nobody noticed. Raising turns that class of defect into a
    red test suite instead of a quietly wrong command.
    """
    index: dict[str, CommandSpec] = {}
    for spec in specs:
        for name in (spec.name, *spec.aliases):
            key = f"/{name}"
            if key in index:
                raise RuntimeError(
                    f"telegram command registry collision: {key} is claimed by "
                    f"/{index[key].name} and /{spec.name}"
                )
            index[key] = spec
    return index


_COMMAND_BY_NAME: dict[str, CommandSpec] = _build_command_index(COMMAND_SPECS)

# Telegram's setMyCommands accepts at most 100 entries, so the pushed menu is
# the `in_menu` subset. Every spec dispatches regardless; /commands lists all.
BOT_COMMANDS = [(spec.name, spec.description) for spec in COMMAND_SPECS if spec.in_menu]
BOT_SHORT_DESCRIPTION = "Independent alerts and portfolio, market and risk reads — text, charts, buttons — plus six gated controls."
BOT_DESCRIPTION = (
    "AlphaEngine Companion is separate from the web workspace. It reads portfolio state, "
    "OpenBB market data, execution analytics, research status and operational alerts — as text "
    "cards, real-data charts and inline buttons; /menu opens the tappable desks. There is no "
    "/order; /backtest queues research, not trades. Five controls (/halt, /resume, /flatten, "
    "/reduceonly, /resetbook, /replay) are typed, never tapped: they need a separate operator allow-list "
    "and a single-use code. Send /commands for the full catalogue."
)


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


def _category_names() -> list[str]:
    return list(dict.fromkeys(spec.category for spec in COMMAND_SPECS))


def command_catalogue() -> str:
    lines = ["<b>⌨️ AlphaEngine command catalogue</b>",
             "<code>TEXT + CHARTS + BUTTONS · READ EXCEPT GATED CONTROLS</code>", ""]
    for category in _category_names():
        specs = [spec for spec in COMMAND_SPECS if spec.category == category]
        lines.append(f"<b>{esc(category)}</b>")
        lines.append(" · ".join(f"/{spec.name}" for spec in specs))
        lines.append("")
    lines += [
        "Use <code>/help markets</code> for one category, <code>/help quote</code> for exact syntax, "
        "or <code>/menu</code> for the tappable desks.",
        "<i>No command opens or controls the web UI.</i>",
    ]
    return "\n".join(lines)


def help_text(query: str | None = None) -> str:
    if not query:
        categories = " · ".join(_category_names())
        return text_card(
            "ℹ️ AlphaEngine Companion",
            "TEXT + CHARTS + BUTTONS · INDEPENDENT FROM WEB UI",
            [
                "Read portfolio state, OpenBB market data, execution quality and system health — "
                "as text cards, real-data charts and tappable buttons. <code>/menu</code> opens the desks.",
                "Order submission is intentionally unavailable. The five emergency controls "
                "(/halt, /resume, /flatten, /reduceonly, /resetbook, /replay) need the operator allow-list "
                "and a confirmation code, and are typed, never tapped.",
                "",
                f"<b>Categories</b>\n{esc(categories)}",
                "",
                "Try <code>/menu</code>, <code>/portfolio</code>, <code>/snapshot AAPL</code>, "
                "<code>/tca BTCUSDT 100000 BUY</code> or <code>/digest</code>.",
            ],
            source="AlphaEngine command registry",
            next_commands="/menu · /commands · /help portfolio · /help quote",
        )

    needle = query.strip().lstrip("/").lower()
    for category in _category_names():
        if needle == category.lower():
            specs = [spec for spec in COMMAND_SPECS if spec.category == category]
            lines = [f"<code>{esc(spec.usage)}</code> — {esc(spec.description.split('·', 1)[-1].strip())}" for spec in specs]
            return text_card(
                f"ℹ️ Help · {category}",
                f"{len(specs)} COMMANDS",
                lines,
                source="AlphaEngine command registry",
                next_commands=f"/help {specs[0].name} · /commands",
            )

    spec = _COMMAND_BY_NAME.get(f"/{needle}")
    if spec:
        aliases = f"\nAliases: {', '.join('/' + alias for alias in spec.aliases)}" if spec.aliases else ""
        return text_card(
            f"ℹ️ Help · /{spec.name}",
            spec.category.upper(),
            [
                esc(spec.description.split("·", 1)[-1].strip()),
                f"Usage   <code>{esc(spec.usage)}</code>",
                f"Example <code>{esc(spec.example)}</code>{esc(aliases)}",
            ],
            source="AlphaEngine command registry",
            next_commands=f"/help {spec.category.lower()} · /commands",
        )
    return text_card(
        "⚠️ Help topic not found",
        "UNKNOWN TOPIC",
        [f"No category or command matches <code>{esc(query)}</code>."],
        source="AlphaEngine command registry",
        next_commands="/commands",
    )


HELP_TEXT = help_text()


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


class TelegramBot:
    def __init__(self, gateway=None, tca=None, queue=None, audit=None) -> None:
        self.gateway = gateway
        self.tca = tca
        self.queue = queue
        self.audit = audit
        self.token = settings.telegram_bot_token
        self.base = f"{settings.telegram_api_base}/bot{self.token}"
        self.mode = settings.resolved_telegram_mode
        self._client: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._watch_task: asyncio.Task | None = None
        self._offset = 0
        self._seen_updates: set[int] = set()
        self._seen_update_order: deque[int] = deque(maxlen=2048)
        self._rate_windows: dict[str, deque[float]] = {}
        # Outbound pacing. In-process and lost on restart, like the challenge
        # dict and the dedup ring — a deploy simply starts the clock again.
        self._next_global_send = 0.0
        self._next_chat_send: dict[str, float] = {}
        # Pending control confirmations, keyed by user. Single-use and
        # time-boxed — see `_issue_challenge`. In-process on purpose: a restart
        # invalidating every pending kill-switch confirmation is the safe
        # direction to fail.
        self._challenges: dict[str, dict[str, Any]] = {}
        # Telegram user ids with a live web binding, and when that set was last
        # read from the audit store. A cache, never a record: the binding itself
        # is persisted, and this is dropped whenever one is written.
        self._bound_users: set[str] = set()
        self._bound_users_read_at: float | None = None
        self.links_completed = 0
        self.me: dict[str, Any] | None = None
        self.started_at: float | None = None
        self.updates_handled = 0
        self.callbacks_handled = 0
        self.last_error: str | None = None
        self._watch_state: dict[tuple[str, str], bool] = {}
        #: Per-rule breach state for the pushed risk alerts. Edge-triggered like
        #: the liquidity watch above: a rule sitting on its threshold sends one
        #: message, not one every tick.
        self._risk_state: dict[str, bool] = {}
        #: Monotonic deadline for the next VaR evaluation. VaR needs a bar
        #: fetch per held symbol, which must not run at the alert interval.
        self._risk_var_due: float = 0.0
        self._risk_task: asyncio.Task | None = None
        #: chat_id -> {message_id, started}. Deliberately in memory: a live feed
        #: edits a message that exists in one chat right now, and a restart has
        #: already broken that contract whatever a database says. /live reports
        #: this rather than pretending the feed survived.
        self._live_feeds: dict[str, dict[str, Any]] = {}
        self._live_task: asyncio.Task | None = None
        self.alerts_sent = 0

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    @property
    def allowed_user_ids(self) -> list[str]:
        return list(settings.telegram_allowed_user_ids)

    @property
    def control_user_ids(self) -> list[str]:
        return list(settings.telegram_control_user_ids)

    def _may_control(self, user_id: str) -> bool:
        """
        Reading the book must not imply being able to stop the desk.

        Fails closed on an empty list, like the read allow-list — an
        unconfigured deployment has a reporting bot, not a dormant kill switch
        waiting for someone to guess a command.

        One list, read once, and no second grant: `_authorised` gained a web
        binding as an alternative source of *read* rights, and this function
        deliberately did not. Whatever else changes about who may read this
        book, changing who may stop it stays an edit to
        ``TELEGRAM_CONTROL_USER_IDS`` by someone with deploy access.

        ``user_id`` is a bare numeric id. Callers holding a composite actor must
        put it through `actor_user_id` first.
        """
        return bool(self.control_user_ids) and user_id in self.control_user_ids

    async def _pace(self, chat_id: str | int | None) -> None:
        """Wait out the minimum gap before sending.

        Telegram allows roughly 30 messages a second overall and about one a
        second to a given chat. A command that answers with an album of four
        charts plus a caption is five sends in a burst, so the limit is not
        theoretical — and the 429 it earns costs more than the wait would have.
        """
        now = time.monotonic()
        wait = max(0.0, self._next_global_send - now)
        if chat_id is not None:
            key = str(chat_id)
            wait = max(wait, self._next_chat_send.get(key, 0.0) - now)
        if wait > 0:
            await asyncio.sleep(wait)
        sent_at = time.monotonic()
        self._next_global_send = sent_at + _GLOBAL_SEND_GAP
        if chat_id is not None:
            self._next_chat_send[str(chat_id)] = sent_at + _CHAT_SEND_GAP

    async def _post(
        self,
        method: str,
        *,
        json_body: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        chat_id: str | int | None = None,
        pace: bool = True,
        attempts: int = 3,
    ) -> dict[str, Any]:
        """The one place a request reaches Telegram.

        Paces sends, honours `retry_after` on a 429, and never lets the
        token-bearing URL into a log line or `last_error`.
        """
        if not self._client:
            self._client = httpx.AsyncClient(timeout=40.0)
        for attempt in range(1, attempts + 1):
            if pace:
                await self._pace(chat_id)
            try:
                response = await self._client.post(
                    f"{self.base}/{method}", json=json_body, data=data, files=files,
                )
                payload = response.json()
                if payload.get("ok"):
                    return payload
                retry_after = payload.get("parameters", {}).get("retry_after")
                if retry_after is not None and attempt < attempts:
                    # Telegram tells us exactly how long it wants; capped so a
                    # hostile or mistaken value cannot park a command forever.
                    delay = min(float(retry_after), _MAX_RETRY_AFTER)
                    log.warning("telegram %s rate limited; waiting %.1fs", method, delay)
                    await asyncio.sleep(delay)
                    continue
                description = str(payload.get("description") or "Telegram API refused the request")[:180]
                self.last_error = f"{method}: {description}"
                log.warning("telegram %s failed: %s", method, description)
                return payload
            except Exception as exc:  # never include the token-bearing request URL
                error_kind = type(exc).__name__
                self.last_error = f"{method}: transport {error_kind}"
                log.error("telegram %s transport error (%s)", method, error_kind)
                return {"ok": False, "description": f"transport {error_kind}"}
        return {"ok": False, "description": "rate limited"}

    async def api(self, method: str, **params) -> dict[str, Any]:
        # getUpdates is a 25-second long poll against our own consumer, not a
        # send — pacing it would throttle the receive loop.
        polling = method == "getUpdates"
        return await self._post(
            method,
            json_body=params,
            chat_id=params.get("chat_id"),
            pace=not polling,
        )

    async def answer_callback_query(
        self,
        callback_query_id: str,
        text: str | None = None,
        show_alert: bool = False,
    ) -> dict[str, Any]:
        """Acknowledge a button tap — with a toast when there is something to say.

        Every tap must be answered or the client spins its progress indicator
        for a full minute; the handler calls this before any slow work.
        """
        params: dict[str, Any] = {"callback_query_id": callback_query_id}
        if text is not None:
            params["text"] = text[:200]
        if show_alert:
            params["show_alert"] = True
        return await self.api("answerCallbackQuery", **params)

    async def edit_message_text(
        self,
        chat_id: str | int,
        message_id: int,
        text: str,
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if reply_markup is not None:
            params["reply_markup"] = json.dumps(reply_markup)
        return await self.api("editMessageText", **params)

    async def edit_message_caption(
        self,
        chat_id: str | int,
        message_id: int,
        caption: str,
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "caption": caption[:1000],
            "parse_mode": "HTML",
        }
        if reply_markup is not None:
            params["reply_markup"] = json.dumps(reply_markup)
        return await self.api("editMessageCaption", **params)

    async def edit_message_reply_markup(
        self,
        chat_id: str | int,
        message_id: int,
        reply_markup: dict[str, Any],
    ) -> dict[str, Any]:
        return await self.api(
            "editMessageReplyMarkup",
            chat_id=chat_id,
            message_id=message_id,
            reply_markup=json.dumps(reply_markup),
        )

    async def edit_message_media(
        self,
        chat_id: str | int,
        message_id: int,
        photo_bytes: bytes,
        caption: str = "",
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Replace a photo message's media in place — multipart, like sendPhoto."""
        if not self._client:
            self._client = httpx.AsyncClient(timeout=40.0)
        media = json.dumps({
            "type": "photo",
            "media": "attach://photo",
            "caption": caption[:1000],
            "parse_mode": "HTML",
        })
        data: dict[str, str] = {
            "chat_id": str(chat_id),
            "message_id": str(message_id),
            "media": media,
        }
        if reply_markup is not None:
            data["reply_markup"] = json.dumps(reply_markup)
        files = {"photo": ("chart.png", photo_bytes, "image/png")}
        return await self._post("editMessageMedia", data=data, files=files, chat_id=chat_id)

    async def send_message(
        self,
        chat_id: str | int,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        chunks = split_telegram_html(text)
        target = _reply_target.get()
        if (
            target is not None
            and not target.consumed
            and target.kind == "text"
            and target.chat_id == str(chat_id)
        ):
            # Answering a button tap on a text card: edit that card in place so
            # a refresh refreshes rather than piling a second copy underneath.
            target.consumed = True
            edited = await self.edit_message_text(
                chat_id, target.message_id, chunks[0], reply_markup=reply_markup,
            )
            description = str(edited.get("description") or "")
            if edited.get("ok") or "message is not modified" in description:
                # "not modified" is Telegram saying the card is already this
                # exact text — the tap succeeded, nothing to resend.
                result: dict[str, Any] = edited if edited.get("ok") else {"ok": True, "description": description}
                for chunk in chunks[1:]:
                    result = await self.api(
                        "sendMessage",
                        chat_id=chat_id,
                        text=chunk,
                        parse_mode="HTML",
                        disable_web_page_preview=True,
                    )
                return result
            # Any other refusal — too old, deleted, wrong kind — falls through
            # to a fresh send: the answer matters more than the tidiness.

        result = {"ok": True}
        for index, chunk in enumerate(chunks):
            params: dict[str, Any] = {
                "chat_id": chat_id,
                "text": chunk,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            }
            if reply_markup is not None and index == len(chunks) - 1:
                # The keyboard rides on the LAST chunk, the one the reader is
                # left looking at when a long card splits.
                params["reply_markup"] = json.dumps(reply_markup)
            result = await self.api("sendMessage", **params)
        return result

    async def send_photo(
        self,
        chat_id: str | int,
        photo_bytes: bytes,
        caption: str = "",
        *,
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Dispatch visual chart photo to Telegram chat, falling back to text message if photo upload fails."""
        if not self._client:
            self._client = httpx.AsyncClient(timeout=40.0)

        target = _reply_target.get()
        if (
            photo_bytes
            and target is not None
            and not target.consumed
            and target.kind == "photo"
            and target.chat_id == str(chat_id)
        ):
            target.consumed = True
            edited = await self.edit_message_media(
                chat_id, target.message_id, photo_bytes, caption=caption, reply_markup=reply_markup,
            )
            if edited.get("ok") or "message is not modified" in str(edited.get("description") or ""):
                return edited
            # Fall through: the tapped photo is too old or gone; send fresh.

        if photo_bytes:
            try:
                files = {"photo": ("chart.png", photo_bytes, "image/png")}
                data: dict[str, str] = {"chat_id": str(chat_id)}
                if caption:
                    data["caption"] = caption[:1000]
                    data["parse_mode"] = "HTML"
                if reply_markup is not None:
                    data["reply_markup"] = json.dumps(reply_markup)

                res = await self._post(
                    "sendPhoto", data=data, files=files, chat_id=chat_id,
                )
                if res.get("ok"):
                    return res
                log.warning("sendPhoto API call failed (%s), falling back to text message", res.get("description"))
            except Exception as exc:
                log.warning("sendPhoto upload exception (%s), falling back to text message", exc)

        return await self.send_message(chat_id, caption, reply_markup=reply_markup)

    async def send_media_group(
        self,
        chat_id: str | int,
        photos: list[tuple[str, bytes]],
        caption: str = "",
        *,
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Send several charts as one album.

        `sendPhoto` carries exactly one image, so a command covering three
        symbols could only ever answer about one of them, or spam three
        notifications. `sendMediaGroup` delivers up to ten as a single message.

        The caption rides on the first item — Telegram shows it under the album
        — and every item keeps its own filename so a saved chart is still
        identifiable. Degrades twice: to sequential photos if the album call
        fails, and to the text card if the photos themselves fail, because the
        numbers matter more than the pictures.

        A keyboard changes the shape, because Telegram gives an album nowhere
        to hang one: a single usable photo becomes a captioned photo carrying
        the keyboard, and a real album goes out caption-less followed by a text
        card that carries both the caption and the keyboard. When the command
        was itself a button tap, the tapped card's stale keyboard is detached
        first so the chat never shows two live keyboards for one card.
        """
        usable = [(name, blob) for name, blob in photos if blob]

        if reply_markup is not None:
            if not usable:
                return await self.send_message(chat_id, caption, reply_markup=reply_markup)
            if len(usable) == 1 and len(caption) <= 1000:
                return await self.send_photo(chat_id, usable[0][1], caption=caption, reply_markup=reply_markup)
            target = _reply_target.get()
            if target is not None and not target.consumed and target.chat_id == str(chat_id):
                # An album cannot edit the tapped card in place; detach that
                # card's keyboard so the buttons the reader can see are only
                # ever the freshest ones. Best-effort — the answer still goes
                # out if the detach is refused.
                target.consumed = True
                with contextlib.suppress(Exception):
                    await self.edit_message_reply_markup(
                        chat_id, target.message_id, {"inline_keyboard": []},
                    )
            await self._send_album(chat_id, usable, caption="")
            return await self.send_message(chat_id, caption, reply_markup=reply_markup)

        if not usable:
            return await self.send_message(chat_id, caption)
        if len(usable) == 1:
            return await self.send_photo(chat_id, usable[0][1], caption=caption)
        return await self._send_album(chat_id, usable, caption)

    async def _send_album(
        self,
        chat_id: str | int,
        usable: list[tuple[str, bytes]],
        caption: str = "",
    ) -> dict[str, Any]:
        """The sendMediaGroup call and its degradation ladder, unchanged."""
        if not self._client:
            self._client = httpx.AsyncClient(timeout=60.0)

        # Telegram caps an album at ten.
        usable = usable[:10]
        try:
            media: list[dict[str, Any]] = []
            files: dict[str, tuple[str, bytes, str]] = {}
            for index, (name, blob) in enumerate(usable):
                key = f"photo{index}"
                item: dict[str, Any] = {"type": "photo", "media": f"attach://{key}"}
                if index == 0 and caption:
                    item["caption"] = caption[:1024]
                    item["parse_mode"] = "HTML"
                media.append(item)
                files[key] = (f"{name}.png", blob, "image/png")

            res = await self._post(
                "sendMediaGroup",
                data={"chat_id": str(chat_id), "media": json.dumps(media)},
                files=files,
                chat_id=chat_id,
            )
            if res.get("ok"):
                return res
            log.warning("sendMediaGroup failed (%s), falling back to sequential photos", res.get("description"))
        except Exception as exc:
            log.warning("sendMediaGroup exception (%s), falling back to sequential photos", exc)

        result: dict[str, Any] = {}
        for index, (_, blob) in enumerate(usable):
            result = await self.send_photo(chat_id, blob, caption=caption if index == 0 else "")
        return result

    async def start(self) -> None:
        if not self.enabled:
            log.info("Telegram disabled (no TELEGRAM_BOT_TOKEN); gateway and web remain independent")
            return

        self.started_at = time.time()
        me = await self.api("getMe")
        self.me = me.get("result")
        if self.me:
            log.info("Telegram companion @%s online in %s mode", self.me.get("username"), self.mode)

        if not self.allowed_user_ids:
            log.warning("TELEGRAM_ALLOWED_USER_IDS is empty; bootstrap commands only")

        await self._register_profile()

        if self.mode == "webhook":
            secret = settings.telegram_webhook_secret
            if not settings.public_url.startswith("https://"):
                raise RuntimeError("Telegram webhook mode requires an https PUBLIC_URL")
            if len(secret) < 32 or secret.lower().startswith(("change-me", "alphaengine-dev")):
                raise RuntimeError("Telegram webhook mode requires a unique 32+ character secret")
            webhook_url = f"{settings.public_url}{settings.webhook_path}"
            result = await self.api(
                "setWebhook",
                url=webhook_url,
                secret_token=secret,
                allowed_updates=["message", "callback_query"],
                drop_pending_updates=False,
            )
            log.info("Telegram webhook registration: %s", bool(result.get("ok")))
        else:
            await self.api("deleteWebhook", drop_pending_updates=False)
            self._poll_task = asyncio.create_task(self._poll_loop(), name="telegram-poll")

        self._watch_task = asyncio.create_task(self._watch_loop(), name="telegram-watch")
        self._risk_task = asyncio.create_task(self._risk_loop(), name="telegram-risk")
        self._live_task = asyncio.create_task(self._live_loop(), name="telegram-live")
        log.info("Telegram alert subscribers restored: %d", len(self._subscribers()))

    async def _register_profile(self) -> None:
        await self.api(
            "setMyCommands",
            commands=[{"command": command, "description": description} for command, description in BOT_COMMANDS],
        )
        await self.api("setMyShortDescription", short_description=BOT_SHORT_DESCRIPTION)
        await self.api("setMyDescription", description=BOT_DESCRIPTION)

    async def stop(self) -> None:
        for task in (self._poll_task, self._watch_task, self._risk_task, self._live_task):
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if self._client:
            await self._client.aclose()

    async def _poll_loop(self) -> None:
        log.info("Telegram long-polling started")
        backoff = 1.0
        while True:
            try:
                data = await self.api(
                    "getUpdates",
                    offset=self._offset,
                    timeout=25,
                    allowed_updates=["message", "callback_query"],
                )
                if data.get("ok"):
                    backoff = 1.0
                    for update in data.get("result", []):
                        self._offset = update["update_id"] + 1
                        asyncio.create_task(self.handle_update(update))
                else:
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Telegram poll loop error (%s)", type(exc).__name__)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def _remember_update(self, update_id: Any) -> bool:
        if not isinstance(update_id, int):
            return True
        if update_id in self._seen_updates:
            return False
        if len(self._seen_update_order) == self._seen_update_order.maxlen:
            oldest = self._seen_update_order.popleft()
            self._seen_updates.discard(oldest)
        self._seen_update_order.append(update_id)
        self._seen_updates.add(update_id)
        return True

    # A few seconds. `_authorised` runs on every update and once per subscriber
    # inside the alert loops, so an uncached lookup makes a broadcast to twenty
    # chats twenty DuckDB round trips. Short enough that an expired binding
    # stops granting almost at once, and dropped outright when one is written.
    _BINDING_CACHE_TTL_S = 5.0

    def _allow_listed(self, user_id: str) -> bool:
        """The operator's own read list. Fail-closed on empty, as it always was."""
        return bool(self.allowed_user_ids) and user_id in self.allowed_user_ids

    def _live_bindings(self) -> list[dict[str, Any]]:
        """Bindings this gateway still honours, with the guest clock applied.

        Guest bindings age out; account bindings do not. A guest desk pass is a
        browser-session cookie this process cannot watch expire, so its mirror
        here carries its own clock — see ``TELEGRAM_GUEST_LINK_TTL_S``. An
        account binding has a durable Supabase row behind it and ends with the
        account, through the ``on delete cascade``.

        Factored out so the authorisation check and the desk's own "am I
        connected?" probe read ONE freshness rule. Two copies of an expiry
        policy is how a chip goes on saying Connected for a binding that stopped
        granting hours ago — which is the defect the probe exists to prevent,
        inverted.
        """
        if not self.audit:
            return []
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            seconds=settings.telegram_guest_link_ttl_s
        )
        live: list[dict[str, Any]] = []
        for binding in self.audit.web_bindings():
            user_id = str(binding.get("user_id") or "")
            identity = str(binding.get("web_identity") or "")
            kind = identity.split(":", 1)[0]
            # Unknown prefixes grant nothing. A binding whose shape this build
            # does not recognise is a binding it cannot reason about.
            if not user_id or kind not in _LINK_KIND_BYTE:
                continue
            if kind == LINK_KIND_GUEST and binding["linked_at"] < cutoff:
                continue
            live.append(binding)
        return live

    def _bound_user_ids(self) -> set[str]:
        """Telegram user ids holding a live binding to a web desk pass."""
        if not self.audit:
            return set()
        now = time.monotonic()
        if (
            self._bound_users_read_at is not None
            and now - self._bound_users_read_at < self._BINDING_CACHE_TTL_S
        ):
            return self._bound_users

        self._bound_users = {str(binding["user_id"]) for binding in self._live_bindings()}
        self._bound_users_read_at = now
        return self._bound_users

    def binding_status(self, kind: str, identity: str) -> str:
        """Is this WEB identity bound to a chat right now? Three answers, never two.

        ``"linked"``, ``"not-linked"``, or ``"unknown"`` when this gateway has no
        store to read and therefore knows nothing — which is a different fact
        from "no binding" and must not be flattened into it. Reporting an
        unreadable store as "not linked" would invite someone to reconnect a
        chat they had already connected.

        The answer is a state, never an identity: the caller learns whether the
        desk pass it already holds is bound, and nothing about WHICH chat,
        WHICH Telegram account, or how many others exist. That is the same line
        ``health()``'s ``links`` block draws, applied to a single row.

        Uncached deliberately. ``_bound_user_ids`` caches for five seconds
        because it runs once per subscriber inside every alert broadcast; this
        runs once per header load, and a chip that says "not connected" for five
        seconds after the bot said "Connected" is exactly the confusion the
        whole feature is here to remove.
        """
        if not self.audit:
            return "unknown"
        wanted = f"{kind}:{identity}"
        for binding in self._live_bindings():
            if str(binding.get("web_identity") or "") == wanted:
                return "linked"
        return "not-linked"

    def _forget_bindings(self) -> None:
        """Drop the cache so the next read sees a binding written just now."""
        self._bound_users_read_at = None

    def _authorised(self, user_id: str) -> bool:
        """May this Telegram user read desk data?

        Two independent grants, kept nameable so an auditor can tell which one
        admitted a given user:

          1. ``TELEGRAM_ALLOWED_USER_IDS`` — the operator's list, unchanged.
          2. A live web binding — this Telegram account completed ``/start``
             with a one-time token minted for a desk pass someone was already
             holding.

        (2) IS NOT AN AUTHENTICATION BYPASS, and the argument is arithmetic
        rather than judgement. The token can only be minted by a request that
        already carries a desk pass, and ``POST /api/auth/guest`` hands a pass to
        anyone who asks. So a bound user is shown exactly what they could
        already read by opening the workspace — one shared book, one kill
        switch, one set of counters — over a second transport. Binding moves
        data between transports it was already on; it unlocks none.

        The direction matters too, and it is the direction the invariant in
        ``config.py`` states: a *web* identity authorises a *Telegram* read.
        Nothing here lets a Telegram identity authenticate a web request.

        What this deliberately does not touch is `_may_control`, which reads
        ``TELEGRAM_CONTROL_USER_IDS`` and nothing else. A binding — guest or
        account — cannot halt, resume, flatten, set reduce-only or reset the
        book. Read parity is the entire grant.
        """
        return self._allow_listed(user_id) or (
            bool(user_id) and user_id in self._bound_user_ids()
        )

    def _rate_allowed(self, user_id: str) -> bool:
        now = time.monotonic()
        window = self._rate_windows.setdefault(user_id, deque())
        while window and now - window[0] > 10.0:
            window.popleft()
        if len(window) >= 15:
            return False
        window.append(now)
        return True

    async def handle_update(self, update: dict[str, Any]) -> None:
        if not self._remember_update(update.get("update_id")):
            return
        self.updates_handled += 1
        chat_id: str | None = None
        command = ""
        try:
            callback = update.get("callback_query")
            if callback:
                # Set before the call so the shared failure card below knows
                # where to go if the handler raises.
                chat_id = str(((callback.get("message") or {}).get("chat") or {}).get("id") or "")
                await self._handle_callback(callback)
                return
            message = update.get("message") or update.get("edited_message")
            if not message:
                return
            chat_id = str(message.get("chat", {}).get("id", ""))
            user = message.get("from") or {}
            user_id = str(user.get("id", ""))
            text = (message.get("text") or "").strip()
            if not chat_id or not user_id or not text.startswith("/"):
                return

            parts = text.split()
            command = parts[0].split("@")[0].lower()
            args = parts[1:]
            authorised = self._authorised(user_id)
            if not authorised and command not in _BOOTSTRAP_COMMANDS:
                await self.send_message(
                    chat_id,
                    text_card(
                        "⛔ Not authorised",
                        "BOOTSTRAP ONLY",
                        [
                            f"User ID <code>{esc(user_id)}</code>",
                            f"Chat ID <code>{esc(chat_id)}</code>",
                            "Two ways in. Tap <b>Connect</b> in the AlphaEngine workspace header, which "
                            "links this chat to the desk you are already looking at and grants the same "
                            "reading — never the controls.",
                            "Or ask the operator to add your user ID to <code>TELEGRAM_ALLOWED_USER_IDS</code>.",
                        ],
                        source="AlphaEngine access control",
                        next_commands="/whoami · /help",
                    ),
                )
                return
            if not self._rate_allowed(user_id):
                await self.send_message(
                    chat_id,
                    text_card(
                        "⚠️ Command rate limited",
                        "TRY AGAIN SHORTLY",
                        ["The bot accepts up to 15 commands per user in 10 seconds."],
                        source="AlphaEngine bot guard",
                        next_commands="/help",
                    ),
                )
                return

            actor = f"tg:{user_id}:{user.get('username') or 'user'}"
            log.info("Telegram command %s from user %s", command, user_id)
            await self._dispatch(command, args, chat_id, actor)
        except Exception as exc:
            reference = f"tg-{update.get('update_id', int(time.time()))}"
            log.exception("Telegram command failed (%s, %s)", reference, type(exc).__name__)
            if chat_id:
                with contextlib.suppress(Exception):
                    await self.send_message(
                        chat_id,
                        text_card(
                            "⚠️ Command failed",
                            f"REFERENCE {reference}",
                            ["The request was contained and no trading state was changed."],
                            source="AlphaEngine command handler",
                            next_commands=f"/help {command.lstrip('/')} · /status",
                        ),
                    )

    async def _handle_callback(self, callback: dict[str, Any]) -> None:
        """A button tap, taken through the same gates as a typed command.

        The identity that counts is ``callback["from"]`` — the user who TAPPED
        — never the author of the message the button sits on. In a group chat
        those differ: the card was sent to the chat, but authorisation belongs
        to whoever pressed the button.

        Controls are the one category a button never reaches. A tap is easier
        to fire by accident than a typed command, and the whole point of the
        challenge flow is deliberateness — so no challenge is ever issued from
        a button, not even the first step.
        """
        cb_id = str(callback.get("id") or "")
        user = callback.get("from") or {}
        user_id = str(user.get("id") or "")
        message = callback.get("message") or {}
        chat_id = str((message.get("chat") or {}).get("id") or "")
        message_id = message.get("message_id")
        data = str(callback.get("data") or "")

        if not message or not chat_id or not message_id:
            # A tap on a message too old for Telegram to include, or from an
            # inline-mode surface this bot does not serve.
            await self.answer_callback_query(cb_id, text="Open the chat and send the command.")
            return

        parsed = parse_callback(data)
        if parsed is None:
            await self.answer_callback_query(
                cb_id, text="This button is from an older build. Send the command instead.",
            )
            return
        command, args = parsed

        if not self._authorised(user_id) and f"/{command}" not in _BOOTSTRAP_COMMANDS:
            await self.answer_callback_query(cb_id, text="Not authorised — send /whoami")
            return
        if not self._rate_allowed(user_id):
            await self.answer_callback_query(cb_id, text="Rate limited: 15 taps per 10 s")
            return

        spec = _COMMAND_BY_NAME.get(f"/{command}")
        if spec is None:
            await self.answer_callback_query(
                cb_id, text="This button is from an older build. Send the command instead.",
            )
            return
        if spec.category == "Controls":
            await self.answer_callback_query(
                cb_id, text=f"Controls are typed, never tapped. Send /{spec.name}.",
            )
            return

        # Acknowledged before the slow work, so the client's spinner clears
        # while the handler reads books and draws charts.
        await self.answer_callback_query(cb_id)
        self.callbacks_handled += 1
        actor = f"tg:{user_id}:{user.get('username') or 'user'}"
        log.info("Telegram callback %s from user %s", command, user_id)
        token = _reply_target.set(ReplyTarget(
            chat_id=chat_id,
            message_id=int(message_id),
            kind="photo" if message.get("photo") else "text",
        ))
        try:
            await self._dispatch(f"/{command}", args, chat_id, actor)
        finally:
            _reply_target.reset(token)

    async def _dispatch(self, command: str, args: list[str], chat_id: str, actor: str) -> None:
        spec = _COMMAND_BY_NAME.get(command)
        if not spec:
            await self.send_message(
                chat_id,
                text_card(
                    "⚠️ Unknown command",
                    "NOT DISPATCHED",
                    [f"No command matches <code>{esc(command)}</code>."],
                    source="AlphaEngine command registry",
                    next_commands="/commands · /help",
                ),
            )
            return
        handler = getattr(self, spec.handler)
        await handler(args, chat_id, actor)

    # ------------------------------------------------------------------ #
    # Parsing / data helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _symbol(args: list[str], index: int = 0) -> str:
        symbol = (args[index] if len(args) > index else settings.symbols[0]).strip().upper()
        if not _SYMBOL_RE.fullmatch(symbol):
            raise ValueError("symbol must contain only letters, numbers, dot or hyphen")
        return symbol

    @staticmethod
    def _symbols(args: list[str], limit: int = 6) -> list[str]:
        """
        Every leading argument that is a symbol, de-duplicated, order kept.

        `_symbol` reads one and `_asset` reads the next positional as the asset
        class, so "/quote BTCUSDT ETHUSDT" used to reject ETHUSDT as an invalid
        asset. Symbol-shaped leading tokens are collected here instead, and
        parsing stops at the first token that is not one — which is where the
        asset keyword lives, so the existing single-symbol form is untouched.
        """
        found: list[str] = []
        for raw in args:
            candidate = raw.strip().upper()
            if candidate.lower() in {"equity", "crypto"}:
                break
            if not _SYMBOL_RE.fullmatch(candidate):
                break
            if candidate not in found:
                found.append(candidate)
            if len(found) >= limit:
                break
        return found or [settings.symbols[0].upper()]

    @staticmethod
    def _asset(symbol: str, args: list[str], index: int = 1) -> str:
        default = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        asset = (args[index].lower() if len(args) > index else default)
        if asset not in {"equity", "crypto"}:
            raise ValueError("asset must be equity or crypto")
        return asset

    @staticmethod
    def _limit(args: list[str], index: int, default: int, maximum: int = 20) -> int:
        try:
            value = int(args[index]) if len(args) > index else default
        except ValueError as exc:
            raise ValueError("count must be an integer") from exc
        if not 1 <= value <= maximum:
            raise ValueError(f"count must be between 1 and {maximum}")
        return value

    @staticmethod
    def _bar_args(args: list[str]) -> tuple[str, str, int, str]:
        symbol = TelegramBot._symbol(args)
        interval = args[1].lower() if len(args) > 1 else "1d"
        if interval not in {"15m", "1h", "4h", "1d"}:
            raise ValueError("interval must be 15m, 1h, 4h or 1d")
        count = TelegramBot._limit(args, 2, 5, 50)
        asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        return symbol, interval, count, asset

    @staticmethod
    def _trade_args(args: list[str]) -> tuple[str, float, str]:
        symbol = TelegramBot._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        side = args[2].upper() if len(args) > 2 else "BUY"
        if notional is None or notional <= 0 or notional > 1_000_000_000:
            raise ValueError("notional must be a positive finite number up to $1bn")
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL")
        return symbol, notional, side

    @staticmethod
    def _openbb_error(capability: str, payload: dict[str, Any]) -> str:
        detail = str(payload.get("error") or payload.get("detail") or "provider returned no data")[:260]
        return text_card(
            f"⚠️ OpenBB · {capability}",
            "UNAVAILABLE",
            [esc(detail)],
            source="OpenBB / yfinance",
            next_commands="/openbb · /status",
        )

    def _portfolio_report(self) -> dict[str, Any]:
        from modules.portfolio import build_portfolio

        return build_portfolio(self.gateway, self.audit)

    # ------------------------------------------------------------------ #
    # Essentials
    # ------------------------------------------------------------------ #
    #: What the header's link carried before there was anything to hand over.
    _LEGACY_START_PAYLOAD = "auth"

    async def _link_refusal(self, chat_id: str, status: str, lines: list[str]) -> None:
        """One shape for every way a connect can fail, because each one has a cause.

        House rule: a refusal states its reason on screen. "Connect failed" with
        no explanation sends someone to an operator for what is usually a stale
        tab.
        """
        await self.send_message(chat_id, text_card(
            "⛔ Connect refused", status, lines,
            source="AlphaEngine desk link", next_commands="/whoami · /help"))

    async def _record_account_link(
        self, token: LinkToken, chat_id: str, user_id: str, username: str
    ) -> AccountLinkWrite:
        """Mirror an account binding into Supabase, where it becomes durable.

        The DuckDB row is what this process consults on every command; this row
        is what outlives the container. ``ok is None`` when the gateway holds no
        Supabase credentials — a state the confirmation says out loud, rather
        than letting someone believe a link is durable when it is not.

        Written with the service role because the writer is the gateway, not the
        signed-in browser. RLS on ``telegram_link`` scopes what an *account* may
        read of its own row; the account is not the party holding the Telegram
        user id, so it cannot be the one to write it.

        Returns the *reason* on failure rather than a bare ``False``. This
        function used to log a status code and discard ``response.text``, which
        is the only place PostgREST distinguishes "the table does not exist"
        from "this key may not write it" — two failures with the same status
        and completely different fixes. The first production run of this path
        hit the first of those and reported it as the second.
        """
        if not (settings.supabase_url and settings.supabase_service_role_key):
            return AccountLinkWrite(ok=None)
        headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }
        row = {
            "user_id": token.identity,
            "telegram_user_id": user_id,
            "telegram_chat_id": str(chat_id),
            "telegram_username": username or None,
            "linked_at": datetime.now(timezone.utc).isoformat(),
        }
        delete_reason: str | None = None
        replaced: str | None = None
        try:
            async with httpx.AsyncClient(
                base_url=settings.supabase_url.rstrip("/"),
                headers=headers,
                timeout=settings.supabase_timeout_s,
            ) as client:
                # One Telegram account, one desk account. The table's unique
                # constraint would refuse the upsert otherwise, and refusing is
                # the worse outcome here: the person is standing in front of a
                # valid single-use code that has already been spent.
                #
                # `return=representation` so the removed row comes back. This
                # delete is destructive and used to be silent: connecting a
                # second time from a different desk identity destroyed the first
                # binding and told nobody. The confirmation now says so, which
                # needs to know what was there.
                removed = await client.delete(
                    f"/rest/v1/telegram_link?telegram_user_id=eq.{user_id}",
                    headers={"Prefer": "return=representation"},
                )
                if removed.status_code >= 300:
                    # Not fatal on its own — the upsert below may still succeed
                    # against the same account — but a failed delete followed by
                    # a failed insert is silent data loss, so carry the reason.
                    delete_reason = _postgrest_reason(removed)
                    log.warning(
                        "telegram_link delete refused (HTTP %s): %s",
                        removed.status_code, delete_reason,
                    )
                else:
                    replaced = _replaced_identity(removed, token.identity)

                response = await client.post(
                    "/rest/v1/telegram_link?on_conflict=user_id",
                    json=row,
                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                )
                if response.status_code < 300:
                    return AccountLinkWrite(ok=True, replaced=replaced)
                reason = _postgrest_reason(response)
                log.warning(
                    "telegram_link write refused (HTTP %s): %s", response.status_code, reason,
                )
                return AccountLinkWrite(ok=False, reason=reason, replaced=replaced)
        except Exception as exc:  # never let the confirmation itself fail
            log.error("telegram_link write failed: %s", type(exc).__name__)
            return AccountLinkWrite(
                ok=False,
                reason=f"The desk could not reach Supabase ({type(exc).__name__}).",
                replaced=replaced,
            )

    async def _complete_link(self, payload: str, chat_id: str, actor: str) -> None:
        """Redeem a ``?start=<token>`` payload and bind this chat to a web identity."""
        parts = str(actor).split(":", 2)
        username = parts[2] if len(parts) > 2 else "user"
        user_id = actor_user_id(actor)

        if payload == self._LEGACY_START_PAYLOAD:
            # An old bookmark is not a mistake, so this is a signpost rather
            # than an error card.
            await self.send_message(chat_id, text_card(
                "🔗 Connect this chat", "NO CODE IN THIS LINK",
                [
                    "This link predates the connect flow and carries no code.",
                    "Open the AlphaEngine workspace and tap <b>Connect</b> in the header. That link "
                    "carries a single-use code that binds this chat to the desk you are looking at.",
                ],
                source="AlphaEngine desk link", next_commands="/whoami · /help"))
            return

        if not settings.telegram_link_enabled:
            await self._link_refusal(chat_id, "LINKING NOT CONFIGURED", [
                "This gateway holds no <code>TELEGRAM_LINK_SECRET</code>, so it cannot verify a connect code — and it will not guess.",
                "An operator sets the same value on the gateway and on the web deployment.",
            ])
            return

        try:
            token = decode_link_token(payload, settings.telegram_link_secret)
        except ValueError as exc:
            await self._link_refusal(chat_id, "CODE REJECTED", [esc(str(exc))])
            return

        if not user_id:
            await self._link_refusal(chat_id, "NO TELEGRAM IDENTITY", [
                "This update carried no usable Telegram user ID, and a binding with no owner is not a binding.",
            ])
            return

        if not self.audit:
            await self._link_refusal(chat_id, "NO DESK STORE", [
                "This gateway has no audit store, so the code cannot be spent exactly once and the binding cannot be recorded.",
            ])
            return

        # Spend the code before writing anything. A double tap on the deep link
        # delivers two identical /start updates, and the second must lose.
        if not self.audit.claim_link_token(link_token_fingerprint(payload), token.expires_at):
            await self._link_refusal(chat_id, "CODE ALREADY USED", [
                "Connect codes are single use. Tap <b>Connect</b> on the desk again for a fresh one.",
            ])
            return

        existing = self.audit.get_subscriber(str(chat_id)) or {}
        # The local store also replaces rather than accumulates — `upsert_subscriber`
        # is keyed by chat_id. A guest who signs in and reconnects, or an account
        # holder connecting from a second identity, silently loses the previous
        # binding here too, so the same retraction is owed on both paths.
        previous_identity = str(existing.get("web_identity") or "").strip()
        local_replaced = bool(previous_identity) and previous_identity != token.web_identity
        self.audit.upsert_subscriber(
            str(chat_id), actor,
            # Binding is identity, not consent to be messaged. Whatever this
            # chat had already chosen stays chosen, and /subscribe remains the
            # only thing that turns pushed alerts on.
            alerts=bool(existing.get("alerts")),
            user_id=user_id,
            web_identity=token.web_identity,
            linked_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        self._forget_bindings()
        self.links_completed += 1
        log.info("telegram chat %s bound to a %s desk identity", chat_id, token.kind)

        if token.kind == LINK_KIND_GUEST:
            hours = max(1, int(settings.telegram_guest_link_ttl_s // 3600))
            where = [
                "<b>Guest desk pass</b> — this link is held in the gateway's own store and nowhere else.",
                f"It lapses after <code>{hours}h</code>, and it does not survive this desk being rebuilt. "
                "A guest pass is a browser session; the desk cannot watch yours end, so the link carries its own clock.",
                "Sign in on the workspace and connect again to keep it.",
            ]
            if local_replaced:
                where.append(
                    "⚠ This chat was connected to a different desk identity "
                    f"(<code>{esc(previous_identity.split(':', 1)[-1][:8])}…</code>). "
                    "That binding has been replaced — latest connect wins."
                )
        else:
            written = await self._record_account_link(token, chat_id, user_id, username)
            # The kind of binding is one statement; where it is kept is another.
            # These used to be the same sentence — "recorded against your desk
            # account" was asserted before the write was attempted and retracted
            # two lines later, which reads as a promise with a disclaimer rather
            # than a status.
            where = ["<b>Account</b> — bound to your desk account, not to a browser session."]
            if written.ok is True:
                where.append(
                    "The durable copy was written: it survives restarts and ends when the account does."
                )
            elif written.ok is None:
                where.append(
                    "<i>This gateway holds no Supabase credentials, so only its local copy was written. "
                    "The link works now and will not survive the desk being rebuilt.</i>"
                )
            else:
                where.append(
                    "<i>The durable copy was refused, and the desk is not going to pretend otherwise. "
                    "The local copy works now; reconnect after a rebuild.</i>"
                )
                # The reason, verbatim from PostgREST. A missing table and a
                # rejected key are the same status code and different fixes.
                where.append(
                    f"<i>Reason: {esc(written.reason)}</i>" if written.reason
                    else "<i>Supabase gave no reason.</i>"
                )
            # Either store can be the one that noticed: Supabase reports the row
            # its delete removed, and the local store still knows when Supabase
            # was never consulted at all.
            replaced = written.replaced or (
                previous_identity.split(":", 1)[-1] if local_replaced else None
            )
            if replaced:
                where.append(
                    "⚠ This chat was connected to a different desk identity "
                    f"(<code>{esc(replaced[:8])}…</code>). That binding has been replaced — "
                    "latest connect wins."
                )

        await self.send_message(chat_id, text_card(
            "🔗 Connected", "READ PARITY WITH A DESK PASS",
            [
                # Two identities meet here and only one of them was ever named.
                # "Connected as @handle" directly above "recorded against your
                # desk account" reads as though the handle IS the desk account,
                # so a guest pass and a signed-in account produced the same
                # sentence and the second connect looked like it had kept the
                # first one's identity. Both sides are now labelled.
                f"<b>Telegram</b> @{esc(username)} · user <code>{esc(user_id)}</code> "
                f"· chat <code>{esc(chat_id)}</code>",
                f"<b>Desk identity</b> {esc(token.kind)} <code>{esc(token.identity[:8])}…</code>",
                "",
                "<b>What this grants</b>",
                "Exactly what a desk pass already shows you in the browser — one shared book, one kill "
                "switch, one set of counters. None of it is private to you, and none of it is new.",
                "It does <b>not</b> grant the controls. /halt, /resume, /flatten, /reduceonly and "
                "/resetbook and /replay stay behind <code>TELEGRAM_CONTROL_USER_IDS</code>, which only an operator changes.",
                "",
                "<b>Where the link is kept</b>",
                *where,
                "",
                "Pushed alerts stay off until you run /subscribe.",
            ],
            source="AlphaEngine desk link", next_commands="/portfolio · /risk · /subscribe"))

    async def _cmd_start(self, args, chat_id, actor) -> None:
        # `?start=<payload>` arrives as args[0]; the dispatcher already passes
        # them through. A bare /start keeps its original answer, because someone
        # who simply found the bot is asking for the command card. An authorised
        # user also gets the desk menu keyboard — an unauthorised one does not,
        # because every button on it leads somewhere the refusal card explains
        # better.
        if args:
            await self._complete_link(args[0], chat_id, actor)
            return
        authorised = self._authorised(actor_user_id(actor))
        await self.send_message(
            chat_id, HELP_TEXT, reply_markup=_menu_keyboard() if authorised else None,
        )

    async def _cmd_menu(self, args, chat_id, actor) -> None:
        await self.send_message(
            chat_id,
            text_card(
                "🎛 Desk menu",
                "PICK A DESK",
                [
                    "Pick a desk. Every button is a shortcut for a typed command, "
                    "and the tapped card refreshes in place.",
                ],
                source="AlphaEngine command registry",
                next_commands="/overview · /portfolio · /risk · /help",
            ),
            reply_markup=_menu_keyboard(),
        )

    async def _cmd_help(self, args, chat_id, actor) -> None:
        await self.send_message(
            chat_id,
            help_text(args[0] if args else None),
            reply_markup=_category_keyboard(),
        )

    async def _cmd_commands(self, args, chat_id, actor) -> None:
        await self.send_message(chat_id, command_catalogue(), reply_markup=_category_keyboard())

    async def _cmd_about(self, args, chat_id, actor) -> None:
        await self.send_message(
            chat_id,
            text_card(
                "ℹ️ AlphaEngine Companion",
                "INDEPENDENT · READ EXCEPT SIX GATED CONTROLS",
                [
                    "A separate operational channel for portfolio, market, research and execution updates — "
                    "text cards, real-data charts and inline buttons. /menu opens the tappable desks; "
                    "every button is a shortcut for a typed command, never a capability of its own.",
                    "It shares authoritative data services with AlphaEngine but never opens or controls the web UI.",
                    # This card used to say READ-ONLY and that order entry was absent.
                    # `/flatten` submits real orders through `gateway.submit`, so both
                    # were false — and a security note the product itself contradicts is
                    # worse than no note at all.
                    "Most commands only read. The five that do not — /halt, /resume, /flatten, /reduceonly, "
                    "/resetbook, /replay — need the separate control allow-list and a single-use confirmation code.",
                    "/flatten enters closing orders, and they face the same pre-trade gates as any other order "
                    "rather than going around them. There is no /order; /backtest queues research, not trades.",
                    "",
                    "<b>Web parity</b>",
                    "Mirrored: portfolio, risk and limits, the equity curve (/equity), book and TCA, orders, "
                    "fills and rejections (/orders, /working, /timeline), the research fold detail "
                    "(/walkforward, /stability, /overfit, /decision), the pre-trade gate preview (/gates), "
                    "fill quality (/quality), Monte Carlo (/montecarlo), data trust (/trust), the dependency "
                    "planes (/planes), the risk breakers (/circuits), launch readiness (/readiness), jobs and "
                    "research (/backtest, /rag), the reliability snapshot (/ops) and the gated controls.",
                    "Beyond the web: some cards read a ledger the browser only summarises — /latency and "
                    "/spreadhistory expose the persisted latency and TCA series, /webops the raw web-ops "
                    "ledger, /compare a normalised multi-symbol overlay, and the native decision core's "
                    "nanosecond clock surfaces through /latency and /sli.",
                    "Web-only by nature: the experiment log, favourites, theme and complexity tier live in "
                    "one browser's storage, so there is nothing on the server for chat to read. The Data and "
                    "Developer work queues are mocked browser state.",
                    "Computed differently on purpose: /var and /montecarlo measure risk in this process from "
                    "the live book, while the web Monte Carlo panel reads Oracle. Same book, different "
                    "estimator — each names its own source rather than pretending to be the other.",
                ],
                source="AlphaEngine Telegram service",
                next_commands="/commands · /status · /digest",
            ),
        )

    async def _cmd_whoami(self, args, chat_id, actor) -> None:
        parsed = actor_user_id(actor)
        user_id = parsed or "unknown"
        # Which of the two grants admitted this user, named rather than merged.
        # "Authorised" without a reason is unauditable, and the two are revoked
        # in completely different places.
        allow_listed = self._allow_listed(parsed)
        bound = bool(parsed) and parsed in self._bound_user_ids()
        authorised = allow_listed or bound
        if allow_listed and bound:
            grant = "Operator allow-list, and a connected desk pass"
        elif allow_listed:
            grant = "Operator allow-list"
        elif bound:
            grant = "Connected desk pass — reading only, never the controls"
        else:
            grant = "None yet"
        await self.send_message(
            chat_id,
            text_card(
                "🪪 Telegram identity",
                "AUTHORISED" if authorised else "NOT YET AUTHORISED",
                [
                    f"User ID <code>{esc(user_id)}</code>",
                    f"Chat ID <code>{esc(chat_id)}</code>",
                    f"Read access <code>{esc(grant)}</code>",
                    f"Controls <code>{'PERMITTED' if self._may_control(parsed) else 'NOT PERMITTED'}</code>",
                ],
                source="Telegram update envelope",
                next_commands="/help" if authorised else "Tap Connect in the workspace header, or ask the operator to update TELEGRAM_ALLOWED_USER_IDS",
            ),
        )

    async def _cmd_version(self, args, chat_id, actor) -> None:
        await self.send_message(
            chat_id,
            text_card(
                "🏷 AlphaEngine runtime",
                settings.environment.upper(),
                [
                    f"Version <code>{esc(settings.version)}</code>",
                    f"Bot mode <code>{esc(self.mode)}</code>",
                    f"Text commands <code>{len(COMMAND_SPECS)}</code>",
                ],
                source="AlphaEngine configuration",
                next_commands="/status · /commands",
            ),
        )

    async def _cmd_ping(self, args, chat_id, actor) -> None:
        started = time.perf_counter()
        elapsed_ms = (time.perf_counter() - started) * 1000
        await self.send_message(
            chat_id,
            text_card(
                "🏓 Command path",
                "RESPONSIVE",
                [f"Dispatch overhead <code>{elapsed_ms:.2f} ms</code>"],
                source="AlphaEngine Telegram process",
                next_commands="/status",
            ),
        )

    async def _cmd_status(self, args, chat_id, actor) -> None:
        from modules import research

        feed_health = self.tca.health() if self.tca else {}
        state = self.gateway.state() if self.gateway else None
        openbb = await research.openbb_status_async()
        lines: list[str] = []
        if state:
            lines.append(f"Trading state  <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code>")
            lines.append(f"Equity         <code>{_money(state.equity)}</code>")
        feeds = feed_health.get("feeds", [])
        live_feeds = sum(1 for feed in feeds if feed.get("connected"))
        lines.append(f"Market feeds   <code>{live_feeds}/{len(feeds)} connected</code>")
        lines.append(f"Synthetic book <code>{'ACTIVE' if feed_health.get('synthetic_active') else 'off'}</code>")
        lines.append(f"OpenBB         <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>")
        if self.queue:
            queue = self.queue.stats()
            lines.append(f"Research queue <code>{queue['backend']} · {queue['total']} jobs</code>")
        status = "DEGRADED" if (not openbb.get("ok") or live_feeds < len(feeds)) else "HEALTHY"
        await self.send_message(
            chat_id,
            text_card(
                "⚙️ AlphaEngine systems",
                status,
                lines,
                source="Gateway + TCA engine + OpenBB",
                next_commands="/feedstatus · /openbb · /risk",
            ),
        )

    # ------------------------------------------------------------------ #
    # 8 Desk Role Tabs (Explicit Vercel UI Tab mapping & Visual Charts)
    # ------------------------------------------------------------------ #
    # Shared real-telemetry readers for the desk-role cards. Every one of these
    # cards previously shipped a fixed script — "Sharpe Ratio 2.14", "Uptime
    # 99.99%", "Quota 84% Remaining", "Binance 58% / Bybit 42%" — under a
    # <b>LIVE</b> header, beside a chart drawn from `sin(i * 0.3)`. None of it
    # was measured. The web workspace refuses to substitute a number it did not
    # observe; the companion answering the same questions with invented ones is
    # the same lie in a channel where it is harder to check.
    #
    # These read the sources the rest of the bot already uses. Where a source is
    # unavailable the card says so and drops the chart, rather than falling back
    # to a plausible shape.

    def _subsystem_lines(self) -> tuple[list[str], str]:
        """Trading state, feeds and services — the real ones."""
        feed_health = self.tca.health() if self.tca else {}
        state = self.gateway.state() if self.gateway else None
        feeds = feed_health.get("feeds", [])
        live_feeds = sum(1 for feed in feeds if feed.get("connected"))
        lines: list[str] = []
        if state:
            lines.append(f"Trading state  <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code>")
            lines.append(f"Equity         <code>{_money(state.equity)}</code>")
            lines.append(f"Daily P&amp;L      <code>{_money(state.daily_pnl)}</code>")
        else:
            lines.append("Trading state  <code>gateway unavailable</code>")
        lines.append(f"Market feeds   <code>{live_feeds}/{len(feeds)} connected</code>")
        if feed_health.get("synthetic_active"):
            lines.append("Book source    <code>SYNTHETIC — generated, not a venue</code>")
        uptime = feed_health.get("uptime_s")
        if uptime:
            lines.append(f"Engine uptime  <code>{uptime:.0f}s</code>")
        status = "DEGRADED" if (not state or live_feeds < len(feeds)) else "LIVE"
        return lines, status

    def _latency_rows(self) -> list[tuple[str, float, float, float, int]]:
        """Per-route p50/p95/p99 actually observed by the gateway middleware."""
        from modules import metrics

        rows = []
        for route, stats in metrics.request_latency_summary().items():
            rows.append((route, stats["p50"], stats["p95"], stats["p99"], int(stats["samples"])))
        rows.sort(key=lambda row: row[3], reverse=True)
        return rows[:6]

    async def _closes_for(self, symbol: str, asset: str, interval: str = "1d", count: int = 60) -> list[float]:
        try:
            payload = await self._bars_payload(symbol, interval, count, asset)
        except Exception:
            return []
        if not payload.get("ok"):
            return []
        return [
            value for value in (_finite(row.get("close")) for row in (payload.get("data") or []))
            if value is not None
        ]

    async def _cmd_tab_overview(self, args, chat_id, actor) -> None:
        lines, status = self._subsystem_lines()
        positions: list[dict[str, Any]] = []
        if self.gateway:
            try:
                positions = self._portfolio_report().get("exposure", {}).get("positions", []) or []
            except Exception:
                lines.append("<i>The book could not be read, so there is no exposure chart.</i>")
        charts: list[tuple[str, bytes]] = []

        exposure = generate_bars_chart_png(
            "Gross exposure by symbol (USD)",
            [str(position.get("symbol")) for position in positions[:8]],
            [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
            "Notional (USD)",
            horizontal=True,
            value_fmt="{:,.0f}",
        )
        if exposure:
            charts.append(("exposure", exposure))

        latency = self._latency_rows()
        latency_chart = generate_bars_chart_png(
            "Gateway route latency p99 (ms, observed)",
            [route for route, *_ in latency],
            [p99 for _, _, _, p99, _ in latency],
            "p99 (ms)",
            horizontal=True,
            value_fmt="{:.0f}ms",
        )
        if latency_chart:
            charts.append(("latency", latency_chart))
        else:
            lines.append("<i>No gateway request has been timed yet, so no latency chart.</i>")

        if not positions:
            lines.append("<i>The book holds no position, so there is no exposure chart.</i>")

        text = text_card(
            "🌐 Desk overview",
            status,
            lines,
            source="Gateway + TCA engine + request middleware",
            next_commands="/research · /execution · /portfolio · /risk · /data · /reliability · /developer",
        )
        await self.send_media_group(chat_id, charts, caption=text, reply_markup=_tab_footer(
            "overview",
            [
                ("Portfolio", cb("portfolio")),
                ("Risk", cb("risk")),
                ("Orders", cb("orders")),
                ("Ops", cb("ops")),
            ],
            refresh=cb("overview"),
        ))

    async def _cmd_tab_research(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        asset = self._asset(symbol, args)
        footer = _tab_footer(
            "research",
            [
                ("Backtests", cb("backtests")),
                ("Strategies", cb("strategies")),
                ("Regime", cb("regime", symbol)),
                ("Quote", cb("quote", symbol)),
            ],
            refresh=cb("research", symbol),
            extra_rows=[_symbol_row("research", symbol)],
        )
        closes = await self._closes_for(symbol, asset)
        if len(closes) < 2:
            await self.send_message(chat_id, text_card(
                f"🔬 Research · {esc(symbol)}", "NO BARS",
                ["No daily bars were returned, so nothing can be measured for this symbol."],
                source="OpenBB / yfinance", next_commands="/quote " + symbol,
            ), reply_markup=footer)
            return

        returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
        mean = sum(returns) / len(returns) if returns else 0.0
        variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1) if len(returns) > 1 else 0.0
        vol = math.sqrt(variance) * math.sqrt(365)
        total = closes[-1] / closes[0] - 1 if closes[0] else 0.0
        peak, worst = closes[0], 0.0
        for close in closes:
            peak = max(peak, close)
            worst = min(worst, close / peak - 1 if peak else 0.0)

        lines = [
            f"Window      <code>{len(closes)} daily closes</code>",
            f"Return      <code>{_percent(total, signed=True)}</code>",
            f"Volatility  <code>{_percent(vol)}</code> annualised",
            f"Max drawdown <code>{_percent(worst)}</code>",
            "<i>Descriptive statistics of the price series only — this is not a "
            "backtest and carries no verdict. /backtests lists scored candidates the desk has already run.</i>",
        ]
        charts = [(f"{symbol}-price", generate_series_chart_png(symbol, closes, "1d", "OpenBB / yfinance"))]
        drawdown = generate_drawdown_chart_png(symbol, closes)
        if drawdown:
            charts.append((f"{symbol}-drawdown", drawdown))

        await self.send_media_group(chat_id, charts, caption=text_card(
            f"🔬 Research · {esc(symbol)}", "MEASURED", lines,
            source="OpenBB / yfinance", next_commands=f"/backtests · /quote {symbol}",
        ), reply_markup=footer)

    async def _cmd_tab_execution(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        footer = _tab_footer(
            "execution",
            [
                ("Book", cb("book", symbol)),
                ("TCA", cb("tca", symbol, "100000", "BUY")),
                ("Working", cb("working")),
                ("Orders", cb("orders")),
            ],
            refresh=cb("execution", symbol),
            extra_rows=[_symbol_row("execution", symbol)],
        )
        books = [book for book in self.tca.get_books(symbol, depth=20) if book.mid] if self.tca else []
        if not books:
            await self.send_message(chat_id, text_card(
                f"⚡ Execution · {esc(symbol)}", "NO LIVE BOOK",
                ["No venue currently has a fresh book for this symbol, so there is nothing to route against."],
                source="TCA engine", next_commands="/feedstatus",
            ), reply_markup=footer)
            return

        bids: list[tuple[float, float]] = []
        asks: list[tuple[float, float]] = []
        lines: list[str] = []
        synthetic = False
        for book in books:
            # `get_books` hands back the VenueBook schema, not the raw BookState:
            # the ladders are lists of BookLevel and the depth totals are already
            # computed fields. Reaching for `.items()` and `depth_money()` here is
            # reaching for the internal type.
            synthetic = synthetic or bool(getattr(book, "synthetic", False))
            bids.extend((level.price, level.size) for level in book.bids)
            asks.extend((level.price, level.size) for level in book.asks)
            lines.append(
                f"<code>{esc(book.venue):<9}</code> mid <code>{_number(book.mid)}</code>"
                f" · spread <code>{_number(book.spread_bps, 2)}</code> bps"
                f" · depth <code>{_money(book.depth_usd_bid)}</code> / <code>{_money(book.depth_usd_ask)}</code>"
            )
        if synthetic:
            lines.append("<i>At least one venue is serving a synthetic book — generated, not a venue.</i>")

        chart = generate_depth_chart_png(symbol, bids, asks)
        charts = [(f"{symbol}-depth", chart)] if chart else []
        await self.send_media_group(chat_id, charts, caption=text_card(
            f"⚡ Execution · {esc(symbol)}", "SYNTHETIC BOOK" if synthetic else "LIVE BOOK", lines,
            source="TCA engine", next_commands=f"/book {symbol} · /tca {symbol} 100000 BUY",
        ), reply_markup=footer)

    async def _cmd_tab_data(self, args, chat_id, actor) -> None:
        from modules import research

        feed_health = self.tca.health() if self.tca else {}
        feeds = feed_health.get("feeds", [])
        openbb = await research.openbb_status_async()
        lines = [
            f"OpenBB service <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>",
            f"Market feeds   <code>{sum(1 for f in feeds if f.get('connected'))}/{len(feeds)} connected</code>",
        ]
        if feed_health.get("synthetic_active"):
            lines.append("Book source    <code>SYNTHETIC — generated, not a venue</code>")
        for feed in feeds:
            lines.append(
                f"<code>{esc(str(feed.get('venue') or feed.get('name') or '?')):<9}</code>"
                f" <code>{'connected' if feed.get('connected') else 'down'}</code>"
                f" · <code>{_number(feed.get('update_rate_hz'), 2)} Hz</code>"
            )

        chart = generate_bars_chart_png(
            "Feed update rate by venue (Hz, observed)",
            [str(feed.get("venue") or feed.get("name") or "?") for feed in feeds],
            [_finite(feed.get("update_rate_hz")) or 0.0 for feed in feeds],
            "Updates per second",
            colours=['#00e676' if feed.get("connected") else '#ff5252' for feed in feeds],
            value_fmt="{:.2f}",
        )
        if not chart:
            lines.append("<i>No feed is reporting an update rate, so no chart.</i>")

        await self.send_media_group(chat_id, [("feeds", chart)] if chart else [], caption=text_card(
            "📊 Data operations", "READY" if openbb.get("ok") else "DEGRADED", lines,
            source="TCA engine + OpenBB", next_commands="/openbb · /feedstatus",
        ), reply_markup=_tab_footer(
            "data",
            [
                ("Feeds", cb("feedstatus")),
                ("OpenBB", cb("openbb")),
                ("Incidents", cb("incidents")),
                ("Events", cb("events")),
            ],
            refresh=cb("data"),
        ))

    async def _cmd_tab_reliability(self, args, chat_id, actor) -> None:
        rows = self._latency_rows()
        feed_health = self.tca.health() if self.tca else {}
        uptime = feed_health.get("uptime_s") or 0.0
        lines = [f"Engine uptime  <code>{uptime:.0f}s</code>"]
        if rows:
            for route, p50, p95, p99, samples in rows:
                lines.append(
                    f"<code>{esc(route)[:22]:<22}</code> p50 <code>{p50:.0f}</code>"
                    f" · p95 <code>{p95:.0f}</code> · p99 <code>{p99:.0f}</code> ms"
                    f" · n=<code>{samples}</code>"
                )
        else:
            lines.append("<i>No request has been timed in the current window, so there is nothing to plot.</i>")

        charts: list[tuple[str, bytes]] = []
        p99_chart = generate_bars_chart_png(
            "Route latency p99 (ms, observed)",
            [route[:18] for route, *_ in rows],
            [p99 for _, _, _, p99, _ in rows],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        if p99_chart:
            charts.append(("p99", p99_chart))
        sample_chart = generate_bars_chart_png(
            "Requests timed per route (window)",
            [route[:18] for route, *_ in rows],
            [float(samples) for *_, samples in rows],
            "Samples", horizontal=True, value_fmt="{:,.0f}",
        )
        if sample_chart:
            charts.append(("samples", sample_chart))

        await self.send_media_group(chat_id, charts, caption=text_card(
            "🛡️ Reliability", "MEASURED" if rows else "NO SAMPLES", lines,
            source="Gateway request middleware", next_commands="/status · /incidents",
        ), reply_markup=_tab_footer(
            "reliability",
            [
                ("Ops", cb("ops")),
                ("Venues", cb("venues")),
                ("Incidents", cb("incidents")),
                ("Status", cb("status")),
            ],
            refresh=cb("reliability"),
        ))

    async def _cmd_tab_developer(self, args, chat_id, actor) -> None:
        from modules import research

        routes = _committed_route_counts()
        openbb = await research.openbb_status_async()
        audit_health = self.audit.health() if self.audit else {}
        queue_stats = self.queue.stats() if self.queue else {}
        lines = [
            f"Build          <code>{esc(settings.version)}</code> · <code>{esc(settings.environment)}</code>",
            "",
            "<b>Deployment units</b>",
            "Risk gateway   <code>FastAPI · this process, port 8000</code>",
            "Web desk       <code>Next.js · separate origin</code>",
            f"OpenBB service <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code> · stateless",
            "",
            "<b>Backends</b>",
            f"Audit          <code>{esc(audit_health.get('backend') or '—')}</code> · "
            f"<code>{'available' if audit_health.get('available') else 'unavailable'}</code>",
            f"Job queue      <code>{esc(queue_stats.get('backend') or '—')}</code> · "
            f"<code>{queue_stats.get('total', 0)} jobs</code>",
            "",
            f"Verify gates   <code>{len(_VERIFY_GATES)}</code> must pass before a deploy ships",
        ]
        lines.extend(f"<code>{esc(gate)}</code>" for gate in _VERIFY_GATES)
        if routes:
            lines.append(
                f"API surface    <code>{int(sum(n for _, n in routes))}</code> operations "
                f"across <code>{len(routes)}</code> modules"
            )
        else:
            lines.append("API surface    <code>snapshot not in this image</code>")
        lines.append(
            "<i>These are the gates committed in this repository, not the conclusion "
            "of the last run — GitHub Actions remains the authority for that.</i>"
        )
        chart = generate_bars_chart_png(
            "API surface by module (committed OpenAPI snapshot)",
            [tag for tag, _ in routes],
            [count for _, count in routes],
            "Operations", horizontal=True, value_fmt="{:,.0f}",
        ) if routes else None
        await self.send_media_group(chat_id, [("ci", chart)] if chart else [], caption=text_card(
            "💻 Developer topology", "THREE UNITS", lines,
            source="Committed CI configuration + live backends", next_commands="/version · /lineage · /commands",
        ), reply_markup=_tab_footer(
            "developer",
            [
                ("Version", cb("version")),
                ("Lineage", cb("lineage")),
                ("Ops", cb("ops")),
                ("Status", cb("status")),
            ],
            refresh=cb("developer"),
        ))

    # ------------------------------------------------------------------ #
    # Portfolio manager
    # ------------------------------------------------------------------ #
    async def _cmd_equity(self, args, chat_id, actor) -> None:
        """The persisted equity curve — the one series the bot never surfaced.

        Reads `build_equity_history`, the same function behind
        `GET /api/portfolio/history`, so the chat curve and the web curve are
        the same snapshots rather than two derivations that can disagree.
        """
        from modules.portfolio import build_equity_history

        limit = 500
        choice = args[0].lower() if args else ""
        if choice == "all":
            limit = 2000
        elif choice.isdigit():
            limit = max(2, min(2000, int(choice)))
        switch = kb([_choice_row("equity", [("50", "50"), ("200", "200"), ("all", "all")], choice)])

        history = build_equity_history(self.audit, limit=limit)
        points = history.get("points") or []
        if not points:
            await self.send_message(chat_id, text_card(
                "📈 Equity curve", "NO SNAPSHOTS",
                ["The gateway persists equity on a timer; none has been recorded yet.",
                 "<i>This is an empty record, not a flat book.</i>"],
                source="audit · equity_snapshots", next_commands="/portfolio · /pnl",
            ), reply_markup=switch)
            return

        periods = history.get("periods") or {}
        bounded = set(periods.get("window_bounded") or [])

        def _row(label: str, key: str) -> str:
            period = periods.get(key) or {}
            pnl, ret = period.get("pnl"), period.get("return")
            if pnl is None:
                return f"{label:<12} <code>not observed</code>"
            flag = " <i>(window-bounded)</i>" if key in bounded else ""
            return f"{label:<12} <code>{_money(pnl)}</code> · <code>{_percent(ret)}</code>{flag}"

        latest = points[-1]
        lines = [
            f"Equity       <code>{_money(latest.get('equity'))}</code>",
            _row("Day", "day"),
            _row("Month", "month_to_date"),
            _row("Inception", "since_first_snapshot"),
            f"Peak         <code>{_money(periods.get('peak_equity'))}</code>",
            f"Worst DD     <code>{_percent(periods.get('worst_daily_drawdown_pct'))}</code> intraday, against each day's own open",
            f"Sampled      <code>{history.get('sample_count')}</code> snapshots every "
            f"<code>{history.get('interval_s')}s</code>",
        ]
        if bounded:
            lines.append(
                "<i>Window-bounded periods start at the oldest snapshot retained, "
                "not at the true period open — the gateway keeps no earlier mark.</i>"
            )

        charts: list[tuple[str, bytes]] = []
        curve = generate_equity_chart_png(points, latest.get("start_of_day"))
        if curve:
            charts.append(("equity", curve))
        drawdown = generate_drawdown_chart_png(
            "EQUITY", [float(point["equity"]) for point in points if point.get("equity")],
        )
        if drawdown:
            charts.append(("drawdown", drawdown))

        await self.send_media_group(chat_id, charts, caption=text_card(
            "📈 Equity curve", "PERSISTED", lines,
            source="audit · equity_snapshots", next_commands="/portfolio · /var · /pnl",
        ), reply_markup=switch)

    async def _cmd_portfolio(self, args, chat_id, actor) -> None:
        from modules.portfolio import format_for_telegram

        report = self._portfolio_report()
        text = format_for_telegram(report)
        positions = report.get("exposure", {}).get("positions", []) or []

        # This replaced a fixed three-slice pie that never read the book it was
        # captioning. These are the book's own notionals and its own daily P&L
        # per symbol.
        charts: list[tuple[str, bytes]] = []
        allocation = generate_bars_chart_png(
            "Allocation by symbol (USD notional)",
            [str(position.get("symbol")) for position in positions[:8]],
            [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
            "Notional (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        if allocation:
            charts.append(("allocation", allocation))

        pnl_values = [_finite(position.get("unrealized_pnl")) for position in positions[:8]]
        pnl = generate_bars_chart_png(
            "Unrealised P&L by symbol (USD)",
            [str(position.get("symbol")) for position in positions[:8]],
            pnl_values,
            "Unrealised P&L (USD)",
            colours=['#00e676' if (value or 0) >= 0 else '#ff5252' for value in pnl_values],
            horizontal=True, value_fmt="{:,.0f}",
        )
        if pnl:
            charts.append(("pnl", pnl))

        await self.send_media_group(chat_id, charts, caption=text, reply_markup=_tab_footer(
            "portfolio",
            [
                ("Positions", cb("positions")),
                ("Exposure", cb("exposure")),
                ("P&L", cb("pnl")),
                ("Headroom", cb("headroom")),
            ],
            refresh=cb("portfolio"),
        ))

    async def _cmd_positions(self, args, chat_id, actor) -> None:
        state = self.gateway.state()
        symbol = self._symbol(args) if args else None
        positions = [position for position in state.positions if not symbol or position.symbol == symbol]
        if not positions:
            message = f"No open position for <code>{esc(symbol)}</code>." if symbol else "The book is flat."
            await self.send_message(chat_id, text_card("📌 Positions", "FLAT", [message], source="Risk gateway", next_commands="/portfolio"))
            return
        lines = []
        for position in sorted(positions, key=lambda row: -row.notional):
            side = "LONG" if position.quantity > 0 else "SHORT"
            lines += [
                f"<b>{esc(position.symbol)} · {side}</b>",
                f"Qty <code>{position.quantity:+.6f}</code> · Avg <code>{_number(position.avg_price)}</code> · Mark <code>{_number(position.mark_price)}</code>",
                f"Notional <code>{_money(position.notional)}</code> · uPnL <code>{_money(position.unrealized_pnl, signed=True)}</code>",
            ]
        await self.send_message(chat_id, text_card("📌 Open positions", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/exposure · /pnl · /concentration"))

    async def _cmd_pnl(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        equity = report["equity"]
        lines = [
            f"Equity       <code>{_money(equity['current'])}</code>",
            f"Day P&amp;L     <code>{_money(equity['daily_pnl'], signed=True)}</code> · <code>{_percent(equity['daily_return'], signed=True)}</code>",
            f"Realised     <code>{_money(equity['realized_pnl'], signed=True)}</code>",
            f"Unrealised   <code>{_money(equity['unrealized_pnl'], signed=True)}</code>",
        ]
        await self.send_message(chat_id, text_card("💹 Portfolio P&L", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/positions · /attribution"))

    async def _cmd_exposure(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        exposure = report["exposure"]
        lines = [
            f"Gross       <code>{_money(exposure['gross'])}</code>",
            f"Net         <code>{_money(exposure['net'], signed=True)}</code>",
            f"Leverage    <code>{_number(exposure['leverage'])}x</code>",
            f"Positions   <code>{len(exposure['positions'])}</code>",
        ]
        for position in exposure["positions"][:8]:
            lines.append(f"{esc(position['symbol']):<10} <code>{_money(position['notional'])}</code> · <code>{_percent(position['share_of_gross'])}</code>")
        await self.send_message(chat_id, text_card("🧭 Portfolio exposure", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/concentration · /headroom"))

    async def _cmd_concentration(self, args, chat_id, actor) -> None:
        concentration = self._portfolio_report()["concentration"]
        lines = [
            f"Largest symbol      <code>{esc(concentration['largest_symbol'] or '—')}</code>",
            f"Largest share       <code>{_percent(concentration['largest_share'])}</code>",
            f"Top-two share       <code>{_percent(concentration['top_two_share'])}</code>",
            f"HHI                 <code>{_number(concentration['hhi'], 4)}</code>",
            f"Effective positions <code>{_number(concentration['effective_positions'])}</code>",
        ]
        await self.send_message(chat_id, text_card("🎯 Concentration", "LIVE GATEWAY STATE", lines, source="Portfolio service", next_commands="/positions · /headroom"))

    async def _cmd_headroom(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        budget = report["risk_budget"]
        gross = budget["gross_exposure"]
        drawdown = budget["daily_drawdown"]
        constraint, utilisation = budget["binding_constraint"]
        lines = [
            f"Gross remaining  <code>{_money(gross['remaining'])}</code> · <code>{_percent(gross['utilisation'])}</code> used",
            f"Drawdown cushion <code>{_money(drawdown['cushion_usd'])}</code> · <code>{_percent(drawdown['utilisation'])}</code> used",
            f"Binding limit    <code>{esc(constraint)}</code> · <code>{_percent(utilisation)}</code>",
        ]
        for position in report["exposure"]["positions"][:8]:
            cap = position["symbol_limit"]
            lines.append(f"{esc(position['symbol']):<10} remaining <code>{_money(cap['remaining'])}</code>")
        await self.send_message(chat_id, text_card("🛡 Risk headroom", "AUTHORITATIVE LIMITS", lines, source="Risk gateway", next_commands="/risk · /limits"))

    async def _cmd_risk(self, args, chat_id, actor) -> None:
        state = self.gateway.state()
        used = max(0.0, min(1.0, state.drawdown_budget_used_pct))
        filled = int(used * 12)
        lines = [
            f"Equity      <code>{_money(state.equity)}</code>",
            f"Day P&amp;L    <code>{_money(state.daily_pnl, signed=True)}</code>",
            f"Drawdown   <code>{_percent(state.daily_drawdown_pct)}</code> / <code>{_percent(state.limits['max_daily_drawdown_pct'])}</code>",
            f"Budget     <code>{'█' * filled}{'░' * (12 - filled)}</code> {_percent(used)}",
            f"Gross       <code>{_money(state.gross_exposure)}</code> / <code>{_money(state.limits['max_gross_exposure_usd'])}</code>",
            f"Orders      <code>{state.orders_accepted} accepted · {state.orders_rejected} rejected</code>",
        ]
        status = "HALTED" if state.kill_switch_active else "LIVE"
        if state.kill_switch_active:
            lines.insert(0, f"Reason <code>{esc(state.kill_reason or 'not provided')}</code>")

        # The budget bar was drawn in block characters for the drawdown only.
        # Every hard limit the gateway enforces has a utilisation, and which one
        # binds first is the whole question — so all of them are plotted against
        # the same 100% scale, from the gateway's own numbers.
        gross_limit = state.limits.get("max_gross_exposure_usd") or 0.0
        dd_limit = state.limits.get("max_daily_drawdown_pct") or 0.0
        utilisations = [
            ("Daily drawdown", (state.daily_drawdown_pct / dd_limit * 100) if dd_limit else None),
            ("Gross exposure", (state.gross_exposure / gross_limit * 100) if gross_limit else None),
            ("Drawdown budget", used * 100),
        ]
        chart = generate_bars_chart_png(
            "Risk limit utilisation (% of hard limit)",
            [label for label, value in utilisations if value is not None],
            [value for _, value in utilisations if value is not None],
            "Utilisation (%)",
            colours=[
                '#ff5252' if (value or 0) >= 90 else '#f59e0b' if (value or 0) >= 70 else '#00e676'
                for _, value in utilisations if value is not None
            ],
            horizontal=True, value_fmt="{:.1f}%",
        )
        await self.send_media_group(chat_id, [("limits", chart)] if chart else [], caption=text_card(
            "🛡 Risk gateway", status, lines,
            source="Authoritative risk process", next_commands="/headroom · /positions · /incidents",
        ), reply_markup=_tab_footer(
            "risk",
            [
                ("VaR", cb("var")),
                ("Stress", cb("stress")),
                ("Correlation", cb("correlation")),
                ("Headroom", cb("headroom")),
            ],
            refresh=cb("risk"),
        ))

    async def _cmd_limits(self, args, chat_id, actor) -> None:
        limits = self.gateway.state().limits
        lines = [f"<code>{esc(key):<28}</code> {value:,.4g}" for key, value in limits.items()]
        await self.send_message(chat_id, text_card("🧱 Hard risk limits", "DEPLOY-TIME CONFIGURATION", lines, source="Risk gateway settings", next_commands="/headroom · /risk"))

    async def _cmd_attribution(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        strategies = report["attribution"]["by_strategy"]
        symbols = report["attribution"]["by_symbol"]
        lines = ["<b>By strategy</b>"]
        if strategies:
            for row in strategies[:8]:
                lines.append(f"{esc(row.get('strategy') or 'unassigned')} · <code>{row.get('filled') or 0} fills</code> · <code>{_money(row.get('notional'))}</code> · <code>{_number(row.get('avg_slippage_bps'), signed=True)} bps</code>")
        else:
            lines.append("No strategy flow recorded.")
        lines.append("\n<b>By symbol</b>")
        for row in symbols[:8]:
            lines.append(f"{esc(row.get('symbol'))} · <code>{row.get('filled') or 0} fills</code> · <code>{row.get('rejected') or 0} rejected</code>")
        await self.send_message(chat_id, text_card("🧾 Portfolio attribution", "AUDIT-RECONSTRUCTED", lines, source="DuckDB audit log", next_commands="/orders · /slippage · /fees"))

    # ------------------------------------------------------------------ #
    # OpenBB / market data
    # ------------------------------------------------------------------ #
    async def _cmd_openbb(self, args, chat_id, actor) -> None:
        from modules import research

        status = await research.openbb_status_async()
        lines = [
            f"Provider <code>{esc(status.get('provider') or '—')}</code>",
            f"Quote     <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"Bars      <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"News      <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"Fundamentals <code>{'available' if status.get('ok') else 'unavailable'}</code>",
        ]
        if status.get("detail"):
            lines.append(f"Detail <code>{esc(str(status['detail'])[:240])}</code>")
        await self.send_message(chat_id, text_card("🔌 OpenBB", "READY" if status.get("ok") else "UNAVAILABLE", lines, source="OpenBB provider extension", next_commands="/quote AAPL · /snapshot AAPL · /status"))

    async def _quote_payload(self, symbol: str, asset: str) -> dict[str, Any]:
        from modules import research

        return await research.quote(symbol, asset)

    async def _quote_line(self, symbol: str, asset: str) -> tuple[str | None, dict[str, Any]]:
        """One symbol's quote row for a multi-symbol card, plus its raw payload."""
        payload = await self._quote_payload(symbol, asset)
        if not payload.get("ok"):
            return None, payload
        data = payload["data"]
        row = (
            f"<code>{esc(symbol):<10}</code> "
            f"<code>{_number(data.get('price'))}</code> "
            f"· <code>{_number(data.get('change_percent'), signed=True)}%</code> "
            f"· H <code>{_number(data.get('high'))}</code> "
            f"· L <code>{_number(data.get('low'))}</code>"
        )
        return row, payload

    async def _symbol_chart(self, symbol: str, asset: str) -> bytes | None:
        """A close-series chart for one symbol, or nothing if the bars are not there."""
        try:
            payload = await self._bars_payload(symbol, "1d", 30, asset)
        except Exception:
            return None
        if not payload.get("ok"):
            return None
        closes = [
            value for value in (_finite(row.get("close")) for row in (payload.get("data") or []))
            if value is not None
        ]
        if len(closes) < 2:
            return None
        return generate_series_chart_png(symbol, closes, "1d", "OpenBB / yfinance")

    async def _cmd_quote(self, args, chat_id, actor) -> None:
        """
        Quote one symbol or several.

        "/quote BTCUSDT ETHUSDT SOLUSDT" now answers about all three in one
        message: a row per symbol in the card, and a chart per symbol in a
        single album, rather than one symbol's picture standing in for a watch
        list. A symbol whose bars are unavailable keeps its quote row and simply
        contributes no chart — a missing series is not worth suppressing the
        numbers over.
        """
        symbols = self._symbols(args)
        asset_index = len(symbols) if len(symbols) > 1 else 1
        rows: list[str] = []
        charts: list[tuple[str, bytes]] = []
        failures: list[str] = []
        delayed = False

        for symbol in symbols:
            asset = self._asset(symbol, args, index=asset_index)
            row, payload = await self._quote_line(symbol, asset)
            if row is None:
                failures.append(symbol)
                if len(symbols) == 1:
                    await self.send_message(chat_id, self._openbb_error("quote", payload))
                    return
                continue
            rows.append(row)
            delayed = delayed or bool(payload["data"].get("delayed"))
            chart = await self._symbol_chart(symbol, asset)
            if chart:
                charts.append((symbol, chart))

        if not rows:
            await self.send_message(chat_id, self._openbb_error("quote", {"error": "no symbol returned a quote"}))
            return

        if failures:
            rows.append(f"<i>No quote for {esc(', '.join(failures))}</i>")
        if len(charts) < len(rows) - (1 if failures else 0):
            rows.append("<i>Symbols without a chart had fewer than two daily bars.</i>")

        title = f"💹 {symbols[0]} quote" if len(symbols) == 1 else f"💹 {len(rows) - (1 if failures else 0)} quotes"
        card = text_card(
            title,
            "DELAYED" if delayed else "LIVE",
            rows,
            source="OpenBB / yfinance",
            next_commands=f"/bars {symbols[0]} 1d 5 · /snapshot {symbols[0]}",
        )
        await self.send_media_group(chat_id, charts, caption=card, reply_markup=kb([_symbol_row("quote", symbols[0])]))

    async def _bars_payload(self, symbol: str, interval: str, count: int, asset: str) -> dict[str, Any]:
        from modules import research

        return await research.bars(symbol, asset, interval, count)

    def _bars_switcher(self, symbol: str, interval: str, count: int) -> dict[str, Any]:
        """Interval and symbol switch rows for the OHLCV chart commands."""
        return kb([
            _interval_row("bars", symbol, interval, str(count)),
            _symbol_row("bars", symbol, interval, str(count)),
        ])

    async def _cmd_bars(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        keyboard = self._bars_switcher(symbol, interval, count)
        payload = await self._bars_payload(symbol, interval, count, asset)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("bars", payload), reply_markup=keyboard)
            return
        rows = payload.get("data") or []
        if not rows:
            await self.send_message(chat_id, self._openbb_error("bars", {"error": "no bars returned"}), reply_markup=keyboard)
            return
        lines = []
        for row in rows[-min(count, 10):]:
            date_label = str(row.get("date") or "")[:16]
            lines.append(f"<code>{esc(date_label):<16}</code> O {_number(row.get('open'))} · H {_number(row.get('high'))} · L {_number(row.get('low'))} · C {_number(row.get('close'))}")
        # This command used to answer entirely in text; it now draws the close
        # series it already fetched, from those closes and nothing else.
        closes = [value for row in rows if (value := _finite(row.get("close"))) is not None]
        chart = generate_series_chart_png(symbol, closes, interval, "OpenBB / yfinance") if len(closes) >= 2 else None
        card = text_card(f"🕯 {symbol} · {interval}", f"{len(rows)} DELAYED BARS", lines, source="OpenBB / yfinance", next_commands=f"/trend {symbol} {interval} {count} · /range {symbol} {interval} {count}")
        await self.send_media_group(chat_id, [("bars", chart)] if chart else [], caption=card, reply_markup=keyboard)

    async def _cmd_trend(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        count = max(2, count)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        if len(rows) < 2:
            await self.send_message(chat_id, self._openbb_error("trend", payload if not payload.get("ok") else {"error": "at least two bars are required"}))
            return
        first = _finite(rows[0].get("close"))
        last = _finite(rows[-1].get("close"))
        change = (last / first - 1) if first and last is not None else None
        direction = "UP" if change is not None and change > 0 else "DOWN" if change is not None and change < 0 else "FLAT"
        closes = [value for row in rows if (value := _finite(row.get("close"))) is not None]
        # Per-bar returns, so the headline move can be read against the noise
        # it happened in rather than in isolation.
        steps = [
            closes[index] / closes[index - 1] - 1
            for index in range(1, len(closes))
            if closes[index - 1]
        ]
        sigma = _stdev(steps) if len(steps) > 1 else None
        drift = (sum(steps) / len(steps)) if steps else None
        lines = [
            f"First close <code>{_number(first)}</code>",
            f"Last close  <code>{_number(last)}</code>",
            f"Return      <code>{_percent(change, signed=True)}</code>",
            f"Direction   <code>{direction}</code>",
            f"Per-bar σ   <code>{_percent(sigma)}</code> · mean <code>{_percent(drift, signed=True)}</code>",
        ]
        if sigma and change is not None:
            # How many bar-sized moves the whole period amounts to. Under one,
            # the move is inside the instrument's ordinary noise.
            ratio = abs(change) / (sigma * max(1, len(steps)) ** 0.5)
            flag = "🟢" if ratio >= 2 else "🟡" if ratio >= 1 else "⚪"
            lines.append(
                f"Signal      {flag} <code>{_number(ratio)}σ</code> of the period's own noise"
            )
            lines.append(
                "<i>Under 1σ the move is ordinary variation for this instrument "
                "over this many bars — a direction, not yet evidence.</i>"
            )
        keyboard = kb([
            _interval_row("trend", symbol, interval, str(count)),
            _symbol_row("trend", symbol, interval, str(count)),
        ])
        chart = generate_series_chart_png(symbol, closes, interval, "OpenBB / yfinance") if len(closes) >= 2 else None
        card = text_card(f"📈 {symbol} trend · {interval}", f"{len(rows)} DELAYED BARS", lines, source="OpenBB / yfinance", next_commands=f"/range {symbol} {interval} {count} · /volume {symbol} {interval} {count}")
        await self.send_media_group(chat_id, [("trend", chart)] if chart else [], caption=card, reply_markup=keyboard)

    async def _cmd_range(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        highs = [value for row in rows if (value := _finite(row.get("high"))) is not None]
        lows = [value for row in rows if (value := _finite(row.get("low"))) is not None]
        if not highs or not lows:
            await self.send_message(chat_id, self._openbb_error("range", payload if not payload.get("ok") else {"error": "no valid high/low values"}))
            return
        high, low = max(highs), min(lows)
        width = (high / low - 1) if low else None
        # Each bar's own high-low span, so today's range can be read against
        # what this instrument's ranges usually look like.
        spans = [
            (h / low_value - 1)
            for row in rows
            if (h := _finite(row.get("high"))) is not None
            and (low_value := _finite(row.get("low")))
        ]
        typical = _median(spans) if spans else None
        widest = max(spans) if spans else None
        lines = [
            f"High        <code>{_number(high)}</code>",
            f"Low         <code>{_number(low)}</code>",
            f"Range width <code>{_percent(width)}</code> across the window",
            f"Typical bar <code>{_percent(typical)}</code> · widest <code>{_percent(widest)}</code>",
            f"Observations <code>{len(rows)}</code>",
        ]
        if typical and spans:
            latest = spans[-1]
            flag = "🔴" if latest >= typical * 2 else "🟡" if latest >= typical * 1.5 else "🟢"
            lines.append(
                f"Latest bar  {flag} <code>{_percent(latest)}</code> · "
                f"<code>{_number(latest / typical)}x</code> the median span"
            )
            lines.append(
                "<i>A bar much wider than the median is where slippage estimates "
                "built on calm conditions stop holding.</i>"
            )
        await self.send_message(chat_id, text_card(f"↕️ {symbol} range · {interval}", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/bars {symbol} {interval} 5"))

    async def _cmd_volume(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        volumes = [value for row in rows if (value := _finite(row.get("volume"))) is not None]
        if not volumes:
            await self.send_message(chat_id, self._openbb_error("volume", payload if not payload.get("ok") else {"error": "no volume values"}))
            return
        average = sum(volumes) / len(volumes)
        ratio = volumes[-1] / average if average else None
        median = _median(volumes)
        quietest, busiest = min(volumes), max(volumes)
        rank = sum(1 for value in volumes if value <= volumes[-1]) / len(volumes)
        lines = [
            f"Latest  <code>{_number(volumes[-1], 0)}</code>",
            f"Average <code>{_number(average, 0)}</code> · median <code>{_number(median, 0)}</code>",
            f"Ratio   <code>{_number(ratio)}x</code> the mean",
            f"Range   <code>{_number(quietest, 0)}</code> … <code>{_number(busiest, 0)}</code>",
            f"Bars    <code>{len(volumes)}</code>",
        ]
        flag = "🟢" if rank >= 0.8 else "🟡" if rank >= 0.5 else "⚪"
        lines.append(
            f"Percentile {flag} <code>{_percent(rank)}</code> of bars in this window "
            "traded less"
        )
        lines.append(
            "<i>The median sits beside the mean because one halt or one auction "
            "print drags an average somewhere no bar actually was.</i>"
        )
        await self.send_message(chat_id, text_card(f"🔊 {symbol} volume · {interval}", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/trend {symbol} {interval} {count}"))

    async def _cmd_news(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        count = self._limit(args, 1, 5, 10)
        payload = await research.news([symbol], count)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("news", payload))
            return
        items = payload.get("data") or []
        if not items:
            await self.send_message(chat_id, self._openbb_error("news", {"error": "no headlines returned"}))
            return
        lines = []
        for index, item in enumerate(items[:count], 1):
            lines.append(f"<b>{index}. {esc(item.get('title') or 'Untitled')}</b>\n   {esc(item.get('source') or 'OpenBB')} · <code>{esc(str(item.get('date') or '')[:19])}</code>")
        await self.send_message(chat_id, text_card(f"📰 {symbol} headlines", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/snapshot {symbol} · /quote {symbol}"))

    async def _cmd_fundamentals(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        payload = await research.fundamentals(symbol)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("fundamentals", payload))
            return
        data = payload["data"]
        lines = [
            f"Name       <code>{esc(data.get('name') or '—')}</code>",
            f"Exchange   <code>{esc(data.get('exchange') or '—')}</code>",
            f"Sector     <code>{esc(data.get('sector') or '—')}</code>",
            f"Industry   <code>{esc(data.get('industry') or '—')}</code>",
            f"Market cap <code>{_money(data.get('market_cap'))}</code>",
            f"P/E        <code>{_number(data.get('pe_ratio'))}</code>",
            f"EPS        <code>{_number(data.get('eps'))}</code>",
            f"Beta       <code>{_number(data.get('beta'))}</code>",
        ]
        description = str(data.get("description") or "").strip()
        if description:
            lines.append(f"\n{esc(description[:420])}{'…' if len(description) > 420 else ''}")
        await self.send_message(chat_id, text_card(f"🏢 {symbol} fundamentals", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/quote {symbol} · /news {symbol} 5"))

    async def _cmd_snapshot(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        asset = self._asset(symbol, args)
        quote, fundamentals, news = await asyncio.gather(
            research.quote(symbol, asset),
            research.fundamentals(symbol) if asset == "equity" else asyncio.sleep(0, result={"ok": False}),
            research.news([symbol], 3),
        )
        if not quote.get("ok") and not fundamentals.get("ok") and not news.get("ok"):
            await self.send_message(chat_id, self._openbb_error("snapshot", quote))
            return
        lines: list[str] = []
        if quote.get("ok"):
            data = quote["data"]
            lines += ["<b>Market</b>", f"Price <code>{_number(data.get('price'))}</code> · Change <code>{_number(data.get('change_percent'), signed=True)}%</code>"]
        if fundamentals.get("ok"):
            data = fundamentals["data"]
            lines += ["\n<b>Company</b>", f"{esc(data.get('name') or symbol)} · {esc(data.get('sector') or 'sector n/a')}", f"Market cap <code>{_money(data.get('market_cap'))}</code> · P/E <code>{_number(data.get('pe_ratio'))}</code>"]
        if news.get("ok"):
            lines.append("\n<b>Headlines</b>")
            for item in (news.get("data") or [])[:3]:
                lines.append(f"• {esc(item.get('title') or 'Untitled')}")
        await self.send_message(chat_id, text_card(f"🔎 {symbol} research snapshot", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/quote {symbol} · /bars {symbol} 1d 5 · /news {symbol} 5"))

    async def _cmd_symbols(self, args, chat_id, actor) -> None:
        lines = [f"Tracked crypto <code>{', '.join(settings.symbols)}</code>", "Equity examples <code>AAPL, MSFT, NVDA, SPY</code>", "Assets <code>equity · crypto</code>", "Intervals <code>15m · 1h · 4h · 1d</code>"]
        await self.send_message(chat_id, text_card("🔤 Instruments", "REFERENCE", lines, source="AlphaEngine configuration", next_commands="/quote AAPL · /book BTCUSDT · /intervals"))

    # ------------------------------------------------------------------ #
    # Execution analytics
    # ------------------------------------------------------------------ #
    # ------------------------------------------------------------------ #
    # Controls — the only commands that change risk state
    # ------------------------------------------------------------------ #
    #
    # Three gates, because a chat message is an unusually easy thing to send by
    # accident and an unusually easy thing to forward:
    #
    #   1. TELEGRAM_CONTROL_USER_IDS — separate from the read allow-list, empty
    #      by default. Being able to see the book does not imply being able to
    #      stop the desk.
    #   2. A per-user, single-use challenge code that expires. `/halt` alone
    #      never acts; it returns a code that `/halt <code>` consumes. A copied
    #      or forwarded command cannot fire, because the code is bound to the
    #      user who asked and dies after one use.
    #   3. The gateway's own audit log, which records the actor either way.

    _CHALLENGE_TTL_SECONDS = 90.0

    def _issue_challenge(self, user_id: str, action: str, symbol: str | None) -> str:
        code = f"{secrets.randbelow(9000) + 1000}"
        self._challenges[user_id] = {
            "code": code, "action": action, "symbol": symbol,
            "expires": time.monotonic() + self._CHALLENGE_TTL_SECONDS,
        }
        return code

    def _consume_challenge(self, user_id: str, action: str, code: str) -> tuple[bool, str | None, str]:
        """Returns ``(ok, symbol, reason)``. Single use: the entry is dropped either way."""
        pending = self._challenges.pop(user_id, None)
        if not pending:
            return False, None, "No pending confirmation — run the command without a code first."
        if time.monotonic() > float(pending["expires"]):
            return False, None, "That confirmation expired. Start again."
        if pending["action"] != action:
            return False, None, f"That code was issued for /{pending['action']}, not /{action}."
        if pending["code"] != code:
            return False, None, "Wrong code."
        return True, pending["symbol"], ""

    async def _control(self, action: str, args, chat_id, actor) -> None:
        # This line used to read `user_id = str(actor)`, which handed the whole
        # composite "tg:<id>:<username>" to a membership test against a list of
        # bare numeric ids. `"tg:12345:ian" in ["12345"]` is false for every
        # possible configuration, so every control was permanently refused
        # — including on a deployment that had configured an operator and had
        # no way to discover the switch was dead short of trying it.
        #
        # `_user_id_from_actor` rather than a bare regex, on purpose. It also
        # re-checks READ authorisation, and re-checking at this point is the
        # discipline `_watch_tick` already follows before a delivery:
        # `handle_update` authorised this user when the message arrived, and the
        # gap between that and a change of risk state is exactly where a
        # revocation ought to land. The cost of the stricter helper is that it
        # raises, so the refusal is rendered here — an uncaught PermissionError
        # would surface as the generic "Command failed" card, and a refusal that
        # does not say why is not a refusal.
        try:
            user_id = self._user_id_from_actor(actor)
        except PermissionError:
            await self.send_message(chat_id, text_card(
                f"⛔ /{action} not permitted", "READ AUTHORISATION WITHDRAWN",
                [
                    "This account is not currently authorised to read this book, so it may not change it either.",
                    "Ask the operator about <code>TELEGRAM_ALLOWED_USER_IDS</code>, or reconnect from the workspace.",
                ],
                source="Risk gateway", next_commands="/whoami · /status"))
            return

        if not self._may_control(user_id):
            await self.send_message(chat_id, text_card(
                f"⛔ /{action} not permitted", "CONTROL ALLOW-LIST",
                [
                    f"User ID <code>{esc(user_id)}</code> may read this book but not change it.",
                    "Control commands need <code>TELEGRAM_CONTROL_USER_IDS</code>, which is separate from the read allow-list and empty by default.",
                    "Connecting this chat from the workspace grants reading only — it never adds anyone here.",
                ],
                source="Risk gateway", next_commands="/risk · /headroom"))
            return

        code_arg = args[0] if args and args[0].isdigit() and len(args[0]) == 4 else None
        symbol_arg = None
        if args and not code_arg:
            candidate = args[0].upper()
            if re.fullmatch(r"[A-Z0-9.\-]{1,20}", candidate):
                symbol_arg = candidate

        if not code_arg:
            code = self._issue_challenge(user_id, action, symbol_arg)
            scope = f"<code>{esc(symbol_arg)}</code>" if symbol_arg else "the whole book"
            impact = {
                "halt": "Every subsequent pre-trade check rejects until it is released.",
                "resume": "Pre-trade checks start accepting again.",
                "flatten": "A closing MARKET order is submitted for every open position, through the same risk gates as any other order.",
                "reduceonly": "Pre-trade checks accept only orders that reduce an existing position until released.",
                "reduceonly_off": "Reduce-only is released; ordinary orders are accepted again.",
                "resetbook": "Positions and session accounting on the PAPER book are cleared. This is not an order and sends nothing to a venue.",
                "replay": "One capability is re-fetched through the validated path with its cache bypassed. It spends provider quota and writes a contract result to the data-quality ledger, which can escalate.",
            }[action]
            await self.send_message(chat_id, text_card(
                f"⚠ Confirm /{action}", "ACTION NOT YET TAKEN",
                [
                    f"Scope <b>{scope}</b>",
                    impact,
                    "",
                    f"Reply <code>/{action} {code}</code> within {int(self._CHALLENGE_TTL_SECONDS)}s.",
                    "<i>The code is single-use and tied to your user ID, so a forwarded message cannot fire it.</i>",
                ],
                source="Risk gateway", next_commands="/risk · /positions"))
            return

        ok, symbol, reason = self._consume_challenge(user_id, action, code_arg)
        if not ok:
            await self.send_message(chat_id, text_card(f"✕ /{action} not confirmed", "REJECTED", [esc(reason)], source="Risk gateway", next_commands=f"/{action}"))
            return

        try:
            # The composite actor, not the bare id: the allow-list wanted an id,
            # the audit log wants a name beside it. `_apply_control` is what
            # reaches `gateway.submit` and the risk-event log, and those rows
            # should still read `tg:12345:ian` a year from now.
            result = await self._apply_control(action, symbol, actor)
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
            log.exception("control %s failed", action)
            await self.send_message(chat_id, text_card(f"✕ /{action} failed", "GATEWAY ERROR", [esc(str(exc)[:200])], source="Risk gateway", next_commands="/status"))
            return

        await self.send_message(chat_id, text_card(f"✅ /{action} applied", "RISK STATE CHANGED", result, source="Risk gateway · audited", next_commands="/risk · /positions · /orders"))

    async def _apply_control(self, action: str, symbol: str | None, actor: str) -> list[str]:
        gateway = self.gateway
        if action in {"reduceonly", "reduceonly_off"}:
            enabled = action == "reduceonly"
            state = await gateway.set_reduce_only(
                enabled=enabled, actor=actor, reason="from Telegram",
            )
            return [
                f"Reduce-only <code>{'ON' if enabled else 'OFF'}</code>",
                f"Kill switch <code>{'ACTIVE' if getattr(state, 'kill_switch_active', False) else 'INACTIVE'}</code>",
                f"Actor <code>{esc(actor)}</code>",
                "<i>A soft halt: risk-reducing orders still pass, so a position can "
                "always be closed while it is on.</i>" if enabled else
                "<i>Ordinary orders are accepted again.</i>",
            ]
        if action == "replay":
            from modules.data_jobs import submit_replay
            from modules.schemas import DataReplayRequest

            # The symbol the challenge was issued for, so the code cannot be
            # reused against a different instrument than the one confirmed.
            target = (symbol or settings.symbols[0]).upper()
            record = submit_replay(DataReplayRequest(symbol=target), actor=actor)
            return [
                f"Replay queued <code>{esc(target)}</code>",
                f"Job <code>{esc(str(getattr(record, 'id', '') or 'unknown'))}</code>"
                f" · kind <code>{esc(str(getattr(record, 'kind', '') or 'replay'))}</code>",
                f"Actor <code>{esc(actor)}</code>",
                "<i>Runs on the shared jobs engine. The contract result lands in "
                "the data-quality ledger; /jobs and /job follow it.</i>",
            ]
        if action == "resetbook":
            gateway.reset_book(actor=actor)
            return [
                "Paper book <code>RESET</code>",
                f"Actor <code>{esc(actor)}</code>",
                "<i>Positions and session accounting cleared. Nothing was sent to a "
                "venue — this book was never at one.</i>",
            ]
        if action == "halt":
            kill = await gateway.trigger_kill(reason="manual halt from Telegram", actor=actor, symbol=symbol)
            return [f"Kill switch <code>{'ACTIVE' if kill.active else 'INACTIVE'}</code>", f"Halted symbols <code>{esc(', '.join(sorted(kill.halted_symbols)) or 'ALL')}</code>", f"Actor <code>{esc(actor)}</code>"]
        if action == "resume":
            kill = await gateway.release_kill(actor=actor, symbol=symbol)
            return [f"Kill switch <code>{'ACTIVE' if kill.active else 'INACTIVE'}</code>", f"Halted symbols <code>{esc(', '.join(sorted(kill.halted_symbols)) or 'none')}</code>", f"Actor <code>{esc(actor)}</code>"]

        # flatten — composed from the gateway's own order path, one position at a
        # time so the submissions cannot race its exposure accounting.
        report = self._portfolio_report()
        positions = [
            p for p in report["exposure"]["positions"]
            if p.get("notional") and str(p.get("side")).upper() in {"LONG", "SHORT"}
            and (not symbol or str(p.get("symbol")) == symbol)
        ]
        if not positions:
            return ["Nothing to close — the book is already flat."]

        from modules.schemas import OrderRequest

        lines: list[str] = []
        for position in positions:
            side = "SELL" if str(position["side"]).upper() == "LONG" else "BUY"
            # The same entry point a manual order uses — `gateway.submit`, which
            # returns the full check vector for accepted and rejected orders
            # alike. Routing around it would make flatten a second, unaudited
            # execution path.
            decision = await gateway.submit(
                OrderRequest(
                    symbol=str(position["symbol"]), side=side,
                    notional=abs(float(position["notional"])),
                    order_type="MARKET", strategy="flatten",
                ),
                source=actor,
            )
            mark = "✓" if decision.accepted else "✕"
            blocked = ", ".join(decision.rejected_by) or (decision.reason or "rejected")
            reason = "" if decision.accepted else f" · {esc(str(blocked)[:60])}"
            lines.append(f"{mark} {side} <code>{esc(position['symbol'])}</code> <code>{_money(abs(float(position['notional'])))}</code>{reason}")
        accepted_n = sum(1 for line in lines if line.startswith("✓"))
        lines.append(f"<i>{accepted_n}/{len(lines)} accepted. A rejection is the pre-trade gates firing, not a transport failure.</i>")
        return lines

    async def _cmd_halt(self, args, chat_id, actor) -> None:
        await self._control("halt", args, chat_id, actor)

    async def _cmd_resume(self, args, chat_id, actor) -> None:
        await self._control("resume", args, chat_id, actor)

    async def _cmd_reduceonly(self, args, chat_id, actor) -> None:
        # `on`/`off` chooses the direction; everything after is the same
        # allow-list, challenge and audit path the other controls take.
        wants_off = bool(args) and args[0].lower() in {"off", "false", "0"}
        rest = args[1:] if args and args[0].lower() in {"on", "off", "true", "false", "0", "1"} else args
        await self._control("reduceonly_off" if wants_off else "reduceonly", rest, chat_id, actor)

    async def _cmd_resetbook(self, args, chat_id, actor) -> None:
        await self._control("resetbook", args, chat_id, actor)

    async def _cmd_flatten(self, args, chat_id, actor) -> None:
        await self._control("flatten", args, chat_id, actor)

    async def _cmd_replay(self, args, chat_id, actor) -> None:
        # A control, not a read. It spends provider quota, writes a row to the
        # data-quality ledger, and can escalate from that ledger — three
        # outward effects, which is the line the CODE flow exists to guard.
        await self._control("replay", args, chat_id, actor)

    # ------------------------------------------------------------------ #
    # Quant risk (read-only)
    # ------------------------------------------------------------------ #
    async def _latest_backtest_result(self, symbol: str, strategy: str | None = None) -> dict[str, Any] | None:
        """The newest in-process completed backtest for a symbol, or None.

        Scans the shared jobs engine for a succeeded ``backtest`` whose request
        matches ``symbol`` (and ``strategy`` when given), newest ``finished_at``
        first. Only runs completed *in this process* carry the fold detail —
        ``walk_forward``, ``heatmap_png``, the DSR family — because the audit
        history keeps the headline numbers but not those. Callers fall back to
        the audit rows with an honest note when this returns None.
        """
        jobs = getattr(self.queue, "_jobs", None)
        if not jobs:
            return None
        wanted = symbol.upper()
        best: dict[str, Any] | None = None
        best_at = None
        for job in jobs.values():
            if getattr(job, "kind", None) != "backtest" or getattr(job, "status", None) != "succeeded":
                continue
            result = getattr(job, "result", None)
            if not isinstance(result, dict):
                continue
            request = result.get("request") or {}
            meta = getattr(job, "meta", {}) or {}
            job_symbol = str(request.get("symbol") or meta.get("symbol") or "").upper()
            if job_symbol != wanted:
                continue
            if strategy and str(request.get("strategy") or "").lower() != strategy.lower():
                continue
            finished = getattr(job, "finished_at", None) or getattr(job, "submitted_at", None)
            if best_at is None or (finished is not None and finished > best_at):
                best, best_at = result, finished
        return best

    async def _risk_inputs(self, interval: str, bars: int = 180):
        """
        Bars for every symbol currently held, plus the book they belong to.

        Returns ``(report, covariance, returns_by_symbol)``. The covariance can
        be ``None`` — a flat book has no risk to decompose and too little shared
        history cannot produce one — and callers say which of those happened
        rather than printing zeros. The raw returns come back too, because
        historical VaR and the scenario betas need the series itself, not its
        second moment. ``bars`` bounds the history fetched per symbol.
        """
        from modules.quant_risk import build_covariance, returns_from_closes

        bars = max(60, min(1000, int(bars)))
        report = self._portfolio_report()
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        if not positions:
            return report, None, {}

        returns: dict[str, list[float]] = {}
        held = {str(p["symbol"]) for p in positions[:8]}
        # The scenario reference is fetched even when it is not held: without it
        # every unheld position has no measurable beta and a stress test would
        # report a flat book under a market-wide shock.
        for symbol in sorted(held | {"BTCUSDT"}):
            payload = await self._bars_payload(symbol, interval, bars, "crypto")
            rows = payload.get("data") or [] if payload.get("ok") else []
            closes = [float(r["close"]) for r in rows if _finite(r.get("close")) is not None]
            if len(closes) >= 30:
                returns[symbol] = returns_from_closes(closes)
        held_returns = {s: r for s, r in returns.items() if s in held}
        return report, build_covariance(held_returns, interval), returns

    async def _cmd_var(self, args, chat_id, actor) -> None:
        from modules.quant_risk import historical_var, portfolio_risk

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        switch = kb([_choice_row("var", [(value, value) for value in ("1h", "4h", "1d")], interval)])
        report, cov, returns = await self._risk_inputs(interval)
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card("📉 Portfolio VaR", "NOT MEASURABLE", ["A flat book, or too little shared price history to build a covariance.", "VaR needs at least 30 aligned bars per held symbol."], source="quant_risk", next_commands="/exposure · /positions"), reply_markup=switch)
            return
        lines = [
            f"Book vol    <code>{_percent(risk.annualised_volatility)}</code> annualised",
            f"VaR 95 1d   <code>{_money(risk.var95)}</code> · <code>{_percent(risk.var95 / equity if equity else 0)}</code> of equity",
            f"CVaR 95     <code>{_money(risk.cvar95)}</code> average loss beyond it",
            f"Window      <code>{risk.observations}</code> {interval} bars",
        ]

        # The empirical figure beside the parametric one. Where they diverge is
        # the fat tail the normal assumption cannot see, and that gap is the
        # most useful number on this card.
        empirical = historical_var(report["exposure"]["positions"], returns, equity)
        if empirical:
            lines.append(
                f"Historical  <code>{_money(empirical.var95)}</code> VaR · "
                f"<code>{_money(empirical.cvar95)}</code> CVaR"
            )
            if empirical.var95 > risk.var95 * 1.25:
                lines.append("<i>The empirical tail is materially worse than the normal model — size on the historical figure.</i>")

        budget = settings.var_budget_pct
        if budget > 0 and equity > 0:
            used = risk.var95 / (equity * budget)
            flag = "🔴" if used >= 1.0 else "🟡" if used >= 0.8 else "🟢"
            lines.append(
                f"VaR budget  {flag} <code>{_percent(used)}</code> of "
                f"<code>{_percent(budget)}</code> equity tolerance"
            )

        if risk.diversification_ratio:
            lines.append(f"Diversif.   <code>{_number(risk.diversification_ratio)}x</code> vs the weighted parts")
        lines.append("<i>The budget is advisory: VaR needs history, so it is reported and never used to block an order.</i>")

        # The distribution the two quantiles were read off. Drawn only when the
        # empirical replay ran — the parametric figure alone has no sample to
        # show, and a normal curve here would illustrate the assumption rather
        # than the book.
        charts: list[tuple[str, bytes]] = []
        if empirical and empirical.daily_pnl:
            histogram = generate_histogram_png(
                f"Replayed daily P&L · {empirical.observations} observations",
                list(empirical.daily_pnl),
                "Daily P&L (USD)",
                [("VaR 95", -empirical.var95, "#e8ab3d"), ("CVaR 95", -empirical.cvar95, "#f0737c")],
            )
            if histogram:
                charts.append(("var-distribution", histogram))

        await self.send_media_group(chat_id, charts, caption=text_card("📉 Portfolio VaR", "LIVE BOOK", lines, source="quant_risk · parametric", next_commands="/riskcontrib · /correlation · /stress · /varbacktest"), reply_markup=switch)

    async def _cmd_riskcontrib(self, args, chat_id, actor) -> None:
        from modules.quant_risk import portfolio_risk

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        switch = kb([_choice_row("riskcontrib", [(value, value) for value in _INTERVALS], interval)])
        report, cov, returns = await self._risk_inputs(interval)
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card("🎯 Risk contribution", "NOT MEASURABLE", ["A flat book, or too little shared price history."], source="quant_risk", next_commands="/exposure"), reply_markup=switch)
            return
        lines = ["<b>SYMBOL      NOTIONAL   RISK</b>"]
        for c in risk.contributions:
            tag = " hedge" if c.contribution_share < 0 else ""
            lines.append(f"{esc(c.symbol):<11} <code>{_percent(c.share_of_gross)}</code>  <code>{_percent(c.contribution_share)}</code>{tag}")
        lines.append("<i>Share of notional is not share of risk. A hedge contributes a negative amount.</i>")
        chart = generate_bars_chart_png(
            "Share of portfolio risk by symbol",
            [c.symbol for c in risk.contributions],
            [float(c.contribution_share) * 100 for c in risk.contributions],
            "Risk contribution (%)", horizontal=True, value_fmt="{:,.1f}%",
        )
        await self.send_media_group(chat_id, [("risk-contribution", chart)] if chart else [], caption=text_card("🎯 Risk contribution", f"{risk.observations} {interval.upper()} BARS", lines, source="quant_risk", next_commands="/var · /correlation"), reply_markup=switch)

    async def _cmd_correlation(self, args, chat_id, actor) -> None:
        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        bars = next((max(60, min(1000, int(token))) for token in args if token.isdigit()), 180)
        switch = kb([_choice_row("correlation", [(value, value) for value in _INTERVALS], interval)])
        _, cov, _returns = await self._risk_inputs(interval, bars)
        if not cov or len(cov.symbols) < 2:
            await self.send_message(chat_id, text_card("🔗 Correlation", "NOT MEASURABLE", ["Two or more held symbols with shared history are required."], source="quant_risk", next_commands="/exposure"), reply_markup=switch)
            return
        head = "        " + " ".join(f"{s[:4]:>6}" for s in cov.symbols)
        lines = [f"<code>{esc(head)}</code>"]
        for i, symbol in enumerate(cov.symbols):
            row = " ".join(f"{cov.correlation[i][j]:>6.2f}" for j in range(len(cov.symbols)))
            lines.append(f"<code>{esc(f'{symbol[:6]:<7}')}{esc(row)}</code>")
        worst = max(
            ((cov.correlation[i][j], cov.symbols[i], cov.symbols[j])
             for i in range(len(cov.symbols)) for j in range(i + 1, len(cov.symbols))),
            default=(0.0, "", ""),
        )
        if worst[0] >= 0.8:
            lines.append(f"<i>⚠ {esc(worst[1])} and {esc(worst[2])} at {worst[0]:.2f} — close to one position of their combined size.</i>")
        lines.append(f"<i>Measured over {cov.observations} {interval} bars. Diversification is only real while these stay low.</i>")
        # The text matrix stays: it is the accessible form, and it is what a
        # reader quotes. The heatmap is the glance that finds the hot corner.
        heatmap = generate_heatmap_png(
            f"Correlation · {cov.observations} {interval} bars",
            [symbol[:8] for symbol in cov.symbols],
            [[float(value) for value in row] for row in cov.correlation],
        )
        await self.send_media_group(chat_id, [("correlation", heatmap)] if heatmap else [], caption=text_card("🔗 Correlation", "LIVE BOOK", lines, source="quant_risk", next_commands="/riskcontrib · /var"), reply_markup=switch)

    async def _cmd_rebalance(self, args, chat_id, actor) -> None:
        """Target weights and the trades that would reach them. Read-only."""
        from modules.quant_risk import propose_allocation, rebalance_trades

        # Aliased rather than matched exactly: a phone keyboard is a bad place to
        # type "min_variance", and an unrecognised word falls back to inverse-vol
        # in the engine, which would silently answer a different question from
        # the one that was asked.
        aliases = {
            "ew": "equal_weight", "equalweight": "equal_weight", "equal_weight": "equal_weight",
            "iv": "inverse_vol", "invvol": "inverse_vol", "inverse_vol": "inverse_vol",
            "erc": "equal_risk", "equalrisk": "equal_risk", "equal_risk": "equal_risk",
            "mv": "min_variance", "minvar": "min_variance", "min_variance": "min_variance",
        }
        method = aliases.get(args[0].lower(), "inverse_vol") if args else "inverse_vol"
        report, cov, _returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        proposal = propose_allocation(
            positions, cov, equity, method=method,
            max_symbol_notional=settings.max_symbol_notional_usd,
            max_gross_notional=settings.max_gross_exposure_usd,
        ) if cov else None

        if not proposal:
            await self.send_message(chat_id, text_card(
                "⚖️ Rebalance", "NOT MEASURABLE",
                ["A flat book, or too little shared price history to measure volatility.",
                 "Allocation needs a covariance, and a covariance needs history."],
                source="quant_risk", next_commands="/positions · /var"))
            return

        lines = [f"<b>Method: {esc(proposal.method.replace('_', ' '))}</b>", "",
                 "<b>SYMBOL     NOW  TARGET   DRIFT</b>"]
        for target in proposal.targets:
            cap = " ⚠" if target.clipped_by else ""
            lines.append(
                f"<code>{esc(f'{target.symbol[:9]:<9}')}</code> "
                f"<code>{target.current_weight:>5.0%}</code> "
                f"<code>{target.target_weight:>6.0%}</code> "
                f"<code>{target.drift:>+6.1%}</code>{cap}"
            )

        trades = rebalance_trades(proposal, positions, drift_band=0.05)
        if trades:
            lines += ["", "<b>Trades outside a 5% band</b>"]
            for trade in trades:
                lines.append(
                    f"  {trade['side']} <code>{_money(trade['notional'])}</code> {esc(trade['symbol'])}"
                )
        else:
            lines += ["", "<i>Everything is inside a 5% drift band — trading it would cost more than the drift.</i>"]

        if proposal.clipped:
            lines.append("<i>⚠ A target was capped by a risk limit, so the weights no longer sum to one.</i>")
        lines.append("<i>Risk-based only: no expected return is forecast. This is a proposal, not an instruction — "
                     "nothing here is sent.</i>")

        await self.send_message(chat_id, text_card(
            "⚖️ Rebalance", "PROPOSAL", lines,
            source="quant_risk · risk-based", next_commands="/exposure · /riskcontrib · /stress"))

    async def _cmd_stress(self, args, chat_id, actor) -> None:
        """Scenario loss on the book as it stands, with distance to the halt."""
        from modules.quant_risk import SCENARIOS, apply_scenario, run_scenarios

        requested = args[0].lower() if args else None
        switch = kb([_choice_row(
            "stress",
            [(key.replace("_", " ").title(), key) for key in SCENARIOS] + [("-12%", "-12")],
            requested or "",
        )])
        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        if not positions:
            await self.send_message(chat_id, text_card(
                "🌩 Stress test", "FLAT BOOK",
                ["Nothing is at risk, so every scenario is a zero."],
                source="quant_risk", next_commands="/positions · /var"), reply_markup=switch)
            return

        if requested and requested not in SCENARIOS:
            # A percentage is accepted as an ad-hoc shock, because the question
            # is usually "what if BTC drops 12%" rather than a named regime.
            try:
                move = float(requested.rstrip("%")) / 100.0
                results = [apply_scenario(positions, equity, {"BTCUSDT": move}, returns,
                                          scenario_id="custom", label=f"BTC {move:+.0%}")]
            except ValueError:
                await self.send_message(chat_id, text_card(
                    "🌩 Stress test", "UNKNOWN SCENARIO",
                    [f"Choose one of: <code>{esc(', '.join(SCENARIOS))}</code>",
                     "Or give a percentage, e.g. <code>/stress -12</code>."],
                    source="quant_risk", next_commands="/stress"), reply_markup=switch)
                return
        elif requested:
            spec = SCENARIOS[requested]
            results = [apply_scenario(positions, equity, spec["shocks"], returns,
                                      scenario_id=requested, label=str(spec["label"]))]
        else:
            results = run_scenarios(positions, equity, returns)

        # The number that decides whether a scenario matters: how much of the
        # loss the desk could absorb before the breaker halts it.
        cushion = float(report["risk_budget"]["daily_drawdown"].get("cushion_usd") or 0.0)
        lines = ["<b>SCENARIO             P&amp;L      OF EQUITY</b>"]
        for result in results:
            breach = " 🛑" if cushion > 0 and -result.total_pnl >= cushion else ""
            lines.append(
                f"<code>{esc(f'{result.label[:20]:<20}')}</code> "
                f"<code>{_money(result.total_pnl):>10}</code> "
                f"<code>{_percent(result.total_return):>7}</code>{breach}"
            )

        worst = results[0]
        lines.append("")
        lines.append(f"Cushion to halt <code>{_money(cushion)}</code>")
        if cushion > 0 and -worst.total_pnl >= cushion:
            lines.append(f"<i>🛑 {esc(worst.label)} would trip the drawdown breaker.</i>")
        unsupported = [leg.symbol for leg in worst.legs if leg.basis == "unsupported"]
        assumed = [leg.symbol for leg in worst.legs if leg.basis == "wildcard"]
        if unsupported:
            lines.append(
                f"<i>No measurable beta for {esc(', '.join(sorted(set(unsupported))))} — "
                "left flat, so the total above is understated by whatever they would have moved.</i>"
            )
        if assumed:
            lines.append(
                f"<i>{esc(', '.join(sorted(set(assumed))))} moved on the scenario's blanket shock, "
                "not on a measured beta — an assumption, not a measurement.</i>"
            )
        # Losses as positive bars so the tallest bar is the worst outcome —
        # the shape a reader expects from a stress chart.
        chart = generate_bars_chart_png(
            "Scenario loss on the book as it stands",
            [result.label for result in results],
            [-float(result.total_pnl) for result in results],
            "Loss (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("stress", chart)] if chart else [], caption=text_card(
            "🌩 Stress test", "LIVE BOOK", lines,
            source="quant_risk · measured betas", next_commands="/var · /riskcontrib · /headroom"), reply_markup=switch)

    async def _cmd_varbacktest(self, args, chat_id, actor) -> None:
        """Has the VaR the desk quotes actually been right?"""
        from modules.quant_risk import rolling_var_backtest, rolling_var_path

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        switch = kb([_choice_row("varbacktest", [(value, value) for value in _INTERVALS], interval)])
        report, _cov, returns = await self._risk_inputs(interval)
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        result = rolling_var_backtest(positions, returns, equity) if positions else None

        if not result:
            await self.send_message(chat_id, text_card(
                "🧪 VaR backtest", "NOT MEASURABLE",
                ["A flat book, or fewer than 80 aligned bars per held symbol.",
                 "The forecast is re-fitted on a rolling window and scored on the next bar, "
                 "so it needs history on both sides."],
                source="quant_risk · Kupiec POF", next_commands="/var · /positions"), reply_markup=switch)
            return

        flag = {"green": "🟢", "yellow": "🟡", "red": "🔴"}[result.zone]
        lines = [
            f"Zone        {flag} <code>{result.zone.upper()}</code>",
            f"Exceptions  <code>{result.exceptions}</code> of <code>{result.observations}</code> "
            f"(expected <code>{result.expected_exceptions}</code>)",
            f"Rate        <code>{_percent(result.exception_rate)}</code> vs the 5% claim",
            f"Kupiec p    <code>{_number(result.kupiec_p_value)}</code>",
            "",
            f"<i>{esc(result.verdict)}</i>",
        ]
        # The same rolling forecast the Kupiec test scored, drawn bar-for-bar so a
        # reader can see where the losses broke through the -VaR line.
        path = rolling_var_path(positions, returns, equity)
        chart = generate_var_breach_png(
            f"Rolling VaR backtest · {interval}", *path,
        ) if path else None
        await self.send_media_group(chat_id, [("varbacktest", chart)] if chart else [], caption=text_card(
            "🧪 VaR backtest", "MODEL VALIDATION", lines,
            source="quant_risk · Kupiec POF", next_commands="/var · /stress"), reply_markup=switch)

    async def _cmd_regime(self, args, chat_id, actor) -> None:
        from modules.quant_risk import returns_from_closes, volatility_regime

        symbol, interval, count, asset = self._bar_args(args)
        keyboard = kb([_interval_row("regime", symbol, interval, str(count))])
        payload = await self._bars_payload(symbol, interval, max(count, 120), asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        closes = [float(r["close"]) for r in rows if _finite(r.get("close")) is not None]
        regime = volatility_regime(returns_from_closes(closes), interval=interval) if len(closes) > 45 else None
        if not regime:
            await self.send_message(chat_id, self._openbb_error("regime", payload if not payload.get("ok") else {"error": "at least 45 bars are required"}), reply_markup=keyboard)
            return
        lines = [
            f"Regime      <code>{regime.regime}</code>",
            f"Current vol <code>{_percent(regime.current_vol)}</code> annualised",
            f"Baseline    <code>{_percent(regime.baseline_vol)}</code> · ratio <code>{_number(regime.ratio)}x</code>",
            f"Percentile  <code>{_percent(regime.percentile)}</code> of its own history",
            f"<i>{esc(regime.note)}</i>",
        ]
        await self.send_message(chat_id, text_card(f"🌡 {symbol} volatility regime", f"{regime.observations} WINDOWS · {interval}", lines, source="quant_risk", next_commands=f"/range {symbol} · /var"), reply_markup=keyboard)

    async def _cmd_size(self, args, chat_id, actor) -> None:
        from modules.quant_risk import kelly_fraction

        if len(args) < 2:
            await self.send_message(chat_id, text_card("📐 Position sizing", "USAGE", ["<code>/size WIN_RATE PAYOFF [EQUITY]</code>", "Example <code>/size 0.55 1.8</code>", "Win rate as a fraction, payoff as avg win ÷ avg loss."], source="quant_risk", next_commands="/backtests"))
            return
        try:
            win_rate = float(args[0])
            payoff = float(args[1])
        except ValueError:
            await self.send_message(chat_id, text_card("📐 Position sizing", "BAD INPUT", ["Win rate and payoff must be numbers."], source="quant_risk", next_commands="/help size"))
            return
        equity = float(args[2]) if len(args) > 2 and args[2].replace(".", "", 1).isdigit() else float(self._portfolio_report()["equity"]["current"] or 0.0)
        sizing = kelly_fraction(win_rate, payoff, equity)
        lines = [
            f"Full Kelly  <code>{_percent(sizing.full_kelly)}</code>",
            f"Recommended <code>{_percent(sizing.recommended_fraction)}</code> · <code>{_money(sizing.recommended_notional)}</code>",
            f"Edge/trade  <code>{_number(sizing.edge_per_trade, 3, signed=True)}</code>",
            f"On equity   <code>{_money(equity)}</code>",
            f"<i>{esc(sizing.note)}</i>",
        ]
        await self.send_message(chat_id, text_card("📐 Kelly sizing", "QUARTER KELLY" if not sizing.capped_by else sizing.capped_by.upper().replace("_", " "), lines, source="quant_risk", next_commands="/headroom · /limits"))

    async def _cmd_dislocation(self, args, chat_id, actor) -> None:
        from modules.quant_risk import find_dislocation

        symbol = self._symbol(args)
        books = [
            {
                "venue": b.venue, "ok": bool(b.mid), "best_bid": b.best_bid, "best_ask": b.best_ask,
                # `get_books` returns BookLevel models, not (price, size)
                # tuples. Subscripting them raised TypeError for anyone with
                # two live venues — the exact condition the command exists for,
                # which is why no reachable path ever exercised it.
                "bids": [[lvl.price, lvl.size] for lvl in (b.bids or [])[:1]],
                "asks": [[lvl.price, lvl.size] for lvl in (b.asks or [])[:1]],
            }
            for b in self.tca.get_books(symbol, depth=5)
        ]
        found = find_dislocation(books, symbol)
        if not found:
            await self.send_message(chat_id, text_card(f"⚖ {symbol} dislocation", "NEEDS TWO VENUES", ["Two venues with a live book are required to compare."], source="TCA engine", next_commands="/feedstatus · /venues"))
            return
        if found.crossed:
            lines = [
                f"<b>CROSSED</b> buy <code>{esc(found.buy_venue)}</code> · sell <code>{esc(found.sell_venue)}</code>",
                f"Edge        <code>{_number(found.edge_bps)} bps</code> · <code>{_number(found.edge_usd_per_unit)}</code>/unit",
                f"Executable  <code>{_number(found.executable_size, 4)}</code> units · <code>{_money(found.executable_notional)}</code>",
                f"<i>{esc(found.note)}</i>",
            ]
            state = "CROSSED"
        else:
            lines = [f"Best spread <code>{_number(-found.edge_bps)} bps</code> across venues", f"<i>{esc(found.note)}</i>"]
            state = "NORMAL"
        await self.send_message(chat_id, text_card(f"⚖ {symbol} dislocation", state, lines, source="Cross-venue TCA engine", next_commands=f"/book {symbol} · /tca {symbol} 100000 BUY"))

    async def _cmd_book(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=5) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"📖 {symbol} book", "NO LIVE BOOK", ["No venue currently has a fresh book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = []
        for book in books:
            tag = "SYNTHETIC" if book.synthetic else "LIVE"
            lines += [f"<b>{esc(book.venue)} · {tag}</b>", f"Bid <code>{_number(book.best_bid)}</code> · Ask <code>{_number(book.best_ask)}</code> · Spread <code>{_number(book.spread_bps)} bps</code>", f"Depth5 <code>{_money(book.depth_usd_bid)}</code> / <code>{_money(book.depth_usd_ask)}</code> · Imb <code>{_number(book.imbalance, signed=True)}</code>"]
        await self.send_message(chat_id, text_card(f"📖 {symbol} top of book", "LIVE" if not any(book.synthetic for book in books) else "SYNTHETIC", lines, source="Cross-venue TCA engine", next_commands=f"/spread {symbol} · /depth {symbol} · /tca {symbol} 100000 BUY"))

    async def _cmd_spread(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=5) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"↔️ {symbol} spreads", "NO LIVE BOOK", ["No fresh venue book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"{esc(book.venue):<12} <code>{_number(book.spread_bps)} bps</code>" for book in books]
        best_bid = max(book.best_bid or 0 for book in books)
        best_ask = min(book.best_ask or math.inf for book in books)
        consolidated_mid = (best_bid + best_ask) / 2 if best_ask < math.inf else None
        consolidated = ((best_ask - best_bid) / consolidated_mid * 10_000) if consolidated_mid else None
        lines += ["", f"Best cross-venue bid <code>{_number(best_bid)}</code>", f"Best cross-venue ask <code>{_number(best_ask)}</code>", f"Consolidated spread <code>{_number(consolidated)} bps</code>"]
        await self.send_message(chat_id, text_card(f"↔️ {symbol} spreads", "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/book {symbol} · /route {symbol} 100000 BUY"))

    async def _cmd_depth(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=20) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"🌊 {symbol} depth", "NO LIVE BOOK", ["No fresh venue book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"<b>{esc(book.venue)}</b> · bids <code>{_money(book.depth_usd_bid)}</code> · asks <code>{_money(book.depth_usd_ask)}</code> · imbalance <code>{_number(book.imbalance, signed=True)}</code>" for book in books]
        await self.send_message(chat_id, text_card(f"🌊 {symbol} displayed depth", "LIVE" if not any(book.synthetic for book in books) else "SYNTHETIC", lines, source="Cross-venue TCA engine", next_commands=f"/liquidity {symbol} 100000 · /tca {symbol} 100000 BUY"))

    async def _cmd_tca(self, args, chat_id, actor) -> None:
        symbol, notional, side = self._trade_args(args)
        report = self.tca.tca_report(symbol, side, notional)
        if not report.per_venue:
            await self.send_message(chat_id, text_card(f"📊 {symbol} TCA", "NO LIVE BOOK", ["No execution estimate is available."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"Side / size <code>{side} · {_money(notional)}</code>", f"Mid         <code>{_number(report.consolidated_mid)}</code>", "", "<b>Single venue</b>"]
        for estimate in report.per_venue:
            lines.append(f"{esc(estimate.venue)} · <code>{_number(estimate.slippage_bps, signed=True)} bps</code> · VWAP <code>{_number(estimate.vwap)}</code> · <code>{'fillable' if estimate.fillable else 'partial'}</code>")
        if report.smart_route:
            lines += ["", f"<b>Smart route · {_number(report.smart_route_slippage_bps, signed=True)} bps</b>"]
            for leg in report.smart_route:
                lines.append(f"{esc(leg.venue)} <code>{leg.share_pct:.1f}%</code> · <code>{_money(leg.notional)}</code>")
        await self.send_message(chat_id, text_card(f"📊 {symbol} TCA", "SYNTHETIC" if report.synthetic else "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/route {symbol} {notional:g} {side} · /liquidity {symbol} {notional:g}"))

    async def _cmd_route(self, args, chat_id, actor) -> None:
        symbol, notional, side = self._trade_args(args)
        report = self.tca.tca_report(symbol, side, notional)
        if not report.smart_route:
            await self.send_message(chat_id, text_card(f"🧭 {symbol} route", "NOT FILLABLE", [f"No complete route for <code>{side} {_money(notional)}</code>."], source="TCA engine", next_commands=f"/liquidity {symbol} {notional:g}"))
            return
        lines = [f"Order <code>{side} · {_money(notional)}</code>", f"Blended VWAP <code>{_number(report.smart_route_vwap)}</code>", f"Slippage <code>{_number(report.smart_route_slippage_bps, signed=True)} bps</code>"]
        for leg in report.smart_route:
            lines.append(f"{esc(leg.venue):<12} <code>{leg.share_pct:5.1f}%</code> · <code>{_money(leg.notional)}</code> @ <code>{_number(leg.vwap)}</code>")
        await self.send_message(chat_id, text_card(f"🧭 {symbol} smart route", "SYNTHETIC" if report.synthetic else "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/tca {symbol} {notional:g} {side} · /watch {symbol} {notional:g} 25"))

    async def _cmd_liquidity(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        if notional is None or notional <= 0:
            raise ValueError("notional must be a positive finite number")
        estimate = self.tca.route_estimate(symbol, "BUY", notional)
        if not estimate:
            await self.send_message(chat_id, text_card(f"🌊 {symbol} liquidity", "NO LIVE BOOK", ["No route estimate is available."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"Probe size <code>{_money(notional)}</code>", f"Fillable   <code>{'YES' if estimate.fillable else 'NO'}</code>", f"Routable   <code>{_money(estimate.filled_notional)}</code>", f"Slippage   <code>{_number(estimate.slippage_bps, signed=True)} bps</code>", f"Route      <code>{esc(estimate.venue)}</code>"]
        await self.send_message(chat_id, text_card(f"🌊 {symbol} liquidity", "LIVE" if estimate.fillable else "THIN", lines, source="Cross-venue TCA engine", next_commands=f"/route {symbol} {notional:g} BUY · /watch {symbol} {notional:g} 25"))

    async def _cmd_venues(self, args, chat_id, actor) -> None:
        health = self.tca.health()
        lines = []
        for feed in health.get("feeds", []):
            symbols = feed.get("symbols") or {}
            rate = sum(_finite(value.get("rate_hz")) or 0 for value in symbols.values())
            lines.append(f"{'🟢' if feed.get('connected') else '🔴'} <b>{esc(feed.get('venue'))}</b> · <code>{rate:.0f} upd/s</code> · <code>{feed.get('reconnects', 0)} reconnects</code>")
        await self.send_message(chat_id, text_card("🏛 Execution venues", "SYNTHETIC ACTIVE" if health.get("synthetic_active") else "LIVE FEEDS", lines or ["No feeds configured."], source="TCA engine", next_commands="/feedstatus · /book BTCUSDT"))

    async def _cmd_feedstatus(self, args, chat_id, actor) -> None:
        health = self.tca.health()
        lines = [f"Engine uptime <code>{_number(health.get('uptime_s'), 0)} s</code>", f"Symbols <code>{', '.join(health.get('symbols') or [])}</code>"]
        for feed in health.get("feeds", []):
            lines.append(f"\n<b>{esc(feed.get('venue'))}</b> · <code>{'connected' if feed.get('connected') else 'offline'}</code> · uptime <code>{_number(feed.get('uptime_s'), 0)} s</code>")
            if feed.get("last_error"):
                lines.append(f"Error <code>{esc(str(feed['last_error'])[:180])}</code>")
        await self.send_message(chat_id, text_card("📡 Market-feed health", "SYNTHETIC" if health.get("synthetic_active") else "OBSERVED", lines, source="TCA engine", next_commands="/venues · /status"))

    def _recent_orders(self, args: list[str], accepted: bool | None = None) -> list[dict[str, Any]]:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_orders(max(count * 3, count)) if self.audit else []
        if accepted is not None:
            rows = [row for row in rows if bool(row.get("accepted")) is accepted]
        return rows[:count]

    async def _render_orders(self, chat_id: str, title: str, rows: list[dict[str, Any]], state: str) -> None:
        if not rows:
            await self.send_message(chat_id, text_card(title, "NO RECORDS", ["No matching audit rows."], source="DuckDB audit log", next_commands="/orders"))
            return
        lines = []
        for row in rows:
            icon = "✅" if row.get("accepted") else "❌"
            timestamp = str(row.get("ts") or "")[11:19]
            lines.append(f"{icon} <code>{esc(timestamp)}</code> {esc(row.get('symbol'))} {esc(row.get('side'))} <code>{_money(row.get('notional'))}</code> · <code>{_number(row.get('latency_ms'))} ms</code>")
            if not row.get("accepted"):
                lines.append(f"   ↳ <code>{esc(str(row.get('rejected_by') or row.get('reason') or 'rejected')[:120])}</code>")
        await self.send_message(chat_id, text_card(title, state, lines, source="DuckDB audit log", next_commands="/slippage · /fees · /events"))

    async def _cmd_timeline(self, args, chat_id, actor) -> None:
        """Every transition one order made, from the audit trail.

        Named /timeline rather than /order deliberately: there is no command
        that opens a position, and a name suggesting otherwise would erode a
        boundary the whole design rests on.
        """
        if not args:
            await self.send_message(chat_id, text_card(
                "🧾 Order timeline", "NEEDS AN ORDER ID",
                ["Use <code>/timeline ORDER_ID</code> — /orders lists recent ids."],
                source="audit · order_events", next_commands="/orders · /working",
            ))
            return

        order_id = args[0]
        rows = self.audit.order_timeline(order_id) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card(
                f"🧾 Order {esc(order_id)}", "NOT FOUND",
                ["No order with that id has been recorded on this gateway.",
                 "<i>The audit trail is the record; an unknown id means it never "
                 "reached the gates, not that it was rejected.</i>"],
                source="audit · order_events", next_commands="/orders",
            ))
            return

        lines = ["<b>WHEN      EVENT        STATUS</b>"]
        for row in rows[:20]:
            stamp = str(row.get("ts"))[11:19] or "—"
            lines.append(
                f"<code>{esc(stamp):<9}</code> <code>{esc(str(row.get('event'))[:12]):<12}</code> "
                f"<code>{esc(str(row.get('status') or '—')[:10])}</code>"
            )
        head = rows[0]
        tail = rows[-1]
        lines.append("")
        lines.append(f"Symbol      <code>{esc(head.get('symbol'))}</code> · <code>{esc(head.get('side'))}</code>")
        lines.append(f"Notional    <code>{_money(head.get('notional'))}</code>")
        if tail.get("fill_price"):
            lines.append(f"Filled at   <code>{_number(tail.get('fill_price'), 2)}</code> · fee <code>{_money(tail.get('fee_usd'))}</code>")
        lines.append(f"Actor       <code>{esc(head.get('actor') or 'unknown')}</code>")
        if len(rows) > 20:
            lines.append(f"<i>Showing the first 20 of {len(rows)} events.</i>")

        await self.send_message(chat_id, text_card(
            f"🧾 Order {esc(order_id)}", f"{len(rows)} EVENTS", lines,
            source="audit · order_events", next_commands="/orders · /slippage",
        ))

    async def _cmd_working(self, args, chat_id, actor) -> None:
        """What is still resting on the book — the set a desk can still act on."""
        symbol = args[0].upper() if args else None
        orders = self.gateway.list_working(symbol)
        if not orders:
            await self.send_message(chat_id, text_card(
                "📋 Working orders", "NONE RESTING",
                [f"Nothing open{f' for {esc(symbol)}' if symbol else ''}.",
                 "<i>Terminal decisions live in /orders; this is only what is "
                 "still live.</i>"],
                source="Risk gateway", next_commands="/orders · /positions",
            ))
            return

        lines = ["<b>SYMBOL   SIDE  NOTIONAL     LIMIT</b>"]
        for order in orders[:20]:
            request = getattr(order, "request", None)
            side = getattr(request, "side", "—")
            lines.append(
                f"<code>{esc(str(order.symbol)[:8]):<8}</code> <code>{esc(str(side)):<5}</code>"
                f"<code>{_money(getattr(request, 'notional', None)):>11}</code>  "
                f"<code>{_number(order.limit_price, 2)}</code>"
            )
        lines.append(f"<i>{len(orders)} resting. Cancelling or replacing stays in the "
                     "web blotter — a chat client should not be able to reach into a "
                     "live order queue.</i>")
        await self.send_message(chat_id, text_card(
            "📋 Working orders", f"{len(orders)} RESTING", lines,
            source="Risk gateway", next_commands="/orders · /timeline",
        ))

    async def _cmd_ops(self, args, chat_id, actor) -> None:
        """One internally consistent reliability snapshot, as the web reads it."""
        from modules.operations import build_operations_snapshot

        try:
            snapshot = build_operations_snapshot(
                tca=self.tca, gateway=self.gateway, queue=self.queue,
                audit=self.audit, bot=self,
            )
        except Exception as exc:  # noqa: BLE001 — reported, never guessed at
            await self.send_message(chat_id, text_card(
                "🩺 Operations", "SNAPSHOT FAILED", [esc(str(exc)[:200])],
                source="operations", next_commands="/status",
            ))
            return

        flag = {"ok": "🟢", "degraded": "🟡", "critical": "🔴"}
        risk = snapshot.risk
        queue_state = snapshot.queue
        lines = [
            f"Platform    {flag.get(str(snapshot.status), '⚪')} <code>{esc(str(snapshot.status).upper())}</code>",
            f"Build       <code>{esc(snapshot.version)}</code> · <code>{esc(snapshot.environment)}</code>",
            "",
            f"Risk        <code>{esc(str(risk.status).upper())}</code> · kill switch "
            f"<code>{'ACTIVE' if risk.kill_switch_active else 'INACTIVE'}</code>"
            + (" · <code>REDUCE-ONLY</code>" if risk.reduce_only else ""),
            f"Orders      <code>{risk.orders_accepted_total}</code> accepted · "
            f"<code>{risk.orders_rejected_total}</code> rejected",
            f"Queue       <code>{esc(queue_state.backend)}</code> · "
            f"<code>{queue_state.workers}</code> workers · <code>{queue_state.total}</code> jobs",
            f"Market data <code>{esc(str(snapshot.market_data.status).upper())}</code>",
            f"Audit       <code>{esc(snapshot.audit.backend)}</code> · "
            f"<code>{'AVAILABLE' if snapshot.audit.available else 'UNAVAILABLE'}</code>",
        ]
        if risk.halted_symbols:
            lines.append(f"Halted      <code>{esc(', '.join(risk.halted_symbols))}</code>")
        lines.append(
            "<i>One process-local snapshot: this gateway's own view, not a fleet "
            "aggregate. Every panel above was read in the same instant.</i>"
        )
        await self.send_message(chat_id, text_card(
            "🩺 Operations", "MEASURED", lines,
            source="operations snapshot", next_commands="/status · /reliability · /incidents",
        ))

    async def _cmd_orders(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "🧾 Gateway decisions", self._recent_orders(args), "AUDIT LOG")

    async def _cmd_fills(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "✅ Accepted fills", self._recent_orders(args, True), "AUDIT LOG")

    async def _cmd_rejections(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "❌ Rejected orders", self._recent_orders(args, False), "AUDIT LOG")

    async def _cmd_slippage(self, args, chat_id, actor) -> None:
        stats = self.audit.execution_stats() if self.audit else {}
        lines = [f"Accepted orders <code>{stats.get('accepted') or 0}</code>", f"Average slip   <code>{_number(stats.get('avg_slippage_bps'), signed=True)} bps</code>", f"Average latency <code>{_number(stats.get('avg_latency_ms'))} ms</code>", f"Max latency     <code>{_number(stats.get('max_latency_ms'))} ms</code>"]
        await self.send_message(chat_id, text_card("📉 Execution slippage", "AUDIT AGGREGATE", lines, source="DuckDB audit log", next_commands="/tca BTCUSDT 100000 BUY · /orders"))

    async def _cmd_fees(self, args, chat_id, actor) -> None:
        stats = self.audit.execution_stats() if self.audit else {}
        lines = [f"Total fees <code>{_money(stats.get('total_fees'))}</code>", f"Orders     <code>{stats.get('total') or 0}</code>", f"Accepted   <code>{stats.get('accepted') or 0}</code>"]
        await self.send_message(chat_id, text_card("💸 Execution fees", "AUDIT AGGREGATE", lines, source="DuckDB audit log", next_commands="/attribution · /fills"))

    # ------------------------------------------------------------------ #
    # Research / audit monitoring
    # ------------------------------------------------------------------ #
    async def _cmd_research_status(self, args, chat_id, actor) -> None:
        from modules import research

        openbb = await research.openbb_status_async()
        queue = self.queue.stats() if self.queue else {}
        lines = [f"OpenBB <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>", f"Provider <code>{esc(openbb.get('provider') or '—')}</code>", f"Queue backend <code>{esc(queue.get('backend') or '—')}</code>", f"Workers <code>{queue.get('workers') or 0}</code>", f"Jobs <code>{queue.get('total') or 0}</code>"]
        await self.send_message(chat_id, text_card("🧪 Research systems", "MONITORING ONLY", lines, source="OpenBB + job queue", next_commands="/jobs · /backtests · /snapshot AAPL"))

    async def _cmd_jobs(self, args, chat_id, actor) -> None:
        count = self._limit(args, 0, 10, 25)
        jobs = self.queue.list(count) if self.queue else []
        if not jobs:
            await self.send_message(chat_id, text_card("🗂 Research jobs", "EMPTY", ["No research jobs recorded."], source="Job queue", next_commands="/researchstatus"))
            return
        icons = {"queued": "⏳", "running": "⚙️", "succeeded": "✅", "failed": "❌", "cancelled": "⛔"}
        lines = [f"{icons.get(job.status, '•')} <code>{job.job_id}</code> {esc(job.kind)} · <code>{esc(job.status)}</code> · <code>{job.progress:.0%}</code>" for job in jobs]
        await self.send_message(chat_id, text_card("🗂 Research jobs", "READ-ONLY MONITOR", lines, source=f"{self.queue.backend} job queue", next_commands="/job JOB_ID · /backtests"))

    async def _cmd_job(self, args, chat_id, actor) -> None:
        if not args:
            raise ValueError("usage: /job JOB_ID")
        job = self.queue.get(args[0]) if self.queue else None
        if not job:
            await self.send_message(chat_id, text_card("🗂 Research job", "NOT FOUND", [f"Unknown job <code>{esc(args[0])}</code>."], source="Job queue", next_commands="/jobs"))
            return
        lines = [f"ID       <code>{esc(job.job_id)}</code>", f"Kind     <code>{esc(job.kind)}</code>", f"Status   <code>{esc(job.status)}</code>", f"Progress <code>{job.progress:.0%}</code>", f"Backend  <code>{esc(job.backend)}</code>"]
        if job.message:
            lines.append(f"Message <code>{esc(job.message)}</code>")
        if job.error:
            lines.append(f"Error <code>{esc(str(job.error)[:220])}</code>")
        await self.send_message(chat_id, text_card("🗂 Research job", job.status.upper(), lines, source="Job queue", next_commands="/jobs · /backtests"))

    async def _cmd_backtest(self, args, chat_id, actor) -> None:
        """Queue a sweep on the same jobs engine the API and the web use.

        The boundary this crosses is research, not execution: it submits work
        to `queue`, never an order to `gateway`. `/flatten` remains the only
        command that can move the book, and it still goes through every
        pre-trade gate to do it.
        """
        from modules.backtester import run_backtest
        from modules.schemas import BacktestRequest

        symbol = self._symbol(args)
        rest = [token.lower() for token in args[1:]] if len(args) > 1 else []
        interval = next((token for token in rest if token in {"15m", "1h", "4h", "1d"}), "1h")
        strategy = next((token for token in rest if token not in {"15m", "1h", "4h", "1d"}), None)

        try:
            request = BacktestRequest(
                symbol=symbol,
                interval=interval,
                **({"strategy": strategy} if strategy else {}),
                notify_chat_id=str(chat_id),
            )
        except Exception as exc:  # pydantic states the allowed values itself
            await self.send_message(chat_id, text_card(
                "🧪 Backtest", "REJECTED",
                [f"<code>{esc(str(exc)[:300])}</code>",
                 "<i>/strategies lists every strategy this engine accepts.</i>"],
                source="schemas.BacktestRequest", next_commands="/strategies · /intervals",
            ))
            return

        record = self.queue.submit(
            "backtest", run_backtest, request.model_dump(),
            meta={"chat_id": str(chat_id), "symbol": request.symbol, "actor": actor},
        )

        subscribed = any(
            str(sub.get("chat_id")) == str(chat_id) for sub in self._subscribers()
        )
        lines = [
            f"Job         <code>{esc(record.job_id)}</code>",
            f"Symbol      <code>{esc(request.symbol)}</code> · <code>{esc(request.interval)}</code>",
            f"Strategy    <code>{esc(request.strategy)}</code>",
            f"Backend     <code>{esc(record.backend)}</code>",
            "",
            "<i>The result pushes to this chat when it lands.</i>" if subscribed else
            "<i>This chat is not subscribed, so nothing will be pushed — "
            "run /subscribe, or poll with /job.</i>",
        ]
        await self.send_message(chat_id, text_card(
            "🧪 Backtest queued", "ACCEPTED", lines,
            source="jobs engine", next_commands=f"/job {record.job_id} · /backtests",
        ))

    async def _cmd_rag(self, args, chat_id, actor) -> None:
        """Similarity search over the desk's own history, not the open web."""
        from modules.research_rag import get_rag

        query = " ".join(args).strip()
        if not query:
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "NEEDS A QUERY",
                ["Describe what you are looking for, e.g. "
                 "<code>/rag momentum drawdown</code>."],
                source="research corpus", next_commands="/backtests · /incidents",
            ))
            return

        result = await get_rag().search(query, match_count=3)
        state = result.get("state")
        if state == "unavailable":
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "INDEX UNAVAILABLE",
                ["The corpus is not configured or cannot be reached.",
                 "<i>Unavailable is a state, not an empty result — this is not "
                 "the same as finding nothing.</i>"],
                source="research corpus", next_commands="/researchstatus",
            ))
            return
        if state == "embed_failed":
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "EMBEDDING FAILED",
                ["The query could not be embedded, so nothing was searched.",
                 "<i>Reported rather than returned as no matches.</i>"],
                source="research corpus", next_commands="/researchstatus",
            ))
            return

        matches = result.get("matches") or []
        if not matches:
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "NOTHING SIMILAR",
                [f"Nothing in the corpus resembles <code>{esc(query)}</code>.",
                 "<i>The index answered; it holds no comparable run or incident.</i>"],
                source="research corpus", next_commands="/backtests",
            ))
            return

        lines: list[str] = []
        for match in matches:
            similarity = _finite(match.get("similarity"))
            lines.append(
                f"<b>{esc(str(match.get('title') or match.get('kind') or 'record'))}</b>"
                + (f" · <code>{similarity * 100:.0f}%</code>" if similarity is not None else "")
            )
            occurred = match.get("occurred_at")
            detail = str(match.get("summary") or match.get("detail") or "").strip()
            if detail:
                lines.append(esc(detail[:220]))
            if occurred:
                lines.append(f"<i>{esc(str(occurred)[:19])}</i>")
            lines.append("")
        lines.append("<i>Similarity is over this account's own backtests, execution "
                     "summaries and incidents — never the open web.</i>")
        await self.send_message(chat_id, text_card(
            f"🧠 Desk recall · {esc(query[:40])}", f"{len(matches)} MATCHES", lines,
            source="research corpus · pgvector", next_commands="/backtests · /incidents",
        ))

    def _newest_backtest_result(self) -> dict[str, Any] | None:
        """The newest succeeded backtest completed in THIS process, any symbol."""
        jobs = getattr(self.queue, "_jobs", None)
        if not jobs:
            return None
        best: dict[str, Any] | None = None
        best_at = None
        for job in jobs.values():
            if getattr(job, "kind", None) != "backtest" or getattr(job, "status", None) != "succeeded":
                continue
            result = getattr(job, "result", None)
            if not isinstance(result, dict):
                continue
            finished = getattr(job, "finished_at", None) or getattr(job, "submitted_at", None)
            if best_at is None or (finished is not None and finished > best_at):
                best, best_at = result, finished
        return best

    @staticmethod
    def _dsr_colour(dsr: Any) -> str:
        """Green when the deflated Sharpe clears promotion, amber near it, red below."""
        value = _finite(dsr)
        if value is None:
            return "#94a3b8"
        if value >= 0.95:
            return "#00e676"
        if value >= 0.8:
            return "#f59e0b"
        return "#ff5252"

    async def _cmd_backtests(self, args, chat_id, actor) -> None:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_backtests(count) if self.audit else []
        newest = self._newest_backtest_result()
        if not rows and not newest:
            await self.send_message(chat_id, text_card("🧪 Backtest history", "EMPTY", ["No completed backtests in the audit log, and none queued in this process."], source="DuckDB audit log", next_commands="/researchstatus"))
            return

        lines = []
        for row in rows:
            lines.append(f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('symbol'))} {esc(row.get('strategy'))} · Sharpe <code>{_number(row.get('sharpe'))}</code> · DSR <code>{_number(row.get('dsr'), 3)}</code> · OOS <code>{_number(row.get('oos_sharpe'))}</code>")
        if not rows:
            request = newest.get("request") or {}
            lines.append(
                f"No run is in the audit log yet, but one completed in this process: "
                f"<code>{esc(request.get('symbol'))} · {esc(request.get('strategy'))}</code>. "
                "Its equity curve is below."
            )

        # Sharpe by run, coloured by the DSR verdict — a run that overfits and one
        # that generalises are the same height until the colour separates them.
        bars = generate_bars_chart_png(
            "Sharpe by run · colour = DSR (green≥0.95, amber≥0.8, red below)",
            [f"{row.get('symbol')} {row.get('strategy')}"[:18] for row in rows],
            [_finite(row.get("sharpe")) for row in rows],
            "Sharpe",
            colours=[self._dsr_colour(row.get("dsr")) for row in rows],
            horizontal=True, value_fmt="{:.2f}",
        )

        # The newest in-process run carries its own rendered equity curve; the
        # audit history does not, so this hero photo only appears for a run this
        # process actually completed.
        hero = self._decode_b64png(newest.get("equity_curve_png")) if newest else None

        charts: list[tuple[str, bytes]] = []
        if hero:
            charts.append(("equity-curve", hero))
        if bars:
            charts.append(("sharpe", bars))

        await self.send_media_group(chat_id, charts, caption=text_card(
            "🧪 Backtest history", "READ-ONLY AUDIT", lines,
            source="DuckDB audit log", next_commands="/strategies · /walkforward BTCUSDT · /jobs",
        ))

    async def _cmd_strategies(self, args, chat_id, actor) -> None:
        from typing import get_args

        from modules.schemas import BacktestRequest

        strategies = [str(value) for value in get_args(BacktestRequest.model_fields["strategy"].annotation)]

        if args:
            # One strategy: its grid size and the runs of it the desk has recorded.
            requested = args[0].lower()
            if requested not in strategies:
                await self.send_message(chat_id, text_card(
                    "🧠 Strategy", "UNKNOWN",
                    [f"<code>{esc(requested)}</code> is not one of the {len(strategies)} the schema accepts.",
                     "Send <code>/strategies</code> for the full catalogue."],
                    source="Backtest request schema", next_commands="/strategies"))
                return
            request = BacktestRequest(strategy=requested)
            fast_n = len(range(request.fast_min, request.fast_max + 1, request.fast_step))
            slow_n = len(range(request.slow_min, request.slow_max + 1, request.slow_step))
            runs = [
                row for row in (self.audit.recent_backtests(50) if self.audit else [])
                if str(row.get("strategy") or "").lower() == requested
            ]
            lines = [
                f"Strategy    <code>{esc(requested)}</code>",
                f"Grid        <code>{fast_n * slow_n}</code> combinations "
                f"(<code>{fast_n}×{slow_n}</code> fast×slow at default steps)",
                f"Recent runs <code>{len(runs)}</code> in the audit log",
            ]
            for row in runs[:8]:
                lines.append(
                    f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('symbol'))}"
                    f" · Sharpe <code>{_number(row.get('sharpe'))}</code> · DSR <code>{_number(row.get('dsr'), 3)}</code>"
                )
            if not runs:
                lines.append("<i>No run of this strategy is in the audit log yet — queue one below.</i>")
            await self.send_message(chat_id, text_card(
                f"🧠 {requested}", "STRATEGY", lines,
                source="Backtest request schema + audit",
                next_commands=f"/backtest BTCUSDT 1h {requested} · /strategies"))
            return

        # The whole catalogue, grouped by the suffix family it belongs to, read
        # straight from the schema Literal rather than a hand-kept list of three.
        families: dict[str, list[str]] = {}
        for name in strategies:
            family = name.rsplit("_", 1)[-1] if "_" in name else name
            families.setdefault(family, []).append(name)
        lines = [f"<b>{len(strategies)} strategies</b>, grouped by family:", ""]
        for family in sorted(families):
            lines.append(f"<b>{esc(family)}</b> · <code>{esc(', '.join(families[family]))}</code>")
        lines += [
            "",
            "Queue one with <code>/backtest SYMBOL INTERVAL STRATEGY</code>, or send "
            "<code>/strategies NAME</code> for its grid size and recent runs.",
        ]
        await self.send_message(chat_id, text_card(
            "🧠 Strategy catalogue", f"{len(strategies)} STRATEGIES", lines,
            source="Backtest request schema", next_commands="/backtests · /backtest BTCUSDT 1h ma_cross"))

    async def _cmd_intervals(self, args, chat_id, actor) -> None:
        lines = ["OpenBB market data <code>15m · 1h · 4h · 1d</code>", "Backtests <code>1m · 5m · 15m · 1h · 4h · 1d</code>", "", "Intraday history availability depends on the upstream provider window."]
        await self.send_message(chat_id, text_card("⏱ Supported intervals", "REFERENCE", lines, source="OpenBB + backtest schemas", next_commands="/bars AAPL 1d 5 · /trend AAPL 1d 20"))

    # ------------------------------------------------------------------ #
    # Research fold detail (in-process backtest results)
    # ------------------------------------------------------------------ #
    def _inprocess_fallback(self, symbol: str) -> tuple[str, list[str]]:
        """The honest note when no run for a symbol completed in this process.

        Fold detail lives only on runs completed here, so this states that and
        shows the audit history's headline numbers when there are any — never a
        blank that reads as "nothing was ever run".
        """
        rows = [
            row for row in (self.audit.recent_backtests(50) if self.audit else [])
            if str(row.get("symbol") or "").upper() == symbol.upper()
        ]
        lines = [
            "Fold detail (walk-forward, the parameter heatmap, the DSR family) is kept only "
            "for runs completed in this process; queue one with "
            f"<code>/backtest {esc(symbol)} 1h ma_cross</code>.",
        ]
        if rows:
            lines.append("")
            lines.append("<b>Audit history — headline numbers only</b>")
            for row in rows[:6]:
                lines.append(
                    f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('strategy'))}"
                    f" · Sharpe <code>{_number(row.get('sharpe'))}</code>"
                    f" · DSR <code>{_number(row.get('dsr'), 3)}</code>"
                    f" · OOS <code>{_number(row.get('oos_sharpe'))}</code>"
                )
        else:
            lines.append("")
            lines.append("<i>No run for this symbol in the audit log either.</i>")
        return "NOT IN THIS PROCESS", lines

    async def _cmd_walkforward(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Overfit", cb("overfit", symbol)), ("Stability", cb("stability", symbol)), ("Runs", cb("backtests"))],
            _symbol_row("walkforward", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"🔁 Walk-forward · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /backtests"), reply_markup=footer)
            return
        folds = result.get("walk_forward") or []
        request = result.get("request") or {}
        lines = [
            f"Study      <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Folds      <code>{len(folds)}</code> · aggregate OOS Sharpe <code>{_number(result.get('walk_forward_oos_sharpe'))}</code>",
            "",
            "<b>FOLD   IS      OOS</b>",
        ]
        for fold in folds:
            lines.append(
                f"<code>{esc(str(fold.get('fold'))):<4}</code> "
                f"<code>{_number(fold.get('is_sharpe'))}</code>  <code>{_number(fold.get('oos_sharpe'))}</code>"
            )
        lines.append("<i>In-sample beside out-of-sample: a fold whose OOS bar collapses next to its IS bar was fitted to its own training window.</i>")
        chart = generate_paired_bars_png(
            f"Walk-forward IS vs OOS Sharpe · {symbol}",
            [f"F{fold.get('fold')}" for fold in folds],
            [_finite(fold.get("is_sharpe")) for fold in folds],
            [_finite(fold.get("oos_sharpe")) for fold in folds],
            "In-sample", "Out-of-sample", "Sharpe",
        )
        await self.send_media_group(chat_id, [("walkforward", chart)] if chart else [], caption=text_card(
            f"🔁 Walk-forward · {esc(symbol)}", "IN-PROCESS RESULT", lines,
            source="jobs engine · walk_forward", next_commands=f"/overfit {symbol} · /stability {symbol}"), reply_markup=footer)

    async def _cmd_stability(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Walk-forward", cb("walkforward", symbol)), ("Overfit", cb("overfit", symbol)), ("Runs", cb("backtests"))],
            _symbol_row("stability", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"🗺 Stability · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /backtests"), reply_markup=footer)
            return
        top = result.get("top_results") or []
        best = result.get("best") or {}
        request = result.get("request") or {}
        lines = [
            f"Study    <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Best     <code>{best.get('fast')}/{best.get('slow')}</code> · Sharpe <code>{_number(best.get('sharpe'))}</code>",
            f"Combos   <code>{result.get('combos_tested')}</code> tested",
            "",
            "<b>TOP PARAMS   FAST/SLOW  SHARPE</b>",
        ]
        for row in top[:6]:
            lines.append(f"<code>{row.get('fast')}/{row.get('slow')}</code>  <code>{_number(row.get('sharpe'))}</code>")
        lines.append("<i>The heatmap is the run's own rendering — a broad bright plateau is a stable region; a lone bright cell is a parameter that got lucky.</i>")
        hero = self._decode_b64png(result.get("heatmap_png"))
        if hero is None:
            lines.append("<i>This run recorded no heatmap image.</i>")
        await self.send_media_group(chat_id, [("heatmap", hero)] if hero else [], caption=text_card(
            f"🗺 Stability · {esc(symbol)}", "IN-PROCESS RESULT", lines,
            source="jobs engine · parameter grid", next_commands=f"/walkforward {symbol} · /overfit {symbol}"), reply_markup=footer)

    async def _cmd_overfit(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Walk-forward", cb("walkforward", symbol)), ("Stability", cb("stability", symbol)), ("Decision", cb("decision", symbol))],
            _symbol_row("overfit", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"🎲 Overfit · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /backtests"), reply_markup=footer)
            return
        request = result.get("request") or {}
        lines = [
            f"Study     <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"DSR       <code>{_number(result.get('deflated_sharpe_ratio'), 3)}</code> · verdict <code>{esc(result.get('dsr_verdict') or '—')}</code>",
            f"PSR       <code>{_number(result.get('probabilistic_sharpe_ratio'), 3)}</code>",
            f"PBO       <code>{_percent(result.get('overfitting_probability'))}</code> probability of backtest overfitting",
            f"Min track <code>{_number(result.get('min_track_record_bars'), 0)}</code> bars for the Sharpe to be believed",
        ]
        folds = result.get("walk_forward") or []
        labels, values = [], []
        for fold in folds:
            rank = _finite(fold.get("oos_rank"))
            total = _finite(fold.get("combos_ranked"))
            if rank is None or not total or total <= 0:
                continue
            labels.append(f"F{fold.get('fold')}")
            values.append(rank / total * 100)
        lines.append("<i>Per-fold OOS rank of the in-sample-best parameters. 50% is a coin flip — a candidate that did not generalise sits near it.</i>")
        chart = generate_bars_chart_png(
            "OOS rank percentile per fold · 50% = coin flip", labels, values,
            "Percentile (%)", horizontal=True, value_fmt="{:.0f}%",
        )
        await self.send_media_group(chat_id, [("overfit", chart)] if chart else [], caption=text_card(
            f"🎲 Overfit · {esc(symbol)}", "IN-PROCESS RESULT", lines,
            source="jobs engine · DSR/PSR/PBO", next_commands=f"/decision {symbol} · /walkforward {symbol}"), reply_markup=footer)

    async def _cmd_decision(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Overfit", cb("overfit", symbol)), ("Walk-forward", cb("walkforward", symbol)), ("Gates", cb("gates", symbol))],
            _symbol_row("decision", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"⚖️ Decision · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /overfit {symbol}"), reply_markup=footer)
            return
        request = result.get("request") or {}
        dsr = _finite(result.get("deflated_sharpe_ratio"))
        oos = _finite(result.get("walk_forward_oos_sharpe"))
        pbo = _finite(result.get("overfitting_probability"))
        bars = _finite(request.get("bars")) or _finite(result.get("bars"))
        min_track = _finite(result.get("min_track_record_bars"))

        checks = [
            ("DSR ≥ 0.95", dsr is not None and dsr >= 0.95),
            ("OOS Sharpe > 0", oos is not None and oos > 0),
            ("PBO < 0.5", pbo is not None and pbo < 0.5),
            ("Bars ≥ min track", bars is not None and min_track is not None and bars >= min_track),
        ]
        promote = all(ok for _, ok in checks)
        lines = [
            f"Candidate <code>{esc(request.get('symbol'))} · {esc(request.get('strategy'))}</code>",
            f"DSR ≥ 0.95        {'✅' if checks[0][1] else '❌'} <code>{_number(dsr, 3)}</code>",
            f"OOS Sharpe &gt; 0    {'✅' if checks[1][1] else '❌'} <code>{_number(oos)}</code>",
            f"PBO &lt; 0.5         {'✅' if checks[2][1] else '❌'} <code>{_percent(pbo)}</code>",
            f"Bars ≥ min track  {'✅' if checks[3][1] else '❌'} <code>{_number(bars, 0)}</code> / <code>{_number(min_track, 0)}</code>",
        ]

        # Sizing — read the live caps the order would meet, not a recomputation.
        ladder_gates: list[tuple[str, float | None, float | None, bool]] = []
        state = self.gateway.state() if self.gateway else None
        if state is not None:
            sym_cap = _finite(state.limits.get("max_symbol_notional_usd"))
            held = next((p for p in state.positions if p.symbol == symbol), None)
            held_notional = abs(held.notional) if held else 0.0
            remaining = (sym_cap - held_notional) if sym_cap else None
            lines += [
                "",
                f"Verdict           <code>{'PROMOTE' if promote else 'HOLD'}</code>",
                f"Symbol limit left <code>{_money(remaining)}</code> of <code>{_money(sym_cap)}</code>",
                f"Max order notional <code>{_money(state.limits.get('max_order_notional_usd'))}</code>",
                "<i>Kelly payoff is not recorded on a run — use <code>/size WIN PAYOFF</code> for the fraction.</i>",
            ]
            if pbo is not None:
                ladder_gates.append(("PBO vs 0.5", pbo, 0.5, pbo < 0.5))
            if sym_cap:
                ladder_gates.append(("Symbol notional", held_notional, sym_cap, held_notional <= sym_cap))
        chart = generate_gate_ladder_png(f"Sizing headroom · {symbol}", ladder_gates)
        await self.send_media_group(chat_id, [("decision", chart)] if chart else [], caption=text_card(
            f"⚖️ Decision · {esc(symbol)}", "PROMOTE" if promote else "HOLD", lines,
            source="jobs engine + gateway limits", next_commands=f"/overfit {symbol} · /gates {symbol} · /size 0.55 1.8"), reply_markup=footer)

    # ------------------------------------------------------------------ #
    # Execution / operations analytics (read-only)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _decode_b64png(encoded: Any) -> bytes | None:
        """Decode a base64 chart, or None when it is absent or malformed."""
        if not encoded:
            return None
        try:
            return base64.b64decode(encoded)
        except Exception:
            return None

    async def _cmd_lineage(self, args, chat_id, actor) -> None:
        from modules import metrics, research

        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        connected = sum(1 for feed in feeds if feed.get("connected"))
        books = [book for book in (self.tca.get_books(symbol, depth=5) if self.tca else []) if book.mid]
        synthetic = any(getattr(book, "synthetic", False) for book in books)
        state = self.gateway.state() if self.gateway else None
        decisions = metrics.decision_latency_summary()
        audit_health = self.audit.health() if self.audit else {}
        mirror_on = bool(getattr(settings, "supabase_url", "") or "")

        def feed_status() -> str:
            if not feeds:
                return "unknown"
            if connected == len(feeds):
                return "ok"
            return "degraded" if connected else "down"

        def gate_status() -> str:
            if state is None:
                return "unknown"
            if state.kill_switch_active:
                return "down"
            return "degraded" if getattr(state, "reduce_only", False) else "ok"

        stages = [
            ("OpenBB", "ok" if openbb.get("ok") else "down", "research feed"),
            ("Feeds", feed_status(), f"{connected}/{len(feeds)} live"),
            ("Book", ("down" if not books else "degraded" if synthetic else "ok"), f"{len(books)} venue(s)"),
            ("Gates", gate_status(), "17 pre-trade"),
            ("Decisions", "ok" if decisions.get("samples") else "unknown", f"{int(decisions.get('samples') or 0)} timed"),
            ("Audit", "ok" if audit_health.get("available") else "down", str(audit_health.get("backend") or "—")),
            ("Mirror", "ok" if mirror_on else "unknown", "supabase" if mirror_on else "local only"),
        ]
        lines = [
            f"<code>{esc(label):<10}</code> <code>{esc(status.upper())}</code> · {esc(detail)}"
            for label, status, detail in stages
        ]
        lines.append("<i>The path a signal takes from provider to durable record. A degraded or down stage marks where it would stall.</i>")
        chart = generate_pipeline_png(f"Signal path · {symbol}", stages)
        await self.send_media_group(chat_id, [("lineage", chart)] if chart else [], caption=text_card(
            f"🧬 Lineage · {esc(symbol)}", "TOPOLOGY", lines,
            source="TCA + gateway + metrics + audit", next_commands=f"/latency · /gates {symbol} · /status"),
            reply_markup=kb([_symbol_row("lineage", symbol)]))

    async def _cmd_gates(self, args, chat_id, actor) -> None:
        """A read-only preview of the 17 pre-trade gates. Submits nothing.

        Every number here is read from current state — limits, the live mark,
        gross exposure, projected notionals, the drawdown, a route estimate. No
        token is consumed, no counter moves, no audit row is written: it is the
        headroom the next order WOULD meet, not an order.
        """
        symbol = self._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else float(settings.default_probe_notional)
        if notional is None or notional <= 0:
            notional = float(settings.default_probe_notional)
        side = args[2].upper() if len(args) > 2 else "BUY"
        if side not in {"BUY", "SELL"}:
            side = "BUY"
        notional_arg = str(int(notional))

        state = self.gateway.state() if self.gateway else None
        mark = self.gateway.mark(symbol) if self.gateway else None
        if mark is None and self.tca:
            mark = self.tca.consolidated_mid(symbol)
        limits = state.limits if state else {}

        numeric: list[tuple[str, float | None, float | None, bool]] = []
        bool_lines: list[str] = []
        if state is not None:
            bool_lines.append(f"kill_switch      {'❌' if state.kill_switch_active else '✅'} <code>{'engaged' if state.kill_switch_active else 'disengaged'}</code>")
            halted = symbol in (state.halted_symbols or [])
            bool_lines.append(f"symbol_halt      {'❌' if halted else '✅'} <code>{esc(symbol)}</code>")
        bool_lines.append(f"price_available  {'✅' if mark else '❌'} <code>{('mark ' + _number(mark)) if mark else 'no live mark'}</code>")

        order_cap = _finite(limits.get("max_order_notional_usd"))
        if order_cap:
            numeric.append(("max_order_notional", notional, order_cap, notional <= order_cap))
        qty = (notional / mark) if mark else None
        if qty is not None and self.gateway:
            signed_qty = qty * (1 if side == "BUY" else -1)
            projected_sym = self.gateway.projected_symbol_notional(symbol, signed_qty, mark)
            sym_cap = _finite(limits.get("max_symbol_notional_usd"))
            if sym_cap:
                numeric.append(("symbol_concentration", projected_sym, sym_cap, projected_sym <= sym_cap))
            gross_cap = _finite(limits.get("max_gross_exposure_usd"))
            if gross_cap:
                projected_gross = self.gateway.gross_exposure() - self.gateway.symbol_notional(symbol) + projected_sym
                numeric.append(("gross_exposure", projected_gross, gross_cap, projected_gross <= gross_cap))
        if state is not None:
            dd = self.gateway.daily_drawdown_pct()
            dd_cap = _finite(limits.get("max_daily_drawdown_pct"))
            if dd_cap:
                numeric.append(("daily_drawdown", dd, dd_cap, dd < dd_cap))
            rate_cap = _finite(limits.get("max_orders_per_sec"))
            if rate_cap:
                numeric.append(("rate_limit", state.orders_last_second, rate_cap, state.orders_last_second < rate_cap))
            working_cap = _finite(getattr(settings, "max_working_orders", None))
            if working_cap:
                numeric.append(("working_book", float(state.working_orders), working_cap, state.working_orders < working_cap))

        est = self.tca.route_estimate(symbol, side, notional) if self.tca else None
        slip_cap = _finite(limits.get("max_est_slippage_bps"))
        if est is None:
            bool_lines.append("est_slippage     ❌ <code>no routable liquidity</code>")
        elif not est.fillable:
            bool_lines.append(f"est_slippage     ❌ <code>only {_money(est.filled_notional)} routable</code>")
        elif est.slippage_bps is not None and slip_cap:
            numeric.append(("est_slippage", est.slippage_bps, slip_cap, est.slippage_bps <= slip_cap))
        if self.gateway and self.gateway.reduce_only_active():
            bool_lines.append("reduce_only      ⚠️ <code>only risk-reducing orders accepted</code>")

        lines = [
            f"Probe   <code>{side} {_money(notional)} {esc(symbol)}</code>",
            "<code>dry-run · nothing submitted · reads current state</code>",
            "",
        ]
        lines += [
            f"<code>{esc(name):<20}</code> {'✅' if ok else '❌'} <code>{_number(obs)}</code> / <code>{_number(lim)}</code>"
            for name, obs, lim, ok in numeric
        ]
        if bool_lines:
            lines.append("")
            lines.extend(bool_lines)
        lines.append("<i>A preview of the 17 pre-trade gates from current state — nothing is submitted and no counter, token or audit row moves.</i>")
        chart = generate_gate_ladder_png(f"Pre-trade headroom · {side} {symbol}", numeric)
        footer = kb([
            _symbol_row("gates", symbol, notional_arg, side),
            _choice_row("gates", [("25k", "25000"), ("100k", "100000"), ("250k", "250000"), ("1m", "1000000")], notional_arg, prefix_args=(symbol,), suffix_args=(side,)),
            [("BUY", cb("gates", symbol, notional_arg, "BUY")), ("SELL", cb("gates", symbol, notional_arg, "SELL"))],
            [("Headroom", cb("headroom")), ("TCA", cb("tca", symbol, notional_arg, side))],
        ])
        await self.send_media_group(chat_id, [("gates", chart)] if chart else [], caption=text_card(
            f"🚦 Pre-trade gates · {esc(symbol)}", "DRY-RUN", lines,
            source="Gateway read-only state", next_commands=f"/tca {symbol} {notional_arg} {side} · /headroom · /limits"), reply_markup=footer)

    async def _cmd_quality(self, args, chat_id, actor) -> None:
        dimension = args[0].lower() if args and args[0].lower() in {"venue", "strategy"} else "venue"
        footer = kb([[("By venue", cb("quality", "venue")), ("By strategy", cb("quality", "strategy"))]])
        rows = self.audit.execution_quality_by(dimension) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card(
                "🎯 Fill quality", "NO FILLS",
                [f"No fills recorded to group by {esc(dimension)}."],
                source="DuckDB audit log", next_commands="/orders · /blotter"), reply_markup=footer)
            return
        lines = [f"<b>{dimension.upper():<10} FILLS  SLIP(bps)  NOTIONAL</b>"]
        for row in rows[:8]:
            lines.append(
                f"{esc(str(row.get('bucket'))):<10} <code>{row.get('filled') or 0}</code>"
                f" · <code>{_number(row.get('avg_slippage_bps'), signed=True)}</code>"
                f" · <code>{_money(row.get('notional'))}</code>"
            )
        bars = generate_bars_chart_png(
            f"Average slippage by {dimension} (bps)",
            [str(row.get("bucket")) for row in rows[:8]],
            [_finite(row.get("avg_slippage_bps")) for row in rows[:8]],
            "Slippage (bps)", horizontal=True, value_fmt="{:+.2f}",
        )
        orders = [
            order for order in (self.audit.recent_orders(200) if self.audit else [])
            if order.get("accepted") and _finite(order.get("slippage_bps")) is not None
            and _finite(order.get("notional")) is not None
        ]
        scatter = generate_scatter_png(
            "Slippage vs order notional (accepted fills)",
            [_finite(order.get("notional")) for order in orders],
            [_finite(order.get("slippage_bps")) for order in orders],
            "Notional (USD)", "Slippage (bps)",
            groups=[str(order.get("venue") or "?") for order in orders], fit_line=True,
        )
        if not scatter:
            lines.append("<i>Fewer than five accepted fills carry both a slippage and a notional, so no scatter.</i>")
        charts = [(name, blob) for name, blob in (("quality-bars", bars), ("quality-scatter", scatter)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            "🎯 Fill quality", f"BY {dimension.upper()}", lines,
            source="DuckDB audit log", next_commands="/orders · /slippage · /blotter"), reply_markup=footer)

    async def _cmd_imbalance(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        footer = kb([_symbol_row("imbalance", symbol)])
        books = [book for book in (self.tca.get_books(symbol, depth=20) if self.tca else []) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(
                f"⚖️ {esc(symbol)} imbalance", "NO LIVE BOOK",
                ["No venue currently has a fresh book for this symbol."],
                source="TCA engine", next_commands="/feedstatus"), reply_markup=footer)
            return
        lines = ["<b>VENUE        IMBALANCE   BID/ASK DEPTH</b>"]
        bids: list[tuple[float, float]] = []
        asks: list[tuple[float, float]] = []
        for book in books:
            value = _finite(book.imbalance)
            lean = "→ bid" if (value or 0) > 0.05 else "→ ask" if (value or 0) < -0.05 else "· flat"
            lines.append(
                f"<code>{esc(str(book.venue)):<10}</code> <code>{_number(book.imbalance, signed=True)}</code> {lean}"
                f" · <code>{_money(book.depth_usd_bid)}</code>/<code>{_money(book.depth_usd_ask)}</code>"
            )
            bids.extend((level.price, level.size) for level in book.bids)
            asks.extend((level.price, level.size) for level in book.asks)
        lines.append("<i>Imbalance is (bid − ask) depth over their sum: positive is a resting-bid lean, a buy-side pressure.</i>")
        chart = generate_depth_chart_png(symbol, bids, asks)
        await self.send_media_group(chat_id, [("depth", chart)] if chart else [], caption=text_card(
            f"⚖️ {esc(symbol)} imbalance", "SYNTHETIC" if any(book.synthetic for book in books) else "LIVE", lines,
            source="Cross-venue TCA engine", next_commands=f"/depth {symbol} · /book {symbol}"), reply_markup=footer)

    async def _cmd_costs(self, args, chat_id, actor) -> None:
        today = datetime.now(timezone.utc).date()
        requested = args[0] if args else today.isoformat()
        try:
            datetime.strptime(requested, "%Y-%m-%d")
        except ValueError:
            requested = today.isoformat()
        yesterday = (today - timedelta(days=1)).isoformat()
        footer = kb([[("Today", cb("costs", today.isoformat())), ("Yesterday", cb("costs", yesterday))]])
        costs = self.audit.session_costs(requested) if self.audit else {}
        fills = costs.get("fills") or 0
        if not costs or not fills:
            await self.send_message(chat_id, text_card(
                f"💸 Session costs · {esc(requested)}", "NO FILLS",
                ["No fills recorded for this session date."],
                source="DuckDB audit log", next_commands="/quality · /orders"), reply_markup=footer)
            return
        fees = _finite(costs.get("fees")) or 0.0
        slip = _finite(costs.get("slippage_cost")) or 0.0
        lines = [
            f"Session   <code>{esc(requested)}</code>",
            f"Fills     <code>{fills}</code> · notional <code>{_money(costs.get('notional'))}</code>",
            f"Fees      <code>{_money(fees)}</code>",
            f"Slippage  <code>{_money(slip)}</code>",
            f"Total     <code>{_money(fees + slip)}</code>",
        ]
        if costs.get("fills_without_slippage"):
            lines.append(f"<i>{costs.get('fills_without_slippage')} fills carry no slippage measure — excluded from the slippage total.</i>")
        bars = generate_bars_chart_png(
            f"Fees vs slippage · {requested}", ["Fees", "Slippage"], [fees, slip],
            "USD", colours=["#f59e0b", "#ff5252"], value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("costs", bars)] if bars else [], caption=text_card(
            f"💸 Session costs · {esc(requested)}", "AUDIT AGGREGATE", lines,
            source="DuckDB audit log", next_commands="/quality · /attribution"), reply_markup=footer)

    async def _cmd_latency(self, args, chat_id, actor) -> None:
        from modules import metrics

        summary = metrics.decision_latency_summary()
        buckets = metrics.decision_latency_buckets()
        footer = kb([[("Reliability", cb("reliability")), ("SLIs", cb("ops"))]])
        samples = int(summary.get("samples") or 0)
        lines = ["<b>Decision latency (in-process µs)</b>"]
        # Every key present, so a future core_ns quantile shows up here on its own.
        for key, value in summary.items():
            printed = str(int(value)) if key == "samples" else _number(value, 0)
            lines.append(f"<code>{esc(key):<8}</code> <code>{printed}</code>")
        if not samples:
            lines.append("<i>No decision has been timed yet — an empty record, not zero latency.</i>")
        markers = [(label, _finite(summary.get(label))) for label in ("p50", "p99")]
        cdf = generate_latency_cdf_png("Decision-latency CDF (µs)", buckets, [(label, value) for label, value in markers if value])
        route_summary = metrics.request_latency_summary()
        routes = sorted(route_summary.items(), key=lambda item: item[1].get("p99", 0.0), reverse=True)[:6]
        route_bars = generate_bars_chart_png(
            "Route latency p99 (ms, observed)",
            [route[:18] for route, _ in routes],
            [_finite(stats.get("p99")) for _, stats in routes],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        lines.append("<i>Decision latency is measured inside this process in microseconds; the network path to Telegram or a venue is separate and not counted here.</i>")
        charts = [(name, blob) for name, blob in (("latency-cdf", cdf), ("route-p99", route_bars)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            "⏱ Decision latency", f"{samples} TIMED" if samples else "NO SAMPLES", lines,
            source="metrics · in-process µs", next_commands="/reliability · /ops · /status"), reply_markup=footer)

    async def _cmd_blotter(self, args, chat_id, actor) -> None:
        view = args[0].lower() if args and args[0].lower() in {"all", "fills", "rejects", "working"} else "all"
        count = self._limit(args, 1, 12, 30) if len(args) > 1 else 12
        footer = kb([[
            ("All", cb("blotter", "all")), ("Fills", cb("blotter", "fills")),
            ("Rejects", cb("blotter", "rejects")), ("Working", cb("blotter", "working")),
        ]])
        orders = self.audit.recent_orders(max(count * 3, count)) if self.audit else []
        working = self.gateway.list_working(None) if self.gateway else []
        accepted = [order for order in orders if order.get("accepted")]
        rejected = [order for order in orders if not order.get("accepted")]

        lines: list[str] = []
        chart: bytes | None = None
        if view == "working":
            title, status = "📋 Blotter · working", f"{len(working)} RESTING"
            if not working:
                lines.append("Nothing is resting on the book.")
            for order in working[:count]:
                request = getattr(order, "request", None)
                lines.append(
                    f"<code>{esc(str(order.symbol)):<8}</code> {esc(str(getattr(request, 'side', '—')))}"
                    f" <code>{_money(getattr(request, 'notional', None))}</code> @ <code>{_number(order.limit_price)}</code>"
                )
        else:
            if view == "fills":
                rows, title, status = accepted[:count], "📋 Blotter · fills", f"{len(accepted)} ACCEPTED"
            elif view == "rejects":
                rows, title, status = rejected[:count], "📋 Blotter · rejects", f"{len(rejected)} REJECTED"
            else:
                rows, title, status = orders[:count], "📋 Blotter · all", f"{len(orders)} DECISIONS"
            if not rows:
                lines.append("No matching audit rows.")
            for order in rows:
                icon = "✅" if order.get("accepted") else "❌"
                stamp = str(order.get("ts") or "")[11:19]
                lines.append(
                    f"{icon} <code>{esc(stamp)}</code> {esc(order.get('symbol'))} {esc(order.get('side'))}"
                    f" <code>{_money(order.get('notional'))}</code>"
                )
                if not order.get("accepted"):
                    lines.append(f"   ↳ <code>{esc(str(order.get('rejected_by') or order.get('reason') or 'rejected')[:80])}</code>")
            lines.append(f"<i>{len(working)} orders still resting — /working for the live set.</i>")
            if view in {"all", "rejects"} and rejected:
                from collections import Counter

                counter = Counter(str(order.get("rejected_by") or "unknown") for order in rejected)
                chart = generate_bars_chart_png(
                    "Rejections by gate", list(counter.keys()), [float(v) for v in counter.values()],
                    "Count", horizontal=True, value_fmt="{:.0f}",
                )
        await self.send_media_group(chat_id, [("rejections", chart)] if chart else [], caption=text_card(
            title, status, lines,
            source="DuckDB audit log + gateway", next_commands="/orders · /working · /quality"), reply_markup=footer)

    async def _cmd_spreadhistory(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        venue: str | None = None
        metric = "spread"
        for token in args[1:]:
            low = token.lower()
            if low in {"spread", "slip", "slippage", "depth"}:
                metric = "slip" if low in {"slip", "slippage"} else low
            else:
                venue = token.upper()
        footer = kb([
            _symbol_row("spreadhistory", symbol),
            _choice_row("spreadhistory", [("Spread", "spread"), ("Slippage", "slip"), ("Depth", "depth")], metric, prefix_args=(symbol,)),
        ])
        rows = self.audit.tca_history(symbol, venue) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card(
                f"📈 {esc(symbol)} TCA history", "NO SNAPSHOTS",
                ["The gateway records TCA snapshots on a timer; none for this symbol yet.",
                 "<i>An empty record, not a zero spread.</i>"],
                source="audit · tca_snapshots", next_commands=f"/spread {symbol}"), reply_markup=footer)
            return
        series: dict[str, list[float]] = {}
        for row in rows:
            key = str(row.get("venue") or "?")
            if metric == "spread":
                value = _finite(row.get("spread_bps"))
            elif metric == "slip":
                buy, sell = _finite(row.get("buy_slip_bps")), _finite(row.get("sell_slip_bps"))
                value = ((buy or 0.0) + (sell or 0.0)) / 2 if (buy is not None or sell is not None) else None
            else:
                bid, ask = _finite(row.get("depth_usd_bid")), _finite(row.get("depth_usd_ask"))
                value = ((bid or 0.0) + (ask or 0.0)) if (bid is not None or ask is not None) else None
            if value is not None:
                series.setdefault(key, []).append(value)
        ylabel = {"spread": "Spread (bps)", "slip": "Slippage (bps)", "depth": "Depth (USD)"}[metric]
        lines = [
            f"Symbol   <code>{esc(symbol)}</code>{(' · ' + esc(venue)) if venue else ''}",
            f"Metric   <code>{esc(metric)}</code>",
            f"Rows     <code>{len(rows)}</code> across <code>{len(series)}</code> venue(s)",
        ]
        for key, vals in series.items():
            lines.append(f"<code>{esc(key):<10}</code> latest <code>{_number(vals[-1])}</code> · n=<code>{len(vals)}</code>")
        chart = generate_multi_series_png(f"{symbol} {metric} history", series, ylabel)
        await self.send_media_group(chat_id, [("tcahistory", chart)] if chart else [], caption=text_card(
            f"📈 {esc(symbol)} TCA history", "PERSISTED", lines,
            source="audit · tca_snapshots", next_commands=f"/spread {symbol} · /depth {symbol}"), reply_markup=footer)

    # ------------------------------------------------------------------ #
    # Portfolio manager — beyond the whole-book summary
    # ------------------------------------------------------------------ #
    async def _cmd_allocation(self, args, chat_id, actor) -> None:
        """Current vs target weights, and the trades between them. Read-only."""
        from modules.quant_risk import propose_allocation, rebalance_trades

        methods = {"ew": "equal_weight", "iv": "inverse_vol", "erc": "equal_risk", "mv": "min_variance"}
        chosen = args[0].lower() if args else "iv"
        method = methods.get(chosen, "inverse_vol")
        method_arg = next((short for short, full in methods.items() if full == method), "iv")
        switch = kb([_choice_row("allocation", [("EW", "ew"), ("IV", "iv"), ("ERC", "erc"), ("MV", "mv")], method_arg)])

        report, cov, _returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        proposal = propose_allocation(
            positions, cov, equity, method=method,
            max_symbol_notional=settings.max_symbol_notional_usd,
            max_gross_notional=settings.max_gross_exposure_usd,
        ) if cov else None
        if not proposal:
            await self.send_message(chat_id, text_card(
                "⚖️ Allocation", "NOT MEASURABLE",
                ["A flat book, or too little shared price history to build a covariance.",
                 "Allocation needs a covariance, and a covariance needs history."],
                source="quant_risk · risk-based", next_commands="/positions · /rebalance"), reply_markup=switch)
            return

        lines = [f"<b>Method: {esc(proposal.method.replace('_', ' '))}</b>", "",
                 "<b>SYMBOL     NOW  TARGET   DRIFT</b>"]
        for target in proposal.targets:
            cap = " ⚠" if target.clipped_by else ""
            lines.append(
                f"<code>{esc(f'{target.symbol[:9]:<9}')}</code> "
                f"<code>{target.current_weight:>5.0%}</code> "
                f"<code>{target.target_weight:>6.0%}</code> "
                f"<code>{target.drift:>+6.1%}</code>{cap}"
            )
        trades = rebalance_trades(proposal, positions, drift_band=0.05)
        if trades:
            lines += ["", "<b>Trades outside a 5% band</b>"]
            for trade in trades:
                lines.append(f"  {trade['side']} <code>{_money(trade['notional'])}</code> {esc(trade['symbol'])}")
        else:
            lines += ["", "<i>Everything is inside a 5% drift band — trading it would cost more than the drift.</i>"]
        lines.append("<i>Risk-based only, and nothing here is sent — a proposal, not an instruction.</i>")
        chart = generate_paired_bars_png(
            f"Current vs target notional · {proposal.method.replace('_', ' ')}",
            [target.symbol for target in proposal.targets],
            [_finite(target.current_notional) for target in proposal.targets],
            [_finite(target.target_notional) for target in proposal.targets],
            "Current", "Target", "Notional (USD)", value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("allocation", chart)] if chart else [], caption=text_card(
            "⚖️ Allocation", "PROPOSAL", lines,
            source="quant_risk · risk-based", next_commands="/rebalance · /exposure · /riskcontrib"), reply_markup=switch)

    async def _cmd_performance(self, args, chat_id, actor) -> None:
        """Realised P&L and fees by strategy sleeve, replayed from fills."""
        from modules.portfolio import realized_pnl_by_strategy

        sleeves = realized_pnl_by_strategy(self.audit) if self.audit else {}
        rows = sorted(sleeves.values(), key=lambda sleeve: -float(sleeve.get("realized_pnl") or 0.0))
        if not rows:
            await self.send_message(chat_id, text_card(
                "📈 Performance", "NO FILLS",
                ["No accepted fills recorded, so there is no realised P&L to attribute.",
                 "<i>An empty record, not a flat result.</i>"],
                source="audit · replayed fills", next_commands="/attribution · /pnl"))
            return
        lines = ["<b>STRATEGY      P&amp;L        FEES  WIN%</b>"]
        for row in rows[:8]:
            name = str(row.get("strategy"))[:12]
            win = row.get("win_rate")
            win_txt = _percent(win, 0) if win is not None else "—"
            flag = " •" if row.get("has_open_inventory") else ""
            lines.append(
                f"<code>{esc(f'{name:<12}')}</code> "
                f"<code>{_money(row.get('realized_pnl'), signed=True):>9}</code> "
                f"<code>{_money(row.get('fees')):>7}</code> <code>{win_txt}</code>{flag}"
            )
        lines.append("<i>Realised on closed quantity only; open inventory (•) is carried at cost, not marked.</i>")
        names = [str(row.get("strategy")) for row in rows[:8]]
        charts: list[tuple[str, bytes]] = []
        pnl_bars = generate_bars_chart_png(
            "Realised P&L by strategy (USD)", names,
            [_finite(row.get("realized_pnl")) for row in rows[:8]],
            "P&L (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        if pnl_bars:
            charts.append(("performance-pnl", pnl_bars))
        fee_bars = generate_bars_chart_png(
            "Fees by strategy (USD)", names,
            [_finite(row.get("fees")) for row in rows[:8]],
            "Fees (USD)", colours=["#f59e0b"] * len(names), horizontal=True, value_fmt="{:,.0f}",
        )
        if fee_bars:
            charts.append(("performance-fees", fee_bars))
        await self.send_media_group(chat_id, charts, caption=text_card(
            "📈 Performance", "AUDIT-REPLAYED", lines,
            source="audit · realized_pnl_by_strategy", next_commands="/attribution · /pnl · /costs"))

    # ------------------------------------------------------------------ #
    # Risk manager — Monte Carlo and beta
    # ------------------------------------------------------------------ #
    async def _cmd_montecarlo(self, args, chat_id, actor) -> None:
        """A bootstrapped cone of where the book lands over a horizon. Read-only."""
        from modules.quant_risk import bootstrap_terminal_distribution, historical_var

        horizons = {"1": 1, "5": 5, "20": 20}
        horizon = horizons.get(args[0], 5) if args else 5
        # Second argument selects the resampler. 1 (the default) is the i.i.d.
        # draw this command has always reported; above it, the stationary
        # bootstrap the workspace's cone uses. Reported in the card either way,
        # because two runs that used different resamplers are not comparable.
        block = 1
        if len(args) > 1:
            requested = _finite(args[1])
            if requested is None or requested < 1 or requested > 100:
                raise ValueError("block length must be between 1 and 100 bars")
            block = int(requested)
        switch = kb([_choice_row("montecarlo", [("1d", "1"), ("5d", "5"), ("20d", "20")], str(horizon))])
        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        hv = historical_var(positions, returns, equity) if positions else None
        book_returns = list(hv.daily_pnl) if hv else []
        mc = (bootstrap_terminal_distribution(book_returns, horizon, mean_block_length=block)
              if book_returns else None)
        if not mc:
            await self.send_message(chat_id, text_card(
                f"🎲 Monte Carlo · {horizon}d", "NOT AVAILABLE",
                ["A flat book, or fewer than 60 aligned bars of book history to resample.",
                 "The cone bootstraps the daily P&L the book actually lived through, and needs that history to exist."],
                source="quant_risk · bootstrap", next_commands="/var · /positions"), reply_markup=switch)
            return

        cushion = _finite(report["risk_budget"]["daily_drawdown"].get("cushion_usd"))
        lines = [
            f"Horizon    <code>{mc.horizon}</code> bars · <code>{mc.paths:,}</code> paths · <code>{mc.observations}</code> obs",
            f"Resampler  <code>{'i.i.d.' if mc.mean_block_length == 1 else f'blocks of ~{mc.mean_block_length}'}</code>",
            f"Median     <code>{_money(mc.p50[-1], signed=True)}</code> terminal P&amp;L",
            f"VaR 95     <code>{_money(mc.var95)}</code> · CVaR 95 <code>{_money(mc.cvar95)}</code>",
            f"P5 / P95   <code>{_money(mc.p5[-1], signed=True)}</code> / <code>{_money(mc.p95[-1], signed=True)}</code>",
        ]
        if cushion is not None and cushion > 0:
            trip = " · <i>a 95% loss would trip it</i>" if mc.var95 >= cushion else ""
            lines.append(f"Cushion    <code>{_money(cushion)}</code> to the drawdown breaker{trip}")
        lines.append(
            "<i>I.i.d. bootstrap: it resamples days independently, so it has no "
            "volatility clustering and understates a sustained run of losses. "
            "Reported beside the historical figure, never instead of it.</i>"
            if mc.mean_block_length == 1 else
            f"<i>Stationary bootstrap, blocks of ~{mc.mean_block_length} bars: it keeps the "
            "clustering an i.i.d. draw destroys, which widens the tail where losses "
            "arrive in runs. Reported beside the historical figure, never instead of it.</i>"
        )

        cone = generate_cone_png(
            f"Terminal-P&L cone · {mc.horizon}d",
            list(mc.p5), list(mc.p25), list(mc.p50), list(mc.p75), list(mc.p95),
        )
        markers = [("VaR 95", -mc.var95, "#e8ab3d"), ("CVaR 95", -mc.cvar95, "#f0737c")]
        if cushion is not None and cushion > 0:
            markers.append(("Cushion", -cushion, "#38bdf8"))
        hist = generate_histogram_png(
            f"Terminal P&L · {mc.paths:,} paths", list(mc.terminal_pnl), "Terminal P&L (USD)", markers,
        )
        charts = [(name, blob) for name, blob in (("mc-cone", cone), ("mc-terminal", hist)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            f"🎲 Monte Carlo · {mc.horizon}d", "BOOTSTRAP", lines,
            source=f"quant_risk · {'i.i.d.' if mc.mean_block_length == 1 else 'stationary'} bootstrap", next_commands="/var · /stress · /varbacktest"), reply_markup=switch)

    async def _cmd_beta(self, args, chat_id, actor) -> None:
        """Beta and hedge ratio of a symbol against a reference, from returns."""
        from modules.quant_risk import beta as compute_beta
        from modules.quant_risk import returns_from_closes

        symbol = self._symbol(args)
        default_ref = "BTCUSDT" if symbol != "BTCUSDT" else "ETHUSDT"
        ref = self._symbol(args, 1) if len(args) > 1 else default_ref
        tracked = [value.upper() for value in settings.symbols][:6]
        ref_row = [(f"• {sym}" if sym == ref else sym, cb("beta", symbol, sym)) for sym in tracked]
        footer = kb([_symbol_row("beta", symbol, ref), ref_row])

        if symbol == ref:
            await self.send_message(chat_id, text_card(
                f"🧮 Beta · {esc(symbol)} vs {esc(ref)}", "NOT MEASURABLE",
                ["A symbol is its own reference — beta against itself is 1 by definition.",
                 "Give a different reference, e.g. <code>/beta ETHUSDT BTCUSDT</code>."],
                source="quant_risk", next_commands="/correlation · /stress"), reply_markup=footer)
            return

        def asset_of(instrument: str) -> str:
            return "crypto" if instrument.endswith(("USDT", "-USD")) else "equity"

        closes_sym = await self._closes_for(symbol, asset_of(symbol), "1d", 150)
        closes_ref = await self._closes_for(ref, asset_of(ref), "1d", 150)
        n = min(len(closes_sym), len(closes_ref))
        rets: dict[str, list[float]] = {}
        if n >= 21:
            rets = {
                symbol: returns_from_closes(closes_sym[-n:]),
                ref: returns_from_closes(closes_ref[-n:]),
            }
        value = compute_beta(symbol, ref, rets) if rets else None
        if value is None:
            await self.send_message(chat_id, text_card(
                f"🧮 Beta · {esc(symbol)} vs {esc(ref)}", "NOT MEASURABLE",
                [f"Fewer than 20 aligned daily returns for {esc(symbol)} and {esc(ref)}.",
                 "Beta is a regression, and a regression needs a shared history to run on."],
                source="quant_risk", next_commands="/correlation · /stress"), reply_markup=footer)
            return

        lines = [
            f"Symbol     <code>{esc(symbol)}</code>",
            f"Reference  <code>{esc(ref)}</code>",
            f"Beta       <code>{_number(value, 3)}</code> over <code>{len(rets[symbol])}</code> aligned returns",
            f"Hedge      <code>{_number(-value, 3)}</code> units of {esc(ref)} per unit {esc(symbol)} to neutralise",
        ]
        lines.append("<i>β is the slope of the symbol's returns on the reference's — a measurement, not 1.0 by assumption. An unmeasurable beta is left flat rather than guessed.</i>")
        scatter = generate_scatter_png(
            f"{symbol} vs {ref} daily returns", rets[ref], rets[symbol],
            f"{ref} return", f"{symbol} return", fit_line=True,
        )
        await self.send_media_group(chat_id, [("beta", scatter)] if scatter else [], caption=text_card(
            f"🧮 Beta · {esc(symbol)} vs {esc(ref)}", "MEASURED", lines,
            source="quant_risk · returns regression", next_commands="/correlation · /stress · /montecarlo"), reply_markup=footer)

    # ------------------------------------------------------------------ #
    # Data engineer — trust, provenance, providers and the work queues
    # ------------------------------------------------------------------ #
    async def _cmd_trust(self, args, chat_id, actor) -> None:
        """A single feed-trust verdict, plus per-venue book freshness."""
        from modules import research

        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        openbb = await research.openbb_status_async()
        audit_health = self.audit.health() if self.audit else {}
        synthetic = bool(health.get("synthetic_active"))
        connected = sum(1 for feed in feeds if feed.get("connected"))

        ages: list[tuple[str, float | None, bool]] = []
        for feed in feeds:
            venue = str(feed.get("venue") or feed.get("name") or "?")
            symbol_states = list((feed.get("symbols") or {}).values())
            venue_ages = [state.get("age_s") for state in symbol_states if state.get("age_s") is not None]
            stale = any(state.get("stale") for state in symbol_states)
            ages.append((venue, max(venue_ages) if venue_ages else None, stale))

        if not feeds:
            verdict = "UNAVAILABLE"
        elif synthetic:
            verdict = "SYNTHETIC"
        elif connected < len(feeds) or any(stale for _, _, stale in ages):
            verdict = "DEGRADED"
        else:
            verdict = "TRUSTED"

        lines = [
            f"Verdict     <code>{verdict}</code>",
            f"Venues      <code>{connected}/{len(feeds)} connected</code>",
            f"OpenBB      <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>",
            f"Audit       <code>{esc(audit_health.get('backend') or '—')}</code> · "
            f"<code>{'available' if audit_health.get('available') else 'unavailable'}</code>",
            f"Synthetic   <code>{'ACTIVE — generated book, not a venue' if synthetic else 'off'}</code>",
        ]
        for venue, age, stale in ages:
            age_txt = _number(age, 1) if age is not None else "—"
            lines.append(f"<code>{esc(venue):<10}</code> age <code>{age_txt}</code>s{' ⚠ stale' if stale else ''}")
        lines.append("<i>A verdict of SYNTHETIC means the book is generated because every venue is dark — never trade on it.</i>")
        chart = generate_bars_chart_png(
            "Book age by venue (s, lower is fresher)",
            [venue for venue, _, _ in ages],
            [_finite(age) for _, age, _ in ages],
            "Age (s)", colours=["#ff5252" if stale else "#00e676" for _, _, stale in ages],
            horizontal=True, value_fmt="{:.1f}s",
        )
        await self.send_media_group(chat_id, [("trust", chart)] if chart else [], caption=text_card(
            "🔎 Data trust", verdict, lines,
            source="TCA feeds + OpenBB + audit", next_commands="/dataquality · /payload BTCUSDT · /feedstatus"))

    async def _cmd_dataquality(self, args, chat_id, actor) -> None:
        """Feed degrade/recover transitions from the audit log, and reconnects."""
        count = self._limit(args, 0, 10, 25)
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        events = [
            event for event in (self.audit.recent_events(max(count * 4, count)) if self.audit else [])
            if str(event.get("event") or "") in {"feed_degraded", "feed_recovered"}
        ][:count]
        lines = [f"<b>Feed transitions</b> · last <code>{len(events)}</code>"]
        if events:
            icon = {"feed_recovered": "✅", "feed_degraded": "⚠️"}
            for event in events:
                stamp = str(event.get("ts") or "")[11:19]
                lines.append(
                    f"{icon.get(str(event.get('event')), '•')} <code>{esc(stamp)}</code> {esc(event.get('event'))}\n"
                    f"   <code>{esc(str(event.get('detail') or '')[:120])}</code>"
                )
        else:
            lines.append("<i>No feed degrade or recover events recorded — an empty record, not a promise of perfect feeds.</i>")
        lines += ["", "<b>Reconnects by venue</b>"]
        reconnects = [(str(feed.get("venue") or feed.get("name") or "?"), int(feed.get("reconnects") or 0)) for feed in feeds]
        for venue, total in reconnects:
            lines.append(f"<code>{esc(venue):<10}</code> <code>{total}</code>")
        chart = generate_bars_chart_png(
            "WebSocket reconnects by venue",
            [venue for venue, _ in reconnects], [float(total) for _, total in reconnects],
            "Reconnects", horizontal=True, value_fmt="{:.0f}",
        )
        await self.send_media_group(chat_id, [("reconnects", chart)] if chart else [], caption=text_card(
            "🩹 Data quality", f"{len(events)} TRANSITIONS", lines,
            source="audit feed-watchdog + TCA", next_commands="/trust · /feedstatus · /incidents"))

    async def _cmd_payload(self, args, chat_id, actor) -> None:
        """Per-venue provenance for one symbol, plus the OpenBB quote's own."""
        from modules import research

        symbol = self._symbol(args)
        footer = kb([_symbol_row("payload", symbol)])
        books = self.tca.get_books(symbol, depth=5) if self.tca else []
        lines = [f"<b>Venue books · {esc(symbol)}</b>"]
        if books:
            for book in books:
                last = book.last_update.strftime("%H:%M:%S") if getattr(book, "last_update", None) else "—"
                latency = _number(book.latency_ms, 1) if book.latency_ms is not None else "—"
                lines.append(
                    f"<code>{esc(str(book.venue)):<9}</code> upd <code>{last}</code>"
                    f" · lat <code>{latency}</code>ms"
                    f" · <code>{'SYNTH' if book.synthetic else 'live'}</code>"
                    f"{' · ⚠ stale' if book.stale else ''}"
                )
        else:
            lines.append("<i>No venue currently holds a book for this symbol — a missing feed, not a zero price.</i>")
        asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        quote = await research.quote(symbol, asset)
        lines += ["", "<b>OpenBB quote provenance</b>"]
        if quote.get("ok"):
            data = quote.get("data") or {}
            lines.append(
                f"Price <code>{_number(data.get('price'))}</code> · "
                f"delayed <code>{'yes' if data.get('delayed') else 'no'}</code> · "
                f"ccy <code>{esc(data.get('currency') or '—')}</code>"
            )
        else:
            lines.append(f"<code>{esc(str(quote.get('error') or 'unavailable'))[:100]}</code>")
        lines.append("<i>Every field is read straight from the last update; a missing measurement renders as —, never as 0.</i>")
        await self.send_message(chat_id, text_card(
            f"🧾 Provenance · {esc(symbol)}", "PER-VENUE", lines,
            source="TCA books + OpenBB", next_commands=f"/trust · /lineage {symbol}"), reply_markup=footer)

    async def _cmd_providers(self, args, chat_id, actor) -> None:
        """OpenBB, the venue feeds, and the web-ops ledger the browser POSTs here."""
        from modules import research
        from modules.web_telemetry import get_web_ops

        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        view = get_web_ops().view()
        lines = [
            f"OpenBB      <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code> · "
            f"provider <code>{esc(openbb.get('provider') or '—')}</code>",
            "",
            "<b>Venue feeds</b>",
        ]
        for feed in feeds:
            venue = str(feed.get("venue") or feed.get("name") or "?")
            lines.append(
                f"<code>{esc(venue):<10}</code> <code>{'connected' if feed.get('connected') else 'down'}</code>"
                f" · reconnects <code>{int(feed.get('reconnects') or 0)}</code>"
            )
        lines += ["", "<b>Web-ops ledger</b> (what the browser POSTs here)",
                  f"Instances <code>{len(view.instances)}</code> · keys <code>{len(view.latency)}</code>"
                  f" · outages <code>{len(view.outages)}</code> · quota rows <code>{len(view.quota)}</code>"]
        for outage in view.outages[:4]:
            lines.append(f"⚠️ outage <code>{esc(outage.provider)}</code> · {esc(outage.note)[:60]}")
        for entry in view.quota[:4]:
            lines.append(f"quota <code>{esc(entry.provider)}</code>/{esc(entry.window)} spent <code>{entry.spent}</code>")
        if not view.instances:
            lines.append("<i>No web instance has synced telemetry into this gateway yet — the browser fills it within a few polls.</i>")
        await self.send_message(chat_id, text_card(
            "🔌 Providers", "READY" if openbb.get("ok") else "DEGRADED", lines,
            source="OpenBB + TCA + web-ops", next_commands="/webops · /trust · /openbb"))

    async def _cmd_tasks(self, args, chat_id, actor) -> None:
        """The Data work queue is the gateway's now; the Developer queue is still the browser's."""
        from modules.work_items import get_work_items

        lines: list[str] = []
        try:
            items = get_work_items().list()
        except Exception as exc:  # pragma: no cover - the store is best-effort from chat
            items = []
            lines.append(f"<i>The work-item store could not be read ({esc(type(exc).__name__)}).</i>")
        open_items = [item for item in items if item.status != "resolved"]
        by_work_status: dict[str, int] = {}
        for item in items:
            by_work_status[item.status] = by_work_status.get(item.status, 0) + 1
        seeded = sum(1 for item in items if item.created_by == "seed")
        lines += [
            f"<b>Data work queue</b> — persisted on this gateway (SQLite): "
            f"<code>{len(items)}</code> items, <code>{len(open_items)}</code> open, "
            f"<code>{seeded}</code> seeded samples.",
        ]
        for status in ("intake", "ready", "progress", "resolved"):
            lines.append(f"<code>{status:<10}</code> <code>{by_work_status.get(status, 0)}</code>")
        urgent = [item for item in open_items if item.priority in ("P0", "P1")]
        if urgent:
            lines.append("")
            lines.append("<b>P0 / P1 open</b>")
            for item in sorted(urgent, key=lambda i: (i.priority, i.opened_at))[:5]:
                lines.append(f"<code>{esc(item.id)}</code> {esc(item.priority)} · {esc(item.title)}")
        lines.append("")
        lines.append("The Developer work queue in the web workspace is still browser storage — no server list to read.")
        stats = self.queue.stats() if self.queue else {}
        by_status = stats.get("by_status") or {}
        lines += [
            "",
            f"<b>Research jobs engine</b> (<code>{esc(stats.get('backend') or '—')}</code>): "
            f"<code>{stats.get('total') or 0}</code> jobs · <code>{stats.get('workers') or 0}</code> workers.",
        ]
        if by_status:
            for status, total in sorted(by_status.items()):
                lines.append(f"<code>{esc(status):<10}</code> <code>{total}</code>")
        else:
            lines.append("<i>No research job has been submitted in this process.</i>")
        chart = generate_bars_chart_png(
            "Data work queue by status",
            list(by_work_status.keys()), [float(value) for value in by_work_status.values()],
            "Items", horizontal=True, value_fmt="{:.0f}",
        )
        await self.send_media_group(chat_id, [("tasks", chart)] if chart else [], caption=text_card(
            "🗂 Work queues", "DATA QUEUE + JOBS", lines,
            source="work_items store · jobs engine", next_commands="/jobs · /researchstatus · /backtests"))

    # ------------------------------------------------------------------ #
    # DevOps / SRE — SLIs, planes, breakers, traces and the runbook
    # ------------------------------------------------------------------ #
    async def _cmd_sli(self, args, chat_id, actor) -> None:
        """Service-level indicators, including the native core's nanosecond clock."""
        from modules import metrics

        requests = metrics.request_latency_summary()
        decision = metrics.decision_latency_summary()
        core = metrics.core_latency_summary()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        uptime = _finite(health.get("uptime_s")) or 0.0
        state = self.gateway.state() if self.gateway else None
        connected = sum(1 for feed in feeds if feed.get("connected"))
        lines = [
            f"Engine uptime  <code>{uptime:.0f}s</code>",
            f"Kill switch    <code>{'ACTIVE' if state and state.kill_switch_active else 'inactive'}</code>",
            f"Feeds          <code>{connected}/{len(feeds)} connected</code>",
            "",
            "<b>Request latency (ms, windowed)</b>",
        ]
        routes = sorted(requests.items(), key=lambda item: item[1].get("p99", 0.0), reverse=True)[:6]
        if routes:
            for route, stats in routes:
                lines.append(
                    f"<code>{esc(route)[:20]:<20}</code> p50 <code>{_number(stats.get('p50'), 0)}</code>"
                    f" · p95 <code>{_number(stats.get('p95'), 0)}</code>"
                    f" · p99 <code>{_number(stats.get('p99'), 0)}</code>"
                    f" · err <code>{int(stats.get('errors') or 0)}</code>"
                )
        else:
            lines.append("<i>No request timed in the current window.</i>")
        lines += ["", "<b>Decision latency</b>"]
        if int(decision.get("samples") or 0):
            lines.append(
                f"in-process <code>{_number(decision.get('p50'), 0)}</code>/"
                f"<code>{_number(decision.get('p99'), 0)}</code> µs p50/p99 · "
                f"<code>{int(decision.get('samples'))}</code> timed"
            )
        else:
            lines.append("<i>No decision timed yet — an empty record, not zero latency.</i>")
        if int(core.get("samples") or 0):
            lines.append(
                f"native core <code>{_number(core.get('p50'), 0)}</code>/"
                f"<code>{_number(core.get('p99'), 0)}</code> ns p50/p99 · "
                f"<code>{int(core.get('samples'))}</code> timed"
            )
        else:
            lines.append("<i>Native core idle here — its nanosecond clock records only while the compiled engine runs.</i>")
        charts: list[tuple[str, bytes]] = []
        p99_chart = generate_bars_chart_png(
            "Route p99 (ms)", [route[:18] for route, _ in routes],
            [_finite(stats.get("p99")) for _, stats in routes],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        if p99_chart:
            charts.append(("sli-p99", p99_chart))
        error_chart = generate_bars_chart_png(
            "Route errors (window)", [route[:18] for route, _ in routes],
            [float(stats.get("errors") or 0) for _, stats in routes],
            "Errors", colours=["#ff5252"] * len(routes), horizontal=True, value_fmt="{:.0f}",
        )
        if error_chart:
            charts.append(("sli-errors", error_chart))
        await self.send_media_group(chat_id, charts, caption=text_card(
            "📟 Service levels", "MEASURED" if routes else "NO SAMPLES", lines,
            source="metrics + TCA + gateway", next_commands="/latency · /reliability · /circuits"))

    async def _cmd_planes(self, args, chat_id, actor) -> None:
        """Provider, platform and evidence dependency planes as a status grid."""
        from modules import research

        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        connected = sum(1 for feed in feeds if feed.get("connected"))
        state = self.gateway.state() if self.gateway else None
        audit_health = self.audit.health() if self.audit else {}
        queue_stats = self.queue.stats() if self.queue else {}
        mirror_on = bool(getattr(settings, "supabase_url", "") or "")

        def feed_status() -> str:
            if not feeds:
                return "unknown"
            if connected == len(feeds):
                return "ok"
            return "degraded" if connected else "down"

        rows = [
            ("Provider", "OpenBB", "ok" if openbb.get("ok") else "down", str(openbb.get("provider") or "—")),
            ("Provider", "Feeds", feed_status(), f"{connected}/{len(feeds)} live"),
            ("Platform", "Gateway", "ok" if state is not None else "unknown", "risk engine"),
            ("Platform", "Kill switch", "down" if state and state.kill_switch_active else "ok",
             "engaged" if state and state.kill_switch_active else "clear"),
            ("Platform", "Queue", "ok" if queue_stats.get("backend") else "unknown", str(queue_stats.get("backend") or "—")),
            ("Evidence", "Audit", "ok" if audit_health.get("available") else "down", str(audit_health.get("backend") or "—")),
            ("Evidence", "Mirror", "ok" if mirror_on else "unknown", "supabase" if mirror_on else "local only"),
        ]
        lines = [
            f"<code>{esc(plane):<9}</code> <code>{esc(component):<12}</code> <code>{esc(status.upper())}</code> · {esc(detail)}"
            for plane, component, status, detail in rows
        ]
        lines.append("<i>Three planes: who feeds the desk, what runs it, and what records it. A degraded or down tile is where an incident would surface.</i>")
        chart = generate_status_grid_png("Dependency planes", rows)
        await self.send_media_group(chat_id, [("planes", chart)] if chart else [], caption=text_card(
            "🧯 Dependency planes", "TOPOLOGY", lines,
            source="OpenBB + TCA + gateway + audit", next_commands="/sli · /circuits · /status"))

    async def _cmd_circuits(self, args, chat_id, actor) -> None:
        """The risk breakers as a headroom ladder. Reads state, moves nothing."""
        state = self.gateway.state() if self.gateway else None
        if state is None:
            await self.send_message(chat_id, text_card(
                "🧨 Circuit breakers", "NO GATEWAY",
                ["The risk gateway is not attached in this process."],
                source="gateway", next_commands="/status"))
            return
        limits = state.limits
        ladder: list[tuple[str, float | None, float | None, bool]] = []
        dd = _finite(state.daily_drawdown_pct)
        dd_cap = _finite(limits.get("max_daily_drawdown_pct"))
        if dd is not None and dd_cap:
            ladder.append(("daily_drawdown", dd, dd_cap, dd < dd_cap))
        rate_cap = _finite(limits.get("max_orders_per_sec"))
        if rate_cap:
            ladder.append(("rate_limit", _finite(state.orders_last_second) or 0.0, rate_cap, (state.orders_last_second or 0) < rate_cap))
        working_cap = _finite(getattr(settings, "max_working_orders", None))
        if working_cap:
            ladder.append(("working_book", float(state.working_orders), working_cap, state.working_orders < working_cap))
        gross_cap = _finite(limits.get("max_gross_exposure_usd"))
        if gross_cap:
            ladder.append(("gross_exposure", _finite(state.gross_exposure) or 0.0, gross_cap, (state.gross_exposure or 0) <= gross_cap))

        lines = [
            f"Kill switch  {'❌' if state.kill_switch_active else '✅'} <code>{'ENGAGED' if state.kill_switch_active else 'clear'}</code>",
            f"Reduce-only  {'⚠️' if state.reduce_only else '✅'} <code>{esc(state.reduce_only_source)}</code>",
            f"Drawdown     <code>{_percent(state.daily_drawdown_pct)}</code> of <code>{_percent(dd_cap)}</code>"
            f" · budget used <code>{_percent(state.drawdown_budget_used_pct)}</code>",
            f"Order rate   <code>{_number(state.orders_last_second)}</code>/s of <code>{_number(rate_cap, 0)}</code>",
            f"Working book <code>{state.working_orders}</code> of <code>{_number(working_cap, 0)}</code>",
            f"Gross        <code>{_money(state.gross_exposure)}</code> of <code>{_money(gross_cap)}</code>",
            "Watchdog     <code>5s monitor loop</code> · re-checks drawdown and feed health",
            "",
            "<i>The drawdown breaker is automatic; the kill switch and reduce-only are latched by an operator or the monitor loop. This reads their headroom and moves nothing.</i>",
        ]
        chart = generate_gate_ladder_png("Breaker headroom (% of limit)", ladder)
        status = "ENGAGED" if state.kill_switch_active else ("REDUCE-ONLY" if state.reduce_only else "CLEAR")
        await self.send_media_group(chat_id, [("circuits", chart)] if chart else [], caption=text_card(
            "🧨 Circuit breakers", status, lines,
            source="gateway risk state", next_commands="/risk · /gates · /remediation"))

    async def _cmd_traces(self, args, chat_id, actor) -> None:
        """Recent audit events merged with web outages, each tagged by origin."""
        from modules.web_telemetry import get_web_ops

        count = self._limit(args, 0, 12, 30)
        events = self.audit.recent_events(count) if self.audit else []
        view = get_web_ops().view()
        merged: list[tuple[str, str, str]] = []
        for event in events:
            merged.append(("audit", str(event.get("ts") or "")[11:19],
                           f"{event.get('event')} · {str(event.get('detail') or '')[:80]}"))
        for outage in view.outages:
            merged.append(("web", "", f"outage {outage.provider} · {outage.note[:60]}"))
        if not merged:
            await self.send_message(chat_id, text_card(
                "🧵 Traces", "NO RECORDS",
                ["No audit events and no web outages to merge — an empty trace, not a silent one."],
                source="audit + web-ops", next_commands="/incidents · /events · /providers"))
            return
        icon = {"audit": "🗄", "web": "🌐"}
        lines = [
            f"{icon.get(origin, '•')} <code>{esc(origin):<5}</code> <code>{esc(when or '—')}</code> {esc(text)}"
            for origin, when, text in merged[:count]
        ]
        lines.append("<i>Two origins in one stream: gateway audit rows and web-reported outages, each tagged so a reader never mistakes one for the other.</i>")
        await self.send_message(chat_id, text_card(
            "🧵 Traces", f"{len(merged)} ENTRIES", lines,
            source="audit + web-ops ledger", next_commands="/incidents · /events · /providers"))

    async def _cmd_remediation(self, args, chat_id, actor) -> None:
        """The five typed controls, their scope, and the current risk state.

        No control buttons on purpose: a control is typed and confirmed, never
        tapped, so this card carries only reads and refuses to offer a shortcut
        the challenge flow deliberately withholds.
        """
        state = self.gateway.state() if self.gateway else None
        controls = [spec for spec in COMMAND_SPECS if spec.category == "Controls"]
        scope = {
            "halt": "book-wide or per-symbol kill switch",
            "resume": "release the kill switch",
            "flatten": "close every open position through the gates",
            "reduceonly": "accept only risk-reducing orders",
            "resetbook": "reset the paper book and session accounting",
        }
        lines = [
            "<b>The five typed controls</b>",
            "Each needs the separate <code>TELEGRAM_CONTROL_USER_IDS</code> allow-list and a single-use code. "
            "They are typed, never tapped — this card carries no buttons on purpose.",
        ]
        for spec in controls:
            purpose = scope.get(spec.name, spec.description.split("·", 1)[-1].strip())
            lines.append(f"<code>/{esc(spec.name)}</code> — {esc(purpose)}")
        lines += ["", "<b>Live state</b>"]
        if state is not None:
            halted = f" · {esc(', '.join(state.halted_symbols))}" if state.halted_symbols else ""
            lines.append(f"Kill switch <code>{'ENGAGED' if state.kill_switch_active else 'clear'}</code>{halted}")
            lines.append(f"Reduce-only <code>{esc(state.reduce_only_source)}</code>")
        else:
            lines.append("<i>Gateway not attached.</i>")
        await self.send_message(chat_id, text_card(
            "🛠 Remediation", "TYPED CONTROLS", lines,
            source="command registry + gateway state", next_commands="/circuits · /risk · /status"))

    async def _cmd_webops(self, args, chat_id, actor) -> None:
        """The web telemetry ledger the /providers card only summarises."""
        from modules.web_telemetry import get_web_ops

        view = get_web_ops().view()
        lines = [
            f"Instances <code>{len(view.instances)}</code> · window <code>{view.window_seconds:.0f}s</code>",
            "",
            "<b>Per-key latency</b>",
        ]
        p99_labels: list[str] = []
        p99_values: list[float | None] = []
        if view.latency:
            for key_view in view.latency:
                ordered = sorted(sample.ms for sample in key_view.samples)
                total = len(ordered)
                errors = sum(1 for sample in key_view.samples if not sample.ok)
                p50 = ordered[min(total - 1, max(0, math.ceil(0.50 * total) - 1))] if total else None
                p99 = ordered[min(total - 1, max(0, math.ceil(0.99 * total) - 1))] if total else None
                rate = errors / total if total else 0.0
                lines.append(
                    f"<code>{esc(key_view.key)[:18]:<18}</code> p50 <code>{_number(p50, 0)}</code>"
                    f" · p99 <code>{_number(p99, 0)}</code> · err <code>{_percent(rate, 0)}</code>"
                    f" · n=<code>{total}</code>"
                )
                p99_labels.append(key_view.key[:18])
                p99_values.append(p99)
        else:
            lines.append("<i>No web instance has synced latency into this gateway — the browser fills it within a few polls.</i>")
        if view.outages:
            lines += ["", "<b>Outages</b>"]
            for outage in view.outages[:6]:
                lines.append(f"⚠️ <code>{esc(outage.provider)}</code> · {esc(outage.note)[:60]}")
        if view.quota:
            lines += ["", "<b>Quota</b>"]
            for entry in view.quota[:6]:
                lines.append(f"<code>{esc(entry.provider)}</code>/{esc(entry.window)} spent <code>{entry.spent}</code>")
        chart = generate_bars_chart_png(
            "Web key p99 (ms)", p99_labels, [_finite(value) for value in p99_values],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        await self.send_media_group(chat_id, [("webops", chart)] if chart else [], caption=text_card(
            "🌐 Web telemetry", f"{len(view.instances)} INSTANCES", lines,
            source="web-ops ledger · get_web_ops().view()", next_commands="/providers · /reliability · /sli"))

    # ------------------------------------------------------------------ #
    # Quant developer — readiness, CI gates, the API surface and the repo
    # ------------------------------------------------------------------ #
    async def _cmd_readiness(self, args, chat_id, actor) -> None:
        """Launch readiness across the runtime, the contract and the backends."""
        from modules.decision_core import ENGINE as decision_engine

        routes = _committed_route_counts()
        op_count = int(sum(count for _, count in routes)) if routes else 0
        audit_health = self.audit.health() if self.audit else {}
        try:
            import matplotlib  # noqa: F401
            mpl_ok = True
        except Exception:
            mpl_ok = False
        engine = str(decision_engine)
        rows = [
            ("Runtime", "Version", "ok", f"{settings.version}/{settings.environment}"),
            ("Runtime", "Charts", "ok" if mpl_ok else "down", "matplotlib" if mpl_ok else "missing"),
            ("Runtime", "Decision core", "ok" if engine == "native" else "degraded", engine),
            ("Contract", "OpenAPI", "ok" if op_count else "unknown", f"{op_count} ops" if op_count else "no snapshot"),
            ("Backends", "Audit", "ok" if audit_health.get("available") else "down", str(audit_health.get("backend") or "—")),
            ("Backends", "Telegram", "ok" if self.mode != "disabled" else "degraded", str(self.mode)),
        ]
        lines = [
            f"<code>{esc(plane):<9}</code> <code>{esc(component):<13}</code> <code>{esc(status.upper())}</code> · {esc(detail)}"
            for plane, component, status, detail in rows
        ]
        lines.append("<i>Launch readiness across the runtime, the committed contract and the live backends — a green board is necessary, not sufficient; CI remains the authority.</i>")
        chart = generate_status_grid_png("Launch readiness", rows)
        await self.send_media_group(chat_id, [("readiness", chart)] if chart else [], caption=text_card(
            "🚀 Readiness", "MEASURED", lines,
            source="settings + OpenAPI snapshot + backends", next_commands="/cicd · /apis · /codebase"))

    async def _cmd_cicd(self, args, chat_id, actor) -> None:
        """The verify gates a deploy must pass — named, never counted."""
        lines = [f"<b>{len(_VERIFY_GATES)} verify gates</b> a deploy must pass before it ships:", ""]
        for gate in _VERIFY_GATES:
            lines.append(f"✓ <code>{esc(gate)}</code>")
        lines += ["", "<i>These are the gates committed in <code>.github/workflows/deploy.yml</code>, "
                       "named rather than counted — not the verdict of the last run, which GitHub Actions remains the authority for.</i>"]
        await self.send_message(chat_id, text_card(
            "⚙️ CI/CD gates", f"{len(_VERIFY_GATES)} GATES", lines,
            source="committed CI configuration", next_commands="/readiness · /developer · /apis"))

    async def _cmd_apis(self, args, chat_id, actor) -> None:
        """The committed OpenAPI surface by tag, or one tag's operations."""
        by_tag = _openapi_operations_by_tag()
        if not by_tag:
            await self.send_message(chat_id, text_card(
                "🧭 API surface", "NO SNAPSHOT",
                ["The committed <code>tools/openapi.json</code> is not in this image, or it lists no operations."],
                source="OpenAPI snapshot", next_commands="/readiness · /developer"))
            return

        requested = args[0] if args else None
        resolved = next((tag for tag in by_tag if tag.lower() == str(requested).lower()), None) if requested else None
        if resolved:
            operations = sorted(by_tag[resolved])
            lines = [f"<b>{esc(resolved)}</b> · <code>{len(operations)}</code> operations"]
            for method, path, summary in operations[:20]:
                lines.append(f"<code>{esc(method):<6}</code> <code>{esc(path)}</code>" + (f" — {esc(summary)}" if summary else ""))
            await self.send_message(chat_id, text_card(
                f"🧭 API · {esc(resolved)}", f"{len(operations)} OPS", lines,
                source="committed OpenAPI snapshot", next_commands="/apis · /readiness"),
                reply_markup=kb([[("All tags", cb("apis"))]]))
            return

        counts = sorted(((tag, len(ops)) for tag, ops in by_tag.items()), key=lambda row: -row[1])
        lines = [f"<b>{sum(n for _, n in counts)}</b> operations across <b>{len(counts)}</b> tags", ""]
        for tag, total in counts:
            lines.append(f"<code>{esc(tag):<18}</code> <code>{total}</code>")
        buttons = [(tag[:20], cb("apis", tag)) for tag, _ in counts if _CALLBACK_ARG_RE.fullmatch(tag)]
        rows = [buttons[index:index + 3] for index in range(0, len(buttons), 3)]
        chart = generate_bars_chart_png(
            "API operations by tag", [tag for tag, _ in counts], [float(total) for _, total in counts],
            "Operations", horizontal=True, value_fmt="{:.0f}",
        )
        await self.send_media_group(chat_id, [("apis", chart)] if chart else [], caption=text_card(
            "🧭 API surface", f"{len(counts)} TAGS", lines,
            source="committed OpenAPI snapshot", next_commands="/readiness · /cicd"),
            reply_markup=kb(rows) if rows else None)

    async def _cmd_codebase(self, args, chat_id, actor) -> None:
        """Python file and line counts by area, walked from the source tree."""
        counts = _codebase_line_counts()
        lines = ["<b>AREA        FILES   LINES</b>"]
        for area, files, total_lines in counts:
            lines.append(f"<code>{esc(f'{area:<10}')}</code> <code>{files:>5}</code>  <code>{total_lines:>6,}</code>")
        lines += ["", "The container image ships only <code>main.py config.py celery_tasks.py worker.py "
                      "modules/ templates/ tools/</code> plus the compiled <code>_decision_core.so</code>, "
                      "and carries no git history."]
        chart = generate_bars_chart_png(
            "Lines of Python by area", [area for area, _, _ in counts],
            [float(total_lines) for _, _, total_lines in counts],
            "Lines", horizontal=True, value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("codebase", chart)] if chart else [], caption=text_card(
            "📦 Codebase", "STATIC SCAN", lines,
            source="os.walk over the source tree", next_commands="/apis · /readiness · /developer"))

    # ------------------------------------------------------------------ #
    # Beyond web — a normalised multi-symbol overlay
    # ------------------------------------------------------------------ #
    async def _cmd_compare(self, args, chat_id, actor) -> None:
        """A normalised price overlay across several instruments."""
        interval = next((token for token in args if token in _INTERVALS), "1d")
        symbols = self._symbols([token for token in args if token not in _INTERVALS], limit=4)
        symbol_args = tuple(symbols)
        try:
            interval_row = [
                (f"• {value}" if value == interval else value, cb("compare", *symbol_args, value))
                for value in _INTERVALS
            ]
            footer = kb([interval_row])
        except ValueError:
            footer = None

        series: dict[str, list[float]] = {}
        for symbol in symbols:
            asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
            closes = await self._closes_for(symbol, asset, interval, 90)
            if len(closes) >= 2:
                series[symbol] = closes
        if not series:
            await self.send_message(chat_id, text_card(
                "🔭 Compare", "NO SERIES",
                ["No instrument returned enough bars to overlay.",
                 f"Symbols: <code>{esc(', '.join(symbols))}</code> · interval <code>{esc(interval)}</code>"],
                source="OpenBB", next_commands="/bars · /trend"), reply_markup=footer)
            return
        lines = [f"Interval <code>{esc(interval)}</code> · <code>{len(series)}</code> series, indexed to 100 at the first bar"]
        for symbol, closes in series.items():
            move = (closes[-1] / closes[0] - 1) * 100 if closes[0] else 0.0
            lines.append(f"<code>{esc(symbol):<10}</code> {_number(move, 2, signed=True)}% over <code>{len(closes)}</code> bars")
        lines.append("<i>Rebased to a common 100 so instruments of very different price share one axis — the shapes are comparable, the levels are not.</i>")
        chart = generate_multi_series_png(f"Normalised overlay · {interval}", series, "Price", normalise=True, xlabel="Bar")
        await self.send_media_group(chat_id, [("compare", chart)] if chart else [], caption=text_card(
            "🔭 Compare", "NORMALISED", lines,
            source="OpenBB / yfinance", next_commands="/trend · /bars · /range"), reply_markup=footer)

    def _event_rows(self, args: list[str], incidents_only: bool = False) -> list[dict[str, Any]]:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_events(max(count * 3, count)) if self.audit else []
        if incidents_only:
            rows = [row for row in rows if str(row.get("severity") or "").lower() in {"warning", "critical", "error"}]
        return rows[:count]

    async def _render_events(self, chat_id: str, title: str, rows: list[dict[str, Any]], status: str) -> None:
        if not rows:
            await self.send_message(chat_id, text_card(title, "NO RECORDS", ["No matching events."], source="DuckDB audit log", next_commands="/status"))
            return
        icon = {"critical": "🛑", "error": "🔴", "warning": "⚠️", "info": "ℹ️"}
        lines = []
        for row in rows:
            severity = str(row.get("severity") or "info").lower()
            lines.append(f"{icon.get(severity, '•')} <code>{esc(str(row.get('ts') or '')[11:19])}</code> {esc(row.get('event'))} · {esc(row.get('symbol') or 'ALL')}\n   <code>{esc(str(row.get('detail') or '')[:150])}</code>")
        await self.send_message(chat_id, text_card(title, status, lines, source="DuckDB audit log", next_commands="/risk · /orders · /status"))

    async def _cmd_events(self, args, chat_id, actor) -> None:
        await self._render_events(chat_id, "📚 Risk and audit events", self._event_rows(args), "AUDIT LOG")

    async def _cmd_incidents(self, args, chat_id, actor) -> None:
        await self._render_events(chat_id, "🚨 Operational incidents", self._event_rows(args, True), "WARNING + CRITICAL")

    # ------------------------------------------------------------------ #
    # Notification preferences and delivery
    # ------------------------------------------------------------------ #
    def _subscriber_is_authorised(self, subscriber: dict[str, Any] | None) -> bool:
        """Return whether a persisted recipient owner is currently allowed.

        Chat IDs are destinations, not identities.  A legacy row with no
        explicit ``user_id`` therefore never qualifies for delivery, even if
        its old free-form username happens to contain a numeric fragment.
        """
        if not subscriber:
            return False
        user_id = str(subscriber.get("user_id") or "")
        return self._authorised(user_id)

    def _subscribers(self, *, alerts_only: bool = True) -> list[dict[str, Any]]:
        if not self.audit:
            return []
        return [
            subscriber
            for subscriber in self.audit.list_subscribers(alerts_only=alerts_only)
            if self._subscriber_is_authorised(subscriber)
        ]

    def _delivery_allowed(self, chat_id: str | int, *, require_alerts: bool = True) -> bool:
        if not self.audit:
            return False
        subscriber = self.audit.get_subscriber(str(chat_id))
        if not self._subscriber_is_authorised(subscriber):
            return False
        return not require_alerts or bool(subscriber.get("alerts"))

    def _user_id_from_actor(self, actor: str) -> str:
        """Parse, then re-check. ``PermissionError`` when the actor may not read.

        Two jobs in one call because every caller wants both: a bare id to store
        or compare, and a guarantee that the person behind it is still allowed
        to be there. `actor_user_id` is the parse alone, for the one caller that
        must run before authorisation exists — ``/start`` completing a link.
        """
        user_id = actor_user_id(actor)
        if not self._authorised(user_id):
            raise PermissionError("notification owner is not currently authorised")
        return user_id

    def _subscribe(self, chat_id: str, actor: str, alerts: bool = True) -> None:
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=alerts,
                user_id=self._user_id_from_actor(actor),
            )

    async def _cmd_subscribe(self, args, chat_id, actor) -> None:
        self._subscribe(chat_id, actor, alerts=True)
        await self.send_message(chat_id, text_card("🔔 Notifications enabled", "SUBSCRIBED", ["This chat will receive risk, execution, liquidity and completed-research updates.", "Add a liquidity threshold with <code>/watch BTCUSDT 100000 25</code>."], source="Persistent subscriber registry", next_commands="/subscriptions · /watch BTCUSDT 100000 25"))

    async def _cmd_unsubscribe(self, args, chat_id, actor) -> None:
        if str(chat_id) in settings.telegram_alert_chat_ids:
            await self.send_message(chat_id, text_card("🔔 Centrally managed notifications", "CANNOT MUTE HERE", ["This chat is listed in <code>TELEGRAM_ALERT_CHAT_IDS</code>; an operator must remove it from the deployment configuration."], source="AlphaEngine configuration", next_commands="/subscriptions"))
            return
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=False,
                user_id=self._user_id_from_actor(actor),
            )
        await self.send_message(chat_id, text_card("🔕 Notifications disabled", "UNSUBSCRIBED", ["Commands remain available; optional pushed alerts will stop."], source="Persistent subscriber registry", next_commands="/subscribe · /subscriptions"))

    async def _cmd_subscriptions(self, args, chat_id, actor) -> None:
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        central = str(chat_id) in settings.telegram_alert_chat_ids
        watches = (sub or {}).get("watches", [])
        enabled = self._subscriber_is_authorised(sub) and (central or bool((sub or {}).get("alerts")))
        lines = [f"Notifications <code>{'ON' if enabled else 'OFF'}</code>", f"Managed by <code>{'deployment' if central else 'chat preference'}</code>", f"Liquidity watches <code>{len(watches)}</code>"]
        await self.send_message(chat_id, text_card("🔔 Notification state", "ACTIVE" if enabled else "MUTED", lines, source="Configuration + subscriber registry", next_commands="/subscribe · /unsubscribe · /watches"))

    #: The desk roles a chat can speak for. "any" is not a role — it is the
    #: absence of one, stored as NULL, and it is what every chat has until it
    #: says otherwise. A chat with no role receives every alert, which is what
    #: chats did before roles existed and is the only default that cannot
    #: silently stop paging someone.
    DESK_ROLES: tuple[str, ...] = ("pm", "risk", "trader", "dev")

    ROLE_LABELS: dict[str, str] = {
        "pm": "Portfolio manager",
        "risk": "Risk manager",
        "trader": "Quant trader",
        "dev": "Quant developer",
    }

    async def _cmd_role(self, args, chat_id, actor) -> None:
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        current = (sub or {}).get("role")

        if not args:
            lines = [
                f"Role <code>{esc(current or 'any')}</code>",
                f"Receives <code>{esc(self.ROLE_LABELS[current] if current in self.ROLE_LABELS else 'every alert')}</code>",
                "Set one with <code>/role pm</code>, clear it with <code>/role any</code>.",
            ]
            await self.send_message(chat_id, text_card(
                "🧭 Desk role", "SET" if current else "UNSET", lines,
                source="Persistent subscriber registry",
                next_commands="/role pm · /subscriptions · /watches"))
            return

        choice = str(args[0]).strip().lower()
        if choice in {"any", "none", "clear", "all"}:
            choice = ""
        elif choice not in self.DESK_ROLES:
            raise ValueError(
                f"role must be one of {', '.join(self.DESK_ROLES)}, or 'any' to clear it"
            )

        if not self.audit:
            raise ValueError("no subscriber registry is available on this deployment")
        # Registers the chat if it is new, so /role is a complete action rather
        # than one that silently does nothing until /subscribe is run.
        self.audit.upsert_subscriber(
            str(chat_id), actor,
            alerts=bool((sub or {}).get("alerts", True)),
            role=choice or None,
        )
        lines = (
            [f"Role <code>{esc(choice)}</code> — {esc(self.ROLE_LABELS[choice])}",
             "Risk breaches route here. Every other alert is unchanged."]
            if choice else
            ["Role cleared.", "This chat receives every alert again."]
        )
        await self.send_message(chat_id, text_card(
            "🧭 Desk role updated", "SET" if choice else "CLEARED", lines,
            source="Persistent subscriber registry",
            next_commands="/subscriptions · /watches"))

    async def _cmd_watch(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        if symbol not in [tracked.upper() for tracked in settings.symbols]:
            raise ValueError(f"{symbol} is not a tracked execution instrument")
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        threshold = _finite(args[2]) if len(args) > 2 else settings.max_est_slippage_bps / 2
        if notional is None or notional <= 0:
            raise ValueError("watch notional must be positive and finite")
        if threshold is None or threshold <= 0 or threshold > 10_000:
            raise ValueError("watch threshold must be between 0 and 10,000 bps")

        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        watches = [watch for watch in (sub or {}).get("watches", []) if watch["symbol"] != symbol]
        watches.append({"symbol": symbol, "notional": notional, "threshold_bps": threshold})
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=True, watches=watches,
                user_id=self._user_id_from_actor(actor),
            )
        self._watch_state.pop((str(chat_id), symbol), None)
        await self.send_message(chat_id, text_card(f"👁 {symbol} liquidity watch", "ACTIVE", [f"Probe size <code>{_money(notional)}</code>", f"Alert above <code>{threshold:.1f} bps</code>", "Notifications fire once on deterioration and once on recovery."], source="TCA engine + subscriber registry", next_commands="/watches · /unwatch " + symbol))

    async def _cmd_unwatch(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else None
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        watches = (sub or {}).get("watches", [])
        remaining = [watch for watch in watches if symbol and watch["symbol"] != symbol] if symbol else []
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=bool((sub or {}).get("alerts")), watches=remaining,
                user_id=self._user_id_from_actor(actor),
            )
        removed = len(watches) - len(remaining)
        await self.send_message(chat_id, text_card("👁 Liquidity watches", "UPDATED", [f"Removed <code>{removed}</code> watch(es)."], source="Persistent subscriber registry", next_commands="/watches · /watch BTCUSDT 100000 25"))

    async def _cmd_watches(self, args, chat_id, actor) -> None:
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        watches = (sub or {}).get("watches", [])
        if not watches:
            await self.send_message(chat_id, text_card("👁 Liquidity watches", "NONE", ["No active execution-cost watches."], source="Persistent subscriber registry", next_commands="/watch BTCUSDT 100000 25"))
            return
        lines = []
        for watch in watches:
            estimate = self.tca.route_estimate(watch["symbol"], "BUY", watch["notional"]) if self.tca else None
            current = f"{estimate.slippage_bps:+.2f} bps" if estimate and estimate.slippage_bps is not None else "no book"
            breached = self._watch_state.get((str(chat_id), watch["symbol"]), False)
            lines.append(f"{'🔴' if breached else '🟢'} <b>{esc(watch['symbol'])}</b> · <code>{_money(watch['notional'])}</code> · limit <code>{watch['threshold_bps']:.1f} bps</code> · now <code>{current}</code>")
        await self.send_message(chat_id, text_card("👁 Liquidity watches", "ACTIVE", lines, source="TCA engine + subscriber registry", next_commands="/unwatch SYMBOL · /liquidity BTCUSDT 100000"))

    async def _cmd_digest(self, args, chat_id, actor) -> None:
        from modules import research
        from modules.portfolio import build_equity_history

        report = self._portfolio_report()
        state = self.gateway.state()
        health = self.tca.health()
        openbb = await research.openbb_status_async()
        constraint, utilisation = report["risk_budget"]["binding_constraint"]
        lines = [
            "<b>Portfolio</b>",
            f"Equity <code>{_money(report['equity']['current'])}</code> · Day P&amp;L <code>{_money(report['equity']['daily_pnl'], signed=True)}</code>",
            f"Gross <code>{_money(report['exposure']['gross'])}</code> · Net <code>{_money(report['exposure']['net'], signed=True)}</code> · Leverage <code>{_number(report['exposure']['leverage'])}x</code>",
            f"Binding <code>{esc(constraint)}</code> at <code>{_percent(utilisation)}</code>",
            "\n<b>Systems</b>",
            f"Trading <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code> · OpenBB <code>{'READY' if openbb.get('ok') else 'DOWN'}</code>",
            f"Feeds <code>{sum(1 for feed in health.get('feeds', []) if feed.get('connected'))}/{len(health.get('feeds', []))}</code> · Synthetic <code>{'ON' if health.get('synthetic_active') else 'off'}</code>",
        ]

        # One hero: the persisted equity curve when the record has one, else the
        # book's own gross-exposure bars. A digest that led with an empty frame
        # would be worse than one that leads with a number.
        history = build_equity_history(self.audit, limit=500)
        points = history.get("points") or []
        hero: bytes | None = None
        name = "exposure"
        if points:
            hero = generate_equity_chart_png(points, points[-1].get("start_of_day"))
            name = "equity"
        if hero is None:
            positions = report["exposure"]["positions"] or []
            hero = generate_bars_chart_png(
                "Gross exposure by symbol (USD)",
                [str(position.get("symbol")) for position in positions[:8]],
                [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
                "Notional (USD)", horizontal=True, value_fmt="{:,.0f}",
            )
            name = "exposure"
        await self.send_media_group(chat_id, [(name, hero)] if hero else [], caption=text_card(
            "🗞 AlphaEngine digest", "ON DEMAND", lines,
            source="Portfolio + risk + TCA + OpenBB", next_commands="/portfolio · /status · /incidents",
        ), reply_markup=_menu_keyboard())

    async def _watch_tick(self) -> None:
        for subscriber in self._subscribers():
            chat_id = subscriber["chat_id"]
            for watch in subscriber.get("watches", []):
                symbol = watch["symbol"]
                notional = watch["notional"]
                threshold = watch["threshold_bps"]
                estimate = self.tca.route_estimate(symbol, "BUY", notional) if self.tca else None
                if estimate is None or estimate.slippage_bps is None:
                    continue
                key = (chat_id, symbol)
                previous = self._watch_state.get(key, False)
                breached = (not estimate.fillable) or estimate.slippage_bps > threshold
                if breached == previous:
                    continue
                self._watch_state[key] = breached
                if breached:
                    lines = [f"Probe <code>{_money(notional)}</code>", f"Cost <code>{estimate.slippage_bps:+.2f} bps</code> vs <code>{threshold:.1f} bps</code> limit", f"Routable <code>{_money(estimate.filled_notional)}</code> · Route <code>{esc(estimate.venue)}</code>"]
                    message = text_card(f"⚠️ {symbol} liquidity deterioration", "THRESHOLD BREACH", lines, source="TCA execution-cost watch", next_commands=f"/liquidity {symbol} {notional:g} · /tca {symbol} {notional:g} BUY")
                else:
                    message = text_card(f"✅ {symbol} liquidity recovered", "BACK WITHIN LIMIT", [f"Probe <code>{_money(notional)}</code>", f"Cost <code>{estimate.slippage_bps:+.2f} bps</code> vs <code>{threshold:.1f} bps</code> limit"], source="TCA execution-cost watch", next_commands="/watches")
                if not self._delivery_allowed(chat_id):
                    # Re-check immediately before the network call so an
                    # allow-list revocation cannot race a long TCA pass.
                    self._watch_state[key] = previous
                    continue
                await self.send_message(chat_id, message)
                self.alerts_sent += 1

    #: The pushed risk rules. Each is (key, label, unit, how to read the
    #: observation off the desk). The threshold for each lives in settings, and
    #: a threshold of zero means the rule is off — not "fires at zero".
    RISK_RULE_LABELS: dict[str, str] = {
        "daily_drawdown": "Daily drawdown",
        "var95": "VaR 95, 1 day",
        "gross_exposure": "Gross exposure",
        "concentration": "Book concentration",
    }

    def _risk_thresholds(self) -> dict[str, float]:
        return {
            "daily_drawdown": settings.alert_drawdown_pct,
            "var95": settings.alert_var95_pct,
            "gross_exposure": settings.alert_gross_exposure_pct,
            "concentration": settings.alert_concentration_pct,
        }

    def _risk_observations(self) -> dict[str, float | None]:
        """What the three in-memory rules currently read.

        Arithmetic over state the gateway already holds — no fetch, no await —
        which is what lets this run at the alert interval. VaR is absent here
        on purpose and is evaluated on its own slower cadence in ``_risk_tick``.

        A rule whose inputs are missing reads ``None`` and is skipped, never
        coerced to zero: "we cannot measure the book" and "the book is flat"
        are different states and only one of them is safe to not alert on.
        """
        if not self.gateway:
            return {}
        state = self.gateway.state()
        equity = _finite(state.equity)
        observations: dict[str, float | None] = {
            "daily_drawdown": _finite(state.daily_drawdown_pct),
        }
        gross = _finite(state.gross_exposure)
        observations["gross_exposure"] = (
            gross / equity if gross is not None and equity else None
        )
        notionals = [
            abs(_finite(getattr(p, "notional", None)) or 0.0) for p in (state.positions or [])
        ]
        total = sum(notionals)
        observations["concentration"] = (max(notionals) / total) if notionals and total else None
        return observations

    async def _risk_var95(self) -> float | None:
        """1-day 95 % historical VaR over equity, or None when unmeasurable."""
        from modules.quant_risk import historical_var

        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = _finite(report["equity"]["current"])
        if not positions or not equity:
            return None
        hv = historical_var(positions, returns, equity)
        if hv is None:
            return None
        loss = _finite(getattr(hv, "var95", None))
        return (loss / equity) if loss is not None and equity else None

    async def _risk_tick(self) -> None:
        thresholds = self._risk_thresholds()
        observations = self._risk_observations()

        # VaR costs a bar fetch per held symbol, so it runs on its own clock
        # rather than the alert interval — and only when its rule is enabled.
        if thresholds.get("var95", 0.0) > 0:
            now = time.monotonic()
            if now >= self._risk_var_due:
                self._risk_var_due = now + max(60.0, settings.alert_risk_interval_s * 15)
                try:
                    observations["var95"] = await self._risk_var95()
                except Exception as exc:  # a provider outage is not an alert
                    log.info("risk alert: VaR unmeasurable (%s)", type(exc).__name__)

        for key, threshold in thresholds.items():
            if threshold <= 0:
                continue
            observed = observations.get(key)
            if observed is None:
                continue
            breached = observed >= threshold
            if breached == self._risk_state.get(key, False):
                continue
            self._risk_state[key] = breached
            await self._push_risk_alert(key, observed, threshold, breached)

    async def _cmd_probe(self, args, chat_id, actor) -> None:
        """The palette's probe presets, as a command that needs no arguments.

        /tca already does this and already defaults every argument — that is
        what the usage strings were corrected to say. This is the same walk
        under the name a reader reaches for, so "what would this cost" does not
        require knowing that the answer lives under a three-letter acronym.
        """
        symbol, notional, side = self._trade_args(args)
        if self.tca is None:
            raise ValueError("no execution engine is attached on this deployment")
        report = self.tca.tca_report(symbol, side, notional)
        if not report.per_venue:
            await self.send_message(chat_id, text_card(
                f"🎯 {symbol} probe", "NO LIVE BOOK",
                ["No venue is streaming this instrument, so there is nothing to walk."],
                source="TCA engine", next_commands="/feedstatus · /venues"))
            return
        best = min(report.per_venue, key=lambda e: e.slippage_bps if e.slippage_bps is not None else 1e9)
        lines = [
            f"Probe   <code>{side} · {_money(notional)}</code>",
            f"Mid     <code>{_number(report.consolidated_mid)}</code>",
            f"Best    <code>{esc(best.venue)}</code> at <code>{_number(best.slippage_bps, signed=True)} bps</code>",
        ]
        if report.smart_route:
            lines.append(
                f"Routed  <code>{_number(report.smart_route_slippage_bps, signed=True)} bps</code>"
                f" across <code>{len(report.smart_route)}</code>"
            )
        await self.send_message(chat_id, text_card(
            f"🎯 {symbol} probe", "SYNTHETIC" if report.synthetic else "LIVE", lines,
            source="Cross-venue TCA engine",
            next_commands=f"/tca {symbol} {notional:g} {side} · /liquidity {symbol}"))

    async def _cmd_engine(self, args, chat_id, actor) -> None:
        """Which decision engine is running, and what it measured itself at.

        The desk publishes this on /health and on the Developer tab. It is a
        question worth being able to ask from a phone, because the answer
        "python" on a deployment that expected "native" is a silent
        degradation — the gateway starts fine either way.
        """
        from modules.decision_core import ENGINE, IMPORT_ERROR, REQUESTED

        core_ns = getattr(self.gateway, "last_decision_core_ns", None) if self.gateway else None
        lines = [
            f"Engine    <code>{esc(ENGINE)}</code> (requested <code>{esc(REQUESTED)}</code>)",
            f"Core      <code>{f'{core_ns} ns' if core_ns else 'not yet measured'}</code>"
            " — the compiled battery only, not the whole decision",
        ]
        if ENGINE != "native" and IMPORT_ERROR is not None:
            lines.append(f"Fell back <code>{esc(str(IMPORT_ERROR)[:120])}</code>")
        await self.send_message(chat_id, text_card(
            "⚙️ Decision engine", ENGINE.upper(), lines,
            source="modules.decision_core + gateway self-measure",
            next_commands="/status · /ops"))

    async def _cmd_refresh(self, args, chat_id, actor) -> None:
        """Re-read the desk now rather than waiting for the next poll."""
        if not self.gateway:
            raise ValueError("no risk gateway is attached on this deployment")
        state = self.gateway.state()
        observations = self._risk_observations()
        lines = [
            f"Equity    <code>{_money(_finite(state.equity))}</code>",
            f"Day P&L   <code>{_money(_finite(state.daily_pnl))}</code>",
            f"Drawdown  <code>{_percent(observations.get('daily_drawdown'))}</code>",
            f"Positions <code>{len(state.positions)}</code>"
            f" · halted <code>{'YES' if state.kill_switch_active else 'no'}</code>",
        ]
        await self.send_message(chat_id, text_card(
            "🔄 Desk snapshot", "HALTED" if state.kill_switch_active else "READ NOW", lines,
            source="Gateway risk state, read on demand",
            next_commands="/portfolio · /risk · /live on"))

    async def _cmd_thresholds(self, args, chat_id, actor) -> None:
        """The rules, their limits, and what each reads right now."""
        thresholds = self._risk_thresholds()
        observations = self._risk_observations()
        lines: list[str] = []
        for key, threshold in thresholds.items():
            label = self.RISK_RULE_LABELS.get(key, key)
            if threshold <= 0:
                # Off is a state worth printing. A rule silently absent from
                # this list reads as a rule that is passing.
                lines.append(f"{esc(label)} <code>off</code>")
                continue
            observed = observations.get(key)
            if key == "var95" and observed is None:
                reading = "on its own slower clock"
            elif observed is None:
                reading = "unmeasurable"
            else:
                reading = f"{_percent(observed)} now"
            breached = self._risk_state.get(key, False)
            mark = "▲" if breached else "●"
            lines.append(
                f"{mark} {esc(label)} <code>{_percent(threshold)}</code> — {esc(reading)}"
            )
        lines.append(f"Evaluated every <code>{settings.alert_risk_interval_s:g}s</code>")
        await self.send_message(chat_id, text_card(
            "📏 Risk alert thresholds",
            "ARMED" if any(t > 0 for t in thresholds.values()) else "ALL OFF",
            lines,
            source="Deployment settings + gateway risk state",
            next_commands="/risk · /limits · /role"))

    def _risk_line(self, key: str, observed: float, threshold: float) -> list[str]:
        label = self.RISK_RULE_LABELS.get(key, key)
        return [
            f"{esc(label)} <code>{_percent(observed)}</code> against <code>{_percent(threshold)}</code>",
            f"Rule <code>{esc(key)}</code> · interval <code>{settings.alert_risk_interval_s:g}s</code>",
        ]

    #: Which desk roles a risk breach is addressed to. A chat with no role set
    #: is NOT excluded — see _risk_alert_targets.
    RISK_ALERT_ROLES: frozenset[str] = frozenset({"pm", "risk"})

    def _risk_alert_targets(self) -> list[str]:
        """Chats a risk breach should reach.

        Two rules, in this order.

        A deployment that configures TELEGRAM_ALERT_CHAT_IDS has named its
        escalation path explicitly, and a per-chat preference must not quietly
        narrow it. That list wins, unfiltered, exactly as it does for every
        other pushed alert.

        Otherwise the breach goes to the roles whose job it is — pm and risk —
        plus every chat that has not set a role at all. That last clause is the
        important one: a role is opt-in, and a chat subscribed before roles
        existed keeps receiving what it received yesterday. The alternative is
        a schema migration that silently stops paging someone, which nobody
        discovers until the day it matters.
        """
        if settings.telegram_alert_chat_ids:
            return self._alert_targets()
        return [
            subscriber["chat_id"]
            for subscriber in self._subscribers()
            if not (subscriber.get("role") or "") or subscriber.get("role") in self.RISK_ALERT_ROLES
        ]

    async def _push_risk_alert(self, key: str, observed: float, threshold: float, breached: bool) -> None:
        label = self.RISK_RULE_LABELS.get(key, key)
        lines = self._risk_line(key, observed, threshold)
        message = text_card(
            f"⚠️ {label} over limit" if breached else f"✅ {label} back within limit",
            "THRESHOLD BREACH" if breached else "RECOVERED",
            lines,
            source="Gateway risk state",
            next_commands="/risk · /limits · /thresholds",
        )
        for chat_id in self._risk_alert_targets():
            # Re-checked immediately before the network call, like the
            # liquidity watch: an allow-list revocation must not race a tick.
            if not self._delivery_allowed(chat_id):
                continue
            await self.send_message(chat_id, message)
            self.alerts_sent += 1

    #: How often a live feed rewrites itself. Telegram rate-limits edits per
    #: chat, and a desk figure that moves faster than a reader can read it is
    #: not more informative — it is just more requests.
    LIVE_FEED_INTERVAL_S = 15.0

    def _live_card(self) -> str:
        """One message's worth of desk, rebuilt each tick."""
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        if not self.gateway:
            return text_card("📡 Live desk", "NO GATEWAY",
                             ["This deployment has no risk gateway attached."],
                             source="Telegram live feed", next_commands="/live off")
        state = self.gateway.state()
        thresholds = self._risk_thresholds()
        observations = self._risk_observations()
        drawdown = observations.get("daily_drawdown")
        limit = thresholds.get("daily_drawdown", 0.0)
        lines = [
            f"Equity     <code>{_money(_finite(state.equity))}</code>",
            f"Day P&L    <code>{_money(_finite(state.daily_pnl))}</code>",
            f"Drawdown   <code>{_percent(drawdown)}</code>"
            + (f" of <code>{_percent(limit)}</code> alert" if limit > 0 else ""),
            f"Gross      <code>{_money(_finite(state.gross_exposure))}</code>",
            f"Halted     <code>{'YES' if state.kill_switch_active else 'no'}</code>",
            f"As of      <code>{stamp} UTC</code>",
        ]
        return text_card(
            "📡 Live desk", "HALTED" if state.kill_switch_active else "STREAMING", lines,
            source=f"Gateway risk state, every {self.LIVE_FEED_INTERVAL_S:g}s",
            next_commands="/live off · /thresholds · /risk")

    async def _cmd_live(self, args, chat_id, actor) -> None:
        key = str(chat_id)
        want = str(args[0]).strip().lower() if args else "on"
        if want in {"off", "stop", "0", "no"}:
            feed = self._live_feeds.pop(key, None)
            if feed is None:
                await self.send_message(chat_id, text_card(
                    "📡 Live desk", "NOT STREAMING", ["Nothing was streaming in this chat."],
                    source="Telegram live feed", next_commands="/live on"))
                return
            await self.send_message(chat_id, text_card(
                "📡 Live desk", "STOPPED",
                ["The message above stops updating and keeps its last reading."],
                source="Telegram live feed", next_commands="/live on · /thresholds"))
            return
        if want not in {"on", "start", "1", "yes"}:
            raise ValueError("usage: /live [on|off]")

        sent = await self.send_message(chat_id, self._live_card())
        message_id = (sent or {}).get("result", {}).get("message_id") if isinstance(sent, dict) else None
        if message_id is None:
            # No message id means nothing to edit, and sending a fresh message
            # every fifteen seconds is exactly what this command exists to
            # avoid. It reports that rather than raising: the card above was
            # still delivered and is a true reading, it simply will not update.
            # (This is the path a dry-run or disabled bot takes.)
            await self.send_message(chat_id, text_card(
                "📡 Live desk", "SNAPSHOT ONLY",
                ["Telegram returned no message to update, so the reading above is a one-off.",
                 "Nothing is streaming; run /live on again once the bot can send."],
                source="Telegram live feed", next_commands="/livestatus · /risk"))
            return
        self._live_feeds[key] = {
            "message_id": int(message_id),
            "started": datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
        }

    async def _cmd_livestatus(self, args, chat_id, actor) -> None:
        feed = self._live_feeds.get(str(chat_id))
        lines = (
            [f"This chat <code>streaming</code> since <code>{esc(str(feed['started']))}</code>",
             f"Cadence <code>{self.LIVE_FEED_INTERVAL_S:g}s</code>, one message edited in place"]
            if feed else
            ["This chat <code>not streaming</code>"]
        )
        lines.append(f"Feeds open across all chats <code>{len(self._live_feeds)}</code>")
        lines.append("A gateway restart ends every feed; the last reading stays on screen.")
        await self.send_message(chat_id, text_card(
            "📡 Live feed state", "STREAMING" if feed else "IDLE", lines,
            source="Telegram live feed", next_commands="/live on · /live off"))

    async def _live_tick(self) -> None:
        if not self._live_feeds:
            return
        card = self._live_card()
        for key, feed in list(self._live_feeds.items()):
            if not self._delivery_allowed(key, require_alerts=False):
                self._live_feeds.pop(key, None)
                continue
            try:
                await self.edit_message_text(key, feed["message_id"], card)
            except Exception as exc:
                # A deleted message, or a chat that blocked the bot. Drop the
                # feed rather than retrying it forever.
                log.info("live feed for %s ended (%s)", key, type(exc).__name__)
                self._live_feeds.pop(key, None)

    async def _live_loop(self) -> None:
        while True:
            await asyncio.sleep(self.LIVE_FEED_INTERVAL_S)
            try:
                await self._live_tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Telegram live loop error (%s)", type(exc).__name__)

    async def _risk_loop(self) -> None:
        while True:
            await asyncio.sleep(max(5.0, settings.alert_risk_interval_s))
            try:
                await self._risk_tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Telegram risk loop error (%s)", type(exc).__name__)

    async def _watch_loop(self) -> None:
        while True:
            await asyncio.sleep(20)
            try:
                await self._watch_tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Telegram watch loop error (%s)", type(exc).__name__)

    def _role_targets(self, roles: frozenset[str]) -> list[str]:
        """Chats that speak for one of ``roles``, plus every chat with no role.

        Same rule as `_risk_alert_targets`: an unset role is the absence of a
        preference, not a preference to be excluded. A desk that has never run
        `/role` keeps receiving everything, which is the only safe default for
        a channel carrying operational alerts.
        """
        if settings.telegram_alert_chat_ids:
            return self._alert_targets()
        return [
            subscriber["chat_id"]
            for subscriber in self._subscribers()
            if not (subscriber.get("role") or "") or subscriber.get("role") in roles
        ]

    def _alert_targets(self) -> list[str]:
        if settings.telegram_alert_chat_ids:
            eligible = {
                subscriber["chat_id"]
                for subscriber in self._subscribers(alerts_only=False)
            }
            return [
                chat_id for chat_id in dict.fromkeys(settings.telegram_alert_chat_ids)
                if chat_id in eligible
            ]
        return [subscriber["chat_id"] for subscriber in self._subscribers()]

    async def broadcast(
        self, severity: str, message: str, roles: frozenset[str] | None = None,
    ) -> None:
        """Risk hook: normalize every pushed update into the textual card UI.

        ``roles`` addresses the message to the desk roles it is for. ``None``
        keeps the historical behaviour — every alert subscriber — and is what
        every existing caller gets.

        Role routing already existed and this path skipped it:
        `_risk_alert_targets` honours `subscribers.role`, and `broadcast` called
        `_alert_targets`, which never reads it. So a data-quality escalation
        went to every chat while a risk breach went to the two roles that own
        it. A chat with no role still receives everything, exactly as
        `_risk_alert_targets` decided.
        """
        if not self.enabled:
            log.info("[alert:%s] %s", severity, _HTML_TAG_RE.sub("", message).replace("\n", " ")[:200])
            return
        targets = self._alert_targets() if roles is None else self._role_targets(roles)
        if not targets:
            log.warning("Telegram alert dropped; no configured subscribers")
            return
        severity_key = severity.lower()
        icon = {"critical": "🛑", "error": "🔴", "warning": "⚠️", "info": "ℹ️"}.get(severity_key, "ℹ️")
        rendered = text_card(f"{icon} AlphaEngine operational alert", severity_key.upper(), [message], source="Risk gateway event hook", next_commands="/risk · /portfolio · /events")
        for chat_id in targets:
            central = str(chat_id) in settings.telegram_alert_chat_ids
            if not self._delivery_allowed(chat_id, require_alerts=not central):
                continue
            await self.send_message(chat_id, rendered)
            self.alerts_sent += 1

    async def push_backtest_result(self, record) -> None:
        """Completion update for jobs submitted outside Telegram — now with charts.

        The job result already carries a rendered ``equity_curve_png`` and
        ``heatmap_png``; this used to throw them away and send "TEXT RESULT".
        Both are decoded (skipping either that is None) and delivered as an
        album with the same text riding as the caption.
        """
        if not self.enabled or record.kind != "backtest":
            return
        chat_id = record.meta.get("chat_id")
        if not chat_id:
            return
        central = str(chat_id) in settings.telegram_alert_chat_ids
        if not self._delivery_allowed(chat_id, require_alerts=not central):
            log.warning("Telegram backtest update dropped; recipient is not currently authorised")
            return
        if record.status != "succeeded":
            await self.send_message(chat_id, text_card("❌ Backtest update", "FAILED", [f"Job <code>{esc(record.job_id)}</code>", f"Error <code>{esc(str(record.error)[:240])}</code>"], source="Research job queue", next_commands="/job " + str(record.job_id)))
            return
        result = record.result or {}
        best = result.get("best") or {}
        request = result.get("request") or {}
        symbol = (str(request.get("symbol") or record.meta.get("symbol") or "").upper()) or "BTCUSDT"
        lines = [
            f"Job <code>{esc(record.job_id)}</code>",
            f"Study <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Best params <code>{best.get('fast')}/{best.get('slow')}</code> from <code>{result.get('combos_tested')}</code> combinations",
            f"Sharpe <code>{_number(best.get('sharpe'))}</code> · Return <code>{_percent(best.get('total_return'), signed=True)}</code> · MaxDD <code>{_percent(best.get('max_drawdown'))}</code>",
            f"DSR <code>{_number(result.get('deflated_sharpe_ratio'), 3)}</code> · OOS Sharpe <code>{_number(result.get('walk_forward_oos_sharpe'))}</code>",
            f"Verdict <code>{esc(result.get('dsr_verdict') or '—')}</code>",
        ]
        charts: list[tuple[str, bytes]] = []
        for name, key in (("equity-curve", "equity_curve_png"), ("heatmap", "heatmap_png")):
            blob = self._decode_b64png(result.get(key))
            if blob:
                charts.append((name, blob))
        await self.send_media_group(chat_id, charts, caption=text_card(
            "🧪 Backtest completed", "RESULT", lines,
            source="Research job queue",
            next_commands=f"/walkforward {symbol} · /stability {symbol} · /overfit {symbol}",
        ))

    def health(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "username": (self.me or {}).get("username"),
            "updates_handled": self.updates_handled,
            # Inline keyboards and callback queries are served; every button
            # resolves to a registered typed command and controls are excluded.
            "interactive": True,
            "callbacks_handled": self.callbacks_handled,
            "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else 0.0,
            "alert_targets": len(self._alert_targets()),
            "subscribers": len(self._subscribers()),
            "watches": sum(len(subscriber.get("watches", [])) for subscriber in self._subscribers()),
            "alerts_sent": self.alerts_sent,
            "allowlist_configured": bool(self.allowed_user_ids),
            # These two read `True` for a long time after they stopped being
            # true: /halt, /resume and /flatten mutate risk state, and the
            # chart commands send photos. A health endpoint that misreports the
            # blast radius of its own commands is worse than one that omits it,
            # so the shape now describes what the bot can actually do.
            "read_only": False,
            "text_only": False,
            "controls": {
                # Derived from the registry, because the hard-coded 3 this
                # replaces went on reading 3 for two whole controls after
                # /reduceonly and /resetbook shipped.
                "commands": sum(1 for spec in COMMAND_SPECS if spec.category == "Controls"),
                "gated": True,
                "control_allowlist_configured": bool(self.control_user_ids),
            },
            # Counts and contract only — never which account is bound to which
            # chat. This endpoint is proxied to a public web origin, and the
            # binding is the one genuinely personal fact this module holds.
            "links": {
                "configured": settings.telegram_link_enabled,
                "bound_users": len(self._bound_user_ids()),
                "completed": self.links_completed,
                "grants": "read-parity-with-a-web-desk-pass",
                # Stated as a field because `read_only` above is the cautionary
                # tale: a contract nobody can assert drifts silently. The
                # controls read TELEGRAM_CONTROL_USER_IDS and nothing else.
                "grants_control": False,
            },
            "charts": "real-data-only",
            "last_error": self.last_error,
        }


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


__all__ = [
    "BOT_COMMANDS",
    "BOT_DESCRIPTION",
    "BOT_SHORT_DESCRIPTION",
    "COMMAND_SPECS",
    "HELP_TEXT",
    "ReplyTarget",
    "TelegramBot",
    "cb",
    "command_catalogue",
    "esc",
    "get_bot",
    "help_text",
    "kb",
    "parse_callback",
    "split_telegram_html",
    "text_card",
]
