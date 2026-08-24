"""What KIND of thing a series is about, cached for as long as the process runs.

The universe read prices families; it says nothing about what they are ABOUT.
On a watchlist spanning a crypto ladder, a weather index and a rate decision
that is the first cut a reader wants, and it is not derivable from anything the
market payload carries — a series ticker is an opaque string, and reading
``KXBTCD`` as "crypto" is a guess dressed as a fact.

Kalshi publishes it. ``GET /series/{ticker}`` carries ``category``, the same
string its own site groups by. So this reads it, and this is the only place
that decides what a family is about.

CACHED FOR THE PROCESS, deliberately and with no expiry. A series' category is
a property of what the contract is about, not of its state: KXBTCD does not
stop being Crypto between polls. Re-reading it every twenty seconds would spend
one request per series per poll against a token bucket the engine already
rations — five requests a second, shared with the reads that carry prices — to
re-learn a string that cannot have changed. A deployment that adds a series
picks it up on the first read; one that needs to forget a category restarts.

A category that could not be read is absent, never guessed and never defaulted
to "Other". The surface groups what it knows about and says how many it does
not, which is the house rule about missing measurements applied to a label.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable

logger = logging.getLogger(__name__)

# series ticker → category, as Kalshi publishes it. Process-lifetime.
_CATEGORIES: dict[str, str] = {}

# How many series metadata reads run at once. The same bound `observe` uses for
# event reads, and for the same reason: a poll should not present to the
# exchange as a burst.
CONCURRENT_SERIES_READS = 3


def parse_category(payload: dict[str, Any] | None) -> str:
    """The ``category`` field of a ``/series`` payload, or the empty string.

    Empty means "this read did not carry one", which the caller must keep
    distinct from a category whose name happens to be unfamiliar.
    """
    if not payload:
        return ""
    series = payload.get("series", payload)
    if not isinstance(series, dict):
        return ""
    return str(series.get("category") or "").strip()


async def categories_for(client: KalshiClient, series_tickers: list[str]) -> dict[str, str]:
    """Category per series ticker, reading only the ones not already known.

    Never raises. A series the exchange would not answer for is left out of the
    returned map rather than given a placeholder — the caller reports the gap.
    """
    unknown = [ticker for ticker in dict.fromkeys(series_tickers) if ticker not in _CATEGORIES]
    if unknown:
        semaphore = asyncio.Semaphore(CONCURRENT_SERIES_READS)

        async def read(ticker: str) -> None:
            async with semaphore:
                try:
                    fetched = await client.series(ticker)
                except KalshiUnavailable as exc:
                    logger.info("coherence: no category for %s (%s)", ticker, exc.reason)
                    return
                category = parse_category(fetched.payload)
                if category:
                    _CATEGORIES[ticker] = category

        await asyncio.gather(*(read(ticker) for ticker in unknown))

    return {ticker: _CATEGORIES[ticker] for ticker in series_tickers if ticker in _CATEGORIES}


def forget_categories() -> None:
    """Testing seam: one suite's watchlist must not leak into another's."""
    _CATEGORIES.clear()
