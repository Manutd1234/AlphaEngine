"""The gate vector `/preview` renders, built without touching an order path.

Split out of ``_mixins/preview.py``: the mixin is the command, this is the
arithmetic behind its card, and separating them is what lets the gate rows be
built and asserted with no bot, no chat and no gateway mutation at all.

Emitted AGAINST ``GATE_ORDER`` rather than against a list written here, so this
file structurally cannot reorder a gate or quietly drop one — the registry the
parity harness, the Supabase mirror and ``test_supabase_schema`` already agree
on is the only source of the sequence.

Four states, not two, because a preview is not a submission. ``SKIP`` means the
battery does not reach this gate for this order shape; ``UNKNOWN`` means the
gate runs on a real order but a read-only preview cannot feed it. Any UNKNOWN
downgrades the whole verdict to NOT DECIDABLE — a card that reported "would
pass" while one gate went unfed would be claiming an acceptance it had not
earned, which is the same defect as coercing a missing measurement to zero.
"""

from __future__ import annotations

from dataclasses import dataclass

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card

_CLEARS = "PASS"
_BLOCK = "BLOCK"
_SKIP = "SKIP"
_UNKNOWN = "UNKNOWN"

_MARKS = {_CLEARS: "✅", _BLOCK: "❌", _SKIP: "⚪", _UNKNOWN: "⚠️"}

_VERDICT_CLEARS = "WOULD PASS"
_VERDICT_BLOCK = "WOULD BE REJECTED"
_VERDICT_UNDECIDED = "NOT DECIDABLE"

_SIDES = frozenset({"BUY", "SELL"})

_LEGEND = (
    "<i>✅ clears · ❌ rejects · ⚪ the battery never reaches this gate for this order · "
    "⚠️ the gate runs, but a read-only preview cannot produce its input</i>"
)
_CLOSING = (
    "<i>Nothing was submitted. No order, no rate-limit token, no counter, no audit row and no "
    "latency sample moved. A real order is entered from the web order ticket, on the Execution "
    "tab — this card only reports what that ticket's gates would say.</i>"
)
_UNREPORTED = "the preview produced no reading for this gate, so it is undecided"


@dataclass(frozen=True)
class _GateRow:
    """One gate's line: its state, what was measured, and what against.

    ``detail`` is PLAIN text and is escaped once at render, so a venue name or an
    operator's halt reason cannot carry markup into the card.
    """

    name: str
    state: str
    observed: str
    limit: str
    detail: str
    #: observed / limit, when both are numbers. Only used to name the tightest
    #: gate on an order that clears everything; ``None`` keeps a gate out of it.
    ratio: float | None = None


# --------------------------------------------------------------------------- #
# Row constructors
# --------------------------------------------------------------------------- #
def _measured(name, passed, observed, limit, render, detail: str = "") -> _GateRow:
    """A numeric gate: a measurement, the bound it met, and the ratio between."""
    value, bound = _finite(observed), _finite(limit)
    return _GateRow(
        name, _CLEARS if passed else _BLOCK, render(observed), render(limit), detail,
        value / bound if value is not None and bound else None,
    )


def _flagged(name, passed, observed: str, limit: str, detail: str = "") -> _GateRow:
    """A gate whose reading is a word rather than a number."""
    return _GateRow(name, _CLEARS if passed else _BLOCK, observed, limit, detail)


def _skipped(name, why: str) -> _GateRow:
    """The battery does not reach this gate for an order of this shape."""
    return _GateRow(name, _SKIP, "—", "—", why)


def _unknown(name, why: str) -> _GateRow:
    """The gate runs on a real order; a read-only preview cannot feed it."""
    return _GateRow(name, _UNKNOWN, "—", "—", why)


def _bps(value) -> str:
    return f"{_number(value)} bps"


def _per_second(value) -> str:
    return f"{_number(value, 1)}/s"


# --------------------------------------------------------------------------- #
# The battery, gate by gate — every number read, never re-derived
# --------------------------------------------------------------------------- #
def _gates_admission(state, symbol: str, universe, crypto: bool) -> list[_GateRow]:
    """Gates 1-6: the halts, the universe, the two equity-only gates, idempotency."""
    halted = symbol in (state.halted_symbols or [])
    kill_detail = (
        (state.kill_reason or "engaged with no reason recorded")
        if state.kill_switch_active else "the desk-wide halt is clear"
    )
    paper_why = (
        "runs only for a paper-equity order carrying a server-verified quote; "
        + ("this order is crypto" if crypto else "a preview carries no quote")
    )
    return [
        _flagged("kill_switch", not state.kill_switch_active,
                 "engaged" if state.kill_switch_active else "disengaged", "disengaged", kill_detail),
        _flagged("symbol_halt", not halted, "halted" if halted else "trading", "not halted",
                 f"per-symbol halt status for {symbol}"),
        _gate_whitelist(symbol, universe, crypto),
        _skipped("paper_execution_model", paper_why),
        _skipped("reference_freshness", paper_why),
        _flagged("duplicate_order", True, "no client_order_id", "an unseen id",
                 "a preview carries no client order id, so the seen-id window has nothing to match"),
    ]


def _gate_whitelist(symbol: str, universe, crypto: bool) -> _GateRow:
    """Gate 3 — the instrument universe, with the equity escape hatch it really has.

    The reference reads ``req.symbol in self._whitelist or paper_equity``: an
    equity order clears this gate by carrying a server-verified quote rather than
    by being on the L2 list. A preview carries no quote, so an off-list equity
    symbol is undecided here — reporting it as a rejection would name a gate that
    a real order would not have tripped.
    """
    if universe is None:
        return _unknown("symbol_whitelist", "the gateway published no instrument universe to check")
    if symbol in universe:
        return _flagged("symbol_whitelist", True, symbol, "the live L2 universe",
                        f"{len(universe)} instrument(s) configured on this gateway")
    if not crypto:
        return _unknown("symbol_whitelist", f"{symbol} is not on the live L2 list; a real equity order clears "
                                            "this gate by carrying a server-verified quote, and a preview has none")
    return _flagged("symbol_whitelist", False, symbol, "the live L2 universe",
                    f"{len(universe)} instrument(s) configured on this gateway")


def _gate_rate_limit(state, limits: dict) -> _GateRow:
    """Gate 7. Reported as headroom: the real gate DRAWS a token, and this must not."""
    cap = _finite(limits.get("max_orders_per_sec"))
    observed = _finite(state.orders_last_second)
    if cap is None or observed is None:
        return _unknown("rate_limit", "the observed order rate or its cap is not published")
    return _measured("rate_limit", observed < cap, observed, cap, _per_second,
                     "observed rate — the gate itself draws a token at submit, and this preview draws none")


def _gates_price(mark) -> list[_GateRow]:
    """Gates 8-9: no mark, no risk assessment, no size. The gateway rejects rather than guesses."""
    priced = mark is not None and mark > 0
    return [
        _flagged("price_available", priced, _number(mark) if priced else "no live mark", "a live mark",
                 "the gateway refuses to price an order it cannot mark"),
        _flagged("order_sized", priced, "notional and quantity" if priced else "notional only",
                 "both a quantity and a notional",
                 "the quantity is derived from the notional at the mark" if priced
                 else "no mark, so no quantity could be derived from the notional"),
    ]


def _gate_order_notional(limits: dict, notional: float) -> _GateRow:
    """Gate 10 — the fat-finger ceiling on a single order."""
    cap = _finite(limits.get("max_order_notional_usd"))
    if cap is None:
        return _unknown("max_order_notional", "the gateway published no per-order notional cap")
    return _measured("max_order_notional", notional <= cap, notional, cap, _money,
                     "the fat-finger ceiling on one order")


def _gates_exposure(gateway, limits: dict, symbol: str, side: str, notional: float, mark) -> list[_GateRow]:
    """Gates 11-12 — projected concentration and gross, resting orders included.

    Both are computed by the gateway's own ``projected_symbol_notional`` and
    ``gross_exposure``; the worst-case-fill convention lives there, not here.
    """
    if gateway is None or not mark or mark <= 0:
        why = ("no mark, so the order has no quantity to project — the battery would score this "
               "against a zero price, after price_available has already rejected the order")
        return [_unknown("symbol_concentration", why), _unknown("gross_exposure", why)]
    signed_qty = (notional / mark) * (1 if side == "BUY" else -1)
    projected_sym = gateway.projected_symbol_notional(symbol, signed_qty, mark)
    projected_gross = gateway.gross_exposure() - gateway.symbol_notional(symbol) + projected_sym
    sym_cap = _finite(limits.get("max_symbol_notional_usd"))
    gross_cap = _finite(limits.get("max_gross_exposure_usd"))
    rows = []
    if sym_cap is None:
        rows.append(_unknown("symbol_concentration", "the gateway published no per-symbol notional cap"))
    else:
        rows.append(_measured("symbol_concentration", projected_sym <= sym_cap, projected_sym, sym_cap,
                              _money, f"worst-case {symbol} exposure with the resting book included"))
    if gross_cap is None:
        rows.append(_unknown("gross_exposure", "the gateway published no gross exposure cap"))
    else:
        rows.append(_measured("gross_exposure", projected_gross <= gross_cap, projected_gross, gross_cap,
                              _money, "projected gross across the book once this order lands"))
    return rows


def _gates_resting(state) -> list[_GateRow]:
    """Gates 13-14 — both LIMIT-only, so a market preview never reaches either."""
    cap = _finite(getattr(settings, "max_working_orders", None))
    return [
        _skipped("price_band", "runs only on a LIMIT order with a limit price; a preview prices at the market"),
        _skipped("working_book", f"runs only on a LIMIT order; {int(state.working_orders)} resting now "
                                 f"against a cap of {_number(cap, 0)}"),
    ]


def _gate_drawdown(state, limits: dict) -> _GateRow:
    """Gate 15 — the session drawdown budget, read from the published state."""
    cap = _finite(limits.get("max_daily_drawdown_pct"))
    used = _finite(state.daily_drawdown_pct)
    if cap is None or used is None:
        return _unknown("daily_drawdown", "the session drawdown or its budget is not published")
    return _measured("daily_drawdown", used < cap, used, cap, _percent,
                     "share of the opening balance this session has lost")


def _gate_reduce_only(state, symbol: str) -> _GateRow:
    """Gate 16 — only runs inside the reduce-only band, and its test is the battery's.

    Whether an order moves the book *toward flat* is decided in ``submit`` from
    the held quantity and the signed order quantity. Copying that comparison here
    would be the second implementation the parity fixtures exist to prevent, so
    the card reports the inputs and says plainly that it did not run the test.
    """
    if not state.reduce_only:
        return _skipped("reduce_only", "the desk is not in reduce-only, so the battery never reaches this gate")
    held = next((position.quantity for position in state.positions if position.symbol == symbol), 0.0)
    why = (
        "engaged by operator override" if state.reduce_only_source == "operator"
        else f"at {_percent(state.drawdown_budget_used_pct)} of the drawdown budget"
    )
    return _unknown(
        "reduce_only",
        f"reduce-only, {why}; only orders that reduce the held {symbol} quantity ({_number(held, 6)}) are "
        "accepted, and the battery decides that from the fill direction, not a preview",
    )


def _gate_slippage(tca, limits: dict, symbol: str, side: str, notional: float, crypto: bool) -> _GateRow:
    """Gate 17 — measured on the ROUTED execution, because that is what would fill."""
    cap = _finite(limits.get("max_est_slippage_bps"))
    if not crypto:
        model = _finite(getattr(settings, "paper_equity_slippage_bps", None))
        if model is None or cap is None:
            return _unknown("est_slippage", "the paper-equity slippage model or its cap is not published")
        return _measured("est_slippage", model <= cap, model, cap, _bps,
                         "fixed paper-equity model; no exchange depth is asserted")
    if tca is None:
        return _unknown("est_slippage", "no TCA engine is attached, so no ladder can be walked")
    estimate = tca.route_estimate(symbol, side, notional)
    if estimate is None:
        return _flagged("est_slippage", False, "no routable liquidity", _bps(cap),
                        "the merged ladder holds no depth for this order")
    if not estimate.fillable:
        return _flagged("est_slippage", False, f"only {_money(estimate.filled_notional)} routable",
                        _money(notional), f"across {estimate.venue or 'all venues'}")
    if estimate.slippage_bps is None or cap is None:
        return _unknown("est_slippage", "the route filled but there is no consolidated mid to measure it "
                                        "against, so the battery adds no check at all")
    return _measured("est_slippage", estimate.slippage_bps <= cap, estimate.slippage_bps, cap, _bps,
                     f"routing {estimate.venue}")


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
def _price_source(tca, symbol: str, mark, crypto: bool) -> str:
    """Where the price on the card came from — never left to the reader to assume."""
    if mark is None:
        if crypto:
            return "no consolidated mid — no live venue book is answering for this symbol"
        return ("no gateway mark — an equity order is priced by the server-verified quote it carries, "
                "and a preview carries none")
    if tca is not None and tca.last_price(symbol) is not None:
        return "TCA consolidated mid, depth-weighted across the live venue books"
    return "the last server-verified paper quote the gateway holds for this symbol"


def _binding(blocking: list[_GateRow], rows: list[_GateRow]) -> str:
    """Which gate decides. First refusal in evaluation order, else the tightest."""
    if blocking:
        first = blocking[0]
        return (f"<code>{esc(first.name)}</code> <i>rejects first — {esc(first.observed)} against "
                f"{esc(first.limit)}</i>")
    tightest = max((row for row in rows if row.ratio is not None), key=lambda row: row.ratio, default=None)
    if tightest is None:
        return "<i>no gate produced a measurable ratio</i>"
    return (f"<code>{esc(tightest.name)}</code> <i>is tightest, at {_percent(tightest.ratio)} "
            "of its limit</i>")


def _gate_line(row: _GateRow) -> str:
    """One gate, one line. ``detail`` is escaped here and nowhere else."""
    mark = _MARKS[row.state]
    if row.state in {_SKIP, _UNKNOWN}:
        return f"{mark} <code>{esc(row.name):<21}</code> <i>{esc(row.detail)}</i>"
    tail = f" · <i>{esc(row.detail)}</i>" if row.detail else ""
    return (f"{mark} <code>{esc(row.name):<21}</code> <code>{esc(row.observed)}</code> / "
            f"<code>{esc(row.limit)}</code>{tail}")


def _header_lines(symbol, side, notional, mark, source, verdict, blocking, rows) -> list[str]:
    """The resolved order, its price and its provenance, then the verdict."""
    return [
        f"Order    <code>{esc(side)} {_money(notional)} {esc(symbol)}</code>",
        f"Price    <code>{_number(mark)}</code> · <i>{esc(source)}</i>",
        f"Quantity <code>{_number((notional / mark) if mark else None, 6)}</code> "
        + ("<i>derived from the notional at that mark</i>" if mark
           else "<i>no mark, so this order has no quantity and the gateway will not size it</i>"),
        f"Verdict  <b>{esc(verdict)}</b>",
        f"Binds    {_binding(blocking, rows)}",
    ]


def _usage_card(problem: str) -> str:
    """A parse failure is answered, not raised — the generic failure card teaches nothing."""
    return text_card(
        "🧮 Order preview", "USAGE",
        [
            f"<code>{esc(problem)}</code>",
            "Usage <code>/preview [SYMBOL] [BUY|SELL] [NOTIONAL]</code>",
            f"Example <code>/preview {esc(settings.symbols[0].upper())} BUY 50000</code>",
            "Side and notional are optional and may be given in either order.",
            "<i>Nothing was submitted; /preview only ever reads.</i>",
        ],
        source="AlphaEngine pre-trade battery",
        next_commands="/gates · /limits · /symbols",
    )
