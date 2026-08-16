"""Measure the pre-trade decision, reproducibly.

The figures in ``docs/LATENCY_BUDGET.md`` §2.1 were a one-off run on one
machine, quoted from memory ever since. This harness makes them regenerable:
it builds the same shape ("5 000 orders against a synthetic 50-level book,
warmed"), runs the gateway's own ``submit()`` in-process, and prints what it
measured — then optionally rewrites the doc's table between two markers so a
number nobody can reproduce never appears there again.

    venv/bin/python tools/bench_decision.py --engine python --venues 2
    venv/bin/python tools/bench_decision.py --engine both --venues 2 --repeat 3 \\
        --json docs/latency-bench.generated.json --update-doc

Two figures, deliberately kept apart:

* ``decision`` — the whole ``submit()`` under the gateway lock, taken from
  ``RiskDecision.latency_ms`` (exact per-decision samples from
  ``perf_counter_ns``; NOT the 12 %-bucket histogram the live desk reads,
  which exists so a tail is visible without keeping every sample).
* ``core`` — the native engine's own ``steady_clock`` around the arithmetic,
  read from ``gateway.last_decision_core_ns``; absent (``None``) while the
  Python engine is running.

What this cannot do on a laptop: pin a CPU or silence the OS. On Linux it
sets ``sched_setaffinity``; on macOS it records that pinning was unavailable
and reports the median of ``--repeat`` runs. Treat the numbers as the shape
of the distribution, not a warranty on the last microsecond.
"""

from __future__ import annotations

import argparse
import asyncio
import gc
import json
import os
import platform
import statistics
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DOC = ROOT.parent / "docs" / "LATENCY_BUDGET.md"
MARK_START = "<!-- bench:start -->"
MARK_END = "<!-- bench:end -->"


def _deep_book(venue: str, symbol: str, mid: float = 100.0, size: float = 5000.0):
    from modules.tca_engine import BookState

    book = BookState(venue, symbol)
    book.apply_snapshot(
        bids=[(round(mid - i * 0.01, 4), size) for i in range(50)],
        asks=[(round(mid + i * 0.01, 4), size) for i in range(50)],
    )
    return book


class _Feed:
    def __init__(self, book) -> None:
        self.connected = True
        self.books = {book.symbol: book}


def _build_gateway(venues: int):
    from modules.risk_proxy import RiskGateway, TokenBucket
    from modules.tca_engine import TCAEngine

    eng = TCAEngine(symbols=["BTCUSDT"], venues=[])
    names = ["BINANCE", "BYBIT"][:venues] if venues <= 2 else [f"V{i}" for i in range(venues)]
    eng.feeds = {name: _Feed(_deep_book(name, "BTCUSDT")) for name in names}
    gw = RiskGateway(tca_engine=eng, audit=None)
    # The rate gate would otherwise reject the burst; the bench measures the
    # decision, not the throttle.
    gw.bucket = TokenBucket(rate=1e9, burst=10**9)
    return gw


def _percentiles(samples_us: list[float]) -> dict[str, float]:
    s = sorted(samples_us)
    n = len(s)

    def q(p: float) -> float:
        rank = max(1, min(n, int(-(-p * n // 1))))  # ceil(p*n), nearest-rank
        return s[rank - 1]

    return {"p50": q(0.50), "p99": q(0.99), "p999": q(0.999), "max": s[-1], "n": n}


async def _run_once(engine: str, orders: int, warmup: int, venues: int, gc_on: bool):
    from modules import decision_core as dc_mod  # noqa: F401  (import guards the flag)
    from modules.schemas import OrderRequest

    gw = _build_gateway(venues)
    req = OrderRequest(symbol="BTCUSDT", side="BUY", notional=1000.0, order_type="MARKET", strategy="bench")

    for _ in range(warmup):
        await gw.submit(req, source="bench")

    samples_us: list[float] = []
    core_ns: list[int] = []
    if not gc_on:
        gc.collect()
        gc.disable()
    try:
        for _ in range(orders):
            decision = await gw.submit(req, source="bench")
            samples_us.append(decision.latency_ms * 1000.0)
            if gw.last_decision_core_ns is not None:
                core_ns.append(gw.last_decision_core_ns)
    finally:
        if not gc_on:
            gc.enable()

    out = {"decision_us": _percentiles(samples_us)}
    if core_ns:
        out["core_ns"] = _percentiles([float(v) for v in core_ns])
    return out


def _pin() -> str:
    if hasattr(os, "sched_setaffinity"):
        try:
            os.sched_setaffinity(0, {os.cpu_count() - 1})  # type: ignore[arg-type]
            return f"sched_setaffinity cpu {os.cpu_count() - 1}"
        except OSError as exc:  # pragma: no cover - platform dependent
            return f"unavailable ({exc})"
    return f"unavailable ({sys.platform})"


def _median_run(runs: list[dict]) -> dict:
    """Median of each percentile across repeats — the shape, not one lucky run."""
    keys = runs[0].keys()
    out: dict = {}
    for key in keys:
        fields = runs[0][key].keys()
        out[key] = {f: statistics.median(r[key][f] for r in runs) for f in fields}
    return out


def _fmt_us(v: float) -> str:
    return f"{v:.1f} µs"


def _fmt_ns(v: float) -> str:
    return f"{v:.0f} ns" if v < 1000 else f"{v / 1000:.2f} µs"


def _doc_table(results: dict, venues: int, machine: str) -> str:
    lines = [
        MARK_START,
        f"Regenerated by `tools/bench_decision.py` on {results['generated_on']} — "
        f"{results['orders']} orders after {results['warmup']} warm-up, {venues} venue"
        f"{'s' if venues != 1 else ''}, {machine}, pinning: {results['pinning']}, "
        f"median of {results['repeat']} run{'s' if results['repeat'] != 1 else ''}. "
        "Exact per-decision samples from `perf_counter_ns`; the live desk reads the "
        "12 %-bucket histogram instead.",
        "",
        "| engine | p50 | p99 | p99.9 | max | n |",
        "|---|---|---|---|---|---|",
    ]
    for engine, res in results["engines"].items():
        d = res["decision_us"]
        lines.append(
            f"| {engine} — decision | {_fmt_us(d['p50'])} | {_fmt_us(d['p99'])} | "
            f"{_fmt_us(d['p999'])} | {_fmt_us(d['max'])} | {int(d['n'])} |"
        )
        if "core_ns" in res:
            c = res["core_ns"]
            lines.append(
                f"| {engine} — core (inside the engine) | {_fmt_ns(c['p50'])} | {_fmt_ns(c['p99'])} | "
                f"{_fmt_ns(c['p999'])} | {_fmt_ns(c['max'])} | {int(c['n'])} |"
            )
    lines.append(MARK_END)
    return "\n".join(lines)


def _update_doc(table: str) -> None:
    text = DOC.read_text()
    if MARK_START in text and MARK_END in text:
        head, rest = text.split(MARK_START, 1)
        _, tail = rest.split(MARK_END, 1)
        DOC.write_text(head + table + tail)
        return
    # First run: place the block right after the §2.1 heading's paragraph.
    anchor = "### 2.1 The pre-trade risk decision — measured\n"
    if anchor not in text:
        raise SystemExit(f"cannot find §2.1 anchor in {DOC}")
    head, tail = text.split(anchor, 1)
    DOC.write_text(head + anchor + "\n" + table + "\n" + tail)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--engine", choices=["python", "native", "both"], default="python")
    ap.add_argument("--orders", type=int, default=5000)
    ap.add_argument("--warmup", type=int, default=500)
    ap.add_argument("--venues", type=int, default=2)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--gc-on", action="store_true", help="leave the cyclic GC enabled during the loop")
    ap.add_argument("--json", type=Path, default=None, help="write the results here")
    ap.add_argument("--update-doc", action="store_true", help="rewrite the table in docs/LATENCY_BUDGET.md")
    args = ap.parse_args()

    pinning = _pin()
    engines = ["python", "native"] if args.engine == "both" else [args.engine]
    results: dict = {
        "generated_on": datetime.now(UTC).date().isoformat(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "pinning": pinning,
        "gc": "on" if args.gc_on else "disabled during the loop",
        "orders": args.orders,
        "warmup": args.warmup,
        "venues": args.venues,
        "repeat": args.repeat,
        "engines": {},
    }

    for engine in engines:
        os.environ["DECISION_CORE"] = engine
        # The loader reads the flag at import; force a fresh read per engine.
        for mod in [m for m in list(sys.modules) if m.startswith("modules.decision_core")]:
            del sys.modules[mod]
        try:
            from modules import decision_core
        except RuntimeError as exc:
            print(f"[{engine}] unavailable: {exc}")
            continue
        active = decision_core.ENGINE
        if active != engine:
            print(f"[{engine}] requested but the loader resolved {active}; recording as {active}")
        runs = []
        for i in range(args.repeat):
            res = asyncio.run(_run_once(active, args.orders, args.warmup, args.venues, args.gc_on))
            runs.append(res)
            d = res["decision_us"]
            line = f"[{active}] run {i + 1}: decision p50 {d['p50']:.1f} µs · p99 {d['p99']:.1f} µs · max {d['max']:.1f} µs"
            if "core_ns" in res:
                c = res["core_ns"]
                line += f" · core p50 {c['p50']:.0f} ns · p99 {c['p99']:.0f} ns"
            print(line)
        results["engines"][active] = _median_run(runs)

    print(json.dumps(results, indent=2))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2) + "\n")
        print(f"wrote {args.json}")
    if args.update_doc:
        _update_doc(_doc_table(results, args.venues, f"{platform.machine()} · Python {platform.python_version()}"))
        print(f"updated {DOC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
