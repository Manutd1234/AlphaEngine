"""The compiled core's TICK histogram — the only thing its clock can resolve.

``tools/bench_decision.py`` reports percentiles of ``CoreResult.elapsed_ns``.
On this hardware every one of those figures is a whole number of clock ticks
and nothing else: ``std::chrono::steady_clock`` runs on a 24 MHz timebase, so
one tick is 125/3 = 41.666… ns, and ``duration_cast<nanoseconds>`` truncates.
A k-tick interval is reported as 41 or 42 (k=1), 83 or 84 (k=2), 125 (k=3),
166 or 167 (k=4) — the doublets are the integer 125/3 conversion landing
either side of a nanosecond, not two different durations.

So a percentile of those figures is a percentile of a four-valued variable,
and "p99 = 125 ns" says only "somewhere between 1 % and 100 % of calls needed
a third tick". The distribution is what carries the information:

    fraction at <= 2 ticks  ==  fraction completing inside 83.3 ns

which is exactly the claim "p99 < 100 ns" reduces to, because 100 ns sits
between tick 2 (83.3) and tick 3 (125.0). This tool counts that fraction.

    venv/bin/python tools/bench_core_ticks.py
    venv/bin/python tools/bench_core_ticks.py --source direct --repeat 3
    venv/bin/python tools/bench_core_ticks.py --repeat 3 --json /tmp/ticks.json
    venv/bin/python tools/bench_core_ticks.py --attribute   # classify the tail

Two sources, both real and neither a substitute for the other:

* ``gateway`` (default) — ``RiskGateway.submit()`` per sample, reading
  ``last_decision_core_ns``: the same path, the same shape and the same
  samples ``bench_decision.py`` reports its ``core_ns`` percentiles from, so
  the two tools describe one run.
* ``direct`` — ``decide()`` called back to back on prebuilt ladders. No Python
  between calls, so the caches stay warm; the difference between the two
  sources IS the cost of arriving cold.

Also reported, always: the instrument's own floor — ``clock_floor_ns``, the
two ``steady_clock`` reads with nothing between them. Around 0.6 ticks of
every measured figure is the timer, and a tick spent on the timer must never
be attributed to the arithmetic.
"""

from __future__ import annotations

import argparse
import asyncio
import gc
import json
import platform
import statistics
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

#: Above this fraction of a tick away from a whole number of ticks, a sample is
#: not classified. It is REPORTED as unclassified with its raw value, never
#: dropped and never rounded into a neighbouring bucket.
TICK_TOLERANCE = 0.25

#: The bench shape, shared by both sources and matching bench_decision.py's:
#: a fifty-level book a cent apart around 100.0, 5 000 units a level.
BOOK_LEVELS = 50
BOOK_MID = 100.0
BOOK_SIZE = 5000.0
ORDER_NOTIONAL = 1000.0


def _load_core():
    """The built extension, or a hard failure naming the build command."""
    try:
        from modules import _decision_core as core  # type: ignore[attr-defined]
    except ImportError as exc:
        raise SystemExit(
            f"modules._decision_core is not importable ({exc}). Build it with:\n"
            "  venv/bin/python native/decision_core/setup.py build_ext --inplace "
            "--build-temp build/native"
        ) from exc
    return core


def _levels(mid: float = BOOK_MID, size: float = BOOK_SIZE, n: int = BOOK_LEVELS):
    bids = [(round(mid - i * 0.01, 4), size) for i in range(n)]
    asks = [(round(mid + i * 0.01, 4), size) for i in range(n)]
    return bids, asks


# --------------------------------------------------------------------------- #
# tick classification
# --------------------------------------------------------------------------- #
def classify(samples_ns: list[int], tick_ns: float) -> dict:
    """Count samples per whole tick. Nothing is dropped; nothing is rounded away."""
    if tick_ns <= 0.0:
        return {
            "tick_ns": None,
            "unavailable": "the clock reported no transition, so no tick width was measured",
            "n": len(samples_ns),
        }
    buckets: Counter[int] = Counter()
    seen: dict[int, set[int]] = {}
    unclassified: list[int] = []
    for value in samples_ns:
        ticks = round(value / tick_ns)
        if abs(value - ticks * tick_ns) > TICK_TOLERANCE * tick_ns:
            unclassified.append(value)
            continue
        buckets[ticks] += 1
        seen.setdefault(ticks, set()).add(value)
    n = len(samples_ns)
    counted = sum(buckets.values())
    rows = []
    cumulative = 0
    for ticks in sorted(buckets):
        cumulative += buckets[ticks]
        rows.append(
            {
                "ticks": ticks,
                # The raw figures OBSERVED in this bucket, not a width derived
                # from the measured tick: one tick reads as 41 or 42 and two as
                # 83 or 84, because the timebase converts by an integer 125/3
                # and the carry lands either side of a nanosecond. Deriving the
                # column instead of reporting it put 124 next to a bucket whose
                # samples all read 125.
                "ns_observed": sorted(seen[ticks]),
                "count": buckets[ticks],
                "fraction": buckets[ticks] / n if n else 0.0,
                "cumulative_fraction": cumulative / n if n else 0.0,
            }
        )
    within_2 = sum(c for t, c in buckets.items() if t <= 2)
    return {
        "tick_ns": tick_ns,
        "n": n,
        "classified": counted,
        "rows": rows,
        "at_most_2_ticks": within_2,
        "fraction_at_most_2_ticks": (within_2 / n) if n else 0.0,
        "unclassified": unclassified,
        "raw_values": dict(sorted(Counter(samples_ns).items())),
    }


def _ns_list(values: list[int]) -> str:
    """The raw figures in one bucket: "83, 84", or "83…250" once there are many."""
    if len(values) <= 3:
        return ", ".join(str(v) for v in values)
    return f"{values[0]}…{values[-1]}"


def _percentiles(samples: list[int]) -> dict[str, float]:
    s = sorted(samples)
    n = len(s)

    def q(p: float) -> int:
        rank = max(1, min(n, int(-(-p * n // 1))))
        return s[rank - 1]

    return {"p50": q(0.50), "p99": q(0.99), "p999": q(0.999), "max": s[-1], "n": n}


# --------------------------------------------------------------------------- #
# the two sources
# --------------------------------------------------------------------------- #
def sample_direct(core, orders: int, warmup: int, venues: int) -> list[int]:
    """decide() back to back on prebuilt ladders — no Python between calls."""
    ladders = []
    for _venue in range(venues):
        ladder = core.BookLadder()
        ladder.snapshot(*_levels())
        ladders.append(ladder)
    kwargs = dict(
        side_is_buy=True,
        order_type_is_limit=False,
        order_quantity=None,
        order_notional=ORDER_NOTIONAL,
        limit_price=None,
        is_paper=False,
        paper_price=None,
        order_books=ladders,
        pos_quantities=[],
        pos_avg_prices=[],
        pos_realized=[],
        pos_marks=[],
        pos_is_order_symbol=[],
        working_buys=0.0,
        working_sells=0.0,
        starting_equity=100_000.0,
        carried_realized_pnl=0.0,
        start_of_day_equity=100_000.0,
        max_order_notional_usd=1_000_000.0,
        max_symbol_notional_usd=1_000_000.0,
        max_gross_exposure_usd=10_000_000.0,
        max_price_deviation_bps=100.0,
        max_daily_drawdown_pct=0.1,
        reduce_only_threshold=0.8,
        reduce_only_override=False,
        route_enabled=True,
    )
    for _ in range(warmup):
        core.decide(**kwargs)
    return [core.decide(**kwargs).elapsed_ns for _ in range(orders)]


def _deep_book(venue: str, symbol: str):
    from modules.tca_engine import BookState

    book = BookState(venue, symbol)
    bids, asks = _levels()
    book.apply_snapshot(bids=bids, asks=asks)
    return book


class _Feed:
    def __init__(self, book) -> None:
        self.connected = True
        self.books = {book.symbol: book}


async def _sample_gateway(orders: int, warmup: int, venues: int) -> list[int]:
    from modules.risk_proxy import RiskGateway, TokenBucket
    from modules.schemas import OrderRequest
    from modules.tca_engine import TCAEngine

    engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
    names = ["BINANCE", "BYBIT"][:venues] if venues <= 2 else [f"V{i}" for i in range(venues)]
    engine.feeds = {name: _Feed(_deep_book(name, "BTCUSDT")) for name in names}
    gateway = RiskGateway(tca_engine=engine, audit=None)
    gateway.bucket = TokenBucket(rate=1e9, burst=10**9)
    req = OrderRequest(
        symbol="BTCUSDT", side="BUY", notional=ORDER_NOTIONAL, order_type="MARKET", strategy="bench"
    )

    for _ in range(warmup):
        await gateway.submit(req, source="bench")
    if gateway.last_decision_core_ns is None:
        raise SystemExit(
            "the gateway resolved the Python engine, which has no core clock — "
            "run with DECISION_CORE=auto against a built extension, or use --source direct"
        )

    samples: list[int] = []
    gc.collect()
    gc.disable()
    try:
        for _ in range(orders):
            await gateway.submit(req, source="bench")
            value = gateway.last_decision_core_ns
            if value is not None:
                samples.append(value)
    finally:
        gc.enable()
    return samples


def sample_gateway(orders: int, warmup: int, venues: int) -> list[int]:
    return asyncio.run(_sample_gateway(orders, warmup, venues))


# --------------------------------------------------------------------------- #
# reporting
# --------------------------------------------------------------------------- #
def render(result: dict) -> str:
    out: list[str] = []
    hist = result["histogram"]
    if hist.get("tick_ns") is None:
        return f"tick histogram unavailable — {hist['unavailable']}"
    tick = hist["tick_ns"]
    out.append(
        f"tick width {tick:.3f} ns (measured) · {result['source']} source · "
        f"n = {hist['n']} · {result['venues']} venue{'s' if result['venues'] != 1 else ''}"
    )
    out.append("")
    out.append("| ticks | ns observed | count | fraction | cumulative |")
    out.append("|---|---|---|---|---|")
    for row in hist["rows"]:
        out.append(
            f"| {row['ticks']} | {_ns_list(row['ns_observed'])} | {row['count']} | "
            f"{row['fraction']:.4f} | {row['cumulative_fraction']:.4f} |"
        )
    out.append("")
    out.append(
        f"fraction at <= 2 ticks (inside 83.3 ns): "
        f"{hist['fraction_at_most_2_ticks']:.4f}  "
        f"({hist['at_most_2_ticks']}/{hist['n']})"
    )
    if hist["unclassified"]:
        out.append(
            f"unclassified (not within {TICK_TOLERANCE:g} tick of a whole tick): "
            f"{len(hist['unclassified'])} — {sorted(set(hist['unclassified']))[:8]}"
        )
    else:
        out.append("unclassified: none — every sample is a whole tick count")
    floor = result["instrument_floor"]
    out.append(
        f"instrument floor (two clock reads, nothing between): mean "
        f"{floor['mean_ticks']:.3f} ticks over {floor['n']} samples · "
        f"{floor['raw']}"
    )
    pct = result["percentiles_ns"]
    out.append(
        f"percentiles of the same samples, for continuity with bench_decision.py: "
        f"p50 {pct['p50']} ns · p99 {pct['p99']} ns · p99.9 {pct['p999']} ns · max {pct['max']} ns"
    )
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--source", choices=["gateway", "direct"], default="gateway")
    ap.add_argument("--orders", type=int, default=5000)
    ap.add_argument("--warmup", type=int, default=500)
    ap.add_argument("--venues", type=int, default=2)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--json", type=Path, default=None)
    ap.add_argument(
        "--attribute",
        action="store_true",
        help="classify the slow samples instead of counting them: per-sample "
             "position, gates, legs and venue count, plus the warm/cold "
             "contrast that says whether the tail is compute or cadence",
    )
    args = ap.parse_args()

    core = _load_core()
    tick_ns = core.clock_tick_ns()
    if args.attribute:
        from tools import bench_core_attrib

        report = bench_core_attrib.run(args.orders, args.warmup, args.venues, tick_ns)
        print(bench_core_attrib.render(report))
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(report, indent=2) + "\n")
            print(f"wrote {args.json}")
        return 0
    floor_raw = Counter(core.clock_floor_ns(5000))
    floor_n = sum(floor_raw.values())
    floor_mean_ticks = (
        sum(round(v / tick_ns) * c for v, c in floor_raw.items()) / floor_n
        if floor_n and tick_ns > 0
        else 0.0
    )

    runs = []
    for i in range(args.repeat):
        if args.source == "direct":
            samples = sample_direct(core, args.orders, args.warmup, args.venues)
        else:
            samples = sample_gateway(args.orders, args.warmup, args.venues)
        result = {
            "run": i + 1,
            "source": args.source,
            "venues": args.venues,
            "orders": args.orders,
            "warmup": args.warmup,
            "histogram": classify(samples, tick_ns),
            "percentiles_ns": _percentiles(samples),
            "instrument_floor": {
                "n": floor_n,
                "mean_ticks": floor_mean_ticks,
                "raw": dict(sorted(floor_raw.items())),
            },
        }
        runs.append(result)
        print(f"--- run {i + 1} of {args.repeat} ---")
        print(render(result))
        print()

    fractions = [r["histogram"]["fraction_at_most_2_ticks"] for r in runs]
    summary = {
        "generated_on": datetime.now(UTC).date().isoformat(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "source": args.source,
        "orders": args.orders,
        "warmup": args.warmup,
        "venues": args.venues,
        "repeat": args.repeat,
        "tick_ns": tick_ns,
        "fraction_at_most_2_ticks_per_run": fractions,
        "fraction_at_most_2_ticks_median": statistics.median(fractions),
        "runs": runs,
    }
    print(
        f"median fraction at <= 2 ticks across {args.repeat} run"
        f"{'s' if args.repeat != 1 else ''}: {summary['fraction_at_most_2_ticks_median']:.4f}"
    )
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(summary, indent=2) + "\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
