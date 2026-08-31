"""Which engine evaluates the pre-trade decision.

Two implementations of the same seventeen gates: the Python reference in
``risk_proxy.py`` and, when it has been built, a native core
(``modules/_decision_core``) that owns the book ladders and the arithmetic.
Python is the reference — the parity fixture in ``tools/make_gate_fixture.py``
pins both to identical decisions — and this module decides which one runs.

``DECISION_CORE`` = ``auto`` (native if importable, else Python), ``native``
(refuse to start without it — the setting for a deploy that must not degrade
quietly), or ``python`` (the reference, always available). The choice is
published on ``/health``, ``/metrics`` and the ops snapshot so a build that
fell back is visible on the desk rather than only in a log line.
"""

from __future__ import annotations

import logging
import os
from types import ModuleType
from typing import Any

log = logging.getLogger("alphaengine.decision_core")

EXPECTED_ABI_VERSION = 1
EXPECTED_CAPABILITY_VERSION = 1
REQUIRED_CAPABILITIES = (
    "bit_exact_ieee754_v1",
    "persistent_book_ladder_v1",
    "position_book_mirror_v1",
    "routed_slippage_v1",
    "steady_clock_telemetry_v1",
    "roundtrip_probe_v1",
)
REQUIRED_NATIVE_SYMBOLS = (
    "decide",
    "BookLadder",
    "PositionBook",
    "clock_tick_ns",
    "clock_floor_ns",
    "roundtrip_probe",
)
EXPECTED_DECIDE_ARGUMENTS = (
    "side_is_buy",
    "order_type_is_limit",
    "order_quantity",
    "order_notional",
    "limit_price",
    "is_paper",
    "paper_price",
    "order_books",
    "pos_quantities",
    "pos_avg_prices",
    "pos_realized",
    "pos_marks",
    "pos_is_order_symbol",
    "working_buys",
    "working_sells",
    "starting_equity",
    "carried_realized_pnl",
    "start_of_day_equity",
    "max_order_notional_usd",
    "max_symbol_notional_usd",
    "max_gross_exposure_usd",
    "max_price_deviation_bps",
    "max_daily_drawdown_pct",
    "reduce_only_threshold",
    "reduce_only_override",
    "route_enabled",
    "position_book",
    "order_symbol",
)


class NativeContractError(RuntimeError):
    """A loaded extension does not implement this wrapper's exact ABI."""

    def __init__(self, reason: str, detail: str) -> None:
        self.reason = reason
        super().__init__(detail)


def validate_native_contract(module: Any) -> None:
    """Refuse a stale or partially copied extension before it sees an order."""
    required = (
        "ABI_VERSION",
        "DECIDE_ARGUMENT_COUNT",
        "DECIDE_ARGUMENTS",
        "BUILD_ID",
        "CAPABILITY_VERSION",
        "CAPABILITIES",
    )
    missing = tuple(name for name in required if not hasattr(module, name))
    if missing:
        raise NativeContractError(
            "native_contract_missing",
            f"native decision core is missing contract metadata: {', '.join(missing)}",
        )
    if module.ABI_VERSION != EXPECTED_ABI_VERSION:
        raise NativeContractError(
            "native_abi_mismatch",
            f"native decision core ABI {module.ABI_VERSION!r}; expected {EXPECTED_ABI_VERSION}",
        )
    arguments = tuple(module.DECIDE_ARGUMENTS)
    if module.DECIDE_ARGUMENT_COUNT != len(arguments) or arguments != EXPECTED_DECIDE_ARGUMENTS:
        raise NativeContractError(
            "native_argument_contract_mismatch",
            "native decide() argument contract differs from the wrapper's ordered 28-argument ABI",
        )
    if module.CAPABILITY_VERSION != EXPECTED_CAPABILITY_VERSION:
        raise NativeContractError(
            "native_capability_version_mismatch",
            "native decision core capability schema "
            f"{module.CAPABILITY_VERSION!r}; expected {EXPECTED_CAPABILITY_VERSION}",
        )
    capabilities = frozenset(module.CAPABILITIES)
    missing_capabilities = tuple(name for name in REQUIRED_CAPABILITIES if name not in capabilities)
    if missing_capabilities:
        raise NativeContractError(
            "native_capability_mismatch",
            f"native decision core is missing capabilities: {', '.join(missing_capabilities)}",
        )
    missing_symbols = tuple(
        name for name in REQUIRED_NATIVE_SYMBOLS if not callable(getattr(module, name, None))
    )
    if missing_symbols:
        raise NativeContractError(
            "native_symbol_contract_mismatch",
            f"native decision core is missing executable symbols: {', '.join(missing_symbols)}",
        )


REQUESTED = os.getenv("DECISION_CORE", os.getenv("ALPHAENGINE_DECISION_CORE", "auto")).strip().lower()
if REQUESTED not in {"auto", "native", "python"}:
    raise RuntimeError(f"DECISION_CORE must be auto|native|python, got {REQUESTED!r}")

_native: ModuleType | None = None
IMPORT_ERROR: Exception | None = None
FALLBACK_REASON: str | None = None
if REQUESTED != "python":
    try:
        from modules import _decision_core as _native_module  # type: ignore[attr-defined]

        validate_native_contract(_native_module)
        _native = _native_module
    except ImportError as exc:  # the .so is not built for this platform / venv
        IMPORT_ERROR = exc
        FALLBACK_REASON = "native_import_error"
    except NativeContractError as exc:
        IMPORT_ERROR = exc
        FALLBACK_REASON = exc.reason

ENGINE: str = "native" if (_native is not None and REQUESTED != "python") else "python"

if REQUESTED == "native" and _native is None:
    raise RuntimeError(f"DECISION_CORE=native but the core is unavailable ({FALLBACK_REASON}): {IMPORT_ERROR}")

if REQUESTED == "auto" and _native is None:
    log.warning("decision core: native engine not importable (%s); running the Python reference", IMPORT_ERROR)


def native() -> ModuleType | None:
    """The native module when it is the active engine, else None."""
    return _native if ENGINE == "native" else None


def snapshot() -> dict[str, Any]:
    """Stable, non-secret identity for health, metrics and operations views."""
    return {
        "configured": REQUESTED,
        "selected": ENGINE,
        "effective": ENGINE,
        "fallback_reason": FALLBACK_REASON,
        "fallback_total": 0,
        "fallback_counts": {},
        "abi_version": getattr(_native, "ABI_VERSION", None),
        "capability_version": getattr(_native, "CAPABILITY_VERSION", None),
        "capabilities": tuple(getattr(_native, "CAPABILITIES", ())) or None,
        "build_id": getattr(_native, "BUILD_ID", None),
        "compiler": getattr(_native, "COMPILER", None),
        "pybind11_version": getattr(_native, "PYBIND11_VERSION", None),
        "decide_argument_count": getattr(_native, "DECIDE_ARGUMENT_COUNT", None),
    }
