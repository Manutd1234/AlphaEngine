"""Bars: the open/close convention, the paging that does not truncate, and the
digest that actually depends on the prices.
"""

from __future__ import annotations

import httpx
import numpy as np

from modules.coherence.diffusion.bars import (
    INTERVAL_MS,
    empty_series,
    fetch_binance_window,
    log_returns,
    price_at,
    realised_variance,
    series_from_klines,
)

STEP = INTERVAL_MS["1m"]
T0 = 1_700_000_000_000


def _raw(n: int, *, start: int = T0, price: float = 100.0):
    return [[start + i * STEP, price, price, price, price, 1.0] for i in range(n)]


class TestATimestampIsTheOpen:
    def test_the_price_at_an_instant_is_the_last_bar_to_have_finished(self):
        series = series_from_klines("BTCUSDT", "1m", [
            [T0, 1, 1, 1, 10.0, 1], [T0 + STEP, 1, 1, 1, 20.0, 1], [T0 + 2 * STEP, 1, 1, 1, 30.0, 1],
        ])
        # The bar stamped T0 covers T0..T0+60s and has not closed AT T0.
        assert price_at(series, T0) is None
        assert price_at(series, T0 + STEP) == (10.0, T0)
        assert price_at(series, T0 + STEP + 1) == (10.0, T0)
        assert price_at(series, T0 + 2 * STEP) == (20.0, T0 + STEP)

    def test_end_ts_is_the_open_plus_one_step(self):
        series = series_from_klines("BTCUSDT", "1m", _raw(3))
        assert list(series.end_ts) == [T0 + STEP, T0 + 2 * STEP, T0 + 3 * STEP]

    def test_an_empty_series_answers_none_rather_than_raising(self):
        assert price_at(empty_series("BTCUSDT", "1m", reason="nothing"), T0) is None


class TestMalformedRowsAreDroppedNotZeroed:
    def test_a_row_missing_a_field_does_not_become_a_zero_price(self):
        series = series_from_klines("BTCUSDT", "1m", [
            [T0, 1, 2, 0.5, 10.0, 1], [T0 + STEP, 1, 2], [T0 + 2 * STEP, 1, 2, 0.5, 30.0, 1],
        ])
        assert len(series) == 2
        assert 0.0 not in set(series.close.tolist())

    def test_duplicate_opens_collapse_to_one_bar(self):
        series = series_from_klines("BTCUSDT", "1m", [
            [T0, 1, 1, 1, 10.0, 1], [T0, 1, 1, 1, 11.0, 1], [T0 + STEP, 1, 1, 1, 12.0, 1],
        ])
        assert len(series) == 2

    def test_no_parseable_row_yields_an_empty_series_with_a_reason(self):
        series = series_from_klines("BTCUSDT", "1m", [["nonsense"]])
        assert len(series) == 0 and series.reason


class TestPagingCoversTheWholeRange:
    @staticmethod
    def _transport(total_bars: int) -> httpx.Client:
        def handler(request: httpx.Request) -> httpx.Response:
            start = int(request.url.params["startTime"])
            end = int(request.url.params["endTime"])
            limit = int(request.url.params["limit"])
            first = max(T0, start - (start - T0) % STEP)
            rows = []
            stamp = first
            while stamp <= end and len(rows) < limit and stamp < T0 + total_bars * STEP:
                rows.append([stamp, 1, 1, 1, 100.0 + (stamp - T0) / STEP, 1])
                stamp += STEP
            return httpx.Response(200, json=rows)

        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_a_range_wider_than_one_page_comes_back_whole(self):
        client = self._transport(2_500)
        try:
            series = fetch_binance_window("BTCUSDT", "1m", T0, T0 + 2_499 * STEP, client=client)
        finally:
            client.close()
        assert len(series) == 2_500, "the single-call cap truncated the window"
        assert series.complete is True

    def test_hitting_the_page_cap_says_so_instead_of_looking_short(self):
        client = self._transport(5_000)
        try:
            series = fetch_binance_window("BTCUSDT", "1m", T0, T0 + 4_999 * STEP,
                                          client=client, page_cap=2)
        finally:
            client.close()
        assert series.complete is False
        assert "vendor pages" in (series.reason or "")


class TestTheDigestDependsOnThePrices:
    def test_two_different_series_do_not_share_a_hash(self):
        first = series_from_klines("BTCUSDT", "1m", _raw(50, price=100.0))
        second = series_from_klines("BTCUSDT", "1m", _raw(50, price=101.0))
        assert first.data_hash() != second.data_hash(), (
            "a digest keyed only on first/last/length cannot tell two windows apart"
        )

    def test_the_same_series_hashes_the_same_twice(self):
        raw = _raw(20)
        assert series_from_klines("BTCUSDT", "1m", raw).data_hash() == \
               series_from_klines("BTCUSDT", "1m", raw).data_hash()


class TestReturnsRefuseImpossiblePrices:
    def test_a_non_positive_price_is_skipped_rather_than_logged(self):
        series = series_from_klines("BTCUSDT", "1m", [
            [T0, 1, 1, 1, 10.0, 1], [T0 + STEP, 1, 1, 1, 0.0, 1], [T0 + 2 * STEP, 1, 1, 1, 12.0, 1],
        ])
        returns = log_returns(series)
        assert np.all(np.isfinite(returns))

    def test_realised_variance_over_an_empty_window_is_none(self):
        series = series_from_klines("BTCUSDT", "1m", _raw(5))
        assert realised_variance(series, T0 + 100 * STEP, T0 + 200 * STEP) is None
