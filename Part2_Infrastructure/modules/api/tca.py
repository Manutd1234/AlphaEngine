"""Module A: cross-venue L2 order book and transaction cost analysis.

Two REST reads and the websocket the DOM visualiser consumes. The socket is not
part of the OpenAPI contract — websockets never are — so its shape is pinned by
the tests rather than by the committed schema.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from config import settings
from modules.schemas import TCAReport, VenueBook
from modules.tca_engine import get_engine

# The gateway logger, not a per-module one: these lines already reach operators
# under the "alphaengine" name and a rename would quietly break a log filter.
log = logging.getLogger("alphaengine")

router = APIRouter(tags=["A · TCA"])


@router.get("/api/book/{symbol}", response_model=list[VenueBook])
async def get_book(symbol: str, depth: int = Query(default=15, ge=1, le=50)) -> list[VenueBook]:
    books = get_engine().get_books(symbol.upper(), depth=depth)
    if not books:
        raise HTTPException(404, f"no feed configured for {symbol.upper()}")
    return books


@router.get("/api/tca/{symbol}", response_model=TCAReport)
async def get_tca(
    symbol: str,
    side: str = Query(default="BUY", pattern="^(BUY|SELL|buy|sell)$"),
    notional: float = Query(default=None, gt=0),
) -> TCAReport:
    report = get_engine().tca_report(symbol.upper(), side.upper(), notional)
    if not report.per_venue:
        raise HTTPException(503, f"no live book for {symbol.upper()} — check /health")
    return report


@router.websocket("/ws/book/{symbol}")
async def ws_book(ws: WebSocket, symbol: str) -> None:
    """Push the consolidated ladder + live TCA at ~4Hz for the DOM visualiser."""
    await ws.accept()
    symbol = symbol.upper()
    tca = get_engine()
    try:
        while True:
            books = tca.get_books(symbol, depth=15)
            payload = {
                "type": "book",
                "symbol": symbol,
                "consolidated_mid": tca.consolidated_mid(symbol),
                "venues_online": tca.venues_online(symbol),
                "books": [b.model_dump(mode="json") for b in books],
            }
            report = tca.tca_report(symbol, "BUY", settings.default_probe_notional)
            if report.per_venue:
                payload["tca"] = report.model_dump(mode="json")
            await ws.send_json(payload)
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("ws closed: %s", exc)
        with contextlib.suppress(Exception):
            await ws.close()
