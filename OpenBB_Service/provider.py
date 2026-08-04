"""Direct OpenBB/YFinance provider adapter for the standalone research service.

This module deliberately imports provider fetchers from ``openbb_yfinance``
instead of importing ``openbb.obb``.  The full SDK discovers extensions and
maintains a user-level extension map; a stateless function should not need a
writable home directory or perform an SDK build during a cold start.
"""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from typing import Any

log = logging.getLogger("alphaengine.openbb")

PROVIDER_NAME = "yfinance"
FETCH_TIMEOUT_SECONDS = 8.0
_FETCH_BULKHEAD = asyncio.Semaphore(2)


class ProviderUnavailable(RuntimeError):
    """A safe, client-facing provider failure with no upstream internals."""


@dataclass(frozen=True)
class FetcherClasses:
    equity_quote: type[Any]
    equity_historical: type[Any]
    crypto_historical: type[Any]
    company_news: type[Any]
    equity_profile: type[Any]
    key_metrics: type[Any]


@lru_cache(maxsize=1)
def get_fetchers() -> FetcherClasses:
    """Load the provider extension once without importing the OpenBB SDK."""
    from openbb_yfinance.models.company_news import YFinanceCompanyNewsFetcher
    from openbb_yfinance.models.crypto_historical import YFinanceCryptoHistoricalFetcher
    from openbb_yfinance.models.equity_historical import YFinanceEquityHistoricalFetcher
    from openbb_yfinance.models.equity_profile import YFinanceEquityProfileFetcher
    from openbb_yfinance.models.equity_quote import YFinanceEquityQuoteFetcher
    from openbb_yfinance.models.key_metrics import YFinanceKeyMetricsFetcher

    return FetcherClasses(
        equity_quote=YFinanceEquityQuoteFetcher,
        equity_historical=YFinanceEquityHistoricalFetcher,
        crypto_historical=YFinanceCryptoHistoricalFetcher,
        company_news=YFinanceCompanyNewsFetcher,
        equity_profile=YFinanceEquityProfileFetcher,
        key_metrics=YFinanceKeyMetricsFetcher,
    )


def _package_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def provider_status() -> dict[str, Any]:
    """Report import readiness without making a network request to Yahoo."""
    try:
        get_fetchers()
    except Exception as exc:  # pragma: no cover - depends on deployment image
        log.warning("OpenBB provider import failed (%s)", type(exc).__name__)
        return {
            "ok": False,
            "detail": "OpenBB YFinance provider is unavailable.",
            "provider": None,
        }

    return {
        "ok": True,
        "detail": None,
        "provider": PROVIDER_NAME,
        "mode": "direct-provider-fetchers",
        "versions": {
            "openbb_core": _package_version("openbb-core"),
            "openbb_yfinance": _package_version("openbb-yfinance"),
            "yfinance": _package_version("yfinance"),
        },
    }


def _run_fetcher_sync(fetcher: type[Any], params: dict[str, Any]) -> Any:
    # Provider fetchers expose an async classmethod even when their extraction
    # stage is synchronous.  Give each call its own worker-thread event loop so
    # pandas/yfinance work can never block FastAPI's request loop.
    return asyncio.run(fetcher.fetch_data(dict(params), credentials=None))


async def _fetch(fetcher: type[Any], params: dict[str, Any], capability: str) -> Any:
    async with _FETCH_BULKHEAD:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_run_fetcher_sync, fetcher, params),
                timeout=FETCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            log.warning("%s request timed out", capability)
            raise ProviderUnavailable(
                f"OpenBB/YFinance {capability} request timed out."
            ) from exc
        except Exception as exc:
            # Provider exceptions can contain URLs, local paths, or response
            # fragments.  Keep those out of the public response and application
            # log while retaining the exception class for operations.
            log.warning("%s request failed (%s)", capability, type(exc).__name__)
            raise ProviderUnavailable(
                f"OpenBB/YFinance {capability} is temporarily unavailable."
            ) from exc


def _clean(value: Any) -> Any:
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def _rows(result: Any) -> list[dict[str, Any]]:
    data = getattr(result, "result", result)
    if data is None:
        return []
    if not isinstance(data, list):
        data = [data]
    rows: list[dict[str, Any]] = []
    for item in data:
        if hasattr(item, "model_dump"):
            row = item.model_dump(mode="json")
        elif isinstance(item, dict):
            row = item
        else:
            continue
        rows.append(_clean(row))
    return rows


def _first(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = row.get(name)
        if value is not None:
            return value
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def _as_of(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, str) and value.strip():
        return value
    return datetime.now(timezone.utc).isoformat()


def _crypto_symbol(symbol: str) -> str:
    normalized = symbol.upper()
    if "-" in normalized:
        return normalized
    if normalized.endswith("USDT"):
        return f"{normalized[:-4]}-USD"
    if normalized.endswith("USD"):
        return f"{normalized[:-3]}-USD"
    return normalized


async def quote(symbol: str, asset: str) -> dict[str, Any]:
    fetchers = get_fetchers()
    if asset == "crypto":
        rows = _rows(
            await _fetch(
                fetchers.crypto_historical,
                {
                    "symbol": _crypto_symbol(symbol),
                    "interval": "1d",
                    "start_date": date.today() - timedelta(days=7),
                    "end_date": date.today() + timedelta(days=1),
                },
                "quote",
            )
        )
        if not rows:
            raise ProviderUnavailable(f"No OpenBB/YFinance quote is available for {symbol}.")
        row = rows[-1]
        previous_row = rows[-2] if len(rows) > 1 else row
        price = _number(_first(row, "close", "price"))
        previous = _number(_first(previous_row, "close", "price"))
    else:
        rows = _rows(
            await _fetch(fetchers.equity_quote, {"symbol": symbol}, "quote")
        )
        if not rows:
            raise ProviderUnavailable(f"No OpenBB/YFinance quote is available for {symbol}.")
        row = rows[0]
        price = _number(_first(row, "last_price", "price", "close"))
        previous = _number(_first(row, "prev_close", "previous_close"))

    if price is None:
        raise ProviderUnavailable(f"No OpenBB/YFinance quote is available for {symbol}.")
    change = price - previous if previous not in (None, 0) else None

    return {
        "symbol": symbol.upper(),
        "price": price,
        "change": change,
        "change_percent": (change / previous * 100) if change is not None and previous else None,
        "open": _number(_first(row, "open")),
        "high": _number(_first(row, "high", "day_high")),
        "low": _number(_first(row, "low", "day_low")),
        "prev_close": previous,
        "volume": _number(_first(row, "volume")),
        "currency": _first(row, "currency") or "USD",
        "as_of": _as_of(_first(row, "date", "last_timestamp")),
        "delayed": True,
    }


def _bar(row: dict[str, Any]) -> dict[str, Any] | None:
    close = _number(_first(row, "close"))
    if close is None:
        return None
    return {
        "date": _as_of(_first(row, "date")),
        "open": _number(_first(row, "open")) or close,
        "high": _number(_first(row, "high")) or close,
        "low": _number(_first(row, "low")) or close,
        "close": close,
        "volume": _number(_first(row, "volume")) or 0.0,
    }


def _aggregate_four_hour(bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: list[dict[str, Any]] = []
    # Reset buckets at each calendar day.  An equity session commonly has seven
    # hourly observations; carrying the final three into the next morning would
    # fabricate a candle across an overnight gap.
    by_day: dict[str, list[dict[str, Any]]] = {}
    for bar in bars:
        by_day.setdefault(str(bar["date"])[:10], []).append(bar)
    for day_bars in by_day.values():
        for start in range(0, len(day_bars), 4):
            chunk = day_bars[start : start + 4]
            grouped.append(
                {
                    "date": chunk[0]["date"],
                    "open": chunk[0]["open"],
                    "high": max(row["high"] for row in chunk),
                    "low": min(row["low"] for row in chunk),
                    "close": chunk[-1]["close"],
                    "volume": sum(row["volume"] for row in chunk),
                }
            )
    return grouped


async def bars(symbol: str, asset: str, interval: str, limit: int) -> list[dict[str, Any]]:
    fetchers = get_fetchers()
    provider_interval = "1h" if interval == "4h" else interval
    # Intraday windows are capped by Yahoo in the provider helper; a bounded
    # daily lookback avoids downloading an unbounded history for large requests.
    daily_lookback = min(12_000, max(370, int(limit * 1.7)))
    params: dict[str, Any] = {
        "symbol": _crypto_symbol(symbol) if asset == "crypto" else symbol,
        "interval": provider_interval,
        "start_date": date.today() - timedelta(days=daily_lookback),
        "end_date": date.today() + timedelta(days=1),
    }
    fetcher = fetchers.crypto_historical if asset == "crypto" else fetchers.equity_historical
    rows = _rows(await _fetch(fetcher, params, "bars"))
    normalized = [bar for row in rows if (bar := _bar(row)) is not None]
    if interval == "4h":
        normalized = _aggregate_four_hour(normalized)
    if not normalized:
        raise ProviderUnavailable(f"No OpenBB/YFinance bars are available for {symbol}.")
    return normalized[-limit:]


async def news(symbols: list[str], limit: int) -> list[dict[str, Any]]:
    if not symbols:
        raise ProviderUnavailable("At least one symbol is required for OpenBB/YFinance news.")
    rows = _rows(
        await _fetch(
            get_fetchers().company_news,
            {"symbol": ",".join(symbols), "limit": limit},
            "news",
        )
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        title = _first(row, "title")
        url = _first(row, "url", "link")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        text = _first(row, "text", "summary", "body")
        row_symbol = _first(row, "symbol")
        items.append(
            {
                "title": title,
                "url": url,
                "source": _first(row, "source", "publisher") or "OpenBB",
                "date": _as_of(_first(row, "date", "published")),
                "text": text[:400] if isinstance(text, str) and text else None,
                "symbols": [row_symbol] if isinstance(row_symbol, str) else symbols,
                "sentiment": _number(_first(row, "sentiment")),
            }
        )
    if not items:
        raise ProviderUnavailable("No OpenBB/YFinance news is available for the requested symbols.")
    return items[:limit]


async def fundamentals(symbol: str) -> dict[str, Any]:
    fetchers = get_fetchers()
    profile_result, metrics_result = await asyncio.gather(
        _fetch(fetchers.equity_profile, {"symbol": symbol}, "fundamentals profile"),
        _fetch(fetchers.key_metrics, {"symbol": symbol}, "fundamentals metrics"),
        return_exceptions=True,
    )

    profile_rows = [] if isinstance(profile_result, Exception) else _rows(profile_result)
    metric_rows = [] if isinstance(metrics_result, Exception) else _rows(metrics_result)
    profile = profile_rows[0] if profile_rows else {}
    metrics = metric_rows[0] if metric_rows else {}
    if not profile and not metrics:
        raise ProviderUnavailable(
            f"No OpenBB/YFinance fundamentals are available for {symbol}."
        )

    return {
        "symbol": symbol.upper(),
        "name": _first(profile, "name", "legal_name"),
        "exchange": _first(profile, "stock_exchange", "exchange"),
        "sector": _first(profile, "sector"),
        "industry": _first(profile, "industry_category", "industry"),
        "currency": _first(metrics, "currency") or _first(profile, "currency"),
        "market_cap": _number(_first(metrics, "market_cap"))
        or _number(_first(profile, "market_cap")),
        "pe_ratio": _number(_first(metrics, "pe_ratio", "price_to_earnings")),
        "eps": _number(_first(metrics, "eps_ttm", "eps", "earnings_per_share")),
        "beta": _number(_first(metrics, "beta")) or _number(_first(profile, "beta")),
        "dividend_yield": _number(_first(metrics, "dividend_yield"))
        or _number(_first(profile, "dividend_yield")),
        "shares_outstanding": _number(_first(profile, "shares_outstanding")),
        "description": _first(profile, "long_description", "description"),
    }
