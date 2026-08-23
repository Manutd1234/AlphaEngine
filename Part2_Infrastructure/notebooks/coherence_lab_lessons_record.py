"""Runnable content for the last lesson of the coherence lab.

Lesson 9 of ``web/lib/coherence/lessons.ts``: incoherence as a continuous
measurement that exists on the ordinary day too, and the external check that
coherence alone can never make — whether the prices were right. Same shape as
``coherence_lab_lessons_book.py`` — see its docstring for why the content is
split across five modules.
"""

from __future__ import annotations

# ── Lesson 9 — index ───────────────────────────────────────────────────────
_INDEX_BASKET = """
from modules.coherence.drivers.kalshi_parse import parse_event
from modules.coherence.kernel import calibration, coherence_index
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.lattice import Component, Node, build_component

event = parse_event(fixture("event_mee")["body"])
component = build_component(event)
books = {market.ticker: market.top for market in event.markets}
reading = coherence_index.measure(component, books)

print(f"  ci      {reading.ci}")
print(f"  engine  {reading.engine}")
print(f"  priced  {reading.markets_priced} of {reading.markets_total}")
print(f"  detail  {reading.detail}")
print()
print("  No Dutch book here. The index still exists, which is the point: it is a number on")
print("  every poll rather than only when a violation appears, so it makes a time series.")
"""

_INDEX_ASK = """
one_sided = dict(books)
tail = component.nodes[4]
one_sided[tail.ticker] = Book(
    ticker=tail.ticker,
    yes_bids=(),
    no_bids=(Level(Decimal("0.8000"), 10_000),),
)
ask_reading = coherence_index.measure(component, one_sided)

print(f"  ci      {ask_reading.ci}")
print(f"  engine  {ask_reading.engine}")
print(f"  detail  {ask_reading.detail}")
print()
print("  Two measurements, one column — so the engine name travels with every reading. The")
print("  ask-side distance is a real quantity and a strictly upper one; silently mixing it")
print("  into the mid-price series would make the tape two things at once.")
"""

_INDEX_LADDER = """
STRIKES = (("100000", "0.6000", "0.3800"), ("105000", "0.6400", "0.3400"), ("110000", "0.2000", "0.7800"))
rungs = [
    Node(f"T{strike}", "SYN", "KXBTCD", 0, "greater", Decimal(strike), None, ("synthetic",), f"above {strike}")
    for strike, _yes, _no in STRIKES
]
ladder = Component(
    component_id="SYN", event_ticker="SYN", series_ticker="KXBTCD",
    exchange_index=0, mutually_exclusive=False, nodes=rungs,
)
ladder_books = {
    node.ticker: Book(
        ticker=node.ticker,
        yes_bids=(Level(Decimal(yes_bid), 10_000),),
        no_bids=(Level(Decimal(no_bid), 10_000),),
    )
    for node, (_strike, yes_bid, no_bid) in zip(rungs, STRIKES, strict=True)
}
for node in rungs:
    print(f"  {node.label:<16} mid {ladder_books[node.ticker].mid}")
print()
ladder_reading = coherence_index.measure(ladder, ladder_books)
print(f"  ci      {ladder_reading.ci}")
print(f"  engine  {ladder_reading.engine}")
print(f"  detail  {ladder_reading.detail}")
print()
print("  A survival function cannot rise, so the nearest coherent vector is the nearest")
print("  non-increasing one — the isotonic regression under L1, fitted by pool-adjacent-")
print("  violators with the MEDIAN of each block, because the objective is L1 and the mean")
print("  would quietly solve a different problem.")
"""

_INDEX_NULL = """
unconstrained = Component(
    component_id="ONE", event_ticker="ONE", series_ticker="ONE",
    exchange_index=0, mutually_exclusive=False,
    nodes=[
        Node("ONE-A", "ONE", "ONE", 0, "custom", None, None, ("S",), "Outcome A"),
        Node("ONE-B", "ONE", "ONE", 0, "custom", None, None, ("S",), "Outcome B"),
    ],
)
null_reading = coherence_index.measure(unconstrained, {})
print(f"  ci      {null_reading.ci!r}")
print(f"  engine  {null_reading.engine}")
print(f"  detail  {null_reading.detail}")
print()
print("  Null, not zero. A zero here would read as perfect efficiency — the most")
print("  misleading value available — and it would sit in the same column as real")
print("  measurements of the families that ARE constrained.")
"""

_INDEX_CALIBRATION = """
# Coherence is an internal property: a price vector can be perfectly coherent and
# perfectly wrong, because nothing in a Dutch-book test compares a price to the
# world. This is the other comparison, on a corpus that has since settled.
BANDS = (
    ("0.05", 200, 6), ("0.15", 200, 24), ("0.25", 200, 46), ("0.35", 200, 66), ("0.45", 200, 88),
    ("0.55", 200, 114), ("0.65", 200, 136), ("0.75", 200, 158), ("0.85", 200, 178), ("0.95", 200, 194),
)
corpus = [
    calibration.Forecast(f"KXDEMO-{price}-{index}", "KXDEMO", Decimal(price), index < hits, 3_600)
    for price, count, hits in BANDS
    for index in range(count)
]
report = calibration.score(corpus, engine="tape")

print(f"  {report.count} settled markets, base rate {report.base_rate}")
print(f"  Brier         {report.brier.quantize(Decimal('0.000001'))}")
print(f"  reliability   {report.reliability.quantize(Decimal('0.000001'))}   (the only term a recalibration repairs)")
print(f"  resolution    {report.resolution.quantize(Decimal('0.000001'))}   (enters with a minus sign: you want it large)")
print(f"  uncertainty   {report.uncertainty.quantize(Decimal('0.000001'))}   (a property of the question, not the forecaster)")
print(f"  binning       {report.binning.quantize(Decimal('0.000001'))}   (the term textbooks leave out)")
rebuilt = report.reliability - report.resolution + report.uncertainty + report.binning
print(f"  reconstructs to {rebuilt.quantize(Decimal('0.000001'))} against a Brier of {report.brier.quantize(Decimal('0.000001'))}")
print()
print(f"  skill vs the base rate  {report.skill.quantize(Decimal('0.0001'))}")
print(f"  favourite-longshot slope {report.bias_slope.quantize(Decimal('0.0001'))}  (above one is the classic shape)")
"""

_INDEX_BINNING = """
# Murphy's three-way split is exact only for a forecaster quoting a small set of
# fixed probabilities. A market quotes a continuum, and the residual is the price
# of the binning.
spread_corpus = [
    calibration.Forecast(
        f"KXSPREAD-{price}-{index}", "KXSPREAD",
        Decimal(price) + (Decimal(index % 9) - 4) / 100, index < hits, 3_600,
    )
    for price, count, hits in BANDS
    for index in range(count)
]
wide = calibration.score(spread_corpus, engine="tape")

print(f"  one price per band : binning {report.binning.quantize(Decimal('0.000001'))}")
print(f"  a continuum        : binning {wide.binning.quantize(Decimal('0.000001'))}")
print()
print("  Rather than quietly reporting a decomposition that does not reconstruct its own")
print("  total, the residual is shown. If it is large next to reliability, the bands are")
print("  too wide to conclude anything from.")
print()
print("  the recalibration map, which must be non-decreasing or the corrected prices")
print("  would themselves be incoherent:")
for point in report.isotonic_map:
    print(f"    quoted {point.quoted} -> {point.calibrated} (weight {point.weight})")
"""

_INDEX_SELECTION = """
print(f"  composition     {report.composition}")
print(f"  median horizon  {report.median_horizon_s}s")
print(f"  thin corpus     {report.thin}")
print(f"  notes           {report.detail}")
print()
settled_at_the_bell = calibration.score(
    [calibration.Forecast(item.ticker, item.series_ticker, item.probability, item.outcome, 0) for item in corpus[:40]],
    engine="final_trade",
)
print(f"  the same prices read at settlement: engine {settled_at_the_bell.engine}, thin {settled_at_the_bell.thin}")
print(f"    {settled_at_the_bell.detail}")
print()
print("  A corpus of settled markets is not a sample of forecasts. Every report carries")
print("  its composition for that reason, and a report built from final trades says so in")
print("  its engine name rather than quietly scoring itself well.")
"""

RECORD_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "index": (
        ("## 1. A coherent family still has an index", _INDEX_BASKET),
        ("## 2. One leg quoted on one side only", _INDEX_ASK),
        ("## 3. A threshold ladder is measured differently", _INDEX_LADDER),
        ("## 4. A family under no constraint has no index", _INDEX_NULL),
        ("## 5. Coherent is not correct: scoring a settled corpus", _INDEX_CALIBRATION),
        ("## 6. The term textbooks leave out", _INDEX_BINNING),
        ("## 7. Selection is the hard part, and it can only be reported", _INDEX_SELECTION),
    ),
}
