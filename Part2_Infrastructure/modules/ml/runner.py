"""Fit across folds, score out of sample, and deflate the answer.

This is where the three modules meet: the builder makes the matrix, the
splitter cuts leak-free folds, a model is fitted on each fold's training window
and scored on its test window, and the concatenated out-of-sample returns are
put through the same DSR machinery the rule-based sweeps already use.

Reusing that machinery is the point. A research plane with two definitions of
"deflated Sharpe" has none, and the number a reader compares an ML run against
is the number beside a sweep on the same screen.

What is measured, and what is not
---------------------------------

Every metric here is computed on the CONCATENATED out-of-sample predictions —
the test windows only, in time order, each produced by a model that never saw
them. There is no in-sample number in the RESULT, because a result object that
carries both is a result object someone will read the wrong one from.

In-sample Sharpe exists inside a fold, and only there: it is how the fold picks
which candidate to trade, exactly as ``modules/backtester/engines.py`` picks a
(fast, slow) pair. It never reaches the headline figures.

Costs are applied per position change at the same flat bps the gateway's
reference engine uses. A signal that is profitable before costs and not after
is the single most common way a backtest lies, and reporting the gross figure
alongside would be offering the lie a place to stand.

Selection, and the overfitting it buys
--------------------------------------

A run may be handed several candidate configurations. Each fold fits all of
them on its training window, trades the one with the best IN-SAMPLE Sharpe, and
scores the whole set out of sample — so the fold's reported result is what a
desk making that choice would actually have had, and the winner's out-of-sample
RANK says whether the choice was worth making. Those ranks are the input PBO
needs; ``modules/ml/selection.py`` turns them into one, or refuses to.

A run with one candidate selects nothing, ranks nothing, and reports no PBO.
That is the common case and it is not a gap.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import NamedTuple

import numpy as np

from modules.backtester import (
    _annualised_sharpe,
    _max_drawdown,
    bars_per_year,
    deflated_sharpe_ratio,
    dsr_verdict,
    min_track_record_length,
)
from modules.ml.features import FeatureSet
from modules.ml.models import Fitted, LogisticRegression, Ridge
from modules.ml.selection import FoldSelection, overfitting, rank_of
from modules.ml.splits import Fold, PurgedWalkForward

Estimator = Ridge | LogisticRegression


@dataclass(frozen=True, slots=True)
class FoldResult:
    """One fold's out-of-sample outcome, in the shape ml_folds stores."""

    fold: Fold
    oos_return: float
    oos_sharpe: float
    oos_max_drawdown: float
    trades: int


class _Scored(NamedTuple):
    """One candidate, fitted on a fold's training window and scored on both.

    Transient by design — it exists for the length of one fold, so the
    in-sample Sharpe it carries can decide the pick and then go away rather
    than travelling to a reader beside the out-of-sample one.
    """

    label: str
    fitted: Fitted
    is_sharpe: float
    net: np.ndarray
    oos_sharpe: float
    trades: int


@dataclass(frozen=True, slots=True)
class MLRunResult:
    """The whole run. Every headline figure is out of sample."""

    folds: tuple[FoldResult, ...]
    #: Concatenated per-bar strategy returns, net of costs, test windows only.
    oos_returns: np.ndarray
    oos_sharpe: float
    oos_return: float
    oos_max_drawdown: float
    trades: int
    deflated_sharpe: float
    psr: float
    expected_max_sharpe: float
    verdict: str
    #: Fitted on the last fold, so a caller has something to store as an
    #: artefact. Earlier folds' models are transient by design: the run's claim
    #: is about the procedure, not about one fitted object.
    final_model: Fitted | None
    #: Probability of backtest overfitting, or None. NEVER 0.0 for "unknown":
    #: 0.0 means "no evidence of overfitting", which is the most flattering
    #: reading there is, and it must not be what an absent answer looks like.
    pbo: float | None = None
    #: The CODE for why `pbo` is what it is. ``modules/ml/fit.py`` words it.
    pbo_basis: str = "no_folds"
    #: MinTRL at 95 % against a zero benchmark: how many bars of this record it
    #: would take for this Sharpe to be distinguishable from luck. None when the
    #: Sharpe is not positive — no finite record proves an edge that is absent.
    min_track_record_bars: float | None = None
    #: How many configurations each fold chose between. 1 is "no selection".
    candidates_tested: int = 1
    #: What each fold picked and where the pick landed. The PBO evidence.
    selections: tuple[FoldSelection, ...] = ()

    @property
    def usable_folds(self) -> int:
        return len(self.folds)


class MLWalkForward:
    """Fit, predict and score a model across purged folds.

    ``threshold`` turns a prediction into a position: long when the predicted
    forward return (or probability of up) exceeds it, flat otherwise. Long-only
    and flat-otherwise on purpose — a short leg needs a borrow model, and the
    desk already refuses to publish a number whose costs it cannot state.

    ``candidates`` is an optional ``(label, estimator)`` sequence for a run that
    sweeps its hyperparameters. Given none, the run has exactly one candidate —
    ``model`` itself — which is the same arithmetic with nothing to select and
    therefore no PBO. Every candidate must be the same model family: the
    classifier/regressor decision is taken once, from ``model``, because a fold
    that mixed the two would be comparing a probability with a return.
    """

    def __init__(
        self,
        model: Estimator,
        *,
        candidates: list[tuple[str, Estimator]] | tuple[tuple[str, Estimator], ...] | None = None,
        interval: str = "4h",
        cost_bps: float = 5.0,
        threshold: float | None = None,
    ) -> None:
        self.model = model
        self.candidates: tuple[tuple[str, Estimator], ...] = (
            tuple(candidates) if candidates else (("default", model),)
        )
        self.interval = interval
        self.cost_bps = float(cost_bps)
        self.is_classifier = isinstance(model, LogisticRegression)
        # A probability's neutral point is 0.5; a return's is 0.
        self.threshold = 0.5 if threshold is None and self.is_classifier else (threshold or 0.0)

    def _predict(self, fitted: Fitted, x: np.ndarray) -> np.ndarray:
        if self.is_classifier:
            return LogisticRegression.predict_proba(fitted, x)
        return Ridge.predict(fitted, x)

    def _realised(self, y: np.ndarray) -> np.ndarray:
        """The bar return a position earns over ``y``.

        For a return label this is the label itself. A direction label carries
        no magnitude, so its sign is used — a unit-free proxy, documented as
        such here and in the result rather than dressed up as a return.
        """
        return np.where(y > 0.5, 1.0, -1.0) if self.is_classifier else y

    def _equity(self, net: np.ndarray) -> np.ndarray:
        return np.cumsum(net) + 1.0 if self.is_classifier else np.cumprod(1.0 + net)

    def _score(
        self, fitted: Fitted, x: np.ndarray, realised: np.ndarray, ann: float,
    ) -> tuple[np.ndarray, float, int]:
        """Positions, costs and the Sharpe they produce over one window."""
        position = (self._predict(fitted, x) > self.threshold).astype(np.float64)
        turnover = np.abs(np.diff(np.concatenate([[0.0], position])))
        net = position * realised - turnover * (self.cost_bps / 10_000.0)
        sharpe = _annualised_sharpe(net, ann) if net.size > 1 else 0.0
        return net, sharpe, int(turnover.sum())

    def _training_window(
        self, data: FeatureSet, fold: Fold, cv: PurgedWalkForward, folds: list[Fold],
    ) -> tuple[np.ndarray, np.ndarray] | None:
        """The rows this fold may actually fit on, or None when there are not
        enough of them to mean anything."""
        if not fold.usable:
            return None
        train_x = data.x[fold.train_start:fold.train_end]
        train_y = data.y[fold.train_start:fold.train_end]

        # Drop the embargoed rows if the scheme has any. Empty for the
        # expanding contiguous walk-forward — see splits.py.
        lo, hi = cv.embargoed_range(fold, folds)
        if hi > lo:
            mask = np.ones(train_x.shape[0], dtype=bool)
            mask[max(0, lo - fold.train_start):max(0, hi - fold.train_start)] = False
            train_x, train_y = train_x[mask], train_y[mask]

        if train_x.shape[0] < train_x.shape[1] + 2:
            # Fewer rows than features is a solve that will "work" and mean
            # nothing. Skipping is honest; the fold count in the result says
            # how many actually ran.
            return None
        return train_x, train_y

    def _fit_candidates(
        self,
        window: tuple[np.ndarray, np.ndarray],
        test_x: np.ndarray,
        realised: np.ndarray,
        ann: float,
    ) -> list[_Scored]:
        """Every candidate, fitted on this fold's training rows and scored on
        both windows. In-sample first, because that is what picks the winner."""
        train_x, train_y = window
        in_sample = self._realised(train_y)
        out: list[_Scored] = []
        for label, estimator in self.candidates:
            try:
                fitted = estimator.fit(train_x, train_y)
            except ValueError:
                # A candidate that cannot fit THIS window is not a candidate on
                # it — a single-class window for a logistic model, say. Dropping
                # it keeps the rank denominator equal to what was really ranked,
                # which is the number PBO divides by.
                continue
            _, is_sharpe, _ = self._score(fitted, train_x, in_sample, ann)
            net, oos_sharpe, trades = self._score(fitted, test_x, realised, ann)
            out.append(_Scored(label, fitted, is_sharpe, net, oos_sharpe, trades))
        return out

    def run(self, data: FeatureSet, cv: PurgedWalkForward) -> MLRunResult:
        folds = cv.split(data.x.shape[0])
        results: list[FoldResult] = []
        selections: list[FoldSelection] = []
        stitched: list[np.ndarray] = []
        # Every out-of-sample Sharpe that was LOOKED AT, across candidates and
        # folds alike. This is the DSR trial set: the hurdle a Sharpe has to
        # clear grows with the number of scores someone got to see, and a
        # candidate sweep sees more of them than a single fit does.
        scored: list[float] = []
        total_trades = 0
        last_fitted: Fitted | None = None
        ann = bars_per_year(self.interval)

        for fold in folds:
            window = self._training_window(data, fold, cv, folds)
            if window is None:
                continue
            test_x = data.x[fold.test_start:fold.test_end]
            realised = self._realised(data.y[fold.test_start:fold.test_end])
            fits = self._fit_candidates(window, test_x, realised, ann)
            if not fits:
                continue

            best = max(fits, key=lambda candidate: candidate.is_sharpe)
            oos_scores = [candidate.oos_sharpe for candidate in fits]
            selections.append(FoldSelection(
                fold_index=fold.index,
                chosen=best.label,
                is_sharpe=best.is_sharpe,
                oos_sharpe=best.oos_sharpe,
                oos_rank=rank_of(best.oos_sharpe, oos_scores),
                combos_ranked=len(fits),
            ))
            scored.extend(oos_scores)

            equity = self._equity(best.net)
            stitched.append(best.net)
            total_trades += best.trades
            last_fitted = best.fitted
            results.append(FoldResult(
                fold=fold,
                oos_return=float(equity[-1] - 1.0) if equity.size else 0.0,
                oos_sharpe=best.oos_sharpe,
                oos_max_drawdown=_max_drawdown(equity) if equity.size else 0.0,
                trades=best.trades,
            ))

        pbo = overfitting(selections, candidates=len(self.candidates))
        if not stitched:
            return MLRunResult(
                folds=(), oos_returns=np.array([]), oos_sharpe=0.0, oos_return=0.0,
                oos_max_drawdown=0.0, trades=0, deflated_sharpe=0.0, psr=0.0,
                expected_max_sharpe=0.0, verdict="INSUFFICIENT", final_model=None,
                pbo=pbo.value, pbo_basis=pbo.basis,
                candidates_tested=len(self.candidates),
            )

        oos = np.concatenate(stitched)
        sharpe = _annualised_sharpe(oos, ann) if oos.size > 1 else 0.0
        equity = self._equity(oos)
        skew = float(_skew(oos))
        kurt = float(_kurtosis(oos))
        # De-annualised for the deflation, exactly as `modules/backtester/run.py`
        # does it, and for the reason `_min_track_record_bars` below spells out:
        # `probabilistic_sharpe_ratio` is documented per-observation, and both
        # `scored` and `sharpe` arrive here annualised because `_score` multiplies
        # by √ann. Feeding annualised figures to it inflated (sr − sr*)·√(n−1) by
        # √(bars per year) and put an annualised Sharpe inside the
        # `1 − γ₃·S + (γ₄−1)/4·S²` variance term against per-bar skew and
        # kurtosis measured from `oos` — so every DSR and PSR this path reported
        # was computed in two units at once, and read far too high.
        root_ann = math.sqrt(ann)
        sr_per_bar = sharpe / root_ann
        candidates_per_bar = np.array(scored, dtype=np.float64) / root_ann
        dsr, psr, expected_max = deflated_sharpe_ratio(
            candidates_per_bar, sr_per_bar, int(oos.size), skew, kurt,
        )
        # Reported back in the unit its neighbours on `MLRunResult` carry:
        # `oos_sharpe` is annualised, and a per-bar hurdle sitting beside it
        # under a name that does not say so is the blend this codebase treats
        # as the defect. The deflation above is unaffected — this is display.
        expected_max *= root_ann

        return MLRunResult(
            folds=tuple(results),
            oos_returns=oos,
            oos_sharpe=sharpe,
            oos_return=float(equity[-1] - 1.0),
            oos_max_drawdown=_max_drawdown(equity),
            trades=total_trades,
            deflated_sharpe=dsr,
            psr=psr,
            expected_max_sharpe=expected_max,
            verdict=dsr_verdict(dsr),
            final_model=last_fitted,
            pbo=pbo.value,
            pbo_basis=pbo.basis,
            min_track_record_bars=_min_track_record_bars(oos, skew, kurt),
            candidates_tested=len(self.candidates),
            selections=tuple(selections),
        )


def _min_track_record_bars(oos: np.ndarray, skew: float, kurt: float) -> float | None:
    """How many bars this record would need for its Sharpe to be real.

    The existing ``min_track_record_length`` from the sweep path, fed the same
    way ``modules/backtester/run.py`` feeds it: a PER-BAR Sharpe against a zero
    benchmark, with the skew and kurtosis of the same return stream. The
    annualised figure the run reports is not that number and passing it here
    would understate the requirement by a factor of √(bars per year).

    None when the Sharpe is not positive. ``min_track_record_length`` returns
    infinity there, and that is the honest answer — no finite record proves an
    edge that is not there — but infinity is not a length, so it is not
    reported as one.
    """
    if oos.size < 2:
        return None
    deviation = float(oos.std(ddof=1))
    if deviation <= 0.0:
        return None
    bars = min_track_record_length(float(oos.mean()) / deviation, 0.0, skew, kurt)
    return round(bars, 1) if math.isfinite(bars) else None


def _skew(x: np.ndarray) -> float:
    if x.size < 3:
        return 0.0
    sd = x.std(ddof=0)
    if sd == 0:
        return 0.0
    return float(np.mean(((x - x.mean()) / sd) ** 3))


def _kurtosis(x: np.ndarray) -> float:
    """Non-excess kurtosis — 3.0 for a normal — because that is what
    ``probabilistic_sharpe_ratio`` in backtester.py expects."""
    if x.size < 4:
        return 3.0
    sd = x.std(ddof=0)
    if sd == 0:
        return 3.0
    return float(np.mean(((x - x.mean()) / sd) ** 4))
