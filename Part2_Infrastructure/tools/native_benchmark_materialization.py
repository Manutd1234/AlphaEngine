"""A/B controls for the native result conversion boundary."""

from __future__ import annotations

import time
from typing import Any

from modules.risk_proxy.native_result import NativeDecisionResult
from tools.native_benchmark_stats import summarize


def legacy_materialize(result, venue_count: int | None = None) -> NativeDecisionResult:
    """Run the former nineteen-attribute conversion as a matched control."""
    materialized = NativeDecisionResult(
        int(result.elapsed_ns),
        result.mark,
        bool(result.has_price),
        result.qty,
        result.notional,
        float(result.projected_sym),
        float(result.projected_gross),
        float(result.dev_bps),
        float(result.dd),
        bool(result.reduce_only_active),
        bool(result.reducing),
        float(result.budget_used),
        bool(result.route_ran),
        bool(result.route_none),
        bool(result.route_fillable),
        float(result.route_filled_notional),
        bool(result.route_has_slip),
        float(result.route_slippage_bps),
        tuple(int(venue) for venue in result.route_venue_order),
    )
    materialized.validate_route(venue_count)
    return materialized


def materialization_ab(core, variants: list[tuple], orders: int, warmup: int) -> dict[str, Any]:
    """Interleave complete calls with accelerated and legacy conversion."""
    for index in range(warmup):
        args = variants[index % len(variants)]
        if index % 2:
            legacy_materialize(core.decide(*args))
            NativeDecisionResult.materialize(core.decide(*args), None, core.CoreResult)
        else:
            NativeDecisionResult.materialize(core.decide(*args), None, core.CoreResult)
            legacy_materialize(core.decide(*args))
    accelerated: list[int] = []
    legacy: list[int] = []
    for index in range(orders):
        args = variants[index % len(variants)]
        order = ("legacy", "accelerated") if index % 2 else ("accelerated", "legacy")
        for strategy in order:
            start = time.perf_counter_ns()
            result = core.decide(*args)
            if strategy == "accelerated":
                materialized = NativeDecisionResult.materialize(result, None, core.CoreResult)
            else:
                materialized = legacy_materialize(result)
            elapsed = time.perf_counter_ns() - start
            if materialized.elapsed_ns != result.elapsed_ns:
                raise RuntimeError("result materialization changed the native timing value")
            (accelerated if strategy == "accelerated" else legacy).append(elapsed)
    return {
        "accelerated_wall_ns": {"summary": summarize(accelerated), "raw": accelerated},
        "legacy_wall_ns": {"summary": summarize(legacy), "raw": legacy},
    }
