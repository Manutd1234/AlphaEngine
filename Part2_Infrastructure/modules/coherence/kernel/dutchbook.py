"""The coherence test as a linear programme, and the trade in its failure.

The engine's whole argument lives here. Rather than scanning for arbitrage
shapes someone thought of in advance, it asks one question of the price vector —
*is there a portfolio that pays more than it costs in every state of the world?*
— and lets the answer be the trade.

    maximise  t
    such that for every state w:
        Σ_j payoff_j(w) * (buy_j - sell_j) - Σ_j ask_j * buy_j + Σ_j bid_j * sell_j  >=  t
        0 <= buy_j  <= resting size on the ask
        0 <= sell_j <= resting size on the bid

``t*`` is the worst-case profit of the best portfolio available at the quoted
prices. Positive means a Dutch book: every state pays at least ``t*``, so the
position wins whichever way the world goes. Zero means coherent, and the dual
values are a probability measure consistent with every quote — which is the
useful answer on the ordinary day, because it says which market is pinning the
system.

Three things make this the executable version rather than the textbook one:

* **Prices are the ones you can trade**, ask to buy and bid to sell, not mids.
* **Sizes are bounded by resting depth.** An unbounded LP will always find an
  infinite arbitrage on a one-cent error and propose a portfolio nobody can fill.
* **Fees are charged.** Left out, the LP reports the naive `Σ < 1` violations
  the fee model exists to reject. They enter as a per-contract adjustment to
  each leg's price, which is exact for the trade fee and — because the rounding
  component is a step function of fill count, not of size — an approximation for
  the rest. ``closedform`` prices the winner exactly afterwards, so the LP
  chooses and the cost model rules.

SciPy is imported through a seam because it is in the tested venv and CI but not
on the runtime image. When it is absent the caller falls back to the closed-form
checks, and the certificate names which engine answered — an absence must never
look like present-and-fine.
"""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from types import ModuleType
from typing import Any

from modules.coherence.kernel.book import Book
from modules.coherence.kernel.certificate import Certificate, CertificateLeg
from modules.coherence.kernel.costs import FeeSchedule, Fill, OrderFees, trade_fee
from modules.coherence.kernel.lattice import Component
from modules.coherence.kernel.money import contracts
from modules.coherence.kernel.states import StateSpace, build_states

# Below this the LP's answer is noise: it is the smallest edge the exchange can
# even express, so a "profit" under it is a rounding artefact of the solver.
MIN_MEANINGFUL_EDGE = Decimal("0.0001")

# The LP works in contracts; sizes come in hundredths. Capping keeps a market
# with a very deep book from dominating the matrix's scale.
MAX_LEG_CONTRACTS = Decimal(10_000)


@lru_cache(maxsize=1)
def import_linprog() -> tuple[ModuleType | None, str | None]:
    """SciPy's optimiser, or the reason there is none.

    Cached both ways, failure included: a missing package does not appear
    halfway through a process, and retrying the import on every solve turns one
    absence into thousands of failed imports.
    """
    try:
        from scipy import optimize
    except ImportError as exc:
        return None, f"scipy is not installed here ({exc})"
    return optimize, None


def linprog_available() -> bool:
    """Cheap presence check for the status route. Presence is not importability."""
    return import_linprog()[0] is not None


def _leg_prices(book: Book | None, schedule: FeeSchedule) -> tuple[Decimal | None, Decimal, Decimal | None, Decimal]:
    """``(ask, ask_size, bid, bid_size)`` with the trade fee folded into price.

    Folded per contract: buying costs the ask plus its fee, selling receives
    the bid minus its. Both move the LP against the trade, which is the only
    safe direction for an approximation inside an arbitrage test.
    """
    if book is None:
        return None, Decimal(0), None, Decimal(0)
    asks = book.asks("yes")
    bids = book.bids("yes")
    ask = ask_size = bid = bid_size = None
    if asks:
        raw = asks[0].price
        per_contract = trade_fee(Fill(price=raw, size_hundredths=100), schedule)
        ask = raw + per_contract
        ask_size = min(contracts(asks[0].size_hundredths), MAX_LEG_CONTRACTS)
    if bids:
        raw = bids[0].price
        per_contract = trade_fee(Fill(price=raw, size_hundredths=100), schedule)
        bid = raw - per_contract
        bid_size = min(contracts(bids[0].size_hundredths), MAX_LEG_CONTRACTS)
    return ask, ask_size or Decimal(0), bid, bid_size or Decimal(0)


def _columns(space: StateSpace, books: dict[str, Book], schedule: FeeSchedule) -> list[dict[str, Any]]:
    """Every tradable side of every market: one LP variable each.

    A market quoted on both sides contributes two columns rather than one
    signed variable, because buying and selling have different prices and
    different resting depth. One variable spanning both would have to pick a
    price, and either choice is wrong on one side.
    """
    columns: list[dict[str, Any]] = []
    for index, ticker in enumerate(space.tickers):
        ask, ask_size, bid, bid_size = _leg_prices(books.get(ticker), schedule)
        if ask is not None and ask_size > 0:
            columns.append({"market": index, "ticker": ticker, "side": "buy", "price": ask, "cap": ask_size})
        if bid is not None and bid_size > 0:
            columns.append({"market": index, "ticker": ticker, "side": "sell", "price": bid, "cap": bid_size})
    return columns


def _state_rows(space: StateSpace, columns: list[dict[str, Any]]) -> list[list[float]]:
    """One inequality per state: ``t - (payoff - cost) <= 0``."""
    rows: list[list[float]] = []
    for state in range(len(space.states)):
        row: list[float] = []
        for column in columns:
            payoff = space.payoff[column["market"]][state]
            price = float(column["price"])
            # Buying pays the price and receives the payoff; selling is the mirror.
            value = (payoff - price) if column["side"] == "buy" else (price - payoff)
            row.append(-value)
        row.append(1.0)
        rows.append(row)
    return rows


def _price_solution(
    space: StateSpace,
    columns: list[dict[str, Any]],
    quantities: Any,
    books: dict[str, Book],
    schedule: FeeSchedule,
) -> tuple[list[CertificateLeg], Decimal]:
    """Cost the LP's portfolio exactly, through the fee model.

    The LP folded a per-contract trade fee into its prices to choose well; the
    rounding component is a step function of fill count rather than of size, so
    it cannot be folded into a linear price at all. The chosen portfolio is
    therefore re-priced here: the LP picks, the cost model rules.
    """
    legs: list[CertificateLeg] = []
    total_fees = Decimal(0)
    for column, quantity in zip(columns, quantities, strict=False):
        size_hundredths = int(round(float(quantity) * 100))
        if size_hundredths <= 0:
            continue
        book = books.get(column["ticker"])
        if book is None:
            continue
        levels = book.asks("yes") if column["side"] == "buy" else book.bids("yes")
        if not levels:
            continue
        raw_price = levels[0].price
        order = OrderFees(schedule=schedule)
        order.add(Fill(price=raw_price, size_hundredths=size_hundredths, selling=column["side"] == "sell"))
        fees = order.total
        total_fees += fees.net
        legs.append(
            CertificateLeg(
                ticker=column["ticker"],
                label=space.labels[column["market"]],
                direction=column["side"],
                price=raw_price,
                size_hundredths=size_hundredths,
                fees=fees,
            )
        )
    return legs, total_fees


def _worst_case_gross(space: StateSpace, legs: list[CertificateLeg]) -> Decimal:
    """The portfolio's payoff in its worst state, at RAW prices, before fees.

    Recomputed rather than read off the LP's objective, and this is not
    housekeeping. ``_leg_prices`` folds a per-contract trade fee into the
    prices the solver sees so that it chooses a portfolio worth having; ``t*``
    is therefore already net of that fold. Subtracting the exact fees from it
    as well charges every leg twice — on the worked example that turned a
    correct $27.92 into $5.90, which is the kind of error that reads as a
    tighter, more conservative engine rather than as a wrong one.

    So the gross is rebuilt from the raw quotes and the cost model does the
    subtracting, once.
    """
    by_market: dict[str, int] = {ticker: index for index, ticker in enumerate(space.tickers)}
    worst: Decimal | None = None
    for state in range(len(space.states)):
        total = Decimal(0)
        for leg in legs:
            index = by_market.get(leg.ticker)
            if index is None:
                continue
            payoff = Decimal(space.payoff[index][state])
            size = contracts(leg.size_hundredths)
            if leg.direction == "buy":
                total += (payoff - leg.price) * size
            else:
                total += (leg.price - payoff) * size
        worst = total if worst is None else min(worst, total)
    return worst if worst is not None else Decimal(0)


def _blank(component: Component, verdict: str, notes: list[str]) -> Certificate:
    return Certificate(
        verdict=verdict,  # type: ignore[arg-type]
        engine="highs",
        component_id=component.component_id,
        series_ticker=component.series_ticker,
        exchange_index=component.exchange_index,
        notes=notes,
    )


def solve(
    component: Component,
    books: dict[str, Book],
    schedule: FeeSchedule,
    max_contracts: Decimal | None = None,
) -> Certificate | None:
    """Run the coherence LP. Returns None when SciPy is unavailable.

    None rather than a weaker answer on purpose: the caller decides what to do
    without a solver, and a silent downgrade here would put a closed-form
    result behind an ``engine: "highs"`` label.
    """
    optimize, _ = import_linprog()
    if optimize is None:
        return None

    space = build_states(component)
    if space.is_empty:
        return _blank(component, "untestable", [space.note] if space.note else [])

    columns = _columns(space, books, schedule)
    if not columns:
        return _blank(component, "untestable", ["no market in this event is quoted on a side the engine could trade"])

    cap = max_contracts or MAX_LEG_CONTRACTS
    result = optimize.linprog(
        c=[0.0] * len(columns) + [-1.0],
        A_ub=_state_rows(space, columns),
        b_ub=[0.0] * len(space.states),
        bounds=[(0.0, float(min(column["cap"], cap))) for column in columns] + [(None, None)],
        method="highs",
    )

    certificate = Certificate(
        verdict="coherent",
        engine="highs",
        component_id=component.component_id,
        series_ticker=component.series_ticker,
        exchange_index=component.exchange_index,
        rows_tested=len(space.states),
        scope=component.scope,
        notes=list(component.notes),
    )
    if space.note:
        certificate.notes.append(space.note)

    if not result.success:
        certificate.verdict = "untestable"
        certificate.notes.append(f"the solver did not converge: {result.message}")
        return certificate

    worst_case = Decimal(str(result.x[-1])).quantize(Decimal("0.000001"))
    if worst_case <= MIN_MEANINGFUL_EDGE:
        certificate.because = (
            "no portfolio of these quotes pays more than it costs in every state, "
            "so a probability measure consistent with all of them exists"
        )
        return certificate

    legs, total_fees = _price_solution(space, columns, result.x[:-1], books, schedule)
    if not legs:
        certificate.verdict = "untestable"
        certificate.notes.append("the solver found an edge no whole-hundredth position could hold")
        return certificate

    gross = _worst_case_gross(space, legs)
    certificate.verdict = "incoherent"
    certificate.family = "linear-programme"
    certificate.because = (
        f"a portfolio of {len(legs)} leg(s) pays at least its cost in all "
        f"{len(space.states)} states this family can resolve into"
    )
    certificate.legs = tuple(legs)
    certificate.worst_case_payoff = gross
    certificate.gross_edge = gross
    certificate.total_fees = total_fees
    certificate.net_edge = gross - total_fees
    return certificate
