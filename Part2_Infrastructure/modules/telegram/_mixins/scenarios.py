"""Quant risk (read-only), continued — rebalance, stress, VaR backtest, regime, sizing."""

from __future__ import annotations

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _INTERVALS, _choice_row, _interval_row, kb
from modules.telegram_charts import generate_bars_chart_png, generate_var_breach_png


class ScenariosMixin:
    async def _cmd_rebalance(self, args, chat_id, actor) -> None:
        """Target weights and the trades that would reach them. Read-only."""
        from modules.quant_risk import propose_allocation, rebalance_trades

        # Aliased rather than matched exactly: a phone keyboard is a bad place to
        # type "min_variance", and an unrecognised word falls back to inverse-vol
        # in the engine, which would silently answer a different question from
        # the one that was asked.
        aliases = {
            "ew": "equal_weight", "equalweight": "equal_weight", "equal_weight": "equal_weight",
            "iv": "inverse_vol", "invvol": "inverse_vol", "inverse_vol": "inverse_vol",
            "erc": "equal_risk", "equalrisk": "equal_risk", "equal_risk": "equal_risk",
            "mv": "min_variance", "minvar": "min_variance", "min_variance": "min_variance",
        }
        method = aliases.get(args[0].lower(), "inverse_vol") if args else "inverse_vol"
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
                "⚖️ Rebalance", "NOT MEASURABLE",
                ["A flat book, or too little shared price history to measure volatility.",
                 "Allocation needs a covariance, and a covariance needs history."],
                source="quant_risk", next_commands="/positions · /var"))
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
                lines.append(
                    f"  {trade['side']} <code>{_money(trade['notional'])}</code> {esc(trade['symbol'])}"
                )
        else:
            lines += ["", "<i>Everything is inside a 5% drift band — trading it would cost more than the drift.</i>"]

        if proposal.clipped:
            lines.append("<i>⚠ A target was capped by a risk limit, so the weights no longer sum to one.</i>")
        lines.append("<i>Risk-based only: no expected return is forecast. This is a proposal, not an instruction — "
                     "nothing here is sent.</i>")

        await self.send_message(chat_id, text_card(
            "⚖️ Rebalance", "PROPOSAL", lines,
            source="quant_risk · risk-based", next_commands="/exposure · /riskcontrib · /stress"))

    async def _cmd_stress(self, args, chat_id, actor) -> None:
        """Scenario loss on the book as it stands, with distance to the halt."""
        from modules.quant_risk import SCENARIOS, apply_scenario, run_scenarios

        requested = args[0].lower() if args else None
        switch = kb([_choice_row(
            "stress",
            [(key.replace("_", " ").title(), key) for key in SCENARIOS] + [("-12%", "-12")],
            requested or "",
        )])
        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        if not positions:
            await self.send_message(chat_id, text_card(
                "🌩 Stress test", "FLAT BOOK",
                ["Nothing is at risk, so every scenario is a zero."],
                source="quant_risk", next_commands="/positions · /var"), reply_markup=switch)
            return

        if requested and requested not in SCENARIOS:
            # A percentage is accepted as an ad-hoc shock, because the question
            # is usually "what if BTC drops 12%" rather than a named regime.
            try:
                move = float(requested.rstrip("%")) / 100.0
                results = [apply_scenario(positions, equity, {"BTCUSDT": move}, returns,
                                          scenario_id="custom", label=f"BTC {move:+.0%}")]
            except ValueError:
                await self.send_message(chat_id, text_card(
                    "🌩 Stress test", "UNKNOWN SCENARIO",
                    [f"Choose one of: <code>{esc(', '.join(SCENARIOS))}</code>",
                     "Or give a percentage, e.g. <code>/stress -12</code>."],
                    source="quant_risk", next_commands="/stress"), reply_markup=switch)
                return
        elif requested:
            spec = SCENARIOS[requested]
            results = [apply_scenario(positions, equity, spec["shocks"], returns,
                                      scenario_id=requested, label=str(spec["label"]))]
        else:
            results = run_scenarios(positions, equity, returns)

        # The number that decides whether a scenario matters: how much of the
        # loss the desk could absorb before the breaker halts it.
        cushion = float(report["risk_budget"]["daily_drawdown"].get("cushion_usd") or 0.0)
        lines = ["<b>SCENARIO             P&amp;L      OF EQUITY</b>"]
        for result in results:
            breach = " 🛑" if cushion > 0 and -result.total_pnl >= cushion else ""
            lines.append(
                f"<code>{esc(f'{result.label[:20]:<20}')}</code> "
                f"<code>{_money(result.total_pnl):>10}</code> "
                f"<code>{_percent(result.total_return):>7}</code>{breach}"
            )

        worst = results[0]
        lines.append("")
        lines.append(f"Cushion to halt <code>{_money(cushion)}</code>")
        if cushion > 0 and -worst.total_pnl >= cushion:
            lines.append(f"<i>🛑 {esc(worst.label)} would trip the drawdown breaker.</i>")
        unsupported = [leg.symbol for leg in worst.legs if leg.basis == "unsupported"]
        assumed = [leg.symbol for leg in worst.legs if leg.basis == "wildcard"]
        if unsupported:
            lines.append(
                f"<i>No measurable beta for {esc(', '.join(sorted(set(unsupported))))} — "
                "left flat, so the total above is understated by whatever they would have moved.</i>"
            )
        if assumed:
            lines.append(
                f"<i>{esc(', '.join(sorted(set(assumed))))} moved on the scenario's blanket shock, "
                "not on a measured beta — an assumption, not a measurement.</i>"
            )
        # Losses as positive bars so the tallest bar is the worst outcome —
        # the shape a reader expects from a stress chart.
        chart = generate_bars_chart_png(
            "Scenario loss on the book as it stands",
            [result.label for result in results],
            [-float(result.total_pnl) for result in results],
            "Loss (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("stress", chart)] if chart else [], caption=text_card(
            "🌩 Stress test", "LIVE BOOK", lines,
            source="quant_risk · measured betas", next_commands="/var · /riskcontrib · /headroom"), reply_markup=switch)

    async def _cmd_varbacktest(self, args, chat_id, actor) -> None:
        """Has the VaR the desk quotes actually been right?"""
        from modules.quant_risk import rolling_var_backtest, rolling_var_path

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        switch = kb([_choice_row("varbacktest", [(value, value) for value in _INTERVALS], interval)])
        report, _cov, returns = await self._risk_inputs(interval)
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        result = rolling_var_backtest(positions, returns, equity) if positions else None

        if not result:
            await self.send_message(chat_id, text_card(
                "🧪 VaR backtest", "NOT MEASURABLE",
                ["A flat book, or fewer than 80 aligned bars per held symbol.",
                 "The forecast is re-fitted on a rolling window and scored on the next bar, "
                 "so it needs history on both sides."],
                source="quant_risk · Kupiec POF", next_commands="/var · /positions"), reply_markup=switch)
            return

        flag = {"green": "🟢", "yellow": "🟡", "red": "🔴"}[result.zone]
        lines = [
            f"Zone        {flag} <code>{result.zone.upper()}</code>",
            f"Exceptions  <code>{result.exceptions}</code> of <code>{result.observations}</code> "
            f"(expected <code>{result.expected_exceptions}</code>)",
            f"Rate        <code>{_percent(result.exception_rate)}</code> vs the 5% claim",
            f"Kupiec p    <code>{_number(result.kupiec_p_value)}</code>",
            "",
            f"<i>{esc(result.verdict)}</i>",
        ]
        # The same rolling forecast the Kupiec test scored, drawn bar-for-bar so a
        # reader can see where the losses broke through the -VaR line.
        path = rolling_var_path(positions, returns, equity)
        chart = generate_var_breach_png(
            f"Rolling VaR backtest · {interval}", *path,
        ) if path else None
        await self.send_media_group(chat_id, [("varbacktest", chart)] if chart else [], caption=text_card(
            "🧪 VaR backtest", "MODEL VALIDATION", lines,
            source="quant_risk · Kupiec POF", next_commands="/var · /stress"), reply_markup=switch)

    async def _cmd_regime(self, args, chat_id, actor) -> None:
        from modules.quant_risk import returns_from_closes, volatility_regime

        symbol, interval, count, asset = self._bar_args(args)
        keyboard = kb([_interval_row("regime", symbol, interval, str(count))])
        payload = await self._bars_payload(symbol, interval, max(count, 120), asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        closes = [float(r["close"]) for r in rows if _finite(r.get("close")) is not None]
        regime = volatility_regime(returns_from_closes(closes), interval=interval) if len(closes) > 45 else None
        if not regime:
            await self.send_message(chat_id, self._openbb_error("regime", payload if not payload.get("ok") else {"error": "at least 45 bars are required"}), reply_markup=keyboard)
            return
        lines = [
            f"Regime      <code>{regime.regime}</code>",
            f"Current vol <code>{_percent(regime.current_vol)}</code> annualised",
            f"Baseline    <code>{_percent(regime.baseline_vol)}</code> · ratio <code>{_number(regime.ratio)}x</code>",
            f"Percentile  <code>{_percent(regime.percentile)}</code> of its own history",
            f"<i>{esc(regime.note)}</i>",
        ]
        await self.send_message(chat_id, text_card(f"🌡 {symbol} volatility regime", f"{regime.observations} WINDOWS · {interval}", lines, source="quant_risk", next_commands=f"/range {symbol} · /var"), reply_markup=keyboard)

    async def _cmd_size(self, args, chat_id, actor) -> None:
        from modules.quant_risk import kelly_fraction

        if len(args) < 2:
            await self.send_message(chat_id, text_card("📐 Position sizing", "USAGE", ["<code>/size WIN_RATE PAYOFF [EQUITY]</code>", "Example <code>/size 0.55 1.8</code>", "Win rate as a fraction, payoff as avg win ÷ avg loss."], source="quant_risk", next_commands="/backtests"))
            return
        try:
            win_rate = float(args[0])
            payoff = float(args[1])
        except ValueError:
            await self.send_message(chat_id, text_card("📐 Position sizing", "BAD INPUT", ["Win rate and payoff must be numbers."], source="quant_risk", next_commands="/help size"))
            return
        equity = float(args[2]) if len(args) > 2 and args[2].replace(".", "", 1).isdigit() else float(self._portfolio_report()["equity"]["current"] or 0.0)
        sizing = kelly_fraction(win_rate, payoff, equity)
        lines = [
            f"Full Kelly  <code>{_percent(sizing.full_kelly)}</code>",
            f"Recommended <code>{_percent(sizing.recommended_fraction)}</code> · <code>{_money(sizing.recommended_notional)}</code>",
            f"Edge/trade  <code>{_number(sizing.edge_per_trade, 3, signed=True)}</code>",
            f"On equity   <code>{_money(equity)}</code>",
            f"<i>{esc(sizing.note)}</i>",
        ]
        await self.send_message(chat_id, text_card("📐 Kelly sizing", "QUARTER KELLY" if not sizing.capped_by else sizing.capped_by.upper().replace("_", " "), lines, source="quant_risk", next_commands="/headroom · /limits"))
