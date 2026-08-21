"""Risk ▸ Scenarios in full — the shock set, every leg it moves, and the halt line.

The web tab's ``StressTest`` panel answers three things ``/stress`` only half
answers: *which* instrument carried the loss, *how* its move was decided, and
*how far* the shock carries the book toward the level that halts trading.

Nothing here re-derives a number. ``apply_scenario``, ``run_scenarios`` and
``volatility_regime`` come from ``modules.quant_risk`` — the reference
implementation the TypeScript is pinned against — and the halt level and cushion
come from ``modules.portfolio``'s risk budget. What this file adds is the
reading: the basis of every leg, and the reason any figure is withheld.
"""

from __future__ import annotations

from dataclasses import dataclass

from modules.telegram._common import _SYMBOL_RE
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _choice_row, cb, kb
from modules.telegram_charts import generate_bars_chart_png, generate_gate_ladder_png

#: Words meaning the engine's ``"*"`` key: ``*`` is legal typed but is outside
#: the callback-data grammar, so a button has to spell it.
_WILDCARD_WORDS = {"*", "all", "else", "other", "everything", "rest"}
_LEG_LIMIT = 8


@dataclass
class _ShockPlan:
    """What the arguments asked for, or why they could not be read."""

    scenario_id: str
    label: str
    description: str
    shocks: dict[str, float]
    #: Symbols set by hand, in the order given; empty for a named scenario.
    #: Sparse on purpose, as the web panel's record is: an absent symbol moves
    #: by its measured beta, one written at 0% is pinned flat. Seeding every
    #: position to zero would erase that distinction and pin the whole book.
    hand: list[str]
    reference: str
    error: str | None = None


def _ordinal(number: int) -> str:
    """``85th``, not ``85%`` — a percentile is a rank, and reading it as a share is the standard misreading."""
    if 11 <= number % 100 <= 13:
        return f"{number}th"
    return f"{number}{['th', 'st', 'nd', 'rd'][number % 10] if number % 10 < 4 else 'th'}"


def _parse_hand_shock(pair: str, shown: str):
    """``(symbol_or_star, move)`` for a ``NAME=PERCENT`` token, or a message saying why not."""
    name, _, value = pair.partition("=")
    move = _finite(value.strip().rstrip("%"))
    if move is None:
        return (f"<code>{esc(shown)}</code> is not a scenario, a symbol shock like <code>BTCUSDT=-20</code>, "
                "or a bare percentage like <code>-12</code>.")
    key = "*" if name.strip().lower() in _WILDCARD_WORDS else name.strip().upper()
    if key != "*" and not _SYMBOL_RE.fullmatch(key):
        return f"<code>{esc(name)}</code> is not a symbol."
    return key, move / 100.0


def _finalise_plan(scenarios, chosen: str, hand: dict[str, float], order: list[str], reference: str) -> _ShockPlan:
    if not _SYMBOL_RE.fullmatch(reference):
        return _ShockPlan("", "", "", {}, [], reference, error=f"<code>{esc(reference)}</code> is not a symbol.")
    if hand:
        plural = "" if len(order) == 1 else "s"
        return _ShockPlan("custom", f"Hand shocks · {len(order)} instrument{plural}",
                          "Hand-set moves, scored on the book as it stands.",
                          dict(hand), list(order), reference)
    # No key is hard-coded: the first entry is the engine's own default, which
    # is the one the web panel opens on.
    scenario_id = chosen or next(iter(scenarios))
    spec = scenarios[scenario_id]
    return _ShockPlan(scenario_id, str(spec["label"]), str(spec["description"]), dict(spec["shocks"]), [], reference)


def _parse_shock_args(args, scenarios, default_reference: str) -> _ShockPlan:
    """Read the argument grammar. Never raises — a bad token becomes a card."""
    reference, hand, order, chosen = default_reference, {}, [], ""
    for raw in args:
        token = str(raw).strip()
        lowered = token.lower()
        if lowered in scenarios:
            chosen = lowered
            continue
        if lowered.startswith(("ref=", "reference=")):
            reference = token.split("=", 1)[1].strip().upper()
            continue
        # A bare percentage shocks the reference: the question is usually "what
        # if it drops 12%", not "name me a regime".
        parsed = _parse_hand_shock(token if "=" in token else f"{reference}={token}", token)
        if isinstance(parsed, str):
            return _ShockPlan("", "", "", {}, [], reference, error=parsed)
        key, move = parsed
        if key not in hand:
            order.append(key)
        hand[key] = move
    return _finalise_plan(scenarios, chosen, hand, order, reference)


def _reference_move(shocks: dict[str, float], reference: str) -> float:
    """The move the reference itself takes — the lookup ``apply_scenario`` does internally.

    Read back rather than re-derived because ``ScenarioResult`` does not carry
    it, and the "not measurable" vs "not propagated" reading turns on it.
    """
    wildcard = shocks.get("*")
    return shocks.get(reference, wildcard if wildcard is not None else 0.0)


def _leg_source(leg, hand: list[str], reference_move: float) -> str:
    """How this instrument's move was decided — the web table's Source column."""
    if leg.basis == "beta":
        # `?? 0` here would print "β 0.00" for a beta that could not be
        # measured: an invention dressed as a measurement.
        return f"β {_number(leg.beta)}" if leg.beta is not None else "β —"
    if leg.basis == "explicit":
        return "pinned by hand" if leg.symbol in hand else "shocked directly"
    if leg.basis == "wildcard":
        return "blanket move, assumed"
    return "not measurable" if reference_move else "not propagated"


def _toward_halt(total_pnl: float, cushion: float | None) -> float | None:
    """Share of the cushion this shock consumes; None when there is no denominator."""
    if cushion is None:
        return None
    if cushion <= 0:
        return 1.0
    return max(0.0, min(1.0, -float(total_pnl) / cushion))


def _safe_cb(name: str, tokens: list[str]) -> str:
    """``cb`` with the arguments when they fit the 64-byte grammar, bare when not."""
    try:
        return cb(name, *tokens)
    except ValueError:
        return cb(name)


def _refresh_tokens(plan: _ShockPlan, default_reference: str) -> list[str]:
    tokens: list[str] = []
    if plan.reference != default_reference:
        tokens.append(f"ref={plan.reference}")
    for symbol in plan.hand:
        tokens.append(f"{'all' if symbol == '*' else symbol}={round(plan.shocks[symbol] * 100):g}")
    if not plan.hand and plan.scenario_id and plan.scenario_id != "custom":
        tokens.append(plan.scenario_id)
    return tokens


def _switch_keyboard(scenarios, plan: _ShockPlan, default_reference: str) -> dict:
    rows = [_choice_row("shock", [(key.replace("_", " ").title(), key) for key in scenarios],
                        "" if plan.hand else plan.scenario_id)]
    if plan.hand:
        rows.append([("✕ Clear hand shocks", cb("shock"))])
    rows.append([("↻ Refresh", _safe_cb("shock", _refresh_tokens(plan, default_reference))), ("⌂ Menu", cb("menu"))])
    return kb(rows)


def _usage_lines(scenarios) -> list[str]:
    return [
        f"Named      <code>{esc(', '.join(scenarios))}</code>",
        "Hand set   <code>BTCUSDT=-20 ETHUSDT=-12 all=-5</code>",
        "Reference  <code>ref=ETHUSDT</code>, written before any bare percentage",
        "Bare       <code>-12</code> — the reference alone, everything else by beta",
        "<i>Percentages are whole numbers: -20 means a 20% fall. A symbol written at 0 is pinned flat — a claim "
        "that it does not move. A symbol left out moves by its measured beta.</i>",
    ]


def _header_lines(plan: _ShockPlan, reference_move: float, returns, positions: list) -> list[str]:
    lines = [
        f"Reference   <code>{esc(plan.reference)}</code> moves <code>{_percent(reference_move, 1, signed=True)}"
        "</code> in this shock set",
        f"Book        <code>{len(positions)}</code> instruments · return history for <code>{len(returns)}</code>",
        f"<i>{esc(plan.description)}</i>",
    ]
    if plan.hand:
        shown = ", ".join(f"{'everything else' if s == '*' else s} {plan.shocks[s]:+.1%}" for s in plan.hand[:6])
        lines.append(f"Hand shocks <code>{esc(shown)}</code>")
        lines.append("<i>Instruments left out move by their measured beta against the reference; one written at "
                     "0% is pinned flat, not left alone.</i>")
    return lines


def _regime_lines(regime, reference: str) -> list[str]:
    """The panel's regime bar: scenario magnitudes are historical, so the regime says how unlike today they are."""
    if regime is None:
        return ["", f"<i>No volatility regime for {esc(reference)} — fewer than forty aligned returns, so there is "
                    "no history to rank today against. The magnitudes below stay unconditioned on the current "
                    "market rather than being scaled by a guess.</i>"]
    return [
        "",
        f"<b>{esc(regime.regime)}</b> · {esc(reference)} realised vol <code>{_percent(regime.current_vol, 1)}"
        "</code> annualised",
        f"the {_ordinal(round(regime.percentile * 100))} percentile of its own last "
        f"<code>{regime.observations}</code> windows, <code>{_number(regime.ratio)}×</code> its baseline of "
        f"<code>{_percent(regime.baseline_vol, 1)}</code>",
        f"<i>{esc(regime.note)}</i>",
    ]


def _impact_lines(result, equity: float, budget: dict) -> list[str]:
    """The three headline tiles, plus the halt banner the web panel raises."""
    at_halt = _finite(budget.get("equity_at_halt"))
    cushion = _finite(budget.get("cushion_usd"))
    limit_pct = _finite(budget.get("limit_pct"))
    lines = [
        "",
        "<b>Projected book impact</b>",
        f"Book move     <code>{_money(result.total_pnl, signed=True)}</code> · "
        f"<code>{_percent(result.total_return) if equity > 0 else '—'}</code> of equity",
        f"Equity after  <code>{_money(result.projected_equity)}</code> · halt level <code>{_money(at_halt)}</code>",
        f"Toward halt   <code>{_percent(_toward_halt(result.total_pnl, cushion), 0)}</code> of the cushion consumed",
    ]
    if equity <= 0:
        lines.append("<i>Equity is not positive, so the share-of-equity figure has no denominator — withheld "
                     "rather than printed as zero.</i>")
    if at_halt is None or cushion is None:
        lines.append("<i>The gateway reported no drawdown limit for this session, so the halt level and the "
                     "distance to it are unknown — withheld, not assumed.</i>")
    elif cushion <= 0:
        lines.append("<i>The cushion is already spent: the book sits at or below the halt level before any shock "
                     "is applied, which is why the gauge reads full.</i>")
    elif result.projected_equity < at_halt:
        lines.append(f"🛑 <b>This scenario trips the daily drawdown limit.</b> Equity falls to "
                     f"<code>{_money(result.projected_equity)}</code>, below the "
                     f"<code>{_percent(limit_pct, 0)}</code> halt level of <code>{_money(at_halt)}</code>, "
                     "so the gateway stops trading.")
    return lines


def _leg_lines(result, plan: _ShockPlan, reference_move: float) -> list[str]:
    """The panel's per-position table: notional, move, source, P&L."""
    lines = ["", "<b>Per-instrument impact</b>",
             "<i>Notional is signed — a short is negative, so a fall in the market is a gain.</i>"]
    for leg in result.legs[:_LEG_LIMIT]:
        lines.append(f"<b>{esc(leg.symbol)}</b> <code>{_money(leg.signed_notional, signed=True)}</code>")
        lines.append(f"  move <code>{_percent(leg.applied_move, 1, signed=True)}</code> · P&amp;L "
                     f"<code>{_money(leg.pnl, signed=True)}</code> · "
                     f"<i>{esc(_leg_source(leg, plan.hand, reference_move))}</i>")
    if len(result.legs) > _LEG_LIMIT:
        lines.append(f"<i>{len(result.legs) - _LEG_LIMIT} further instruments are inside the total above but not "
                     "listed here — the card is bounded, the arithmetic is not.</i>")
    return lines


def _ranked_lines(ranked, budget: dict) -> list[str]:
    """Every named scenario on this book, worst first — the panel's ranking."""
    at_halt = _finite(budget.get("equity_at_halt"))
    lines = ["", "<b>Every named scenario, worst first</b>",
             "<b>SCENARIO             P&amp;L  OF EQUITY  HALTS</b>"]
    for row in ranked:
        mark = "—" if at_halt is None else ("✕ yes" if row.projected_equity < at_halt else "✓ no")
        lines.append(f"<code>{esc(f'{row.label[:20]:<20}')}</code> <code>{_money(row.total_pnl):>10}</code> "
                     f"<code>{_percent(row.total_return):>7}</code> {mark}")
    if at_halt is None:
        lines.append("<i>The halt column is dashed because no halt level is known for this session.</i>")
    return lines


def _basis_caveats(result, plan: _ShockPlan, reference_move: float) -> list[str]:
    """Which legs are measurements and which are assumptions — the panel's footnote."""
    lines: list[str] = []
    unsupported = sorted({leg.symbol for leg in result.legs if leg.basis == "unsupported"})
    blanket = sorted({leg.symbol for leg in result.legs if leg.basis == "wildcard"})
    pinned = sorted({leg.symbol for leg in result.legs if leg.basis == "explicit" and leg.applied_move == 0})
    if unsupported and reference_move:
        lines.append(f"<i>Held flat: {esc(', '.join(unsupported))}. No beta against {esc(plan.reference)} could "
                     "be measured, so the total above is understated by whatever they would have moved — "
                     "understated, not invented.</i>")
    elif unsupported:
        lines.append(f"<i>Held flat: {esc(', '.join(unsupported))}. Nothing in this shock set moves "
                     f"{esc(plan.reference)}, so beta has nothing to propagate from. Give the reference a move, "
                     "or shock everything with <code>all=-5</code>.</i>")
    if blanket:
        lines.append(f"<i>{esc(', '.join(blanket))} moved on the shock set's blanket figure, not on a measured "
                     "beta — an assumption, and a stronger one than beta = 1 would have been.</i>")
    if pinned:
        lines.append(f"<i>Pinned at 0%: {esc(', '.join(pinned))} — a claim that they do not move, not an absence "
                     "of information about them.</i>")
    return lines


def _history_caveats(returns, plan: _ShockPlan, result) -> list[str]:
    """Why a beta was unavailable, when it was the data rather than the shock set."""
    if not returns:
        return ["<i>No return history came back for any held symbol, so no beta could be measured at all. Every "
                "leg above is shocked directly, moved by a blanket assumption, or left flat. Check the "
                "market-data provider before trusting the total.</i>"]
    if plan.reference not in returns:
        return [f"<i>No return history for the reference {esc(plan.reference)} — only held symbols and BTCUSDT "
                "are fetched, so a reference that is not held has nothing to measure a beta against.</i>"]
    if not result.used_beta:
        return ["<i>No leg moved by a measured beta in this shock set.</i>"]
    return []


def _leg_chart(result, plan: _ShockPlan):
    legs = result.legs[:10]
    if not legs:
        return None
    return generate_bars_chart_png(
        f"{plan.label[:44]} · P&L by instrument",
        [leg.symbol.replace("USDT", "") for leg in legs],
        [float(leg.pnl) for leg in legs],
        "P&L (USD)",
        colours=["#ff5252" if leg.pnl < 0 else "#00e676" for leg in legs],
        horizontal=True, value_fmt="{:,.0f}",
    )


def _cushion_chart(ranked, budget: dict):
    """Each scenario's loss against the cushion. None without a cushion — a ladder against an unknown limit
    would be a drawn guess."""
    cushion = _finite(budget.get("cushion_usd"))
    if cushion is None or cushion <= 0:
        return None
    return generate_gate_ladder_png(
        "Scenario loss against the cushion to the halt",
        [(row.label[:22], max(0.0, -float(row.total_pnl)), cushion, -float(row.total_pnl) < cushion)
         for row in ranked],
    )


class ScenarioReportMixin:
    async def _cmd_shock(self, args, chat_id, actor) -> None:
        """Risk ▸ Scenarios in full — every leg a shock moves, and the halt line."""
        from modules.quant_risk import SCENARIOS, apply_scenario, run_scenarios, volatility_regime

        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        # The web panel's reference is the largest position, falling back to the
        # engine's own default; the shocks are keyed against it and every beta
        # is measured against it.
        default_reference = str(positions[0]["symbol"]) if positions else "BTCUSDT"
        plan = _parse_shock_args(args, SCENARIOS, default_reference)
        switch = _switch_keyboard(SCENARIOS, plan, default_reference)

        if plan.error:
            await self.send_message(chat_id, text_card(
                "🎛 Scenario report", "BAD ARGUMENT", [plan.error, "", *_usage_lines(SCENARIOS)],
                source="quant_risk · scenarios", next_commands="/stress · /help"), reply_markup=switch)
            return
        if not positions:
            await self.send_message(chat_id, text_card(
                "🎛 Scenario report", "FLAT BOOK",
                ["The book holds nothing, so no shock has anything to move.",
                 "<i>Reported as flat rather than as a zero loss: there is no exposure here, which is not the "
                 "same claim as a measured absence of risk.</i>", "", *_usage_lines(SCENARIOS)],
                source="quant_risk · scenarios",
                next_commands="/positions · /stress · /var"), reply_markup=switch)
            return

        equity = _finite(report["equity"]["current"])
        if equity is None:
            await self.send_message(chat_id, text_card(
                "🎛 Scenario report", "NOT MEASURABLE",
                ["The gateway reported no equity figure, so a shock has no book to be scored against.",
                 "<i>Withheld rather than scored against zero, which would make every scenario look free.</i>"],
                source="Risk gateway", next_commands="/portfolio · /status"), reply_markup=switch)
            return

        result = apply_scenario(positions, equity, plan.shocks, returns, plan.reference,
                                scenario_id=plan.scenario_id, label=plan.label)
        ranked = run_scenarios(positions, equity, returns, plan.reference)
        regime = volatility_regime(returns.get(plan.reference, []), interval="1d")
        reference_move = _reference_move(plan.shocks, plan.reference)
        budget = report["risk_budget"]["daily_drawdown"]

        lines = _header_lines(plan, reference_move, returns, positions)
        lines += _regime_lines(regime, plan.reference)
        lines += _impact_lines(result, equity, budget)
        lines += _leg_lines(result, plan, reference_move)
        lines += _ranked_lines(ranked, budget)
        lines += ["", *_basis_caveats(result, plan, reference_move), *_history_caveats(returns, plan, result)]

        charts = [("shock_legs", _leg_chart(result, plan)), ("shock_cushion", _cushion_chart(ranked, budget))]
        await self.send_media_group(chat_id, [(name, blob) for name, blob in charts if blob], caption=text_card(
            f"🎛 Scenario report · {esc(plan.label)}", "HAND SHOCKS" if plan.hand else "NAMED SCENARIO",
            lines, source="quant_risk · measured betas",
            next_commands="/stress · /var · /regime · /headroom"), reply_markup=switch)
