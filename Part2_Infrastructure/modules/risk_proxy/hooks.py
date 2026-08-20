"""Observers: alert transports and post-decision hooks.

Everything here is deliberately failure-tolerant in one direction only. A hook
that raises is logged and dropped from that call; it never propagates into the
order path. An observer that can break trading is worse than no observer.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from modules.schemas import RiskDecision

log = logging.getLogger("alphaengine.risk")

AlertHook = Callable[[str, str], Awaitable[None]]  # (severity, message)


class HookMixin:
    """Registration and fan-out for alert and decision observers."""

    def add_alert_hook(self, hook: AlertHook) -> None:
        self._alert_hooks.append(hook)

    def add_decision_hook(self, hook) -> None:
        """Register a post-decision observer (mirror, RAG anomaly detector).

        Hooks run after the audit write, outside the lock, and are called
        synchronously with (decision, request, source) — so a hook must be
        cheap and non-blocking (the Supabase mirror's enqueue is put_nowait).
        A hook that raises is logged and dropped from the call, never allowed
        to break the order path.
        """
        self._decision_hooks.append(hook)

    def _notify_decision(self, decision, req, source: str) -> None:
        for hook in self._decision_hooks:
            try:
                hook(decision, req, source)
            except Exception as exc:  # observers must never break trading
                log.error("decision hook failed: %s", type(exc).__name__)

    async def _alert(self, severity: str, message: str) -> None:
        for hook in self._alert_hooks:
            try:
                await hook(severity, message)
            except Exception as exc:  # an alert transport must never break trading
                log.error("alert hook failed: %s", exc)

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
