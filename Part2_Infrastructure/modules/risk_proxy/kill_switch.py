"""The halt, hard and soft.

``trigger_kill``/``release_kill`` are the hard stop a human or the breaker
throws; ``reduce_only_active``/``set_reduce_only`` are the graduated regime
between the drawdown warning and that stop. They live together because they are
one control surface with two settings, and a reader asking "what can stop this
desk trading?" should find the whole answer in one file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime

from config import settings
from modules.risk_proxy.clock import _utcnow
from modules.schemas import RiskState

log = logging.getLogger("alphaengine.risk")


@dataclass
class KillSwitch:
    active: bool = False
    reason: str | None = None
    actor: str | None = None
    at: datetime | None = None
    halted_symbols: set[str] = field(default_factory=set)


class KillSwitchMixin:
    """Halt state and the two ways in and out of it."""

    def reduce_only_active(self) -> bool:
        """True when the desk has spent enough of its budget or operator overrode to go defensive."""
        if self._reduce_only_override:
            return True
        limit = settings.max_daily_drawdown_pct
        if limit <= 0 or settings.reduce_only_threshold >= 1.0:
            return False
        return (self.daily_drawdown_pct() / limit) >= settings.reduce_only_threshold

    async def set_reduce_only(self, enabled: bool, actor: str = "operator", reason: str = "") -> RiskState:
        """Operator override for reduce-only mode (the soft halt)."""
        self._reduce_only_override = enabled
        detail = f"Reduce-only mode set to {enabled} by {actor}: {reason}"
        if self.audit:
            self.audit.record_risk_event("reduce_only_toggled", severity="warning", actor=actor, detail=detail, payload={"enabled": enabled, "reason": reason})
        await self._alert("REDUCE_ONLY_TOGGLED", detail)
        return self.state()

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
        # The alert below says "all new orders are now rejected". With resting
        # orders alive that sentence is false: an order placed before the halt
        # would keep trading through it. A halt that does not reach the resting
        # book is not a halt.
        cancelled = await self.cancel_all_working(
            reason=f"kill switch: {reason}", actor=actor, symbol=symbol,
        )
        if cancelled:
            detail = f"{detail} ({len(cancelled)} resting order(s) cancelled)"

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

    async def release_kill(self, actor: str, symbol: str | None = None, reason: str | None = None) -> KillSwitch:
        """Resume trading, recording *why*.

        A halt records what tripped it; a resume recorded only who pressed the
        button leaves the audit trail with half a story. "Resumed after the feed
        recovered" and "resumed because the desk wanted to keep trading" are the
        two answers a post-incident review needs to tell apart, and only the
        operator can supply which one it was.
        """
        tripped_by = self.kill.reason
        if symbol:
            self.kill.halted_symbols.discard(symbol.upper())
            detail = f"{symbol.upper()} resumed by {actor}"
        else:
            self.kill.active = False
            self.kill.reason = None
            self.kill.actor = None
            self.kill.at = None
            detail = f"Global trading resumed by {actor}"
        if reason:
            detail += f" — {reason}"
        log.warning(detail)
        if self.audit:
            self.audit.record_risk_event(
                "kill_switch_released", severity="warning", actor=actor, symbol=symbol, detail=detail,
                payload={
                    "reason": reason,
                    # What the halt was for, carried onto the resume so the two
                    # events can be read as one incident.
                    "tripped_by": tripped_by,
                    "drawdown_pct": round(self.daily_drawdown_pct(), 5),
                },
            )
        await self._alert("info", f"✅ <b>Trading resumed</b>\n{detail}")
        return self.kill
