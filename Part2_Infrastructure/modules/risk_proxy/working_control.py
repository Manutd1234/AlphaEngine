"""What moves a resting order: the sweep, the cancels, the replace.

The sweep is directly callable and deterministic for the same reason
``snapshot_equity`` is — a test that had to wait out a timer to observe a fill
would be a slow test that still could not say *when* the fill happened.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from config import settings
from modules.risk_proxy.clock import _utcnow
from modules.risk_proxy.positions import PositionState
from modules.schemas import OrderAck, OrderRequest, ReplaceRequest, RiskDecision

log = logging.getLogger("alphaengine.risk")


class WorkingOrderControlMixin:
    """Fill, pull and replace resting orders."""

    async def sweep_working_orders(self, now: datetime | None = None) -> list[RiskDecision]:
        """Fill every resting order the consolidated touch has crossed.

        Directly callable and deterministic, for the same reason ``snapshot_equity``
        is: a test that had to wait out a timer to observe a fill would be a slow
        test that still could not say *when* the fill happened.
        """
        now = now or _utcnow()
        filled: list[RiskDecision] = []

        async with self._lock:
            self._roll_session_if_needed()

            # Reduce-only says "only orders that make the book smaller". A
            # resting order placed before the threshold was crossed does not know
            # that, and one that fills afterwards makes the book bigger — which
            # would make the regime a claim rather than a control.
            if self.reduce_only_active():
                self._cancel_working_where(
                    self._would_increase_risk,
                    "reduce-only engaged — resting orders that would add risk are pulled",
                    "circuit-breaker",
                )

            for wo in list(self.working.values()):
                if wo.order_id not in self.working:
                    continue  # the session roll or reduce-only took it

                expires = wo.expires_at()
                if expires and now >= expires:
                    self._retire(wo, "EXPIRED", reason="DAY order reached the session boundary", at=now)
                    continue

                if not self.tca:
                    continue
                best_bid, bid_venue, best_ask, ask_venue = self.tca.top_of_book(wo.symbol)
                if wo.side == "BUY":
                    if best_ask is None or best_ask > wo.limit_price:
                        continue
                    venue = ask_venue or "PAPER"
                else:
                    if best_bid is None or best_bid < wo.limit_price:
                        continue
                    venue = bid_venue or "PAPER"

                fill = self._maker_fill(wo, wo.limit_price, venue)
                position = self.positions.setdefault(wo.symbol, PositionState(wo.symbol))
                position.apply_fill(wo.side, fill.quantity, fill.price, fill.fee_usd)
                self._sync_position_book()
                self.orders_accepted += 1
                filled.append(self._retire(
                    wo, "FILLED", fill=fill,
                    reason=f"crossed at {fill.price:,.2f} on {venue}",
                    at=self._fill_stamp(wo.symbol, now),
                ))

        await self._drain_deferred_audit()

        # The breaker runs outside the lock, exactly as it does after a submit —
        # `trigger_kill` cancels the resting book and would deadlock on a
        # non-reentrant lock otherwise.
        if filled:
            dd_after = self.daily_drawdown_pct()
            if dd_after >= settings.max_daily_drawdown_pct:
                await self.trigger_kill(
                    reason=f"AUTO: drawdown {dd_after:.2%} breached after a resting fill",
                    actor="circuit-breaker",
                )
        return filled

    async def cancel_working(
        self, order_id: str, actor: str = "api", reason: str = "manual cancel",
    ) -> OrderAck | None:
        """Pull one resting order. ``None`` when the id is not resting."""
        async with self._lock:
            wo = self.working.get(order_id)
            if wo is None:
                return None
            self._retire(wo, "CANCELLED", reason=reason, actor=actor)
        await self._drain_deferred_audit()
        return OrderAck(
            order_id=order_id, status="CANCELLED", actor=actor, reason=reason, at=_utcnow(),
        )

    async def cancel_all_working(
        self, reason: str, actor: str = "system", symbol: str | None = None,
    ) -> list[str]:
        async with self._lock:
            cancelled = self._cancel_working_where(
                lambda wo: symbol is None or wo.symbol == symbol.upper(), reason, actor,
            )
        await self._drain_deferred_audit()
        return cancelled

    async def replace_working(self, order_id: str, req: ReplaceRequest, actor: str = "api") -> RiskDecision | None:
        """Cancel-and-new. ``None`` when the id is not resting.

        The replacement runs the full gate battery and the caller gets *its*
        check vector, not the original's. A replace is a new order — it can be
        rejected for reasons the first one passed, and returning stale evidence
        would hide that. This is also what most venues do for a price change or a
        size increase, so nothing is being modelled that a real desk would not
        recognise.
        """
        async with self._lock:
            wo = self.working.get(order_id)
            if wo is None:
                return None
            original = wo.request
            source = wo.source
            self._retire(wo, "CANCELLED", reason=f"replaced by {actor}: {req.reason}", actor=actor)
            replacement = OrderRequest(
                symbol=original.symbol,
                side=original.side,
                quantity=(
                    req.quantity if req.quantity is not None
                    else (None if req.notional is not None else wo.quantity)
                ),
                notional=req.notional,
                order_type="LIMIT",
                limit_price=req.limit_price or wo.limit_price,
                strategy=original.strategy,
                # Deliberately not carried over: the original id is already spent
                # against the idempotency gate, and a replacement that reused it
                # would be rejected as a duplicate of the order it replaces.
                client_order_id=None,
                time_in_force=wo.time_in_force,
            )

        await self._drain_deferred_audit()
        decision = await self.submit(replacement, source=source)

        if self.audit:
            await asyncio.to_thread(
                self.audit.record_order_event,
                order_id=decision.order_id,
                event="REPLACED",
                status=decision.status,
                symbol=decision.symbol,
                side=decision.side,
                order_type="LIMIT",
                time_in_force=decision.time_in_force,
                quantity=decision.quantity,
                limit_price=replacement.limit_price,
                notional=decision.notional,
                actor=actor,
                detail=req.reason,
                replaces=order_id,
            )
        return decision
