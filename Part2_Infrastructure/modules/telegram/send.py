"""Outbound messages, photos and albums, and the edit-in-place callback path.

Split from ``transport.py`` only for length; ``_post`` is still the one door.
"""

from __future__ import annotations

import contextlib
import json
from typing import Any

import httpx

from modules.telegram._common import log
from modules.telegram.format import _reply_target, split_telegram_html


class SendMixin:
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
