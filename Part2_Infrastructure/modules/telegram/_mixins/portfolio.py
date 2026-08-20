"""Portfolio manager — equity, the book, exposure, headroom and /risk."""

from __future__ import annotations

from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _choice_row, _tab_footer, cb, kb
from modules.telegram_charts import generate_bars_chart_png, generate_drawdown_chart_png, generate_equity_chart_png


class PortfolioMixin:
    # ------------------------------------------------------------------ #
    # Portfolio manager
    # ------------------------------------------------------------------ #
    async def _cmd_equity(self, args, chat_id, actor) -> None:
        """The persisted equity curve — the one series the bot never surfaced.

        Reads `build_equity_history`, the same function behind
        `GET /api/portfolio/history`, so the chat curve and the web curve are
        the same snapshots rather than two derivations that can disagree.
        """
        from modules.portfolio import build_equity_history

        limit = 500
        choice = args[0].lower() if args else ""
        if choice == "all":
            limit = 2000
        elif choice.isdigit():
            limit = max(2, min(2000, int(choice)))
        switch = kb([_choice_row("equity", [("50", "50"), ("200", "200"), ("all", "all")], choice)])

        history = build_equity_history(self.audit, limit=limit)
        points = history.get("points") or []
        if not points:
            await self.send_message(chat_id, text_card(
                "📈 Equity curve", "NO SNAPSHOTS",
                ["The gateway persists equity on a timer; none has been recorded yet.",
                 "<i>This is an empty record, not a flat book.</i>"],
                source="audit · equity_snapshots", next_commands="/portfolio · /pnl",
            ), reply_markup=switch)
            return

        periods = history.get("periods") or {}
        bounded = set(periods.get("window_bounded") or [])

        def _row(label: str, key: str) -> str:
            period = periods.get(key) or {}
            pnl, ret = period.get("pnl"), period.get("return")
            if pnl is None:
                return f"{label:<12} <code>not observed</code>"
            flag = " <i>(window-bounded)</i>" if key in bounded else ""
            return f"{label:<12} <code>{_money(pnl)}</code> · <code>{_percent(ret)}</code>{flag}"

        latest = points[-1]
        lines = [
            f"Equity       <code>{_money(latest.get('equity'))}</code>",
            _row("Day", "day"),
            _row("Month", "month_to_date"),
            _row("Inception", "since_first_snapshot"),
            f"Peak         <code>{_money(periods.get('peak_equity'))}</code>",
            f"Worst DD     <code>{_percent(periods.get('worst_daily_drawdown_pct'))}</code> intraday, against each day's own open",
            f"Sampled      <code>{history.get('sample_count')}</code> snapshots every "
            f"<code>{history.get('interval_s')}s</code>",
        ]
        if bounded:
            lines.append(
                "<i>Window-bounded periods start at the oldest snapshot retained, "
                "not at the true period open — the gateway keeps no earlier mark.</i>"
            )

        charts: list[tuple[str, bytes]] = []
        curve = generate_equity_chart_png(points, latest.get("start_of_day"))
        if curve:
            charts.append(("equity", curve))
        drawdown = generate_drawdown_chart_png(
            "EQUITY", [float(point["equity"]) for point in points if point.get("equity")],
        )
        if drawdown:
            charts.append(("drawdown", drawdown))

        await self.send_media_group(chat_id, charts, caption=text_card(
            "📈 Equity curve", "PERSISTED", lines,
            source="audit · equity_snapshots", next_commands="/portfolio · /var · /pnl",
        ), reply_markup=switch)

    async def _cmd_portfolio(self, args, chat_id, actor) -> None:
        from modules.portfolio import format_for_telegram

        report = self._portfolio_report()
        text = format_for_telegram(report)
        positions = report.get("exposure", {}).get("positions", []) or []

        # This replaced a fixed three-slice pie that never read the book it was
        # captioning. These are the book's own notionals and its own daily P&L
        # per symbol.
        charts: list[tuple[str, bytes]] = []
        allocation = generate_bars_chart_png(
            "Allocation by symbol (USD notional)",
            [str(position.get("symbol")) for position in positions[:8]],
            [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
            "Notional (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        if allocation:
            charts.append(("allocation", allocation))

        pnl_values = [_finite(position.get("unrealized_pnl")) for position in positions[:8]]
        pnl = generate_bars_chart_png(
            "Unrealised P&L by symbol (USD)",
            [str(position.get("symbol")) for position in positions[:8]],
            pnl_values,
            "Unrealised P&L (USD)",
            colours=['#00e676' if (value or 0) >= 0 else '#ff5252' for value in pnl_values],
            horizontal=True, value_fmt="{:,.0f}",
        )
        if pnl:
            charts.append(("pnl", pnl))

        await self.send_media_group(chat_id, charts, caption=text, reply_markup=_tab_footer(
            "portfolio",
            [
                ("Positions", cb("positions")),
                ("Exposure", cb("exposure")),
                ("P&L", cb("pnl")),
                ("Headroom", cb("headroom")),
            ],
            refresh=cb("portfolio"),
        ))

    async def _cmd_positions(self, args, chat_id, actor) -> None:
        state = self.gateway.state()
        symbol = self._symbol(args) if args else None
        positions = [position for position in state.positions if not symbol or position.symbol == symbol]
        if not positions:
            message = f"No open position for <code>{esc(symbol)}</code>." if symbol else "The book is flat."
            await self.send_message(chat_id, text_card("📌 Positions", "FLAT", [message], source="Risk gateway", next_commands="/portfolio"))
            return
        lines = []
        for position in sorted(positions, key=lambda row: -row.notional):
            side = "LONG" if position.quantity > 0 else "SHORT"
            lines += [
                f"<b>{esc(position.symbol)} · {side}</b>",
                f"Qty <code>{position.quantity:+.6f}</code> · Avg <code>{_number(position.avg_price)}</code> · Mark <code>{_number(position.mark_price)}</code>",
                f"Notional <code>{_money(position.notional)}</code> · uPnL <code>{_money(position.unrealized_pnl, signed=True)}</code>",
            ]
        await self.send_message(chat_id, text_card("📌 Open positions", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/exposure · /pnl · /concentration"))

    async def _cmd_pnl(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        equity = report["equity"]
        lines = [
            f"Equity       <code>{_money(equity['current'])}</code>",
            f"Day P&amp;L     <code>{_money(equity['daily_pnl'], signed=True)}</code> · <code>{_percent(equity['daily_return'], signed=True)}</code>",
            f"Realised     <code>{_money(equity['realized_pnl'], signed=True)}</code>",
            f"Unrealised   <code>{_money(equity['unrealized_pnl'], signed=True)}</code>",
        ]
        await self.send_message(chat_id, text_card("💹 Portfolio P&L", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/positions · /attribution"))

    async def _cmd_exposure(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        exposure = report["exposure"]
        lines = [
            f"Gross       <code>{_money(exposure['gross'])}</code>",
            f"Net         <code>{_money(exposure['net'], signed=True)}</code>",
            f"Leverage    <code>{_number(exposure['leverage'])}x</code>",
            f"Positions   <code>{len(exposure['positions'])}</code>",
        ]
        for position in exposure["positions"][:8]:
            lines.append(f"{esc(position['symbol']):<10} <code>{_money(position['notional'])}</code> · <code>{_percent(position['share_of_gross'])}</code>")
        await self.send_message(chat_id, text_card("🧭 Portfolio exposure", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/concentration · /headroom"))

    async def _cmd_concentration(self, args, chat_id, actor) -> None:
        concentration = self._portfolio_report()["concentration"]
        lines = [
            f"Largest symbol      <code>{esc(concentration['largest_symbol'] or '—')}</code>",
            f"Largest share       <code>{_percent(concentration['largest_share'])}</code>",
            f"Top-two share       <code>{_percent(concentration['top_two_share'])}</code>",
            f"HHI                 <code>{_number(concentration['hhi'], 4)}</code>",
            f"Effective positions <code>{_number(concentration['effective_positions'])}</code>",
        ]
        await self.send_message(chat_id, text_card("🎯 Concentration", "LIVE GATEWAY STATE", lines, source="Portfolio service", next_commands="/positions · /headroom"))

    async def _cmd_headroom(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        budget = report["risk_budget"]
        gross = budget["gross_exposure"]
        drawdown = budget["daily_drawdown"]
        constraint, utilisation = budget["binding_constraint"]
        lines = [
            f"Gross remaining  <code>{_money(gross['remaining'])}</code> · <code>{_percent(gross['utilisation'])}</code> used",
            f"Drawdown cushion <code>{_money(drawdown['cushion_usd'])}</code> · <code>{_percent(drawdown['utilisation'])}</code> used",
            f"Binding limit    <code>{esc(constraint)}</code> · <code>{_percent(utilisation)}</code>",
        ]
        for position in report["exposure"]["positions"][:8]:
            cap = position["symbol_limit"]
            lines.append(f"{esc(position['symbol']):<10} remaining <code>{_money(cap['remaining'])}</code>")
        await self.send_message(chat_id, text_card("🛡 Risk headroom", "AUTHORITATIVE LIMITS", lines, source="Risk gateway", next_commands="/risk · /limits"))

    async def _cmd_risk(self, args, chat_id, actor) -> None:
        state = self.gateway.state()
        used = max(0.0, min(1.0, state.drawdown_budget_used_pct))
        filled = int(used * 12)
        lines = [
            f"Equity      <code>{_money(state.equity)}</code>",
            f"Day P&amp;L    <code>{_money(state.daily_pnl, signed=True)}</code>",
            f"Drawdown   <code>{_percent(state.daily_drawdown_pct)}</code> / <code>{_percent(state.limits['max_daily_drawdown_pct'])}</code>",
            f"Budget     <code>{'█' * filled}{'░' * (12 - filled)}</code> {_percent(used)}",
            f"Gross       <code>{_money(state.gross_exposure)}</code> / <code>{_money(state.limits['max_gross_exposure_usd'])}</code>",
            f"Orders      <code>{state.orders_accepted} accepted · {state.orders_rejected} rejected</code>",
        ]
        status = "HALTED" if state.kill_switch_active else "LIVE"
        if state.kill_switch_active:
            lines.insert(0, f"Reason <code>{esc(state.kill_reason or 'not provided')}</code>")

        # The budget bar was drawn in block characters for the drawdown only.
        # Every hard limit the gateway enforces has a utilisation, and which one
        # binds first is the whole question — so all of them are plotted against
        # the same 100% scale, from the gateway's own numbers.
        gross_limit = state.limits.get("max_gross_exposure_usd") or 0.0
        dd_limit = state.limits.get("max_daily_drawdown_pct") or 0.0
        utilisations = [
            ("Daily drawdown", (state.daily_drawdown_pct / dd_limit * 100) if dd_limit else None),
            ("Gross exposure", (state.gross_exposure / gross_limit * 100) if gross_limit else None),
            ("Drawdown budget", used * 100),
        ]
        chart = generate_bars_chart_png(
            "Risk limit utilisation (% of hard limit)",
            [label for label, value in utilisations if value is not None],
            [value for _, value in utilisations if value is not None],
            "Utilisation (%)",
            colours=[
                '#ff5252' if (value or 0) >= 90 else '#f59e0b' if (value or 0) >= 70 else '#00e676'
                for _, value in utilisations if value is not None
            ],
            horizontal=True, value_fmt="{:.1f}%",
        )
        await self.send_media_group(chat_id, [("limits", chart)] if chart else [], caption=text_card(
            "🛡 Risk gateway", status, lines,
            source="Authoritative risk process", next_commands="/headroom · /positions · /incidents",
        ), reply_markup=_tab_footer(
            "risk",
            [
                ("VaR", cb("var")),
                ("Stress", cb("stress")),
                ("Correlation", cb("correlation")),
                ("Headroom", cb("headroom")),
            ],
            refresh=cb("risk"),
        ))

    async def _cmd_limits(self, args, chat_id, actor) -> None:
        limits = self.gateway.state().limits
        lines = [f"<code>{esc(key):<28}</code> {value:,.4g}" for key, value in limits.items()]
        await self.send_message(chat_id, text_card("🧱 Hard risk limits", "DEPLOY-TIME CONFIGURATION", lines, source="Risk gateway settings", next_commands="/headroom · /risk"))

    async def _cmd_attribution(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        strategies = report["attribution"]["by_strategy"]
        symbols = report["attribution"]["by_symbol"]
        lines = ["<b>By strategy</b>"]
        if strategies:
            for row in strategies[:8]:
                lines.append(f"{esc(row.get('strategy') or 'unassigned')} · <code>{row.get('filled') or 0} fills</code> · <code>{_money(row.get('notional'))}</code> · <code>{_number(row.get('avg_slippage_bps'), signed=True)} bps</code>")
        else:
            lines.append("No strategy flow recorded.")
        lines.append("\n<b>By symbol</b>")
        for row in symbols[:8]:
            lines.append(f"{esc(row.get('symbol'))} · <code>{row.get('filled') or 0} fills</code> · <code>{row.get('rejected') or 0} rejected</code>")
        await self.send_message(chat_id, text_card("🧾 Portfolio attribution", "AUDIT-RECONSTRUCTED", lines, source="DuckDB audit log", next_commands="/orders · /slippage · /fees"))
