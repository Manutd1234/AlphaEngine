"""Which model engine is available, and what to say when one is not.

Two engines, the same contract as ``modules/decision_core.py`` uses for the
compiled core:

* ``numpy``   — the hand-rolled ridge and logistic in ``models.py``. Always
  present, because they are written here.
* ``sklearn`` — the optional extra from ``requirements-ml.txt``, for model
  families that do not solve in closed form.

``ML_ENGINE`` = ``auto`` (sklearn if importable, else numpy), ``sklearn``
(refuse to start without it — the setting for a deploy that must not degrade
quietly), or ``numpy`` (the hand-rolled path, always available).

The important rule, and the reason this module exists rather than a bare
try/import at the call site: **a run that fell back is a different run.** It is
recorded on ``ml_runs.engine``, reported on the health payload, and named in
the strategy's unavailability message. CLAUDE.md records what a silent skip
already cost this project once; a silently substituted solver would be the same
mistake with better numbers.
"""

from __future__ import annotations

import logging
import os
from types import ModuleType

log = logging.getLogger("alphaengine.ml")

REQUESTED = os.getenv("ML_ENGINE", "auto").strip().lower()
if REQUESTED not in {"auto", "sklearn", "numpy"}:
    raise RuntimeError(f"ML_ENGINE must be auto|sklearn|numpy, got {REQUESTED!r}")

_sklearn: ModuleType | None = None
IMPORT_ERROR: Exception | None = None
if REQUESTED != "numpy":
    try:
        import sklearn as _sklearn_module

        _sklearn = _sklearn_module
    except ImportError as exc:  # the extra is not installed in this environment
        IMPORT_ERROR = exc

ENGINE: str = "sklearn" if (_sklearn is not None and REQUESTED != "numpy") else "numpy"

if REQUESTED == "sklearn" and _sklearn is None:
    raise RuntimeError(f"ML_ENGINE=sklearn but scikit-learn failed to import: {IMPORT_ERROR}")

if REQUESTED == "auto" and _sklearn is None:
    log.info(
        "ml engine: scikit-learn not importable (%s); the hand-rolled models are running",
        IMPORT_ERROR,
    )


def sklearn() -> ModuleType | None:
    """The scikit-learn module when it is the active engine, else None."""
    return _sklearn if ENGINE == "sklearn" else None


def unavailable_reason(model: str) -> str | None:
    """Why ``model`` cannot run here, or None when it can.

    Returns a sentence a reader can act on rather than a boolean. "Unavailable"
    with no reason is the shape of message that gets ignored until someone
    discovers the desk has been quietly running a different model for a month.
    """
    if model in {"ridge", "logistic"}:
        return None  # hand-rolled, always here
    if ENGINE == "sklearn":
        return None
    detail = f" ({IMPORT_ERROR})" if IMPORT_ERROR else ""
    return (
        f"{model} needs the optional scikit-learn extra, which is not installed"
        f"{detail}. Run `pip install -r requirements-ml.txt`, or use ridge or "
        f"logistic, which are built in."
    )


def snapshot() -> dict[str, object]:
    """What /health and the Developer tab publish about the ML engine."""
    return {
        "engine": ENGINE,
        "requested": REQUESTED,
        "sklearn_available": _sklearn is not None,
        "import_error": str(IMPORT_ERROR) if IMPORT_ERROR else None,
        "builtin_models": ["ridge", "logistic"],
    }
