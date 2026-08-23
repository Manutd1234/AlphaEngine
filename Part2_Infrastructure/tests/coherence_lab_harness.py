"""The stubbed venue both lab-route suites run against.

Extracted when `test_api_coherence_lab.py` reached the four-hundred-line
ceiling and had to become two files. The transport stub, the fixtures and the
recorded payloads live here so that splitting the suites did not mean keeping
two copies of the venue — two stubs drifting apart would let a route pass in
one file and fail in the other for reasons neither file states.

Not named `test_*`, so pytest collects it as a module rather than a suite.
"""

from __future__ import annotations

import httpx
from coherence_fixtures import body, markets
from fastapi.testclient import TestClient

import main
from modules.api import coherence_lab as lab
from modules.coherence.drivers.kalshi_rest import KalshiClient
from modules.coherence.fs.store import CoherenceStore
from modules.coherence.scheduler.budget import ReadBudget

EVENT = "KXHIGHNY-26AUG23"
PARLAY = "KXMVECROSSCATEGORY-SHARD1-S2026"
LEG = "KXEPLGAME-26AUG23NEWLFC-LFC"

LADDER_EVENT = {
    "event": {
        "event_ticker": EVENT,
        "series_ticker": "KXHIGHNY",
        "title": "Highest temperature in NYC today",
        "mutually_exclusive": True,
        "exchange_index": 0,
        "settlement_sources": [{"name": "The Weather Company"}],
        "markets": markets("markets_ladder"),
    },
    "markets": [],
}

COMBO_MARKETS = {
    "markets": [
        {
            "ticker": PARLAY,
            "mve_collection_ticker": "KXMVECROSSCATEGORY-SHARD1-R",
            "exchange_index": 1,
            "yes_sub_title": "yes Liverpool",
            "yes_ask_dollars": "0.4700",
            "open_interest_fp": "10.00",
            "mve_selected_legs": [{"event_ticker": "KXEPLGAME-26AUG23NEWLFC", "market_ticker": LEG, "side": "yes"}],
        }
    ]
}

COMBO_BOOKS = {
    "orderbooks": [
        {"ticker": PARLAY, "orderbook_fp": {"no_dollars": [["0.5300", "100.00"]], "yes_dollars": []}},
        {"ticker": LEG, "orderbook_fp": {"yes_dollars": [["0.5000", "500.00"]], "no_dollars": [["0.4900", "500.00"]]}},
    ]
}

SETTLED_MARKETS = {
    "markets": [
        {
            "ticker": f"KXHIGHNY-26AUG{day:02d}-T80",
            "event_ticker": f"KXHIGHNY-26AUG{day:02d}",
            "series_ticker": "KXHIGHNY",
            "close_time": "2026-08-22T04:00:00Z",
            "result": "yes" if day % 3 else "no",
            "last_price_dollars": "0.7500" if day % 3 else "0.2500",
            "volume_fp": "120.00",
        }
        for day in range(1, 13)
    ]
}


def exchange(request: httpx.Request) -> httpx.Response:
    """One recorded venue, answering every route the lab reads."""
    path, query = request.url.path, request.url.params
    if "/markets/orderbooks" in path:
        return httpx.Response(200, json=COMBO_BOOKS if PARLAY in str(query) else body("orderbook_bulk"))
    if "/events/" in path:
        return httpx.Response(200, json=LADDER_EVENT)
    if path.endswith("/markets"):
        if query.get("mve_filter") == "only":
            return httpx.Response(200, json=COMBO_MARKETS)
        if query.get("status") == "settled":
            return httpx.Response(200, json=SETTLED_MARKETS)
        return httpx.Response(200, json={"markets": markets("markets_ladder")})
    if "/live_data/weather/" in path:
        return httpx.Response(200, json=body("live_data_weather_miami"))
    if "/communications/rfqs" in path:
        return httpx.Response(200, json={"rfqs": []})
    if "/communications/quotes" in path:
        return httpx.Response(200, json={"quotes": []})
    return httpx.Response(401, json={"error": "this deployment holds no entitlement"})


def unreachable(_request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("no route to the exchange from this test")


def venue(monkeypatch, handler=exchange) -> None:
    """Point the router's client factory at a transport instead of a socket."""
    transport = httpx.MockTransport(handler)

    def factory(*_args, **kwargs) -> KalshiClient:
        return KalshiClient(base_url=kwargs.get("base_url"), transport=transport, budget=ReadBudget())

    monkeypatch.setattr(lab, "KalshiClient", factory)


def make_client() -> TestClient:
    """No lifespan: no feeds, no recorder, no ledger — just the routes."""
    return TestClient(main.app)


def point_tape_at(monkeypatch, tmp_path) -> CoherenceStore:
    """A private DuckDB file per test, so the corpus never touches the desk's."""
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    monkeypatch.setattr("modules.coherence.fs.store._STORE", store, raising=False)
    monkeypatch.setattr(lab, "get_store", lambda: store)
    return store
