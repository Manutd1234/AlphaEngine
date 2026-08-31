"""Measure the native kernel, language boundary and whole varying decision.

The report separates both timer floors, the pybind identity round-trip, the
native boundary and the real decision. Only the warmed two-venue C++ kernel is
judged: at least 99% of ``elapsed_ns`` observations must be below 100 ns. The
whole gateway stays a separate microsecond population.

    venv/bin/python tools/bench_native_boundary.py --json docs/native-latency.generated.json
"""

from __future__ import annotations

import argparse
import asyncio
import gc
import json
import math
import os
import platform
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools import native_benchmark_materialization as _materialization  # noqa: E402
from tools.native_benchmark_stats import (  # noqa: E402 - direct script needs ROOT first
    assess_latency_contract,
    nearest_rank,
    summarize,
)

__all__ = ["assess_latency_contract", "nearest_rank"]
_legacy_materialize = _materialization.legacy_materialize
_materialization_ab = _materialization.materialization_ab
_summary = summarize


def _levels(mid: float, venue: int, count: int = 50):
    spread = 0.01 + venue * 0.01
    bids = [(round(mid - spread - i * 0.01, 4), 5000.0) for i in range(count)]
    asks = [(round(mid + spread + i * 0.01, 4), 5000.0) for i in range(count)]
    return bids, asks


def _ladders(core, venues: int):
    values = []
    for venue in range(venues):
        ladder = core.BookLadder()
        ladder.snapshot(*_levels(100.0, venue))
        values.append(ladder)
    return values


def _arguments(ladders: list, variant: int = 0) -> tuple:
    side_is_buy = variant % 2 == 0
    is_limit = variant % 4 in {2, 3}
    notionals = (1000.0, 250.0, 5000.0, 25_000.0)
    notional = notionals[variant % len(notionals)]
    limit = (100.05 if side_is_buy else 99.95) if is_limit else None
    return (
        side_is_buy,
        is_limit,
        None,
        notional,
        limit,
        False,
        None,
        ladders,
        [],
        [],
        [],
        [],
        [],
        float(variant % 3),
        float(variant % 3),
        100_000.0,
        -float(variant % 5),
        100_000.0,
        1_000_000.0,
        1_000_000.0,
        10_000_000.0,
        100.0,
        0.1,
        0.8,
        variant > 0 and variant % 11 == 0,
        True,
        None,
        "BTCUSDT",
    )


def _python_timer_floor(samples: int) -> list[int]:
    values = []
    for _ in range(samples):
        start = time.perf_counter_ns()
        stop = time.perf_counter_ns()
        values.append(stop - start)
    return values


def _roundtrip(core, orders: int, warmup: int) -> list[int]:
    inputs = (0.0, -0.0, 1.0, -17.25, math.pi, 1e100)
    for index in range(warmup):
        core.roundtrip_probe(inputs[index % len(inputs)])
    values = []
    for index in range(orders):
        value = inputs[index % len(inputs)]
        start = time.perf_counter_ns()
        observed = core.roundtrip_probe(value)
        stop = time.perf_counter_ns()
        if observed != value or (value == 0.0 and str(observed) != str(value)):
            raise RuntimeError("roundtrip probe changed its input")
        values.append(stop - start)
    return values


def _direct(core, orders: int, warmup: int, venues: int, varied: bool) -> dict[str, Any]:
    ladders = _ladders(core, venues)
    variants = [_arguments(ladders, index if varied else 0) for index in range(16)]
    for index in range(warmup):
        core.decide(*variants[index % len(variants)])
    wall: list[int] = []
    kernel: list[int] = []
    for index in range(orders):
        args = variants[index % len(variants)]
        start = time.perf_counter_ns()
        result = core.decide(*args)
        stop = time.perf_counter_ns()
        wall.append(stop - start)
        kernel.append(result.elapsed_ns)
    return {
        "venues": venues,
        "inputs": "varied" if varied else "canonical_constant",
        "wall_ns": {"summary": _summary(wall), "raw": wall},
        "kernel_ns": {"summary": _summary(kernel), "raw": kernel},
        "materialized_boundary": _materialization_ab(core, variants, orders, warmup),
    }


async def _whole_decision(
    orders: int,
    warmup: int,
    *,
    legacy_result_conversion: bool,
) -> dict[str, Any]:
    from modules.risk_proxy.native_result import NativeDecisionResult
    from modules.schemas import OrderRequest
    from tools.bench_decision import _build_gateway

    original_materialize = NativeDecisionResult.__dict__["materialize"]
    if legacy_result_conversion:
        NativeDecisionResult.materialize = classmethod(  # type: ignore[method-assign]
            lambda _cls, result, venue_count=None, _native_type=None: _legacy_materialize(
                result, venue_count
            )
        )
    gateway = _build_gateway(2)
    requests = (
        OrderRequest(symbol="BTCUSDT", side="BUY", notional=250.0, order_type="MARKET", strategy="bench"),
        OrderRequest(symbol="BTCUSDT", side="SELL", notional=1000.0, order_type="MARKET", strategy="bench"),
        OrderRequest(
            symbol="BTCUSDT",
            side="BUY",
            notional=5000.0,
            limit_price=100.05,
            order_type="LIMIT",
            strategy="bench",
        ),
        OrderRequest(
            symbol="BTCUSDT",
            side="SELL",
            quantity=2.0,
            limit_price=99.95,
            order_type="LIMIT",
            strategy="bench",
        ),
    )
    try:
        for index in range(warmup):
            gateway.working.clear()
            await gateway.submit(requests[index % len(requests)], source="native-boundary-bench")
        decision_us: list[float] = []
        wall_ns: list[int] = []
        kernel_ns: list[int] = []
        for index in range(orders):
            gateway.working.clear()
            start = time.perf_counter_ns()
            result = await gateway.submit(requests[index % len(requests)], source="native-boundary-bench")
            wall_ns.append(time.perf_counter_ns() - start)
            decision_us.append(result.latency_ms * 1000.0)
            if gateway.last_decision_core_ns is None:
                raise RuntimeError("varying decision silently left the native engine")
            kernel_ns.append(gateway.last_decision_core_ns)
        return {
            "inputs": "four_order_shapes",
            "result_conversion": "legacy_attributes" if legacy_result_conversion else "eager_tuple",
            "wall_ns": {"summary": _summary(wall_ns), "raw": wall_ns},
            "decision_us": {"summary": _summary(decision_us), "raw": decision_us},
            "kernel_ns": {"summary": _summary(kernel_ns), "raw": kernel_ns},
        }
    finally:
        NativeDecisionResult.materialize = original_materialize  # type: ignore[method-assign]


def _run(
    core,
    orders: int,
    warmup: int,
    gateway_orders: int,
    gateway_warmup: int,
    run_index: int,
) -> dict[str, Any]:
    direct_two = _direct(core, orders, warmup, 2, varied=False)
    gateway_modes = (False, True) if run_index % 2 == 0 else (True, False)
    gateway_results = {
        legacy: asyncio.run(
            _whole_decision(
                gateway_orders,
                gateway_warmup,
                legacy_result_conversion=legacy,
            )
        )
        for legacy in gateway_modes
    }
    return {
        "python_timer_floor_ns": {
            "summary": _summary(floor := _python_timer_floor(orders)),
            "raw": floor,
        },
        "cpp_timer_floor_ns": {
            "summary": _summary(cpp_floor := list(core.clock_floor_ns(orders))),
            "raw": cpp_floor,
        },
        "python_cpp_roundtrip_ns": {
            "summary": _summary(boundary := _roundtrip(core, orders, warmup)),
            "raw": boundary,
        },
        "direct": {
            "canonical_two_venue": direct_two,
            "varied_two_venue": _direct(core, orders, warmup, 2, varied=True),
            "varied_four_venue": _direct(core, orders, warmup, 4, varied=True),
        },
        "whole_gateway": gateway_results[False],
        "whole_gateway_legacy_result_conversion": gateway_results[True],
        "release_contract": assess_latency_contract(
            direct_two["kernel_ns"]["raw"], target_ns=100, required_fraction=0.99
        ),
        "stretch_contract": assess_latency_contract(
            direct_two["kernel_ns"]["raw"], target_ns=50, required_fraction=0.50
        ),
    }


def _without_raw(value: Any) -> Any:
    """Drop sample arrays for a reviewable summary artefact."""
    if isinstance(value, dict):
        return {key: _without_raw(item) for key, item in value.items() if key != "raw"}
    if isinstance(value, list):
        return [_without_raw(item) for item in value]
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--orders", type=int, default=2000)
    parser.add_argument("--warmup", type=int, default=250)
    parser.add_argument("--gateway-orders", type=int, help="gateway samples; defaults to --orders")
    parser.add_argument("--gateway-warmup", type=int, help="gateway warmups; defaults to --warmup")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--json", type=Path)
    parser.add_argument(
        "--include-raw",
        action="store_true",
        help="retain every observed sample; omit for a compact review artefact",
    )
    args = parser.parse_args()
    gateway_orders = args.gateway_orders if args.gateway_orders is not None else args.orders
    gateway_warmup = args.gateway_warmup if args.gateway_warmup is not None else args.warmup
    if (
        args.orders < 1
        or args.warmup < 0
        or gateway_orders < 1
        or gateway_warmup < 0
        or args.repeat < 1
    ):
        parser.error("orders/repeat must be positive and warmup non-negative")

    from modules import decision_core

    core = decision_core.native()
    if core is None:
        raise SystemExit("native core unavailable; build it in Part2_Infrastructure/venv first")
    gc.collect()
    gc.disable()
    try:
        runs = [
            _run(
                core,
                args.orders,
                args.warmup,
                gateway_orders,
                gateway_warmup,
                run_index,
            )
            for run_index in range(args.repeat)
        ]
    finally:
        gc.enable()
    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "executable": sys.executable,
            "cpu_count": os.cpu_count(),
            "pinning": "unavailable" if not hasattr(os, "sched_getaffinity") else sorted(os.sched_getaffinity(0)),
        },
        "native": decision_core.snapshot(),
        "orders_per_run": args.orders,
        "warmup": args.warmup,
        "gateway_orders_per_run": gateway_orders,
        "gateway_warmup": gateway_warmup,
        "repeat": args.repeat,
        "raw_samples_included": args.include_raw,
        "claim_boundary": (
            "Only direct.canonical_two_venue.kernel_ns is judged against 100 ns; "
            "python/C++ round-trip and whole_gateway are separate populations."
        ),
        "runs": runs,
    }
    if not args.include_raw:
        report = _without_raw(report)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(rendered)
        print(f"wrote {args.json}")
    summaries = [run["release_contract"] for run in runs]
    print(json.dumps({"release_contracts": summaries, "native": report["native"]}, indent=2))
    return 0 if all(item["passed"] for item in summaries) else 2


if __name__ == "__main__":
    raise SystemExit(main())
