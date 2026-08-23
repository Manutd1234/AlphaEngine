"""Start, stop, the long-poll loop and the update dedup ring."""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

from config import settings
from modules.telegram._common import log
from modules.telegram.registry import BOT_COMMANDS, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION


class RuntimeMixin:
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

        if self.mode == "send-only":
            # Outbound only: the alert loops below run, nothing consumes
            # updates, and the bot's command profile is left to the process
            # that does. Two long-pollers on one token take turns being
            # refused with 409 Conflict, and each refusal latches `last_error`
            # on whichever instance lost — so a second process beside the
            # deployed gateway runs in this mode, or not at all.
            log.info("Telegram companion in send-only mode: alerts go out, updates are left to the polling instance")
        else:
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
        elif self.mode == "polling":
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
                elif self.last_error_kind == "conflict":
                    # Another process holds this token's long poll. Retrying
                    # in a second only takes the poll off it and hands the
                    # 409 back; wait the full 30s and say what is going on,
                    # once per refusal rather than once per process.
                    log.warning(
                        "Telegram getUpdates refused (409 Conflict): another process is polling this bot; "
                        "stop it, or run it with TELEGRAM_MODE=send-only",
                    )
                    backoff = 30.0
                    await asyncio.sleep(backoff)
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
