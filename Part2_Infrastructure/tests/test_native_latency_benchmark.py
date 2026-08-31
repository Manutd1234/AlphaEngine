"""Deterministic guards around the native latency release criterion.

Hardware timing remains a benchmark artefact, not a unit-test assertion. These
tests hold the evaluator itself to account, including a deliberately slow
population that must fail, so a reporting bug cannot turn a regression green.
"""

from __future__ import annotations

import asyncio

from tools.bench_native_boundary import (
    _direct,
    _whole_decision,
    assess_latency_contract,
    nearest_rank,
)


def test_nearest_rank_reports_an_observed_sample() -> None:
    assert nearest_rank([125, 42, 84, 41], 0.50) == 42
    assert nearest_rank([125, 42, 84, 41], 0.99) == 125


def test_sub_100ns_kernel_contract_accepts_exactly_99_percent() -> None:
    samples = [42] * 500 + [84] * 490 + [125] * 10
    result = assess_latency_contract(samples, target_ns=100, required_fraction=0.99)

    assert result["passed"] is True
    assert result["inside_target"] == 990
    assert result["fraction_inside_target"] == 0.99
    assert result["p99_ns"] == 84


def test_deliberate_slow_population_is_a_red_performance_control() -> None:
    samples = [42] * 500 + [84] * 489 + [125] * 11
    result = assess_latency_contract(samples, target_ns=100, required_fraction=0.99)

    assert result["passed"] is False
    assert result["inside_target"] == 989
    assert result["p99_ns"] == 125


def test_an_empty_run_can_never_pass() -> None:
    result = assess_latency_contract([], target_ns=100, required_fraction=0.99)

    assert result["passed"] is False
    assert result["reason"] == "no_samples"


def test_complete_native_boundary_keeps_accelerated_and_legacy_populations_separate() -> None:
    from modules import _decision_core as core

    measured = _direct(core, orders=8, warmup=2, venues=2, varied=True)
    boundary = measured["materialized_boundary"]

    assert boundary["accelerated_wall_ns"]["summary"]["n"] == 8
    assert boundary["legacy_wall_ns"]["summary"]["n"] == 8
    assert measured["kernel_ns"]["summary"]["n"] == 8


def test_gateway_ab_runs_both_result_converters_without_falling_back() -> None:
    eager = asyncio.run(_whole_decision(orders=2, warmup=1, legacy_result_conversion=False))
    legacy = asyncio.run(_whole_decision(orders=2, warmup=1, legacy_result_conversion=True))

    assert eager["result_conversion"] == "eager_tuple"
    assert legacy["result_conversion"] == "legacy_attributes"
    for measured in (eager, legacy):
        assert measured["wall_ns"]["summary"]["n"] == 2
        assert measured["decision_us"]["summary"]["n"] == 2
        assert measured["kernel_ns"]["summary"]["n"] == 2
