"""The startup self-measure of the compiled decision core.

The core histogram otherwise holds only submitted orders and empties on every
restart, so the desk read "no orders yet" after each deploy with the
nanosecond figure nowhere in sight. ``RiskGateway.run_core_self_measure``
times the same compiled battery on a synthetic two-venue book once at
startup and records it through ``observe_core_self_test_latency``.

What these tests hold the line on is *which plane* the samples land in: the
core (ns) histogram, counted separately as self-measure samples — never the
decision (µs) histogram, whose ``samples`` must keep meaning submitted orders.
A self-measure that leaked into the µs plane would pass every type check and
put a flattering number under the wrong label; that is the defect to catch.
"""

from __future__ import annotations

import importlib
import importlib.util
from pathlib import Path

import pytest

from modules import metrics
from modules.operations import _decision_latency_snapshot
from modules.risk_proxy import RiskGateway

SETUP = Path(__file__).resolve().parent.parent / "native" / "decision_core" / "setup.py"


@pytest.fixture(autouse=True)
def _clean_histograms():
    metrics.reset_decision_latency()
    yield
    metrics.reset_decision_latency()


def _native_gateway(monkeypatch) -> RiskGateway:
    """A gateway pinned to the built extension, whatever DECISION_CORE says.

    Mirrors ``test_decision_core_native._force_native``: the .so must be built
    (a hard failure, never a skip — a broken build has to turn CI red), and the
    engine is pinned so a ``DECISION_CORE=python`` run still exercises the
    self-measure rather than quietly testing the no-op.
    """
    try:
        module = importlib.import_module("modules._decision_core")
    except ImportError:
        pytest.fail(
            "modules._decision_core is not built — build it with: "
            "python native/decision_core/setup.py build_ext --inplace --build-temp build/native"
        )
    monkeypatch.setattr(RiskGateway, "_resolve_decision_core", staticmethod(lambda: module))
    return RiskGateway(audit=None)


def _gateway() -> RiskGateway:
    return RiskGateway(audit=None)


def _build_setup_module():
    """Load the build recipe so timing policy follows the artifact, not env."""
    spec = importlib.util.spec_from_file_location("decision_core_self_measure_build_setup", SETUP)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_self_measure_fills_the_core_histogram_and_never_the_decision_one(monkeypatch):
    gateway = _native_gateway(monkeypatch)
    recorded = gateway.run_core_self_measure()

    assert recorded == RiskGateway._SELF_MEASURE_SAMPLES
    core = metrics.core_latency_summary()
    assert core["samples"] == recorded
    assert core["self_test_samples"] == recorded, "the self-measure count is published beside the total"
    assert 0 < core["p50"] <= core["p99"] <= core["max"]
    # A real production-compiled battery on a two-venue book, not an empty
    # call: the deploy figure must be sub-microsecond but non-trivial. ASan and
    # UBSan deliberately replace O3 with O1, redzones and runtime checks, so
    # their timing is not a production measurement. Identify the artifact by
    # its source/flags build id rather than trusting a mutable process env.
    build_setup = _build_setup_module()
    build_id = gateway._decision_core.BUILD_ID
    production_build_id = build_setup._build_id(None)
    sanitizer_build_ids = {
        build_setup._build_id("1"),
        build_setup._build_id("undefined"),
    }
    if build_id == production_build_id:
        assert core["p99"] < 1_000, core
    else:
        assert build_id in sanitizer_build_ids, f"unrecognised instrumented build: {build_id}"

    decision = metrics.decision_latency_summary()
    assert decision["samples"] == 0, "the µs plane is the whole submit() under its lock; nothing synthetic may enter it"


def test_self_measure_touches_no_order_state(monkeypatch):
    gateway = _native_gateway(monkeypatch)
    before = (gateway.orders_accepted, gateway.orders_rejected, len(gateway.working), gateway.bucket.tokens)
    gateway.run_core_self_measure()
    after = (gateway.orders_accepted, gateway.orders_rejected, len(gateway.working), gateway.bucket.tokens)
    assert before == after


def test_snapshot_publishes_the_core_figure_with_its_provenance_before_any_order(monkeypatch):
    gateway = _native_gateway(monkeypatch)
    gateway.run_core_self_measure()
    snap = _decision_latency_snapshot(gateway)

    # `engine` reports the loader's choice (which DECISION_CORE=python may have
    # set to "python" for the process); the core figure is what this test owns.
    assert snap.samples == 0
    assert snap.p50_us is None and snap.p99_us is None and snap.max_us is None
    assert snap.core_p99_ns is not None and snap.core_p99_ns > 0
    assert snap.core_self_test_samples == RiskGateway._SELF_MEASURE_SAMPLES

    rendered = metrics.render_metrics()
    assert "decision_core_self_test_samples" in rendered
    assert "decision_core_latency_ns" in rendered


def test_self_measure_is_a_silent_no_op_without_a_core(monkeypatch):
    gateway = _gateway()
    monkeypatch.setattr(gateway, "_decision_core", None)
    assert gateway.run_core_self_measure() == 0
    core = metrics.core_latency_summary()
    assert core["samples"] == 0 and core["self_test_samples"] == 0
    snap = _decision_latency_snapshot(gateway)
    assert snap.core_p99_ns is None
    assert snap.core_self_test_samples is None, "no core histogram at all is null, not zero"


def test_self_measure_never_raises_and_leaves_the_histogram_untouched_on_failure(monkeypatch):
    gateway = _gateway()

    class Broken:
        class BookLadder:  # noqa: D106 - test double
            def snapshot(self, *_a, **_k):
                raise RuntimeError("synthetic failure")

        def decide(self, **_k):  # pragma: no cover - never reached
            raise AssertionError("must not get here")

    monkeypatch.setattr(gateway, "_decision_core", Broken())
    assert gateway.run_core_self_measure() == 0
    assert metrics.core_latency_summary()["samples"] == 0
    assert metrics.decision_latency_summary()["samples"] == 0
    status = gateway.decision_core_status()
    assert status["effective"] == "python"
    assert status["fallback_reason"] == "native_self_measure_failed"
    assert status["fallback_counts"] == {"native_self_measure_failed": 1}


def test_wrong_native_probe_fails_the_known_answer_canary_and_readiness(monkeypatch):
    """A callable, correctly shaped core cannot become ready with wrong numbers."""
    from main import _measure_decision_core_readiness

    gateway = _native_gateway(monkeypatch)
    native = gateway._decision_core

    class WrongResult:
        elapsed_ns = 84
        mark = 101.0  # planted defect: the fixed synthetic book's mark is 100.0
        has_price = True
        qty = 100.0
        notional = 10_000.0
        projected_sym = 10_050.0
        projected_gross = 10_050.0
        dev_bps = 0.0
        dd = 0.0
        reduce_only_active = False
        reducing = False
        budget_used = 0.0
        route_ran = True
        route_none = False
        route_fillable = True
        route_filled_notional = 10_000.0
        route_has_slip = True
        route_slippage_bps = 1.0
        route_venue_order = [0]

    class WrongCore:
        BookLadder = native.BookLadder

        @staticmethod
        def decide(**_kwargs):
            return WrongResult()

    gateway._decision_core = WrongCore()
    reasons: list[str] = []
    runtime = type("Runtime", (), {"mark_unready": reasons.append})()

    assert _measure_decision_core_readiness(gateway, runtime) == 0
    assert metrics.core_latency_summary()["samples"] == 0
    status = gateway.decision_core_status()
    assert status["effective"] == "python"
    assert status["fallback_reason"] == "native_self_measure_failed"
    assert status["fallback_total"] == 1
    assert status["fallback_counts"] == {"native_self_measure_failed": 1}
    assert reasons == ["native decision core self-measure failed"]
