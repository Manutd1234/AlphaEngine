"""Desk-pass → Telegram link tokens, and the status probe that reuses them.

Lifted verbatim from ``modules/telegram.py``'s first two banner sections. The
packed layout is shared with ``web/lib/telegram-link.ts`` and both suites pin
the same known-answer vector, so nothing in this file may be "tidied".
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

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
