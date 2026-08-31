"""Module C — backtest sweeps, walk-forward folds and the job envelope.

Split out of ``modules/schemas.py``; field order is a wire contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------------------- #
# Module C — Backtest
# --------------------------------------------------------------------------- #
class BacktestRequest(BaseModel):
    """Every tunable a sweep accepts, with its bounds.

    This model is the parameter registry: the bounds and descriptions here are
    what ``/docs`` publishes, so a researcher reads one place to learn what can
    be varied and how far. Widening a bound is therefore a documented change,
    not a silent one.
    """

    symbol: str = Field(default="BTCUSDT", description="Instrument to test, e.g. BTCUSDT.")
    interval: str = Field(default="1h", description="Bar size: 15m, 1h, 4h or 1d.")
    bars: int = Field(default=1500, ge=200, le=5000,
                      description="History depth in bars. Fewer than ~500 makes walk-forward folds too short to read.")
    data_mode: Literal["observed", "synthetic_demo"] = Field(
        default="observed",
        description=(
            "Observed tries Binance then the recorded DuckDB cache and fails if both are unavailable. "
            "Synthetic_demo is an explicit, labelled demonstration using generated non-market bars."
        ),
    )
    strategy: Literal[
        "ma_cross", "ema_cross", "macd_cross",
        "donchian", "donchian_mid", "breakout_sma",
        "rsi_reversion", "williams_r", "stochastic",
        "momentum", "roc_trend",
        "triple_ma", "ppo_cross", "trix_cross", "rsi_trend",
        "price_channel", "ema_slope",
        "bollinger_breakout", "zscore_reversion",
        "atr_breakout", "keltner_breakout", "supertrend", "atr_trailing_stop",
        "obv_trend", "volume_breakout", "mfi_reversion",
        "dema_cross", "tema_cross", "zlema_cross", "hull_trend", "vwap_trend",
        "cci_reversion", "awesome_cross", "cmo_trend", "stoch_rsi_x", "dpo_reversion",
        "bollinger_pctb", "stddev_channel", "chaikin_volatility", "ulcer_filter",
        "cmf_trend", "force_index", "eom_trend", "aroon_cross", "vortex_cross",
        "linreg_forecast",
    ] = Field(
        default="ma_cross", description="Signal family. Each interprets fast/slow as its own two parameters.")
    fast_min: int = Field(default=5, ge=2, le=400, description="Lower bound of the fast-parameter sweep.")
    fast_max: int = Field(default=40, ge=2, le=400, description="Upper bound of the fast-parameter sweep.")
    fast_step: int = Field(default=5, ge=1, le=100, description="Grid spacing for the fast parameter.")
    slow_min: int = Field(default=20, ge=3, le=800, description="Lower bound of the slow-parameter sweep.")
    slow_max: int = Field(default=200, ge=3, le=800, description="Upper bound of the slow-parameter sweep.")
    slow_step: int = Field(default=20, ge=1, le=200, description="Grid spacing for the slow parameter.")
    fee_bps: float = Field(default=6.0, ge=0, le=100,
                           description="Per-side taker fee in basis points, charged on turnover.")
    slippage_bps: float = Field(default=2.0, ge=0, le=100,
                                description="Per-side slippage assumption in basis points. Setting both cost "
                                            "fields to 0 produces a frictionless result that will not survive live.")
    direction: Literal["long_only", "long_short"] = Field(
        default="long_only", description="Whether short signals are traded or flattened to cash.")
    walk_forward: bool = Field(default=True,
                               description="Run out-of-sample folds. Disable only for a quick in-sample look.")
    folds: int = Field(default=4, ge=2, le=10, description="Number of walk-forward folds.")
    embargo_bars: int = Field(
        default=0, ge=0, le=500,
        description="Bars discarded between each training window and its test window. Guards against "
                    "leakage from indicator lookback spanning the boundary; 0 keeps folds adjacent.")
    label: str | None = Field(
        default=None, max_length=120,
        description="Optional human label for this run, stored with the audit record.")
    notify_chat_id: str | None = Field(
        default=None, description="Telegram chat to notify when the job finishes.")

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class ParamResult(BaseModel):
    # float, not int. Most strategies sweep two lookback periods, but a few
    # take a standard-deviation multiple on the second axis, and 2.5 sigma is
    # not expressible as an integer without lying about the units. Widening the
    # field costs nothing: every period value is still an exact float.
    fast: float
    slow: float
    total_return: float
    cagr: float
    sharpe: float
    sortino: float
    max_drawdown: float
    calmar: float
    win_rate: float
    trades: int
    exposure: float
    turnover: float
    fees_paid: float


class WalkForwardFold(BaseModel):
    fold: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    chosen_fast: float
    chosen_slow: float
    is_sharpe: float
    oos_sharpe: float
    oos_return: float
    # Where the in-sample winner actually placed out-of-sample, among all
    # combinations scored on this fold. Rank 1 of 40 means the choice held up;
    # rank 33 of 40 means the fold selected noise. This is the per-fold input to
    # the probability-of-backtest-overfitting estimate.
    oos_rank: int | None = None
    combos_ranked: int | None = None
    embargo_bars: int = 0


class BacktestResult(BaseModel):
    job_id: str
    request: BacktestRequest
    engine: str
    data_source: str
    bars: int
    period_start: str
    period_end: str
    # Content hash of the bars this run saw. A date range does not identify a
    # dataset — a revised bar, a different venue, or explicit synthetic_demo
    # data all produce the same window with different numbers. Two runs sharing this
    # value provably compared the same prices.
    data_hash: str | None = None
    combos_tested: int
    best: ParamResult
    benchmark_buy_hold: dict[str, float]
    top_results: list[ParamResult]
    deflated_sharpe_ratio: float
    probabilistic_sharpe_ratio: float
    # Minimum Track Record Length at 95% confidence vs a zero benchmark — how
    # many bars this Sharpe would need to be statistically real. None when the
    # per-bar Sharpe is not positive (no finite record proves an absent edge).
    min_track_record_bars: float | None = None
    dsr_verdict: str
    walk_forward: list[WalkForwardFold]
    walk_forward_oos_sharpe: float | None
    # Fraction of folds whose in-sample winner placed in the worse half
    # out-of-sample. High values mean the grid search is selecting noise.
    overfitting_probability: float | None = None
    equity_curve_png: str | None
    heatmap_png: str | None
    equity_curve: dict[str, list[Any]] | None = None
    duration_s: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class JobStatus(BaseModel):
    job_id: str
    kind: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    progress: float = 0.0
    message: str = ""
    submitted_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    backend: str = "in-process"
