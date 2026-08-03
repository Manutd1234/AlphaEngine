"""
Module B — Pre-Trade Risk Gateway & Emergency Kill-Switch
=========================================================

Trading alpha
-------------
The expensive failures in an automated desk are not bad signals — they are
operational: a fat-finger extra zero, a strategy that re-fires in a tight loop
after a rejected ack, an exchange ban from rate-limit abuse, a position that
keeps averaging down through a liquidation cascade. Every order therefore
travels through a single choke point that can say *no* in microseconds, and a
human can shut the whole desk down with one Telegram message.

Design principles
-----------------
1. **Deny by default on ambiguity.** If the gateway cannot price an order (no
   live mark) it rejects rather than guesses.
2. **Fail fast, cheapest check first.** The kill switch is one boolean read;
   the slippage check touches the book. Ordering matters when the budget is
   sub-millisecond.
3. **Every decision is evidence.** Accepted *and* rejected orders are written
   to the audit log with the full check vector, so a post-mortem can answer
   "why did this get through?" without re-running anything.
4. **The breaker is automatic.** A human is not required for the drawdown guard
   to trip — a background monitor marks positions to market and halts trading
   on its own.

Implemented vs. mocked: all validation, limits, accounting and the kill switch
are real. Exchange *execution* is mocked — accepted orders are filled against
the live L2 ladder from Module A (paper trading), which is exactly what a
pre-production risk gateway does before it is pointed at a live venue.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable

from config import settings
from modules.schemas import (
    CheckResult,
    Fill,
    OrderRequest,
    Position,
    RiskDecision,
    RiskState,
)

log = logging.getLogger("alphaengine.risk")

AlertHook = Callable[[str, str], Awaitable[None]]  # (severity, message)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
class TokenBucket:
    """Classic token bucket: ``rate`` sustained ops/sec with ``burst`` capacity.

    Chosen over a fixed window because a fixed window lets 2x the limit through
    across a boundary — precisely the pattern that triggers exchange bans.
    """

    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.capacity = float(burst)
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self.recent = deque(maxlen=256)  # timestamps, for observability

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_consume(self, amount: float = 1.0) -> bool:
        self._refill()
        if self.tokens >= amount:
            self.tokens -= amount
            self.recent.append(time.monotonic())
            return True
        return False

    def observed_rate(self, window_s: float = 1.0) -> float:
        cutoff = time.monotonic() - window_s
        return sum(1 for t in self.recent if t >= cutoff) / window_s


# --------------------------------------------------------------------------- #
# Paper position book
# --------------------------------------------------------------------------- #
@dataclass
class PositionState:
    symbol: str
    quantity: float = 0.0
    avg_price: float = 0.0
    realized_pnl: float = 0.0

    def apply_fill(self, side: str, qty: float, price: float, fee: float) -> None:
        signed = qty if side == "BUY" else -qty
        self.realized_pnl -= fee

        if self.quantity == 0 or (self.quantity > 0) == (signed > 0):
            # opening or adding
            total_cost = self.avg_price * abs(self.quantity) + price * qty
            self.quantity += signed
            self.avg_price = total_cost / abs(self.quantity) if self.quantity else 0.0
        else:
            # reducing / flipping
            closing = min(abs(signed), abs(self.quantity))
            direction = 1 if self.quantity > 0 else -1
            self.realized_pnl += (price - self.avg_price) * closing * direction
            self.quantity += signed
            if abs(self.quantity) < 1e-12:
                self.quantity = 0.0
                self.avg_price = 0.0
            elif (self.quantity > 0) != (direction > 0):
                self.avg_price = price  # flipped side

    def unrealized(self, mark: float | None) -> float:
        if not mark or self.quantity == 0:
            return 0.0
        return (mark - self.avg_price) * self.quantity


# --------------------------------------------------------------------------- #
# Gateway
# --------------------------------------------------------------------------- #
@dataclass
class KillSwitch:
    active: bool = False
    reason: str | None = None
    actor: str | None = None
    at: datetime | None = None
    halted_symbols: set[str] = field(default_factory=set)


class RiskGateway:
    def __init__(self, tca_engine=None, audit=None) -> None:
        self.tca = tca_engine
        self.audit = audit
        self.kill = KillSwitch()
        self.bucket = TokenBucket(settings.max_orders_per_sec, settings.rate_limit_burst)
        self.positions: dict[str, PositionState] = {}
        self.start_of_day_equity = settings.starting_equity_usd
        self.session_date = _utcnow().strftime("%Y-%m-%d")
        self.orders_accepted = 0
        self.orders_rejected = 0
        self._seen_client_ids: deque[str] = deque(maxlen=5000)
        self._seen_set: set[str] = set()
        self._alert_hooks: list[AlertHook] = []
        self._monitor: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._restore_positions_from_audit()

    # -- wiring ----------------------------------------------------------- #
    def _restore_positions_from_audit(self) -> None:
        """Rebuild only the current session's position accounting from fills.

        Rehydration calls ``PositionState.apply_fill`` directly: it must not
        resubmit orders, emit alerts, increment operational counters, repopulate
        idempotency keys or append new audit rows. Kill/halt state is not restored
        because the audit contains events, not a durable current-state snapshot;
        inferring it here could silently choose the wrong side of a release race.

        The audit loader is strict and reset-aware. Any incomplete or ambiguous
        accepted fill aborts gateway construction instead of starting with an
        understated partial book.
        """
        if self.audit is None:
            return

        try:
            fills = self.audit.accepted_fills_for_session(self.session_date)
        except Exception as exc:
            raise RuntimeError(
                f"cannot safely rehydrate the {self.session_date} position book"
            ) from exc

        restored: dict[str, PositionState] = {}
        seen_order_ids: set[str] = set()
        seen_symbol_timestamps: set[tuple[str, str]] = set()

        def finite_number(row: dict, field: str, *, positive: bool) -> float:
            raw = row.get(field)
            if isinstance(raw, bool):
                raise RuntimeError(f"accepted fill has invalid {field}: {raw!r}")
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise RuntimeError(f"accepted fill is missing numeric {field}") from exc
            valid = math.isfinite(value) and (value > 0 if positive else value >= 0)
            if not valid:
                raise RuntimeError(f"accepted fill has invalid {field}: {raw!r}")
            return value

        for row in fills:
            if not isinstance(row, dict):
                raise RuntimeError("accepted fill replay returned a non-object row")

            order_id = row.get("order_id")
            if not isinstance(order_id, str) or not order_id.strip():
                raise RuntimeError("accepted fill is missing its order id")
            if order_id in seen_order_ids:
                raise RuntimeError(f"duplicate accepted fill in audit: {order_id}")
            seen_order_ids.add(order_id)

            symbol_value = row.get("symbol")
            symbol = symbol_value.strip().upper() if isinstance(symbol_value, str) else ""
            if not symbol:
                raise RuntimeError(f"accepted fill {order_id} is missing its symbol")

            side = row.get("side")
            if side not in {"BUY", "SELL"}:
                raise RuntimeError(f"accepted fill {order_id} has invalid side: {side!r}")

            timestamp = row.get("ts")
            if timestamp is None:
                raise RuntimeError(f"accepted fill {order_id} is missing its timestamp")
            timestamp_key = (symbol, str(timestamp))
            if timestamp_key in seen_symbol_timestamps:
                # Fill order is path-dependent when a position is reduced or
                # flipped. The audit has no sequence column to break an exact
                # same-symbol timestamp tie, so guessing would fabricate P&L.
                raise RuntimeError(
                    f"accepted fills for {symbol} share an ambiguous timestamp: {timestamp}"
                )
            seen_symbol_timestamps.add(timestamp_key)

            quantity = finite_number(row, "fill_qty", positive=True)
            price = finite_number(row, "fill_price", positive=True)
            fee = finite_number(row, "fee_usd", positive=False)
            restored.setdefault(symbol, PositionState(symbol)).apply_fill(side, quantity, price, fee)

        self.positions.update(restored)
        if fills:
            log.info(
                "rehydrated %d accepted fills into %d current-session positions",
                len(fills), len(restored),
            )

    def add_alert_hook(self, hook: AlertHook) -> None:
        self._alert_hooks.append(hook)

    async def _alert(self, severity: str, message: str) -> None:
        for hook in self._alert_hooks:
            try:
                await hook(severity, message)
            except Exception as exc:  # an alert transport must never break trading
                log.error("alert hook failed: %s", exc)

    async def start(self) -> None:
        self._monitor = asyncio.create_task(self._monitor_loop(), name="risk-monitor")

    async def stop(self) -> None:
        if self._monitor:
            self._monitor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._monitor

    async def _monitor_loop(self) -> None:
        """Marks the book to market and trips the breaker without human input."""
        while True:
            await asyncio.sleep(5)
            try:
                self._roll_session_if_needed()
                if self.kill.active:
                    continue
                dd = self.daily_drawdown_pct()
                if dd >= settings.max_daily_drawdown_pct:
                    await self.trigger_kill(
                        reason=f"AUTO: daily drawdown {dd:.2%} >= limit {settings.max_daily_drawdown_pct:.2%}",
                        actor="circuit-breaker",
                    )
                elif dd >= settings.max_daily_drawdown_pct * 0.8:
                    await self._alert(
                        "warning",
                        f"⚠️ Drawdown warning: {dd:.2%} of {settings.max_daily_drawdown_pct:.2%} daily limit used "
                        f"({dd / settings.max_daily_drawdown_pct:.0%} of budget).",
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("risk monitor error: %s", exc)

    def _roll_session_if_needed(self) -> None:
        today = _utcnow().strftime("%Y-%m-%d")
        if today != self.session_date:
            log.info("session rollover %s -> %s; resetting drawdown baseline", self.session_date, today)
            self.session_date = today
            self.start_of_day_equity = self.equity()
            for pos in self.positions.values():
                pos.realized_pnl = 0.0

    # -- accounting ------------------------------------------------------- #
    def mark(self, symbol: str) -> float | None:
        return self.tca.last_price(symbol) if self.tca else None

    def realized_pnl(self) -> float:
        return sum(p.realized_pnl for p in self.positions.values())

    def unrealized_pnl(self) -> float:
        return sum(p.unrealized(self.mark(s)) for s, p in self.positions.items())

    def equity(self) -> float:
        return settings.starting_equity_usd + self.realized_pnl() + self.unrealized_pnl()

    def daily_pnl(self) -> float:
        return self.equity() - self.start_of_day_equity

    def daily_drawdown_pct(self) -> float:
        pnl = self.daily_pnl()
        return max(0.0, -pnl / self.start_of_day_equity) if self.start_of_day_equity else 0.0

    def gross_exposure(self) -> float:
        total = 0.0
        for sym, pos in self.positions.items():
            mark = self.mark(sym) or pos.avg_price
            total += abs(pos.quantity) * mark
        return total

    def symbol_notional(self, symbol: str) -> float:
        pos = self.positions.get(symbol)
        if not pos:
            return 0.0
        mark = self.mark(symbol) or pos.avg_price
        return abs(pos.quantity) * mark

    # -- kill switch ------------------------------------------------------ #
    async def trigger_kill(self, reason: str, actor: str, symbol: str | None = None) -> KillSwitch:
        if symbol:
            self.kill.halted_symbols.add(symbol.upper())
            detail = f"{symbol.upper()} halted by {actor}: {reason}"
            severity = "warning"
        else:
            self.kill.active = True
            self.kill.reason = reason
            self.kill.actor = actor
            self.kill.at = _utcnow()
            detail = f"GLOBAL KILL by {actor}: {reason}"
            severity = "critical"

        log.critical(detail)
        if self.audit:
            self.audit.record_risk_event(
                "kill_switch_engaged", severity=severity, actor=actor, symbol=symbol, detail=detail,
                payload={"equity": self.equity(), "drawdown_pct": self.daily_drawdown_pct()},
            )
        await self._alert(
            severity,
            f"🛑 <b>KILL SWITCH ENGAGED</b>\n{detail}\n"
            f"Equity: ${self.equity():,.0f} | Daily PnL: ${self.daily_pnl():,.0f} "
            f"({self.daily_drawdown_pct():.2%} DD)\nAll new orders are now rejected.",
        )
        return self.kill

    async def release_kill(self, actor: str, symbol: str | None = None) -> KillSwitch:
        if symbol:
            self.kill.halted_symbols.discard(symbol.upper())
            detail = f"{symbol.upper()} resumed by {actor}"
        else:
            self.kill.active = False
            self.kill.reason = None
            self.kill.actor = None
            self.kill.at = None
            detail = f"Global trading resumed by {actor}"
        log.warning(detail)
        if self.audit:
            self.audit.record_risk_event("kill_switch_released", severity="warning", actor=actor, symbol=symbol, detail=detail)
        await self._alert("info", f"✅ <b>Trading resumed</b>\n{detail}")
        return self.kill

    # -- the hot path ----------------------------------------------------- #
    async def submit(self, req: OrderRequest, source: str = "api") -> RiskDecision:
        t0 = time.perf_counter()
        checks: list[CheckResult] = []
        order_id = uuid.uuid4().hex[:16]

        def add(name: str, passed: bool, detail: str, observed=None, limit=None) -> bool:
            checks.append(CheckResult(name=name, passed=passed, detail=detail, observed=observed, limit=limit))
            return passed

        async with self._lock:
            self._roll_session_if_needed()

            # 1 — kill switch (single boolean; always first)
            add("kill_switch", not self.kill.active, self.kill.reason or "disengaged")
            # 2 — per-symbol halt
            add("symbol_halt", req.symbol not in self.kill.halted_symbols, f"{req.symbol} halt status")
            # 3 — instrument whitelist
            add("symbol_whitelist", req.symbol in [s.upper() for s in settings.symbols],
                f"{req.symbol} in {settings.symbols}")
            # 4 — idempotency: a retrying algo must not double-fire
            dup = bool(req.client_order_id and req.client_order_id in self._seen_set)
            add("duplicate_order", not dup, f"client_order_id={req.client_order_id or '-'}")
            # 5 — rate limit
            allowed = self.bucket.try_consume()
            add("rate_limit", allowed, f"{self.bucket.observed_rate():.1f}/s observed",
                observed=self.bucket.observed_rate(), limit=settings.max_orders_per_sec)

            # 6 — price discovery. No mark => no risk assessment => reject.
            mark = self.mark(req.symbol)
            ref_price = req.limit_price or mark
            has_price = ref_price is not None and ref_price > 0
            add("price_available", bool(has_price), f"mark={mark}" if mark else "no live mark price")

            qty = req.quantity
            notional = req.notional
            if has_price:
                if qty is None and notional is not None:
                    qty = notional / ref_price
                elif notional is None and qty is not None:
                    notional = qty * ref_price
            add("order_sized", qty is not None and notional is not None, "quantity or notional required")

            if notional is not None:
                # 7 — fat-finger notional ceiling
                add("max_order_notional", notional <= settings.max_order_notional_usd,
                    f"${notional:,.0f} vs ${settings.max_order_notional_usd:,.0f} cap",
                    observed=notional, limit=settings.max_order_notional_usd)

                # 8 — projected per-symbol concentration
                pos = self.positions.get(req.symbol)
                signed_qty = (qty or 0) * (1 if req.side == "BUY" else -1)
                projected_qty = (pos.quantity if pos else 0.0) + signed_qty
                projected_sym = abs(projected_qty) * (mark or ref_price or 0)
                add("symbol_concentration", projected_sym <= settings.max_symbol_notional_usd,
                    f"${projected_sym:,.0f} projected vs ${settings.max_symbol_notional_usd:,.0f}",
                    observed=projected_sym, limit=settings.max_symbol_notional_usd)

                # 9 — projected gross exposure
                projected_gross = self.gross_exposure() - self.symbol_notional(req.symbol) + projected_sym
                add("gross_exposure", projected_gross <= settings.max_gross_exposure_usd,
                    f"${projected_gross:,.0f} projected vs ${settings.max_gross_exposure_usd:,.0f}",
                    observed=projected_gross, limit=settings.max_gross_exposure_usd)

            # 10 — limit price sanity (the other half of fat-finger protection)
            if req.order_type == "LIMIT" and req.limit_price and mark:
                dev_bps = abs(req.limit_price - mark) / mark * 1e4
                add("price_band", dev_bps <= settings.max_price_deviation_bps,
                    f"{dev_bps:.1f}bps from mark {mark:,.2f}",
                    observed=dev_bps, limit=settings.max_price_deviation_bps)

            # 11 — drawdown budget
            dd = self.daily_drawdown_pct()
            add("daily_drawdown", dd < settings.max_daily_drawdown_pct,
                f"{dd:.2%} used of {settings.max_daily_drawdown_pct:.2%}",
                observed=dd, limit=settings.max_daily_drawdown_pct)

            # 12 — liquidity: does the live book support this size at a sane cost?
            # Measured on the *routed* execution, because that is what will fill.
            if self.tca and notional:
                est = self.tca.route_estimate(req.symbol, req.side, notional)
                if est is None:
                    add("est_slippage", False, "no routable liquidity")
                elif not est.fillable:
                    add("est_slippage", False,
                        f"only ${est.filled_notional:,.0f} of ${notional:,.0f} routable across "
                        f"{est.venue or 'all venues'}")
                elif est.slippage_bps is not None:
                    add("est_slippage", est.slippage_bps <= settings.max_est_slippage_bps,
                        f"{est.slippage_bps:+.2f}bps routing {est.venue}",
                        observed=est.slippage_bps, limit=settings.max_est_slippage_bps)

            rejected_by = [c.name for c in checks if not c.passed]
            accepted = not rejected_by

            fill = None
            if accepted and qty and notional:
                fill = self._paper_fill(req, qty, notional, mark)
                position = self.positions.setdefault(req.symbol, PositionState(req.symbol))
                position.apply_fill(req.side, fill.quantity, fill.price, fill.fee_usd)
                self.orders_accepted += 1
                if req.client_order_id:
                    if len(self._seen_client_ids) == self._seen_client_ids.maxlen:
                        self._seen_set.discard(self._seen_client_ids[0])
                    self._seen_client_ids.append(req.client_order_id)
                    self._seen_set.add(req.client_order_id)
            else:
                self.orders_rejected += 1

            decision = RiskDecision(
                order_id=order_id,
                client_order_id=req.client_order_id,
                accepted=accepted,
                symbol=req.symbol,
                side=req.side,
                quantity=qty,
                notional=notional,
                checks=checks,
                rejected_by=rejected_by,
                reason=None if accepted else "; ".join(
                    f"{c.name}: {c.detail}" for c in checks if not c.passed
                ),
                latency_ms=(time.perf_counter() - t0) * 1000,
                timestamp=_utcnow(),
                fill=fill,
            )

        if self.audit:
            await asyncio.to_thread(self.audit.record_order, decision, req, source)

        # Post-decision side effects run outside the lock.
        if not accepted:
            await self._on_reject(decision)
        else:
            dd_after = self.daily_drawdown_pct()
            if dd_after >= settings.max_daily_drawdown_pct:
                await self.trigger_kill(
                    reason=f"AUTO: drawdown {dd_after:.2%} breached after fill on {req.symbol}",
                    actor="circuit-breaker",
                )
        return decision

    def _paper_fill(self, req: OrderRequest, qty: float, notional: float, mark: float | None) -> Fill:
        """Simulate execution against the live ladder (Module A), not at mid.

        Filling at mid is the single most common way a backtest or paper system
        flatters itself. Here the fill price is the actual VWAP of the smart
        route, so paper PnL carries the same cost structure as live trading.
        """
        venue = "PAPER"
        price = mark or req.limit_price or 0.0
        slippage_bps = 0.0

        if self.tca:
            legs, vwap = self.tca.smart_route(req.symbol, req.side, notional)
            if vwap:
                price = vwap
                venue = "+".join(leg.venue for leg in legs) or "PAPER"
                if mark:
                    slippage_bps = ((price - mark) / mark * 1e4) if req.side == "BUY" else ((mark - price) / mark * 1e4)

        filled_qty = notional / price if price else qty
        fee = notional * settings.paper_fee_bps / 1e4
        return Fill(
            price=price,
            quantity=filled_qty,
            notional=notional,
            fee_usd=fee,
            slippage_bps=round(slippage_bps, 3),
            venue=venue,
            simulated=True,
        )

    async def _on_reject(self, decision: RiskDecision) -> None:
        severe = {"max_order_notional", "daily_drawdown", "gross_exposure", "kill_switch", "price_band"}
        if self.audit:
            self.audit.record_risk_event(
                "order_rejected", severity="warning", actor="gateway", symbol=decision.symbol,
                detail=decision.reason or "", payload={"order_id": decision.order_id, "rejected_by": decision.rejected_by},
            )
        if severe & set(decision.rejected_by):
            await self._alert(
                "warning",
                f"🚫 <b>Order rejected</b> — {decision.symbol} {decision.side} "
                f"${(decision.notional or 0):,.0f}\n<code>{decision.reason}</code>",
            )

    # -- read model ------------------------------------------------------- #
    def state(self) -> RiskState:
        positions = []
        for sym, pos in self.positions.items():
            if abs(pos.quantity) < 1e-12 and pos.realized_pnl == 0:
                continue
            mark = self.mark(sym)
            positions.append(
                Position(
                    symbol=sym,
                    quantity=pos.quantity,
                    avg_price=pos.avg_price,
                    mark_price=mark,
                    notional=abs(pos.quantity) * (mark or pos.avg_price),
                    unrealized_pnl=pos.unrealized(mark),
                    realized_pnl=pos.realized_pnl,
                )
            )
        dd = self.daily_drawdown_pct()
        return RiskState(
            kill_switch_active=self.kill.active,
            kill_reason=self.kill.reason,
            killed_at=self.kill.at,
            killed_by=self.kill.actor,
            halted_symbols=sorted(self.kill.halted_symbols),
            equity=self.equity(),
            start_of_day_equity=self.start_of_day_equity,
            realized_pnl=self.realized_pnl(),
            unrealized_pnl=self.unrealized_pnl(),
            daily_pnl=self.daily_pnl(),
            daily_drawdown_pct=dd,
            drawdown_budget_used_pct=dd / settings.max_daily_drawdown_pct if settings.max_daily_drawdown_pct else 0.0,
            gross_exposure=self.gross_exposure(),
            positions=positions,
            orders_accepted=self.orders_accepted,
            orders_rejected=self.orders_rejected,
            orders_last_second=self.bucket.observed_rate(),
            limits=settings.risk_limits_dict(),
            session_date=self.session_date,
        )

    def reset_book(self, actor: str = "api") -> None:
        """Flatten the paper book (demo/reset helper — audited like everything else)."""
        if self.audit:
            # Persist first. Clearing before this durable boundary exists could
            # resurrect the old fills on the next process restart.
            self.audit.record_book_reset(actor)
        self.positions.clear()
        self.orders_accepted = 0
        self.orders_rejected = 0
        self._seen_client_ids.clear()
        self._seen_set.clear()
        self.start_of_day_equity = settings.starting_equity_usd


_gateway: RiskGateway | None = None


def get_gateway() -> RiskGateway:
    global _gateway
    if _gateway is None:
        from modules.audit import get_audit
        from modules.tca_engine import get_engine

        _gateway = RiskGateway(tca_engine=get_engine(), audit=get_audit())
    return _gateway
