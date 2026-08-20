"""Portfolio manager — beyond the whole-book summary."""

from __future__ import annotations

from config import settings
from modules.telegram.format import _finite, _money, _percent, esc, text_card
from modules.telegram.keyboards import _choice_row, kb
from modules.telegram_charts import generate_bars_chart_png, generate_paired_bars_png


class AllocationMixin:
    # ------------------------------------------------------------------ #
    # Portfolio manager — beyond the whole-book summary
    # ------------------------------------------------------------------ #
    async def _cmd_allocation(self, args, chat_id, actor) -> None:
        """Current vs target weights, and the trades between them. Read-only."""
        from modules.quant_risk import propose_allocation, rebalance_trades

        methods = {"ew": "equal_weight", "iv": "inverse_vol", "erc": "equal_risk", "mv": "min_variance"}
        chosen = args[0].lower() if args else "iv"
        method = methods.get(chosen, "inverse_vol")
        method_arg = next((short for short, full in methods.items() if full == method), "iv")
        switch = kb([_choice_row("allocation", [("EW", "ew"), ("IV", "iv"), ("ERC", "erc"), ("MV", "mv")], method_arg)])

        report, cov, _returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        proposal = propose_allocation(
            positions, cov, equity, method=method,
            max_symbol_notional=settings.max_symbol_notional_usd,
            max_gross_notional=settings.max_gross_exposure_usd,
        ) if cov else None
        if not proposal:
            await self.send_message(chat_id, text_card(
                "⚖️ Allocation", "NOT MEASURABLE",
                ["A flat book, or too little shared price history to build a covariance.",
                 "Allocation needs a covariance, and a covariance needs history."],
                source="quant_risk · risk-based", next_commands="/positions · /rebalance"), reply_markup=switch)
            return

        lines = [f"<b>Method: {esc(proposal.method.replace('_', ' '))}</b>", "",
                 "<b>SYMBOL     NOW  TARGET   DRIFT</b>"]
        for target in proposal.targets:
            cap = " ⚠" if target.clipped_by else ""
            lines.append(
                f"<code>{esc(f'{target.symbol[:9]:<9}')}</code> "
                f"<code>{target.current_weight:>5.0%}</code> "
                f"<code>{target.target_weight:>6.0%}</code> "
                f"<code>{target.drift:>+6.1%}</code>{cap}"
            )
        trades = rebalance_trades(proposal, positions, drift_band=0.05)
        if trades:
            lines += ["", "<b>Trades outside a 5% band</b>"]
            for trade in trades:
                lines.append(f"  {trade['side']} <code>{_money(trade['notional'])}</code> {esc(trade['symbol'])}")
        else:
            lines += ["", "<i>Everything is inside a 5% drift band — trading it would cost more than the drift.</i>"]
        lines.append("<i>Risk-based only, and nothing here is sent — a proposal, not an instruction.</i>")
        chart = generate_paired_bars_png(
            f"Current vs target notional · {proposal.method.replace('_', ' ')}",
            [target.symbol for target in proposal.targets],
            [_finite(target.current_notional) for target in proposal.targets],
            [_finite(target.target_notional) for target in proposal.targets],
            "Current", "Target", "Notional (USD)", value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("allocation", chart)] if chart else [], caption=text_card(
            "⚖️ Allocation", "PROPOSAL", lines,
            source="quant_risk · risk-based", next_commands="/rebalance · /exposure · /riskcontrib"), reply_markup=switch)

    async def _cmd_performance(self, args, chat_id, actor) -> None:
        """Realised P&L and fees by strategy sleeve, replayed from fills."""
        from modules.portfolio import realized_pnl_by_strategy

        sleeves = realized_pnl_by_strategy(self.audit) if self.audit else {}
        rows = sorted(sleeves.values(), key=lambda sleeve: -float(sleeve.get("realized_pnl") or 0.0))
        if not rows:
            await self.send_message(chat_id, text_card(
                "📈 Performance", "NO FILLS",
                ["No accepted fills recorded, so there is no realised P&L to attribute.",
                 "<i>An empty record, not a flat result.</i>"],
                source="audit · replayed fills", next_commands="/attribution · /pnl"))
            return
        lines = ["<b>STRATEGY      P&amp;L        FEES  WIN%</b>"]
        for row in rows[:8]:
            name = str(row.get("strategy"))[:12]
            win = row.get("win_rate")
            win_txt = _percent(win, 0) if win is not None else "—"
            flag = " •" if row.get("has_open_inventory") else ""
            lines.append(
                f"<code>{esc(f'{name:<12}')}</code> "
                f"<code>{_money(row.get('realized_pnl'), signed=True):>9}</code> "
                f"<code>{_money(row.get('fees')):>7}</code> <code>{win_txt}</code>{flag}"
            )
        lines.append("<i>Realised on closed quantity only; open inventory (•) is carried at cost, not marked.</i>")
        names = [str(row.get("strategy")) for row in rows[:8]]
        charts: list[tuple[str, bytes]] = []
        pnl_bars = generate_bars_chart_png(
            "Realised P&L by strategy (USD)", names,
            [_finite(row.get("realized_pnl")) for row in rows[:8]],
            "P&L (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        if pnl_bars:
            charts.append(("performance-pnl", pnl_bars))
        fee_bars = generate_bars_chart_png(
            "Fees by strategy (USD)", names,
            [_finite(row.get("fees")) for row in rows[:8]],
            "Fees (USD)", colours=["#f59e0b"] * len(names), horizontal=True, value_fmt="{:,.0f}",
        )
        if fee_bars:
            charts.append(("performance-fees", fee_bars))
        await self.send_media_group(chat_id, charts, caption=text_card(
            "📈 Performance", "AUDIT-REPLAYED", lines,
            source="audit · realized_pnl_by_strategy", next_commands="/attribution · /pnl · /costs"))
