"""The self-rewriting live card, and the three background loops that drive it."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from config import settings
from modules.telegram._common import log
from modules.telegram.format import _finite, _money, _percent, esc, text_card


class LiveMixin:
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
