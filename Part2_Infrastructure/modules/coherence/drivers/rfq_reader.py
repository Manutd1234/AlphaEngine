"""Complete, bounded reads of Kalshi's private RFQ channel.

Each collection is paginated to cursor exhaustion. A page fault, repeated
cursor, malformed envelope, or collection larger than the explicit ceiling
invalidates the whole observation: maker dispersion must never be computed
from a prefix that happens to fit in one HTTP response.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from modules.coherence.drivers.kalshi_auth import SigningUnavailable
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiRefused, KalshiUnavailable
from modules.coherence.drivers.rfq import disperse, parse_quotes, parse_rfqs

RFQ_PAGE_LIMIT = 100
QUOTE_PAGE_LIMIT = 500
MAX_RFQ_ROWS = 1_000
MAX_QUOTE_ROWS = 5_000
TRANSIENT_READ_ATTEMPTS = 2
TRANSIENT_RETRY_DELAY_S = 0.2


async def _read_pages(
    client: KalshiClient,
    path: str,
    collection: Literal["rfqs", "quotes"],
    params: dict[str, Any],
    *,
    page_limit: int,
    max_rows: int,
) -> list[Any]:
    """Read until Kalshi's cursor says complete, or refuse a partial result."""
    rows: list[Any] = []
    cursor: str | None = None
    seen: set[str] = set()
    max_pages = max_rows // page_limit
    for _ in range(max_pages):
        query = {**params, "limit": page_limit}
        if cursor is not None:
            query["cursor"] = cursor
        page = await client.get(path, query)
        page_rows = page.payload.get(collection)
        if not isinstance(page_rows, list):
            raise KalshiUnavailable(f"{path} returned no {collection} list; the private read is incomplete")
        if len(page_rows) > page_limit or len(rows) + len(page_rows) > max_rows:
            raise KalshiUnavailable(
                f"{path} exceeded the bounded {max_rows}-row private-read ceiling; no partial panel was used"
            )
        rows.extend(page_rows)
        next_cursor = page.payload.get("cursor")
        if next_cursor in (None, ""):
            return rows
        if not isinstance(next_cursor, str):
            raise KalshiUnavailable(f"{path} returned a malformed cursor; no partial panel was used")
        if next_cursor in seen:
            raise KalshiUnavailable(f"{path} repeated its cursor; no partial panel was used")
        seen.add(next_cursor)
        cursor = next_cursor
    raise KalshiUnavailable(
        f"{path} still had another cursor at the bounded {max_rows}-row ceiling; no partial panel was used"
    )


def _result(
    state: str,
    detail: str,
    environment: Literal["demo", "production"] | None,
    *,
    rfqs: list[Any] | None = None,
    open_quotes: int = 0,
    dispersions: list[Any] | None = None,
) -> dict[str, Any]:
    return {
        "state": state,
        "detail": detail,
        "signing_environment": environment,
        "rfqs": rfqs or [],
        "open_quotes": open_quotes,
        "dispersions": dispersions or [],
    }


def _empty_detail(environment: Literal["demo", "production"] | None) -> str:
    if environment == "demo":
        return (
            "the demo private channel answered, and there are no open RFQs or quotes. "
            "That is the usual sandbox state: makers generally do not quote demo requests"
        )
    if environment == "production":
        return (
            "the production private channel answered, and this authenticated account currently "
            "has no open RFQs or quotes visible to it"
        )
    return "the private channel answered, and there are no open RFQs or quotes"


def _complete_result(
    raw_rfqs: list[Any],
    raw_quotes: list[Any],
    environment: Literal["demo", "production"] | None,
    channel: str,
) -> dict[str, Any]:
    rfqs = parse_rfqs({"rfqs": raw_rfqs})
    quotes = parse_quotes({"quotes": raw_quotes})
    if not rfqs and not quotes:
        return _result("empty", _empty_detail(environment), environment)
    if rfqs and not quotes:
        return _result(
            "requests_only",
            f"the {channel} returned {len(rfqs)} open request(s), but zero open maker quotes; "
            "no maker dispersion was measured",
            environment,
            rfqs=rfqs,
        )
    keys: list[tuple[str, str]] = []
    for item in [*rfqs, *quotes]:
        key = (item.rfq_id, item.market_ticker)
        if all(key) and key not in keys:
            keys.append(key)
    if quotes and not keys:
        return _result(
            "unavailable",
            f"the {channel} returned quote rows without RFQ and market identities; "
            "no cross-request blend was produced",
            environment,
        )
    markets = {ticker for _, ticker in keys}
    return _result(
        "available",
        f"the {channel} returned {len(rfqs)} open request(s) and {len(quotes)} current maker quote(s) "
        f"across {len(keys)} RFQ(s) and {len(markets)} market(s)",
        environment,
        rfqs=rfqs,
        open_quotes=len(quotes),
        dispersions=[disperse(rfq_id, ticker, quotes) for rfq_id, ticker in keys],
    )


async def _read_private_collections(client: KalshiClient) -> tuple[list[Any], list[Any]]:
    """Read both halves together and stop the sibling when either half fails.

    ``asyncio.gather`` propagates its first exception but ordinarily lets other
    awaitables continue. Here that could spend more private-read budget after
    the observation is already unusable, so the sibling is explicitly cancelled
    and drained before the failure reaches ``read_panel``.
    """
    tasks = (
        asyncio.create_task(
            _read_pages(
                client,
                "/communications/rfqs",
                "rfqs",
                {"user_filter": "self", "status": "open"},
                page_limit=RFQ_PAGE_LIMIT,
                max_rows=MAX_RFQ_ROWS,
            )
        ),
        asyncio.create_task(
            _read_pages(
                client,
                "/communications/quotes",
                "quotes",
                {"rfq_user_filter": "self", "status": "open"},
                page_limit=QUOTE_PAGE_LIMIT,
                max_rows=MAX_QUOTE_ROWS,
            )
        ),
    )
    try:
        rfqs, quotes = await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return rfqs, quotes


async def read_panel(client: KalshiClient) -> dict[str, Any]:
    """The complete open RFQs and current maker rows visible to this account."""
    environment = client.signing_environment
    channel = f"{environment} private channel" if environment else "private channel"
    transient_attempts = 0
    try:
        while True:
            try:
                raw_rfqs, raw_quotes = await _read_private_collections(client)
                break
            except KalshiUnavailable as exc:
                retryable = exc.status is not None and (exc.status == 429 or exc.status >= 500)
                transient_attempts += 1
                if not retryable or transient_attempts >= TRANSIENT_READ_ATTEMPTS:
                    raise
                await asyncio.sleep(TRANSIENT_RETRY_DELAY_S)
    except KalshiRefused as exc:
        return _result(
            "refused",
            f"the {channel} refused this key. RFQ reads are signed-only and credentials are "
            f"environment-specific; the gateway did not retry another environment. {exc.reason}",
            environment,
        )
    except SigningUnavailable as exc:
        return _result(
            "signing_unavailable", f"{channel} signing is not ready: {exc}", environment,
        )
    except KalshiUnavailable as exc:
        retried = " after one bounded retry" if transient_attempts > 1 else ""
        return _result("unavailable", f"the {channel} is unavailable{retried}: {exc.reason}", environment)
    return _complete_result(raw_rfqs, raw_quotes, environment, channel)
