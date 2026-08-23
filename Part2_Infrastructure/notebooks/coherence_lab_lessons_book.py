"""Runnable content for the first three lessons of the coherence lab.

Lessons 0-2 of ``web/lib/coherence/lessons.ts``: what a Kalshi book is, what a
price is, and which prices exist. Every code block here is executed by
``notebooks/build_coherence_lab.py`` as a notebook cell, against the real kernel
and the responses recorded in ``tests/fixtures/coherence/``.

The lab's content is split across four modules because of the 400-line file
ceiling ``tests/test_file_size.py`` enforces. They all have the same shape and
``coherence_lab_content.py`` joins them into one mapping.

Each entry maps a lesson id to a tuple of ``(markdown heading, code)`` sections.
The code is written at column zero, so what is read here is exactly what a
reader sees in the notebook.
"""

from __future__ import annotations

# ── Lesson 0 — book ────────────────────────────────────────────────────────
_BOOK_LADDERS = """
from modules.coherence.kernel.book import Book, Level, lesson_zero_identity, parse_orderbook

recorded = fixture("orderbook_two_sided")
ticker = recorded["source"].split("/markets/")[1].split("/")[0]
book = parse_orderbook(ticker, recorded["body"]["orderbook_fp"])
captured = recorded["captured_at"]

print(f"{ticker}, recorded {captured}")
print(f"  {len(book.yes_bids)} resting YES bids")
print(f"  {len(book.no_bids)} resting NO bids")
print("  0 asks, on either side. The venue publishes none.")
print()
print("  top of each ladder, kept as sent (ascending, best last):")
print(f"    YES {book.yes_bids[-1].price} for {book.yes_bids[-1].size} contracts")
print(f"    NO  {book.no_bids[-1].price} for {book.no_bids[-1].size} contracts")
"""

_BOOK_ASKS = """
print("Every ask below is a reading of the opposite ladder, not a queue of its own:")
print(f"  best YES bid   {book.best_yes_bid}   a real resting order")
print(f"  best NO bid    {book.best_no_bid}   a real resting order")
print(f"  best YES ask   {book.best_yes_ask}   = 1 - no_bid")
print(f"  best NO ask    {book.best_no_ask}   = 1 - yes_bid")
print(f"  spread         {book.spread}")
"""

_BOOK_IDENTITY = """
left, right = lesson_zero_identity(book)
print(f"  yes_ask + no_ask = {left}")
print(f"  1 + spread       = {right}")
print(f"  identical        : {left == right}")
print()

# Not a property of this book. Sweep every one-cent pair of bids and it holds.
checked = 0
broken = 0
for yes_cents in range(1, 100):
    for no_cents in range(1, 100):
        probe = Book(
            ticker="PROBE",
            yes_bids=(Level(Decimal(yes_cents) / 100, 10_000),),
            no_bids=(Level(Decimal(no_cents) / 100, 10_000),),
        )
        pair = lesson_zero_identity(probe)
        checked += 1
        if pair is None or pair[0] != pair[1]:
            broken += 1
print(f"  {checked} synthetic books swept, {broken} broke the identity")
"""

_BOOK_UNREACHABLE = """
pairs = 0
under_a_dollar = 0
cheapest = None
for yes_level in book.asks("yes"):
    for no_level in book.asks("no"):
        total = yes_level.price + no_level.price
        pairs += 1
        if total < Decimal(1):
            under_a_dollar += 1
        cheapest = total if cheapest is None else min(cheapest, total)

print(f"  {pairs} (YES ask, NO ask) pairs across the whole recorded book")
print(f"  cheapest pair sums to     {cheapest}")
print(f"  pairs under a dollar      {under_a_dollar}")
print(f"  1 + spread                {Decimal(1) + book.spread}")
print()
print("  The cheapest pair IS one plus the spread, because both asks are read off the")
print("  best bid on the other side. Every deeper level is worse. The branch that hunts")
print("  for a sum below a dollar cannot fire on a single snapshot: it is dead code.")
"""

_BOOK_TORN = """
# The one way the sum falls below a dollar: the two ladders read at different
# instants. Shift the NO ladder by the spread plus a tick and read the YES
# ladder as it was a moment ago.
shift = book.spread + Decimal("0.0100")
torn = Book(
    ticker=book.ticker,
    yes_bids=book.yes_bids,
    no_bids=(Level(book.best_no_bid + shift, 10_000),),
)
print(f"  ladders {shift} apart in time")
print(f"  yes_ask {torn.best_yes_ask} + no_ask {torn.best_no_ask} = {torn.best_yes_ask + torn.best_no_ask}")
print(f"  and the implied spread is {torn.spread}, which no single instant can be")
print()
print("  A bot that fires here is trading its own latency, not the market's prices.")
"""

# ── Lesson 1 — fixedpoint ──────────────────────────────────────────────────
_FP_SIGN = """
from modules.coherence.kernel.money import (
    CENTICENT,
    MoneyError,
    ceil_to_centicent,
    contracts,
    floor_to_precision,
    format_dollars,
    one_minus,
    parse_dollars,
    parse_fp,
)

legs = ["0.7000", "0.2000", "0.1000"]

# Accumulated leg by leg, which is what pricing a basket looks like.
exact = Decimal(0)
running = 0.0
for leg in legs:
    exact += parse_dollars(leg)
    running += float(leg)

print(f"  three legs of a mutually exclusive family: {legs}")
print(f"    Decimal, added leg by leg : {exact}  ->  total - 1 = {exact - 1}")
print(f"    float,   added leg by leg : {running!r}  ->  total - 1 = {running - 1.0!r}")
print()
print(f"    Decimal says this basket is a Dutch book: {exact < 1}")
print(f"    float   says this basket is a Dutch book: {running < 1.0}")
print()
print("  The sign of total - 1 is the entire answer, and the float engine has just")
print("  invented a Dutch book out of three exact prices.")
print()
print("  Worse, it is not reproducible. CPython's own sum() compensates, so the SAME legs")
print(f"  come to {sum(float(leg) for leg in legs)!r} there — the fault depends on how the loop happened to")
print("  be written, which is the hardest kind of defect to find in a running system.")
"""

_FP_TICKS = """
print(f"  0.1 + 0.2 == 0.3 in binary64 : {0.1 + 0.2 == 0.3}")
print(f"  the same sum in Decimal      : {parse_dollars('0.1') + parse_dollars('0.2') == parse_dollars('0.3')}")
print()
eight = [parse_dollars("0.1250")] * 8
ten = [parse_dollars("0.1000")] * 10
print(f"  eight legs at 0.1250 total {sum(eight, Decimal(0))} exactly")
print(f"  ten legs at 0.1000 total   {sum(ten, Decimal(0))} exactly")

running_ten = 0.0
for _ in range(10):
    running_ten += 0.1
print(f"  ten float legs at 0.1, added one at a time, total {running_ten!r}")
"""

_FP_REFUSALS = """
# There is no sensible fallback for an unparseable price: zero is a legal Kalshi
# price, so any guess invents liquidity. The parser refuses and the caller
# reports the market as unreadable.
for candidate in (0.42, 42, True, "", "0.4200000", "cheap"):
    try:
        parsed = parse_dollars(candidate)
    except MoneyError as exc:
        print(f"  {candidate!r:>12}  refused: {exc}")
    else:
        print(f"  {candidate!r:>12}  accepted as {parsed}")
"""

_FP_QUANTA = """
hundredths = parse_fp("0.09")
print(f"  parse_fp('0.09') = {hundredths} hundredths = {contracts(hundredths)} contracts")
print(f"  fractional contracts are unconditional here, at {contracts(1)} granularity")
print()
raw = Decimal("0.07") * contracts(hundredths) * Decimal("0.3301") * one_minus(Decimal("0.3301"))
fee = ceil_to_centicent(raw)
print(f"  a raw trade fee of {raw}")
print(f"  ceils UP to {fee}, because the quantum is {CENTICENT}")
change = -Decimal("0.3301") * contracts(hundredths) - fee
floored = floor_to_precision(change, Decimal("0.01"))
print(f"  the balance change {change} floors to {floored}")
print(f"  and the shortfall {change - floored} is charged as the rounding fee")
print()
print(f"  a YES bid at 0.4200 is a NO ask at {format_dollars(one_minus(parse_dollars('0.4200')))}")
"""

# ── Lesson 2 — grid ────────────────────────────────────────────────────────
_GRID_RECORDED = """
from modules.coherence.kernel.grid import GridError, parse_price_ranges

row = fixture("markets_ladder")["body"]["markets"][0]
recorded_ticker = row["ticker"]
grid = parse_price_ranges(row["price_ranges"], row["price_level_structure"])

print(f"  {recorded_ticker} publishes structure {grid.structure!r}")
for band in grid.bands:
    print(f"    [{band.start}, {band.end}] step {band.step}")
print(f"  finest step {grid.finest_step}")
print()
print("  Every market in the captured fixtures sits on one flat cent band. That is a")
print("  fact about what was recorded, not a licence to assume it.")
"""

_GRID_BANDED = """
# A banded payload of the shape the venue documents: finer ticks at the edges,
# where a cent is a large fraction of the contract. Written out here rather than
# recorded, because none of the captured markets carries more than one band.
BANDED = [
    {"start": "0.0000", "end": "0.1000", "step": "0.0010"},
    {"start": "0.1000", "end": "0.9000", "step": "0.0100"},
    {"start": "0.9000", "end": "1.0000", "step": "0.0010"},
]
banded = parse_price_ranges(BANDED, "edges_finer_than_the_centre")

print("  price     band step   valid   buy snaps to   sell snaps to")
for probe in ("0.0500", "0.0505", "0.4250", "0.9505"):
    price = Decimal(probe)
    step = banded.band_for(price).step
    print(
        f"  {price}    {step}      {str(banded.is_valid(price)):<6}  "
        f"{banded.snap(price, 'buy')}         {banded.snap(price, 'sell')}"
    )
print()
print("  The step depends on WHERE the price is, so snapping is a lookup, not a division.")
"""

_GRID_DIRECTION = """
price = Decimal("0.4250")
print(f"  {price} is off the grid in the centre band.")
print(f"    a buy  snaps UP   to {banded.snap(price, 'buy')} — you must be willing to pay the next valid price")
print(f"    a sell snaps DOWN to {banded.snap(price, 'sell')} — you must be willing to accept the next one")
print()
print("  Neither ever moves toward the price that would flatter the trade. A leg snapped")
print("  the wrong way turns a positive edge negative while still looking executable.")
"""

_GRID_NAME_TRAP = """
cent = parse_price_ranges([{"start": "0.0000", "end": "1.0000", "step": "0.0100"}], "linear_cent")
edge_price = Decimal("0.0505")
by_bands = banded.snap(edge_price, "buy")
by_name = cent.snap(edge_price, "buy")

print(f"  reading the market's own bands prices {edge_price} at {by_bands}")
print(f"  switching on the STRUCTURE NAME instead sends {by_name}")
print(f"  that is {by_name - by_bands} per contract given away on a contract worth {edge_price}")
print()
print("  There are a dozen structure names and new ones arrive by changelog. A client")
print("  that reads the bands is correct for structures that do not exist yet.")
print()
try:
    parse_price_ranges(None, "linear_cent")
except GridError as exc:
    print(f"  With no bands at all the engine refuses rather than defaulting: {exc}")
"""

BOOK_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "book": (
        ("## 1. The two ladders, as the venue sent them", _BOOK_LADDERS),
        ("## 2. The asks nobody published", _BOOK_ASKS),
        ("## 3. The identity, on this book and on ten thousand others", _BOOK_IDENTITY),
        ("## 4. Why 'buy both sides under a dollar' is unreachable", _BOOK_UNREACHABLE),
        ("## 5. The only way it appears to fail: a torn snapshot", _BOOK_TORN),
    ),
    "fixedpoint": (
        ("## 1. The sign of `total - 1` is the whole answer", _FP_SIGN),
        ("## 2. Ticks that are exact, and floats that are not", _FP_TICKS),
        ("## 3. A price we cannot read is refused, never defaulted", _FP_REFUSALS),
        ("## 4. The exchange's own quanta", _FP_QUANTA),
    ),
    "grid": (
        ("## 1. The bands a recorded market actually published", _GRID_RECORDED),
        ("## 2. A banded grid: the step depends on where the price is", _GRID_BANDED),
        ("## 3. Snapping is directional, and never optimistic", _GRID_DIRECTION),
        ("## 4. The failure: reading the structure name instead of the bands", _GRID_NAME_TRAP),
    ),
}
