"""One request in, one BacktestResult out."""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Callable

import numpy as np
import pandas as pd

from config import settings
from modules.backtester._common import bars_per_year
from modules.backtester.data import fetch_ohlcv
from modules.backtester.engines import (
    NumpyEngine,
    dataset_fingerprint,
    get_engine,
    overfitting_probability,
    walk_forward,
)
from modules.backtester.grid import param_grid
from modules.backtester.plots import plot_equity_curve, plot_heatmap
from modules.backtester.statistics import (
    _annualised_sharpe,
    _max_drawdown,
    deflated_sharpe_ratio,
    dsr_verdict,
    min_track_record_length,
)
from modules.schemas import (
    BacktestRequest,
    BacktestResult,
    WalkForwardFold,
)

log = logging.getLogger("alphaengine.backtest")

# --------------------------------------------------------------------------- #
# Orchestration — the callable the job queue dispatches
# --------------------------------------------------------------------------- #
def run_backtest(req_dict: dict[str, Any], job_id: str = "local",
                 progress: Callable[[float, str], None] | None = None) -> dict[str, Any]:
    """Full sweep + statistics + plots. Returns a JSON-safe dict (Celery-friendly)."""
    t0 = time.perf_counter()
    req = BacktestRequest(**req_dict) if isinstance(req_dict, dict) else req_dict
    warnings: list[str] = []

    def report(pct: float, msg: str) -> None:
        if progress:
            progress(pct, msg)
        log.info("[%s] %.0f%% %s", job_id, pct * 100, msg)

    report(0.05, f"loading {req.bars} × {req.interval} bars of {req.symbol}")
    df, source = fetch_ohlcv(req.symbol, req.interval, req.bars)
    if source == "synthetic":
        warnings.append("Live market data unreachable — this run uses a deterministic synthetic price series.")
    if len(df) < 200:
        raise RuntimeError(f"insufficient data: {len(df)} bars")

    combos = param_grid(req)
    if not combos:
        raise ValueError("empty parameter grid (require fast < slow)")
    if len(combos) >= settings.backtest_max_combos:
        warnings.append(f"grid truncated to {len(combos)} combinations (BACKTEST_MAX_COMBOS)")

    engine = get_engine()
    report(0.15, f"{engine.name}: sweeping {len(combos)} parameter combinations")
    results, equities = engine.run(df, combos, req, report)
    best = max(results, key=lambda r: r.sharpe)
    best_equity = equities[(best.fast, best.slow)]

    # --- multiple-testing correction ------------------------------------- #
    ann = bars_per_year(req.interval)
    best_rets = np.diff(np.r_[1.0, best_equity]) / np.r_[1.0, best_equity][:-1]
    sr_per_bar = float(best_rets.mean() / best_rets.std(ddof=1)) if best_rets.std(ddof=1) > 0 else 0.0
    sr_candidates = np.array([r.sharpe / math.sqrt(ann) for r in results])
    skew = float(pd.Series(best_rets).skew() or 0.0)
    kurt = float((pd.Series(best_rets).kurtosis() or 0.0) + 3.0)  # pandas returns excess kurtosis
    dsr, psr, expected_max = deflated_sharpe_ratio(sr_candidates, sr_per_bar, len(best_rets), skew, kurt)
    mintrl = min_track_record_length(sr_per_bar, 0.0, skew, kurt)
    report(0.80, f"DSR {dsr:.3f} across {len(results)} trials")

    # --- walk-forward ----------------------------------------------------- #
    wf_folds: list[WalkForwardFold] = []
    wf_oos = None
    if req.walk_forward:
        report(0.84, f"walk-forward: {req.folds} folds")
        try:
            wf_folds, wf_oos = walk_forward(df, combos, req, NumpyEngine())
        except Exception as exc:
            warnings.append(f"walk-forward skipped: {exc}")
            log.warning("walk-forward failed: %s", exc)

    # --- benchmark & plots ------------------------------------------------ #
    bh_rets = df["close"].pct_change().fillna(0.0).to_numpy()
    bh_equity = np.cumprod(1 + bh_rets)
    benchmark = {
        "total_return": float(bh_equity[-1] - 1),
        "sharpe": _annualised_sharpe(bh_rets, ann),
        "max_drawdown": _max_drawdown(bh_equity),
    }

    report(0.90, "rendering equity curve and Sharpe surface")
    equity_png = plot_equity_curve(df, best_equity, best, req, wf_oos, dsr)
    heatmap_png = plot_heatmap(results, req)

    step = max(1, len(df) // 400)  # thin the curve for the browser payload
    result = BacktestResult(
        job_id=job_id,
        request=req,
        engine=engine.name,
        data_source=source,
        bars=len(df),
        period_start=str(df.index[0])[:16],
        period_end=str(df.index[-1])[:16],
        data_hash=dataset_fingerprint(df),
        combos_tested=len(results),
        best=best,
        benchmark_buy_hold=benchmark,
        top_results=sorted(results, key=lambda r: r.sharpe, reverse=True)[:15],
        deflated_sharpe_ratio=round(dsr, 4),
        probabilistic_sharpe_ratio=round(psr, 4),
        min_track_record_bars=round(mintrl, 1) if math.isfinite(mintrl) else None,
        dsr_verdict=dsr_verdict(dsr),
        walk_forward=wf_folds,
        walk_forward_oos_sharpe=round(wf_oos, 3) if wf_oos is not None else None,
        overfitting_probability=overfitting_probability(wf_folds),
        equity_curve_png=equity_png,
        heatmap_png=heatmap_png,
        equity_curve={
            "ts": [str(t)[:16] for t in df.index[::step]],
            "strategy": [round(float(v), 6) for v in best_equity[::step]],
            "buy_hold": [round(float(v), 6) for v in bh_equity[::step]],
        },
        duration_s=round(time.perf_counter() - t0, 2),
        warnings=warnings,
    )

    try:
        from modules.audit import get_audit

        get_audit().record_backtest(result, result.duration_s)
    except Exception as exc:
        log.warning("backtest audit write failed: %s", exc)

    report(1.0, "done")
    return result.model_dump(mode="json")
