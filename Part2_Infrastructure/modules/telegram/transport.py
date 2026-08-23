"""The HTTP seam to Telegram: pacing, ``_post``, and the edit calls.

``_post`` is the single place this package touches the network, so a test that
wants to stub the transport patches THIS module — ``monkeypatch.setattr`` binds
to the module object that holds the reference, and that object is now
``modules.telegram.transport`` rather than ``modules.telegram``.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx

from modules.telegram._common import log
from modules.telegram.format import _CHAT_SEND_GAP, _GLOBAL_SEND_GAP, _MAX_RETRY_AFTER


def _is_poll_conflict(method: str, payload: dict[str, Any]) -> bool:
    """Telegram's 409 for a second getUpdates consumer on one token.

    The wire says `error_code: 409` and a description beginning "Conflict:".
    Both are checked — the description alone would also match a 409 on
    setWebhook, which is a different mistake with a different remedy.
    """
    return method == "getUpdates" and (
        payload.get("error_code") == 409
        or str(payload.get("description") or "").startswith("Conflict")
    )


class TransportMixin:
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
                response = await self._client.post(f"{self.base}/{method}", json=json_body, data=data, files=files)
                payload = response.json()
                if payload.get("ok"):
                    self.last_error = None  # a success clears the latch; see operations._telegram_snapshot
                    self.last_error_kind = None
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
                # 409 on getUpdates is not the API refusing us; it is Telegram
                # saying another process already holds this bot's long poll.
                self.last_error_kind = "conflict" if _is_poll_conflict(method, payload) else "api"
                log.warning("telegram %s failed: %s", method, description)
                return payload
            except Exception as exc:  # never include the token-bearing request URL
                error_kind = type(exc).__name__
                self.last_error = f"{method}: transport {error_kind}"
                self.last_error_kind = "transport"
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
