"""Runnable content for the two measure lessons of the coherence lab.

The ``distribution`` and ``kelly`` lessons of ``web/lib/coherence/lessons.ts``:
reading a ladder of quotes as a probability distribution, and sizing a family
against a measure once you have one. Both render on the ``lattice`` pane, which
carries several lessons. Same shape as ``coherence_lab_lessons_book.py`` — see
its docstring for why the content is split across modules.
"""

from __future__ import annotations

# ── distribution ───────────────────────────────────────────────────────────
_PMF_LADDER = """
from modules.coherence.kernel import distribution, moments
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.lattice import Component, Edge, Node

#: strike, YES bid, NO bid. A two-cent spread, so the mid is bid + 0.01.
RUNGS = (
    ("100000", "0.8100", "0.1700"),
    ("102000", "0.6000", "0.3800"),
    ("104000", "0.3700", "0.6100"),
    ("106000", "0.1600", "0.8200"),
    ("108000", "0.0400", "0.9400"),
)


def ladder(rungs):
    \"\"\"A threshold family and the two-sided books that quote it.\"\"\"
    nodes = [
        Node(f"T{strike}", "SYN", "KXBTCD", 0, "greater", Decimal(strike), None, ("synthetic",), f"above {strike}")
        for strike, _yes, _no in rungs
    ]
    books = {
        node.ticker: Book(
            ticker=node.ticker,
            yes_bids=(Level(Decimal(yes_bid), 20_000),),
            no_bids=(Level(Decimal(no_bid), 20_000),),
        )
        for node, (_strike, yes_bid, no_bid) in zip(nodes, rungs, strict=True)
    }
    # Monotonicity along the ladder, adjacent pairs only — the edges
    # `build_component` derives from the venue's own strike metadata.
    edges = [
        Edge(
            kind="implies", source=higher.ticker, target=lower.ticker, scope="same-event",
            because=(
                f"every outcome above {higher.floor_strike} is also above {lower.floor_strike}, "
                f"so P({higher.label}) cannot exceed P({lower.label})"
            ),
        )
        for lower, higher in zip(nodes, nodes[1:], strict=False)
    ]
    component = Component(
        component_id="SYN", event_ticker="SYN", series_ticker="KXBTCD",
        exchange_index=0, mutually_exclusive=False, nodes=nodes, edges=edges,
    )
    return component, books


family, books = ladder(RUNGS)
surface = distribution.build_surface(family, books)

print(f"  {surface.detail}, read on the {surface.basis} side")
print()
print("  strike     survival S(k)")
for probe in surface.probes:
    print(f"  {probe.strike}     {probe.survival}   ({probe.origin})")
"""

_PMF_TELESCOPE = """
print("  interval                     mass = S(low) - S(high)")
for item in surface.bins:
    print(f"  {item.label:<26}   {item.mass}")
print()
total = sum((item.mass for item in surface.bins), Decimal(0))
print(f"  masses total {total}")
print(f"  exactly one, as Decimals: {total == Decimal(1)}")
print()
print("  It cannot come out otherwise, and the reason is worth writing down rather")
print("  than checking. The sum telescopes:")
print()
print("     (1 - S1) + (S1 - S2) + (S2 - S3) + ... + (S(n-1) - Sn) + Sn  =  1")
print()
print("  every interior survival value appearing once with each sign. So a pmf that")
print("  fails to total one is a defect in the reader, never a fact about the market —")
print("  and totalling the bins is therefore useless as a coherence test.")
"""

_PMF_MOMENTS = """
interior = [(item.representative, item.mass) for item in surface.bins if item.representative is not None]
excluded = (surface.tail_mass_low or Decimal(0)) + (surface.tail_mass_high or Decimal(0))

print(f"  bounded interior bins : {len(interior)} of {len(surface.bins)}")
print(f"  tail below the lowest strike  : {surface.tail_mass_low}")
print(f"  tail above the highest strike : {surface.tail_mass_high}")
print(f"  excluded from every moment    : {excluded}")
print()
print(f"  mean              {surface.mean.quantize(Decimal('0.01'))}")
print(f"  variance          {surface.variance.quantize(Decimal('0.01'))}")
print(f"  skewness          {surface.skewness.quantize(Decimal('0.0001'))}")
print(f"  excess kurtosis   {surface.excess_kurtosis.quantize(Decimal('0.0001'))}")
print()
print(f"  {surface.moments_note}")
print()

# The same call, made directly, on the same points. `moments.central` knows
# nothing about strikes or books: it takes points on a line with weights.
mean, _var, _skew, _ex, note = moments.central(interior)
print(f"  moments.central on those {len(interior)} points gives mean {mean.quantize(Decimal('0.01'))}, the same")
print(f"  number, because it is the same call: {note}")
print()
print("  The top bin is 'above 108000'. It has mass and no width, so it has no")
print("  representative point, so it is left out rather than given an invented one. A")
print("  mean that pretended it sat at its floor would be a property of that convention.")
"""

_PMF_NEGATIVE = """
# One rung repriced: 104000 now trades DEARER than 102000, which says an outcome
# above 104000 is likelier than one above 102000 — when every outcome in the
# first set is in the second.
BROKEN = (
    ("100000", "0.8100", "0.1700"),
    ("102000", "0.6000", "0.3800"),
    ("104000", "0.7100", "0.2700"),
    ("106000", "0.1600", "0.8200"),
    ("108000", "0.0400", "0.9400"),
)
broken_family, broken_books = ladder(BROKEN)
broken = distribution.build_surface(broken_family, broken_books)

for item in broken.bins:
    flag = "   NEGATIVE MASS" if item.is_negative else ""
    print(f"  {item.label:<26}   {item.mass}{flag}")
print()
print(f"  negative bins : {broken.negative_bins}")
print(f"  total mass    : {sum((item.mass for item in broken.bins), Decimal(0))}")
print()
print("  Still exactly one. The telescoping identity holds over a broken ladder just as")
print("  well, which is precisely why a total is not a test and a bar below the axis is.")
"""

_PMF_PRICED = """
from modules.coherence.kernel import closedform
from modules.coherence.kernel.constraints import rows_for
from modules.coherence.kernel.costs import FeeSchedule

rows = rows_for(broken_family, broken_books, families=("monotone",))
violated = [row for row in rows if row.violated]
print(f"  {len(rows)} monotone rows tested, {len(violated)} violated")
for row in violated:
    print(f"    slack {row.slack} on {row.executable_size_hundredths / 100} contracts")
print()
print(closedform.solve(broken_family, rows, FeeSchedule()).render_text())
print()
print("  The pmf SHOWS the fault as a bar below the axis. The constraint row PRICES it.")
print("  They are the same fault seen from two sides, and neither is derived from the")
print("  other — which is why the negative bin is worth rendering rather than repairing.")
"""

# ── kelly ──────────────────────────────────────────────────────────────────
_KELLY_TEXTBOOK = """
from modules.coherence.kernel import kelly

# The textbook case, so the machinery can be checked against a number a reader
# already knows: an even-money bet at 60/40. Kelly says stake a fifth.
textbook = kelly.solve(
    [
        kelly.Candidate("HEADS", "Heads", Decimal("0.60"), Decimal("0.50")),
        kelly.Candidate("TAILS", "Tails", Decimal("0.40"), Decimal("0.50")),
    ],
    shrinkage=Decimal(1),
)
for stake in textbook.stakes:
    print(f"  {stake.label:<8} q {stake.probability}  price {stake.price}  full fraction {stake.full_fraction}")
print()
print(f"  full fraction on the favourite : {textbook.stakes[0].full_fraction}")
print(f"  exactly one fifth              : {textbook.stakes[0].full_fraction == Decimal('0.20')}")
print(f"  cash held                      : {textbook.full_cash_fraction}")
print(f"  cash rate R                    : {textbook.reserve_rate}")
print()
print("  This is f* = (bp - q) / b at b = 1: (0.60 - 0.40) / 1 = 0.20. The exact solution")
print("  here reproduces it, because the scalar formula is the one-outcome case of the")
print("  same joint problem — and nothing but the joint problem is right past two outcomes.")
"""

_KELLY_CASE = """
# The case that matters. Three mutually exclusive outcomes whose offers total
# under a dollar, so a riskless profit exists AND a growth-optimal plan exists,
# and they are not the same portfolio.
FAMILY = (
    ("A", "Outcome A", "0.5", "0.30"),
    ("B", "Outcome B", "0.3", "0.32"),
    ("C", "Outcome C", "0.2", "0.32"),
)
candidates = [
    kelly.Candidate(ticker, label, Decimal(probability), Decimal(price))
    for ticker, label, probability, price in FAMILY
]
full = kelly.solve(candidates, shrinkage=Decimal(1))

print(f"  {full.detail}")
print()
print("  outcome      q      price    q/price    full Kelly stake")
for stake in full.stakes:
    ratio = (stake.probability / stake.price).quantize(Decimal("0.0001"))
    print(f"  {stake.label:<11} {stake.probability}    {stake.price}     {ratio}     {stake.full_fraction}")
print()
print(f"  basket cost           {full.basket_cost}")
print(f"  arbitrage available   {full.arbitrage_available}")
print(f"  cash held             {full.cash_fraction}")
print(f"  cash rate R           {full.reserve_rate}   (zero: with the basket under a dollar there is no reason to hold cash)")
"""

_KELLY_NOT_ARBITRAGE = """
print(f"  riskless log growth   {full.riskless_growth.quantize(Decimal('0.000001'))}   = ln(1 / {full.basket_cost})")
print(f"  Kelly log growth      {full.growth_rate.quantize(Decimal('0.000001'))}")
print(f"  worst-case wealth     {full.worst_case_wealth.quantize(Decimal('0.0001'))} of the bankroll")
print()
print("  What each portfolio pays, per dollar of bankroll, in each state:")
print()
cash = Decimal(1) - sum((stake.full_fraction for stake in full.stakes), Decimal(0))
certain = Decimal(1) / full.basket_cost
print("  state        arbitrage basket   Kelly plan")
for stake in full.stakes:
    kelly_wealth = cash + stake.full_fraction / stake.price
    print(f"  {stake.label:<11}  {certain.quantize(Decimal('0.0001'))}           {kelly_wealth.quantize(Decimal('0.0001'))}")
print()
print("  THE KELLY PLAN IS NOT THE ARBITRAGE. The Dutch book buys an EQUAL NUMBER of")
print("  contracts of every outcome; that is what makes its payoff a flat dollar in every")
print("  state and its profit certain — the same 1.0638 in each row above. Kelly buys")
loss = (Decimal(1) - full.worst_case_wealth) * 100
print("  stakes in proportion to q, which is a different portfolio: it grows faster in the")
print(f"  long run and its worst state leaves {full.worst_case_wealth.quantize(Decimal('0.0001'))} of the bankroll — a {loss.quantize(Decimal('0.1'))}% loss")
print("  on a single settlement.")
print()
print("  A plan is therefore reported with its worst state next to its growth rate, and")
print("  where an arbitrage exists the certain alternative is priced beside it, so that")
print("  the two are never mistaken for each other.")
"""

_KELLY_SHRINKAGE = """
quarter = kelly.solve(candidates)
print(f"  shipped default shrinkage : {quarter.shrinkage}")
print(f"  full Kelly growth         : {quarter.full_growth_rate.quantize(Decimal('0.000001'))}")
print(f"  quarter Kelly growth      : {quarter.growth_rate.quantize(Decimal('0.000001'))}")
print(f"  full Kelly worst state    : {full.worst_case_wealth.quantize(Decimal('0.0001'))}")
print(f"  quarter Kelly worst state : {quarter.worst_case_wealth.quantize(Decimal('0.0001'))}")
print()
print("  Full Kelly maximises growth only if q is correct, and q here is inferred from")
print("  quotes that move. The growth curve is flat near the optimum and steep past it,")
print("  so over-betting costs far more than under-betting. Both fractions are reported")
print("  and the caller is told which one it is looking at.")
"""

_KELLY_NO_EDGE = """
# Where the measure comes from decides whether any of this means anything.
NO_EDGE = (("A", "Outcome A", "0.35"), ("B", "Outcome B", "0.35"), ("C", "Outcome C", "0.35"))
mid_priced = kelly.solve([
    kelly.Candidate(ticker, label, Decimal(1) / 3, Decimal(price)) for ticker, label, price in NO_EDGE
])
print(f"  {mid_priced.detail}")
print(f"  cash held  {mid_priced.cash_fraction}")
print(f"  growth     {mid_priced.growth_rate}")
print()
print("  Feed this the market's own prices as the measure and it correctly tells you to")
print("  bet nothing, because you have no edge over the prices you are quoting back. The")
print("  measure worth feeding it is the COHERENT one — the nearest price vector that")
print("  admits a probability, which dutchbook and coherence_index already compute. Then")
print("  the edge being sized is the incoherence itself, which is the only edge this")
print("  engine ever claims to find.")
"""

MEASURE_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "distribution": (
        ("## 1. A ladder of strikes is a survival function, sampled", _PMF_LADDER),
        ("## 2. Difference it, and the masses telescope to exactly one", _PMF_TELESCOPE),
        ("## 3. The moments are conditional on the bounded interior", _PMF_MOMENTS),
        ("## 4. Break monotonicity and the bin goes below the axis", _PMF_NEGATIVE),
        ("## 5. The same fault, priced", _PMF_PRICED),
    ),
    "kelly": (
        ("## 1. The textbook case, so the machinery can be checked by hand", _KELLY_TEXTBOOK),
        ("## 2. The case that matters: a family whose offers total under a dollar", _KELLY_CASE),
        ("## 3. Growth-optimal is not riskless", _KELLY_NOT_ARBITRAGE),
        ("## 4. Why the shipped default is a quarter", _KELLY_SHRINKAGE),
        ("## 5. Where q comes from decides whether any of it means anything", _KELLY_NO_EDGE),
    ),
}
