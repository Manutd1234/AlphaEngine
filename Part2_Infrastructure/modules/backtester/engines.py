"""The NumPy engine, the optional vectorbt one, and the walk-forward over both."""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Callable

import numpy as np
import pandas as pd

from config import settings
from modules.backtester._common import VECTORBT_AVAILABLE, bars_per_year, vbt
from modules.backtester.signals import build_signals
from modules.backtester.statistics import _annualised_sharpe, _max_drawdown, _sortino
from modules.schemas import (
    BacktestRequest,
    ParamResult,
    WalkForwardFold,
)

log = logging.getLogger("alphaengine.backtest")

# --------------------------------------------------------------------------- #
# Engines
# --------------------------------------------------------------------------- #
def _stats_from_returns(
    strat_rets: np.ndarray, position: np.ndarray, turnover_units: float,
    fees_paid: float, ann: float, trades: int, wins: int,
) -> dict[str, float]:
    equity = np.cumprod(1.0 + strat_rets)
    total_return = float(equity[-1] - 1.0) if equity.size else 0.0
    years = len(strat_rets) / ann if ann else 0.0
    cagr = float((1 + total_return) ** (1 / years) - 1) if years > 0 and total_return > -1 else 0.0
    mdd = _max_drawdown(equity)
    return {
        "total_return": total_return,
        "cagr": cagr,
        "sharpe": _annualised_sharpe(strat_rets, ann),
        "sortino": _sortino(strat_rets, ann),
        "max_drawdown": mdd,
        "calmar": float(cagr / abs(mdd)) if mdd < 0 else 0.0,
        "win_rate": float(wins / trades) if trades else 0.0,
        "trades": int(trades),
        "exposure": float(np.mean(np.abs(position) > 0)),
        "turnover": float(turnover_units),
        "fees_paid": float(fees_paid),
    }


class NumpyEngine:
    """Reference implementation. Vectorised, dependency-free, fully auditable.

    Accounting conventions (identical to the vectorbt configuration):
      * signals are generated on bar *t* and executed on bar *t+1*'s open-to-close
        return — no look-ahead;
      * costs = (fee + slippage) bps charged on the *notional turnover* of every
        position change;
      * returns compound on equity, i.e. constant-fraction (100%) position sizing.
    """

    name = "numpy-vectorised"

    def run(self, df: pd.DataFrame, combos: list[tuple[int, int]], req: BacktestRequest,
            progress: Callable[[float, str], None] | None = None) -> tuple[list[ParamResult], dict[tuple[int, int], np.ndarray]]:
        close = df["close"]
        px_ret = close.pct_change().fillna(0.0).to_numpy()
        ann = bars_per_year(req.interval)
        cost = (req.fee_bps + req.slippage_bps) / 1e4

        results: list[ParamResult] = []
        equities: dict[tuple[int, int], np.ndarray] = {}

        for i, (fast, slow) in enumerate(combos):
            entries, exits = build_signals(req.strategy, df, fast, slow)
            raw = pd.Series(np.nan, index=close.index)
            raw[entries.to_numpy()] = 1.0
            raw[exits.to_numpy()] = -1.0 if req.direction == "long_short" else 0.0
            position = raw.ffill().fillna(0.0).to_numpy()

            lagged = np.r_[0.0, position[:-1]]            # execute next bar
            turnover = np.abs(np.diff(np.r_[0.0, lagged]))
            strat_rets = lagged * px_ret - turnover * cost
            equity = np.cumprod(1.0 + strat_rets)

            changes = np.flatnonzero(turnover > 0)
            trades = wins = 0
            # Truncating is intended: with no position changes the right-hand
            # array still holds the end sentinel, and "no changes" means "no
            # trades to pair up".
            for a, b in zip(changes, np.r_[changes[1:], len(strat_rets)], strict=False):
                if lagged[a] == 0:
                    continue
                trades += 1
                if equity[b - 1] / (equity[a - 1] if a > 0 else 1.0) > 1:
                    wins += 1

            # Cost in dollars on a $100k book (vectorbt's init_cash), so the two
            # engines' `fees_paid` are directly comparable: each rebalance is
            # charged on the equity actually deployed at that bar.
            fees_usd = float(np.sum(turnover * cost * np.r_[1.0, equity[:-1]]) * 100_000.0)
            stats = _stats_from_returns(
                strat_rets, lagged, float(turnover.sum()), fees_usd, ann, trades, wins,
            )
            results.append(ParamResult(fast=fast, slow=slow, **stats))
            equities[(fast, slow)] = equity
            if progress and i % 10 == 0:
                progress(0.15 + 0.6 * i / max(1, len(combos)), f"swept {i}/{len(combos)} combinations")

        return results, equities


class VectorbtEngine:
    """Primary engine — the full grid runs as a single 2-D vectorbt portfolio."""

    name = "vectorbt"

    def run(self, df: pd.DataFrame, combos: list[tuple[int, int]], req: BacktestRequest,
            progress: Callable[[float, str], None] | None = None) -> tuple[list[ParamResult], dict[tuple[int, int], np.ndarray]]:
        close = df["close"]
        cols = pd.MultiIndex.from_tuples(combos, names=["fast", "slow"])
        entries = pd.DataFrame(False, index=close.index, columns=cols)
        exits = pd.DataFrame(False, index=close.index, columns=cols)

        for i, (fast, slow) in enumerate(combos):
            e, x = build_signals(req.strategy, df, fast, slow)
            entries[(fast, slow)] = e.to_numpy()
            exits[(fast, slow)] = x.to_numpy()
            if progress and i % 25 == 0:
                progress(0.15 + 0.25 * i / max(1, len(combos)), f"built signals {i}/{len(combos)}")

        if progress:
            progress(0.45, f"running {len(combos)}-combination vectorbt sweep")

        kwargs: dict[str, Any] = dict(
            init_cash=100_000.0,
            fees=req.fee_bps / 1e4,
            slippage=req.slippage_bps / 1e4,
        )
        if req.direction == "long_short":
            kwargs["direction"] = "both"
        pf = vbt.Portfolio.from_signals(close, entries, exits, **kwargs)

        ann = bars_per_year(req.interval)
        value = pf.value()
        rets = value.pct_change().fillna(0.0)

        trades_count = pf.trades.count()
        try:
            win_rate = pf.trades.win_rate().fillna(0.0)
        except Exception:
            win_rate = pd.Series(0.0, index=trades_count.index)

        # Position series -> exposure. (asset_flow() is per-bar *change*, so it
        # measures trade frequency, not time in market.)
        assets = pf.assets()

        # Realised costs and traded notional, straight from the order records.
        fees_by_col: dict[Any, float] = {}
        turnover_by_col: dict[Any, float] = {}
        try:
            recs = pf.orders.records_readable
            recs = recs.assign(_notional=recs["Size"] * recs["Price"])
            fees_by_col = recs.groupby("Column")["Fees"].sum().to_dict()
            turnover_by_col = recs.groupby("Column")["_notional"].sum().to_dict()
        except Exception as exc:  # pragma: no cover - vectorbt version drift
            log.warning("could not read order records for cost attribution: %s", exc)

        results: list[ParamResult] = []
        equities: dict[tuple[int, int], np.ndarray] = {}
        for key in combos:
            col_rets = rets[key].to_numpy()
            col_val = value[key].to_numpy()
            equity = col_val / col_val[0]
            total_return = float(equity[-1] - 1.0)
            years = len(col_rets) / ann if ann else 0.0
            cagr = float((1 + total_return) ** (1 / years) - 1) if years > 0 and total_return > -1 else 0.0
            mdd = _max_drawdown(equity)
            n_trades = int(trades_count.get(key, 0))
            results.append(ParamResult(
                fast=key[0], slow=key[1],
                total_return=total_return,
                cagr=cagr,
                sharpe=_annualised_sharpe(col_rets, ann),
                sortino=_sortino(col_rets, ann),
                max_drawdown=mdd,
                calmar=float(cagr / abs(mdd)) if mdd < 0 else 0.0,
                win_rate=float(win_rate.get(key, 0.0) or 0.0),
                trades=n_trades,
                exposure=float((assets[key].to_numpy() != 0).mean()),
                # Turnover as a multiple of initial capital — same unit as the
                # NumPy engine's sum of |Δposition| under constant-fraction sizing.
                turnover=float(turnover_by_col.get(key, 0.0)) / 100_000.0,
                fees_paid=float(fees_by_col.get(key, 0.0)),
            ))
            equities[key] = equity

        if progress:
            progress(0.75, "sweep complete")
        return results, equities


def get_engine(prefer_vectorbt: bool = True):
    if prefer_vectorbt and VECTORBT_AVAILABLE:
        return VectorbtEngine()
    return NumpyEngine()


# --------------------------------------------------------------------------- #
# Walk-forward
# --------------------------------------------------------------------------- #
def walk_forward(df: pd.DataFrame, combos: list[tuple[int, int]], req: BacktestRequest,
                 engine) -> tuple[list[WalkForwardFold], float | None]:
    """Rolling, non-anchored: optimise on segment *i*, trade segment *i+1*.

    The aggregate OOS Sharpe is the honest estimate — it is the only number here
    computed on data the parameter choice never touched.

    ``embargo_bars`` discards a gap between each training window and its test
    window. Adjacent folds leak: a 200-bar moving average evaluated on the first
    test bar is mostly made of training bars, so the "out-of-sample" score is
    partly in-sample. An embargo at least as long as the slowest lookback
    removes that overlap. It defaults to 0, which keeps the original behaviour.
    """
    n = len(df)
    folds = max(2, min(req.folds, settings.walk_forward_folds if req.folds is None else req.folds))
    seg = n // (folds + 1)
    if seg < 100:
        return [], None

    embargo = max(0, min(int(getattr(req, "embargo_bars", 0) or 0), max(0, seg - 50)))

    out: list[WalkForwardFold] = []
    oos_returns: list[np.ndarray] = []
    ann = bars_per_year(req.interval)

    for i in range(folds):
        # The embargo comes out of the *training* window's tail rather than
        # shifting the test window: shifting would walk the last fold off the
        # end of the data and quietly drop it.
        train = df.iloc[i * seg:(i + 1) * seg - embargo]
        test = df.iloc[(i + 1) * seg:(i + 2) * seg]
        if len(test) < 50 or len(train) < 50:
            break

        is_results, _ = engine.run(train, combos, req)
        best_is = max(is_results, key=lambda r: r.sharpe)

        # Score the *whole* grid out-of-sample, not just the winner. One OOS
        # Sharpe cannot distinguish "this parameter choice was right" from "this
        # fold was easy for everything"; the winner's rank among its peers can.
        oos_results, _ = engine.run(test, combos, req)
        by_combo = {(r.fast, r.slow): r for r in oos_results}
        oos = by_combo.get((best_is.fast, best_is.slow))
        if oos is None:
            oos = engine.run(test, [(best_is.fast, best_is.slow)], req)[0][0]
        ranked = sorted(oos_results, key=lambda r: r.sharpe, reverse=True)
        oos_rank = next(
            (i + 1 for i, r in enumerate(ranked) if (r.fast, r.slow) == (best_is.fast, best_is.slow)),
            None,
        )

        # Recompute the OOS return stream so folds can be concatenated.
        entries, exits = build_signals(req.strategy, test, best_is.fast, best_is.slow)
        raw = pd.Series(np.nan, index=test.index)
        raw[entries.to_numpy()] = 1.0
        raw[exits.to_numpy()] = -1.0 if req.direction == "long_short" else 0.0
        pos = raw.ffill().fillna(0.0).to_numpy()
        lagged = np.r_[0.0, pos[:-1]]
        px_ret = test["close"].pct_change().fillna(0.0).to_numpy()
        cost = (req.fee_bps + req.slippage_bps) / 1e4
        oos_returns.append(lagged * px_ret - np.abs(np.diff(np.r_[0.0, lagged])) * cost)

        out.append(WalkForwardFold(
            fold=i + 1,
            train_start=str(train.index[0])[:16], train_end=str(train.index[-1])[:16],
            test_start=str(test.index[0])[:16], test_end=str(test.index[-1])[:16],
            chosen_fast=best_is.fast, chosen_slow=best_is.slow,
            is_sharpe=round(best_is.sharpe, 3),
            oos_sharpe=round(oos.sharpe, 3),
            oos_return=round(oos.total_return, 5),
            oos_rank=oos_rank,
            combos_ranked=len(ranked),
            embargo_bars=embargo,
        ))

    agg = _annualised_sharpe(np.concatenate(oos_returns), ann) if oos_returns else None
    return out, agg


def overfitting_probability(folds: list[WalkForwardFold]) -> float | None:
    """Probability that the chosen parameters are no better than a coin flip.

    A lightweight reading of Bailey et al.'s probability of backtest
    overfitting: in each fold the in-sample winner is ranked against every other
    combination out-of-sample, and PBO is the fraction of folds where it landed
    in the *worse* half. A strategy whose winners keep placing in the bottom
    half is being selected by noise — the grid search is fitting the fold, not
    the market.

    This is the cheap version. Full CPCV evaluates every train/test split
    combinatorially rather than the sequential folds used here, which costs
    factorially more compute for a tighter estimate of the same quantity.
    Returns ``None`` when no fold produced a rank.
    """
    ranked = [f for f in folds if f.oos_rank and f.combos_ranked and f.combos_ranked > 1]
    if not ranked:
        return None
    # Median rank is the midpoint: worse than median is the losing half.
    losses = sum(1 for f in ranked if f.oos_rank > (f.combos_ranked + 1) / 2)
    return round(losses / len(ranked), 4)


def dataset_fingerprint(df: pd.DataFrame) -> str:
    """SHA-256 over the price series this run actually saw.

    A symbol and a date range do not identify a dataset. The same window can be
    a live Binance pull, a cached copy, or an explicitly requested synthetic
    demonstration. Two runs that share this hash provably compared the same
    bars; two that do not are not comparable however similar their headers
    look.

    Every price column is hashed, not just the close: ``donchian`` reads highs
    and lows, so a vendor revising a session high changes the signal while the
    close is untouched. A fingerprint that missed that would certify two runs as
    comparable at exactly the moment they stopped being so.
    """
    digest = hashlib.sha256()
    for column in ("open", "high", "low", "close"):
        if column in df.columns:
            digest.update(column.encode())
            digest.update(np.ascontiguousarray(df[column].to_numpy(dtype="float64")).tobytes())
    digest.update(str(df.index[0]).encode())
    digest.update(str(df.index[-1]).encode())
    digest.update(str(len(df)).encode())
    return digest.hexdigest()[:16]
