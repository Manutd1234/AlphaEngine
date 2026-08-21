"""Update routing: text commands, callback taps, and `_dispatch` itself.

`_dispatch` resolves a handler by STRING NAME off `COMMAND_SPECS`, which is why
every handler group in this package is a mixin on one class rather than a
module of free functions.
"""

from __future__ import annotations

import contextlib
import time
from typing import Any

from modules.telegram._common import log
from modules.telegram.format import _BOOTSTRAP_COMMANDS, ReplyTarget, _reply_target, esc, text_card
from modules.telegram.keyboards import parse_callback
from modules.telegram.registry import _COMMAND_BY_NAME


class DispatchMixin:
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

        Controls are the one category a button may never ARM. A tap is easier
        to fire by accident than a typed command, and the whole point of the
        challenge flow is deliberateness — so no challenge is ever issued from
        a button, not even the first step. `_is_control_confirmation` is the
        narrow exception: a Controls callback already carrying a four-digit
        code confirms a challenge that a typed message opened seconds ago, and
        `_consume_challenge` refuses it unless one is live for this tapper.
        A tap can therefore finish a control, never start one.
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
        if spec.category == "Controls" and not self._is_control_confirmation(spec.name, args):
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
