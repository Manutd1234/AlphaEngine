"""Completeness and identity contracts for the private RFQ observation."""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any, Callable

import httpx
import pytest

from modules.api.coherence_lab_views import rfq_view
from modules.coherence.drivers import rfq_reader
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.drivers.rfq import disperse, parse_quotes
from modules.coherence.drivers.rfq_reader import read_panel
from modules.coherence.scheduler.budget import ReadBudget

MARKET = "KXMVECROSSCATEGORY-SHARD1-S2026"


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> KalshiClient:
    return KalshiClient(
        failover_url="", transport=httpx.MockTransport(handler), budget=ReadBudget(),
    )


def _quote(
    quote_id: str,
    rfq_id: str,
    maker_id: str,
    yes_bid: str,
    no_bid: str,
    created_ts: str = "2026-08-23T22:00:00Z",
) -> dict[str, Any]:
    return {
        "id": quote_id,
        "rfq_id": rfq_id,
        "creator_user_id": maker_id,
        "market_ticker": MARKET,
        "yes_bid_dollars": yes_bid,
        "no_bid_dollars": no_bid,
        "created_ts": created_ts,
        "status": "open",
    }


@pytest.mark.anyio
async def test_both_private_collections_use_official_limits_and_exhaust_cursors():
    queries: dict[str, list[httpx.QueryParams]] = {"rfqs": [], "quotes": []}

    def handler(request: httpx.Request) -> httpx.Response:
        collection = "rfqs" if request.url.path.endswith("/rfqs") else "quotes"
        queries[collection].append(request.url.params)
        cursor = request.url.params.get("cursor")
        if collection == "rfqs":
            row = {"id": "r1" if cursor is None else "r2", "market_ticker": MARKET}
            return httpx.Response(200, json={"rfqs": [row], "cursor": "rfq-next" if cursor is None else ""})
        row = _quote("q1" if cursor is None else "q2", "r1", "m1" if cursor is None else "m2", "0.31", "0.63")
        return httpx.Response(200, json={"quotes": [row], "cursor": "quote-next" if cursor is None else ""})

    result = await read_panel(_client(handler))

    assert result["state"] == "available"
    assert len(result["rfqs"]) == 2 and result["open_quotes"] == 2
    assert [query.get("limit") for query in queries["rfqs"]] == ["100", "100"]
    assert [query.get("cursor") for query in queries["rfqs"]] == [None, "rfq-next"]
    assert [query.get("limit") for query in queries["quotes"]] == ["500", "500"]
    assert [query.get("cursor") for query in queries["quotes"]] == [None, "quote-next"]


@pytest.mark.anyio
async def test_a_repeated_cursor_returns_typed_unavailable_not_a_partial_panel():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/quotes"):
            return httpx.Response(200, json={"quotes": []})
        return httpx.Response(200, json={"rfqs": [{"id": "r1", "market_ticker": MARKET}], "cursor": "same"})

    result = await read_panel(_client(handler))

    assert result["state"] == "unavailable"
    assert "repeated its cursor" in result["detail"]
    assert result["rfqs"] == [] and result["dispersions"] == []


@pytest.mark.anyio
async def test_a_later_page_fault_discards_the_earlier_prefix():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rfqs"):
            return httpx.Response(200, json={"rfqs": []})
        if request.url.params.get("cursor"):
            return httpx.Response(503, json={"error": "later page down"})
        return httpx.Response(200, json={"quotes": [_quote("q1", "r1", "m1", "0.31", "0.63")], "cursor": "next"})

    result = await read_panel(_client(handler))

    assert result["state"] == "unavailable"
    assert result["open_quotes"] == 0 and result["dispersions"] == []


@pytest.mark.anyio
async def test_one_collection_fault_cancels_the_other_private_read(monkeypatch):
    sibling_started = asyncio.Event()
    sibling_cancelled = asyncio.Event()
    never_finishes = asyncio.Event()

    async def read_pages(
        _client,
        _path,
        collection,
        _params,
        *,
        page_limit,
        max_rows,
    ):
        assert page_limit > 0 and max_rows >= page_limit
        if collection == "quotes":
            sibling_started.set()
            try:
                await never_finishes.wait()
            except asyncio.CancelledError:
                sibling_cancelled.set()
                raise
        await sibling_started.wait()
        raise KalshiUnavailable("the RFQ page failed")

    monkeypatch.setattr(rfq_reader, "_read_pages", read_pages)

    result = await read_panel(_client(lambda _request: httpx.Response(500)))

    assert result["state"] == "unavailable"
    assert "the RFQ page failed" in result["detail"]
    assert sibling_cancelled.is_set()


@pytest.mark.anyio
async def test_a_collection_past_the_explicit_ceiling_is_not_truncated(monkeypatch):
    monkeypatch.setattr(rfq_reader, "MAX_RFQ_ROWS", 100)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/quotes"):
            return httpx.Response(200, json={"quotes": []})
        rows = [{"id": f"r{index}", "market_ticker": MARKET} for index in range(100)]
        return httpx.Response(200, json={"rfqs": rows, "cursor": "more"})

    result = await read_panel(_client(handler))

    assert result["state"] == "unavailable"
    assert "100-row ceiling" in result["detail"]
    assert result["rfqs"] == []


def test_creator_aliases_are_parsed_and_only_the_latest_maker_row_survives():
    older = _quote("q-old", "r1", "maker-a", "0.20", "0.70", "2026-08-23T21:00:00Z")
    newer = _quote("q-new", "r1", "maker-a", "0.35", "0.60", "2026-08-23T22:00:00Z")
    alias = _quote("q-alias", "r1", "maker-b", "0.30", "0.65")
    alias["creator_id"] = alias.pop("creator_user_id")

    parsed = parse_quotes({"quotes": [newer, alias, older]})

    assert [(item.quote_id, item.maker_id) for item in parsed] == [
        ("q-new", "maker-a"), ("q-alias", "maker-b"),
    ]


def test_a_newer_terminal_row_replaces_the_same_makers_stale_open_row():
    older = _quote("q-open", "r1", "maker-a", "0.20", "0.70", "2026-08-23T21:00:00Z")
    newer = _quote("q-cancelled", "r1", "maker-a", "0.35", "0.60", "2026-08-23T22:00:00Z")
    newer["status"] = "cancelled"

    parsed = parse_quotes({"quotes": [older, newer]})
    reading = disperse("r1", MARKET, parsed)

    assert [item.quote_id for item in parsed] == ["q-cancelled"]
    assert reading.quotes == 0 and reading.usable == 0


def test_updated_timestamp_wins_when_a_quote_changes_after_creation():
    created_later = _quote("q-open", "r1", "maker-a", "0.20", "0.70", "2026-08-23T22:00:00Z")
    updated_later = _quote("q-cancelled", "r1", "maker-a", "0.35", "0.60", "2026-08-23T21:00:00Z")
    updated_later["updated_ts"] = "2026-08-23T23:00:00Z"
    updated_later["status"] = "cancelled"

    parsed = parse_quotes({"quotes": [created_later, updated_later]})

    assert [(item.quote_id, item.updated_ts) for item in parsed] == [
        ("q-cancelled", "2026-08-23T23:00:00Z"),
    ]


def test_an_unidentified_maker_is_named_even_when_too_few_quotes_remain():
    identified = _quote("q-known", "r1", "maker-a", "0.20", "0.70")
    unidentified = _quote("q-unknown", "r1", "", "0.35", "0.60")

    reading = disperse("r1", MARKET, parse_quotes({"quotes": [identified, unidentified]}))

    assert reading.usable == 1 and reading.spread is None
    assert "1 quote(s) had no maker identity and were left out" in reading.detail


@pytest.mark.anyio
async def test_two_rfqs_on_one_market_never_share_a_dispersion():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rfqs"):
            return httpx.Response(200, json={"rfqs": [
                {"id": "r1", "market_ticker": MARKET},
                {"id": "r2", "market_ticker": MARKET},
            ]})
        return httpx.Response(200, json={"quotes": [
            _quote("q11", "r1", "m1", "0.20", "0.70"),
            _quote("q12", "r1", "m2", "0.30", "0.60"),
            _quote("q21", "r2", "m1", "0.40", "0.50"),
            _quote("q22", "r2", "m2", "0.42", "0.48"),
        ]})

    result = await read_panel(_client(handler))
    rows = {item.rfq_id: item for item in result["dispersions"]}

    assert set(rows) == {"r1", "r2"}
    assert rows["r1"].spread == Decimal("0.10")
    assert rows["r2"].spread == Decimal("0.02")
    assert rfq_view(result).dispersions[0].rfq_id in {"r1", "r2"}


@pytest.mark.anyio
async def test_requests_without_quotes_have_an_honest_request_only_state():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rfqs"):
            return httpx.Response(200, json={"rfqs": [{"id": "r1", "market_ticker": MARKET}]})
        return httpx.Response(200, json={"quotes": []})

    result = await read_panel(_client(handler))
    wire = rfq_view(result)

    assert result["state"] == "requests_only"
    assert "zero open maker quotes" in result["detail"]
    assert wire.open_requests == 1 and wire.open_quotes == 0
    assert wire.dispersions == []
