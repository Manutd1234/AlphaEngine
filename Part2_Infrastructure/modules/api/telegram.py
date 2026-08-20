"""The Telegram companion's own surface: webhook, health, and link status.

Telegram authenticates itself — a secret token on the webhook, a signed probe
on the status route — and never through ``trader_identity``. That separation is
deliberate: nothing a Telegram user does is evidence about a web request, and
nothing a web pass grants reaches a Telegram control command.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Request

from config import settings
from modules.telegram import decode_link_probe, get_bot

log = logging.getLogger("alphaengine")

router = APIRouter(tags=["telegram"])


@router.post(settings.webhook_path)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, bool]:
    """Telegram retries on non-2xx, so this always returns 200 and processes the
    update out-of-band — a slow command must never cause duplicate delivery."""
    if not settings.telegram_webhook_secret or x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        log.warning("webhook called with bad secret token")
        raise HTTPException(403, "bad secret token")
    update = await request.json()
    asyncio.create_task(get_bot().handle_update(update))
    return {"ok": True}


@router.get("/telegram/health")
async def telegram_health() -> dict[str, Any]:
    return get_bot().health()


@router.post("/telegram/link/status")
async def telegram_link_status(
    probe: str = Body(..., embed=True, max_length=64, description="A signed status probe minted by the web desk."),
) -> dict[str, Any]:
    """Is the desk pass this caller already holds bound to a Telegram chat?

    Exists because a GUEST binding lives only in this gateway's store. The web
    workspace can read an *account* binding back from Supabase under RLS, but it
    has no route into DuckDB, so a guest who tapped Connect and was confirmed by
    the bot saw the header chip stay grey forever.

    ── Why this cannot be used to look anyone else up ──────────────────────────
    The identity is not a parameter. It is carried inside ``probe``, MAC'd with
    a key derived from ``TELEGRAM_LINK_SECRET`` (see ``link_probe_secret``), so
    the only identities that can be asked about are ones the caller could
    already mint a *link* token for — that is, ones it already speaks for. There
    is no field to put somebody else's user id in, and flipping a byte of the
    embedded UUID invalidates the signature, which is the same property
    ``tests/test_telegram_link.py`` pins for the link token itself.

    ── Why the answer cannot enumerate anything ────────────────────────────────
    It is a state and a kind. Never the Telegram username, never the chat id,
    never the Telegram user id, never a count, never a list. Exactly the line
    ``TelegramBot.health()``'s ``links`` block draws, narrowed to one row: a
    caller learns one boolean-ish fact about one identity it already proved it
    holds, and cannot walk from that answer to a second one.

    ── Why POST for a read ─────────────────────────────────────────────────────
    So the signed probe travels in a body rather than a URL. A query string ends
    up in access logs, proxy logs and ``Referer`` headers; the probe is
    short-lived and answers only yes/no, but a credential that need not be
    written down should not be. Nothing is written by this handler.
    """
    if not settings.telegram_link_enabled:
        # Fail loudly rather than answering "not linked" from a gateway that
        # cannot verify anything. Absent configuration is not evidence of an
        # absent binding.
        raise HTTPException(503, "linking is not configured on this gateway (TELEGRAM_LINK_SECRET)")
    try:
        token = decode_link_probe(probe, settings.telegram_link_secret)
    except ValueError as exc:
        # The verifier's own wording, prefixed: its messages say "start code"
        # because a person reads them in a Telegram card, and an operator
        # curling this endpoint should not be told to go and tap Connect. The
        # usual cause here is the two deployments holding different secrets.
        raise HTTPException(403, f"status probe refused — {exc}") from exc
    return {
        "link_status": get_bot().binding_status(token.kind, token.identity),
        "kind": token.kind,
        "grants": "read-parity-with-a-web-desk-pass",
        "grants_control": False,
    }
