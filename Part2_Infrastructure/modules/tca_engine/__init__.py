"""
Module A — Cross-Venue TCA & Order Book Depth Engine
=====================================================

Trading alpha
-------------
Execution slippage is a silent, compounding tax on strategy returns. A signal
with a 12 bps expected edge per trade is *unprofitable* if it routes into a book
that costs 15 bps to cross. This module maintains live L2 books from multiple
venues, prices a target order against the real ladder, and computes the
allocation that minimises blended cost.

What is live vs. mocked
-----------------------
* LIVE  — public L2 WebSocket feeds from Binance and Bybit, sequence handling,
          heartbeats and exponential-backoff reconnection.
* LIVE  — VWAP / slippage / depth analytics and the cross-venue router.
* MOCK  — order *execution* is paper-only (see ``risk_proxy``); fills are priced
          off the live ladder rather than sent to an exchange.
* MOCK  — when ``ALLOW_SYNTHETIC_BOOK=1`` is explicitly set and every feed is
          unreachable, a synthetic random-walk book keeps a demo readable.
          Every payload derived from it carries ``synthetic: true``.

Design note — why partial-book streams
--------------------------------------
Binance is consumed via ``<symbol>@depth20@100ms`` (a self-contained top-of-book
snapshot every 100ms) rather than the diff stream. The diff stream requires a
REST snapshot + buffered-delta reconciliation that silently corrupts the book if
a single message is dropped. For a 20-level, $100k-probe use case the partial
stream is strictly more robust. Bybit's ``orderbook.50`` *is* consumed as
snapshot + delta because it is sequence-tagged: ``u`` increments by exactly 1
per delta, and any other step is a gap that forces a resubscribe.

The module became a package, split along the seams it already had: the ladder,
the feed base class, one file per venue protocol, and the engine's two halves —
supervision and analytics. Every public name is re-exported, so
``from modules.tca_engine import BookState`` means exactly what it did.

``settings`` is re-exported deliberately and is load-bearing: it is the name
``tools/gate_fixture.py`` patches to pin the gate-parity battery's limits, and
every submodule reads it back through this module rather than binding its own
copy. See ``_runtime.py`` for why.
"""

from __future__ import annotations

import logging

from config import settings as settings  # noqa: F401 - the gate fixture's patch point
from modules.tca_engine._runtime import _utcnow as _utcnow  # noqa: F401
from modules.tca_engine.analytics import EngineAnalytics as EngineAnalytics  # noqa: F401
from modules.tca_engine.binance import BinanceFeed as BinanceFeed  # noqa: F401
from modules.tca_engine.book import BookState as BookState  # noqa: F401
from modules.tca_engine.book import _new_native_ladder as _new_native_ladder  # noqa: F401
from modules.tca_engine.bybit import BybitFeed as BybitFeed  # noqa: F401
from modules.tca_engine.bybit import is_sequence_gap as is_sequence_gap  # noqa: F401
from modules.tca_engine.engine import TCAEngine as TCAEngine  # noqa: F401
from modules.tca_engine.engine import get_engine as get_engine  # noqa: F401
from modules.tca_engine.feed import VenueFeed as VenueFeed  # noqa: F401
from modules.tca_engine.supervision import FeedSupervision as FeedSupervision  # noqa: F401
from modules.tca_engine.synthetic import SyntheticFeed as SyntheticFeed  # noqa: F401
from modules.tca_engine.tolerance import FILL_TOLERANCE as FILL_TOLERANCE  # noqa: F401
from modules.tca_engine.tolerance import _dust as _dust  # noqa: F401
from modules.tca_engine.tolerance import absorbs as absorbs  # noqa: F401

log = logging.getLogger("alphaengine.tca")

__all__ = [
    "FILL_TOLERANCE",
    "BinanceFeed",
    "BookState",
    "BybitFeed",
    "EngineAnalytics",
    "FeedSupervision",
    "SyntheticFeed",
    "TCAEngine",
    "VenueFeed",
    "absorbs",
    "get_engine",
    "is_sequence_gap",
    "log",
    "settings",
]
