"""Risk ▸ Drivers and Risk ▸ Oracle VaR — the Euler decomposition and the in-database GBM check."""

from __future__ import annotations

from typing import Any, Mapping

from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _INTERVALS, _choice_row, kb
from modules.telegram_charts import generate_bars_chart_png, generate_paired_bars_png, generate_var_breach_png

# ``ExposureHeatmap``'s own threshold: above this share of its symbol limit a position is worth
# looking at, whatever its share of the book.
_TIGHT_UTILISATION = 0.75
# ``RiskContributions`` marks a row over- or under-risked when its share of risk and its share of
# the book disagree by more than ten points.
_DIVERGENCE = 0.10
# ``OracleVarPanel``'s request, verbatim: a modelled 8% expected annual return, 20,000 in-database
# paths, and a deadline longer than the gateway's 2.5s because several seconds is a correct answer
# from an Autonomous Database rather than a failure.
_GBM_ANNUAL_DRIFT = 0.08
_ORACLE_PATHS = 20_000
_ORACLE_DEADLINE_S = 9.0
#: The workspace's shared forward horizon, in days — one seg drives the bootstrap card and the
#: Oracle card, so the two loss estimates can never be read against each other on two clocks.
_HORIZON_CHOICES = ("1", "10", "30", "90")
#: The floor the web risk engine prints instead of a figure: a covariance needs at least this many
#: aligned observations per instrument.
_OBSERVATION_FLOOR = 20
#: This companion's own, stricter floor — ``_risk_inputs`` builds no return series below it.
_CLOSES_FLOOR = 30
#: ``_risk_inputs`` only fetches history for the largest held positions.
_COVARIANCE_POSITIONS = 8
_ZONE_FLAG = {"green": "🟢", "yellow": "🟡", "red": "🔴"}


def _utilisation(position: Mapping[str, Any]) -> float | None:
    """Share of its symbol limit this position has taken, or None when no limit is published.

    ``_headroom`` floors its published ``utilisation`` to 0.0 when the cap is zero, and "no limit
    published" is not "a limit sitting unused" — so an absent cap comes back missing, the way the
    exposure heatmap draws a dashed outline instead of a zero-length bar.
    """
    limit = position.get("symbol_limit") or {}
    cap = _finite(limit.get("limit"))
    return None if cap is None or cap <= 0 else _finite(limit.get("utilisation"))


def _worst_pair(cov: Any) -> tuple[float, str, str] | None:
    """The largest pairwise correlation in the book — the diversification check."""
    symbols = list(cov.symbols)
    if len(symbols) < 2:
        return None
    return max((cov.correlation[i][j], symbols[i], symbols[j])
               for i in range(len(symbols)) for j in range(i + 1, len(symbols)))


def _missing_history(positions: list[Mapping[str, Any]], measured: list[str]) -> list[str]:
    """Held symbols that never reached the covariance, so carry no measured risk anywhere above."""
    known = set(measured)
    return [str(p["symbol"]) for p in positions if str(p["symbol"]) not in known]


def _floor_lines(positions: list[Mapping[str, Any]], cov: Any, equity: float) -> list[str]:
    """Why no covariance could be measured — the reason, never a zero standing in for it."""
    if not positions:
        return ["The book is flat: there is nothing to decompose.",
                "<i>An empty book is an empty measurement, not a risk of zero.</i>"]
    if equity <= 0:
        return [f"<code>{len(positions)}</code> open position(s), but equity reads <code>{_money(equity)}</code>.",
                "<i>Risk is measured against the capital that absorbs the loss, so no weight can be formed at all.</i>"]
    if cov is None:
        return [
            f"A covariance could not be built over <code>{len(positions)}</code> open position(s).",
            f"<i>The floor the web risk engine states beside every withheld figure: at least {_OBSERVATION_FLOOR} aligned observations per instrument. Below it nothing is shown, rather than a number resting on an assumed correlation.</i>",
            f"<i>This companion is stricter still — it needs {_CLOSES_FLOOR} closes per held symbol before it will build a return series at all, then truncates every series to the shortest shared window rather than padding: a padded bar would enter as a zero-return day, understate that symbol's variance and pull every correlation toward one.</i>",
        ]
    return [
        "A covariance exists, but the book's variance did not come out positive.",
        "<i>Every held symbol sits outside the measured matrix, or the signed weights cancel exactly. Either way there is no volatility to split, and the split of nothing is not a column of zeros.</i>",
    ]


def _headline_lines(risk: Any, cov: Any, interval: str) -> list[str]:
    """The book-level figures the per-position decomposition splits."""
    diversification = (f"<code>{_number(risk.diversification_ratio)}x</code> vs the weighted parts"
                       if risk.diversification_ratio else "<code>—</code> not measurable on this book")
    return [
        f"Book vol    <code>{_percent(risk.annualised_volatility)}</code> annualised · <code>{_percent(risk.volatility, 3)}</code> per {esc(interval)} bar",
        f"VaR 95 1d   <code>{_money(risk.var95)}</code> — the figure the shares below split exactly",
        f"Diversif.   {diversification}",
        f"Window      <code>{risk.observations}</code> aligned {esc(interval)} bars across <code>{len(cov.symbols)}</code> instrument(s)",
    ]


def _visible_contributions(contributions: list[Any], limit: int = 6) -> tuple[list[Any], int]:
    """The largest drivers, keeping the largest hedge even when it falls past the cut.

    The list arrives sorted descending by risk share, so a plain head would drop exactly the
    negative contribution a notional table cannot produce at all.
    """
    if len(contributions) <= limit:
        return list(contributions), 0
    visible = list(contributions[:limit])
    if contributions[-1].contribution_share < 0:
        visible[-1] = contributions[-1]
    return visible, len(contributions) - limit


def _driver_lines(contributions: list[Any], by_symbol: Mapping[str, Any], risk: Any, annualisation: float) -> list[str]:
    """One block per position: size, risk share, standalone vol, marginal, VaR slice, limit."""
    lines: list[str] = []
    for row in contributions:
        position = by_symbol.get(row.symbol) or {}
        gap = row.contribution_share - row.share_of_gross
        if row.contribution_share < 0:
            tag = " · <b>hedge</b>, it takes risk out"
        elif abs(gap) > _DIVERGENCE:
            tag = f" · <b>{'over' if gap > 0 else 'under'}-risked</b> by {_number(gap * 100, 1, signed=True)}pp"
        else:
            tag = ""
        marginal = (row.marginal / risk.volatility * annualisation) if risk.volatility > 0 else None
        marginal_text = _percent(marginal / 100, 3, signed=True) if marginal is not None else "—"
        utilisation = _utilisation(position)
        if utilisation is None:
            limit_text = "<i>no symbol limit published — withheld, not a limit sitting unused</i>"
        else:
            limit_text = f"symbol limit <code>{_percent(utilisation, 0)}</code>{' ⚠' if utilisation >= _TIGHT_UTILISATION else ''}"
        lines += [
            f"<b>{esc(row.symbol)} · {esc(str(position.get('side') or '—'))}</b> <code>{_money(row.notional)}</code>",
            f"  Book <code>{_percent(row.share_of_gross, 1)}</code> · Risk <code>{_percent(row.contribution_share, 1)}</code>{tag}",
            f"  Standalone <code>{_percent(row.standalone_vol, 1)}</code> ann · marginal <code>{marginal_text}</code> annualised book vol per +1pp of signed weight",
            f"  Slice <code>{_money(row.contribution_share * risk.var95, signed=True)}</code> of VaR 95 · {limit_text}",
        ]
    return lines


def _book_caveats(risk: Any, cov: Any, omitted: int, interval: str) -> list[str]:
    """What the decomposition assumes, who hedges, and how correlated the book really is."""
    lines = ["<i>The shares sum to the book's total volatility by construction — the Euler decomposition, component_i = w_i·(Σw)_i — which is what makes this answer what to CUT rather than merely what is big. A ranking that does not sum to the total is not an attribution.</i>"]
    lines.append("<i>Marginal is ∂σ/∂w — what one more point of signed weight does to book volatility, given everything else the book holds. A short enters with a NEGATIVE weight, so its component flips the sign of its marginal; that is how a hedge reaches a negative contribution, and why weights are scaled by equity rather than by gross.</i>")
    hedges = [row.symbol for row in risk.contributions if row.contribution_share < 0]
    if hedges:
        lines.append(f"<i>Negative contribution — a hedge, taking risk OUT of the book: {esc(', '.join(hedges[:4]))}. A notional table cannot produce that number at all.</i>")
    if omitted:
        lines.append(f"<i>{omitted} smaller driver(s) are not listed; every one of them is inside the totals above.</i>")
    worst = _worst_pair(cov)
    if worst:
        corr, first, second = worst
        lines.append(f"{'⚠ ' if corr >= 0.8 else ''}Worst pair  <code>{esc(first)}</code>/<code>{esc(second)}</code> at <code>{_number(corr)}</code> over <code>{cov.observations}</code> {esc(interval)} bars")
        if corr >= 0.8:
            lines.append("<i>Close to one position of their combined size — the diversification this decomposition credits the book with is not really there.</i>")
    return lines


def _limit_caveats(positions: list[Mapping[str, Any]], measured: list[str]) -> list[str]:
    """Excluded history, the eight-position covariance cap, and limit pressure."""
    lines: list[str] = []
    missing = _missing_history(positions, measured)
    if missing:
        lines.append(f"<i>Excluded for want of price history: {esc(', '.join(missing[:6]))}. Total risk is understated by whatever those carry.</i>")
    if len(positions) > _COVARIANCE_POSITIONS:
        lines.append(f"<i>Only the {_COVARIANCE_POSITIONS} largest positions reach this companion's covariance; {len(positions) - _COVARIANCE_POSITIONS} smaller one(s) sit outside every figure above.</i>")
    tight = [str(p["symbol"]) for p in positions if (value := _utilisation(p)) is not None and value >= _TIGHT_UTILISATION]
    if tight:
        lines.append(f"<i>At or above {_percent(_TIGHT_UTILISATION, 0)} of their symbol limit: {esc(', '.join(tight[:6]))} — nearness to the cap the gate enforces, which share of gross never shows.</i>")
    withheld = sum(1 for p in positions if _utilisation(p) is None)
    if withheld:
        lines.append(f"<i>{withheld} position(s) carry no published symbol limit — reported missing, never drawn as a limit that is merely unused.</i>")
    return lines


def _oracle_input_lines(equity: float, risk: Any, horizon: int, interval: str) -> list[str]:
    """Every input the panel posts to the in-database procedure, with its provenance."""
    quantised = round(equity / 1_000) * 1_000 or equity
    return [
        f"Equity      <code>{_money(quantised)}</code> <i>— quantised to the nearest $1,000, as the panel does, so a book poll every 15s does not re-simulate on an equity tick</i>",
        f"Sigma       <code>{_percent(risk.annualised_volatility)}</code> annualised, measured over <code>{risk.observations}</code> {esc(interval)} bars — the same covariance /var reads",
        f"Drift       <code>{_percent(_GBM_ANNUAL_DRIFT)}</code> expected annual return — a MODELLED input, not a measurement, and the term that dominates a long horizon",
        f"Horizon     <code>{horizon}</code> days over a 365-day year",
        f"Request     <code>{_ORACLE_PATHS:,}</code> paths · <code>{_number(_ORACLE_DEADLINE_S, 1)}s</code> deadline <i>(longer than the gateway's 2.5s: seconds is a correct answer from an Autonomous Database, not a failure)</i>",
        "<i>A terminal-value GBM VaR over the horizon, NOT the one-day book VaR /var reports. They answer adjacent questions, and presenting them as one number with two sources would be the actual error.</i>",
    ]


def _withheld_lines() -> list[str]:
    """The two headline figures this process cannot produce, each with the reason it is missing."""
    return [
        "",
        "Oracle VaR 99   <code>—</code>",
        "<i>Not computed. The simulation runs inside Oracle 23ai and is reached by the web workspace's own route; this companion talks to the risk gateway and holds no database connection, so there is no figure to report. An unreached database is a different fact from a risk of nil — and /var's own figure is unaffected.</i>",
        "Parametric 99   <code>—</code>",
        "<i>The closed-form lognormal quantile the panel prices the simulation against lives in the web bundle and has no counterpart in this gateway's maths. Reported missing rather than re-derived here: a second copy of one formula, with no parity fixture holding it to the first, is exactly how two stacks start quietly disagreeing.</i>",
        "Divergence      <code>—</code>",
        "<i>A divergence needs two figures. With both withheld there is nothing to price, so it is left missing rather than shown as 0%.</i>",
    ]


def _bootstrap_lines(mc: Any, horizon: int) -> list[str]:
    """The estimate this process CAN make over the same horizon, named as a different method."""
    if mc is None:
        return ["", "Bootstrap 99    <code>—</code>",
                "<i>Fewer than 60 aligned bars of this book's own P&amp;L to resample, so the one estimate this process could have offered over the same horizon is missing too.</i>"]
    band = mc.loss_at(99.0)
    clamp = (f" (asked for {horizon}d; the bootstrap draws at most 60 bars, stated rather than silently rescaled)"
             if mc.horizon < horizon else "")
    resampler = "an i.i.d." if mc.resampler == "iid" else "a stationary"
    return [
        "",
        f"Bootstrap 99    <code>{_money(band.loss)}</code> loss · conditional <code>{_money(band.conditional_loss)}</code> beyond it",
        f"<i>What this process can measure over the same {mc.horizon}-bar horizon{clamp}: {esc(resampler)} bootstrap of the book's realised daily P&amp;L, {mc.paths:,} paths on {mc.observations} observations. A DIFFERENT estimator, not a substitute — it assumes no distribution where the GBM assumes lognormal, and an i.i.d. draw forgets the volatility clustering a real drawdown has.</i>",
    ]


def _kupiec_lines(result: Any) -> list[str]:
    """The exception scorecard, or the reason the forecast has never been scored."""
    if result is None:
        return ["", "<b>Backtest exceptions</b>  <code>NOT SCORED</code>",
                "<i>Fewer than 80 aligned bars per held symbol, or fewer than 20 scored bars. A VaR nobody has back-tested is an opinion with a confidence interval printed on it, so it is reported unscored rather than passed.</i>"]
    # Four significant figures, never four decimal places: a p of 1.7e-05 rounded
    # to 0.0000 reads as a certainty nothing here is entitled to claim.
    p_value = f"{result.kupiec_p_value:g}" if result.kupiec_p_value is not None else "—"
    return [
        "",
        f"<b>Backtest exceptions</b>  {_ZONE_FLAG.get(result.zone, '⚪')} <code>{esc(result.zone.upper())}</code>",
        f"Breached    <code>{result.exceptions}</code> of <code>{result.observations}</code> scored bars (expected <code>{result.expected_exceptions}</code>)",
        f"Rate        <code>{_percent(result.exception_rate)}</code> against the 5% claim · Kupiec p <code>{esc(p_value)}</code>",
        f"<i>{esc(result.verdict)} Scored on the next bar, never on data it was fitted to.</i>",
    ]


def _densest_cluster(breach: list[bool], window: int = 10) -> int:
    """The most breaches inside any ``window``-bar stretch — the exception rug, counted."""
    flags = [1 if flag else 0 for flag in breach]
    return max((sum(flags[index:index + window]) for index in range(len(flags))), default=0)


def _exception_ledger_lines(path: Any, z95: float) -> list[str]:
    """Every bar whose realised loss broke its own forecast, worst overshoot first."""
    if path is None:
        return ["<i>No per-bar series: the rolling forecast needs 80 aligned bars before it exists, so the exception bars cannot be listed.</i>"]
    pnl, var, breach = path
    days = [index for index, flag in enumerate(breach) if flag]
    lines: list[str] = []
    if not days:
        lines.append("<i>No bar in this window lost more than its own forecast. At 95% a model that is never breached is usually too wide, not safe — it holds capital against a risk it cannot measure.</i>")
    else:
        lines.append("<code>BAR    REALISED    FORECAST   OVERSHOOT      SIGMA</code>")
        worst = sorted(days, key=lambda index: var[index] + pnl[index])[:6]
        for index in sorted(worst):
            lines.append(f"<code>#{index:<5}{_money(pnl[index], signed=True):>11}{_money(-var[index], signed=True):>12}{_money(-pnl[index] - var[index]):>12}{_money(var[index] / z95):>11}</code>")
        if len(days) > len(worst):
            lines.append(f"<i>The {len(worst)} worst of {len(days)} exception bars, ranked by overshoot.</i>")
        lines.append(f"<i>The densest 10-bar stretch holds {_densest_cluster(list(breach))} of them. Kupiec scores unconditional coverage only: three breaches in a week and three across a year earn the same zone, and they are very different books.</i>")
    if len(pnl) < 60:
        lines.append(f"<i>{len(pnl)} scored bars is a thin sample for a one-in-twenty event — a green zone at this size is weak evidence, not a validation.</i>")
    return lines


class RiskDriversMixin:
    # ------------------------------------------------------------------ #
    # Risk ▸ Drivers — who is causing the book's volatility
    # ------------------------------------------------------------------ #
    async def _cmd_drivers(self, args, chat_id, actor) -> None:
        """The Euler decomposition per position: marginal, component, and which name dominates."""
        from modules.quant_risk import portfolio_risk

        interval = args[0] if args and args[0] in _INTERVALS else "1d"
        switch = kb([_choice_row("drivers", [(value, value) for value in _INTERVALS], interval)])
        report, cov, _returns = await self._risk_inputs(interval)
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(positions, cov, equity) if cov else None
        if not risk or not risk.contributions:
            await self.send_message(chat_id, text_card(
                "🧬 Risk drivers", "NOT MEASURABLE",
                ["The gateway reports notional, and notional is not risk — but splitting risk needs a covariance.",
                 *_floor_lines(positions, cov, equity)],
                source="quant_risk · Euler decomposition",
                next_commands="/riskcontrib · /exposure · /positions"), reply_markup=switch)
            return

        by_symbol = {str(p["symbol"]): p for p in positions}
        visible, omitted = _visible_contributions(risk.contributions)
        top = risk.contributions[0]
        lines = [
            *_headline_lines(risk, cov, interval),
            "",
            f"<b>Largest driver</b> {esc(top.symbol)} carries <code>{_percent(top.contribution_share, 1)}</code> of book volatility on <code>{_percent(top.share_of_gross, 1)}</code> of the book — <code>{_money(top.contribution_share * risk.var95)}</code> of the VaR 95 above.",
            "",
            *_driver_lines(visible, by_symbol, risk, cov.annualisation),
            "",
            *_book_caveats(risk, cov, omitted, interval),
            *_limit_caveats(positions, list(cov.symbols)),
        ]

        pressure = [(str(p["symbol"]), value) for p in positions if (value := _utilisation(p)) is not None]
        split = generate_paired_bars_png(
            f"Share of book vs share of risk · {interval}", [row.symbol for row in visible],
            [float(row.share_of_gross) * 100 for row in visible],
            [float(row.contribution_share) * 100 for row in visible],
            "Share of book", "Share of risk", "Per cent", value_fmt="{:,.1f}",
        )
        limits = generate_bars_chart_png(
            "Symbol-limit utilisation · the axis ends at the limit",
            [symbol for symbol, _ in pressure], [value * 100 for _, value in pressure],
            "Per cent of symbol limit", horizontal=True, value_fmt="{:,.0f}%",
        )
        charts = [(name, blob) for name, blob in (("drivers", split), ("limit-pressure", limits)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            "🧬 Risk drivers", f"{risk.observations} {interval.upper()} BARS · {len(risk.contributions)} POSITIONS",
            lines, source="quant_risk · Euler decomposition",
            next_commands="/riskcontrib · /correlation · /var · /headroom"), reply_markup=switch)

    # ------------------------------------------------------------------ #
    # Risk ▸ Oracle VaR — the in-database GBM check, and its exceptions
    # ------------------------------------------------------------------ #
    async def _cmd_oraclevar(self, args, chat_id, actor) -> None:
        """The in-database terminal-value GBM VaR panel, and the exception ledger behind it."""
        from modules.quant_risk import Z95, historical_var, portfolio_risk, rolling_var_backtest, rolling_var_path

        choice = args[0] if args and args[0] in _HORIZON_CHOICES else "30"
        horizon = int(choice)
        switch = kb([_choice_row("oraclevar", [(f"{days}d", days) for days in _HORIZON_CHOICES], choice)])
        report, cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(positions, cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card(
                f"🗄 In-database VaR check · {horizon}d", "WAITING FOR THE COVARIANCE",
                ["Both figures on this panel need the covariance model's measured volatility, and it could not be built.",
                 *_floor_lines(positions, cov, equity)],
                source="quant_risk · GBM terminal value",
                next_commands="/var · /montecarlo · /varbacktest"), reply_markup=switch)
            return

        empirical = historical_var(positions, returns, equity)
        path = rolling_var_path(positions, returns, equity)
        lines = [
            *_oracle_input_lines(equity, risk, horizon, "1d"),
            *_withheld_lines(),
            *_bootstrap_lines(empirical.bootstrap(horizon) if empirical else None, horizon),
            *_kupiec_lines(rolling_var_backtest(positions, returns, equity)),
            *_exception_ledger_lines(path, Z95),
        ]
        missing = _missing_history(positions, list(cov.symbols))
        if missing:
            lines.append(f"<i>{esc(', '.join(missing[:6]))} carried no usable price history, so realised losses are understated and exceptions are UNDERCOUNTED: this model looks better than it is.</i>")

        chart = generate_var_breach_png("Rolling VaR backtest · 1d", *path) if path else None
        await self.send_media_group(chat_id, [("oraclevar", chart)] if chart else [], caption=text_card(
            f"🗄 In-database VaR check · {horizon}d", "ORACLE NOT REACHED FROM THIS PROCESS", lines,
            source="quant_risk · GBM terminal value",
            next_commands="/var · /montecarlo · /varbacktest · /drivers"), reply_markup=switch)
