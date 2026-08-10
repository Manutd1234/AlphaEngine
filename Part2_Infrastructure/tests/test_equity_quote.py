"""The gateway quote bridge trusts evidence, never browser-supplied prices."""

from __future__ import annotations

import httpx
import pytest

from modules.equity_quote import EquityQuoteUnavailable, fetch_paper_equity_reference, is_equity_symbol


def response(*, symbol: str = "AAPL", currency: str = "USD", contract_passed: bool = True) -> dict:
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
