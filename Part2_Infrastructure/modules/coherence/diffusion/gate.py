"""Can this representation recover a fact that is written in the text?

The gate this study needed and did not have, and the reason it is worth more
than the study's own result.

A null result from a representation that does not encode the subject is not
evidence of anything. This module makes that testable: hold out folds, regress
a fact KNOWN to be stated in the documents on the latent, and report the
out-of-fold R-squared. A latent that cannot recover what the text says has no
standing to report that the text says nothing.

Measured on 62 FOMC statements, with the policy move in basis points as the
known fact:

    whole statement, 12-d whitened latent      out-of-fold R^2 = -0.60
    decision sentence only, 12-d whitened      out-of-fold R^2 = +0.74

— and direction, as a three-class problem against a 0.64 majority baseline,
goes from 0.84 to 1.00. The encoder was never the problem; the dilution was.
The decision sentence is about seven per cent of the statement and the other
ninety-three per cent is an economic assessment whose wording moves for its own
reasons.

OUT OF FOLD, ALWAYS. In-sample R-squared rises with every dimension added and
would pass any latent wide enough, which is the opposite of a gate.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

GateState = Literal["passed", "failed", "not_assessable"]

#: Below this the representation is not carrying the fact in any usable way.
#: Zero is the honest floor — it is the point at which the latent beats
#: predicting the mean — and the default sits above it so a latent that only
#: just clears chance is not called admissible.
DEFAULT_FLOOR = 0.20


@dataclass(frozen=True)
class GateResult:
    """Whether a latent may be used, and the number behind the answer."""

    state: GateState
    r_squared: float | None = None
    floor: float = DEFAULT_FLOOR
    folds: int = 0
    samples: int = 0
    reason: str | None = None

    @property
    def admissible(self) -> bool:
        return self.state == "passed"


def out_of_fold_r2(latent: np.ndarray, known: np.ndarray, *, folds: int = 5,
                   ridge: float = 1.0) -> float | None:
    """R-squared of a ridge fit, every point predicted by folds it was not in."""
    latent = np.atleast_2d(np.asarray(latent, dtype=np.float64))
    known = np.asarray(known, dtype=np.float64).ravel()
    if latent.shape[0] != known.size or known.size < folds * 2:
        return None
    design = np.column_stack([np.ones(known.size), latent])
    index = np.arange(known.size)
    predicted = np.zeros(known.size)
    penalty = ridge * np.eye(design.shape[1])
    penalty[0, 0] = 0.0
    for fold in range(folds):
        test = index[fold::folds]
        train = np.setdiff1d(index, test)
        if train.size <= design.shape[1]:
            return None
        beta = np.linalg.solve(design[train].T @ design[train] + penalty,
                               design[train].T @ known[train])
        predicted[test] = design[test] @ beta
    total = float(((known - known.mean()) ** 2).sum())
    if total == 0.0:
        return None
    return 1.0 - float(((known - predicted) ** 2).sum()) / total


def check(latent: np.ndarray, known: np.ndarray, *, floor: float = DEFAULT_FLOOR,
          folds: int = 5, fact: str = "a fact stated in the text") -> GateResult:
    """Admit the latent, or refuse it and say by how much it fell short."""
    finite = np.isfinite(np.asarray(known, dtype=np.float64).ravel())
    latent = np.atleast_2d(np.asarray(latent, dtype=np.float64))[finite]
    known = np.asarray(known, dtype=np.float64).ravel()[finite]
    score = out_of_fold_r2(latent, known, folds=folds)
    if score is None:
        return GateResult("not_assessable", folds=folds, samples=int(known.size), floor=floor,
                          reason=f"{known.size} usable rows is too few to hold out {folds} folds")
    if score < floor:
        return GateResult("failed", r_squared=score, floor=floor, folds=folds,
                          samples=int(known.size),
                          reason=(f"the latent recovers {fact} at out-of-fold R^2 {score:+.3f}, "
                                  f"below the floor of {floor:+.2f}; a null measured through it "
                                  "would say nothing about the text"))
    return GateResult("passed", r_squared=score, floor=floor, folds=folds,
                      samples=int(known.size))
