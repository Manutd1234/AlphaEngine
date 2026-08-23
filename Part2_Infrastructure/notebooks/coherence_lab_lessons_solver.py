"""Runnable content for the solver and clock lessons of the coherence lab.

Lessons 7-8 of ``web/lib/coherence/lessons.ts``: the linear programme whose
infeasibility certificate is the trade, and how long a dislocation survives
before an executor is worth building. Same shape as
``coherence_lab_lessons_book.py`` — see its docstring for why the content is
split across five modules.
"""

from __future__ import annotations

# ── Lesson 7 — duality ─────────────────────────────────────────────────────
_DUAL_SEAM = """
from modules.coherence.kernel import closedform, dutchbook
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.constraints import rows_for
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import Component, Node

SCHEDULE = FeeSchedule()
optimize, absence_reason = dutchbook.import_linprog()

print(f"  linprog available : {dutchbook.linprog_available()}")
print(f"  reason if not     : {absence_reason}")
print()
print("  Nothing in this notebook imports scipy. `import_linprog()` is the only door, and")
print("  it is cached both ways: a missing package does not appear halfway through a")
print("  process, and retrying the import on every solve turns one absence into thousands")
print("  of failed imports. Where it is absent the engine falls back to the closed-form")
print("  checks and SAYS SO, because an absence must never look like present-and-fine.")
"""

_DUAL_FAMILY = """
def quote(ticker, yes_bid, no_bid, size=50_000):
    return Book(
        ticker=ticker,
        yes_bids=(Level(Decimal(yes_bid), size),),
        no_bids=(Level(Decimal(no_bid), size),),
    )

nodes = [
    Node(f"X-{index}", "X", "X", 0, "custom", None, None, ("S",), f"Outcome {index}")
    for index in (1, 2, 3)
]
family = Component(
    component_id="X", event_ticker="X", series_ticker="X",
    exchange_index=0, mutually_exclusive=True, nodes=nodes,
)
DUTCH = {f"X-{index}": quote(f"X-{index}", "0.2800", "0.7000") for index in (1, 2, 3)}

basket = sum((DUTCH[node.ticker].best_yes_ask for node in nodes), Decimal(0))
print("  three mutually exclusive outcomes, each bid 0.70 on the NO side")
print(f"  so each is offered at 1 - 0.70 = {DUTCH['X-1'].best_yes_ask}")
print(f"  and the basket costs {basket} for the dollar exactly one of them pays")
"""

_DUAL_CLOSED = """
closed = closedform.solve(family, rows_for(family, DUTCH), SCHEDULE)
print(closed.render_text())
"""

_DUAL_LP = """
lp = dutchbook.solve(family, DUTCH, SCHEDULE)
if lp is None:
    print("No linear programme ran here. The seam reported:")
    print(f"  {absence_reason}")
    print()
    print("The closed-form certificate above is the answer, and it finds strictly LESS:")
    print("it can only see a violation that fits inside one constraint row, never a")
    print("portfolio assembled across several. That is why the certificate names its")
    print("engine — so a reader can tell 'no arbitrage here' from 'none the weaker")
    print("engine can see'.")
else:
    print(lp.render_text())
"""

_DUAL_COMPARE = """
print(f"  closed form  {closed.verdict:<11} engine {closed.engine:<11} net {closed.net_edge}")
if lp is None:
    print("  highs        not run")
else:
    print(f"  highs        {lp.verdict:<11} engine {lp.engine:<11} net {lp.net_edge}")
    print()
    print(f"  the two agree to within {abs(lp.net_edge - closed.net_edge)}, which is the fill-count")
    print("  assumption and nothing else: the LP folds a per-contract trade fee into the")
    print("  prices it optimises over, then the cost model re-prices the winner exactly.")
"""

_DUAL_FRECHET = """
from modules.coherence.kernel.frechet import Combo, ComboLeg, assess, rows_for_combo

combo_books = {
    "A": quote("A", "0.4900", "0.4900"),
    "B": quote("B", "0.3900", "0.5900"),
    "PARLAY": quote("PARLAY", "0.5500", "0.4300"),
}
parlay = Combo(
    ticker="PARLAY", collection_ticker="C", exchange_index=0, label="both legs land",
    legs=(ComboLeg("A", "EA", "yes", "Leg A", 0), ComboLeg("B", "EB", "yes", "Leg B", 0)),
)
reading = assess(parlay, combo_books)

print(f"  legs quoted at        {[str(leg.probability) for leg in reading.legs]}")
print(f"  Fréchet band          [{reading.lower_bound}, {reading.upper_bound}], width {reading.band_width}")
print(f"  independence would say {reading.independence}")
print(f"  the parlay is quoted at {reading.combo_mid}; inside the band: {reading.inside_band}")
print(f"  {reading.detail}")
print()
print("  The band width is how far this price can move with no leg price moving at all.")
print("  Only a price OUTSIDE the band is a mispricing; where it sits inside is dependence,")
print("  and dependence is not quoted anywhere.")
"""

_DUAL_ROWS = """
combo_rows = rows_for_combo(parlay, combo_books)
shell = Component(
    component_id="PARLAY", event_ticker="PARLAY", series_ticker="C",
    exchange_index=0, mutually_exclusive=False, nodes=[],
)
print(f"  the combo produced {len(combo_rows)} rows in the same shape every other family uses:")
for row in combo_rows:
    print(f"    {row.family:<9} bound {row.bound}  cost {row.cost}  slack {row.slack}  violated {row.violated}")
print()
print(closedform.solve(shell, combo_rows, SCHEDULE).render_text())
print()
print("  No new code path was added to the solver. A new instrument extends this engine by")
print("  adding rows, which is the practical content of 'the dual is the trade'.")
"""

# ── Lesson 8 — halflife ────────────────────────────────────────────────────
_HALF_TAPE = """
from modules.coherence.episodes import (
    MIN_EPISODES_FOR_HALF_LIFE,
    POLLS_TO_CLOSE,
    EpisodeTracker,
    survival,
    verdict_for,
)

POLL_INTERVAL_NS = 1_000_000_000  # a one-second poll, which is what a REST token budget buys


def replay(runs, interval_ns=POLL_INTERVAL_NS):
    \"\"\"Replay a poll tape. Each entry is how many consecutive polls saw the violation.

    Polls, not seconds: a lifetime is only ever observed in multiples of the
    cadence that observed it, and writing the tape in polls keeps that visible.
    \"\"\"
    tracker = EpisodeTracker()
    stamp = 0
    for index, polls in enumerate(runs):
        for _ in range(polls):
            tracker.observe(
                f"E-{index}", "KXDEMO", f"E-{index}", 0, stamp, True,
                family="additive", ci=Decimal("0.0300"), net_edge=Decimal("0.4000"),
            )
            stamp += interval_ns
        for _ in range(POLLS_TO_CLOSE):
            tracker.observe(f"E-{index}", "KXDEMO", f"E-{index}", 0, stamp, False)
            stamp += interval_ns
    return tracker


FAST = [1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 4]
fast = replay(FAST)
print(f"  {len(fast.closed)} episodes closed, {len(fast.open_episodes)} still open")
for episode in fast.closed[:4]:
    print(f"    {episode.component_id} lasted {episode.lifetime_s}s, peak ci {episode.peak_ci}")
print()
print(f"  Two coherent polls close an episode, not one (POLLS_TO_CLOSE = {POLLS_TO_CLOSE}).")
print("  A single poll can miss a violation because one leg's book was momentarily")
print("  unreadable, and closing on that would cut long episodes into strings of short")
print("  ones — biasing the median DOWN, which makes the exchange look faster than it is.")
"""

_HALF_FLOOR = """
thin = survival(replay([2, 3, 5]).closed)
print(f"  episodes {thin.episodes}")
print(f"  median   {thin.median_s!r}")
print(f"  reason   {thin.reason}")
print()
print(f"  The curve is still drawn — {len(thin.points)} real points — and only the summary")
print(f"  statistic a reader would quote is withheld until there are {MIN_EPISODES_FOR_HALF_LIFE} of them.")
print("  Open episodes are excluded entirely rather than counted at their current age: an")
print("  episode still running is a lower bound on a lifetime, not a measurement of one.")
"""

_HALF_CURVE = """
curve = survival(fast.closed)
print(f"  {curve.episodes} closed episodes, median {curve.median_s}s")
print()
print("  t (s)     surviving")
for seconds, surviving in curve.points:
    bar = "#" * int(surviving * 40)
    print(f"  {seconds:>7}   {surviving}  {bar}")
"""

_HALF_VERDICT = """
for round_trip in (Decimal("0.35"), Decimal("2"), Decimal("60")):
    print(f"  round trip {round_trip}s:")
    print(f"    {verdict_for(curve, round_trip)}")
print()
slow = survival(replay([90, 120, 140, 200, 240, 260, 300, 420, 600]).closed)
print(f"  a slower series, median {slow.median_s}s:")
print(f"    {verdict_for(slow, Decimal('2'))}")
print()
quick = survival(replay([1, 2, 1, 3, 1, 1, 2, 1, 4, 1], interval_ns=50_000_000).closed)
print(f"  the same shape of tape polled every 50ms, median {quick.median_s}s:")
print(f"    {verdict_for(quick, Decimal('0.35'))}")
print()
print("  That last line is also the censoring, stated out loud: a REST-polled tape cannot")
print("  record a dislocation shorter than its own cadence. The one-second tape above has")
print("  no episode under two seconds because it could not have had one, and a median read")
print("  off it is a statement about the poller as much as about the exchange.")
print()
print("  A short half-life is not an instruction to be faster. Against commercial")
print("  detection in tens of milliseconds over REST polling, the race was lost before it")
print("  was entered, and the edge has to be in structures nobody scans for.")
"""

SOLVER_SIDE: dict[str, tuple[tuple[str, str], ...]] = {
    "duality": (
        ("## 1. The solver seam, and what happens without it", _DUAL_SEAM),
        ("## 2. Three outcomes, and a dollar on sale at ninety cents", _DUAL_FAMILY),
        ("## 3. The closed-form engine, which always runs", _DUAL_CLOSED),
        ("## 4. The linear programme, which runs where SciPy is", _DUAL_LP),
        ("## 5. Two engines on one question", _DUAL_COMPARE),
        ("## 6. A new instrument: Fréchet bounds on a parlay", _DUAL_FRECHET),
        ("## 7. New rows, no new code path", _DUAL_ROWS),
    ),
    "halflife": (
        ("## 1. A poll tape, and the episodes it opens and closes", _HALF_TAPE),
        ("## 2. Below the sample floor, the median is withheld", _HALF_FLOOR),
        ("## 3. The survival curve", _HALF_CURVE),
        ("## 4. The verdict against a round trip", _HALF_VERDICT),
    ),
}
