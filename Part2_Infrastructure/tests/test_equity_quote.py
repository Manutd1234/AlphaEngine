"""The gateway quote bridge trusts evidence, never browser-supplied prices."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.equity_quote import EquityQuoteUnavailable, fetch_paper_equity_reference, is_equity_symbol
from modules.schemas import PaperExecutionReference, RiskDecision


def response(
    *,
    symbol: str = "AAPL",
    currency: str = "USD",
    contract_passed: bool = True,
    synthetic: object = False,
) -> dict:
    return {
        "quotes": [{
            "symbol": symbol,
            "asset": "equity",
            "data": {
                "symbol": symbol,
                "price": 200.0,
                "currency": currency,
                "asOf": "2026-08-10T18:47:34.000Z",
                "delayed": False,
            },
            "provenance": {
                "provider": "fmp",
                "label": "Financial Modeling Prep",
                "delayed": False,
                "synthetic": synthetic,
                "contract": {"passed": contract_passed, "violations": [], "notEvaluated": []},
            },
        }],
    }


@pytest.mark.asyncio
async def test_validated_facade_quote_becomes_narrow_gateway_evidence():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["symbols"] == "AAPL"
        return httpx.Response(200, json=response())

    reference = await fetch_paper_equity_reference(
        "aapl",
        "https://portal.example/api/quote",
        timeout_s=1,
        transport=httpx.MockTransport(handler),
    )

    assert reference.price == 200.0
    assert reference.currency == "USD"
    assert reference.source == "Financial Modeling Prep"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        response(symbol="MSFT"),
        response(currency="EUR"),
        response(contract_passed=False),
        response(synthetic=True),
        response(synthetic="true"),
        response(synthetic="false"),
        response(synthetic=1),
        {"quotes": []},
    ],
)
async def test_mismatched_or_untrusted_facade_evidence_fails_closed(payload: dict):
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=payload))
    with pytest.raises(EquityQuoteUnavailable):
        await fetch_paper_equity_reference(
            "AAPL",
            "https://portal.example/api/quote",
            timeout_s=1,
            transport=transport,
        )


def test_bridge_recognises_only_us_style_equity_tickers():
    assert is_equity_symbol("AAPL")
    assert is_equity_symbol("BRK.B")
    assert not is_equity_symbol("BTCUSDT")
    assert not is_equity_symbol("NOT-A-STOCK")


def test_order_api_overwrites_forged_paper_execution_with_gateway_evidence(monkeypatch):
    from modules.api import risk as risk_api

    captured = []

    class Execution:
        async def submit(self, order, *, actor):
            captured.append(order)
            return RiskDecision(
                order_id="ord-trusted",
                client_order_id=order.client_order_id,
                accepted=False,
                symbol=order.symbol,
                side=order.side,
                quantity=order.quantity,
                notional=order.notional,
                checks=[],
                rejected_by=["test_boundary"],
                reason="captured",
                timestamp=datetime.now(timezone.utc),
                status="REJECTED",
            )

    trusted = PaperExecutionReference(
        price=201.25,
        as_of=datetime.now(timezone.utc),
        source="Gateway provider",
        currency="USD",
    )
    fetch = AsyncMock(return_value=trusted)
    monkeypatch.setattr(risk_api, "fetch_paper_equity_reference", fetch)
    monkeypatch.setattr(
        risk_api,
        "settings",
        replace(risk_api.settings, paper_equity_quote_url="https://portal.example/api/quote"),
    )

    app = FastAPI()
    app.state.application_context = SimpleNamespace(execution_gateway=Execution())
    app.include_router(risk_api.router)
    forged = {
        "symbol": "AAPL",
        "side": "BUY",
        "notional": 1_000,
        "order_type": "MARKET",
        "paper_execution": {
            "price": 0.01,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "caller-forged",
            "currency": "USD",
        },
    }

    with TestClient(app) as client:
        response = client.post("/api/orders", json=forged)

    assert response.status_code == 200
    assert captured[0].paper_execution == trusted
    assert captured[0].paper_execution.price != forged["paper_execution"]["price"]
    fetch.assert_awaited_once_with(
        "AAPL",
        "https://portal.example/api/quote",
        timeout_s=risk_api.settings.paper_equity_quote_timeout_s,
    )
