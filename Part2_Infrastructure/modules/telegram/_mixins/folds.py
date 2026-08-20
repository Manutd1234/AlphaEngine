"""Research fold detail (in-process backtest results) — walkforward, stability, overfit."""

from __future__ import annotations

from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _symbol_row, cb, kb
from modules.telegram_charts import generate_bars_chart_png, generate_gate_ladder_png, generate_paired_bars_png


class FoldsMixin:
    # ------------------------------------------------------------------ #
    # Research fold detail (in-process backtest results)
    # ------------------------------------------------------------------ #
    def _inprocess_fallback(self, symbol: str) -> tuple[str, list[str]]:
        """The honest note when no run for a symbol completed in this process.

        Fold detail lives only on runs completed here, so this states that and
        shows the audit history's headline numbers when there are any — never a
        blank that reads as "nothing was ever run".
        """
        rows = [
            row for row in (self.audit.recent_backtests(50) if self.audit else [])
            if str(row.get("symbol") or "").upper() == symbol.upper()
        ]
        lines = [
            "Fold detail (walk-forward, the parameter heatmap, the DSR family) is kept only "
            "for runs completed in this process; queue one with "
            f"<code>/backtest {esc(symbol)} 1h ma_cross</code>.",
        ]
        if rows:
            lines.append("")
            lines.append("<b>Audit history — headline numbers only</b>")
            for row in rows[:6]:
                lines.append(
                    f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('strategy'))}"
                    f" · Sharpe <code>{_number(row.get('sharpe'))}</code>"
                    f" · DSR <code>{_number(row.get('dsr'), 3)}</code>"
                    f" · OOS <code>{_number(row.get('oos_sharpe'))}</code>"
                )
        else:
            lines.append("")
            lines.append("<i>No run for this symbol in the audit log either.</i>")
        return "NOT IN THIS PROCESS", lines

    async def _cmd_walkforward(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Overfit", cb("overfit", symbol)), ("Stability", cb("stability", symbol)), ("Runs", cb("backtests"))],
            _symbol_row("walkforward", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"🔁 Walk-forward · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /backtests"), reply_markup=footer)
            return
        folds = result.get("walk_forward") or []
        request = result.get("request") or {}
        lines = [
            f"Study      <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Folds      <code>{len(folds)}</code> · aggregate OOS Sharpe <code>{_number(result.get('walk_forward_oos_sharpe'))}</code>",
            "",
            "<b>FOLD   IS      OOS</b>",
        ]
        for fold in folds:
            lines.append(
                f"<code>{esc(str(fold.get('fold'))):<4}</code> "
                f"<code>{_number(fold.get('is_sharpe'))}</code>  <code>{_number(fold.get('oos_sharpe'))}</code>"
            )
        lines.append("<i>In-sample beside out-of-sample: a fold whose OOS bar collapses next to its IS bar was fitted to its own training window.</i>")
        chart = generate_paired_bars_png(
            f"Walk-forward IS vs OOS Sharpe · {symbol}",
            [f"F{fold.get('fold')}" for fold in folds],
            [_finite(fold.get("is_sharpe")) for fold in folds],
            [_finite(fold.get("oos_sharpe")) for fold in folds],
            "In-sample", "Out-of-sample", "Sharpe",
        )
        await self.send_media_group(chat_id, [("walkforward", chart)] if chart else [], caption=text_card(
            f"🔁 Walk-forward · {esc(symbol)}", "IN-PROCESS RESULT", lines,
            source="jobs engine · walk_forward", next_commands=f"/overfit {symbol} · /stability {symbol}"), reply_markup=footer)

    async def _cmd_stability(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Walk-forward", cb("walkforward", symbol)), ("Overfit", cb("overfit", symbol)), ("Runs", cb("backtests"))],
            _symbol_row("stability", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"🗺 Stability · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /backtests"), reply_markup=footer)
            return
        top = result.get("top_results") or []
        best = result.get("best") or {}
        request = result.get("request") or {}
        lines = [
            f"Study    <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Best     <code>{best.get('fast')}/{best.get('slow')}</code> · Sharpe <code>{_number(best.get('sharpe'))}</code>",
            f"Combos   <code>{result.get('combos_tested')}</code> tested",
            "",
            "<b>TOP PARAMS   FAST/SLOW  SHARPE</b>",
        ]
        for row in top[:6]:
            lines.append(f"<code>{row.get('fast')}/{row.get('slow')}</code>  <code>{_number(row.get('sharpe'))}</code>")
        lines.append("<i>The heatmap is the run's own rendering — a broad bright plateau is a stable region; a lone bright cell is a parameter that got lucky.</i>")
        hero = self._decode_b64png(result.get("heatmap_png"))
        if hero is None:
            lines.append("<i>This run recorded no heatmap image.</i>")
        await self.send_media_group(chat_id, [("heatmap", hero)] if hero else [], caption=text_card(
            f"🗺 Stability · {esc(symbol)}", "IN-PROCESS RESULT", lines,
            source="jobs engine · parameter grid", next_commands=f"/walkforward {symbol} · /overfit {symbol}"), reply_markup=footer)

    async def _cmd_overfit(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Walk-forward", cb("walkforward", symbol)), ("Stability", cb("stability", symbol)), ("Decision", cb("decision", symbol))],
            _symbol_row("overfit", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"🎲 Overfit · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /backtests"), reply_markup=footer)
            return
        request = result.get("request") or {}
        lines = [
            f"Study     <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"DSR       <code>{_number(result.get('deflated_sharpe_ratio'), 3)}</code> · verdict <code>{esc(result.get('dsr_verdict') or '—')}</code>",
            f"PSR       <code>{_number(result.get('probabilistic_sharpe_ratio'), 3)}</code>",
            f"PBO       <code>{_percent(result.get('overfitting_probability'))}</code> probability of backtest overfitting",
            f"Min track <code>{_number(result.get('min_track_record_bars'), 0)}</code> bars for the Sharpe to be believed",
        ]
        folds = result.get("walk_forward") or []
        labels, values = [], []
        for fold in folds:
            rank = _finite(fold.get("oos_rank"))
            total = _finite(fold.get("combos_ranked"))
            if rank is None or not total or total <= 0:
                continue
            labels.append(f"F{fold.get('fold')}")
            values.append(rank / total * 100)
        lines.append("<i>Per-fold OOS rank of the in-sample-best parameters. 50% is a coin flip — a candidate that did not generalise sits near it.</i>")
        chart = generate_bars_chart_png(
            "OOS rank percentile per fold · 50% = coin flip", labels, values,
            "Percentile (%)", horizontal=True, value_fmt="{:.0f}%",
        )
        await self.send_media_group(chat_id, [("overfit", chart)] if chart else [], caption=text_card(
            f"🎲 Overfit · {esc(symbol)}", "IN-PROCESS RESULT", lines,
            source="jobs engine · DSR/PSR/PBO", next_commands=f"/decision {symbol} · /walkforward {symbol}"), reply_markup=footer)

    async def _cmd_decision(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        strategy = args[1].lower() if len(args) > 1 else None
        footer = kb([
            [("Overfit", cb("overfit", symbol)), ("Walk-forward", cb("walkforward", symbol)), ("Gates", cb("gates", symbol))],
            _symbol_row("decision", symbol),
        ])
        result = await self._latest_backtest_result(symbol, strategy)
        if not result:
            status, lines = self._inprocess_fallback(symbol)
            await self.send_message(chat_id, text_card(
                f"⚖️ Decision · {esc(symbol)}", status, lines,
                source="jobs engine", next_commands=f"/backtest {symbol} 1h ma_cross · /overfit {symbol}"), reply_markup=footer)
            return
        request = result.get("request") or {}
        dsr = _finite(result.get("deflated_sharpe_ratio"))
        oos = _finite(result.get("walk_forward_oos_sharpe"))
        pbo = _finite(result.get("overfitting_probability"))
        bars = _finite(request.get("bars")) or _finite(result.get("bars"))
        min_track = _finite(result.get("min_track_record_bars"))

        checks = [
            ("DSR ≥ 0.95", dsr is not None and dsr >= 0.95),
            ("OOS Sharpe > 0", oos is not None and oos > 0),
            ("PBO < 0.5", pbo is not None and pbo < 0.5),
            ("Bars ≥ min track", bars is not None and min_track is not None and bars >= min_track),
        ]
        promote = all(ok for _, ok in checks)
        lines = [
            f"Candidate <code>{esc(request.get('symbol'))} · {esc(request.get('strategy'))}</code>",
            f"DSR ≥ 0.95        {'✅' if checks[0][1] else '❌'} <code>{_number(dsr, 3)}</code>",
            f"OOS Sharpe &gt; 0    {'✅' if checks[1][1] else '❌'} <code>{_number(oos)}</code>",
            f"PBO &lt; 0.5         {'✅' if checks[2][1] else '❌'} <code>{_percent(pbo)}</code>",
            f"Bars ≥ min track  {'✅' if checks[3][1] else '❌'} <code>{_number(bars, 0)}</code> / <code>{_number(min_track, 0)}</code>",
        ]

        # Sizing — read the live caps the order would meet, not a recomputation.
        ladder_gates: list[tuple[str, float | None, float | None, bool]] = []
        state = self.gateway.state() if self.gateway else None
        if state is not None:
            sym_cap = _finite(state.limits.get("max_symbol_notional_usd"))
            held = next((p for p in state.positions if p.symbol == symbol), None)
            held_notional = abs(held.notional) if held else 0.0
            remaining = (sym_cap - held_notional) if sym_cap else None
            lines += [
                "",
                f"Verdict           <code>{'PROMOTE' if promote else 'HOLD'}</code>",
                f"Symbol limit left <code>{_money(remaining)}</code> of <code>{_money(sym_cap)}</code>",
                f"Max order notional <code>{_money(state.limits.get('max_order_notional_usd'))}</code>",
                "<i>Kelly payoff is not recorded on a run — use <code>/size WIN PAYOFF</code> for the fraction.</i>",
            ]
            if pbo is not None:
                ladder_gates.append(("PBO vs 0.5", pbo, 0.5, pbo < 0.5))
            if sym_cap:
                ladder_gates.append(("Symbol notional", held_notional, sym_cap, held_notional <= sym_cap))
        chart = generate_gate_ladder_png(f"Sizing headroom · {symbol}", ladder_gates)
        await self.send_media_group(chat_id, [("decision", chart)] if chart else [], caption=text_card(
            f"⚖️ Decision · {esc(symbol)}", "PROMOTE" if promote else "HOLD", lines,
            source="jobs engine + gateway limits", next_commands=f"/overfit {symbol} · /gates {symbol} · /size 0.55 1.8"), reply_markup=footer)
