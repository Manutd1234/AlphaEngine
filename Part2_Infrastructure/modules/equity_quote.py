"""Trusted equity quote bridge for older authenticated order clients.

The Vercel portal owns the provider registry and its credentials. The gateway
asks that public, validated facade for a quote only when an authenticated client
did not already attach the newer ``paper_execution`` envelope. A failure never
becomes a guessed price: the caller submits the original order and the normal
whitelist/price gates reject it with their full evidence vector.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from pydantic import ValidationError

from modules.schemas import PaperExecutionReference

EQUITY_SYMBOL_RE = re.compile(r"^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$")


class EquityQuoteUnavailable(RuntimeError):
    """The configured quote facade could not produce trusted USD evidence."""


def is_equity_symbol(symbol: str) -> bool:
    return EQUITY_SYMBOL_RE.fullmatch(symbol.strip().upper()) is not None


async def fetch_paper_equity_reference(
    symbol: str,
    endpoint: str,
    *,
    timeout_s: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> PaperExecutionReference:
    """Fetch and narrow one provider-registry quote, failing closed on drift."""

    expected = symbol.strip().upper()
    if not endpoint or not is_equity_symbol(expected):
        raise EquityQuoteUnavailable("paper equity quote bridge is not configured for this symbol")

    try:
        async with httpx.AsyncClient(
            timeout=max(0.1, timeout_s),
            follow_redirects=False,
            transport=transport,
        ) as client:
            response = await client.get(endpoint, params={"symbols": expected})
            response.raise_for_status()
            payload: Any = response.json()

        rows = payload.get("quotes") if isinstance(payload, dict) else None
        row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
        data = row.get("data") if isinstance(row, dict) else None
        provenance = row.get("provenance") if isinstance(row, dict) else None
        if not isinstance(data, dict) or not isinstance(provenance, dict):
            raise EquityQuoteUnavailable("quote facade returned no provider evidence")

        actual = str(data.get("symbol") or "").strip().upper()
        if actual != expected:
            raise EquityQuoteUnavailable("quote facade returned a different symbol")
        contract = provenance.get("contract")
        if not isinstance(contract, dict) or contract.get("passed") is not True:
            raise EquityQuoteUnavailable("quote facade data contract did not pass")
        synthetic = provenance.get("synthetic", False)
        if not isinstance(synthetic, bool):
            raise EquityQuoteUnavailable("quote facade returned malformed provenance")
        if synthetic:
            raise EquityQuoteUnavailable("synthetic quote is display-only and cannot price an order")

        source = str(provenance.get("label") or provenance.get("provider") or "").strip()
        return PaperExecutionReference(
            price=data.get("price"),
            as_of=data.get("asOf"),
            source=source,
            currency=str(data.get("currency") or "").upper(),
            delayed=bool(data.get("delayed") or provenance.get("delayed")),
        )
    except EquityQuoteUnavailable:
        raise
    except (httpx.HTTPError, TypeError, ValueError, ValidationError) as exc:
        raise EquityQuoteUnavailable("trusted USD equity quote is unavailable") from exc
