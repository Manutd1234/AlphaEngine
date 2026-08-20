"""The candidate set a run chose from, and what the choosing cost it.

Probability of backtest overfitting measures ONE thing: how often the
configuration that won in sample turned out to be a poor choice out of sample.
It is a statement about a *selection*, so a run that selected nothing has no
PBO — not a low one, none — and this module is what makes the difference
between those two sentences enforceable rather than aspirational.

Two halves, and they are here together because they are the same idea seen from
each end. :func:`expand_grid` says what the run was choosing between;
:func:`overfitting` says how well that choosing held up.

Nothing here computes PBO
-------------------------

``modules.backtester.overfitting_probability`` is the implementation, it is the
one the rule-based sweeps already report, and it is what this module delegates
to. A research plane with two definitions of "probability of backtest
overfitting" has none, and the number a reader compares an ML run against is
the number beside a sweep on the same screen. What is added here is the input
that function needs — a per-fold rank — and the floor below which a fraction of
folds is not an estimate of anything.

The floor, and why it is not zero
---------------------------------

PBO is a fraction of folds. With one ranked fold it can only be 0.0 or 1.0;
with two, 0.0, 0.5 or 1.0. The value that arrives most easily out of that
coarseness is 0.0, which reads as "no evidence of overfitting" — the most
flattering possible reading, produced by the least possible evidence. So below
:data:`MIN_RANKED_FOLDS` the answer is NULL and the card says it was not
computed, because this codebase's sharpest recorded defect was exactly the
other choice: a failure that rendered as a reassuring number.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Any

from modules.backtester import overfitting_probability

#: Below this many ranked folds, PBO stays NULL. Three is the first count whose
#: resolution (⅓) is finer than the halves the estimate is a fraction of.
MIN_RANKED_FOLDS = 3

#: Why a run has the PBO it has — a CODE, never a sentence. The runner decides
#: the fact; ``modules/ml/fit.py`` words it for the reader, so there is exactly
#: one place a null PBO is explained and the portal quotes that place.
PBO_RANKED = "ranked"
PBO_ONE_CONFIGURATION = "one_configuration"
PBO_TOO_FEW_FOLDS = "too_few_folds"
PBO_NO_FOLDS = "no_folds"


@dataclass(frozen=True, slots=True)
class FoldSelection:
    """Which candidate one fold picked, and where that pick landed.

    Structurally what ``overfitting_probability`` reads off a
    ``WalkForwardFold``: ``oos_rank`` and ``combos_ranked``, nothing else. It is
    deliberately NOT a ``WalkForwardFold`` — that model requires ``chosen_fast``
    and ``chosen_slow``, and filling those with zeroes for a fitted model would
    put fabricated moving-average parameters into the one record whose job is
    catching fabrication.
    """

    fold_index: int
    #: The candidate's label, e.g. ``alpha=0.1``. ``default`` when nothing was swept.
    chosen: str
    is_sharpe: float
    oos_sharpe: float
    #: One plus the number of candidates that beat it out of sample, or None
    #: when this fold produced no placement — see :func:`rank_of`.
    oos_rank: int | None
    combos_ranked: int


@dataclass(frozen=True, slots=True)
class Pbo:
    """The probability, or the reason there is not one. Never both, never zero
    standing in for absent."""

    value: float | None
    basis: str


def expand_grid(params: dict[str, Any]) -> tuple[tuple[str, dict[str, Any]], ...]:
    """The configurations a run will choose between, in a fixed order.

    A parameter given as a list is SWEPT; anything else is fixed. That is the
    whole interface, and it needs no schema change because ``MLFitRequest``
    already carries ``params`` as free-form JSON — ``{"alpha": [0.1, 1, 10]}``
    is three candidates and ``{"alpha": 1.0}`` is one.

    Deterministic, because a run must be reproducible from its seed and its data
    hash: the swept keys are sorted and the product is taken in that order, so
    the candidate order — and therefore every tie-break downstream — is the same
    on any interpreter. Duplicates are dropped rather than counted twice: a
    repeated value would inflate the denominator PBO is a fraction of.
    """
    swept = sorted(key for key, value in params.items() if isinstance(value, (list, tuple)))
    fixed = {key: value for key, value in params.items() if key not in swept}
    if not swept:
        return (("default", dict(fixed)),)
    for key in swept:
        if not params[key]:
            raise ValueError(f"parameter {key!r} was given an empty list; a sweep over nothing selects nothing")

    out: list[tuple[str, dict[str, Any]]] = []
    seen: set[str] = set()
    for combination in product(*(list(params[key]) for key in swept)):
        marker = repr(combination)
        if marker in seen:
            continue
        seen.add(marker)
        chosen = dict(zip(swept, combination, strict=True))
        label = " ".join(f"{key}={value}" for key, value in chosen.items())
        out.append((label, {**fixed, **chosen}))
    return tuple(out)


def rank_of(winner: float, scores: list[float]) -> int | None:
    """Where ``winner`` placed among ``scores`` out of sample, or None.

    Competition ranking — one plus the count that scored strictly better — so a
    partial tie does not push the pick down the table for being tied with
    something.

    None in two cases, and both are refusals rather than edge cases. A single
    candidate has nothing to be ranked against. And a fold where EVERY candidate
    scored identically is a tie, not a placement: calling it "rank 1 of 5" would
    report a selection that held up perfectly on a fold where nothing was
    selected at all, and rank 1 is exactly the half PBO counts as a success.
    """
    if len(scores) < 2 or len(set(scores)) < 2:
        return None
    return 1 + sum(1 for score in scores if score > winner)


def overfitting(selections: list[FoldSelection], *, candidates: int) -> Pbo:
    """PBO across the folds, or the code for why there is none.

    The arithmetic is ``modules.backtester.overfitting_probability`` and only
    that — the same function the sweep card reports, reached with the same two
    fields it reads. Everything above it here is about refusing to answer.
    """
    if not selections:
        return Pbo(None, PBO_NO_FOLDS)
    if candidates < 2:
        return Pbo(None, PBO_ONE_CONFIGURATION)
    ranked = [s for s in selections if s.oos_rank is not None and s.combos_ranked > 1]
    if len(ranked) < MIN_RANKED_FOLDS:
        return Pbo(None, PBO_TOO_FEW_FOLDS)
    # Duck-typed on purpose: the function reads `oos_rank` and `combos_ranked`,
    # FoldSelection carries both, and reusing it is the point of this module.
    value = overfitting_probability(ranked)  # type: ignore[arg-type]
    if value is None:
        return Pbo(None, PBO_TOO_FEW_FOLDS)
    return Pbo(float(value), PBO_RANKED)
