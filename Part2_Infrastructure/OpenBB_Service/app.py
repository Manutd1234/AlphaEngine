"""Stateless, read-only OpenBB HTTP service for AlphaEngine."""

from __future__ import annotations

import asyncio
import os
import re
import secrets
from typing import Annotated, Any, Awaitable, Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from provider import (
    ProviderUnavailable,
    _crypto_symbol,
    bars,
    fundamentals,
    news,
    provider_status,
    quote,
)

SERVICE_NAME = "AlphaEngine OpenBB Research Service"
SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-]+$")

app = FastAPI(
    title=SERVICE_NAME,
    version="1.0.0",
    description=(
        "Read-only quote, bar, news and fundamentals bridge backed by direct "
        "OpenBB YFinance provider fetchers."
    ),
)


async def require_bearer(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Require bearer auth only when OPENBB_API_TOKEN is configured."""
    expected = os.getenv("OPENBB_API_TOKEN", "").strip()
    if not expected:
        return
    scheme, separator, supplied = (authorization or "").partition(" ")
    valid = (
        bool(separator)
        and scheme.lower() == "bearer"
        and secrets.compare_digest(supplied.strip(), expected)
    )
    if not valid:
        raise HTTPException(
            status_code=401,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )


AUTH = [Depends(require_bearer)]


@app.middleware("http")
async def no_store(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/", include_in_schema=False)
async def root() -> dict[str, Any]:
    """A front door for humans.

    This is a headless API, and FastAPI's stock answer for an undefined root is
    ``{"detail": "Not Found"}`` — which reads as a broken deployment to anyone
    who clicks the bare hostname, reviewers included. The service was fine; the
    first impression was not. The root now says what this is and where the real
    surfaces are, and costs nothing to the machines that never ask for it.
    """
    return {
        "service": "alphaengine-openbb",
        "what": (
            f"{SERVICE_NAME} — stateless read-only market-data bridge for the "
            "AlphaEngine quant-infrastructure case study (educational demo)"
        ),
        "endpoints": {
            "liveness": "/healthz",
            "interactive_docs": "/docs",
            "data": "/api/research/openbb/{health,quote,bars,news,fundamentals}",
        },
        "auth": (
            "data endpoints require a bearer token when OPENBB_API_TOKEN is set; "
            "liveness and this page are public"
        ),
    }


@app.get("/healthz", include_in_schema=False)
async def liveness() -> dict[str, str]:
    """Public process liveness only; provider readiness remains authenticated."""
    return {"status": "ok", "service": "alphaengine-openbb"}


@app.get("/api/research/openbb/health", dependencies=AUTH, tags=["OpenBB"])
async def openbb_health() -> dict[str, Any]:
    return await asyncio.to_thread(provider_status)


async def _envelope(
    _operation: str,
    call: Callable[[], Awaitable[Any]],
) -> dict[str, Any]:
    try:
        return {"ok": True, "data": await call()}
    except ProviderUnavailable as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/research/openbb/quote", dependencies=AUTH, tags=["OpenBB"])
async def openbb_quote(
    symbol: Annotated[str, Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")],
    asset: Annotated[str, Query(pattern=r"^(equity|crypto)$")] = "equity",
) -> dict[str, Any]:
    normalized = symbol.upper()
    return await _envelope("quote", lambda: quote(normalized, asset))


@app.get("/api/research/openbb/bars", dependencies=AUTH, tags=["OpenBB"])
async def openbb_bars(
    symbol: Annotated[str, Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")],
    asset: Annotated[str, Query(pattern=r"^(equity|crypto)$")] = "equity",
    interval: Annotated[str, Query(pattern=r"^(15m|1h|4h|1d)$")] = "1d",
    limit: Annotated[int, Query(ge=10, le=5000)] = 500,
) -> dict[str, Any]:
    normalized = symbol.upper()
    return await _envelope(
        "bars", lambda: bars(normalized, asset, interval, limit)
    )


@app.get("/api/research/openbb/news", dependencies=AUTH, tags=["OpenBB"])
async def openbb_news(
    symbols: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    asset: Annotated[str, Query(pattern=r"^(equity|crypto)$")] = "equity",
) -> dict[str, Any]:
    parsed = [item.strip().upper() for item in symbols.split(",") if item.strip()]
    if any(len(item) > 20 or not SYMBOL_RE.fullmatch(item) for item in parsed):
        raise HTTPException(status_code=422, detail="invalid symbol list")
    parsed = parsed[:6]
    # YFinance names a pair `BTC-USD`. Quote and bars already spell it that
    # way; news sent the caller's `BTCUSDT` verbatim and found nothing.
    if asset == "crypto":
        parsed = [_crypto_symbol(item) for item in parsed]
    return await _envelope("news", lambda: news(parsed, limit))


@app.get("/api/research/openbb/fundamentals", dependencies=AUTH, tags=["OpenBB"])
async def openbb_fundamentals(
    symbol: Annotated[str, Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")],
) -> dict[str, Any]:
    normalized = symbol.upper()
    return await _envelope("fundamentals", lambda: fundamentals(normalized))


@app.exception_handler(HTTPException)
async def http_error(_request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )
