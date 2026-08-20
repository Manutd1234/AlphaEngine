"""
Module C — Asynchronous Parametric Backtester
==============================================

Trading alpha
-------------
Hypothesis testing is throughput-bound: the desk that can evaluate 400
parameterisations of an idea in a minute — *and correctly discount the winner
for having looked at 400 of them* — iterates faster than one that cannot. This
module decouples the sweep from the trader's terminal and returns a result that
has already been penalised for selection bias.

Why the statistics matter more than the engine
-----------------------------------------------
Any framework can report the best Sharpe in a grid. The best Sharpe in a grid of
400 is a *maximum of 400 draws* and is upward-biased almost by construction — a
grid of pure noise reliably produces "Sharpe 1.8" somewhere. Two corrections are
therefore applied and reported alongside every sweep:

* **Deflated Sharpe Ratio** (Bailey & López de Prado, 2014) — the probability
  that the selected strategy's true Sharpe exceeds zero, given the number of
  trials, the dispersion of their Sharpes, and the non-normality (skew/kurtosis)
  of the return stream. A DSR below ~0.95 means the winner is not distinguishable
  from the best of N coin flips.
* **Walk-forward evaluation** — parameters are chosen in-sample on each fold and
  scored on the *next*, unseen fold. The reported OOS Sharpe is the number a
  trader should size on; the in-sample Sharpe is marketing.

Engines
-------
``vectorbt`` is used when importable (the whole grid runs as one 2-D portfolio).
A dependency-free NumPy engine implements the same accounting as a fallback so
the module never becomes unrunnable because of a numba/NumPy ABI mismatch. The
test-suite asserts the two agree.

The module became a package, split by the concerns its own banner comments
already marked. Every public name is re-exported, so the callers across the
gateway keep working unchanged.
"""

from __future__ import annotations

from modules.backtester._common import (
    VECTORBT_AVAILABLE,
    bars_per_year,
)
from modules.backtester.data import (
    fetch_binance_range,
    fetch_ohlcv,
)
from modules.backtester.engines import (
    NumpyEngine,
    VectorbtEngine,
    dataset_fingerprint,
    get_engine,
    overfitting_probability,
    walk_forward,
)
from modules.backtester.grid import (
    param_grid,
)
from modules.backtester.indicators import (
    FREE_FIRST_AXIS,
    FREE_SECOND_AXIS,
    LINREG_COLS,
    LINREG_MIN_ROWS,
    LINREG_REFIT_EVERY,
    LINREG_WARMUP,
)
from modules.backtester.plots import (
    plot_equity_curve,
    plot_heatmap,
)
from modules.backtester.run import (
    run_backtest,
)
from modules.backtester.signals import (
    build_signals,
)

# Private helpers imported by name elsewhere: `modules/ml/runner.py` reuses the
# same Sharpe and drawdown the sweeps use, deliberately — a research plane with
# two definitions of either has none.
from modules.backtester.statistics import (  # noqa: F401
    _annualised_sharpe,
    _max_drawdown,
    _norm_ppf,
    _sortino,
    deflated_sharpe_ratio,
    dsr_verdict,
    min_track_record_length,
    probabilistic_sharpe_ratio,
)

__all__ = [
    "FREE_FIRST_AXIS",
    "FREE_SECOND_AXIS",
    "LINREG_COLS",
    "LINREG_MIN_ROWS",
    "LINREG_REFIT_EVERY",
    "LINREG_WARMUP",
    "NumpyEngine",
    "VECTORBT_AVAILABLE",
    "VectorbtEngine",
    "bars_per_year",
    "build_signals",
    "dataset_fingerprint",
    "deflated_sharpe_ratio",
    "dsr_verdict",
    "fetch_binance_range",
    "fetch_ohlcv",
    "get_engine",
    "min_track_record_length",
    "overfitting_probability",
    "param_grid",
    "plot_equity_curve",
    "plot_heatmap",
    "probabilistic_sharpe_ratio",
    "run_backtest",
    "walk_forward",
]
