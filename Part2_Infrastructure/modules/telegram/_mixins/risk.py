"""Quant risk (read-only) — VaR, risk contributions and correlation."""

from __future__ import annotations

from typing import Any

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _INTERVALS, _choice_row, kb
from modules.telegram_charts import generate_bars_chart_png, generate_heatmap_png, generate_histogram_png


class RiskMixin:
    # ------------------------------------------------------------------ #
    # Quant risk (read-only)
    # ------------------------------------------------------------------ #
    async def _latest_backtest_result(self, symbol: str, strategy: str | None = None) -> dict[str, Any] | None:
        """The newest in-process completed backtest for a symbol, or None.

        Scans the shared jobs engine for a succeeded ``backtest`` whose request
        matches ``symbol`` (and ``strategy`` when given), newest ``finished_at``
        first. Only runs completed *in this process* carry the fold detail —
        ``walk_forward``, ``heatmap_png``, the DSR family — because the audit
        history keeps the headline numbers but not those. Callers fall back to
        the audit rows with an honest note when this returns None.
        """
        jobs = getattr(self.queue, "_jobs", None)
        if not jobs:
            return None
        wanted = symbol.upper()
        best: dict[str, Any] | None = None
        best_at = None
        for job in jobs.values():
            if getattr(job, "kind", None) != "backtest" or getattr(job, "status", None) != "succeeded":
                continue
            result = getattr(job, "result", None)
            if not isinstance(result, dict):
                continue
            request = result.get("request") or {}
            meta = getattr(job, "meta", {}) or {}
            job_symbol = str(request.get("symbol") or meta.get("symbol") or "").upper()
            if job_symbol != wanted:
                continue
            if strategy and str(request.get("strategy") or "").lower() != strategy.lower():
                continue
            finished = getattr(job, "finished_at", None) or getattr(job, "submitted_at", None)
            if best_at is None or (finished is not None and finished > best_at):
                best, best_at = result, finished
        return best

    async def _risk_inputs(self, interval: str, bars: int = 180):
        """
        Bars for every symbol currently held, plus the book they belong to.

        Returns ``(report, covariance, returns_by_symbol)``. The covariance can
        be ``None`` — a flat book has no risk to decompose and too little shared
        history cannot produce one — and callers say which of those happened
        rather than printing zeros. The raw returns come back too, because
        historical VaR and the scenario betas need the series itself, not its
        second moment. ``bars`` bounds the history fetched per symbol.
        """
        from modules.quant_risk import build_covariance, returns_from_closes

        bars = max(60, min(1000, int(bars)))
        report = self._portfolio_report()
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        if not positions:
            return report, None, {}

        returns: dict[str, list[float]] = {}
        held = {str(p["symbol"]) for p in positions[:8]}
        # The scenario reference is fetched even when it is not held: without it
        # every unheld position has no measurable beta and a stress test would
        # report a flat book under a market-wide shock.
        for symbol in sorted(held | {"BTCUSDT"}):
            payload = await self._bars_payload(symbol, interval, bars, "crypto")
            rows = payload.get("data") or [] if payload.get("ok") else []
            closes = [float(r["close"]) for r in rows if _finite(r.get("close")) is not None]
            if len(closes) >= 30:
                returns[symbol] = returns_from_closes(closes)
        held_returns = {s: r for s, r in returns.items() if s in held}
        return report, build_covariance(held_returns, interval), returns

    async def _cmd_var(self, args, chat_id, actor) -> None:
        from modules.quant_risk import historical_var, portfolio_risk

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        switch = kb([_choice_row("var", [(value, value) for value in ("1h", "4h", "1d")], interval)])
        report, cov, returns = await self._risk_inputs(interval)
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card("📉 Portfolio VaR", "NOT MEASURABLE", ["A flat book, or too little shared price history to build a covariance.", "VaR needs at least 30 aligned bars per held symbol."], source="quant_risk", next_commands="/exposure · /positions"), reply_markup=switch)
            return
        lines = [
            f"Book vol    <code>{_percent(risk.annualised_volatility)}</code> annualised",
            f"VaR 95 1d   <code>{_money(risk.var95)}</code> · <code>{_percent(risk.var95 / equity if equity else 0)}</code> of equity",
            f"CVaR 95     <code>{_money(risk.cvar95)}</code> average loss beyond it",
            f"Window      <code>{risk.observations}</code> {interval} bars",
        ]

        # The empirical figure beside the parametric one. Where they diverge is
        # the fat tail the normal assumption cannot see, and that gap is the
        # most useful number on this card.
        empirical = historical_var(report["exposure"]["positions"], returns, equity)
        if empirical:
            lines.append(
                f"Historical  <code>{_money(empirical.var95)}</code> VaR · "
                f"<code>{_money(empirical.cvar95)}</code> CVaR"
            )
            if empirical.var95 > risk.var95 * 1.25:
                lines.append("<i>The empirical tail is materially worse than the normal model — size on the historical figure.</i>")

        budget = settings.var_budget_pct
        if budget > 0 and equity > 0:
            used = risk.var95 / (equity * budget)
            flag = "🔴" if used >= 1.0 else "🟡" if used >= 0.8 else "🟢"
            lines.append(
                f"VaR budget  {flag} <code>{_percent(used)}</code> of "
                f"<code>{_percent(budget)}</code> equity tolerance"
            )

        if risk.diversification_ratio:
            lines.append(f"Diversif.   <code>{_number(risk.diversification_ratio)}x</code> vs the weighted parts")
        lines.append("<i>The budget is advisory: VaR needs history, so it is reported and never used to block an order.</i>")

        # The distribution the two quantiles were read off. Drawn only when the
        # empirical replay ran — the parametric figure alone has no sample to
        # show, and a normal curve here would illustrate the assumption rather
        # than the book.
        charts: list[tuple[str, bytes]] = []
        if empirical and empirical.daily_pnl:
            histogram = generate_histogram_png(
                f"Replayed daily P&L · {empirical.observations} observations",
                list(empirical.daily_pnl),
                "Daily P&L (USD)",
                [("VaR 95", -empirical.var95, "#e8ab3d"), ("CVaR 95", -empirical.cvar95, "#f0737c")],
            )
            if histogram:
                charts.append(("var-distribution", histogram))

        await self.send_media_group(chat_id, charts, caption=text_card("📉 Portfolio VaR", "LIVE BOOK", lines, source="quant_risk · parametric", next_commands="/riskcontrib · /correlation · /stress · /varbacktest"), reply_markup=switch)

    async def _cmd_riskcontrib(self, args, chat_id, actor) -> None:
        from modules.quant_risk import portfolio_risk

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        switch = kb([_choice_row("riskcontrib", [(value, value) for value in _INTERVALS], interval)])
        report, cov, returns = await self._risk_inputs(interval)
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card("🎯 Risk contribution", "NOT MEASURABLE", ["A flat book, or too little shared price history."], source="quant_risk", next_commands="/exposure"), reply_markup=switch)
            return
        lines = ["<b>SYMBOL      NOTIONAL   RISK</b>"]
        for c in risk.contributions:
            tag = " hedge" if c.contribution_share < 0 else ""
            lines.append(f"{esc(c.symbol):<11} <code>{_percent(c.share_of_gross)}</code>  <code>{_percent(c.contribution_share)}</code>{tag}")
        lines.append("<i>Share of notional is not share of risk. A hedge contributes a negative amount.</i>")
        chart = generate_bars_chart_png(
            "Share of portfolio risk by symbol",
            [c.symbol for c in risk.contributions],
            [float(c.contribution_share) * 100 for c in risk.contributions],
            "Risk contribution (%)", horizontal=True, value_fmt="{:,.1f}%",
        )
        await self.send_media_group(chat_id, [("risk-contribution", chart)] if chart else [], caption=text_card("🎯 Risk contribution", f"{risk.observations} {interval.upper()} BARS", lines, source="quant_risk", next_commands="/var · /correlation"), reply_markup=switch)

    async def _cmd_correlation(self, args, chat_id, actor) -> None:
        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        bars = next((max(60, min(1000, int(token))) for token in args if token.isdigit()), 180)
        switch = kb([_choice_row("correlation", [(value, value) for value in _INTERVALS], interval)])
        _, cov, _returns = await self._risk_inputs(interval, bars)
        if not cov or len(cov.symbols) < 2:
            await self.send_message(chat_id, text_card("🔗 Correlation", "NOT MEASURABLE", ["Two or more held symbols with shared history are required."], source="quant_risk", next_commands="/exposure"), reply_markup=switch)
            return
        head = "        " + " ".join(f"{s[:4]:>6}" for s in cov.symbols)
        lines = [f"<code>{esc(head)}</code>"]
        for i, symbol in enumerate(cov.symbols):
            row = " ".join(f"{cov.correlation[i][j]:>6.2f}" for j in range(len(cov.symbols)))
            lines.append(f"<code>{esc(f'{symbol[:6]:<7}')}{esc(row)}</code>")
        worst = max(
            ((cov.correlation[i][j], cov.symbols[i], cov.symbols[j])
             for i in range(len(cov.symbols)) for j in range(i + 1, len(cov.symbols))),
            default=(0.0, "", ""),
        )
        if worst[0] >= 0.8:
            lines.append(f"<i>⚠ {esc(worst[1])} and {esc(worst[2])} at {worst[0]:.2f} — close to one position of their combined size.</i>")
        lines.append(f"<i>Measured over {cov.observations} {interval} bars. Diversification is only real while these stay low.</i>")
        # The text matrix stays: it is the accessible form, and it is what a
        # reader quotes. The heatmap is the glance that finds the hot corner.
        heatmap = generate_heatmap_png(
            f"Correlation · {cov.observations} {interval} bars",
            [symbol[:8] for symbol in cov.symbols],
            [[float(value) for value in row] for row in cov.correlation],
        )
        await self.send_media_group(chat_id, [("correlation", heatmap)] if heatmap else [], caption=text_card("🔗 Correlation", "LIVE BOOK", lines, source="quant_risk", next_commands="/riskcontrib · /var"), reply_markup=switch)
