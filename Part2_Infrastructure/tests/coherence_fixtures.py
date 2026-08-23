"""Load the recorded Kalshi payloads the coherence suite runs against.

Shared by every coherence test and by ``tools/make_coherence_fixture.py`` for
the reason ``tools/gate_fixture.py`` is shared between its generator and its
asserter: when two files must agree about what a fixture *is*, the agreement
belongs in a third file that both import.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "coherence"


def load(name: str) -> dict[str, Any]:
    """One recorded response, whole — envelope and body."""
    path = FIXTURES / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"missing coherence fixture {name!r}; run tools/capture_kalshi_fixtures.py")
    return json.loads(path.read_text(encoding="utf-8"))


def body(name: str) -> Any:
    """Just the payload Kalshi sent."""
    return load(name)["body"]


def markets(name: str) -> list[dict[str, Any]]:
    """The market list out of a ``/markets`` or nested-event fixture."""
    payload = body(name)
    return payload.get("markets") or payload.get("event", {}).get("markets") or []


def orderbook(name: str) -> tuple[str, dict[str, Any]]:
    """``(ticker, orderbook_fp)`` from a single-market orderbook fixture."""
    document = load(name)
    ticker = document["source"].split("/markets/")[1].split("/")[0]
    return ticker, document["body"]["orderbook_fp"]
