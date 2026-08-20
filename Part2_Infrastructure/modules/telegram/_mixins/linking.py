"""The ``/start <token>`` binding write — the front half of "Essentials"."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from config import settings
from modules.telegram._common import actor_user_id, log
from modules.telegram.format import esc, text_card
from modules.telegram.link import (
    LINK_KIND_GUEST,
    AccountLinkWrite,
    LinkToken,
    _postgrest_reason,
    _replaced_identity,
    decode_link_token,
    link_token_fingerprint,
)


class LinkingMixin:
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
