"""The optional scikit-learn adapter, and what it says when it is not there.

``requirements-ml.txt`` is an extra, not a dependency. The gateway's image does
not carry it, so every path through this module has to work with the package
absent — and the interesting question is not whether it works but what it
*says*.

The rule
--------

**Absent must never look like present-and-fine.** A request for scikit-learn on
a box that has none is not a silent fallback. The run still happens, on the
hand-rolled ridge and logistic in ``models.py``, and three things come back
with it: which engine actually ran, which one was asked for, and why they
differ. ``ml_runs.engine`` records the first of those. Its check constraint
allows exactly ``numpy`` and ``sklearn`` because a run that fell back is a
different run and must not be ranked as though it were not.

That is the same doctrine the rest of the desk runs on — a null is never
coerced to zero, an unconfigured store reports ``unavailable`` rather than an
empty list — applied to a solver.

Why the import is deferred
--------------------------

``main.py`` imports ``modules.ml.fit`` at boot, which imports this module. A
module-scope ``import sklearn`` here would therefore drag scipy into every
gateway start, and would turn a broken or absent extra into a boot failure on a
deployment that never intended to fit a model. So the real import lives inside
:func:`import_sklearn`, is attempted on first use, and is cached — including
the failure, so a missing extra costs one failed import per process rather than
one per fold.

``engine.sklearn_installed()`` answers the cheap presence question with
``find_spec``, which never executes the package. Presence is not importability:
a build compiled against the wrong NumPy satisfies ``find_spec`` and still
raises. This module is the authority, because it is the one that actually
imports, and the error it caught is the reason the run reports.

Why the sklearn estimators subclass the hand-rolled ones
--------------------------------------------------------

``MLWalkForward`` decides classifier-versus-regressor with ``isinstance`` and
predicts through ``Fitted``. Subclassing and overriding only ``fit`` means the
walk-forward, the purge, the costing and the deflation are the *same code* on
both engines, so a comparison between them is a comparison of solvers rather
than of two pipelines that happen to share a name. Both return a ``Fitted``
carrying the standardisation used, so the stored artefact has one shape however
it was produced.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from types import ModuleType
from typing import Any

import numpy as np

from modules.ml.engine import REQUESTED as ENGINE_DEFAULT
from modules.ml.models import Fitted, LogisticRegression, Ridge, _standardise

log = logging.getLogger("alphaengine.ml")

#: The engines a caller may ask for. ``auto`` means "scikit-learn if it is
#: importable, otherwise the hand-rolled models" — and says which it got.
ENGINES: frozenset[str] = frozenset({"auto", "numpy", "sklearn"})

#: Models this adapter can put on either engine. Anything else is refused by
#: name rather than quietly routed to a default.
SUPPORTED: tuple[str, ...] = ("ridge", "logistic")

#: Cached probe: (linear_model namespace or None, the error string or None).
#: The failure is cached too — a missing extra should cost one failed import
#: per process, not one per fold.
_PROBE: tuple[ModuleType | None, str | None] | None = None


def import_sklearn() -> tuple[ModuleType | None, str | None]:
    """Import ``sklearn.linear_model``, or report why it could not be.

    This is the only place in the package that imports scikit-learn, and it is
    a function body on purpose — see the module docstring. Returns the
    namespace and ``None``, or ``None`` and a reason string that names the
    exception; never raises, because "the extra is missing" is a fact the
    caller has to report, not an error it has to handle.

    ``Exception`` rather than ``ImportError`` is deliberate. An extra built
    against a different NumPy ABI raises ``ValueError`` from the C layer, and a
    partially installed one can raise almost anything. All of them mean the
    same thing to the caller — this run cannot use scikit-learn — and all of
    them should be reported with the detail rather than escaping as a 500.
    """
    global _PROBE
    if _PROBE is None:
        try:
            from sklearn import linear_model
        except Exception as exc:  # absent, or present and unusable
            _PROBE = (None, f"{type(exc).__name__}: {exc}")
            log.info("ml engine: scikit-learn is not usable here (%s)", _PROBE[1])
        else:
            _PROBE = (linear_model, None)
    return _PROBE


def forget_probe() -> None:
    """Drop the cached probe.

    Exists for tests, which have to exercise both the present and the absent
    path in one interpreter. Production never calls it: the answer cannot
    change while a process is running.
    """
    global _PROBE
    _PROBE = None


@dataclass(frozen=True, slots=True)
class EngineChoice:
    """Which engine is about to run, and why it is not the other one.

    ``engine`` is what will actually fit. ``requested`` is what was asked for.
    They differ only when the extra was unavailable, and ``reason`` says so in
    a sentence rather than leaving the difference to be inferred from two
    fields that a reader has to compare.
    """

    #: What runs: ``numpy`` or ``sklearn``. This is what goes on ``ml_runs``.
    engine: str
    #: What the caller asked for: ``auto``, ``numpy`` or ``sklearn``.
    requested: str
    #: Why ``engine`` is what it is, or None when the answer needs no excuse.
    reason: str | None
    #: The estimator to hand to ``MLWalkForward``.
    estimator: Ridge | LogisticRegression

    @property
    def fell_back(self) -> bool:
        """True when scikit-learn was asked for and did not run."""
        return self.requested == "sklearn" and self.engine != "sklearn"


def resolve_engine(
    model: str,
    params: dict[str, Any] | None = None,
    *,
    requested: str | None = None,
) -> EngineChoice:
    """Pick the engine for one fit and build its estimator.

    ``requested`` defaults to the ``ML_ENGINE`` environment setting, so the
    deployment states a default and an individual call may override it. An
    unknown model or an unknown engine is refused by name here — before any
    bars are fetched — because a request that cannot produce a result should
    not first spend a network round trip.
    """
    params = dict(params or {})
    asked = (requested or ENGINE_DEFAULT or "auto").strip().lower()
    if asked not in ENGINES:
        raise ValueError(f"unknown engine {asked!r}; expected one of {', '.join(sorted(ENGINES))}")
    if model not in SUPPORTED:
        raise ValueError(f"unknown model {model!r}; expected one of {', '.join(SUPPORTED)}")

    if asked == "numpy":
        # Asked for the hand-rolled path and got it. Nothing to explain.
        return EngineChoice("numpy", asked, None, _builtin(model, params))

    namespace, import_error = import_sklearn()
    if namespace is not None:
        return EngineChoice("sklearn", asked, None, _sklearn(namespace, model, params))

    return EngineChoice("numpy", asked, _fallback_reason(model, asked, import_error),
                        _builtin(model, params))


def _fallback_reason(model: str, asked: str, import_error: str | None) -> str:
    """Why this run is on NumPy when scikit-learn was in play.

    Two different facts, said differently. ``auto`` asked for whatever was
    installed and got it — nothing was denied, but the reader still needs to
    know which solver produced the coefficients. ``sklearn`` asked for
    something it did not get, which is the sentence that has to be impossible
    to mistake for success.
    """
    detail = import_error or "scikit-learn is not installed"
    if asked == "auto":
        return (
            f"engine=auto and scikit-learn is not usable here ({detail}), so the "
            f"hand-rolled {model} in modules/ml/models.py fitted this run."
        )
    return (
        f"scikit-learn was requested and is not usable here ({detail}). The run was NOT "
        f"skipped: the hand-rolled {model} in modules/ml/models.py fitted it, and "
        f"ml_runs.engine records 'numpy' rather than the 'sklearn' that was asked for. "
        f"These are different runs and must not be ranked against each other. Install "
        f"the extra with `pip install -r requirements-ml.txt` to fit on scikit-learn."
    )


def _builtin(model: str, params: dict[str, Any]) -> Ridge | LogisticRegression:
    """The hand-rolled estimator. Always available — it is written in this repo."""
    if model == "ridge":
        return Ridge(alpha=float(params.get("alpha", 1.0)))
    return LogisticRegression(
        alpha=float(params.get("alpha", 1.0)),
        max_iter=int(params.get("max_iter", 25)),
    )


def _sklearn(
    namespace: ModuleType, model: str, params: dict[str, Any],
) -> Ridge | LogisticRegression:
    """The scikit-learn estimator, wearing the hand-rolled one's interface."""
    if model == "ridge":
        return SklearnRidge(namespace, alpha=float(params.get("alpha", 1.0)))
    return SklearnLogisticRegression(
        namespace,
        alpha=float(params.get("alpha", 1.0)),
        max_iter=int(params.get("max_iter", 25)),
    )


def _prepared(x: Any, y: Any) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Validate and standardise, exactly as the hand-rolled models do.

    Shared so that a training window that is refused on one engine is refused
    on the other, with the same message. An adapter whose guards are looser
    than the model it stands in for is a second implementation of the contract,
    and the whole point here is that there is only one.

    Standardising here rather than letting scikit-learn scale means ``alpha``
    penalises the same thing on both engines. A raw-scale penalty is how one
    feature ends up effectively unpenalised because it was measured in basis
    points.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64).ravel()
    if x.ndim != 2:
        raise ValueError("x must be 2-D (rows, features)")
    if x.shape[0] != y.shape[0]:
        raise ValueError(f"x has {x.shape[0]} rows, y has {y.shape[0]}")
    if x.shape[0] == 0:
        raise ValueError("cannot fit on an empty training window")
    z, centre, scale = _standardise(x)
    return z, y, centre, scale


class SklearnRidge(Ridge):
    """L2 least squares solved by scikit-learn, returned as a ``Fitted``.

    Subclasses the hand-rolled ridge so ``MLWalkForward`` needs no branch and
    ``Ridge.predict`` reproduces this model exactly: both are linear on the
    stored standardisation, so the coefficients are the whole artefact.
    """

    def __init__(self, namespace: ModuleType, alpha: float = 1.0) -> None:
        super().__init__(alpha=alpha)
        self._linear_model = namespace

    def fit(self, x: np.ndarray, y: np.ndarray) -> Fitted:
        z, target, centre, scale = _prepared(x, y)
        estimator = self._linear_model.Ridge(alpha=self.alpha, fit_intercept=True)
        estimator.fit(z, target)
        return Fitted(
            coefficients=np.asarray(estimator.coef_, dtype=np.float64).ravel(),
            intercept=float(np.asarray(estimator.intercept_).ravel()[0]),
            n_features=int(np.asarray(x).shape[1]),
            center=centre,
            scale=scale,
        )


class SklearnLogisticRegression(LogisticRegression):
    """Binary logistic regression solved by scikit-learn's L-BFGS.

    ``alpha`` is the L2 penalty, as it is on the hand-rolled model; scikit-learn
    parametrises the inverse, so it is passed as ``C = 1/alpha`` and ``alpha=0``
    becomes an unpenalised fit rather than a division by zero.

    The iteration budget is deliberately NOT the hand-rolled ``max_iter``.
    That number counts Newton steps, which converge in a handful; L-BFGS counts
    quasi-Newton iterations and needs an order of magnitude more. Reusing it
    would hand back a model that stopped early, carried no error, and looked
    exactly like a fitted one — so the budget is raised to a solver-appropriate
    floor and the caller's value is honoured only when it is larger.
    """

    #: What L-BFGS needs on problems this size. Below it the solver stops short
    #: and reports a converged-looking model that is not one.
    LBFGS_FLOOR = 200

    def __init__(
        self, namespace: ModuleType, alpha: float = 1.0, max_iter: int = 25, tol: float = 1e-8,
    ) -> None:
        super().__init__(alpha=alpha, max_iter=max_iter, tol=tol)
        self._linear_model = namespace

    def fit(self, x: np.ndarray, y: np.ndarray) -> Fitted:
        z, labels, centre, scale = _prepared(x, y)
        if not np.all((labels == 0.0) | (labels == 1.0)):
            raise ValueError("y must be 0/1; convert the sign of a return in the caller")
        if np.unique(labels).size < 2:
            # The hand-rolled solver limps through this with a floored Hessian;
            # scikit-learn raises. Refusing by name in both places is better
            # than two engines disagreeing about what a degenerate fold is.
            raise ValueError("cannot fit a logistic model on a window with one class")

        penalised = self.alpha > 0.0
        estimator = self._linear_model.LogisticRegression(
            penalty="l2" if penalised else None,
            C=(1.0 / self.alpha) if penalised else 1.0,
            fit_intercept=True,
            solver="lbfgs",
            max_iter=max(int(self.max_iter), self.LBFGS_FLOOR),
            tol=self.tol,
        )
        estimator.fit(z, labels)
        return Fitted(
            coefficients=np.asarray(estimator.coef_, dtype=np.float64).ravel(),
            intercept=float(np.asarray(estimator.intercept_).ravel()[0]),
            n_features=int(np.asarray(x).shape[1]),
            center=centre,
            scale=scale,
        )
