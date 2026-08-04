from __future__ import annotations

from fastapi.testclient import TestClient

import app as service_app


def test_liveness_is_public_and_minimal(monkeypatch):
    monkeypatch.setenv("OPENBB_API_TOKEN", "protected")
    with TestClient(service_app.app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "alphaengine-openbb"}
    assert response.headers["cache-control"] == "no-store"


def test_openbb_routes_support_optional_bearer_auth(monkeypatch):
    monkeypatch.setenv("OPENBB_API_TOKEN", "correct-token")
    monkeypatch.setattr(
        service_app,
        "provider_status",
        lambda: {"ok": True, "provider": "yfinance"},
    )
    with TestClient(service_app.app) as client:
        assert client.get("/api/research/openbb/health").status_code == 401
        assert client.get(
            "/api/research/openbb/health",
            headers={"Authorization": "Bearer wrong"},
        ).status_code == 401
        response = client.get(
            "/api/research/openbb/health",
            headers={"Authorization": "Bearer correct-token"},
        )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "provider": "yfinance"}


def test_auth_is_disabled_when_token_is_unset(monkeypatch):
    monkeypatch.delenv("OPENBB_API_TOKEN", raising=False)
    monkeypatch.setattr(
        service_app,
        "provider_status",
        lambda: {"ok": True, "provider": "yfinance"},
    )
    with TestClient(service_app.app) as client:
        response = client.get("/api/research/openbb/health")
    assert response.status_code == 200


def test_route_envelopes_and_normalizes_inputs(monkeypatch):
    monkeypatch.delenv("OPENBB_API_TOKEN", raising=False)
    seen: dict[str, object] = {}

    async def fake_quote(symbol: str, asset: str):
        seen["quote"] = (symbol, asset)
        return {"symbol": symbol, "price": 101.0}

    async def fake_bars(symbol: str, asset: str, interval: str, limit: int):
        seen["bars"] = (symbol, asset, interval, limit)
        return [{"date": "2026-01-01", "close": 101.0}]

    async def fake_news(symbols: list[str], limit: int):
        seen["news"] = (symbols, limit)
        return [{"title": "Update", "url": "https://example.test/story"}]

    async def fake_fundamentals(symbol: str):
        seen["fundamentals"] = symbol
        return {"symbol": symbol, "market_cap": 1_000_000.0}

    monkeypatch.setattr(service_app, "quote", fake_quote)
    monkeypatch.setattr(service_app, "bars", fake_bars)
    monkeypatch.setattr(service_app, "news", fake_news)
    monkeypatch.setattr(service_app, "fundamentals", fake_fundamentals)

    with TestClient(service_app.app) as client:
        quote_response = client.get(
            "/api/research/openbb/quote?symbol=aapl&asset=equity"
        )
        bars_response = client.get(
            "/api/research/openbb/bars?symbol=btcusdt&asset=crypto&interval=4h&limit=10"
        )
        news_response = client.get(
            "/api/research/openbb/news?symbols=aapl,msft,goog,amzn,meta,nvda,tsla&limit=5"
        )
        fundamentals_response = client.get(
            "/api/research/openbb/fundamentals?symbol=msft"
        )

    assert quote_response.json()["ok"] is True
    assert bars_response.json()["ok"] is True
    assert news_response.json()["ok"] is True
    assert fundamentals_response.json()["ok"] is True
    assert seen == {
        "quote": ("AAPL", "equity"),
        "bars": ("BTCUSDT", "crypto", "4h", 10),
        "news": (["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA"], 5),
        "fundamentals": "MSFT",
    }


def test_provider_failure_is_a_routing_signal(monkeypatch):
    monkeypatch.delenv("OPENBB_API_TOKEN", raising=False)

    async def unavailable(_symbol: str, _asset: str):
        raise service_app.ProviderUnavailable("OpenBB/YFinance quote is unavailable.")

    monkeypatch.setattr(service_app, "quote", unavailable)
    with TestClient(service_app.app) as client:
        response = client.get("/api/research/openbb/quote?symbol=AAPL")
    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "error": "OpenBB/YFinance quote is unavailable.",
    }


def test_invalid_inputs_are_rejected_before_provider_call(monkeypatch):
    monkeypatch.delenv("OPENBB_API_TOKEN", raising=False)
    with TestClient(service_app.app) as client:
        assert client.get(
            "/api/research/openbb/quote?symbol=A;DROP"
        ).status_code == 422
        assert client.get(
            "/api/research/openbb/bars?symbol=AAPL&interval=7m"
        ).status_code == 422
        assert client.get(
            "/api/research/openbb/news?symbols=AAPL,$BAD"
        ).status_code == 422
