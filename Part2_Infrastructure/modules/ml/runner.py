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
them. There is no in-sample number in the result, because a result object that
carries both is a result object someone will read the wrong one from.

Costs are applied per position change at the same flat bps the gateway's
reference engine uses. A signal that is profitable before costs and not after
is the single most common way a backtest lies, and reporting the gross figure
alongside would be offering the lie a place to stand.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from modules.backtester import (
    _annualised_sharpe,
    _max_drawdown,
    bars_per_year,
    deflated_sharpe_ratio,
    dsr_verdict,
)
from modules.ml.features import FeatureSet
from modules.ml.models import Fitted, LogisticRegression, Ridge
from modules.ml.splits import Fold, PurgedWalkForward


@dataclass(frozen=True, slots=True)
class FoldResult:
    """One fold's out-of-sample outcome, in the shape ml_folds stores."""

    fold: Fold
    oos_return: float
    oos_sharpe: float
    oos_max_drawdown: float
    trades: int


@dataclass(frozen=True, slots=True)
class MLRunResult:
    """The whole run. Every figure is out of sample."""

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

    @property
    def usable_folds(self) -> int:
        return len(self.folds)


class MLWalkForward:
    """Fit, predict and score a model across purged folds.

    ``threshold`` turns a prediction into a position: long when the predicted
    forward return (or probability of up) exceeds it, flat otherwise. Long-only
    and flat-otherwise on purpose — a short leg needs a borrow model, and the
    desk already refuses to publish a number whose costs it cannot state.
    """

    def __init__(
        self,
        model: Ridge | LogisticRegression,
        *,
        interval: str = "4h",
        cost_bps: float = 5.0,
        threshold: float | None = None,
    ) -> None:
        self.model = model
        self.interval = interval
        self.cost_bps = float(cost_bps)
        self.is_classifier = isinstance(model, LogisticRegression)
        # A probability's neutral point is 0.5; a return's is 0.
        self.threshold = 0.5 if threshold is None and self.is_classifier else (threshold or 0.0)

    def _predict(self, fitted: Fitted, x: np.ndarray) -> np.ndarray:
        if self.is_classifier:
            return LogisticRegression.predict_proba(fitted, x)
        return Ridge.predict(fitted, x)

    def run(self, data: FeatureSet, cv: PurgedWalkForward) -> MLRunResult:
        folds = cv.split(data.x.shape[0])
        results: list[FoldResult] = []
        stitched: list[np.ndarray] = []
        total_trades = 0
        last_fitted: Fitted | None = None
        ann = bars_per_year(self.interval)

        # The realised per-bar return of holding from each row forward one bar.
        # Derived from the label only when the label IS a return; a direction
        # label carries no magnitude, so the caller supplies bar returns there.
        for fold in folds:
            if not fold.usable:
                continue
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
                continue

            fitted = self.model.fit(train_x, train_y)
            last_fitted = fitted

            test_x = data.x[fold.test_start:fold.test_end]
            signal = self._predict(fitted, test_x)
            position = (signal > self.threshold).astype(np.float64)

            # The bar return the position earns. For a return label this is the
            # label itself; for a direction label the caller must have built a
            # return label alongside, so we fall back to the sign, which is a
            # unit-free proxy and is documented as such in the result.
            realised = data.y[fold.test_start:fold.test_end]
            if self.is_classifier:
                realised = np.where(realised > 0.5, 1.0, -1.0)

            turnover = np.abs(np.diff(np.concatenate([[0.0], position])))
            costs = turnover * (self.cost_bps / 10_000.0)
            net = position * realised - costs

            equity = np.cumprod(1.0 + net) if not self.is_classifier else np.cumsum(net) + 1.0
            trades = int(turnover.sum())
            total_trades += trades
            stitched.append(net)
            results.append(FoldResult(
                fold=fold,
                oos_return=float(equity[-1] - 1.0) if equity.size else 0.0,
                oos_sharpe=_annualised_sharpe(net, ann) if net.size > 1 else 0.0,
                oos_max_drawdown=_max_drawdown(equity) if equity.size else 0.0,
                trades=trades,
            ))

        if not stitched:
            return MLRunResult((), np.array([]), 0.0, 0.0, 0.0, 0, 0.0, 0.0, 0.0,
                               "INSUFFICIENT", None)

        oos = np.concatenate(stitched)
        sharpe = _annualised_sharpe(oos, ann) if oos.size > 1 else 0.0
        equity = np.cumprod(1.0 + oos) if not self.is_classifier else np.cumsum(oos) + 1.0

        # The trial set for the deflation is the folds themselves: this run
        # selected nothing, so the honest N is the number of scores that were
        # looked at. A caller sweeping hyperparameters must pass its own wider
        # candidate set, which is why this is a separate argument upstream.
        candidates = np.array([r.oos_sharpe for r in results], dtype=np.float64)
        skew = float(_skew(oos))
        kurt = float(_kurtosis(oos))
        dsr, psr, expected_max = deflated_sharpe_ratio(
            candidates, sharpe, int(oos.size), skew, kurt,
        )

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
        )


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


