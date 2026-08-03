"""
OpenBB bridge — the aggregator, hosted where Python actually runs.
==================================================================

Why this module exists
----------------------
OpenBB is not a REST service. It is a Python package (`pip install openbb`)
that federates other data vendors behind one schema — `obb.equity.price.quote`,
`obb.news.company`, `obb.equity.fundamental.metrics` and so on. The research
portal is TypeScript on Vercel; it cannot import a Python library. So the
gateway hosts OpenBB and exposes a thin, stable JSON surface, and the portal's
`openbb` adapter is a client of *this*, ranked alongside the direct vendor
adapters in its registry.

Design decisions worth stating:

* **Soft dependency.** `openbb` plus its provider tree is a heavyweight install
  (pandas pins, several hundred MB). It is imported lazily and its absence is a
  *reported state*, not an ImportError at boot — `/api/research/openbb/health`
  says exactly what is missing and the portal's registry then routes around us.

* **Failures ship as ``{"ok": false}`` with HTTP 200.** A missing downstream
  key inside OpenBB is a routing signal for the portal's registry, not a server
  error: its circuit breaker should count *our* 5xx against us, not a vendor's
  refusal three hops away.

* **Blocking calls go through a thread.** OpenBB's fetchers are synchronous
  HTTP under the hood; calling them inline would freeze the event loop that is
  also serving order-risk checks — the one latency budget this process is not
  allowed to spend on research.
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import date, timedelta
from functools import lru_cache
from typing import Any

log = logging.getLogger("alphaengine.research")

_IMPORT_ERROR: str | None = None
_OBB_PROVIDER = "yfinance"


@lru_cache(maxsize=1)
def _obb():
    """Import OpenBB once, on first use. Returns None when unavailable."""
    global _IMPORT_ERROR
    try:
        from openbb import obb  # type: ignore[import-not-found]

        return obb
    except Exception as exc:  # pragma: no cover - environment-dependent
        # Exception, not ImportError: openbb can be present but fail to
        # initialise (extension resolution, pydantic mismatches), and for the
        # caller both mean the same thing — not available, here is why.
        _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
        log.warning("OpenBB unavailable: %s", _IMPORT_ERROR)
        return None


def openbb_available() -> bool:
    return _obb() is not None


def openbb_status() -> dict[str, Any]:
    obb = _obb()
    if obb is None:
        return {
            "ok": False,
            "detail": _IMPORT_ERROR or "openbb is not installed",
            "install": "pip install -r requirements-openbb.txt && openbb-build",
        }

    providers = set(getattr(getattr(obb, "coverage", None), "providers", []) or [])
    ok = _OBB_PROVIDER in providers
    return {
        "ok": ok,
        "detail": None if ok else f"OpenBB provider '{_OBB_PROVIDER}' is not installed",
        "install": None if ok else "pip install -r requirements-openbb.txt && openbb-build",
        "provider": _OBB_PROVIDER if ok else None,
    }


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #

def _clean(v: Any) -> Any:
    """NaN/Inf → None. OpenBB hands back pandas-shaped records where a missing
    number is NaN, and NaN survives json.dumps as the *token* ``NaN``, which is
    not JSON — the portal's JSON.parse would throw on an otherwise fine row."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _rows(result: Any) -> list[dict[str, Any]]:
    """OBBject → list of plain dicts, tolerating version drift in field names."""
    results = getattr(result, "results", result)
    if results is None:
        return []
    if not isinstance(results, list):
        results = [results]
    out: list[dict[str, Any]] = []
    for item in results:
        if hasattr(item, "model_dump"):
            d = item.model_dump()
        elif isinstance(item, dict):
            d = item
        else:
            d = {k: getattr(item, k) for k in dir(item) if not k.startswith("_")}
        out.append({k: _clean(v) for k, v in d.items()})
    return out


def _first(row: dict[str, Any], *names: str) -> Any:
    """First present field among aliases — OpenBB providers disagree on names
    (``close`` vs ``last_price`` vs ``price``), and pinning one would make the
    bridge work with exactly one of its providers."""
    for n in names:
        v = row.get(n)
        if v is not None:
            return v
    return None


# --------------------------------------------------------------------------- #
# Capabilities — each returns {"ok": bool, "data"|"error": ...}
# --------------------------------------------------------------------------- #

def _quote_sync(symbol: str, asset: str) -> dict[str, Any]:
    obb = _obb()
    if obb is None:
        return {"ok": False, "error": _IMPORT_ERROR or "openbb not installed"}
    try:
        if asset == "crypto":
            pair = symbol.upper()
            pair = f"{pair[:-4]}-USD" if pair.endswith("USDT") else pair
            rows = _rows(obb.crypto.price.historical(
                symbol=pair,
                start_date=date.today() - timedelta(days=7),
                end_date=date.today() + timedelta(days=1),
                interval="1d",
                provider=_OBB_PROVIDER,
            ))
            if not rows:
                return {"ok": False, "error": f"no crypto data for {symbol}"}
            row = rows[-1]
            price = _first(row, "close", "price")
            prev = _first(rows[-2] if len(rows) > 1 else row, "close", "price")
        else:
            rows = _rows(obb.equity.price.quote(symbol=symbol, provider=_OBB_PROVIDER))
            if not rows:
                return {"ok": False, "error": f"no quote for {symbol}"}
            row = rows[0]
            price = _first(row, "last_price", "price", "close")
            prev = _first(row, "prev_close", "previous_close")
        if price is None:
            return {"ok": False, "error": f"provider returned no price for {symbol}"}
        change = (price - prev) if prev else None
        return {"ok": True, "data": {
            "symbol": symbol.upper(),
            "price": price,
            "change": change,
            "change_percent": (change / prev * 100) if change is not None and prev else None,
            "open": _first(row, "open"),
            "high": _first(row, "high", "day_high"),
            "low": _first(row, "low", "day_low"),
            "prev_close": prev,
            "volume": _first(row, "volume"),
            "currency": _first(row, "currency") or "USD",
            "as_of": str(_first(row, "date", "last_timestamp") or ""),
            "delayed": True,
        }}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


_INTERVAL = {"15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}


def _bars_sync(symbol: str, asset: str, interval: str, limit: int) -> dict[str, Any]:
    obb = _obb()
    if obb is None:
        return {"ok": False, "error": _IMPORT_ERROR or "openbb not installed"}
    iv = _INTERVAL.get(interval)
    if iv is None:
        return {"ok": False, "error": f"interval {interval} not supported"}
    try:
        if asset == "crypto":
            pair = symbol.upper()
            pair = f"{pair[:-4]}-USD" if pair.endswith("USDT") else pair
            rows = _rows(obb.crypto.price.historical(
                symbol=pair,
                interval="1h" if iv == "4h" else iv,
                provider=_OBB_PROVIDER,
            ))
        else:
            rows = _rows(obb.equity.price.historical(
                symbol=symbol,
                interval="1h" if iv == "4h" else iv,
                provider=_OBB_PROVIDER,
            ))
        bars = [
            {
                "date": str(r.get("date", "")),
                "open": _first(r, "open"),
                "high": _first(r, "high"),
                "low": _first(r, "low"),
                "close": _first(r, "close"),
                "volume": _first(r, "volume") or 0,
            }
            for r in rows
            if _first(r, "close") is not None
        ]
        # Yahoo does not expose a native 4h interval. Consolidate consecutive
        # hourly observations so the bridge keeps its documented interval
        # contract without asking the provider for an unsupported value.
        if iv == "4h":
            grouped: list[dict[str, Any]] = []
            for start in range(0, len(bars), 4):
                chunk = bars[start:start + 4]
                if not chunk:
                    continue
                highs = [row["high"] for row in chunk if row["high"] is not None]
                lows = [row["low"] for row in chunk if row["low"] is not None]
                grouped.append({
                    "date": chunk[0]["date"],
                    "open": chunk[0]["open"],
                    "high": max(highs) if highs else chunk[-1]["close"],
                    "low": min(lows) if lows else chunk[-1]["close"],
                    "close": chunk[-1]["close"],
                    "volume": sum(row["volume"] or 0 for row in chunk),
                })
            bars = grouped
        return {"ok": True, "data": bars[-limit:]}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _news_sync(symbols: list[str], limit: int) -> dict[str, Any]:
    obb = _obb()
    if obb is None:
        return {"ok": False, "error": _IMPORT_ERROR or "openbb not installed"}
    try:
        if symbols:
            rows = _rows(obb.news.company(
                symbol=",".join(symbols),
                limit=limit,
                provider=_OBB_PROVIDER,
            ))
        else:
            return {"ok": False, "error": "at least one symbol is required for the keyless OpenBB news provider"}
        items = [
            {
                "title": _first(r, "title"),
                "url": _first(r, "url", "link"),
                "source": _first(r, "source", "publisher") or "OpenBB",
                "date": str(_first(r, "date", "published") or ""),
                "text": (_first(r, "text", "summary", "body") or "")[:400] or None,
                "symbols": symbols,
                "sentiment": _first(r, "sentiment"),
            }
            for r in rows
            if _first(r, "title") and _first(r, "url", "link")
        ]
        return {"ok": True, "data": items[:limit]}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _fundamentals_sync(symbol: str) -> dict[str, Any]:
    obb = _obb()
    if obb is None:
        return {"ok": False, "error": _IMPORT_ERROR or "openbb not installed"}
    try:
        profile_rows = _rows(obb.equity.profile(symbol=symbol, provider=_OBB_PROVIDER))
        p = profile_rows[0] if profile_rows else {}
        metrics: dict[str, Any] = {}
        try:
            metric_rows = _rows(obb.equity.fundamental.metrics(
                symbol=symbol,
                limit=1,
                provider=_OBB_PROVIDER,
            ))
            metrics = metric_rows[0] if metric_rows else {}
        except Exception:
            # Metrics need a fundamentals-capable downstream; the profile alone
            # is still an answer. Partial data beats a refusal here because the
            # portal merges in ratios from FMP anyway.
            pass
        if not p and not metrics:
            return {"ok": False, "error": f"no fundamentals for {symbol}"}
        return {"ok": True, "data": {
            "symbol": symbol.upper(),
            "name": _first(p, "name", "legal_name"),
            "exchange": _first(p, "exchange", "stock_exchange"),
            "sector": _first(p, "sector"),
            "industry": _first(p, "industry_category", "industry"),
            "currency": _first(p, "currency"),
            "market_cap": _first(metrics, "market_cap") or _first(p, "market_cap"),
            "pe_ratio": _first(metrics, "pe_ratio", "price_to_earnings"),
            "eps": _first(metrics, "eps", "earnings_per_share"),
            "beta": _first(metrics, "beta") or _first(p, "beta"),
            "dividend_yield": _first(metrics, "dividend_yield"),
            "shares_outstanding": _first(metrics, "shares_outstanding")
            or _first(p, "shares_outstanding"),
            "description": _first(p, "long_description", "description"),
        }}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# --------------------------------------------------------------------------- #
# Async wrappers — the event loop stays free for order flow
# --------------------------------------------------------------------------- #

_TIMEOUT_S = 7.0
_OPENBB_BULKHEAD = asyncio.Semaphore(2)


async def _off_loop(fn, /, *args) -> dict[str, Any]:
    # Keep heavyweight provider work from crowding the event loop's executor.
    # This gateway also owns pre-trade risk checks; research may wait, risk may
    # not. A small bulkhead also bounds abandoned worker threads after timeout.
    async with _OPENBB_BULKHEAD:
        try:
            return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=_TIMEOUT_S)
        except asyncio.TimeoutError:
            # The worker thread may still be running — to_thread cannot cancel
            # it — but at most two OpenBB calls can occupy workers at once.
            return {"ok": False, "error": f"openbb call exceeded {_TIMEOUT_S:.0f}s"}


async def openbb_status_async() -> dict[str, Any]:
    """Probe/import OpenBB away from the execution gateway's event loop."""
    return await _off_loop(openbb_status)


async def quote(symbol: str, asset: str = "equity") -> dict[str, Any]:
    return await _off_loop(_quote_sync, symbol, asset)


async def bars(symbol: str, asset: str, interval: str, limit: int) -> dict[str, Any]:
    return await _off_loop(_bars_sync, symbol, asset, interval, limit)


async def news(symbols: list[str], limit: int) -> dict[str, Any]:
    return await _off_loop(_news_sync, symbols, limit)


async def fundamentals(symbol: str) -> dict[str, Any]:
    return await _off_loop(_fundamentals_sync, symbol)
