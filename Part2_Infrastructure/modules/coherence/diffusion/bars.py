"""Bars as an array with an honest clock, and a fetcher that does not truncate.

Two things here that the rest of the package leans on.

**A bar's timestamp is its OPEN.** Binance returns open time at index 0 and the
repository's own reader (`modules/data_jobs._binance_rows`) keeps that
convention, so a bar stamped 14:00 covers 14:00–14:01 and did not finish until
14:01. Every price this module hands back is therefore the close of the last
bar whose END is at or before the instant asked for. Reading the bar that
*contains* the instant would be a look-ahead of up to one bar — small at a
minute, and the whole measurement at a horizon of one minute.

**Paging above the cap.** `modules/backtester.fetch_binance_range` stops at
`max_bars=20_000` and returns a short list without raising, which is right for
a backfill with a declared cap and wrong here: thirty days of minute bars is
43,200, so the pre-event window for a single FOMC meeting would come back
silently truncated and the volatility scale would be computed over whatever
fitted. `fetch_binance_window` pages until the range is covered or the vendor
stops making progress, and says which happened.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Any

import numpy as np

#: Milliseconds per bar. Wider than `data_jobs.INTERVAL_MS` on purpose: that
#: one bounds what a *backfill job* will accept, this one is arithmetic.
INTERVAL_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

#: One vendor page. Binance caps a klines request at 1,000 rows.
_PAGE = 1_000


@dataclass(frozen=True)
class BarSeries:
    """Ascending bars for one symbol at one interval, as arrays.

    `ts` is the OPEN of each bar in epoch milliseconds. `complete` says whether
    the fetch covered the range it was asked for; a caller that needs the whole
    window must check it rather than trusting `len`.
    """

    symbol: str
    interval: str
    ts: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    complete: bool = True
    reason: str | None = None

    def __len__(self) -> int:
        return int(self.ts.size)

    @property
    def step_ms(self) -> int:
        return INTERVAL_MS[self.interval]

    @property
    def end_ts(self) -> np.ndarray:
        """The instant each bar finished. `ts` is the open, never the close."""
        return self.ts + self.step_ms

    def slice(self, from_ms: int, to_ms: int) -> BarSeries:
        """Bars whose OPEN lies in `[from_ms, to_ms]`."""
        keep = (self.ts >= from_ms) & (self.ts <= to_ms)
        return BarSeries(
            symbol=self.symbol, interval=self.interval, ts=self.ts[keep],
            open=self.open[keep], high=self.high[keep], low=self.low[keep],
            close=self.close[keep], volume=self.volume[keep],
            complete=self.complete, reason=self.reason,
        )

    def data_hash(self) -> str:
        """A digest of the exact bars a number was computed over.

        The same meaning as `BacktestResult.data_hash`: two runs that share it
        provably saw the same series. `dataset_fingerprint` is not reused
        because it keys off OHLC *column names* on a DataFrame and degenerates
        to first/last/length on anything else.
        """
        digest = sha256()
        digest.update(f"{self.symbol}|{self.interval}|{len(self)}".encode())
        digest.update(np.ascontiguousarray(self.ts, dtype=np.int64).tobytes())
        digest.update(np.ascontiguousarray(self.close, dtype=np.float64).tobytes())
        return digest.hexdigest()


def empty_series(symbol: str, interval: str, *, reason: str) -> BarSeries:
    """No bars, and the reason there are none. Never an empty list on its own."""
    nil = np.empty(0, dtype=np.float64)
    return BarSeries(
        symbol=symbol, interval=interval, ts=np.empty(0, dtype=np.int64),
        open=nil, high=nil, low=nil, close=nil, volume=nil,
        complete=False, reason=reason,
    )


def series_from_klines(symbol: str, interval: str, raw: list[list[Any]], *, complete: bool = True,
                       reason: str | None = None) -> BarSeries:
    """Binance klines into arrays, dropping any row that is not parseable.

    A malformed row is dropped rather than zero-filled, for the reason the
    workspace reader now gives: a bar with no open is not a bar that opened at
    zero.
    """
    rows: list[tuple[int, float, float, float, float, float]] = []
    for kline in raw:
        try:
            rows.append((
                int(kline[0]), float(kline[1]), float(kline[2]),
                float(kline[3]), float(kline[4]), float(kline[5]),
            ))
        except (TypeError, ValueError, IndexError):
            continue
    if not rows:
        return empty_series(symbol, interval, reason=reason or "the vendor returned no parseable bars")
    rows.sort(key=lambda row: row[0])
    deduped: list[tuple[int, float, float, float, float, float]] = []
    for row in rows:
        if deduped and row[0] == deduped[-1][0]:
            continue
        deduped.append(row)
    columns = list(zip(*deduped, strict=True))
    return BarSeries(
        symbol=symbol, interval=interval,
        ts=np.asarray(columns[0], dtype=np.int64),
        open=np.asarray(columns[1], dtype=np.float64),
        high=np.asarray(columns[2], dtype=np.float64),
        low=np.asarray(columns[3], dtype=np.float64),
        close=np.asarray(columns[4], dtype=np.float64),
        volume=np.asarray(columns[5], dtype=np.float64),
        complete=complete, reason=reason,
    )


def fetch_binance_window(symbol: str, interval: str, from_ms: int, to_ms: int, *,
                         client: Any | None = None, page_cap: int = 200) -> BarSeries:
    """Every bar in `[from_ms, to_ms]`, paging past the single-call cap.

    `page_cap` bounds the loop so a vendor that keeps answering cannot spin
    forever; hitting it sets `complete=False` with the reason, which is the
    difference between a short series and a series that is short and says so.
    """
    from modules.backtester import fetch_binance_range

    step = INTERVAL_MS[interval]
    cursor = int(from_ms)
    collected: list[list[Any]] = []
    pages = 0
    while cursor <= to_ms and pages < page_cap:
        chunk = fetch_binance_range(symbol, interval, cursor, int(to_ms), max_bars=_PAGE, client=client)
        pages += 1
        if not chunk:
            break
        collected.extend(chunk)
        last_open = int(chunk[-1][0])
        if last_open < cursor:
            break
        cursor = last_open + step
    truncated = pages >= page_cap and cursor <= to_ms
    return series_from_klines(
        symbol, interval, collected,
        complete=not truncated,
        reason=f"stopped after {page_cap} vendor pages before reaching the end of the range" if truncated else None,
    )


def price_at(series: BarSeries, t_ms: int) -> tuple[float, int] | None:
    """Close of the last bar to FINISH at or before `t_ms`, and its open stamp.

    None when no bar had finished — which is a real answer at a horizon that
    the data cannot resolve, and is reported as such rather than filled.
    """
    if len(series) == 0:
        return None
    finished = np.searchsorted(series.end_ts, t_ms, side="right") - 1
    if finished < 0:
        return None
    return float(series.close[finished]), int(series.ts[finished])


def log_returns(series: BarSeries) -> np.ndarray:
    """Bar-to-bar log returns. Non-positive prices are dropped, not logged."""
    closes = series.close
    if closes.size < 2:
        return np.empty(0, dtype=np.float64)
    usable = (closes[:-1] > 0) & (closes[1:] > 0)
    if not usable.any():
        return np.empty(0, dtype=np.float64)
    return np.log(closes[1:][usable] / closes[:-1][usable])


def realised_variance(series: BarSeries, from_ms: int, to_ms: int) -> float | None:
    """Sum of squared log returns over a window, or None when it cannot be had."""
    window = series.slice(from_ms, to_ms)
    returns = log_returns(window)
    if returns.size == 0:
        return None
    return float(np.sum(returns**2))
