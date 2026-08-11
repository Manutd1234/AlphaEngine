"""Pytest bootstrap: put the project root on sys.path and isolate the audit DB."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Point every test at a throwaway DuckDB file and keep the tests offline.
#
# These are set before ``config`` is imported precisely so they win over a local
# ``.env``: python-dotenv does not override variables that already exist. A
# developer's deployment file must not decide whether the suite passes — the
# tests that care about authentication turn it on themselves via monkeypatch.
_TMP = Path(tempfile.mkdtemp(prefix="alphaengine-test-"))
os.environ.setdefault("DATA_DIR", str(_TMP))
os.environ.setdefault("DB_PATH", str(_TMP / "test.duckdb"))
os.environ.setdefault("ENABLE_MARKET_DATA", "0")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")
os.environ.setdefault("REQUIRE_AUTH", "0")


def stub_feed(name: str, book):
    """A real ``VenueFeed`` pre-loaded with a fixed book and no WebSocket.

    Using the production class (rather than a duck-typed stand-in) means the
    tests exercise the same ``status()`` / staleness logic the gateway does.
    """
    from modules.tca_engine import VenueFeed

    feed = VenueFeed([book.symbol])
    feed.name = name
    feed.books = {book.symbol: book}
    feed.connected = True
    return feed


def deep_book(symbol: str = "BTCUSDT", venue: str = "TEST", mid: float = 100.0, size: float = 5000.0):
    """50 levels either side of ``mid``, 1c apart — deep enough that sizing maths
    is exact and slippage is small but non-zero."""
    from modules.tca_engine import BookState

    book = BookState(venue, symbol)
    book.apply_snapshot(
        bids=[(round(mid - i * 0.01, 4), size) for i in range(50)],
        asks=[(round(mid + i * 0.01, 4), size) for i in range(50)],
    )
    return book


# ---------------------------------------------------------------------------
# Telegram fixtures.
#
# These lived in `test_telegram.py`, which meant a second Telegram test file
# could not use them — pytest only shares fixtures through conftest. They are
# defined here so the registry floor in `test_telegram_commands.py` and the
# suites in `test_telegram.py` exercise exactly the same bot.
# ---------------------------------------------------------------------------

import pytest  # noqa: E402


@pytest.fixture
def bot(tmp_path):
    """A bot wired to real engines on a throwaway DuckDB, sending nowhere.

    Real `TCAEngine`/`RiskGateway`/`AuditLog`/`JobQueue` on purpose: a stubbed
    engine would let a handler pass a test and fail against the thing it
    actually calls.
    """
    from test_telegram import StubBot

    from modules.audit import AuditLog
    from modules.jobs import JobQueue
    from modules.risk_proxy import RiskGateway, TokenBucket
    from modules.tca_engine import TCAEngine

    tca = TCAEngine(symbols=["BTCUSDT"], venues=[])
    tca.feeds = {"TEST": stub_feed("TEST", deep_book())}
    audit = AuditLog(tmp_path / "telegram.duckdb")
    gateway = RiskGateway(tca_engine=tca, audit=audit)
    gateway.bucket = TokenBucket(1e6, 1_000_000)
    return StubBot(gateway=gateway, tca=tca, queue=JobQueue(workers=1), audit=audit)


@pytest.fixture
def fake_market_data(monkeypatch):
    """Deterministic OpenBB responses.

    The registry floor dispatches every command, including the market ones. A
    real provider call would make the suite depend on a vendor being up and on
    a key being present, so the floor would report a network outage as a bot
    defect.
    """
    from modules import research

    async def status():
        return {"ok": True, "provider": "yfinance", "detail": None}

    async def quote(symbol, asset="equity"):
        return {"ok": True, "data": {
            "symbol": symbol, "price": 101.0, "change": 1.0, "change_percent": 1.0,
            "open": 100.0, "high": 102.0, "low": 99.0, "volume": 1234,
            "currency": "USD", "delayed": True,
        }}

    async def bars(symbol, asset, interval, limit):
        rows = [
            {"date": f"2026-08-{day:02d}", "open": 99 + day, "high": 101 + day,
             "low": 98 + day, "close": 100 + day, "volume": 1000 * day}
            for day in range(1, max(limit, 30) + 1)
        ]
        return {"ok": True, "data": rows[-limit:]}

    async def news(symbols, limit):
        return {"ok": True, "data": [
            {"title": f"{symbols[0]} update {index}", "source": "Wire", "date": "2026-08-04"}
            for index in range(limit)
        ]}

    async def fundamentals(symbol):
        return {"ok": True, "data": {
            "symbol": symbol, "name": "Example Corp", "exchange": "NMS",
            "sector": "Technology", "industry": "Software", "market_cap": 1_000_000,
            "pe_ratio": 20.0, "eps": 5.0, "beta": 1.1, "description": "A test company.",
        }}

    monkeypatch.setattr(research, "openbb_status_async", status)
    monkeypatch.setattr(research, "quote", quote)
    monkeypatch.setattr(research, "bars", bars)
    monkeypatch.setattr(research, "news", news)
    monkeypatch.setattr(research, "fundamentals", fundamentals)
