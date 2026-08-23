"""Combos: what the legs pin down about a conjunction, and what they do not.

Kalshi lists parlays. One market pays a dollar if Manchester City fail to beat
Bournemouth *and* Liverpool beat Newcastle *and* six other things, all at once.
Its ticker carries the legs in ``mve_selected_legs``, so unlike every other
relation in this engine the conjunction is not inferred — the venue states it.

That makes the combo the cleanest constraint on the exchange and, at the same
time, the one that pins down the least. Two probabilities do not determine the
probability of both. All they give is a band, which Fréchet derived in 1935:

    max(0, Σ p_i - (n - 1))  <=  P(all legs)  <=  min_i p_i

The upper bound is obvious once said: the conjunction is a subset of each leg,
so it cannot be likelier than the likeliest constraint on it — the *least*
likely leg. The lower bound is the union bound rearranged: the legs can fail on
disjoint futures at most until the failure probabilities exhaust the space.

**Both bounds are trades, not inequalities.**

*Upper.* Buy the leg, sell the combo. The pair pays ``1{leg} - 1{all legs}``,
never negative, because the combo cannot pay without the leg paying. A combo bid
above the leg ask pays you to hold a portfolio that can only pay you more.

*Lower.* Buy the combo and the opposite side of every leg. If all legs land the
combo pays a dollar and the opposites nothing; if ``k >= 1`` miss, the combo
pays nothing and exactly ``k`` opposites pay a dollar each. So it pays at least
a dollar in every future, and any cost below one is a Dutch book — the spec's
three-leg cover, written for n legs.

**The gap between the bounds is the whole subject.** The legs never determine
the combo; only the dependence does, and the dependence is not quoted anywhere.
Independence would say ``Π p_i``, and independence is a *guess* — Liverpool and
Manchester City both playing badly on a wet Saturday is not independence, and
neither is a crypto parlay where every leg is the same coin at four strikes. So
this module reports where the price sits inside the band, what independence
would have said, and how wide the band is, and it calls none of the three a
mispricing. Only a price *outside* the band is a mispricing, and that is what
the rows test.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Sequence

from modules.coherence.kernel.book import Book, Side
from modules.coherence.kernel.constraints import Leg, Row
from modules.coherence.kernel.lattice import EdgeScope
from modules.coherence.kernel.money import DOLLAR, one_minus

Dependence = Literal["positive", "negative", "independent", "unavailable"]

#: Which side of the combo's book the band position was read from. Named on the
#: reading because parlays are quoted one-sided almost without exception —
#: nobody bids for a parlay — so a reading that insisted on a mid would report
#: "unavailable" for every combo on the exchange, including the ones with a
#: perfectly good offer on them.
PriceBasis = Literal["mid", "ask", "unavailable"]


@dataclass(frozen=True, slots=True)
class ComboLeg:
    """One condition inside a parlay, as the venue states it."""

    ticker: str
    event_ticker: str
    side: Side
    label: str
    #: The shard the leg's own market lives on. Unknown means treated as
    #: cross-shard, because assuming a leg is co-located when it is not
    #: understates the legging risk, and understating it is the expensive error.
    exchange_index: int | None = None

    @property
    def opposite(self) -> Side:
        return "no" if self.side == "yes" else "yes"


@dataclass(frozen=True, slots=True)
class Combo:
    """A parlay market and the legs it is a conjunction of."""

    ticker: str
    collection_ticker: str
    exchange_index: int
    legs: tuple[ComboLeg, ...]
    label: str

    @property
    def scope(self) -> EdgeScope:
        shards = {leg.exchange_index for leg in self.legs} | {self.exchange_index}
        if None in shards or len(shards) > 1:
            return "cross-shard"
        return "same-shard"


@dataclass(frozen=True, slots=True)
class LegReading:
    """What one leg costs and what probability it implies for its own side."""

    ticker: str
    label: str
    side: Side
    probability: Decimal | None
    buy_cost: Decimal | None
    opposite_cost: Decimal | None


@dataclass(frozen=True, slots=True)
class FrechetReading:
    """Where the combo is quoted relative to what its legs allow."""

    combo_ticker: str
    legs: tuple[LegReading, ...]
    combo_bid: Decimal | None
    combo_ask: Decimal | None
    combo_mid: Decimal | None
    #: The price the band position and the dependence reading were taken at,
    #: and which side of the book it came from.
    price: Decimal | None
    price_basis: PriceBasis
    lower_bound: Decimal | None
    upper_bound: Decimal | None
    independence: Decimal | None
    band_width: Decimal | None
    band_position: Decimal | None
    dependence: Dependence
    detail: str

    @property
    def inside_band(self) -> bool | None:
        """Is the quoted price consistent with *some* dependence structure?"""
        if self.price is None or self.lower_bound is None or self.upper_bound is None:
            return None
        return self.lower_bound <= self.price <= self.upper_bound


def _side_price(book: Book | None, side: Side, want: Literal["ask", "bid", "mid"]) -> Decimal | None:
    """The price of one side of a market, read from the two bid ladders.

    The NO side is not a second book: it is the same book seen from the other
    end, which ``book.py`` already resolves. Reading it here rather than
    re-deriving keeps one definition of an ask on the exchange.
    """
    if book is None:
        return None
    if want == "mid":
        mid = book.mid
        if mid is None:
            return None
        return mid if side == "yes" else one_minus(mid)
    if side == "yes":
        return book.best_yes_ask if want == "ask" else book.best_yes_bid
    return book.best_no_ask if want == "ask" else book.best_no_bid


def _size(book: Book | None, side: Side, want: Literal["ask", "bid"]) -> int:
    if book is None:
        return 0
    levels = book.asks(side) if want == "ask" else book.bids(side)
    return levels[0].size_hundredths if levels else 0


def side_label(label: str, side: Side) -> str:
    """Name a contract in a way that cannot be read as the other one.

    A combo leg is routinely the NO side of its market, and the negation of a
    NO leg is a YES purchase. Composing "not " onto a bare market label gets
    that backwards on exactly the legs where it matters, so every label the
    certificate prints carries the side it settles on.
    """
    return f"{label} settling {side}"


def _readings(combo: Combo, books: dict[str, Book]) -> list[LegReading]:
    return [
        LegReading(
            ticker=leg.ticker,
            label=leg.label,
            side=leg.side,
            probability=_side_price(books.get(leg.ticker), leg.side, "mid"),
            buy_cost=_side_price(books.get(leg.ticker), leg.side, "ask"),
            opposite_cost=_side_price(books.get(leg.ticker), leg.opposite, "ask"),
        )
        for leg in combo.legs
    ]


def assess(combo: Combo, books: dict[str, Book]) -> FrechetReading:
    """The Fréchet band for this combo, and where it is quoted inside it."""
    readings = _readings(combo, books)
    combo_book = books.get(combo.ticker)
    combo_bid = _side_price(combo_book, "yes", "bid")
    combo_ask = _side_price(combo_book, "yes", "ask")
    combo_mid = _side_price(combo_book, "yes", "mid")

    probabilities = [reading.probability for reading in readings]
    if not probabilities or any(value is None for value in probabilities):
        missing = [reading.ticker for reading in readings if reading.probability is None]
        return FrechetReading(
            combo_ticker=combo.ticker,
            legs=tuple(readings),
            combo_bid=combo_bid,
            combo_ask=combo_ask,
            combo_mid=combo_mid,
            price=combo_mid if combo_mid is not None else combo_ask,
            price_basis="mid" if combo_mid is not None else ("ask" if combo_ask is not None else "unavailable"),
            lower_bound=None,
            upper_bound=None,
            independence=None,
            band_width=None,
            band_position=None,
            dependence="unavailable",
            detail=(
                "no band: these legs are unquoted on the side the combo needs — "
                + ", ".join(missing or ["the combo lists no legs"])
            ),
        )

    priced = [value for value in probabilities if value is not None]
    count = len(priced)
    upper = min(priced)
    lower = max(Decimal(0), sum(priced, Decimal(0)) - (Decimal(count) - DOLLAR))
    independence = Decimal(1)
    for value in priced:
        independence *= value

    # Mid where the combo is two-sided, ask where it is merely offered. In
    # practice it is always the ask: across a thousand listed parlays not one
    # carries a bid, so a reading that demanded a mid would report nothing
    # about every combo on the exchange. The basis travels with the number,
    # because an ask includes the maker's margin and therefore reads high —
    # a dependence called "positive" off an ask may be nothing but the spread.
    price = combo_mid if combo_mid is not None else combo_ask
    basis: PriceBasis = "mid" if combo_mid is not None else ("ask" if combo_ask is not None else "unavailable")

    width = upper - lower
    position: Decimal | None = None
    if price is not None and width > 0:
        position = (price - lower) / width

    if price is None:
        dependence: Dependence = "unavailable"
    elif price > independence:
        dependence = "positive"
    elif price < independence:
        dependence = "negative"
    else:
        dependence = "independent"

    return FrechetReading(
        combo_ticker=combo.ticker,
        legs=tuple(readings),
        combo_bid=combo_bid,
        combo_ask=combo_ask,
        combo_mid=combo_mid,
        price=price,
        price_basis=basis,
        lower_bound=lower,
        upper_bound=upper,
        independence=independence,
        band_width=width,
        band_position=position,
        dependence=dependence,
        detail=(
            f"{count} leg(s); the legs leave a band {width} wide, which is how much this price "
            "can move with no leg price moving at all"
            + (
                "; read from the offer, since no one bids for a parlay, so it carries the maker's margin"
                if basis == "ask"
                else ""
            )
        ),
    )


def rows_for_combo(combo: Combo, books: dict[str, Book], legs_priced: Sequence[LegReading] | None = None) -> list[Row]:
    """The two Fréchet bounds as testable rows, in the shape the solver takes.

    One upper-bound row per leg rather than only the binding one: which leg
    binds depends on prices that move between the poll and the order, and a
    solver handed every row picks the binding one itself.
    """
    readings = list(legs_priced if legs_priced is not None else _readings(combo, books))
    if not readings:
        return []
    combo_book = books.get(combo.ticker)
    scope = combo.scope
    rows: list[Row] = []

    for leg, reading in zip(combo.legs, readings, strict=False):
        rows.append(
            Row(
                family="frechet",
                scope=scope,
                because=(
                    f"the parlay pays only when {side_label(reading.label, leg.side)} does, so it "
                    f"cannot be worth more; buying that leg and selling the parlay pays off in every future"
                ),
                legs=(
                    Leg(
                        ticker=leg.ticker,
                        label=side_label(reading.label, leg.side),
                        direction="buy",
                        price=reading.buy_cost,
                        size_hundredths=_size(books.get(leg.ticker), leg.side, "ask"),
                        side=leg.side,
                    ),
                    Leg(
                        ticker=combo.ticker,
                        label=combo.label,
                        direction="sell",
                        price=_side_price(combo_book, "yes", "bid"),
                        size_hundredths=_size(combo_book, "yes", "bid"),
                        side="yes",
                    ),
                ),
                bound=Decimal(0),
            )
        )

    # The cover: the parlay plus the opposite of every leg pays at least a
    # dollar whatever happens, so it cannot cost less than one.
    cover: list[Leg] = [
        Leg(
            ticker=combo.ticker,
            label=combo.label,
            direction="buy",
            price=_side_price(combo_book, "yes", "ask"),
            size_hundredths=_size(combo_book, "yes", "ask"),
            side="yes",
        )
    ]
    for leg, reading in zip(combo.legs, readings, strict=False):
        cover.append(
            Leg(
                ticker=leg.ticker,
                label=side_label(reading.label, leg.opposite),
                direction="buy",
                price=reading.opposite_cost,
                size_hundredths=_size(books.get(leg.ticker), leg.opposite, "ask"),
                side=leg.opposite,
            )
        )
    rows.append(
        Row(
            family="frechet",
            scope=scope,
            because=(
                "buying the parlay and the opposite of each of its legs pays a dollar when every "
                "leg lands and one dollar per missed leg otherwise, so the set cannot cost under a dollar"
            ),
            legs=tuple(cover),
            bound=DOLLAR,
        )
    )
    return rows
