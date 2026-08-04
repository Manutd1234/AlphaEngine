from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import provider
import pytest


class Row:
    def __init__(self, **values):
        self.values = values

    def model_dump(self, mode: str = "python"):
        assert mode == "json"
        return self.values


def fetcher(result=None, error: Exception | None = None):
    class FakeFetcher:
        @classmethod
        async def fetch_data(cls, params, credentials=None):
            assert credentials is None
            if error:
                raise error
            return result

    return FakeFetcher


@pytest.fixture
def fake_fetchers(monkeypatch):
    empty = fetcher([])
    classes = provider.FetcherClasses(
        equity_quote=empty,
        equity_historical=empty,
        crypto_historical=empty,
        company_news=empty,
        equity_profile=empty,
        key_metrics=empty,
    )
    monkeypatch.setattr(provider, "get_fetchers", lambda: classes)
    return classes


@pytest.mark.anyio
async def test_equity_quote_contract(fake_fetchers, monkeypatch):
    quote_fetcher = fetcher(
        [
            Row(
                symbol="AAPL",
                last_price=195.5,
                prev_close=190.0,
                open=191.0,
                high=196.0,
                low=189.5,
                volume=1_000,
                currency="USD",
            )
        ]
    )
    monkeypatch.setattr(
        provider,
        "get_fetchers",
        lambda: replace(fake_fetchers, equity_quote=quote_fetcher),
    )
    result = await provider.quote("AAPL", "equity")
    assert result["price"] == 195.5
    assert result["change"] == 5.5
    assert result["change_percent"] == pytest.approx(2.8947368)
    assert result["delayed"] is True


@pytest.mark.anyio
async def test_crypto_quote_symbol_mapping(fake_fetchers, monkeypatch):
    seen = {}

    class CryptoFetcher:
        @classmethod
        async def fetch_data(cls, params, credentials=None):
            seen.update(params)
            return [
                Row(date="2026-01-01", close=100.0),
                Row(date="2026-01-02", close=105.0),
            ]

    monkeypatch.setattr(
        provider,
        "get_fetchers",
        lambda: replace(fake_fetchers, crypto_historical=CryptoFetcher),
    )
    result = await provider.quote("BTCUSDT", "crypto")
    assert seen["symbol"] == "BTC-USD"
    assert result["price"] == 105.0
    assert result["change_percent"] == 5.0


@pytest.mark.anyio
async def test_four_hour_bars_are_aggregated(fake_fetchers, monkeypatch):
    rows = [
        Row(
            date=f"2026-01-01T0{hour}:00:00",
            open=100 + hour,
            high=102 + hour,
            low=99 + hour,
            close=101 + hour,
            volume=10,
        )
        for hour in range(8)
    ]
    monkeypatch.setattr(
        provider,
        "get_fetchers",
        lambda: replace(fake_fetchers, equity_historical=fetcher(rows)),
    )
    result = await provider.bars("AAPL", "equity", "4h", 10)
    assert len(result) == 2
    assert result[0] == {
        "date": "2026-01-01T00:00:00",
        "open": 100.0,
        "high": 105.0,
        "low": 99.0,
        "close": 104.0,
        "volume": 40.0,
    }


@pytest.mark.anyio
async def test_news_and_fundamentals_contracts(fake_fetchers, monkeypatch):
    news_rows = [
        Row(
            symbol="AAPL",
            title="Earnings update",
            url="https://example.test/aapl",
            source="Example Wire",
            date="2026-01-01T00:00:00Z",
            text="Summary",
        )
    ]
    profile_rows = [
        Row(
            name="Apple Inc.",
            stock_exchange="NMS",
            sector="Technology",
            industry_category="Consumer Electronics",
            currency="USD",
            market_cap=3_000_000,
            shares_outstanding=15_000,
            long_description="Description",
        )
    ]
    metric_rows = [Row(pe_ratio=30.0, eps_ttm=6.5, beta=1.2)]
    monkeypatch.setattr(
        provider,
        "get_fetchers",
        lambda: replace(
            fake_fetchers,
            company_news=fetcher(news_rows),
            equity_profile=fetcher(profile_rows),
            key_metrics=fetcher(metric_rows),
        ),
    )
    news_result = await provider.news(["AAPL"], 5)
    fundamentals_result = await provider.fundamentals("AAPL")
    assert news_result[0]["symbols"] == ["AAPL"]
    assert fundamentals_result["name"] == "Apple Inc."
    assert fundamentals_result["pe_ratio"] == 30.0
    assert fundamentals_result["eps"] == 6.5


@pytest.mark.anyio
async def test_provider_errors_are_sanitized(fake_fetchers, monkeypatch):
    secretish = RuntimeError("https://upstream.invalid/?token=do-not-return")
    monkeypatch.setattr(
        provider,
        "get_fetchers",
        lambda: replace(fake_fetchers, equity_quote=fetcher(error=secretish)),
    )
    with pytest.raises(provider.ProviderUnavailable) as exc:
        await provider.quote("AAPL", "equity")
    assert "token" not in str(exc.value)
    assert "upstream.invalid" not in str(exc.value)


def test_service_uses_direct_provider_fetchers_only():
    service_root = Path(__file__).resolve().parents[1]
    source = (service_root / "provider.py").read_text()
    assert "from openbb import" not in source
    assert "openbb_yfinance.models" in source

    requirements = (service_root / "requirements.txt").read_text().splitlines()
    assert "openbb-core==1.6.13" in requirements
    assert "openbb-yfinance==1.6.3" in requirements
    assert "yfinance==1.5.2" in requirements
    assert not any(line.startswith("openbb==") for line in requirements)
