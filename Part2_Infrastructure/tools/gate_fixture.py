"""Load one gate-parity scenario into a real ``RiskGateway`` and judge it.

Shared by ``tools/make_gate_fixture.py`` (which RECORDS what the Python
reference decides) and ``tests/test_gate_parity.py`` (which ASSERTS the running
engine still decides the same). Every clock the seventeen gates read is pinned
to the scenario's fixed clock, every limit comes from the scenario, and the
gateway is seeded directly — no network, no audit, no wall time — so the same
scenario produces the same decision on every machine and, later, in every
engine that claims to implement the battery.
"""

from __future__ import annotations

import asyncio
import dataclasses
import time
from datetime import datetime, timezone
from typing import Any

import modules.risk_proxy as risk_proxy
import modules.tca_engine as tca_engine
from config import settings as base_settings
from modules.risk_proxy import PositionState, RiskGateway, TokenBucket
from modules.schemas import OrderRequest, RiskDecision
from modules.tca_engine import BookState, TCAEngine

#: The seventeen gates, in the order ``submit()`` evaluates them. A scenario's
#: ``expected.checks`` is always a subsequence of this list.
GATE_ORDER: tuple[str, ...] = (
    "kill_switch",
    "symbol_halt",
    "symbol_whitelist",
    "paper_execution_model",
    "reference_freshness",
    "duplicate_order",
    "rate_limit",
    "price_available",
    "order_sized",
    "max_order_notional",
    "symbol_concentration",
    "gross_exposure",
    "price_band",
    "working_book",
    "daily_drawdown",
    "reduce_only",
    "est_slippage",
)

#: Every settings field a gate reads. A scenario carries all of them, so a
#: default that changes cannot silently change what the fixture pins.
LIMIT_FIELDS: tuple[str, ...] = (
    "symbols",
    "venue_stale_after_s",
    "max_order_notional_usd",
    "max_gross_exposure_usd",
    "max_symbol_notional_usd",
    "max_orders_per_sec",
    "rate_limit_burst",
    "max_daily_drawdown_pct",
    "reduce_only_threshold",
    "max_price_deviation_bps",
    "max_est_slippage_bps",
    "starting_equity_usd",
    "paper_equity_slippage_bps",
    "paper_equity_quote_max_age_s",
    "max_working_orders",
)


def default_limits() -> dict[str, Any]:
    return {name: getattr(base_settings, name) for name in LIMIT_FIELDS}


class _Feed:
    def __init__(self, books: dict[str, BookState]) -> None:
        self.connected = True
        self.books = books


class _Clock:
    """The three clocks the battery reads, all frozen at the scenario's instant."""

    def __init__(self, wall_iso: str, monotonic_s: float) -> None:
        self.wall = datetime.fromisoformat(wall_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
        self.wall_epoch = self.wall.timestamp()
        self.monotonic = monotonic_s

    def install(self, monkeypatch) -> None:
        monkeypatch.setattr(risk_proxy, "_utcnow", lambda: self.wall)
        monkeypatch.setattr(time, "monotonic", lambda: self.monotonic)
        monkeypatch.setattr(time, "time", lambda: self.wall_epoch)


class _Patcher:
    """A tiny stand-in for pytest's monkeypatch, for the generator."""

    def __init__(self) -> None:
        self._undo: list[tuple[Any, str, Any]] = []

    def setattr(self, target: Any, name: str, value: Any) -> None:
        self._undo.append((target, name, getattr(target, name)))
        setattr(target, name, value)

    def undo(self) -> None:
        for target, name, value in reversed(self._undo):
            setattr(target, name, value)
        self._undo.clear()


def build_gateway(scenario: dict[str, Any], monkeypatch) -> RiskGateway:
    """Seed a gateway with the scenario's state under the scenario's clock and limits."""
    clock = _Clock(scenario["clock"]["wall_iso"], scenario["clock"]["monotonic_s"])
    clock.install(monkeypatch)

    limits = dataclasses.replace(base_settings, **scenario["limits"])
    monkeypatch.setattr(risk_proxy, "settings", limits)
    monkeypatch.setattr(tca_engine, "settings", limits)

    engine = TCAEngine(symbols=list(limits.symbols), venues=[])
    feeds: dict[str, _Feed] = {}
    for spec in scenario["books"]:
        book = BookState(spec["venue"], spec["symbol"])
        book.apply_snapshot(
            bids=[(float(p), float(q)) for p, q in spec["bids"]],
            asks=[(float(p), float(q)) for p, q in spec["asks"]],
        )
        book.last_update_wall = clock.wall_epoch - float(spec.get("age_s", 0.0))
        book.synthetic = bool(spec.get("synthetic", False))
        feeds.setdefault(spec["venue"], _Feed({})).books[spec["symbol"]] = book
    engine.feeds = feeds  # type: ignore[assignment]

    gw = RiskGateway(tca_engine=engine, audit=None)
    gw.session_date = clock.wall.strftime("%Y-%m-%d")

    kill = scenario.get("kill", {})
    gw.kill.active = bool(kill.get("active", False))
    gw.kill.reason = kill.get("reason")
    gw.kill.halted_symbols = set(kill.get("halted", []))

    gw._seen_set = set(scenario.get("seen_client_ids", []))

    bucket_spec = scenario.get("bucket") or {}
    bucket = TokenBucket(
        float(bucket_spec.get("rate", limits.max_orders_per_sec)),
        int(bucket_spec.get("burst", limits.rate_limit_burst)),
    )
    bucket.tokens = float(bucket_spec.get("tokens", bucket.capacity))
    bucket.updated = clock.monotonic
    for rel in bucket_spec.get("recent_rel", []):
        bucket.recent.append(clock.monotonic + float(rel))
    gw.bucket = bucket

    for pos in scenario.get("positions", []):
        gw.positions[pos["symbol"]] = PositionState(
            symbol=pos["symbol"],
            quantity=float(pos["quantity"]),
            avg_price=float(pos["avg_price"]),
            realized_pnl=float(pos.get("realized_pnl", 0.0)),
        )

    gw.start_of_day_equity = float(scenario.get("start_of_day_equity", limits.starting_equity_usd))
    gw.carried_realized_pnl = float(scenario.get("carried_realized_pnl", 0.0))
    gw._reduce_only_override = bool(scenario.get("reduce_only_override", False))

    for index, wo in enumerate(scenario.get("working", [])):
        req = OrderRequest(
            symbol=wo["symbol"],
            side=wo["side"],
            quantity=float(wo["quantity"]),
            order_type="LIMIT",
            limit_price=float(wo["limit_price"]),
            strategy="fixture",
        )
        gw._rest_order(
            f"fixture-working-{index}", req, float(wo["quantity"]), float(wo["limit_price"]),
            "GTC", "fixture", [], 0.0, clock.wall,
        )

    return gw


def judge(scenario: dict[str, Any], monkeypatch) -> RiskDecision:
    gw = build_gateway(scenario, monkeypatch)
    order = OrderRequest(**scenario["order"])
    return asyncio.run(gw.submit(order, source="fixture"))


def expected_from(decision: RiskDecision) -> dict[str, Any]:
    """The part of a decision the fixture pins: the verdict and the numbers, not the prose."""
    return {
        "accepted": decision.accepted,
        "status": decision.status,
        "quantity": decision.quantity,
        "notional": decision.notional,
        "rejected_by": list(decision.rejected_by),
        "checks": [
            {"name": c.name, "passed": c.passed, "observed": c.observed, "limit": c.limit}
            for c in decision.checks
        ],
    }


def judge_standalone(scenario: dict[str, Any]) -> RiskDecision:
    """For the generator: judge with patches applied and undone around the call."""
    patcher = _Patcher()
    try:
        return judge(scenario, patcher)
    finally:
        patcher.undo()
