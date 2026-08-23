"""Runnable content for the two family lessons of the coherence lab.

Lessons 3-4 of ``web/lib/coherence/lessons.ts``: what a mutually exclusive
family costs, and what an absent quote is. Same shape as
``coherence_lab_lessons_book.py`` — see its docstring for why the content is
split across five modules.
"""

from __future__ import annotations

# ── Lesson 3 — basket ──────────────────────────────────────────────────────
_BASKET_FAMILY = """
from modules.coherence.drivers.kalshi_parse import parse_event
from modules.coherence.kernel import closedform, kelly
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.constraints import rows_for
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import build_component

SCHEDULE = FeeSchedule()
event = parse_event(fixture("event_mee")["body"])
component = build_component(event)
books = {market.ticker: market.top for market in event.markets}

print(f"  {event.title} ({event.event_ticker})")
print(f"  the exchange marks it mutually exclusive: {event.mutually_exclusive}")
print(f"  settlement sources: {event.settlement_sources}")
print()
asks = Decimal(0)
for node in component.nodes:
    quote = books[node.ticker]
    asks += quote.best_yes_ask
    print(f"    {node.label:<22} bid {quote.best_yes_bid}  ask {quote.best_yes_ask}")
print()
print(f"  buying every outcome costs {asks} for the dollar exactly one of them pays")
"""

_BASKET_CERTIFICATE = """
rows = rows_for(component, books)
certificate = closedform.solve(component, rows, SCHEDULE)
print(certificate.render_text())
"""

_BASKET_DUTCH = """
# Move one leg's offer down until the basket costs under a dollar. Nothing else
# changes: the same flag, the same states, the same fee model.
CHEAPER = dict(books)
target = component.nodes[2]
CHEAPER[target.ticker] = Book(
    ticker=target.ticker,
    yes_bids=(Level(Decimal("0.3000"), 5_000),),
    no_bids=(Level(Decimal("0.4800"), 5_000),),
)
cheap_asks = sum((CHEAPER[node.ticker].best_yes_ask for node in component.nodes), Decimal(0))
print(f"  {target.label} now offered at {CHEAPER[target.ticker].best_yes_ask}; the basket costs {cheap_asks}")
print()
print(closedform.solve(component, rows_for(component, CHEAPER), SCHEDULE).render_text())
"""

_BASKET_KELLY = """
# Sizing the family is not the scalar formula repeated. Exactly one outcome pays,
# so a dollar on one is partly a hedge for the dollar on another.
mids = {node.ticker: books[node.ticker].mid for node in component.nodes}
mass = sum(mids.values(), Decimal(0))
plan = kelly.solve([
    kelly.Candidate(node.ticker, node.label, mids[node.ticker] / mass, CHEAPER[node.ticker].best_yes_ask)
    for node in component.nodes
])

print(f"  {plan.detail}")
print()
for stake in plan.stakes:
    marker = "stake" if stake.admitted else "  -  "
    quantised = stake.probability.quantize(Decimal("0.0001"))
    print(f"  {marker} {stake.label:<22} q {quantised} @ {stake.price}  quarter-Kelly {stake.fraction.quantize(Decimal('0.0001'))}")
print()
print(f"  basket cost         {plan.basket_cost}")
print(f"  riskless log growth {plan.riskless_growth.quantize(Decimal('0.000001'))}   (equal contracts of every outcome, certain)")
print(f"  full Kelly growth   {plan.full_growth_rate.quantize(Decimal('0.000001'))}   (stakes in proportion to the measure)")
print(f"  quarter Kelly       {plan.growth_rate.quantize(Decimal('0.000001'))}   (the shipped default, shrinkage {plan.shrinkage})")
print(f"  worst-case wealth   {plan.worst_case_wealth.quantize(Decimal('0.0001'))} of the bankroll, so this plan can lose")
print()
print("  Full Kelly grows faster than the arbitrage precisely because it is taking a risk")
print("  the arbitrage refuses. The quarter does not, and that is the trade being made:")
print("  Kelly's growth curve is flat near the optimum and steep past it, so over-betting")
print("  costs far more than under-betting, and q here is read off a moving book.")
print()
print("  The certificate answers 'what can I be paid for holding nothing?'. Kelly answers")
print("  'what maximises growth if my measure is right?'. They are different portfolios.")
"""

_BASKET_FLAG = """
from dataclasses import replace

unflagged = build_component(replace(event, mutually_exclusive=False))
print(f"  the same five markets with the flag off: {len(rows_for(unflagged, books))} rows, against {len(rows)} with it")
for note in unflagged.notes:
    print(f"    {note}")
print()
print("  Buckets need not tile. Inferring exclusivity from floor and cap values asserts a")
print("  claim the venue did not make, and a family with a gap in it has no reason to sum")
print("  to anything.")
"""

# ── Lesson 4 — absence ─────────────────────────────────────────────────────
_ABSENCE_TWO_FACTS = """
from modules.coherence.drivers.kalshi_parse import parse_event, parse_market
from modules.coherence.kernel import coherence_index
from modules.coherence.kernel.book import Book, Level, parse_orderbook
from modules.coherence.kernel.lattice import build_component

nobody = Book(ticker="NOBODY", yes_bids=(), no_bids=())
at_zero = Book(ticker="ATZERO", yes_bids=(Level(Decimal("0.0000"), 10_000),), no_bids=())

print(f"  nobody will bid : best_yes_bid = {nobody.best_yes_bid!r}")
print(f"  bid at nothing  : best_yes_bid = {at_zero.best_yes_bid!r}   (zero is a legal price here)")
print(f"  are they equal? {nobody.best_yes_bid == at_zero.best_yes_bid}")
print()
print("  And the bug that collapses them, in one line of ordinary Python:")
print(f"    not None             -> {not None}")
print(f"    not Decimal('0.0000') -> {not Decimal('0.0000')}")
print("  `if not price:` treats a market nobody will bid on and a market bid at nothing")
print("  as the same fact. They are different facts.")
"""

_ABSENCE_RECORDED = """
one_sided = fixture("orderbook_one_sided")
thin_ticker = one_sided["source"].split("/markets/")[1].split("/")[0]
thin = parse_orderbook(thin_ticker, one_sided["body"]["orderbook_fp"])

print(f"  {thin_ticker}: {len(thin.yes_bids)} YES bids, {len(thin.no_bids)} NO bids")
print(f"    best YES bid {thin.best_yes_bid!r}")
print(f"    best YES ask {thin.best_yes_ask!r}")
print(f"    mid          {thin.mid!r}")
print()
print("  A real recorded book. Nobody bids for the outcome that will not happen, so in")
print("  the tails this is the ordinary case rather than a fault.")
"""

_ABSENCE_BASKET = """
event = parse_event(fixture("event_mee")["body"])
component = build_component(event)
books = {market.ticker: market.top for market in event.markets}
full = sum((books[node.ticker].best_yes_ask for node in component.nodes), Decimal(0))

blind = dict(books)
dropped = component.nodes[2]
blind[dropped.ticker] = Book(ticker=dropped.ticker, yes_bids=(), no_bids=())
readable = [node for node in component.nodes if blind[node.ticker].best_yes_ask is not None]
partial = sum((blind[node.ticker].best_yes_ask for node in readable), Decimal(0))

print(f"  every leg quoted                          : {full}")
print(f"  {dropped.label} unreadable, summed over the rest : {partial}")
print(f"  the skipped leg is worth {full - partial}, and skipping it invents {Decimal(1) - partial} of arbitrage")
print()
print("  A basket summed over only its quoted legs understates the cost by exactly the")
print("  legs it skipped, which is the direction that manufactures an opportunity.")
"""

_ABSENCE_INDEX = """
whole = coherence_index.measure(component, books)
print(f"  every leg readable : ci {whole.ci}  engine {whole.engine}")
print(f"    {whole.detail}")
print()
partial_reading = coherence_index.measure(component, blind)
print(f"  one leg unreadable : ci {partial_reading.ci!r}  engine {partial_reading.engine}")
print(f"    {partial_reading.detail}")
print()
print("  Null, with a reason. Not zero, which would read as perfect coherence and would")
print("  sit in the same column as the real measurements.")
"""

_ABSENCE_LADDER = """
rungs = [parse_market(row, "KXBTCD") for row in fixture("markets_crypto")["body"]["markets"]]
bid_side = sum(1 for market in rungs if market.top.best_yes_bid is not None)
ask_side = sum(1 for market in rungs if market.top.best_yes_ask is not None)

print(f"  {len(rungs)} rungs of a recorded BTC daily ladder")
print(f"    quoted on the bid side : {bid_side}")
print(f"    quoted on the ask side : {ask_side}")
print(f"    mids available         : {sum(1 for market in rungs if market.top.mid is not None)}")
print()
print("  Every bid on this ladder is absent, so every mid is null. None of those nulls is")
print("  a probability of zero, and a recorder that wrote zeros here would produce a tape")
print("  showing an exchange that priced the whole complex at nothing.")
"""

FAMILY_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "basket": (
        ("## 1. A real mutually exclusive family", _BASKET_FAMILY),
        ("## 2. The certificate on the quotes as recorded", _BASKET_CERTIFICATE),
        ("## 3. One leg cheaper, and the dollar goes on sale", _BASKET_DUTCH),
        ("## 4. Sizing it: the arbitrage and the growth-optimal plan are not the same trade", _BASKET_KELLY),
        ("## 5. The flag is the licence for the sum", _BASKET_FLAG),
    ),
    "absence": (
        ("## 1. Two different facts that render the same way", _ABSENCE_TWO_FACTS),
        ("## 2. A recorded one-sided book", _ABSENCE_RECORDED),
        ("## 3. What summing over only the quoted legs invents", _ABSENCE_BASKET),
        ("## 4. The index withholds rather than guesses", _ABSENCE_INDEX),
        ("## 5. Sixty rungs, no bids, and not one zero", _ABSENCE_LADDER),
    ),
}
