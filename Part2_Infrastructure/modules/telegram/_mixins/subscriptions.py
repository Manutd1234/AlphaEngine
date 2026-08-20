"""Notification preferences — who is subscribed, in what role, watching what."""

from __future__ import annotations

from typing import Any

from config import settings
from modules.telegram._common import actor_user_id
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _menu_keyboard
from modules.telegram_charts import generate_bars_chart_png, generate_equity_chart_png


class SubscriptionsMixin:
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
