"""Ridge and logistic regression, hand-rolled in NumPy.

Why hand-rolled
---------------

CLAUDE.md's rule is that everything outside a small pinned set is written here,
and the reason applies with unusual force to a fitted model: the coefficients
are the research result. A dependency that changes its solver between minor
versions changes yesterday's conclusions, and nothing in the repository would
notice. These two solve in closed form and in one deterministic sequence, so a
run is reproducible from its seed and its data hash for as long as the file
exists.

``requirements-ml.txt`` may add scikit-learn for models that do not close-form.
When it is absent these are what runs, and ml_runs.engine records which — a run
that fell back is a different run and must not be ranked as though it were not.

Both models are deliberately plain
----------------------------------

No early stopping, no adaptive learning rates, no feature selection. Every one
of those is a hyperparameter that would need to live in the fold, be purged
alongside the data, and be reported — and a research plane that cannot yet
report what it did should not be doing more.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class Fitted:
    """Coefficients and the intercept, in the feature order they were fitted in.

    The order is part of the artefact: applying these to a permuted feature
    vector is not an error anywhere, it just produces a different model.
    """

    coefficients: np.ndarray
    intercept: float
    n_features: int
    #: Column means and scales used to standardise, so `predict` can apply the
    #: same transform. Stored rather than recomputed: recomputing them on the
    #: test window would standardise using the test window's own statistics,
    #: which is a leak that survives every purge.
    center: np.ndarray
    scale: np.ndarray


def _standardise(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Column-wise centre and scale, with zero-variance columns left alone.

    A constant column has scale 0 and dividing by it produces inf, which then
    propagates silently through the solve and comes out as a coefficient of nan.
    Such a column carries no information; it is passed through as zeros so the
    model simply ignores it.
    """
    center = x.mean(axis=0)
    scale = x.std(axis=0)
    safe = np.where(scale > 0.0, scale, 1.0)
    out = (x - center) / safe
    out[:, scale == 0.0] = 0.0
    return out, center, safe


class Ridge:
    """L2-penalised least squares, solved in closed form.

    ``alpha`` is applied to the standardised design, so it means the same thing
    regardless of the units a feature happens to be in — which a raw-scale
    penalty does not, and which is how one feature ends up silently unpenalised
    because it was measured in basis points.
    """

    def __init__(self, alpha: float = 1.0) -> None:
        if alpha < 0:
            raise ValueError("alpha cannot be negative")
        self.alpha = float(alpha)

    def fit(self, x: np.ndarray, y: np.ndarray) -> Fitted:
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64).ravel()
        if x.ndim != 2:
            raise ValueError("x must be 2-D (rows, features)")
        if x.shape[0] != y.shape[0]:
            raise ValueError(f"x has {x.shape[0]} rows, y has {y.shape[0]}")
        if x.shape[0] == 0:
            raise ValueError("cannot fit on an empty training window")

        z, center, scale = _standardise(x)
        y_mean = float(y.mean())
        target = y - y_mean

        # (ZᵀZ + αI)⁻¹ Zᵀt, with the intercept out of the penalty because a
        # penalised intercept shrinks the prediction toward zero rather than
        # toward the mean, which is not what an L2 penalty is for.
        gram = z.T @ z
        gram[np.diag_indices_from(gram)] += self.alpha
        coefficients = np.linalg.solve(gram, z.T @ target)
        return Fitted(coefficients, y_mean, x.shape[1], center, scale)

    @staticmethod
    def predict(model: Fitted, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        if x.shape[1] != model.n_features:
            raise ValueError(f"model wants {model.n_features} features, got {x.shape[1]}")
        z = (x - model.center) / model.scale
        return z @ model.coefficients + model.intercept


class LogisticRegression:
    """Binary logistic regression by Newton-Raphson (IRLS).

    Newton rather than gradient descent because it needs no learning rate and
    converges in a handful of iterations on problems this size — which removes
    the one hyperparameter most likely to be tuned on the test window.

    ``y`` is 0/1. The desk's natural label is the sign of a forward return, and
    the caller does that conversion so that "what counts as up" stays visible in
    the feature spec rather than being buried here.
    """

    def __init__(self, alpha: float = 1.0, max_iter: int = 25, tol: float = 1e-8) -> None:
        if alpha < 0:
            raise ValueError("alpha cannot be negative")
        self.alpha = float(alpha)
        self.max_iter = int(max_iter)
        self.tol = float(tol)

    def fit(self, x: np.ndarray, y: np.ndarray) -> Fitted:
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64).ravel()
        if x.shape[0] != y.shape[0]:
            raise ValueError(f"x has {x.shape[0]} rows, y has {y.shape[0]}")
        if x.shape[0] == 0:
            raise ValueError("cannot fit on an empty training window")
        if not np.all((y == 0.0) | (y == 1.0)):
            raise ValueError("y must be 0/1; convert the sign of a return in the caller")

        z, center, scale = _standardise(x)
        design = np.column_stack([np.ones(z.shape[0]), z])
        beta = np.zeros(design.shape[1])

        # The intercept is not penalised — same reason as Ridge.
        penalty = np.full(design.shape[1], self.alpha)
        penalty[0] = 0.0

        for _ in range(self.max_iter):
            eta = design @ beta
            p = 1.0 / (1.0 + np.exp(-np.clip(eta, -35.0, 35.0)))
            # Weights collapse to zero on a perfectly separated problem, which
            # makes the Hessian singular. Flooring them keeps the solve defined
            # and stops separation presenting as a crash.
            w = np.clip(p * (1.0 - p), 1e-10, None)
            gradient = design.T @ (y - p) - penalty * beta
            hessian = (design.T * w) @ design
            hessian[np.diag_indices_from(hessian)] += penalty
            step = np.linalg.solve(hessian, gradient)
            beta = beta + step
            if float(np.max(np.abs(step))) < self.tol:
                break

        return Fitted(beta[1:], float(beta[0]), x.shape[1], center, scale)

    @staticmethod
    def predict_proba(model: Fitted, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        if x.shape[1] != model.n_features:
            raise ValueError(f"model wants {model.n_features} features, got {x.shape[1]}")
        z = (x - model.center) / model.scale
        eta = z @ model.coefficients + model.intercept
        return 1.0 / (1.0 + np.exp(-np.clip(eta, -35.0, 35.0)))
