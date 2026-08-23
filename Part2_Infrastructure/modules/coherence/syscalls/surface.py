"""``surface`` — the distribution one event's prices imply, and what to stake on it.

Two questions that share an input. ``distribution.build_surface`` turns a family
of quotes into probability mass; ``kelly.solve`` turns probability mass and
prices into stakes. Running them together is deliberate: the measure the sizing
uses is the measure the pane draws, so a reader can check the stake against the
bars it came from rather than taking two numbers on separate faith.

**Which measure gets used for sizing is the whole decision.** Feeding Kelly the
raw mid prices would size an edge over the market using the market's own view,
which is no edge at all — it would return "stake nothing" for every coherent
family, correctly and uselessly. What is fed instead is the *repaired* measure:
the bin masses with negative mass clipped away and the total renormalised to one.
Where the quotes are coherent, that repair changes nothing and Kelly stakes
nothing. Where they are not, the repair is exactly the incoherence, and the
stake it produces is the trade the certificate already proved exists.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.kernel import distribution, kelly
from modules.coherence.kernel.book import Book
from modules.coherence.kernel.lattice import build_component
from modules.coherence.kernel.money import DOLLAR
from modules.coherence.syscalls.observe import Observation


def surface_for(observation: Observation) -> distribution.Surface:
    component = build_component(observation.event, [item.market for item in observation.markets])
    books = {item.ticker: item.book for item in observation.markets}
    return distribution.build_surface(component, books)


def _ask(book: Book | None) -> Decimal | None:
    return book.best_yes_ask if book is not None else None


def _half_spread(book: Book | None) -> Decimal:
    """Half the leg's bid-ask spread — the least its probability can be wrong by.

    A mid is the centre of a spread, not a measurement, so the probability read
    off it carries at least that much width. Feeding Kelly the mid as though it
    were exact is the assumption the estimation haircut exists to remove, and on
    a thinly quoted leg this is most of the apparent edge.
    """
    if book is None or book.spread is None:
        return Decimal(0)
    half = book.spread / 2
    return half if half > 0 else Decimal(0)


def stake_for(
    observation: Observation,
    surface: distribution.Surface,
    shrinkage: Decimal = kelly.DEFAULT_SHRINKAGE,
    arbitrage_bound: Decimal = DOLLAR,
) -> kelly.Plan:
    """Kelly over this family, sized against the repaired measure.

    Only the ``named`` and ``bucket`` surfaces map one market to one bin, which
    is what the exclusive-family solver needs. A ladder's markets each pay in
    several bins, so its stakes are a different problem and it is refused by
    name rather than approximated.
    """
    if surface.engine not in {"named", "bucket"}:
        return kelly.unsizeable(
            "this reading is a ladder: its bins are the gaps between markets, so no single "
            "contract's price is the probability of a bin",
            shrinkage,
        )

    books = {item.ticker: item.book for item in observation.markets}
    labels = {item.ticker: (item.market.yes_sub_title or item.ticker) for item in observation.markets}

    # Match each market to ITS OWN bin by ticker, never by position. The two
    # collections are deliberately ordered differently — the component keeps
    # the venue's listing order, the surface sorts along the axis — and zipping
    # them was a real bug: on the NYC daily-high family the venue lists the
    # "88 or above" market first while the axis puts it last, so a one-cent
    # contract was handed the 0.31 of mass belonging to "79 or below" and a
    # coherent event was told to stake a third of the bankroll on it.
    #
    # Clip negative mass before renormalising. A negative bin is a genuine
    # violation, certified elsewhere; it is not a probability, and a log-growth
    # objective over one would take the logarithm of a negative number.
    mass_by_ticker: dict[str, Decimal] = {}
    for item in surface.bins:
        if item.ticker is None:
            # A ladder bin is the gap between two markets and belongs to
            # neither, so this reading cannot be sized this way at all.
            return kelly.solve([], shrinkage)
        mass_by_ticker[item.ticker] = item.mass if item.mass > 0 else Decimal(0)

    # An unquoted member of an exhaustive family makes the family UNSIZEABLE.
    # It does not make it a smaller family, and the difference is the whole
    # safety of this path. `kelly.solve` computes its basket cost over what it
    # is given, so dropping a leg for want of an offer and handing over the
    # rest lets a partial basket cost under a dollar and be declared a riskless
    # arbitrage — with a worst-case wealth above one, printed as "cannot lose",
    # while the outcome that was dropped still carries its share of the mass
    # and settles YES often enough to take the lot. `constraints.py` already
    # holds this line for the additive row, where an unquoted leg makes the row
    # untestable rather than absent; this is the same rule for the same reason.
    candidates: list[kelly.Candidate] = []
    unbuyable: list[str] = []
    for ticker, mass in mass_by_ticker.items():
        price = _ask(books.get(ticker))
        if price is None or price <= 0:
            unbuyable.append(labels.get(ticker, ticker))
            continue
        candidates.append(
            kelly.Candidate(
                ticker=ticker,
                label=labels.get(ticker, ticker),
                probability=mass,
                price=price,
                uncertainty=_half_spread(books.get(ticker)),
            )
        )
    if unbuyable:
        return kelly.unsizeable(
            f"{len(unbuyable)} outcome(s) of this family are not offered at any price — "
            + ", ".join(unbuyable[:4])
            + (" and others" if len(unbuyable) > 4 else "")
            + ". The family is exhaustive, so one of them will settle YES; sizing the rest as "
            "though it could not would price a basket that does not cover every future",
            shrinkage,
        )
    return kelly.solve(candidates, shrinkage, arbitrage_bound)
