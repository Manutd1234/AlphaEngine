"""The resting-order book: what is on it, and how an order gets on or off.

Live state only. It is deliberately not persisted, because a single-instance
paper gateway cannot honour a recovery guarantee and resurrecting a resting
order at a stale price after a restart is worse than cancelling it and saying
so.

The sweep, the cancels and the replace — everything that *decides* to move an
order — live in ``working_control.py``; this module holds the book itself, its
projections, and the primitives those callers use under the lock.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable

from modules.risk_proxy.clock import _utcnow
from modules.schemas import CheckResult, Fill, OrderRequest, RiskDecision, WorkingOrder


@dataclass
class WorkingOrderState:
    """One order resting on the book.

    Holds the original request so a fill can be recorded with the same evidence
    a same-instant fill carries — the check vector that let it through, the
    strategy that sent it, and the moment the gates ran.
    """

    order_id: str
    request: OrderRequest
    quantity: float
    limit_price: float
    time_in_force: str
    source: str
    accepted_at: datetime
    checks: list[CheckResult]
    latency_ms: float

    @property
    def symbol(self) -> str:
        return self.request.symbol

    @property
    def side(self) -> str:
        return self.request.side

    @property
    def notional(self) -> float:
        """Committed capital. A resting order is not free exposure."""
        return self.quantity * self.limit_price

    @property
    def signed_quantity(self) -> float:
        return self.quantity if self.side == "BUY" else -self.quantity

    def expires_at(self) -> datetime | None:
        """DAY orders die at the UTC session boundary; nothing else expires."""
        if self.time_in_force != "DAY":
            return None
        midnight = self.accepted_at.replace(hour=0, minute=0, second=0, microsecond=0)
        return midnight + timedelta(days=1)


class WorkingBookMixin:
    """Queries over the resting book, and the primitives that mutate it."""

    def working_qty(self, symbol: str) -> tuple[float, float]:
        """``(resting buy quantity, resting sell quantity)`` for one symbol."""
        buys = sells = 0.0
        for wo in self.working.values():
            if wo.symbol != symbol:
                continue
            if wo.side == "BUY":
                buys += wo.quantity
            else:
                sells += wo.quantity
        return buys, sells

    def working_notional(self) -> float:
        """Committed capital across the whole resting book, worst side per symbol."""
        by_symbol: dict[str, list[float]] = {}
        for wo in self.working.values():
            slot = by_symbol.setdefault(wo.symbol, [0.0, 0.0])
            slot[0 if wo.side == "BUY" else 1] += wo.notional
        return sum(max(buy, sell) for buy, sell in by_symbol.values())

    def projected_symbol_notional(self, symbol: str, incoming_signed_qty: float, price: float) -> float:
        """Worst-case symbol exposure once the resting book is included.

        Netting a resting buy against a resting sell would assume they fill
        together. They do not have to — either side can be lifted alone — so each
        is projected on its own and the larger is taken. That is the standard
        worst-case-fill convention, and without it two resting orders can each
        pass a cap that their sum breaches.
        """
        pos = self.positions.get(symbol)
        held = pos.quantity if pos else 0.0
        resting_buys, resting_sells = self.working_qty(symbol)
        if_buys_fill = abs(held + incoming_signed_qty + resting_buys)
        if_sells_fill = abs(held + incoming_signed_qty - resting_sells)
        return max(if_buys_fill, if_sells_fill) * price

    def list_working(self, symbol: str | None = None) -> list[WorkingOrder]:
        now = _utcnow()
        out: list[WorkingOrder] = []
        for wo in self.working.values():
            if symbol and wo.symbol != symbol.upper():
                continue
            mark = self.mark(wo.symbol)
            out.append(WorkingOrder(
                order_id=wo.order_id,
                client_order_id=wo.request.client_order_id,
                symbol=wo.symbol,
                side=wo.side,
                order_type=wo.request.order_type,
                time_in_force=wo.time_in_force,
                quantity=wo.quantity,
                limit_price=wo.limit_price,
                notional=wo.notional,
                strategy=wo.request.strategy,
                source=wo.source,
                status="WORKING",
                accepted_at=wo.accepted_at,
                age_seconds=max(0.0, (now - wo.accepted_at).total_seconds()),
                mark_price=mark,
                # Null, never zero, when there is no mark: "at the touch" and
                # "nobody is quoting this" are opposite claims.
                distance_bps=(
                    round((wo.limit_price - mark) / mark * 1e4, 2) if mark else None
                ),
                expires_at=wo.expires_at(),
            ))
        out.sort(key=lambda o: o.accepted_at)
        return out

    def _fill_stamp(self, symbol: str, now: datetime) -> datetime:
        """A strictly increasing per-symbol fill timestamp.

        ``accepted_fills_for_session`` raises when two fills in one symbol share a
        timestamp, because it cannot order them against a ``book_reset``. A sweep
        reads the clock once and can fill several orders in the same symbol, so
        the stamps are separated here — otherwise the failure surfaces at the
        *next restart* as a gateway that refuses to construct.
        """
        last = self._last_fill_stamp.get(symbol)
        stamp = now if last is None or now > last else last + timedelta(microseconds=1)
        self._last_fill_stamp[symbol] = stamp
        return stamp

    def _terminal_decision(
        self, wo: WorkingOrderState, status: str, fill: Fill | None, reason: str | None,
    ) -> RiskDecision:
        return RiskDecision(
            order_id=wo.order_id,
            client_order_id=wo.request.client_order_id,
            accepted=True,
            symbol=wo.symbol,
            side=wo.side,
            quantity=wo.quantity,
            notional=wo.notional,
            checks=wo.checks,
            rejected_by=[],
            reason=reason,
            latency_ms=wo.latency_ms,
            timestamp=wo.accepted_at,
            fill=fill,
            status=status,
            time_in_force=wo.time_in_force,
        )

    def _retire(
        self,
        wo: WorkingOrderState,
        status: str,
        *,
        fill: Fill | None = None,
        reason: str | None = None,
        actor: str = "system",
        at: datetime | None = None,
    ) -> RiskDecision:
        """Take an order off the resting book and queue its audit rows.

        Called under the lock. The audit writes are deferred rather than issued
        here so they land off the hot path, and so a caller holding the lock never
        blocks on a database.
        """
        self.working.pop(wo.order_id, None)
        outcome_at = at or _utcnow()
        decision = self._terminal_decision(wo, status, fill, reason)
        self._deferred_audit.append(("order", decision, wo.request, wo.source, outcome_at))
        self._deferred_audit.append(("event", {
            "order_id": wo.order_id,
            "client_order_id": wo.request.client_order_id,
            "event": status,
            "status": status,
            "symbol": wo.symbol,
            "side": wo.side,
            "order_type": wo.request.order_type,
            "time_in_force": wo.time_in_force,
            "quantity": wo.quantity,
            "limit_price": wo.limit_price,
            "notional": wo.notional,
            "fill_price": fill.price if fill else None,
            "fill_qty": fill.quantity if fill else None,
            "fee_usd": fill.fee_usd if fill else None,
            "venue": fill.venue if fill else None,
            "actor": actor,
            "detail": reason or "",
            "at": outcome_at,
        }))
        return decision

    def _retire_working_where(
        self,
        predicate: Callable[[WorkingOrderState], bool],
        status: str,
        reason: str,
        actor: str,
    ) -> list[str]:
        """Take every resting order matching ``predicate`` off the book, with a
        terminal ``status``. Caller holds the lock.

        The status is a parameter rather than always ``CANCELLED`` because *why*
        an order left the book is the whole content of the blotter row. An order
        the desk pulled and one that ran out its own clock are different events,
        and reporting both as a cancel loses the only distinction a post-mortem
        can act on.
        """
        doomed = [wo for wo in self.working.values() if predicate(wo)]
        for wo in doomed:
            self._retire(wo, status, reason=reason, actor=actor)
        return [wo.order_id for wo in doomed]

    def _cancel_working_where(
        self, predicate: Callable[[WorkingOrderState], bool], reason: str, actor: str,
    ) -> list[str]:
        """Pull every resting order matching ``predicate``. Caller holds the lock."""
        return self._retire_working_where(predicate, "CANCELLED", reason, actor)

    def _would_increase_risk(self, wo: WorkingOrderState) -> bool:
        """True when filling this resting order would grow the position.

        Same test the reduce-only gate applies to an incoming order: reducing
        means moving toward flat, on the opposite side to the holding and no
        larger than what is held. An oversized "close" that flips the book is an
        opening trade wearing a closing trade's clothes.
        """
        pos = self.positions.get(wo.symbol)
        held = pos.quantity if pos else 0.0
        if abs(held) <= 1e-12:
            return True
        signed = wo.signed_quantity
        reducing = (held > 0) != (signed > 0) and abs(signed) <= abs(held) + 1e-9
        return not reducing

    def _rest_order(
        self,
        order_id: str,
        req: OrderRequest,
        qty: float,
        limit_price: float,
        tif: str,
        source: str,
        checks: list[CheckResult],
        latency_ms: float,
        at: datetime,
    ) -> WorkingOrderState:
        wo = WorkingOrderState(
            order_id=order_id,
            request=req,
            quantity=qty,
            limit_price=limit_price,
            time_in_force=tif,
            source=source,
            accepted_at=at,
            checks=checks,
            latency_ms=latency_ms,
        )
        self.working[order_id] = wo
        self._deferred_audit.append(("event", {
            "order_id": order_id,
            "client_order_id": req.client_order_id,
            "event": "ACCEPTED_WORKING",
            "status": "WORKING",
            "symbol": req.symbol,
            "side": req.side,
            "order_type": req.order_type,
            "time_in_force": tif,
            "quantity": qty,
            "limit_price": limit_price,
            "notional": wo.notional,
            "actor": source,
            "detail": "resting on the book",
            "at": at,
        }))
        return wo
