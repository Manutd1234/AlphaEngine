"""Module A: cross-venue L2 order book and transaction cost analysis.

Two REST reads and the websocket the DOM visualiser consumes. The socket is not
part of the OpenAPI contract — websockets never are — so its shape is pinned by
the tests rather than by the committed schema.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from config import settings
from modules.api.deps import market_data_provider
from modules.application_services import MarketDataProvider
from modules.latest_state_stream import LatestStateSample, SlowConsumer, StreamSaturated
from modules.schemas import TCAReport, VenueBook

# The gateway logger, not a per-module one: these lines already reach operators
# under the "alphaengine" name and a rename would quietly break a log filter.
log = logging.getLogger("alphaengine")

router = APIRouter(tags=["A · TCA"])
WS_PROTOCOL = "alphaengine.v1"
WS_CREDENTIAL_PROTOCOL_PREFIX = "alphaengine.token."


def _websocket_access(ws: WebSocket) -> tuple[bool, str | None]:
    """Validate the optional protocol credential without putting it in a URL."""
    offered = [
        value.strip()
        for value in ws.headers.get("sec-websocket-protocol", "").split(",")
        if value.strip()
    ]
    negotiated = WS_PROTOCOL if WS_PROTOCOL in offered else None
    if not settings.require_auth:
        return True, negotiated

    encoded = next(
        (
            value.removeprefix(WS_CREDENTIAL_PROTOCOL_PREFIX)
            for value in offered
            if value.startswith(WS_CREDENTIAL_PROTOCOL_PREFIX)
        ),
        None,
    )
    if not encoded or len(encoded) > 4096 or not settings.web_api_token:
        return False, negotiated
    try:
        padding = "=" * (-len(encoded) % 4)
        presented = base64.urlsafe_b64decode(encoded + padding).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False, negotiated
    valid = hmac.compare_digest(
        presented.encode("utf-8"),
        settings.web_api_token.encode("utf-8"),
    )
    return valid, negotiated


def _book_sample(market_data: MarketDataProvider, symbol: str) -> LatestStateSample:
    books = market_data.get_books(symbol, depth=15)
    payload = {
        "type": "book",
        "symbol": symbol,
        "consolidated_mid": market_data.consolidated_mid(symbol),
        "venues_online": market_data.venues_online(symbol),
        "books": [book.model_dump(mode="json") for book in books],
    }
    report = market_data.tca_report(symbol, "BUY", settings.default_probe_notional)
    if report.per_venue:
        payload["tca"] = report.model_dump(mode="json")
    observed = max(
        (book.last_update for book in books if book.last_update is not None),
        default=None,
    )
    stale = sum(book.stale for book in books)
    freshness = (
        "unavailable" if not books else "stale" if stale == len(books) else "partial" if stale else "live"
    )
    return LatestStateSample(
        payload=payload,
        source_version="venue-book.v1",
        source_observed_at=observed,
        freshness_state=freshness,
    )


@router.get("/api/book/{symbol}", response_model=list[VenueBook])
async def get_book(
    symbol: str,
    depth: int = Query(default=15, ge=1, le=50),
    market_data: MarketDataProvider = Depends(market_data_provider),
) -> list[VenueBook]:
    books = market_data.get_books(symbol.upper(), depth=depth)
    if not books:
        raise HTTPException(404, f"no feed configured for {symbol.upper()}")
    return books


@router.get("/api/tca/{symbol}", response_model=TCAReport)
async def get_tca(
    symbol: str,
    side: str = Query(default="BUY", pattern="^(BUY|SELL|buy|sell)$"),
    notional: float = Query(default=None, gt=0),
    market_data: MarketDataProvider = Depends(market_data_provider),
) -> TCAReport:
    report = market_data.tca_report(symbol.upper(), side.upper(), notional)
    if not report.per_venue:
        raise HTTPException(503, f"no live book for {symbol.upper()} — check /health")
    return report


@router.websocket("/ws/book/{symbol}")
async def ws_book(ws: WebSocket, symbol: str) -> None:
    """Push one shared consolidated ladder + TCA frame every 300 ms."""
    authorised, subprotocol = _websocket_access(ws)
    if not authorised:
        log.info("ws refused an unauthorised book subscription")
        # ASGI turns a close sent before accept into HTTP 403, so a browser
        # never receives 1008 and treats the failure as an abnormal 1006.  The
        # client would then retry a bad credential forever. Complete the
        # upgrade, send no data, and close with the policy code it understands.
        await ws.accept(subprotocol=subprotocol)
        await ws.close(code=1008, reason="authentication required")
        return

    symbol = symbol.upper()
    supported = {configured.upper() for configured in settings.symbols}
    if symbol not in supported:
        log.info("ws refused unsupported symbol: %.64s", symbol)
        await ws.accept(subprotocol=subprotocol)
        await ws.close(code=1008, reason="symbol is not configured")
        return

    await ws.accept(subprotocol=subprotocol)
    context = ws.app.state.application_context
    market_data = context.market_data
    try:
        await context.book_stream.serve(
            lambda: _book_sample(market_data, symbol), ws.send_json, topic=f"book:{symbol}",
        )
    except WebSocketDisconnect:
        pass
    except SlowConsumer:
        log.info("ws slow consumer disconnected: symbol=%s", symbol)
        with contextlib.suppress(Exception):
            await ws.close(code=1013, reason="consumer exceeded send budget")
    except StreamSaturated:
        log.warning("ws admission limit reached: symbol=%s", symbol)
        with contextlib.suppress(Exception):
            await ws.close(code=1013, reason="stream capacity is temporarily full")
    except Exception as exc:
        log.debug("ws closed: %s", exc)
        with contextlib.suppress(Exception):
            await ws.close(code=1011, reason="stream failed unexpectedly")
