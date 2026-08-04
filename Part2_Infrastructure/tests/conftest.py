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
