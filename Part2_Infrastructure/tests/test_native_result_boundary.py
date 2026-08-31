"""Native results cross the pybind boundary atomically or fall back exactly."""

from __future__ import annotations

import asyncio
import importlib
import json
from pathlib import Path

import pytest

from modules.risk_proxy import RiskGateway
from modules.risk_proxy.native_result import NativeDecisionResult
from modules.schemas import OrderRequest
from tools.gate_fixture import build_gateway, expected_from

FIXTURE = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "gate-parity.json"
SCENARIO = json.loads(FIXTURE.read_text())["scenarios"]["happy_market"]


def _native():
    try:
        return importlib.import_module("modules._decision_core")
    except ImportError:
        pytest.fail(
            "modules._decision_core is not built — run the native setup.py build_ext command"
        )


def test_native_result_materializes_every_field_in_one_eager_conversion() -> None:
    core = _native()
    ladder = core.BookLadder()
    ladder.snapshot([(99.99, 100.0)], [(100.01, 100.0)])
    raw = core.decide(
        True, False, None, 1_000.0, None, False, None, [ladder],
        [], [], [], [], [], 0.0, 0.0, 100_000.0, 0.0, 100_000.0,
        1_000_000.0, 1_000_000.0, 10_000_000.0, 100.0, 0.1, 0.8,
        False, True, None, "BTCUSDT",
    )

    materialized = NativeDecisionResult.materialize(raw, native_result_type=core.CoreResult)
    assert materialized == NativeDecisionResult(
        raw.elapsed_ns,
        raw.mark,
        raw.has_price,
        raw.qty,
        raw.notional,
        raw.projected_sym,
        raw.projected_gross,
        raw.dev_bps,
        raw.dd,
        raw.reduce_only_active,
        raw.reducing,
        raw.budget_used,
        raw.route_ran,
        raw.route_none,
        raw.route_fillable,
        raw.route_filled_notional,
        raw.route_has_slip,
        raw.route_slippage_bps,
        tuple(raw.route_venue_order),
    )
    with pytest.raises(ValueError, match="venue index is out of range"):
        raw.materialize_tuple(0)


def test_native_result_conversion_fault_falls_back_before_success_is_recorded(monkeypatch) -> None:
    native = _native()
    monkeypatch.setattr(RiskGateway, "_resolve_decision_core", staticmethod(lambda: native))
    gateway = build_gateway(SCENARIO, monkeypatch)

    class BrokenResult:
        elapsed_ns = 1

        @property
        def mark(self):
            raise RuntimeError("injected result accessor failure")

    class ConversionBrokenCore:
        @staticmethod
        def decide(*_args, **_kwargs):
            return BrokenResult()

    gateway._decision_core = ConversionBrokenCore()
    decision = asyncio.run(gateway.submit(OrderRequest(**SCENARIO["order"]), source="fixture"))

    assert expected_from(decision) == SCENARIO["expected"]
    status = gateway.decision_core_status()
    assert status["effective"] == "python"
    assert status["fallback_reason"] == "native_result_conversion"
    assert status["fallback_counts"] == {"native_result_conversion": 1}
    assert gateway.last_decision_core_ns is None


@pytest.mark.parametrize("invalid_order", ([999], [-1], [0, 0], []))
def test_invalid_native_route_topology_falls_back_before_route_rendering(monkeypatch, invalid_order) -> None:
    native = _native()
    monkeypatch.setattr(RiskGateway, "_resolve_decision_core", staticmethod(lambda: native))
    gateway = build_gateway(SCENARIO, monkeypatch)

    class InvalidRouteResult:
        materialize_tuple = None

        def __init__(self, result):
            self._result = result

        def __getattr__(self, name):
            return invalid_order if name == "route_venue_order" else getattr(self._result, name)

    class InvalidRouteCore:
        @staticmethod
        def decide(*args, **kwargs):
            return InvalidRouteResult(native.decide(*args, **kwargs))

    gateway._decision_core = InvalidRouteCore()
    decision = asyncio.run(gateway.submit(OrderRequest(**SCENARIO["order"]), source="fixture"))

    assert expected_from(decision) == SCENARIO["expected"]
    status = gateway.decision_core_status()
    assert status["effective"] == "python"
    assert status["fallback_reason"] == "native_result_conversion"
    assert status["fallback_counts"] == {"native_result_conversion": 1}
    assert gateway.last_decision_core_ns is None
