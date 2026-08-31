"""Small, deterministic statistics used by the native latency harness."""

from __future__ import annotations

import math
import statistics
from typing import Any


def nearest_rank(samples: list[int] | list[float], quantile: float) -> int | float:
    """Return an observed nearest-rank value, never interpolated latency."""
    if not samples:
        raise ValueError("nearest_rank requires at least one sample")
    if not 0.0 < quantile <= 1.0:
        raise ValueError("quantile must be in (0, 1]")
    ordered = sorted(samples)
    rank = max(1, min(len(ordered), math.ceil(quantile * len(ordered))))
    return ordered[rank - 1]


def assess_latency_contract(
    samples_ns: list[int], *, target_ns: int, required_fraction: float
) -> dict[str, Any]:
    """Evaluate a measured population, including deterministic red controls."""
    if not samples_ns:
        return {
            "passed": False,
            "reason": "no_samples",
            "target_ns_exclusive": target_ns,
            "required_fraction": required_fraction,
            "inside_target": 0,
            "fraction_inside_target": 0.0,
            "p99_ns": None,
        }
    inside = sum(value < target_ns for value in samples_ns)
    fraction = inside / len(samples_ns)
    return {
        "passed": fraction >= required_fraction,
        "reason": None if fraction >= required_fraction else "latency_population_breach",
        "target_ns_exclusive": target_ns,
        "required_fraction": required_fraction,
        "inside_target": inside,
        "fraction_inside_target": fraction,
        "p99_ns": nearest_rank(samples_ns, 0.99),
    }


def summarize(samples: list[int] | list[float]) -> dict[str, int | float]:
    """Summarize one population without changing its observed quantiles."""
    return {
        "n": len(samples),
        "min": min(samples),
        "p50": nearest_rank(samples, 0.50),
        "p99": nearest_rank(samples, 0.99),
        "p999": nearest_rank(samples, 0.999),
        "max": max(samples),
        "mean": statistics.fmean(samples),
    }
