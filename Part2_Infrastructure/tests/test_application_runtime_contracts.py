"""Application composition and failure contracts at the HTTP boundary."""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from modules.application_context import ApplicationContext
from modules.application_services import (
    ExecutionGatewayService,
    MarketDataProvider,
    RiskEngineManager,
)
from modules.backend_runtime import BackendDeadlineExceeded, RequestBudget
from modules.request_budget import RequestBudgetMiddleware


@dataclass
class _Health:
    marker: str

    def snapshot(self) -> dict[str, str]:
        return {"source": self.marker}


def test_health_route_uses_the_lifespan_owned_context(monkeypatch):
    """A route must use the graph installed on its app, not module globals."""
    from modules.api import meta

    context = ApplicationContext(
        runtime=object(),
        market_data=object(),
        execution_gateway=object(),
        risk_engine=object(),
        jobs=object(),
        audit=object(),
        telegram=object(),
        health=_Health("injected"),
        book_stream=object(),
    )
    app = FastAPI()
    app.state.application_context = context
    app.include_router(meta.router)

    monkeypatch.setattr(meta, "get_engine", lambda: pytest.fail("route bypassed its context"))
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"source": "injected"}


def test_application_context_is_immutable_after_composition():
    context = ApplicationContext(
        runtime=object(),
        market_data=object(),
        execution_gateway=object(),
        risk_engine=object(),
        jobs=object(),
        audit=object(),
        telegram=object(),
        health=_Health("stable"),
        book_stream=object(),
    )
    with pytest.raises(AttributeError):
        context.runtime = object()


@pytest.mark.asyncio
async def test_named_application_services_delegate_without_copying_domain_logic():
    decision = object()
    ack = object()
    books = [object()]
    report = object()
    state = object()
    kill = object()
    gateway = SimpleNamespace(
        submit=AsyncMock(return_value=decision),
        list_working=Mock(return_value=[object()]),
        cancel_working=AsyncMock(return_value=ack),
        replace_working=AsyncMock(return_value=decision),
        state=Mock(return_value=state),
        decision_core_status=Mock(return_value={"selected": "python"}),
        trigger_kill=AsyncMock(return_value=kill),
        release_kill=AsyncMock(return_value=kill),
        set_reduce_only=AsyncMock(return_value=state),
        reset_book=Mock(),
    )
    market_engine = SimpleNamespace(
        health=Mock(return_value={"state": "ok"}),
        get_books=Mock(return_value=books),
        consolidated_mid=Mock(return_value=100.0),
        venues_online=Mock(return_value=["TEST"]),
        tca_report=Mock(return_value=report),
    )
    execution = ExecutionGatewayService(gateway)
    risk = RiskEngineManager(gateway)
    market = MarketDataProvider(market_engine)
    order = object()
    replacement = object()

    assert await execution.submit(order, actor="web:test") is decision
    assert execution.list_working("BTCUSDT") == gateway.list_working.return_value
    assert await execution.cancel("o-1", actor="web:test", reason="done") is ack
    assert await execution.replace("o-1", replacement, actor="web:test") is decision
    assert risk.state() is state
    assert await risk.engage_kill(reason="halt", actor="web:test", symbol=None) is kill
    assert market.get_books("BTCUSDT", depth=7) is books
    assert market.tca_report("BTCUSDT", "BUY", 1000.0) is report

    gateway.submit.assert_awaited_once_with(order, source="web:test")
    gateway.cancel_working.assert_awaited_once_with("o-1", actor="web:test", reason="done")
    gateway.replace_working.assert_awaited_once_with("o-1", replacement, actor="web:test")
    gateway.trigger_kill.assert_awaited_once_with(reason="halt", actor="web:test", symbol=None)
    market_engine.get_books.assert_called_once_with("BTCUSDT", depth=7)


def test_primary_tca_and_risk_routes_resolve_services_from_application_context(monkeypatch):
    from modules.api import risk as risk_api
    from modules.api import tca as tca_api

    execution = SimpleNamespace(list_working=Mock(return_value=[]))
    market = SimpleNamespace(get_books=Mock(return_value=[]))
    kill = SimpleNamespace(active=True, halted_symbols=set(), reason="service-bound")
    risk = SimpleNamespace(engage_kill=AsyncMock(return_value=kill))
    context = ApplicationContext(
        runtime=object(),
        market_data=market,
        execution_gateway=execution,
        risk_engine=risk,
        jobs=object(),
        audit=object(),
        telegram=object(),
        health=_Health("unused"),
        book_stream=object(),
    )
    app = FastAPI()
    app.state.application_context = context
    app.include_router(tca_api.router)
    app.include_router(risk_api.router)
    monkeypatch.setattr(risk_api, "get_gateway", lambda: pytest.fail("route bypassed its service"))

    with TestClient(app) as client:
        orders = client.get("/api/orders")
        missing_book = client.get("/api/book/NOPEUSDT")
        killed = client.post("/api/risk/kill", json={"reason": "service-bound"})

    assert orders.status_code == 200 and orders.json() == []
    assert missing_book.status_code == 404
    assert killed.status_code == 200 and killed.json()["reason"] == "service-bound"
    execution.list_working.assert_called_once_with(None)
    market.get_books.assert_called_once_with("NOPEUSDT", depth=15)
    risk.engage_kill.assert_awaited_once()


def test_book_websocket_uses_the_shared_symbol_topic_from_the_context():
    from modules.api import tca as tca_api

    class CapturingStream:
        topic: str | None = None

        async def serve(self, snapshot, send, *, topic: str) -> None:
            self.topic = topic
            sample = snapshot()
            await send(sample.payload)

    stream = CapturingStream()
    market = SimpleNamespace(
        get_books=Mock(return_value=[]),
        consolidated_mid=Mock(return_value=None),
        venues_online=Mock(return_value=[]),
        tca_report=Mock(return_value=SimpleNamespace(per_venue=[])),
    )
    context = ApplicationContext(
        runtime=object(),
        market_data=market,
        execution_gateway=object(),
        risk_engine=object(),
        jobs=object(),
        audit=object(),
        telegram=object(),
        health=_Health("unused"),
        book_stream=stream,
    )
    app = FastAPI()
    app.state.application_context = context
    app.include_router(tca_api.router)

    with TestClient(app) as client, client.websocket_connect("/ws/book/btcusdt") as socket:
        frame = socket.receive_json()

    assert stream.topic == "book:BTCUSDT"
    assert frame == {
        "type": "book",
        "symbol": "BTCUSDT",
        "consolidated_mid": None,
        "venues_online": [],
        "books": [],
    }


async def test_book_websocket_closes_an_unconfigured_symbol_with_a_visible_policy_code():
    from modules.api import tca as tca_api

    class RefusingSocket:
        closed: tuple[int, str] | None = None
        accepted = False
        headers: dict[str, str] = {}

        async def accept(self, *, subprotocol: str | None = None) -> None:
            self.accepted = True

        async def close(self, *, code: int, reason: str) -> None:
            self.closed = (code, reason)

    socket = RefusingSocket()
    await tca_api.ws_book(socket, "not-configured")  # type: ignore[arg-type]

    assert socket.accepted is True
    assert socket.closed == (1008, "symbol is not configured")


def test_book_websocket_protocol_authenticates_without_putting_the_token_in_the_url(monkeypatch):
    from modules.api import tca as tca_api

    token = "desk-token-with-unicode-✓"
    encoded = base64.urlsafe_b64encode(token.encode()).decode().rstrip("=")
    socket = SimpleNamespace(headers={
        "sec-websocket-protocol": f"alphaengine.v1, alphaengine.token.{encoded}",
    })
    monkeypatch.setattr(
        tca_api,
        "settings",
        SimpleNamespace(require_auth=True, web_api_token=token),
    )

    assert tca_api._websocket_access(socket) == (True, "alphaengine.v1")
    socket.headers["sec-websocket-protocol"] = "alphaengine.v1, alphaengine.token.invalid"
    assert tca_api._websocket_access(socket) == (False, "alphaengine.v1")


def test_book_websocket_policy_code_reaches_a_real_client(monkeypatch):
    from modules.api import tca as tca_api

    monkeypatch.setattr(
        tca_api,
        "settings",
        SimpleNamespace(require_auth=True, web_api_token="correct", symbols=["BTCUSDT"]),
    )
    app = FastAPI()
    app.include_router(tca_api.router)

    with TestClient(app) as client, pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect(
            "/ws/book/BTCUSDT",
            subprotocols=["alphaengine.v1", "alphaengine.token.bad"],
        ) as socket:
            socket.receive_json()

    assert refused.value.code == 1008


def test_deadline_envelope_names_the_boundary_and_budget_without_raw_exception_text():
    async def fail(_scope, _receive, _send) -> None:
        raise BackendDeadlineExceeded("diffusion.findings", dependency="data_ops")

    app = RequestBudgetMiddleware(fail)
    messages: list[dict] = []
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/research/diffusion/findings",
        "headers": [
            (b"x-alphaengine-request-id", b"req-contract-123"),
            (b"x-alphaengine-budget-class", b"H1"),
            (b"x-alphaengine-remaining-budget-ms", b"30"),
        ],
    }

    async def receive() -> dict:
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        messages.append(message)

    asyncio.run(app(scope, receive, send))
    body = b"".join(message.get("body", b"") for message in messages)
    import json

    payload = json.loads(body)
    assert payload["code"] == "backend_deadline_exceeded"
    assert payload["boundary"] == "diffusion.findings"
    assert payload["owner"] == "backend_runtime"
    assert payload["dependency"] == "data_ops"
    assert payload["retryable"] is True
    assert payload["state"] == "unavailable"
    assert payload["traceId"] == "req-contract-123"
    assert payload["budget"]["class"] == "H1"
    assert 0 <= payload["budget"]["consumedMs"]
    assert "BackendDeadlineExceeded" not in str(payload)


def test_internal_cancellation_is_not_translated_to_a_gateway_timeout():
    async def cancel(_scope, _receive, _send) -> None:
        raise asyncio.CancelledError

    middleware = RequestBudgetMiddleware(cancel)
    scope = {"type": "http", "method": "GET", "path": "/cancel", "headers": []}
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(middleware(scope, lambda: None, lambda _message: None))


def test_budget_reports_consumed_time_from_its_monotonic_deadline():
    budget = RequestBudget("request-123", "H1", 10.0, 13.0)
    assert budget.limit_ms == 3_000
    assert budget.consumed_ms(now=11.25) == 1_250
