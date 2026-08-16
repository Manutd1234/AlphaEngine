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

log = logging.getLogger("alphaengine.decision_core")

REQUESTED = os.getenv("DECISION_CORE", os.getenv("ALPHAENGINE_DECISION_CORE", "auto")).strip().lower()
if REQUESTED not in {"auto", "native", "python"}:
    raise RuntimeError(f"DECISION_CORE must be auto|native|python, got {REQUESTED!r}")

_native: ModuleType | None = None
IMPORT_ERROR: Exception | None = None
if REQUESTED != "python":
    try:
        from modules import _decision_core as _native_module  # type: ignore[attr-defined]

        _native = _native_module
    except ImportError as exc:  # the .so is not built for this platform / venv
        IMPORT_ERROR = exc

ENGINE: str = "native" if (_native is not None and REQUESTED != "python") else "python"

if REQUESTED == "native" and _native is None:
    raise RuntimeError(f"DECISION_CORE=native but the core failed to import: {IMPORT_ERROR}")

if REQUESTED == "auto" and _native is None:
    log.warning("decision core: native engine not importable (%s); running the Python reference", IMPORT_ERROR)


def native() -> ModuleType | None:
    """The native module when it is the active engine, else None."""
    return _native if ENGINE == "native" else None
