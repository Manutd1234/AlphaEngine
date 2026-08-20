"""Risk manager — Monte Carlo and beta."""

from __future__ import annotations

from config import settings
from modules.telegram.format import _finite, _money, _number, esc, text_card
from modules.telegram.keyboards import _choice_row, _symbol_row, cb, kb
from modules.telegram_charts import generate_cone_png, generate_histogram_png, generate_scatter_png


class MonteCarloMixin:
    # ------------------------------------------------------------------ #
    # Risk manager — Monte Carlo and beta
    # ------------------------------------------------------------------ #
    async def _cmd_montecarlo(self, args, chat_id, actor) -> None:
        """A bootstrapped cone of where the book lands over a horizon. Read-only."""
        from modules.quant_risk import bootstrap_terminal_distribution, historical_var

        horizons = {"1": 1, "5": 5, "20": 20}
        horizon = horizons.get(args[0], 5) if args else 5
        # Second argument selects the resampler. 1 (the default) is the i.i.d.
        # draw this command has always reported; above it, the stationary
        # bootstrap the workspace's cone uses. Reported in the card either way,
        # because two runs that used different resamplers are not comparable.
        block = 1
        if len(args) > 1:
            requested = _finite(args[1])
            if requested is None or requested < 1 or requested > 100:
                raise ValueError("block length must be between 1 and 100 bars")
            block = int(requested)
        switch = kb([_choice_row("montecarlo", [("1d", "1"), ("5d", "5"), ("20d", "20")], str(horizon))])
        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        hv = historical_var(positions, returns, equity) if positions else None
        book_returns = list(hv.daily_pnl) if hv else []
        mc = (bootstrap_terminal_distribution(book_returns, horizon, mean_block_length=block)
              if book_returns else None)
        if not mc:
            await self.send_message(chat_id, text_card(
                f"🎲 Monte Carlo · {horizon}d", "NOT AVAILABLE",
                ["A flat book, or fewer than 60 aligned bars of book history to resample.",
                 "The cone bootstraps the daily P&L the book actually lived through, and needs that history to exist."],
                source="quant_risk · bootstrap", next_commands="/var · /positions"), reply_markup=switch)
            return

        cushion = _finite(report["risk_budget"]["daily_drawdown"].get("cushion_usd"))
        lines = [
            f"Horizon    <code>{mc.horizon}</code> bars · <code>{mc.paths:,}</code> paths · <code>{mc.observations}</code> obs",
            f"Resampler  <code>{'i.i.d.' if mc.mean_block_length == 1 else f'blocks of ~{mc.mean_block_length}'}</code>",
            f"Median     <code>{_money(mc.p50[-1], signed=True)}</code> terminal P&amp;L",
            f"VaR 95     <code>{_money(mc.var95)}</code> · CVaR 95 <code>{_money(mc.cvar95)}</code>",
            f"P5 / P95   <code>{_money(mc.p5[-1], signed=True)}</code> / <code>{_money(mc.p95[-1], signed=True)}</code>",
        ]
        if cushion is not None and cushion > 0:
            trip = " · <i>a 95% loss would trip it</i>" if mc.var95 >= cushion else ""
            lines.append(f"Cushion    <code>{_money(cushion)}</code> to the drawdown breaker{trip}")
        lines.append(
            "<i>I.i.d. bootstrap: it resamples days independently, so it has no "
            "volatility clustering and understates a sustained run of losses. "
            "Reported beside the historical figure, never instead of it.</i>"
            if mc.mean_block_length == 1 else
            f"<i>Stationary bootstrap, blocks of ~{mc.mean_block_length} bars: it keeps the "
            "clustering an i.i.d. draw destroys, which widens the tail where losses "
            "arrive in runs. Reported beside the historical figure, never instead of it.</i>"
        )

        cone = generate_cone_png(
            f"Terminal-P&L cone · {mc.horizon}d",
            list(mc.p5), list(mc.p25), list(mc.p50), list(mc.p75), list(mc.p95),
        )
        markers = [("VaR 95", -mc.var95, "#e8ab3d"), ("CVaR 95", -mc.cvar95, "#f0737c")]
        if cushion is not None and cushion > 0:
            markers.append(("Cushion", -cushion, "#38bdf8"))
        hist = generate_histogram_png(
            f"Terminal P&L · {mc.paths:,} paths", list(mc.terminal_pnl), "Terminal P&L (USD)", markers,
        )
        charts = [(name, blob) for name, blob in (("mc-cone", cone), ("mc-terminal", hist)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            f"🎲 Monte Carlo · {mc.horizon}d", "BOOTSTRAP", lines,
            source=f"quant_risk · {'i.i.d.' if mc.mean_block_length == 1 else 'stationary'} bootstrap", next_commands="/var · /stress · /varbacktest"), reply_markup=switch)

    async def _cmd_beta(self, args, chat_id, actor) -> None:
        """Beta and hedge ratio of a symbol against a reference, from returns."""
        from modules.quant_risk import beta as compute_beta
        from modules.quant_risk import returns_from_closes

        symbol = self._symbol(args)
        default_ref = "BTCUSDT" if symbol != "BTCUSDT" else "ETHUSDT"
        ref = self._symbol(args, 1) if len(args) > 1 else default_ref
        tracked = [value.upper() for value in settings.symbols][:6]
        ref_row = [(f"• {sym}" if sym == ref else sym, cb("beta", symbol, sym)) for sym in tracked]
        footer = kb([_symbol_row("beta", symbol, ref), ref_row])

        if symbol == ref:
            await self.send_message(chat_id, text_card(
                f"🧮 Beta · {esc(symbol)} vs {esc(ref)}", "NOT MEASURABLE",
                ["A symbol is its own reference — beta against itself is 1 by definition.",
                 "Give a different reference, e.g. <code>/beta ETHUSDT BTCUSDT</code>."],
                source="quant_risk", next_commands="/correlation · /stress"), reply_markup=footer)
            return

        def asset_of(instrument: str) -> str:
            return "crypto" if instrument.endswith(("USDT", "-USD")) else "equity"

        closes_sym = await self._closes_for(symbol, asset_of(symbol), "1d", 150)
        closes_ref = await self._closes_for(ref, asset_of(ref), "1d", 150)
        n = min(len(closes_sym), len(closes_ref))
        rets: dict[str, list[float]] = {}
        if n >= 21:
            rets = {
                symbol: returns_from_closes(closes_sym[-n:]),
                ref: returns_from_closes(closes_ref[-n:]),
            }
        value = compute_beta(symbol, ref, rets) if rets else None
        if value is None:
            await self.send_message(chat_id, text_card(
                f"🧮 Beta · {esc(symbol)} vs {esc(ref)}", "NOT MEASURABLE",
                [f"Fewer than 20 aligned daily returns for {esc(symbol)} and {esc(ref)}.",
                 "Beta is a regression, and a regression needs a shared history to run on."],
                source="quant_risk", next_commands="/correlation · /stress"), reply_markup=footer)
            return

        lines = [
            f"Symbol     <code>{esc(symbol)}</code>",
            f"Reference  <code>{esc(ref)}</code>",
            f"Beta       <code>{_number(value, 3)}</code> over <code>{len(rets[symbol])}</code> aligned returns",
            f"Hedge      <code>{_number(-value, 3)}</code> units of {esc(ref)} per unit {esc(symbol)} to neutralise",
        ]
        lines.append("<i>β is the slope of the symbol's returns on the reference's — a measurement, not 1.0 by assumption. An unmeasurable beta is left flat rather than guessed.</i>")
        scatter = generate_scatter_png(
            f"{symbol} vs {ref} daily returns", rets[ref], rets[symbol],
            f"{ref} return", f"{symbol} return", fit_line=True,
        )
        await self.send_media_group(chat_id, [("beta", scatter)] if scatter else [], caption=text_card(
            f"🧮 Beta · {esc(symbol)} vs {esc(ref)}", "MEASURED", lines,
            source="quant_risk · returns regression", next_commands="/correlation · /stress · /montecarlo"), reply_markup=footer)
