"""Runnable content for the combo and scoring lessons of the coherence lab.

The ``frechet`` and ``calibration`` lessons of ``web/lib/coherence/lessons.ts``:
what a parlay's legs pin down about it, and the only test that compares a price
to the world rather than to another price. Same shape as
``coherence_lab_lessons_book.py`` — see its docstring for why the content is
split across modules.
"""

from __future__ import annotations

# ── frechet ────────────────────────────────────────────────────────────────
_FRECHET_PARSE = """
from modules.coherence.drivers.kalshi_combos import parse_combo
from modules.coherence.drivers.kalshi_parse import ParseError
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.frechet import assess, rows_for_combo, side_label

# The venue states the conjunction. Unlike every other relation in this engine,
# nothing here is inferred from titles or strikes.
PAYLOAD = {
    "ticker": "KXPARLAY-26AUG23-ABC",
    "mve_collection_ticker": "KXPARLAY",
    "exchange_index": 1,
    "yes_sub_title": "City drop points, Liverpool win, and BTC stays under 110k",
    "mve_selected_legs": [
        {"market_ticker": "A", "event_ticker": "KXEPLGAME-CITY", "side": "yes"},
        {"market_ticker": "B", "event_ticker": "KXEPLGAME-LIV", "side": "yes"},
        {"market_ticker": "C", "event_ticker": "KXBTCD-110K", "side": "no"},
    ],
}

unknown_shards = parse_combo(PAYLOAD)
known_shards = parse_combo(PAYLOAD, shards={"A": 1, "B": 1, "C": 1})
print(f"  {unknown_shards.label}")
print(f"  {len(unknown_shards.legs)} legs, collection {unknown_shards.collection_ticker}")
for leg in unknown_shards.legs:
    print(f"    {leg.ticker} on {leg.event_ticker}, settling {leg.side} (opposite is {leg.opposite})")
print()
print(f"  shards unknown -> scope {unknown_shards.scope}")
print(f"  shards known   -> scope {known_shards.scope}")
print("  Unknown is treated as cross-shard, because assuming a leg is co-located when it")
print("  is not understates the legging risk, and understating it is the expensive error.")
print()
print(f"  a plain market with no mve_selected_legs parses to {parse_combo({'ticker': 'X'})!r}")
try:
    parse_combo({"ticker": "X", "mve_selected_legs": [{"market_ticker": "A", "side": ""}]})
except ParseError as exc:
    print(f"  a leg with no side is refused, not defaulted: {exc}")
"""

_FRECHET_BAND = """
combo = known_shards


def quote(ticker, yes_bid, no_bid, size=20_000):
    return Book(
        ticker=ticker,
        yes_bids=(Level(Decimal(yes_bid), size),),
        no_bids=(Level(Decimal(no_bid), size),),
    )


# Legs A and B are YES legs quoted around 0.90 and 0.85. Leg C is a NO leg: its
# market's YES mid is 0.20, so the leg the parlay needs is worth 0.80.
BOOKS = {
    "A": quote("A", "0.8900", "0.0900"),
    "B": quote("B", "0.8400", "0.1400"),
    "C": quote("C", "0.1900", "0.7900"),
    combo.ticker: quote(combo.ticker, "0.3800", "0.6000"),
}
reading = assess(combo, BOOKS)

print("  leg                       settles   p       buy p    buy the opposite")
for row in reading.legs:
    print(f"  {row.label:<24}  {row.side:<7}   {row.probability}  {row.buy_cost}   {row.opposite_cost}")
print()
count = len(reading.legs)
total = sum((row.probability for row in reading.legs), Decimal(0))
print(f"  sum of leg probabilities  {total}   over n = {count} legs")
print(f"  lower bound  max(0, {total} - {count - 1})  =  {reading.lower_bound}")
print(f"  upper bound  min of the legs             =  {reading.upper_bound}")
print(f"  band width                               =  {reading.band_width}")
print(f"  independence would say                   =  {reading.independence.quantize(Decimal('0.0001'))}")
print()
print("  The upper bound is the conjunction being a subset of each leg. The lower is the")
print("  union bound rearranged: the legs can fail on disjoint futures only until the")
print("  failure probabilities exhaust the space.")
"""

_FRECHET_OUTSIDE = """
print(f"  parlay bid {reading.combo_bid}, ask {reading.combo_ask}, mid {reading.combo_mid}")
print(f"  band       [{reading.lower_bound}, {reading.upper_bound}]")
print(f"  inside the band : {reading.inside_band}")
print(f"  dependence read : {reading.dependence}")
print()
print("  It is quoted BELOW the lower bound, which no dependence structure can produce.")
print("  That is the mispricing. Sitting below the independence product is not: legs are")
print("  routinely dependent, and where a price sits INSIDE the band is a statement about")
print("  dependence, which nothing on this exchange quotes.")
"""

_FRECHET_COVER = """
rows = rows_for_combo(combo, BOOKS)
print(f"  {len(rows)} rows, all in the shape the solver already takes:")
for row in rows:
    label = "cover (lower bound)" if row.bound == Decimal(1) else "upper bound"
    print(f"    {label:<20} bound {row.bound}  cost {row.cost}  slack {row.slack}  violated {row.violated}")
print()
cover = next(row for row in rows if row.bound == Decimal(1))
print("  the cover portfolio, leg by leg:")
for leg in cover.legs:
    print(f"    {leg.direction} {leg.label:<34} side {leg.side}  @ {leg.price}")
print(f"    total cost {cover.cost}, against the dollar it is guaranteed to pay")
print()
print("  Buy the parlay and the opposite of every leg. If all three legs land the parlay")
print("  pays a dollar and the opposites pay nothing. If k >= 1 legs miss, the parlay pays")
print("  nothing and exactly k opposites pay a dollar each. So the set pays at least a")
print("  dollar in every future, and any total cost below one is a Dutch book.")
"""

_FRECHET_SIDES = """
no_leg = combo.legs[2]
no_reading = reading.legs[2]
print(f"  leg {no_leg.ticker} settles {no_leg.side}, so its opposite is {no_leg.opposite}")
print(f"    the leg itself : {side_label(no_reading.label, no_leg.side)}  costs {no_reading.buy_cost}")
print(f"    its opposite   : {side_label(no_reading.label, no_leg.opposite)}  costs {no_reading.opposite_cost}")
print()
cover_leg = next(leg for leg in cover.legs if leg.ticker == no_leg.ticker)
print(f"  and in the cover portfolio it appears as: {cover_leg.direction} {cover_leg.label} (side {cover_leg.side})")
print()
print("  The negation of a NO leg is a YES PURCHASE. Roughly half of Kalshi's parlay legs")
print("  are NO legs, so a label composed as 'not <market>' gets this backwards on exactly")
print("  the legs where it matters, and the order plan buys the opposite contract. Every")
print("  label the certificate prints therefore carries the side it settles on.")
print()
print(f"  scope with the shards supplied : {combo.scope}")
print(f"  scope with them unknown        : {unknown_shards.scope}")
print()
print("  The combo above is same-shard only because this notebook told parse_combo where")
print("  its legs live. Live, a parlay on one shard references markets on others, so the")
print("  real listing is cross-shard and carries the most expensive legging tier in")
print("  costs.py: order groups do not work across exchange instances, so nothing cancels")
print("  the rest of the group when one leg over-fills.")
"""

_FRECHET_CERTIFICATE = """
from modules.coherence.kernel import closedform
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import Component

shell = Component(
    component_id=combo.ticker, event_ticker=combo.ticker, series_ticker=combo.collection_ticker,
    exchange_index=combo.exchange_index, mutually_exclusive=False, nodes=[],
)
print(closedform.solve(shell, rows, FeeSchedule()).render_text())
"""

# ── calibration ────────────────────────────────────────────────────────────
_CAL_CORPUS = """
from modules.coherence.fs.corpus import Settlement, final_trade_forecasts
from modules.coherence.kernel import calibration

# Ten price bands, two hundred settled markets each, with the oldest empirical
# finding in this literature built in: longshots happen less often than they are
# priced and favourites more often.
BANDS = (
    ("0.05", 200, 4), ("0.15", 200, 22), ("0.25", 200, 44), ("0.35", 200, 64), ("0.45", 200, 86),
    ("0.55", 200, 116), ("0.65", 200, 138), ("0.75", 200, 160), ("0.85", 200, 180), ("0.95", 200, 196),
)
corpus = [
    calibration.Forecast(f"KXDEMO-{price}-{index}", "KXDEMO", Decimal(price), index < hits, 3_600)
    for price, count, hits in BANDS
    for index in range(count)
]
report = calibration.score(corpus, engine="tape")

print(f"  {report.count} settled markets, quoted an hour before close, base rate {report.base_rate}")
print()
CENTS = Decimal("0.0001")
print("  price band     n     priced at   happened   deviation")
for band in report.bins:
    if not band.count:
        continue
    print(
        f"  {band.label:<13} {band.count}    {band.mean_forecast.quantize(CENTS)}      "
        f"{band.outcome_rate.quantize(CENTS)}     {band.deviation.quantize(CENTS)}"
    )
print()
print("  Negative at the bottom, positive at the top: longshots overpriced, favourites")
print("  underpriced. That is the favourite-longshot shape, and it is the reason the")
print("  slope below comes out above one rather than below it.")
"""

_CAL_IDENTITY = """
rebuilt = report.reliability - report.resolution + report.uncertainty + report.binning
PLACES = Decimal("0.0000001")
print(f"  Brier         {report.brier.quantize(PLACES):f}")
print(f"  Reliability   {report.reliability.quantize(PLACES):f}")
print(f"  Resolution    {report.resolution.quantize(PLACES):f}")
print(f"  Uncertainty   {report.uncertainty.quantize(PLACES):f}")
print(f"  Binning       {report.binning.quantize(PLACES):f}   (zero here: every band holds one price, so nothing was discarded)")
print()
print("  and unquantised, which is what the identity is checked on:")
print(f"  reliability - resolution + uncertainty + binning = {rebuilt}")
print(f"  Brier                                           = {report.brier}")
print(f"  EXACTLY equal, as Decimals: {rebuilt == report.brier}")
print("  (Decimal equality compares value, not exponent, so 0.1492000 and 0.1492 are one")
print("  number written two ways — the trailing zeros are the arithmetic's, not a rounding.)")
print()
print("  Not equal to six decimal places — equal. Every count here divides exactly, so")
print("  nothing rounds, and the identity is arithmetic rather than a numerical accident.")
print()
print("  Reliability is the only term a recalibration repairs. Resolution enters with a")
print("  minus sign, so it is the term you want large: a forecaster who quotes the base")
print("  rate on every market is perfectly reliable and useless, and only resolution")
print("  notices. Uncertainty is a property of the question, which is why raw Brier scores")
print("  are not comparable across corpora and are never reported here without the split.")
print()
print(f"  skill against always quoting the base rate: {report.skill.quantize(Decimal('0.0001'))}")
"""

_CAL_SLOPE = """
print(f"  weighted least-squares slope of outcome rate on price: {report.bias_slope.quantize(Decimal('0.000001'))}")
print(f"  above one: {report.bias_slope > Decimal(1)}")
print()
print("  The direction is worth deriving rather than remembering. Longshots are overbet,")
print("  so a 5-cent contract happens less than 5% of the time and its point sits BELOW")
print("  the diagonal. Favourites are underbet, so a 95-cent contract happens more than")
print("  95% of the time and sits ABOVE it. A line through a scatter pulled down at the")
print("  left and up at the right is STEEPER than the diagonal, not shallower.")
print()
print("  reported with the bin counts, because on a thin corpus this is mostly noise:")
print(f"    {report.count} markets across {len(report.composition)} series, thin = {report.thin}")
"""

_CAL_ISOTONIC = """
print("  quoted    calibrated    weight")
previous = None
monotone = True
for point in report.isotonic_map:
    print(f"  {point.quoted:f}    {point.calibrated.quantize(Decimal('0.0001')):f}        {point.weight}")
    if previous is not None and point.calibrated < previous:
        monotone = False
    previous = point.calibrated
print()
print(f"  non-decreasing across all {len(report.isotonic_map)} points: {monotone}")
print()
print("  It has to be. A higher price mapping to a lower probability would make the")
print("  CORRECTED prices themselves incoherent, and this engine would be shipping the")
print("  fault it exists to find. Pool-adjacent-violators is the exact solution, not an")
print("  approximation: whenever a block dips below the one before it, the two merge into")
print("  their weighted mean and the check runs backwards again.")
print()

# Nothing pooled above, because the quoted curve was already monotone. Invert one
# band and the machinery becomes visible.
INVERTED = tuple(
    (price, count, 150 if price == "0.45" else hits) for price, count, hits in BANDS
)
pooled = calibration.score(
    [
        calibration.Forecast(f"KXINV-{price}-{index}", "KXINV", Decimal(price), index < hits, 3_600)
        for price, count, hits in INVERTED
        for index in range(count)
    ],
    engine="tape",
)
print(f"  with the 0.45 band inverted, the map collapses from {len(report.isotonic_map)} points to {len(pooled.isotonic_map)}:")
for point in pooled.isotonic_map:
    print(f"    {point.quoted:f} -> {point.calibrated.quantize(Decimal('0.0001')):f} (weight {point.weight})")
"""

_CAL_TRAP = """
# The trap. `GET /markets?status=settled` returns a last traded price for markets
# that have already resolved. It is public, instant, and nearly worthless.
settlements = [
    Settlement(
        ticker=f"KXSETTLED-{index}",
        event_ticker="KXSETTLED",
        series_ticker="KXSETTLED",
        close_ts_ns=None,
        result="yes" if index % 2 == 0 else "no",
        last_price=Decimal("0.9800") if index % 2 == 0 else Decimal("0.0200"),
    )
    for index in range(120)
]
final = calibration.score(final_trade_forecasts(settlements), engine="final_trade")

print(f"  corpus size {final.count}, thin = {final.thin}, median horizon {final.median_horizon_s}s")
print()
print(f"  forecasts quoted an hour out : Brier {report.brier}   skill {report.skill.quantize(Decimal('0.0001'))}")
print(f"  last traded prices           : Brier {final.brier}   skill {final.skill.quantize(Decimal('0.0001'))}")
ratio = (report.brier / final.brier).quantize(Decimal("1"))
print()
print(f"  The second engine scores {ratio} times better and the number means nothing.")
print("  A last trade happens seconds before settlement, when the answer is largely known,")
print("  so it measures how fast the exchange converges rather than whether it saw")
print("  anything coming. It is not a thin-sample problem either — this corpus clears the")
print("  floor, and no amount more of it would help.")
print()
print("  which is why the report says so in its own words rather than scoring itself well:")
for note in final.detail.split("; "):
    print(f"    {note}")
"""

SCORE_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "frechet": (
        ("## 1. The venue states the conjunction", _FRECHET_PARSE),
        ("## 2. The band the legs leave", _FRECHET_BAND),
        ("## 3. Quoted outside the band, which is the only mispricing", _FRECHET_OUTSIDE),
        ("## 4. The cover, and why it cannot cost under a dollar", _FRECHET_COVER),
        ("## 5. The opposite of a NO leg is a YES purchase", _FRECHET_SIDES),
        ("## 6. The certificate", _FRECHET_CERTIFICATE),
    ),
    "calibration": (
        ("## 1. A settled corpus with the favourite-longshot shape in it", _CAL_CORPUS),
        ("## 2. Murphy's decomposition, exactly", _CAL_IDENTITY),
        ("## 3. The slope, and which way it should lean", _CAL_SLOPE),
        ("## 4. The recalibration map has to be non-decreasing", _CAL_ISOTONIC),
        ("## 5. The trap: scoring the answer instead of the forecast", _CAL_TRAP),
    ),
}
