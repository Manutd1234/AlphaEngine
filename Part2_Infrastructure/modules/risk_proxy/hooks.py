"""Observers: alert transports and post-decision hooks.

Everything here is deliberately failure-tolerant in one direction only. A hook
that raises is logged and dropped from that call; it never propagates into the
order path. An observer that can break trading is worse than no observer.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from modules.schemas import RiskDecision

log = logging.getLogger("alphaengine.risk")
ALERT_HOOK_DEADLINE_S = 1.0
ALERT_HOOK_CANCEL_GRACE_S = 0.05

AlertHook = Callable[[str, str], Awaitable[None]]  # (severity, message)


class HookMixin:
    """Registration and fan-out for alert and decision observers."""

    def add_alert_hook(self, hook: AlertHook) -> None:
        if hook not in self._alert_hooks:
            self._alert_hooks.append(hook)

    def add_decision_hook(self, hook) -> None:
        """Register a post-decision observer (mirror, RAG anomaly detector).

        Hooks run after the audit write, outside the lock, and are called
        synchronously with (decision, request, source) — so a hook must be
        cheap and non-blocking (the Supabase mirror's enqueue is put_nowait).
        A hook that raises is logged and dropped from the call, never allowed
        to break the order path.
        """
        if hook not in self._decision_hooks:
            self._decision_hooks.append(hook)

    def _notify_decision(self, decision, req, source: str) -> None:
        for hook in self._decision_hooks:
            try:
                hook(decision, req, source)
            except Exception as exc:  # observers must never break trading
                log.error("decision hook failed: %s", type(exc).__name__)

    async def _alert(self, severity: str, message: str) -> None:
        async def invoke(hook: AlertHook) -> None:
            try:
                await hook(severity, message)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # an alert transport must never break trading
                log.error("alert hook failed: %s", type(exc).__name__)

        tasks = [asyncio.create_task(invoke(hook)) for hook in self._alert_hooks]
        if not tasks:
            return
        try:
            _, pending = await asyncio.wait(tasks, timeout=ALERT_HOOK_DEADLINE_S)
            if pending:
                log.error("alert delivery exceeded %.1fs; trading will continue", ALERT_HOOK_DEADLINE_S)
        finally:
            pending = [task for task in tasks if not task.done()]
            for task in pending:
                if not task.done():
                    task.cancel()
            if pending:
                _, stubborn = await asyncio.wait(pending, timeout=ALERT_HOOK_CANCEL_GRACE_S)
                for task in stubborn:
                    task.add_done_callback(_consume_background_task_result)

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


def _consume_background_task_result(task: asyncio.Task[None]) -> None:
    """Retrieve a detached hook result without holding up the safety path."""
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.error("detached alert hook failed: %s", type(exc).__name__)
