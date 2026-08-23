"""``combos`` — read the parlays and test them against their own legs.

The read is two calls and one join: the combo markets from ``mve_filter=only``,
then one bulk orderbook request covering both the combos and every leg they
reference. Bulk matters here more than anywhere else in the engine — an
eight-leg parlay needs nine books, so a per-market read would spend nine times
the budget to answer one question.

The join is where the honesty lives. Most listed parlays are unquoted, and an
unquoted combo has no band position and no violation; it has a Fréchet band,
which is a fact about its legs and worth showing on its own. So the reading is
computed for every combo, and only the ones whose rows are testable are offered
to the certificate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from modules.coherence.drivers.kalshi_combos import leg_tickers, parse_combos
from modules.coherence.drivers.kalshi_parse import parse_orderbooks
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.kernel.book import Book
from modules.coherence.kernel.constraints import Row
from modules.coherence.kernel.frechet import Combo, FrechetReading, assess, rows_for_combo

#: One bulk orderbook call takes 100 tickers. Nine books per parlay means ten
#: parlays fill a call, and asking for more would silently drop the tail.
MAX_COMBOS_PER_READ = 10


@dataclass(slots=True)
class ComboObservation:
    """The parlays, their books, and what their legs allow."""

    combos: list[Combo] = field(default_factory=list)
    books: dict[str, Book] = field(default_factory=dict)
    readings: list[FrechetReading] = field(default_factory=list)
    rows: list[Row] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def quoted(self) -> list[FrechetReading]:
        return [reading for reading in self.readings if reading.price is not None]

    @property
    def outside_band(self) -> list[FrechetReading]:
        return [reading for reading in self.readings if reading.inside_band is False]


async def observe_combos(client: KalshiClient, limit: int = MAX_COMBOS_PER_READ) -> ComboObservation:
    """Fetch parlays and everything their legs need, in two calls."""
    result = ComboObservation()
    try:
        page = await client.multivariate_markets(status="open", limit=1000)
    except KalshiUnavailable as exc:
        result.notes.append(f"the combo listing could not be read: {exc.reason}")
        return result

    combos = parse_combos(page.payload)
    if not combos:
        result.notes.append("the exchange is listing no open combo markets right now")
        return result

    taken = combos[: max(1, limit)]
    if len(combos) > len(taken):
        result.notes.append(
            f"{len(combos)} combos are listed and {len(taken)} were read: one bulk book call "
            "covers a hundred tickers and each parlay needs one per leg plus its own"
        )
    result.combos = taken

    wanted = [combo.ticker for combo in taken] + leg_tickers(taken)
    if len(wanted) > 100:
        # One bulk call takes a hundred tickers. Silently slicing left the legs
        # past the boundary unquoted, and the reading then reported them as the
        # venue not quoting them — our truncation wearing the exchange's name.
        dropped = len(wanted) - 100
        result.notes.append(
            f"{len(taken)} parlays need {len(wanted)} books and one bulk call carries a hundred, so "
            f"{dropped} leg(s) were not fetched; any band missing a leg below is missing it because "
            "this read stopped, not because the exchange is not quoting it"
        )
    try:
        books_page = await client.orderbooks(wanted[:100])
        result.books = parse_orderbooks(books_page.payload)
    except KalshiUnavailable as exc:
        result.notes.append(f"the books for these combos could not be read: {exc.reason}")
        return result

    for combo in taken:
        reading = assess(combo, result.books)
        result.readings.append(reading)
        result.rows.extend(row for row in rows_for_combo(combo, result.books) if row.testable)

    unquoted = len(taken) - len(result.quoted)
    if unquoted:
        result.notes.append(
            f"{unquoted} of {len(taken)} parlays carry no price on either side; their bands are "
            "shown because the legs still bound them, but nothing can be traded against them"
        )
    return result
