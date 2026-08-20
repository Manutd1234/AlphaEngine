"""Which model engine is available, and what to say when one is not.

Two engines, the same contract as ``modules/decision_core.py`` uses for the
compiled core:

* ``numpy``   — the hand-rolled ridge and logistic in ``models.py``. Always
  present, because they are written here.
* ``sklearn`` — the optional extra from ``requirements-ml.txt``, for model
  families that do not solve in closed form.

``ML_ENGINE`` = ``auto`` (sklearn if importable, else numpy), ``sklearn``
(refuse to start without it — the setting for a deploy that must not degrade
quietly), or ``numpy`` (the hand-rolled path, always available). It is the
DEPLOYMENT default; an individual fit may override it, and
``sklearn_adapter.resolve_engine`` is where that happens.

The important rule, and the reason this module exists rather than a bare
try/import at the call site: **a run that fell back is a different run.** It is
recorded on ``ml_runs.engine``, reported on the health payload, and named in
the strategy's unavailability message. CLAUDE.md records what a silent skip
already cost this project once; a silently substituted solver would be the same
mistake with better numbers.

Nothing here imports scikit-learn
---------------------------------

``main.py`` imports ``modules.ml.fit`` at boot, which reaches this module, so a
module-scope ``import sklearn`` would put scipy on the gateway's start-up path
and would turn a broken extra into a boot failure on a deployment that never
intended to fit anything. :func:`sklearn_installed` answers with ``find_spec``,
which locates the package without executing it.

That answer is about PRESENCE, and presence is not importability — an extra
built against a different NumPy ABI satisfies ``find_spec`` and still raises.
``sklearn_adapter.import_sklearn`` is the authority, because it is the code
that actually imports, and the error it caught is the reason the run reports.
"""

from __future__ import annotations

import importlib.util
import logging
import os

log = logging.getLogger("alphaengine.ml")

REQUESTED = os.getenv("ML_ENGINE", "auto").strip().lower()
if REQUESTED not in {"auto", "sklearn", "numpy"}:
    raise RuntimeError(f"ML_ENGINE must be auto|sklearn|numpy, got {REQUESTED!r}")


def sklearn_installed() -> bool:
    """Whether scikit-learn is on the path, WITHOUT importing it.

    ``find_spec`` walks the finders and stops at the spec; it never runs the
    package's ``__init__``. A missing package returns None, and a namespace
    package or a broken parent raises, which is the same answer for our
    purposes: not usable from here.
    """
    try:
        return importlib.util.find_spec("sklearn") is not None
    except (ImportError, ValueError):
        return False


INSTALLED: bool = sklearn_installed()

#: Why scikit-learn is not in play, or None. At import time this can only ever
#: be the absence itself — the real import error, if the package is present and
#: unusable, is discovered by ``sklearn_adapter.import_sklearn`` and travels
#: with the run that asked, not with the process.
IMPORT_ERROR: str | None = None if INSTALLED else "scikit-learn is not installed"

#: The process-wide default engine. NOT the engine of any particular run — that
#: is resolved per fit and recorded on ``ml_runs.engine``.
ENGINE: str = "sklearn" if (INSTALLED and REQUESTED != "numpy") else "numpy"

if REQUESTED == "sklearn" and not INSTALLED:
    raise RuntimeError(
        "ML_ENGINE=sklearn but scikit-learn is not installed. Run "
        "`pip install -r requirements-ml.txt`, or unset ML_ENGINE to let the "
        "hand-rolled models run and be recorded as such."
    )

if REQUESTED == "auto" and not INSTALLED:
    log.info("ml engine: scikit-learn is not installed; the hand-rolled models are running")


def sklearn():
    """The scikit-learn linear-model namespace when it is the active engine.

    Imported on call, never at module scope. Returns None when the engine is
    numpy — either because it was asked for or because the extra is absent.
    """
    if ENGINE != "sklearn":
        return None
    from modules.ml.sklearn_adapter import import_sklearn

    namespace, _ = import_sklearn()
    return namespace


def unavailable_reason(model: str) -> str | None:
    """Why ``model`` cannot run here, or None when it can.

    Returns a sentence a reader can act on rather than a boolean. "Unavailable"
    with no reason is the shape of message that gets ignored until someone
    discovers the desk has been quietly running a different model for a month.

    The two cases are told apart on purpose. "Not installed" and "installed but
    not selected" need different actions, and collapsing them sends whoever
    reads it to install a package that is already there.
    """
    if model in {"ridge", "logistic"}:
        return None  # hand-rolled, always here
    if ENGINE == "sklearn":
        return None
    if INSTALLED:
        return (
            f"{model} needs scikit-learn, which IS installed but is not the selected "
            f"engine: ML_ENGINE={REQUESTED} pins this process to the hand-rolled models. "
            f"Unset ML_ENGINE (see requirements-ml.txt), or use ridge or logistic, which "
            f"are built in."
        )
    return (
        f"{model} needs the optional scikit-learn extra, which is not installed "
        f"({IMPORT_ERROR}). Run `pip install -r requirements-ml.txt`, or use ridge or "
        f"logistic, which are built in."
    )


def snapshot() -> dict[str, object]:
    """What /health and the Developer tab publish about the ML engine."""
    return {
        "engine": ENGINE,
        "requested": REQUESTED,
        "sklearn_available": INSTALLED,
        "import_error": IMPORT_ERROR,
        "builtin_models": ["ridge", "logistic"],
    }
