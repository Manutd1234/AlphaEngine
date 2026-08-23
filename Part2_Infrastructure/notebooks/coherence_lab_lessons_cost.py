"""Runnable content for the cost and structure lessons of the coherence lab.

Lessons 5-6 of ``web/lib/coherence/lessons.ts``: what a fill actually costs, and
what logical structure the exchange publishes about its own markets. Same shape
as ``coherence_lab_lessons_book.py`` — see its docstring for why the content is
split across five modules.
"""

from __future__ import annotations

# ── Lesson 5 — fees ────────────────────────────────────────────────────────
_FEES_PARABOLA = """
from modules.coherence.kernel.costs import (
    DEFAULT_TAKER_RATE,
    FeeSchedule,
    Fill,
    OrderFees,
    minimum_clip_hundredths,
    net_fee,
    no_arbitrage_bound,
    trade_fee,
)
from modules.coherence.kernel.money import contracts

SCHEDULE = FeeSchedule()
print(f"  published taker rate  {DEFAULT_TAKER_RATE}")
print(f"  series multiplier     {SCHEDULE.multiplier}   (it MULTIPLIES the rate, it is not the rate)")
print(f"  balance precision     {SCHEDULE.balance_precision}   (a hundred times finer for a direct member)")
print()
print("  price    trade fee on 100 contracts")
for cents in range(5, 100, 10):
    price = Decimal(cents) / 100
    print(f"  {price}     {trade_fee(Fill(price=price, size_hundredths=10_000), SCHEDULE)}")
print()
print("  A parabola peaking at fifty cents. It is the Bernoulli variance of the contract,")
print("  and it is why the fee-aware no-arbitrage test depends on WHERE the legs sit.")
"""

_FEES_WORKED = """
# Kalshi's own worked example: 0.09 contracts at $0.3301, filled in three lots.
order = OrderFees(schedule=FeeSchedule())
for lot in (3, 3, 3):
    piece = order.add(Fill(price=Decimal("0.3301"), size_hundredths=lot))
    print(f"  {lot} hundredths  trade {piece.trade_fee}  rounding {piece.rounding_fee}  rebate {piece.rebate}  net {piece.net}")

total = order.total
print()
print(f"  notional        {total.notional}")
print(f"  net fee         {total.net}")
print(f"  fee / notional  {total.as_fraction_of_notional.quantize(Decimal('0.0001'))}")
print()
print("  The first fill pays a trade fee of a twentieth of a cent against a rounding fee")
print("  nineteen times larger. The net fee exceeded the notional. Everyone models the")
print("  parabola; almost nobody models the component that dominated here.")
"""

_FEES_FRAGMENTATION = """
print("  20 contracts at $0.45, filled in different numbers of pieces:")
for pieces in (1, 3, 9, 100):
    breakdown = net_fee(Decimal("0.4500"), 2_000, SCHEDULE, fills=pieces)
    print(
        f"    {pieces:>3} fill(s)  trade {breakdown.trade_fee}  rounding {breakdown.rounding_fee}  "
        f"rebate {breakdown.rebate}  net {breakdown.net}"
    )
print()
print("  The received wisdom is that fragmentation is itself a cost, because each fill")
print("  pays its own rounding. Run the model and that is very nearly false: the rebate")
print("  accumulator grows exactly as the rounding does and they cancel. What survives is")
print("  a residual bounded by the one cent the accumulator never returns.")
"""

_FEES_CLIP = """
print("  smallest size at which an edge survives its own fees, assuming three fills:")
print()
print("  leg price   per-contract trade fee   edge 0.0500   edge 0.0200   edge 0.0050")
for leg_price in ("0.0500", "0.4500"):
    price = Decimal(leg_price)
    per_contract = trade_fee(Fill(price=price, size_hundredths=100), SCHEDULE)
    answers = []
    for edge_dollars in ("0.0500", "0.0200", "0.0050"):
        clip = minimum_clip_hundredths(price, Decimal(edge_dollars), SCHEDULE, expected_fills=3)
        answers.append("never" if clip is None else f"{contracts(clip)}")
    print(f"  {price}      {per_contract}                 " + "         ".join(f"{answer:>5}" for answer in answers))
print()
print("  Two things fall out. The minimum clip depends on WHERE the leg sits, because the")
print("  fee it has to clear is a parabola in the price. And an edge below the per-contract")
print("  fee never clears at any size — there is no clip that rescues it.")
print()
print("  Searched rather than solved: the fee has a ceiling and a floor in it, so it is a")
print("  step function of size and a closed form would be a fiction that happens to agree")
print("  at the tested points.")
"""

_FEES_BOUND = """
for label, legs in (
    ("three legs near the middle", [Decimal("0.3300")] * 3),
    ("three legs in the tails   ", [Decimal("0.0200"), Decimal("0.0300"), Decimal("0.9400")]),
):
    bound = no_arbitrage_bound(legs, SCHEDULE)
    naive = Decimal("1.0000")
    print(f"  {label}  sum of asks {sum(legs, Decimal(0))}")
    print(f"    naive threshold  {naive}")
    print(f"    real threshold   {bound.quantize(Decimal('0.000001'))}")
    print(f"    the gap the naive test invents: {(naive - bound).quantize(Decimal('0.000001'))}")
print()
print("  Both baskets cost exactly the same 0.9900 and clear the naive test by the same")
print("  cent. One of them is a trade and the other is not, and only the fee model knows")
print("  which. Testing sum(ask) < 1.00 is not a conservative version of the fee-aware")
print("  test: it is a different test, wrongest in the middle of the book, where the")
print("  volume is.")
"""

# ── Lesson 6 — lattice ─────────────────────────────────────────────────────
_LATTICE_LADDER = """
from modules.coherence.drivers.kalshi_parse import Event, parse_event, parse_market
from modules.coherence.kernel import distribution
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.lattice import Component, Node, build_component
from modules.coherence.kernel.states import build_states

crypto = [parse_market(row, "KXBTCD") for row in fixture("markets_crypto")["body"]["markets"]]
ladder_event = Event(
    event_ticker=crypto[0].event_ticker,
    series_ticker="KXBTCD",
    title="BTC daily strike ladder, from a recorded /markets payload",
    # The /markets route carries no exclusivity flag. False here because the
    # venue did not say otherwise, not because we decided it.
    mutually_exclusive=False,
    exchange_index=crypto[0].exchange_index,
    settlement_sources=(),
    markets=tuple(crypto),
)
ladder = build_component(ladder_event)

print(f"  {len(ladder.nodes)} rungs, {len(ladder.edges)} edges, scope {ladder.scope}")
print()
for edge in ladder.edges[:2]:
    print(f"  {edge.kind}: {edge.source} -> {edge.target}")
    print(f"    {edge.because}")
print()
print("  Only ADJACENT strikes are linked. The relation is transitive, so every")
print("  non-adjacent pair is implied by the chain and emitting them all would inflate")
print("  the matrix without adding a single constraint.")
"""

_LATTICE_SOURCES = """
fed = parse_event(fixture("event_mee")["body"])
print(f"  {fed.event_ticker} settles on {fed.settlement_sources}")
print(f"  the recorded /markets payloads carry no source at all: {ladder_event.settlement_sources}")
print()

# Two markets whose titles read alike, settling on different sources.
divergent = Component(
    component_id="LOOKALIKE",
    event_ticker="LOOKALIKE",
    series_ticker="LOOKALIKE",
    exchange_index=0,
    mutually_exclusive=False,
    nodes=[
        Node("A", "EA", "LOOKALIKE", 0, "custom", None, None, ("Source One",), "Highest temperature in NYC"),
        Node("B", "EB", "LOOKALIKE", 0, "custom", None, None, ("Source Two",), "NYC high temperature"),
    ],
)
sources = {node.settlement_sources for node in divergent.nodes}
print(f"  two lookalike titles, {len(sources)} distinct settlement sources: {sorted(sources)}")
print("  same payoff? The test is source equality, never title similarity. On the day")
print("  they disagree a 'hedged' position pays zero or two dollars rather than one.")
"""

_LATTICE_STATES = """
temps = [parse_market(row, "KXHIGHNY") for row in fixture("markets_ladder")["body"]["markets"]]
weather_event = Event(
    event_ticker=temps[0].event_ticker,
    series_ticker="KXHIGHNY",
    title="NYC high temperature, from a recorded /markets payload",
    mutually_exclusive=False,
    exchange_index=0,
    settlement_sources=(),
    markets=tuple(temps),
)
weather = build_component(weather_event)
space = build_states(weather)

print(f"  {space.note}")
print()
print("  market                  " + "  ".join(f"{state:>16}" for state in space.states))
for label, row in zip(space.labels, space.payoff, strict=True):
    print(f"  {label:<22}  " + "  ".join(f"{value:>16}" for value in row))
print()
print("  Three of these intervals are states no market pays in, because the underlying is")
print("  whole degrees and the listed buckets are 80-81, 82-83, 84-85. That is why the")
print("  exclusivity FLAG beats our inference from two strike numbers when it is present.")
"""

_LATTICE_PMF = """
weather_books = {market.ticker: market.top for market in temps}
surface = distribution.build_surface(weather, weather_books)

print(f"  engine {surface.engine} on the {surface.basis} side; {surface.detail}")
print()
for item in surface.bins:
    print(f"    {item.label:<26} {item.mass}")
print()
print(f"  total mass       {surface.total_mass}")
print(f"  tail below       {surface.tail_mass_low}")
print(f"  tail above       {surface.tail_mass_high}")
print(f"  moments          {surface.mean!r}")
print(f"  why              {surface.moments_note}")
"""

_LATTICE_NEGATIVE = """
# A ladder quoted so that a higher strike is DEARER than a lower one. The
# subtraction shows it as a bin below the axis; constraints.py prices the same
# fault as a monotone violation.
STRIKES = (("100000", "0.6000", "0.3800"), ("105000", "0.6400", "0.3400"), ("110000", "0.2000", "0.7800"))
rungs = [
    Node(f"T{strike}", "SYN", "SYN", 0, "greater", Decimal(strike), None, ("synthetic",), f"above {strike}")
    for strike, _yes, _no in STRIKES
]
inverted = Component(
    component_id="SYN", event_ticker="SYN", series_ticker="SYN",
    exchange_index=0, mutually_exclusive=False, nodes=rungs,
)
inverted_books = {
    node.ticker: Book(
        ticker=node.ticker,
        yes_bids=(Level(Decimal(yes_bid), 10_000),),
        no_bids=(Level(Decimal(no_bid), 10_000),),
    )
    for node, (_strike, yes_bid, no_bid) in zip(rungs, STRIKES, strict=True)
}

bad = distribution.build_surface(inverted, inverted_books)
for item in bad.bins:
    flag = "   NEGATIVE MASS" if item.is_negative else ""
    print(f"    {item.label:<26} {item.mass}{flag}")
print()
print(f"  negative bins: {bad.negative_bins}")
print(f"  total mass still {bad.total_mass}, which is why totalling the pmf cannot find this")
"""

COST_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "fees": (
        ("## 1. The trade fee is a parabola, not a rate", _FEES_PARABOLA),
        ("## 2. The venue's own worked example, where rounding was the whole cost", _FEES_WORKED),
        ("## 3. What fragmentation actually costs, measured", _FEES_FRAGMENTATION),
        ("## 4. The minimum economic clip size, derived rather than guessed", _FEES_CLIP),
        ("## 5. The threshold a basket really has to beat", _FEES_BOUND),
    ),
    "lattice": (
        ("## 1. A recorded ladder, and the implications the venue's own metadata carries", _LATTICE_LADDER),
        ("## 2. Settlement sources are the equivalence test", _LATTICE_SOURCES),
        ("## 3. From structure to states of the world", _LATTICE_STATES),
        ("## 4. The distribution those prices imply", _LATTICE_PMF),
        ("## 5. A survival curve that rises, and the bin below the axis", _LATTICE_NEGATIVE),
    ),
}
