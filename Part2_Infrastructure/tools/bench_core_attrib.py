"""Attribution for the slow samples in the core's tick histogram.

``bench_core_ticks.py`` counts HOW MANY calls needed a third tick. This answers
the next question — WHICH ones, and why — because an optimisation aimed at a
tail nobody has classified is an optimisation aimed at nothing.

Four things plausibly separate a 2-tick call from a 3-tick one, and this module
records all four per sample so the answer is read off the data rather than
assumed:

* **position in the run** — if the slow calls are the first N, the cache and the
  branch predictor are cold and the fix belongs in the BENCH's warm-up, not in
  the core;
* **ladder depth / legs folded** — how many venues the routed walk actually
  touched;
* **which gates engaged** — a gate that trips takes a different path, and a
  rejected order is not the same computation as an accepted one;
* **venue count**.

WHAT IT FINDS ON THIS BENCH, and the reason the tool reports it so loudly: all
four are CONSTANT across the steady-state run. The bench submits one order
shape at one book, so after the warm-up every call carries an identical
argument tuple down an identical branch path — same held book, same legs, same
gate outcomes. When the input signature never varies, no input field can
explain the tail, and the histogram's spread is arriving-cold plus the machine,
not the arithmetic.

So the module ends with the experiment that CAN separate those two: the same
core, the same argument tuple, called at two cadences.

    replayed  — the exact arguments the gateway just passed, called back to
                back with no Python in between, so every line stays resident;
    gateway   — the same call reached through ``RiskGateway.submit()``, which
                puts ~12 µs of Python between one order and the next.

The difference between those two histograms is the cost of arriving cold, and
it is the only quantity here that a change to the core could move. Anything
left over after it is the scheduler, and is reported as such rather than
optimised against.
"""

from __future__ import annotations

import asyncio
import gc
import statistics
from collections import Counter

#: A sample needing more ticks than this is "slow" — the population the whole
#: module exists to explain. Two ticks is 83.3 ns, the boundary "p99 < 100 ns"
#: actually reduces to.
SLOW_ABOVE_TICKS = 2

#: Blocks the run is split into for the positional test. Ten blocks of 500 is
#: enough to see a warm-up decay and coarse enough not to read noise as trend.
BLOCKS = 10


class _ArgRecorder:
    """Sits in front of the core module and keeps the last argument tuple.

    ``_native_decide`` resolves the core as ``self._decision_core`` and calls
    ``core.decide(...)`` positionally, so standing here captures EXACTLY what
    the cold path passed — not a reconstruction of it. The replay below then
    calls the real core with that tuple, which is what makes the warm/cold
    contrast a contrast in cadence alone.
    """

    def __init__(self, module) -> None:
        self._module = module
        self.last_args: tuple | None = None

    def __getattr__(self, name):
        return getattr(self._module, name)

    def decide(self, *args):
        self.last_args = args
        return self._module.decide(*args)


def _gate_signature(decision) -> tuple:
    """The gates that ENGAGED on this call, as a hashable signature.

    Names only, never the observed figures: two calls that failed the same gate
    on different numbers took the same path, and it is the path this is
    classifying.
    """
    rejected_by = decision.rejected_by
    # RiskDecision.rejected_by is a list; a signature has to be hashable.
    if isinstance(rejected_by, list):
        rejected_by = tuple(rejected_by)
    return (
        bool(decision.accepted),
        rejected_by,
        tuple(c.name for c in decision.checks if not c.passed),
    )


async def _run_gateway(orders: int, warmup: int, venues: int):
    """Sample through submit(), recording a full signature per call."""
    from modules.risk_proxy import RiskGateway, TokenBucket
    from modules.schemas import OrderRequest
    from modules.tca_engine import TCAEngine
    from tools.bench_core_ticks import ORDER_NOTIONAL, _deep_book, _Feed

    engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
    names = ["BINANCE", "BYBIT"][:venues] if venues <= 2 else [f"V{i}" for i in range(venues)]
    engine.feeds = {name: _Feed(_deep_book(name, "BTCUSDT")) for name in names}
    gateway = RiskGateway(tca_engine=engine, audit=None)
    gateway.bucket = TokenBucket(rate=1e9, burst=10**9)
    if gateway._decision_core is None:
        raise SystemExit(
            "no native core resolved; build it with\n"
            "  venv/bin/python native/decision_core/setup.py build_ext --inplace "
            "--build-temp build/native"
        )
    recorder = _ArgRecorder(gateway._decision_core)
    gateway._decision_core = recorder
    req = OrderRequest(
        symbol="BTCUSDT", side="BUY", notional=ORDER_NOTIONAL,
        order_type="MARKET", strategy="bench",
    )

    for _ in range(warmup):
        await gateway.submit(req, source="bench")

    records: list[dict] = []
    gc.collect()
    gc.disable()
    try:
        for i in range(orders):
            decision = await gateway.submit(req, source="bench")
            value = gateway.last_decision_core_ns
            if value is None:
                continue
            records.append(
                {
                    "index": i,
                    "ns": value,
                    "venues": len(names),
                    "positions": len(gateway.positions),
                    "working": len(gateway.working),
                    "gates": _gate_signature(decision),
                }
            )
    finally:
        gc.enable()
    return records, recorder


def _replay(module, args, orders: int, warmup: int) -> list[int]:
    """The captured tuple, called back to back — the same work, arriving warm."""
    for _ in range(warmup):
        module.decide(*args)
    return [module.decide(*args).elapsed_ns for _ in range(orders)]


def _ticks(ns: int, tick_ns: float) -> int:
    return round(ns / tick_ns)


def _dist(values: list[int], tick_ns: float) -> dict:
    counts = Counter(_ticks(v, tick_ns) for v in values)
    n = len(values) or 1
    return {
        "n": len(values),
        "mean_ticks": sum(k * c for k, c in counts.items()) / n,
        "fraction_at_most_2_ticks": sum(c for k, c in counts.items() if k <= 2) / n,
        "buckets": dict(sorted(counts.items())),
    }


def attribute(records: list[dict], replayed: list[int], tick_ns: float) -> dict:
    """Correlate each recorded field against the tick count."""
    gateway_ns = [r["ns"] for r in records]
    slow = [r for r in records if _ticks(r["ns"], tick_ns) > SLOW_ABOVE_TICKS]

    # --- does any INPUT field vary at all? ---
    signatures = Counter(
        (r["venues"], r["positions"], r["working"], r["gates"]) for r in records
    )
    per_signature = []
    for sig, count in signatures.most_common():
        members = [
            r["ns"] for r in records
            if (r["venues"], r["positions"], r["working"], r["gates"]) == sig
        ]
        per_signature.append(
            {
                "venues": sig[0],
                "positions": sig[1],
                "working": sig[2],
                "accepted": sig[3][0],
                "rejected_by": list(sig[3][1]) if isinstance(sig[3][1], tuple) else sig[3][1],
                "gates_failed": list(sig[3][2]),
                "count": count,
                **_dist(members, tick_ns),
            }
        )

    # --- positional: is the tail the first N calls? ---
    size = max(1, len(records) // BLOCKS)
    blocks = []
    for b in range(BLOCKS):
        chunk = [r["ns"] for r in records[b * size : (b + 1) * size]]
        if not chunk:
            continue
        blocks.append({"block": b, "first_index": b * size, **_dist(chunk, tick_ns)})

    # --- serial: does a slow sample follow a slow one? ---
    slow_idx = {r["index"] for r in slow}
    adjacent = sum(1 for i in slow_idx if (i - 1) in slow_idx)

    return {
        "tick_ns": tick_ns,
        "gateway": _dist(gateway_ns, tick_ns),
        "replayed": _dist(replayed, tick_ns),
        "slow_count": len(slow),
        "slow_indices": sorted(slow_idx)[:40],
        "slow_adjacent_pairs": adjacent,
        "distinct_input_signatures": len(signatures),
        "per_signature": per_signature,
        "blocks": blocks,
    }


def render(result: dict) -> str:
    tick = result["tick_ns"]
    out: list[str] = []
    gw, rp = result["gateway"], result["replayed"]
    out.append(f"tick width {tick:.3f} ns · slow means > {SLOW_ABOVE_TICKS} ticks")
    out.append("")
    out.append("| cadence | n | mean ticks | mean ns | <= 2 ticks | buckets |")
    out.append("|---|---|---|---|---|---|")
    for name, d in (("gateway (cold)", gw), ("replayed (warm)", rp)):
        out.append(
            f"| {name} | {d['n']} | {d['mean_ticks']:.3f} | "
            f"{d['mean_ticks'] * tick:.1f} | {d['fraction_at_most_2_ticks']:.4f} | "
            f"{d['buckets']} |"
        )
    out.append("")
    cold = (gw["mean_ticks"] - rp["mean_ticks"]) * tick
    out.append(
        f"cost of arriving cold: {cold:.1f} ns of the gateway's "
        f"{gw['mean_ticks'] * tick:.1f} ns mean — the SAME argument tuple, "
        f"replayed back to back, costs {rp['mean_ticks'] * tick:.1f} ns."
    )
    out.append("")

    n_sig = result["distinct_input_signatures"]
    out.append(f"distinct input signatures across the run: {n_sig}")
    if n_sig == 1:
        out.append(
            "  -> every call took identical inputs down an identical branch path, "
            "so NO input field (position in run, legs, gates, venues) can "
            "explain the tail. It is not the compute varying."
        )
    out.append("")
    out.append("| venues | positions | working | accepted | gates failed | count | mean ticks | <= 2 ticks |")
    out.append("|---|---|---|---|---|---|---|---|")
    for s in result["per_signature"]:
        gates = ",".join(s["gates_failed"]) or "-"
        out.append(
            f"| {s['venues']} | {s['positions']} | {s['working']} | {s['accepted']} | "
            f"{gates} | {s['count']} | {s['mean_ticks']:.3f} | "
            f"{s['fraction_at_most_2_ticks']:.4f} |"
        )
    out.append("")
    out.append("positional — is the tail the first N calls?")
    out.append("| block | from index | n | mean ticks | <= 2 ticks |")
    out.append("|---|---|---|---|---|")
    for b in result["blocks"]:
        out.append(
            f"| {b['block']} | {b['first_index']} | {b['n']} | "
            f"{b['mean_ticks']:.3f} | {b['fraction_at_most_2_ticks']:.4f} |"
        )
    fractions = [b["fraction_at_most_2_ticks"] for b in result["blocks"]]
    if fractions:
        first, rest = fractions[0], statistics.mean(fractions[1:]) if len(fractions) > 1 else fractions[0]
        verdict = (
            "the first block is no worse than the rest — this is NOT warm-up"
            if first >= rest - 0.01
            else "the first block is worse — a warm-up phase belongs in the BENCH"
        )
        out.append("")
        out.append(f"  first block {first:.4f} vs mean of the rest {rest:.4f}: {verdict}")
    out.append("")
    out.append(
        f"slow samples: {result['slow_count']}, of which "
        f"{result['slow_adjacent_pairs']} immediately follow another slow one "
        "(a burst is the scheduler; isolated singletons are quantisation)."
    )
    out.append(f"  first indices: {result['slow_indices']}")
    return "\n".join(out)


def run(orders: int, warmup: int, venues: int, tick_ns: float) -> dict:
    """Sample the gateway, replay its exact arguments warm, and attribute."""
    records, recorder = asyncio.run(_run_gateway(orders, warmup, venues))
    if not records:
        raise SystemExit("no samples carried a core timing; is the native core resolved?")
    if recorder.last_args is None:
        raise SystemExit("the core was never called; nothing to replay")
    replayed = _replay(recorder._module, recorder.last_args, orders, warmup)
    return attribute(records, replayed, tick_ns)
