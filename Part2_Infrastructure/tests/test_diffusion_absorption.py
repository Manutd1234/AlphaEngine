"""The absorption path recovers a known decay, and refuses when it cannot.

Every case here is constructed, because the point of the file is that the
arithmetic is right before any of it is pointed at a market. A synthetic path
with a half-life the test chose is the only way to know that the number the
pipeline reports is the number that was put in.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.coherence.diffusion.absorption import (
    STAGE_HORIZONS,
    abnormal_path,
)
from modules.coherence.diffusion.bars import price_at, series_from_klines

STEP = 60_000
T0 = 1_700_000_000_000


def _series(prices, *, start=T0 - 200 * STEP, symbol="BTCUSDT", interval="1m"):
    raw = [[start + i * STEP, p, p, p, p, 1.0] for i, p in enumerate(prices)]
    return series_from_klines(symbol, interval, raw)


def _decay_prices(*, half_life_min: float, jump: float = 0.02, pre: int = 200, post: int = 60,
                  noise: float = 0.0002):
    rng = np.random.default_rng(11)
    before = [100.0 * (1.0 + noise * rng.standard_normal()) for _ in range(pre)]
    after = []
    for step in range(1, post + 1):
        share = 1.0 - 0.5 ** (step / half_life_min)
        after.append(100.0 * (1.0 + jump * share))
    return before + after


class TestAKnownDecayComesBack:
    def test_the_half_life_lands_in_the_cell_that_brackets_the_truth(self):
        series = _series(_decay_prices(half_life_min=5.0))
        report = abnormal_path(series, T0, stage="release", pre_sessions=1)
        assert report.signal_state == "ok", report.signal_reason
        absorbed = {point.horizon: point.absorbed for point in report.points}
        assert absorbed["5m"] is not None
        assert 0.45 < absorbed["5m"] < 0.60, absorbed
        assert absorbed["30m"] == pytest.approx(1.0)

    def test_a_faster_decay_absorbs_more_by_every_early_horizon(self):
        fast = abnormal_path(_series(_decay_prices(half_life_min=2.0)), T0, stage="release", pre_sessions=1)
        slow = abnormal_path(_series(_decay_prices(half_life_min=12.0)), T0, stage="release", pre_sessions=1)
        for horizon in ("1m", "2m", "5m", "10m"):
            quick = fast.absorbed_at(horizon)
            sluggish = slow.absorbed_at(horizon)
            assert quick is not None and sluggish is not None
            assert quick > sluggish, horizon


class TestTheGateRefusesRatherThanGuessing:
    def test_a_flat_path_is_no_signal_and_says_by_how_much(self):
        series = _series(_decay_prices(half_life_min=5.0, jump=0.0))
        report = abnormal_path(series, T0, stage="release", pre_sessions=1)
        assert report.signal_state == "no_signal"
        assert "sigmas" in (report.signal_reason or "")

    def test_a_one_bar_pre_window_is_refused_rather_than_scaled_by_zero(self):
        prices = _decay_prices(half_life_min=5.0, pre=2)
        series = _series(prices, start=T0 - 2 * STEP)
        report = abnormal_path(series, T0, stage="release", pre_sessions=1, pre_min_bars=30)
        assert report.signal_state == "insufficient_pre_window"
        assert report.sigma_pre_per_bar is None, "a standard deviation of one sample is 0.0, not a scale"

    def test_no_bar_before_the_stage_is_unavailable_not_zero(self):
        series = _series(_decay_prices(half_life_min=5.0))
        report = abnormal_path(series, T0 - 10_000 * STEP, stage="release", pre_sessions=1)
        assert report.signal_state == "unavailable"
        assert report.p0 is None


class TestTheGridKeepsWhatItCannotMeasure:
    def test_sub_minute_horizons_stay_and_say_why(self):
        report = abnormal_path(_series(_decay_prices(half_life_min=5.0)), T0, stage="release", pre_sessions=1)
        sub = [point for point in report.points if point.horizon in {"1s", "30s"}]
        assert len(sub) == 2
        for point in sub:
            assert point.state == "unavailable"
            assert "sub-minute" in (point.reason or "")
            assert point.absorbed is None

    def test_every_stage_horizon_is_present_whatever_its_state(self):
        report = abnormal_path(_series(_decay_prices(half_life_min=5.0)), T0, stage="release", pre_sessions=1)
        assert [point.horizon for point in report.points] == [h.label for h in STAGE_HORIZONS]

    def test_a_horizon_past_the_captured_window_is_uncaptured(self):
        prices = _decay_prices(half_life_min=5.0, post=3)
        report = abnormal_path(_series(prices), T0, stage="release", pre_sessions=1)
        late = [point for point in report.points if point.horizon in {"15m", "30m"}]
        assert {point.state for point in late} == {"uncaptured"}
        assert all("ends before this horizon" in (point.reason or "") for point in late)

    def test_a_horizon_the_clock_has_not_reached_is_pending(self):
        report = abnormal_path(_series(_decay_prices(half_life_min=5.0)), T0, stage="release",
                               pre_sessions=1, now_ms=T0 + 6 * STEP)
        pending = [point.horizon for point in report.points if point.state == "pending"]
        assert pending == ["10m", "15m", "30m"]


class TestTheAnchorDoesNotLookAhead:
    def test_the_anchor_is_the_last_bar_to_finish_before_the_stage(self):
        series = _series(_decay_prices(half_life_min=5.0))
        found = price_at(series, T0)
        assert found is not None
        _price, bar_ts = found
        assert bar_ts + STEP <= T0, "the anchor bar had not closed when the announcement landed"

    def test_the_market_leg_is_subtracted_and_recorded(self):
        asset = _series(_decay_prices(half_life_min=5.0))
        market = _series(_decay_prices(half_life_min=5.0, jump=0.01), symbol="SPY")
        plain = abnormal_path(asset, T0, stage="release", pre_sessions=1)
        adjusted = abnormal_path(asset, T0, stage="release", market=market, pre_sessions=1)
        assert plain.market_adjusted is False
        assert adjusted.market_adjusted is True
        assert adjusted.terminal_return is not None and plain.terminal_return is not None
        assert adjusted.terminal_return < plain.terminal_return
