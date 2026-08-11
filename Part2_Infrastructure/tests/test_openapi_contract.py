"""The API contract, pinned.

Two independently-deployed clients (the Next.js workspace and the Telegram
companion) call this gateway across a network boundary, so nothing catches a
breaking change at build time. These tests make the committed schema the
contract: an unintended rename or a dropped route fails here rather than in a
browser.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from export_openapi import OUT, build_schema, render  # noqa: E402


@pytest.fixture(scope="module")
def schema() -> dict:
    return build_schema()


def test_snapshot_matches_the_live_schema(schema):
    assert OUT.exists(), "run tools/export_openapi.py to create the snapshot"
    assert OUT.read_text() == render(schema), (
        "the API changed but tools/openapi.json was not regenerated — "
        "run `python tools/export_openapi.py` and review the diff"
    )


def test_every_client_facing_route_is_published(schema):
    """Routes the web workspace and companion depend on."""
    published = set(schema["paths"])
    for path in (
        "/health",
        "/metrics",
        "/api/ops/snapshot",
        "/api/ops/web-state/sync",
        "/api/config",
        "/api/book/{symbol}",
        "/api/tca/{symbol}",
        "/api/orders",
        "/api/orders/{order_id}",
        "/api/orders/{order_id}/cancel",
        "/api/orders/{order_id}/replace",
        "/api/risk/state",
        "/api/risk/limits",
        "/api/risk/kill",
        "/api/risk/resume",
        "/api/portfolio",
        "/api/portfolio/history",
        "/api/backtest",
        "/api/jobs",
        "/api/audit/orders",
        "/api/audit/events",
        "/api/audit/backtests",
        "/api/research/rag/search",
        "/api/research/rag/status",
    ):
        assert path in published, f"{path} disappeared from the API"


def test_responses_are_typed_not_free_form(schema):
    """A documented route with no response schema is a contract in name only."""
    untyped = []
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            ok = operation.get("responses", {}).get("200", {})
            if "content" not in ok:
                untyped.append(f"{method.upper()} {path}")
    assert not untyped, f"routes without a 200 response schema: {untyped}"


def test_backtest_parameters_are_documented_with_bounds(schema):
    """The request model doubles as the researcher's parameter registry."""
    properties = schema["components"]["schemas"]["BacktestRequest"]["properties"]

    for name in ("bars", "fast_min", "fast_max", "slow_min", "slow_max", "folds", "embargo_bars"):
        field = properties[name]
        assert "description" in field, f"{name} has no description in /docs"
        assert {"minimum", "maximum"} <= set(field), f"{name} publishes no bounds"

    # Costs are the parameters most often quietly set to zero, so their
    # documentation is the one place a reviewer can check the assumption.
    assert "slippage" in properties["slippage_bps"]["description"].lower()
