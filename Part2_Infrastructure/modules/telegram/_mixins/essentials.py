"""Essentials — /start, /menu, /help, /commands, /about, /whoami, /version, /ping, /status."""

from __future__ import annotations

import time

from config import settings
from modules.telegram._common import actor_user_id
from modules.telegram.format import _money, esc, text_card
from modules.telegram.help import HELP_TEXT, command_catalogue, help_text
from modules.telegram.keyboards import _category_keyboard, _menu_keyboard
from modules.telegram.registry import COMMAND_SPECS


class EssentialsMixin:
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
