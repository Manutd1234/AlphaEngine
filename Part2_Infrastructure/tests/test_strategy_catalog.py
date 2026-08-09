"""Every strategy in the catalogue actually trades, and both engines agree.

Two failure modes this exists for, both silent:

A strategy that never fires is not a conservative model, it is a broken one.
It contributes a flat equity curve, a Sharpe of zero and no error — and in a
sweep across a grid it simply looks like a bad parameter region. `stochastic`
shipped in this state for exactly one commit, because its entry required
`%K < 20 AND %K > %D` at the same instant, which is the crossing moment and
almost never coincides.

And a strategy present in one engine but not the other fails only when someone
runs the Python path, long after the TypeScript one was reviewed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from modules.backtester import FREE_SECOND_AXIS, build_signals


def _second_axis(strategy: str) -> float:
    """A period for most models, a sigma multiple for the few with a free axis.

    Passing 40 to a strategy whose second parameter is a standard-deviation
    multiple asks for a 40-sigma band, which nothing ever crosses — the test
    would report a broken strategy when the caller was the one confused.
    """
    free = FREE_SECOND_AXIS.get(strategy)
    if free is None:
        return 40
    # The declared MINIMUM, not a fixed 2.0. Each free axis has its own units
    # and its own sensible span — a 2.0 setting is a wide Bollinger band and an
    # almost unreachable single-bar ATR breakout. The question this test asks is
    # "can this strategy trade anywhere in the range its author declared", and
    # the low end is the most permissive point in that range.
    return free[0]

CATALOGUE = [
    "ma_cross", "ema_cross", "macd_cross",
    "donchian", "donchian_mid", "breakout_sma",
    "rsi_reversion", "williams_r", "stochastic",
    "momentum", "roc_trend",
    "triple_ma", "ppo_cross", "trix_cross", "rsi_trend",
    "price_channel", "ema_slope",
    "bollinger_breakout", "zscore_reversion",
    "atr_breakout", "keltner_breakout", "supertrend", "atr_trailing_stop",
]


@pytest.fixture
def bars() -> pd.DataFrame:
    """A trending-then-ranging series, so both regimes are represented.

    Pure random walk under-triggers trend models and over-triggers reversion
    ones; a series with a drift phase and a flat phase exercises both without
    being tuned to flatter any particular strategy.
    """
    rng = np.random.default_rng(7)
    trend = 100 * np.cumprod(1 + rng.normal(0.0015, 0.012, 400))
    flat = trend[-1] * np.cumprod(1 + rng.normal(0.0, 0.010, 400))
    close = pd.Series(np.concatenate([trend, flat]))
    return pd.DataFrame({
        "open": close,
        "close": close,
        "high": close * 1.006,
        "low": close * 0.994,
        "volume": pd.Series(np.ones(len(close))),
    })


@pytest.mark.parametrize("strategy", CATALOGUE)
def test_every_strategy_takes_at_least_one_round_trip(strategy: str, bars: pd.DataFrame):
    entries, exits = build_signals(strategy, bars, 10, _second_axis(strategy))
    assert entries.sum() > 0, f"{strategy} never entered — it cannot lose money or make any"
    assert exits.sum() > 0, f"{strategy} entered and never exited"


@pytest.mark.parametrize("strategy", CATALOGUE)
def test_entries_and_exits_alternate(strategy: str, bars: pd.DataFrame):
    """A state machine, not two independent signals.

    Two entries with no exit between them would double-count a position in any
    engine that trusts the pair, and the vectorised path does.
    """
    entries, exits = build_signals(strategy, bars, 10, _second_axis(strategy))
    events = sorted(
        [(i, "entry") for i in np.flatnonzero(entries.to_numpy())]
        + [(i, "exit") for i in np.flatnonzero(exits.to_numpy())]
    )
    last = "exit"
    for index, kind in events:
        assert kind != last, f"{strategy} produced two consecutive {kind}s at bar {index}"
        last = kind


@pytest.mark.parametrize("strategy", CATALOGUE)
def test_no_lookahead_a_bar_cannot_depend_on_its_own_future(strategy: str, bars: pd.DataFrame):
    """Truncating the series must not change the signals that precede the cut.

    This is the property that makes a backtest meaningful at all, and it is
    cheap to lose: one un-shifted `rolling().max()` reads the current bar's own
    high, and the result looks like a brilliant strategy.
    """
    second = _second_axis(strategy)
    full_entries, _ = build_signals(strategy, bars, 10, second)
    cut = len(bars) - 50
    partial_entries, _ = build_signals(strategy, bars.iloc[:cut].copy(), 10, second)

    # Compare only where both are defined, ignoring the warm-up region.
    a = full_entries.to_numpy()[:cut][100:]
    b = partial_entries.to_numpy()[100:]
    assert np.array_equal(a, b), (
        f"{strategy} changed its past when future bars were removed — it is reading ahead"
    )


def test_the_catalogue_matches_the_request_schema():
    """The list here and the type the API accepts cannot drift apart."""
    from modules.schemas import BacktestRequest

    declared = BacktestRequest.model_fields["strategy"].annotation
    allowed = set(getattr(declared, "__args__", ()))
    assert set(CATALOGUE) == allowed, "the catalogue and the accepted strategy names disagree"
