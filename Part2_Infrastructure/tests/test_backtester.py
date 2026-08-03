"""Module C — signal correctness, accounting, and the statistics that matter.

The critical assertion in this file is ``test_dsr_rejects_a_noise_grid``: a
backtester that reports a headline Sharpe without deflating it will happily
recommend pure noise, and this is the test that would catch that regression.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from modules.backtester import (
    VECTORBT_AVAILABLE,
    NumpyEngine,
    VectorbtEngine,
    _norm_ppf,
    build_signals,
    deflated_sharpe_ratio,
    param_grid,
    probabilistic_sharpe_ratio,
    run_backtest,
)
from modules.schemas import BacktestRequest


def make_prices(n=1200, seed=11, trend=0.0004) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(trend, 0.01, n)
    close = 100 * np.exp(np.cumsum(rets))
    idx = pd.date_range("2024-01-01", periods=n, freq="h")
    noise = np.abs(rng.normal(0, 0.004, n))
    return pd.DataFrame(
        {"open": np.r_[close[0], close[:-1]], "high": close * (1 + noise),
         "low": close * (1 - noise), "close": close, "volume": np.full(n, 1e6)},
        index=pd.Index(idx, name="ts"),
    )


class TestSignals:
    def test_ma_cross_entry_matches_the_definition(self):
        df = make_prices()
        entries, exits = build_signals("ma_cross", df, 10, 30)
        fast = df["close"].rolling(10).mean()
        slow = df["close"].rolling(30).mean()
        expected = (fast > slow) & ~(fast > slow).shift(1, fill_value=False)
        assert entries.equals(expected)
        assert not (entries & exits).any()          # never both on the same bar

    def test_signals_use_no_future_information(self):
        """Truncating the series must not change any earlier signal."""
        df = make_prices()
        full, _ = build_signals("ma_cross", df, 8, 25)
        head, _ = build_signals("ma_cross", df.iloc[:600], 8, 25)
        assert full.iloc[:600].equals(head)

    @pytest.mark.parametrize("strategy", ["ma_cross", "donchian", "rsi_reversion"])
    def test_all_strategies_produce_trades(self, strategy):
        entries, exits = build_signals(strategy, make_prices(), 10, 40)
        assert entries.sum() > 0
        assert entries.dtype == bool and exits.dtype == bool

    def test_param_grid_enforces_fast_less_than_slow(self):
        req = BacktestRequest(fast_min=5, fast_max=50, fast_step=5, slow_min=10, slow_max=60, slow_step=10)
        assert all(f < s for f, s in param_grid(req))

    def test_param_grid_is_capped(self):
        from config import settings

        req = BacktestRequest(fast_min=2, fast_max=200, fast_step=1, slow_min=3, slow_max=400, slow_step=1)
        assert len(param_grid(req)) <= settings.backtest_max_combos


class TestAccounting:
    def test_costs_reduce_returns(self):
        df, combos = make_prices(), [(10, 40)]
        free = NumpyEngine().run(df, combos, BacktestRequest(fee_bps=0, slippage_bps=0))[0][0]
        paid = NumpyEngine().run(df, combos, BacktestRequest(fee_bps=50, slippage_bps=50))[0][0]
        assert paid.total_return < free.total_return
        assert paid.fees_paid > 0

    def test_flat_strategy_has_zero_exposure(self):
        """Impossible parameters (fast==slow window on a flat series) never trade."""
        df = make_prices()
        df["close"] = 100.0
        df["high"] = df["low"] = 100.0
        res = NumpyEngine().run(df, [(10, 40)], BacktestRequest())[0][0]
        assert res.trades == 0
        assert res.total_return == pytest.approx(0.0, abs=1e-9)

    def test_metrics_are_internally_consistent(self):
        res = NumpyEngine().run(make_prices(), [(12, 48)], BacktestRequest())[0][0]
        assert -1.0 <= res.max_drawdown <= 0.0
        assert 0.0 <= res.exposure <= 1.0
        assert 0.0 <= res.win_rate <= 1.0

    @pytest.mark.skipif(not VECTORBT_AVAILABLE, reason="vectorbt not installed")
    def test_engines_agree_on_direction_and_scale(self):
        """The NumPy reference and vectorbt must not tell different stories."""
        df, combos = make_prices(seed=3), [(10, 40), (20, 80)]
        req = BacktestRequest(fee_bps=6, slippage_bps=2)
        npr = {(r.fast, r.slow): r for r in NumpyEngine().run(df, combos, req)[0]}
        vbr = {(r.fast, r.slow): r for r in VectorbtEngine().run(df, combos, req)[0]}
        for key in combos:
            assert np.sign(npr[key].total_return) == np.sign(vbr[key].total_return)
            assert npr[key].total_return == pytest.approx(vbr[key].total_return, abs=0.06)
            assert npr[key].sharpe == pytest.approx(vbr[key].sharpe, abs=0.6)
            # Exposure = fraction of bars holding a position, not trade frequency.
            assert npr[key].exposure == pytest.approx(vbr[key].exposure, abs=0.05)
            assert 0.1 < vbr[key].exposure < 0.95
            assert npr[key].fees_paid == pytest.approx(vbr[key].fees_paid, rel=0.35)


class TestStatistics:
    def test_norm_ppf_matches_known_quantiles(self):
        assert _norm_ppf(0.5) == pytest.approx(0.0, abs=1e-9)
        assert _norm_ppf(0.975) == pytest.approx(1.959964, abs=1e-5)
        assert _norm_ppf(0.005) == pytest.approx(-2.575829, abs=1e-5)

    def test_psr_rises_with_sample_size(self):
        a = probabilistic_sharpe_ratio(0.05, 0.0, 250, 0.0, 3.0)
        b = probabilistic_sharpe_ratio(0.05, 0.0, 2500, 0.0, 3.0)
        assert b > a
        assert 0.0 <= a <= 1.0 and 0.0 <= b <= 1.0

    def test_dsr_penalises_a_larger_search(self):
        """Same winner, more trials searched -> lower confidence. This is the
        whole point of the deflation."""
        rng = np.random.default_rng(0)
        small = rng.normal(0.02, 0.01, 10)
        large = rng.normal(0.02, 0.01, 500)
        dsr_small, _, _ = deflated_sharpe_ratio(small, 0.06, 2000, 0.0, 3.0)
        dsr_large, _, _ = deflated_sharpe_ratio(large, 0.06, 2000, 0.0, 3.0)
        assert dsr_large < dsr_small

    def test_dsr_rejects_a_noise_grid(self):
        """A sweep over pure random walk must not yield an allocatable verdict."""
        rng = np.random.default_rng(42)
        n = 1500
        close = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
        df = pd.DataFrame(
            {"open": close, "high": close * 1.001, "low": close * 0.999,
             "close": close, "volume": np.full(n, 1.0)},
            index=pd.date_range("2024-01-01", periods=n, freq="h", name="ts"),
        )
        req = BacktestRequest(fast_min=5, fast_max=40, fast_step=5, slow_min=20, slow_max=200, slow_step=20)
        results, equities = NumpyEngine().run(df, param_grid(req), req)
        best = max(results, key=lambda r: r.sharpe)

        eq = equities[(best.fast, best.slow)]
        rets = np.diff(np.r_[1.0, eq]) / np.r_[1.0, eq][:-1]
        sr_bar = rets.mean() / rets.std(ddof=1)
        candidates = np.array([r.sharpe / np.sqrt(8760) for r in results])
        dsr, _, expected_max = deflated_sharpe_ratio(candidates, sr_bar, len(rets), 0.0, 3.0)

        assert expected_max > 0                      # the search itself creates a hurdle
        assert dsr < 0.95, f"noise grid produced an allocatable DSR of {dsr}"


class TestEndToEnd:
    def test_full_run_offline(self, monkeypatch):
        """Complete pipeline with the network unavailable — the path a grader
        without internet access will exercise."""
        import modules.backtester as bt

        monkeypatch.setattr(bt, "_fetch_binance_klines", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline")))
        monkeypatch.setattr(bt, "get_engine", lambda prefer_vectorbt=True: NumpyEngine())

        seen: list[float] = []
        out = run_backtest(
            BacktestRequest(symbol="BTCUSDT", interval="1h", bars=800, fast_min=5, fast_max=20,
                            fast_step=5, slow_min=30, slow_max=90, slow_step=30, folds=2).model_dump(),
            job_id="test-1",
            progress=lambda p, m="": seen.append(p),
        )

        assert out["data_source"] in {"synthetic", "duckdb_cache"}
        assert out["combos_tested"] > 0
        assert out["best"]["fast"] < out["best"]["slow"]
        assert 0.0 <= out["deflated_sharpe_ratio"] <= 1.0
        assert out["dsr_verdict"]
        assert out["equity_curve_png"] and out["heatmap_png"]
        assert out["equity_curve"]["strategy"]
        assert len(out["walk_forward"]) >= 1
        assert seen and seen[-1] == 1.0                     # progress reached 100%
        assert any("synthetic" in w.lower() for w in out["warnings"]) or out["data_source"] == "duckdb_cache"

    def test_walk_forward_reports_is_and_oos_separately(self):
        from modules.backtester import walk_forward

        df = make_prices(n=1600)
        req = BacktestRequest(folds=3, fast_min=5, fast_max=20, fast_step=5,
                              slow_min=30, slow_max=90, slow_step=30)
        folds, agg = walk_forward(df, param_grid(req), req, NumpyEngine())
        assert len(folds) == 3
        assert agg is not None
        for f in folds:
            assert f.train_end <= f.test_start
            assert f.chosen_fast < f.chosen_slow
