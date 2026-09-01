"""``combos`` — read the parlays and test them against their own legs.

The read is two calls and one join: the combo markets from ``mve_filter=only``,
then one bulk orderbook request covering both the combos and every leg they
reference. Bulk matters here more than anywhere else in the engine — an
eight-leg parlay needs nine books, so a per-market read would spend nine times
the budget to answer one question.

The join is where the honesty lives. Most listed parlays are unquoted, and an
unquoted combo has no band position and no violation; it has a Fréchet band,
which is a fact about its legs and worth showing on its own. So the reading and
every structural constraint are returned for every combo. A row whose required
book side is missing carries null cost and slack: it is untested, never silently
dropped and never counted as satisfied.
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


async def fetch_listing(client: KalshiClient) -> list[Combo]:
    """Every open combo the exchange publishes, parsed. One venue call.

    Split out so the refresher can make this call once and hand the result to
    both its own `observe_combos` and, through the snapshot, to a named read
    that would otherwise repeat it. It raises `KalshiUnavailable` rather than
    swallowing it: a caller warming a cache wants to know the venue refused,
    and a caller answering a request wants to say so in a note. Those are
    different responses to the same failure, so the choice belongs to them.
    """
    page = await client.multivariate_markets(status="open", limit=1000)
    return parse_combos(page.payload)


def _choose(combos: list[Combo], limit: int, ticker: str | None, result: ComboObservation) -> list[Combo] | None:
    """Which of the listed parlays this read will quote, and why.

    Split out of `observe_combos` on 2026-08-26 when the named-read branch took
    that function past the complexity ceiling. This is the one decision in it —
    a named parlay, or the fewest-legged few — and the reasoning for the order
    is here because the order IS the decision. Returns None when the read has
    to stop, with the note already on `result`.
    """
    if ticker:
        wanted_one = [combo for combo in combos if combo.ticker == ticker]
        if not wanted_one:
            result.notes.append(
                f"{ticker} is not among the {len(combos)} combos the exchange is listing as open; "
                "it may have settled, or it may be listed on a shard this read does not cover"
            )
            return None
        return wanted_one

    # MOST LEGS FIRST, and it is deliberately not "worst first". Which parlays a
    # reader saw was the venue's listing order, and the table above them claimed
    # "worst position first" — a claim nothing made true, and one that CANNOT be
    # made true here: a band, a position and a violation are all computed from
    # books this read has not fetched yet. Sorting on them would mean reading
    # every one of the thousand.
    #
    # FEWEST LEGS FIRST, and the first attempt had this backwards. Leg count is
    # the only ordering the listing supports, and I sorted DESCENDING on the
    # reasoning that the band widens with n so a wider band is more room for a
    # price to be wrong in. Measured, that returns 68-, 67- and 66-leg parlays —
    # and a 68-leg band is max(0, Σpᵢ − 67) to min pᵢ, which is [0, min pᵢ] for
    # any realistic prices. The widest band is the WEAKEST constraint: it
    # excludes almost nothing, so almost nothing can violate it and the pane has
    # nothing to report.
    #
    # A two- or three-leg parlay is where the band is tight enough for a quoted
    # price to fall outside it, which is the only mispricing this pane can find.
    # Those come first.
    ordered = sorted(combos, key=lambda combo: len(combo.legs))
    taken = ordered[: max(1, limit)]
    if len(ordered) > len(taken):
        result.notes.append(
            f"{len(ordered)} combos are listed and {len(taken)} were read, fewest legs first — the "
            "tightest bands, which are the only ones a price can fall outside: one "
            "bulk book call covers a hundred tickers and each parlay needs one per leg plus its "
            "own. Ask for a ticker to read a specific parlay."
        )
    return taken


async def observe_combos(
    client: KalshiClient,
    limit: int = MAX_COMBOS_PER_READ,
    ticker: str | None = None,
    listing: list[Combo] | None = None,
    listing_age_s: float | None = None,
) -> ComboObservation:
    """Fetch parlays and everything their legs need, in two calls.

    `ticker` names ONE parlay to read, and it exists because the exchange lists
    roughly a thousand and this reads the first few. Which few was decided by
    the venue's own listing order and changed between reads, so a reader who
    wanted a named parlay had no way to ask for it — it was in the answer or it
    was not, and usually it was not. A ticker that is not listed comes back as
    an empty read with a note saying so, never as a silent substitution.

    `listing` hands in a set of combos already parsed, so this makes one venue
    call instead of two. THE LISTING IS THE EXPENSIVE HALF and it is the half a
    named read cannot avoid: the combo and its legs are described there, so
    picking one parlay out by name still paid for all thousand of them. The
    refresher fetches that listing on its own cadence anyway.

    WHAT IT DOES NOT CHANGE is the answer. The combos and their legs come from
    the listing either way, and the prices come from a book call this still
    makes fresh every time. What it DOES change is that which parlays exist may
    be a few seconds old, and a parlay that has since settled could still be
    offered — a different staleness from the one `observed_age_s` reports, so
    `listing_age_s` is said in words rather than left to be inferred from a
    number about something else.
    """
    result = ComboObservation()
    combos = listing
    if combos is None:
        try:
            combos = await fetch_listing(client)
        except KalshiUnavailable as exc:
            result.notes.append(f"the combo listing could not be read: {exc.reason}")
            return result
    elif listing_age_s is not None:
        result.notes.append(
            f"the listing of open parlays is {listing_age_s:.1f}s old and was not re-read; the prices "
            "below come from a book call made for this request, so a parlay that settled in between "
            "would be offered at a fresh price it can no longer be traded at"
        )

    if not combos:
        result.notes.append("the exchange is listing no open combo markets right now")
        return result

    taken = _choose(combos, limit, ticker, result)
    if taken is None:
        return result
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
        result.rows.extend(rows_for_combo(combo, result.books))

    unquoted = len(taken) - len(result.quoted)
    if unquoted:
        result.notes.append(
            f"{unquoted} of {len(taken)} parlays carry no price on either side; their bands are "
            "shown because the legs still bound them, but nothing can be traded against them"
        )
    return result
