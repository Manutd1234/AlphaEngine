"""Bounded retry policy for the authenticated Kalshi RFQ channel."""

from __future__ import annotations

import httpx
import pytest

from modules.coherence import tunables
from modules.coherence.drivers.kalshi_auth import SignedHeaders
from modules.coherence.drivers.kalshi_rest import KalshiClient
from modules.coherence.drivers.rfq import read_panel
from modules.coherence.scheduler.budget import ReadBudget

ROUTE_RFQS = "/communications/rfqs"
ROUTE_QUOTES = "/communications/quotes"


@pytest.fixture(autouse=True)
def signing_seam(monkeypatch):
    def sign(_method: str, _path: str, host: str) -> SignedHeaders:
        return SignedHeaders(key_id="test", timestamp_ms="1", signature="signature", host=host)

    monkeypatch.setattr("modules.coherence.drivers.kalshi_rest.kalshi_auth.sign", sign)


def client_with_status(status: int) -> KalshiClient:
    return KalshiClient(
        base_url=tunables.DEMO_BASE_URL,
        failover_url="",
        signing_environment="demo",
        transport=httpx.MockTransport(lambda _request: httpx.Response(status, json={})),
        budget=ReadBudget(),
    )


@pytest.mark.anyio
async def test_a_server_fault_is_an_outage_rather_than_a_refusal():
    """A 503 is retryable venue unavailability, not an authentication refusal."""
    result = await read_panel(client_with_status(503))

    assert result["state"] == "unavailable"
    assert result["signing_environment"] == "demo"
    assert result["rfqs"] == []
    assert "after one bounded retry" in result["detail"]


@pytest.mark.anyio
async def test_a_transient_server_fault_is_retried_once_and_recovers():
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts <= 2:
            return httpx.Response(503, json={"error": "temporary"})
        collection = "rfqs" if request.url.path.endswith(ROUTE_RFQS) else "quotes"
        return httpx.Response(200, json={collection: []})

    made = KalshiClient(
        base_url=tunables.DEMO_BASE_URL,
        failover_url="",
        signing_environment="demo",
        transport=httpx.MockTransport(handler),
        budget=ReadBudget(),
    )

    result = await read_panel(made)

    assert result["state"] == "empty"
    assert attempts == 4
