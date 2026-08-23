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
from modules.coherence.syscalls.observe import Observation


def surface_for(observation: Observation) -> distribution.Surface:
    component = build_component(observation.event, [item.market for item in observation.markets])
    books = {item.ticker: item.book for item in observation.markets}
    return distribution.build_surface(component, books)


def _ask(book: Book | None) -> Decimal | None:
    return book.best_yes_ask if book is not None else None


def stake_for(
    observation: Observation,
    surface: distribution.Surface,
    shrinkage: Decimal = kelly.DEFAULT_SHRINKAGE,
) -> kelly.Plan:
    """Kelly over this family, sized against the repaired measure.

    Only the ``named`` and ``bucket`` surfaces map one market to one bin, which
    is what the exclusive-family solver needs. A ladder's markets each pay in
    several bins, so its stakes are a different problem and it is refused by
    name rather than approximated.
    """
    if surface.engine not in {"named", "bucket"}:
        return kelly.solve([], shrinkage)

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

    candidates: list[kelly.Candidate] = []
    for ticker, mass in mass_by_ticker.items():
        price = _ask(books.get(ticker))
        if price is None or price <= 0:
            continue
        candidates.append(
            kelly.Candidate(
                ticker=ticker,
                label=labels.get(ticker, ticker),
                probability=mass,
                price=price,
            )
        )
    return kelly.solve(candidates, shrinkage)
