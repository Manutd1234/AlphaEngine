"""Run one supervised walk-forward, end to end, and file the evidence.

The piece that was missing. Everything under ``modules/ml`` existed and was
tested — the splitter, the feature builder, the two models, the runner, the
store, the read routes and the panel — and nothing in production ever called
any of it. ``MLRunStore.persist`` had exactly one caller in the repository,
``tests/test_ml_store.py``, and it reached the store only because the test set
``store.enabled = True`` and injected a fake client by hand. The desk could not
fit a model because there was no way to ask it to.

This is that way. It is deliberately thin: it owns no maths, no schema and no
transport. It loads bars, hands them to the builder, hands the matrix to the
runner, and hands the result to the store — so every number it produces is
produced by code that already had tests, and the only new thing being asserted
is the wiring.

**PBO is not computed, and the column stays NULL.** Probability of backtest
overfitting ranks a selected configuration against the alternatives it was
selected from; a run that fits one configuration has no alternatives and
therefore no rank. `overfitting_probability` in the backtester needs
`combos_ranked > 1` per fold and returns None without it. Writing a number
there because the column exists would be inventing the one figure whose whole
job is to catch invented figures.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np

from modules.backtester import dataset_fingerprint, fetch_ohlcv
from modules.ml.engine import ENGINE as ACTIVE_ENGINE
from modules.ml.features import FeatureBuilder, FeatureSpec, LabelSpec
from modules.ml.models import LogisticRegression, Ridge
from modules.ml.runner import MLRunResult, MLWalkForward
from modules.ml.splits import PurgedWalkForward

log = logging.getLogger("alphaengine.ml")

#: The default column set. Six kinds, three windows — wide enough to be worth
#: fitting and narrow enough that a reader can hold the whole spec in their
#: head, which matters more here than squeezing the metric.
DEFAULT_FEATURES: tuple[tuple[str, int], ...] = (
    ("return", 1), ("return", 5),
    ("volatility", 20),
    ("momentum", 10), ("momentum", 30),
    ("range", 14),
    ("volume_z", 20),
)


@dataclass(frozen=True, slots=True)
class MLFitOutcome:
    """What the caller gets back, whether or not anything was filed."""

    ran: bool
    persisted: bool
    run_id: str | None
    reason: str | None
    result: MLRunResult | None
    data_hash: str
    bars: int


def _model(name: str, params: dict[str, Any]) -> Ridge | LogisticRegression:
    if name == "ridge":
        return Ridge(alpha=float(params.get("alpha", 1.0)))
    if name == "logistic":
        return LogisticRegression(
            alpha=float(params.get("alpha", 1.0)),
            max_iter=int(params.get("max_iter", 25)),
        )
    raise ValueError(f"unknown model {name!r}; expected 'ridge' or 'logistic'")


def run_ml_fit(
    *,
    symbol: str = "BTCUSDT",
    interval: str = "4h",
    bars: int = 1500,
    model: str = "ridge",
    params: dict[str, Any] | None = None,
    n_splits: int = 5,
    label_horizon: int = 1,
    label_kind: str | None = None,
    embargo: int = 0,
    cost_bps: float = 5.0,
    seed: int = 0,
) -> tuple[MLFitOutcome, dict[str, Any]]:
    """Fit and score. Returns the outcome and the payload the store needs.

    Synchronous on purpose: it is CPU work, and the job queue runs it on a
    worker thread. Splitting the persist out means the caller decides whether a
    result is filed, which is what makes this testable without a Supabase.
    """
    params = dict(params or {})
    label = LabelSpec(
        horizon=int(label_horizon),
        kind=label_kind or ("direction" if model == "logistic" else "return"),
    )
    builder = FeatureBuilder([FeatureSpec(kind, window) for kind, window in DEFAULT_FEATURES], label)

    frame, source = fetch_ohlcv(symbol, interval, bars)
    data_hash = dataset_fingerprint(frame)
    features = builder.build(
        open_=frame["open"].to_numpy(),
        high=frame["high"].to_numpy(),
        low=frame["low"].to_numpy(),
        close=frame["close"].to_numpy(),
        volume=frame["volume"].to_numpy(),
    )

    cv = PurgedWalkForward(
        n_splits=int(n_splits), label_horizon=label.horizon, embargo=int(embargo),
    )
    result = MLWalkForward(
        _model(model, params), interval=interval, cost_bps=float(cost_bps),
    ).run(features, cv)

    # The bar timestamp for every row the matrix kept. Without it `ml_folds`
    # gets 1970 epoch stamps, which is a fold table that cannot be read back
    # against the series it describes.
    index = frame.index
    bar_times = [
        _as_utc(index[int(i)]) for i in np.asarray(features.row_index, dtype=int)
    ]

    payload: dict[str, Any] = {
        "model": model,
        "symbol": symbol.upper(),
        "interval": interval.lower(),
        "data_hash": data_hash,
        "params": {
            **params,
            "bars": int(bars),
            "n_splits": int(n_splits),
            "embargo": int(embargo),
            "cost_bps": float(cost_bps),
            "source": source,
            "engine": ACTIVE_ENGINE,
        },
        "seed": int(seed),
        "features": features,
        "result": result,
        "label": label.name,
        "label_horizon_bars": label.horizon,
        "bar_times": bar_times,
    }
    outcome = MLFitOutcome(
        ran=True, persisted=False, run_id=None, reason=None,
        result=result, data_hash=data_hash, bars=int(frame.shape[0]),
    )
    return outcome, payload


def _as_utc(value: Any) -> datetime:
    """Pandas timestamps arrive tz-naive or tz-aware; the store wants aware."""
    stamp = value.to_pydatetime() if hasattr(value, "to_pydatetime") else value
    if not isinstance(stamp, datetime):
        return datetime.now(timezone.utc)
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


ML_FIT_KIND = "ml.fit"


def run_ml_fit_job(params: dict[str, Any]) -> dict[str, Any]:
    """The job body: fit, then file.

    Runs on a worker thread, so the persist — the only async part — is driven
    through a dedicated loop rather than the gateway's. A fit is CPU-bound for
    seconds; holding a request open for it is what the queue exists to avoid.
    """
    import asyncio

    from modules.ml.store import get_ml_store

    outcome, payload = run_ml_fit(**params)
    store = get_ml_store()
    if not store.enabled:
        # The run happened and its numbers are real; only the filing did not.
        # Saying so is the difference between "no corpus" and "no result".
        return _job_result(outcome, persisted=False, reason="supabase is not configured on this deployment")

    async def _file() -> Any:
        try:
            return await store.persist(**payload)
        finally:
            await store.stop()

    filed = asyncio.run(_file())
    persisted = bool(getattr(filed, "persisted", False))
    run_id = getattr(filed, "run_id", None)

    if persisted and run_id:
        # Index it, so a fitted run is retrievable by the same query that finds
        # a sweep. Failing to index is not failing to fit: the run is filed
        # either way and the corpus catches up on the next backfill.
        try:
            from modules.research_rag import get_rag

            get_rag().on_ml_run_complete({
                "id": run_id,
                "symbol": payload["symbol"],
                "interval": payload["interval"],
                "model": payload["model"],
                "seed": payload["seed"],
                "data_hash": payload["data_hash"],
                "engine": payload["params"].get("engine"),
                "oos_sharpe": outcome.result.oos_sharpe if outcome.result else None,
                "deflated_sharpe": outcome.result.deflated_sharpe if outcome.result else None,
                "pbo": None,
                "folds": [],
            })
        except Exception as exc:
            log.warning("ml fit: corpus card not indexed (%s)", type(exc).__name__)

    return _job_result(
        outcome, persisted=persisted, reason=getattr(filed, "reason", None), run_id=run_id,
    )


def _job_result(
    outcome: MLFitOutcome, *, persisted: bool, reason: str | None, run_id: str | None = None,
) -> dict[str, Any]:
    result = outcome.result
    return {
        "persisted": persisted,
        "reason": reason,
        "run_id": run_id,
        "data_hash": outcome.data_hash,
        "bars": outcome.bars,
        "folds": len(result.folds) if result else 0,
        "oos_sharpe": result.oos_sharpe if result else None,
        "deflated_sharpe": result.deflated_sharpe if result else None,
        "verdict": result.verdict if result else None,
        # Stated, not omitted: a null column with no explanation reads as a
        # figure that failed to compute rather than one that does not apply.
        "pbo": None,
        "pbo_reason": "not applicable: PBO ranks a selected configuration against the "
                      "alternatives it was selected from, and this run fitted one",
    }


def submit_ml_fit(params: dict[str, Any], *, actor: str) -> Any:
    """Queue a fit. The caller polls `/api/data/jobs` for the outcome."""
    from modules.jobs import get_queue

    return get_queue().submit(
        ML_FIT_KIND, run_ml_fit_job, params, meta={"actor": actor, "params": params},
    )
