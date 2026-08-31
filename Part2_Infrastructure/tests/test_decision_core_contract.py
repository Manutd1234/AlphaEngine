"""The native boundary identifies itself and never degrades silently.

Parity tests prove that C++ and Python return the same money-path numbers. This
suite protects the seam around those numbers: the 28 positional arguments the
wrapper and extension must agree on, the build loaded into this interpreter,
and the reason an individual order used Python after native was selected.
"""

from __future__ import annotations

import asyncio
import gc
import importlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from modules import decision_core
from modules.risk_proxy import RiskGateway
from modules.schemas import OrderRequest
from tools.gate_fixture import build_gateway, expected_from

FIXTURE = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "gate-parity.json"
SCENARIO = json.loads(FIXTURE.read_text())["scenarios"]["happy_market"]
SETUP = Path(__file__).resolve().parent.parent / "native" / "decision_core" / "setup.py"


def _contract_metadata(**overrides):
    values = {
        "ABI_VERSION": decision_core.EXPECTED_ABI_VERSION,
        "BUILD_ID": f"alphaengine-decision-core/abi-{decision_core.EXPECTED_ABI_VERSION}",
        "DECIDE_ARGUMENT_COUNT": len(decision_core.EXPECTED_DECIDE_ARGUMENTS),
        "DECIDE_ARGUMENTS": decision_core.EXPECTED_DECIDE_ARGUMENTS,
        "CAPABILITY_VERSION": decision_core.EXPECTED_CAPABILITY_VERSION,
        "CAPABILITIES": decision_core.REQUIRED_CAPABILITIES,
        **{name: lambda: None for name in decision_core.REQUIRED_NATIVE_SYMBOLS},
    }
    values.update(overrides)
    return values


def _native():
    try:
        return importlib.import_module("modules._decision_core")
    except ImportError:
        if decision_core.REQUESTED == "python":
            pytest.skip("DECISION_CORE=python explicitly opts out of the native build")
        pytest.fail(
            "modules._decision_core is not built — build it with: "
            "python native/decision_core/setup.py build_ext --inplace --build-temp build/native"
        )


def _build_setup_module():
    spec = importlib.util.spec_from_file_location("decision_core_build_setup", SETUP)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_normal_build_keeps_the_production_optimisation_contract() -> None:
    compile_args, link_args = _build_setup_module()._build_flags(None)

    assert compile_args == ["-O3", "-ffp-contract=off", "-fvisibility=hidden"]
    assert link_args == []


def test_the_opt_in_sanitizer_build_is_strict_and_never_fast_math() -> None:
    compile_args, link_args = _build_setup_module()._build_flags("1")

    assert "-O1" in compile_args and "-O3" not in compile_args
    assert "-g" in compile_args and "-fno-omit-frame-pointer" in compile_args
    assert "-fsanitize=address,undefined" in compile_args
    assert "-fno-sanitize-recover=all" in compile_args
    assert {"-Wall", "-Wextra", "-Wpedantic", "-Werror"} <= set(compile_args)
    assert "-ffp-contract=off" in compile_args
    assert not any("fast-math" in flag or "march=native" in flag for flag in compile_args)
    assert link_args == ["-fsanitize=address,undefined", "-fno-sanitize-recover=all"]


def test_the_ubsan_only_fallback_keeps_the_same_fail_closed_contract() -> None:
    compile_args, link_args = _build_setup_module()._build_flags("undefined")

    assert "-O1" in compile_args and "-O3" not in compile_args
    assert "-fsanitize=undefined" in compile_args
    assert "-fno-sanitize-recover=all" in compile_args
    assert "-ffp-contract=off" in compile_args
    assert not any("fast-math" in flag or "march=native" in flag for flag in compile_args)
    assert link_args == ["-fsanitize=undefined", "-fno-sanitize-recover=all"]


def test_an_unknown_native_build_mode_is_refused() -> None:
    with pytest.raises(RuntimeError, match="ALPHAENGINE_NATIVE_SANITIZERS"):
        _build_setup_module()._build_flags("address")


def test_forced_native_rejects_a_planted_26_argument_module_at_import() -> None:
    script = """
import importlib
import modules
import sys
import types

fake = types.ModuleType("modules._decision_core")
fake.ABI_VERSION = 1
fake.BUILD_ID = "planted-26-argument-build"
fake.DECIDE_ARGUMENT_COUNT = 26
fake.DECIDE_ARGUMENTS = tuple(f"arg_{index}" for index in range(26))
fake.CAPABILITY_VERSION = 1
fake.CAPABILITIES = (
    "bit_exact_ieee754_v1",
    "persistent_book_ladder_v1",
    "position_book_mirror_v1",
    "routed_slippage_v1",
    "steady_clock_telemetry_v1",
    "roundtrip_probe_v1",
)
sys.modules["modules._decision_core"] = fake
setattr(modules, "_decision_core", fake)

try:
    importlib.import_module("modules.decision_core")
except RuntimeError as exc:
    assert "native_argument_contract_mismatch" in str(exc), str(exc)
    print("FORCED_NATIVE_REJECTED")
else:
    raise AssertionError("forced-native loader accepted a planted 26-argument module")
"""
    environment = {**os.environ, "DECISION_CORE": "native"}
    run = subprocess.run(  # noqa: S603 - fixed interpreter and committed test program
        [sys.executable, "-c", script],
        cwd=SETUP.parents[2],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == "FORCED_NATIVE_REJECTED"


def test_the_loaded_build_identifies_the_exact_28_argument_contract() -> None:
    core = _native()
    build_setup = _build_setup_module()

    assert core.ABI_VERSION == decision_core.EXPECTED_ABI_VERSION
    assert core.DECIDE_ARGUMENT_COUNT == 28
    assert tuple(core.DECIDE_ARGUMENTS) == decision_core.EXPECTED_DECIDE_ARGUMENTS
    assert core.DECIDE_ARGUMENT_COUNT == len(core.DECIDE_ARGUMENTS)
    allowed_build_ids = {
        build_setup._build_id(mode) for mode in (None, "1", "undefined")
    }
    assert core.BUILD_ID in allowed_build_ids
    assert "/src-" in core.BUILD_ID and "/flags-" in core.BUILD_ID
    assert len(allowed_build_ids) == 3, "sanitizer modes need distinct provenance"
    assert core.CAPABILITY_VERSION == decision_core.EXPECTED_CAPABILITY_VERSION
    assert tuple(core.CAPABILITIES) == decision_core.REQUIRED_CAPABILITIES
    assert core.COMPILER, "the deployed extension must identify its compiler"
    assert core.PYBIND11_VERSION, "the deployed extension must identify its binding runtime"


def test_the_roundtrip_probe_is_an_identity_not_a_second_numeric_kernel() -> None:
    core = _native()

    assert core.roundtrip_probe(123.456) == 123.456
    assert core.roundtrip_probe(float("inf")) == float("inf")
    negative_zero = core.roundtrip_probe(-0.0)
    assert negative_zero == 0.0
    assert str(negative_zero).startswith("-"), "the probe must preserve the sign bit"


@pytest.mark.parametrize(
    ("module", "reason"),
    [
        (type("Missing", (), {})(), "native_contract_missing"),
        (
            type(
                "OldAbi",
                (),
                _contract_metadata(ABI_VERSION=0, BUILD_ID="alphaengine-decision-core/abi-0"),
            )(),
            "native_abi_mismatch",
        ),
        (
            type(
                "WrongArguments",
                (),
                _contract_metadata(
                    DECIDE_ARGUMENT_COUNT=26,
                    DECIDE_ARGUMENTS=decision_core.EXPECTED_DECIDE_ARGUMENTS[:-2],
                ),
            )(),
            "native_argument_contract_mismatch",
        ),
        (
            type(
                "OldCapabilities",
                (),
                _contract_metadata(CAPABILITY_VERSION=0),
            )(),
            "native_capability_version_mismatch",
        ),
        (
            type(
                "MissingCapability",
                (),
                _contract_metadata(CAPABILITIES=decision_core.REQUIRED_CAPABILITIES[:-1]),
            )(),
            "native_capability_mismatch",
        ),
    ],
)
def test_stale_extensions_are_rejected_with_stable_reason_codes(module, reason) -> None:
    with pytest.raises(decision_core.NativeContractError) as raised:
        decision_core.validate_native_contract(module)
    assert raised.value.reason == reason


def test_capability_metadata_without_its_executable_symbols_is_rejected() -> None:
    module = type(
        "MetadataOnly",
        (),
        _contract_metadata(**{name: None for name in decision_core.REQUIRED_NATIVE_SYMBOLS}),
    )()
    with pytest.raises(decision_core.NativeContractError) as raised:
        decision_core.validate_native_contract(module)
    assert raised.value.reason == "native_symbol_contract_mismatch"


def test_python_is_an_explicit_rollback_even_with_an_incompatible_binary() -> None:
    script = """
import importlib
import modules
import sys
import types

fake = types.ModuleType("modules._decision_core")
fake.ABI_VERSION = -1
sys.modules["modules._decision_core"] = fake
setattr(modules, "_decision_core", fake)

loader = importlib.import_module("modules.decision_core")
assert loader.REQUESTED == "python"
assert loader.ENGINE == "python"
assert loader.native() is None
assert loader.snapshot()["fallback_reason"] is None
print("PYTHON_ROLLBACK_SELECTED")
"""
    environment = {**os.environ, "DECISION_CORE": "python"}
    run = subprocess.run(  # noqa: S603 - fixed interpreter and committed test program
        [sys.executable, "-c", script],
        cwd=SETUP.parents[2],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == "PYTHON_ROLLBACK_SELECTED"


def test_an_injected_native_failure_falls_back_exactly_and_is_observable(monkeypatch) -> None:
    native = _native()
    monkeypatch.setattr(RiskGateway, "_resolve_decision_core", staticmethod(lambda: native))
    gateway = build_gateway(SCENARIO, monkeypatch)
    selected = gateway._decision_core

    class BrokenCore:
        @staticmethod
        def decide(*_args, **_kwargs):
            raise RuntimeError("injected native failure")

    gateway._decision_core = BrokenCore()
    decision = asyncio.run(gateway.submit(OrderRequest(**SCENARIO["order"]), source="fixture"))

    assert expected_from(decision) == SCENARIO["expected"], "fallback changed a money-path output"
    status = gateway.decision_core_status()
    assert status["configured"] in {"auto", "native", "python"}
    assert status["selected"] == "native"
    assert status["effective"] == "python"
    assert status["fallback_reason"] == "native_exception"
    assert status["fallback_total"] == 1
    assert status["fallback_counts"] == {"native_exception": 1}
    assert status["capability_version"] == decision_core.EXPECTED_CAPABILITY_VERSION
    assert tuple(status["capabilities"]) == decision_core.REQUIRED_CAPABILITIES
    assert gateway.last_decision_core_ns is None, "a failed call must not leave stale native timing"

    import modules.risk_proxy as risk_proxy
    from modules import metrics, operations
    from modules.api import meta

    monkeypatch.setattr(risk_proxy, "get_gateway", lambda: gateway)
    rendered = metrics.render_metrics()
    assert 'alphaengine_decision_engine_configured{engine="' in rendered
    assert 'alphaengine_decision_engine_effective{engine="python"} 1' in rendered
    assert 'alphaengine_decision_core_fallback{reason="native_exception"} 1' in rendered
    assert "alphaengine_decision_core_fallbacks_total 1" in rendered
    assert 'alphaengine_decision_core_fallbacks_by_reason_total{reason="native_exception"} 1' in rendered
    monkeypatch.setattr(meta, "get_gateway", lambda: gateway)
    health = asyncio.run(meta.health())["modules"]["B_risk"]
    assert health["decision_engine_effective"] == "python"
    assert health["decision_engine_fallback_reason"] == "native_exception"
    assert health["decision_engine_fallback_total"] == 1
    assert health["decision_engine_fallback_counts"] == {"native_exception": 1}
    assert health["decision_core_abi_version"] == decision_core.EXPECTED_ABI_VERSION
    assert operations._decision_latency_snapshot(gateway).engine == "python"

    gateway._decision_core = selected
    asyncio.run(gateway.submit(OrderRequest(**SCENARIO["order"]), source="fixture"))
    recovered = gateway.decision_core_status()
    assert recovered["effective"] == "native"
    assert recovered["fallback_reason"] is None
    assert recovered["fallback_total"] == 1, "recovery must not erase the incident counter"
    assert recovered["fallback_counts"] == {"native_exception": 1}
    assert gateway.last_decision_core_ns is not None


def test_a_position_book_owns_replaced_ladders_for_the_whole_decision_lifetime() -> None:
    core = _native()
    book = core.PositionBook()
    book.upsert("BTCUSDT", 1.0, 100.0, 0.0)

    for offset in range(32):
        ladder = core.BookLadder()
        mid = 100.0 + offset * 0.01
        ladder.snapshot([(mid - 0.01, 10.0)], [(mid + 0.01, 10.0)])
        book.set_books("BTCUSDT", [ladder])
    del ladder
    gc.collect()

    order_ladder = core.BookLadder()
    order_ladder.snapshot([(99.99, 10.0)], [(100.01, 10.0)])
    result = core.decide(
        True,
        False,
        None,
        1000.0,
        None,
        False,
        None,
        [order_ladder],
        [],
        [],
        [],
        [],
        [],
        0.0,
        0.0,
        1_000_000.0,
        0.0,
        1_000_000.0,
        250_000.0,
        500_000.0,
        2_000_000.0,
        500.0,
        0.05,
        0.80,
        False,
        True,
        book,
        "BTCUSDT",
    )
    assert result.projected_gross > 0.0
