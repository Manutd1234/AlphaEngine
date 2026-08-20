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

**PBO is computed when, and only when, the run selected something.**
Probability of backtest overfitting ranks a selected configuration against the
alternatives it was selected from, so a fit of one configuration has no
alternatives, no rank, and no PBO — the column stays NULL and the card says it
was not computed. Hand this a swept parameter (``params={"alpha": [0.1, 1, 10]}``)
and there is a selection to judge: every fold picks its winner in sample, the
whole candidate set is scored out of sample, and
``modules.backtester.overfitting_probability`` — the same function the sweep
card reports — turns those ranks into the figure. What is never done is writing
a number because the column exists, which would be inventing the one figure
whose whole job is to catch invented figures.

Every sentence a reader sees about a null PBO is in :data:`PBO_REASONS` below.
The runner decides the fact and records a code; this file is where that code
becomes English, so the portal quotes one source instead of composing a second.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np

from modules.backtester import dataset_fingerprint, fetch_ohlcv
from modules.ml.features import FeatureBuilder, FeatureSpec, LabelSpec
from modules.ml.runner import MLRunResult, MLWalkForward
from modules.ml.selection import (
    MIN_RANKED_FOLDS,
    PBO_NO_FOLDS,
    PBO_ONE_CONFIGURATION,
    PBO_TOO_FEW_FOLDS,
    expand_grid,
)
from modules.ml.sklearn_adapter import resolve_engine
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
    #: The engine that ACTUALLY fitted this run — never the one requested.
    #: `engine_requested` is what was asked for and `engine_reason` says why
    #: they differ, which they do exactly when the optional extra was absent.
    engine: str = "numpy"
    engine_requested: str = "auto"
    engine_reason: str | None = None


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
    engine: str | None = None,
) -> tuple[MLFitOutcome, dict[str, Any]]:
    """Fit and score. Returns the outcome and the payload the store needs.

    Synchronous on purpose: it is CPU work, and the job queue runs it on a
    worker thread. Splitting the persist out means the caller decides whether a
    result is filed, which is what makes this testable without a Supabase.

    ``engine`` is ``auto``, ``numpy`` or ``sklearn``, defaulting to the
    ``ML_ENGINE`` deployment setting. Asking for ``sklearn`` on a box without
    the optional extra does NOT skip the run and does NOT quietly substitute:
    the hand-rolled models fit it, `engine` on the result reads ``numpy``, and
    `engine_reason` says why. A run that fell back is a different run.
    """
    params = dict(params or {})
    # What this run is choosing between. One configuration unless a parameter
    # was given as a list — and one configuration is a run that selects nothing,
    # which is why its PBO is null rather than low.
    grid = expand_grid(params)
    # Resolved BEFORE any bars are fetched: an unknown model or an unknown
    # engine is a request that cannot produce a result, and it should not first
    # spend a network round trip finding that out. One resolution per candidate
    # because each needs its own estimator; the ENGINE decision is identical
    # across them, so the first speaks for the run.
    choices = [resolve_engine(model, config, requested=engine) for _, config in grid]
    choice = choices[0]
    if choice.fell_back:
        log.warning("ml fit: %s", choice.reason)
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
        choice.estimator,
        # `name` rather than `label`: the comprehension has its own scope, but
        # reusing the LabelSpec's name three lines from where it is read would
        # be a trap for the next person to edit this.
        candidates=[
            (name, resolved.estimator)
            for (name, _), resolved in zip(grid, choices, strict=True)
        ],
        interval=interval, cost_bps=float(cost_bps),
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
            # What RAN, never what was asked for. `ml_runs.engine` is written
            # from this, and its check constraint exists because a run that
            # fell back must not be ranked beside one that did not.
            "engine": choice.engine,
            "engine_requested": choice.requested,
            "engine_reason": choice.reason,
            # How wide the search was. Recorded because it is what the DSR
            # hurdle and the PBO denominator are both a function of, and a run
            # whose candidate count is unknown cannot be compared with one
            # whose is.
            "candidates": len(grid),
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
        engine=choice.engine, engine_requested=choice.requested,
        engine_reason=choice.reason,
    )
    return outcome, payload


def _as_utc(value: Any) -> datetime:
    """Pandas timestamps arrive tz-naive or tz-aware; the store wants aware."""
    stamp = value.to_pydatetime() if hasattr(value, "to_pydatetime") else value
    if not isinstance(stamp, datetime):
        return datetime.now(timezone.utc)
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


ML_FIT_KIND = "ml.fit"

#: The sentence a reader is given for each PBO outcome. The runner decides the
#: FACT and records a code on `MLRunResult.pbo_basis`; the wording lives here,
#: in one place, because the portal's capsule quotes this file rather than
#: composing its own explanation for the same null. A computed PBO needs no
#: excuse, so its entry is absent and `.get` returns None.
PBO_REASONS: dict[str, str] = {
    PBO_ONE_CONFIGURATION:
        "not applicable: PBO ranks a selected configuration against the "
        "alternatives it was selected from, and this run fitted one",
    PBO_TOO_FEW_FOLDS:
        f"not computed: fewer than {MIN_RANKED_FOLDS} folds ranked their selection, and a "
        f"fraction of one or two folds is not a probability — it is 0, a half or 1, and 0 "
        f"would read as evidence of no overfitting rather than as no evidence",
    PBO_NO_FOLDS:
        "not computed: no fold produced a usable result, so nothing was selected and "
        "nothing was ranked",
}


def run_ml_fit_job(params: dict[str, Any]) -> dict[str, Any]:
    """The job body: fit, then file.

    Runs on a worker thread, so the persist — the only async part — is driven
    through a dedicated loop rather than the gateway's. A fit is CPU-bound for
    seconds; holding a request open for it is what the queue exists to avoid.

    That dedicated loop is why the store below is a PRIVATE one. The
    process-wide singleton's httpx client is bound to the gateway's loop, and
    awaiting it from the loop `asyncio.run` creates raises

        RuntimeError: <asyncio.locks.Event object ...> is bound to a
        different event loop

    which is what the panel was reporting as "the model was fitted and not
    filed". Worse, the `finally` closed that SHARED client, so the first fit
    that did work would have taken the read routes down behind it.
    """
    import asyncio

    from modules.ml.store import MLRunStore, get_ml_store

    outcome, payload = run_ml_fit(**params)
    if not get_ml_store().enabled:
        # Read off the singleton because `enabled` is configuration, not I/O.
        # The run happened and its numbers are real; only the filing did not.
        # Saying so is the difference between "no corpus" and "no result".
        return _job_result(outcome, persisted=False, reason="supabase is not configured on this deployment")

    async def _file() -> Any:
        private = MLRunStore()  # built and closed on THIS loop, and only this one
        try:
            return await private.persist(**payload)
        finally:
            await private.stop()

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
                # The value the store filed, not a hard-coded null. This read
                # None for every run including the ones that had a PBO, so a
                # card could contradict the row it points at.
                "pbo": outcome.result.pbo if outcome.result else None,
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
        # Three fields, not one. "sklearn was asked for and numpy ran" is a
        # fact about the result, and a single `engine` field would leave the
        # reader unable to tell it from "numpy was asked for and numpy ran".
        "engine": outcome.engine,
        "engine_requested": outcome.engine_requested,
        "engine_reason": outcome.engine_reason,
        "folds": len(result.folds) if result else 0,
        "oos_sharpe": result.oos_sharpe if result else None,
        "deflated_sharpe": result.deflated_sharpe if result else None,
        "verdict": result.verdict if result else None,
        # How many bars this record would need for its Sharpe to be real, or
        # None when the Sharpe is not positive — no finite record proves an
        # edge that is not there, and infinity is not a length.
        "min_track_record_bars": result.min_track_record_bars if result else None,
        "candidates": result.candidates_tested if result else 0,
        "pbo": result.pbo if result else None,
        # Stated, not omitted: a null column with no explanation reads as a
        # figure that failed to compute rather than one that does not apply.
        "pbo_reason": PBO_REASONS.get(result.pbo_basis if result else PBO_NO_FOLDS),
    }


def submit_ml_fit(params: dict[str, Any], *, actor: str) -> Any:
    """Queue a fit. The caller polls `/api/data/jobs` for the outcome."""
    from modules.jobs import get_queue

    return get_queue().submit(
        ML_FIT_KIND, run_ml_fit_job, params, meta={"actor": actor, "params": params},
    )
