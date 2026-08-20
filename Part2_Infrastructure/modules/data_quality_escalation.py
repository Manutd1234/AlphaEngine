"""Delivering an escalation, and sweeping for ones whose condition has cleared.

Split out of ``modules/data_quality.py``. The import of ``get_data_quality`` is
FUNCTION-SCOPE on purpose: ``modules.data_quality`` imports this module at
module scope to re-export ``resolve_loop`` and ``publish_escalation``, so a
module-scope import back would be a cycle and the gateway would not boot.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from config import settings
from modules.data_quality_schema import Escalation
from modules.oncall import escalation_channel

log = logging.getLogger("alphaengine.data_quality")

# --------------------------------------------------------------------------- #
# Escalation delivery
# --------------------------------------------------------------------------- #

#: Desk roles a data-quality escalation is addressed to. A provider that has
#: started failing contract checks is a data engineer's problem first and a
#: developer's second; a portfolio manager receiving it learns nothing they can
#: act on. A chat with no role receives it regardless.
ESCALATION_ROLES = frozenset({"data", "dev"})


async def resolve_loop(interval_s: float = 60.0, ledger: Any | None = None) -> None:
    """Sweep for escalations whose condition has cleared.

    `_resolve_cleared` runs inside `ingest`, and only there — so an escalation
    resolves when the SAME provider sends more findings. A provider that stops
    reporting entirely, which is exactly what a badly broken one does, left its
    escalation open forever: the desk showed a permanent red against a condition
    that had ended, and the rule's cooldown meant no new one could open either.

    Cheap by construction. The sweep is a few reads over a table that holds at
    most a handful of open rows, and it does nothing at all when there are none.
    """
    if ledger is None:
        from modules.data_quality import get_data_quality  # local: avoids a module-scope cycle

        ledger = get_data_quality()
    while True:
        try:
            await asyncio.sleep(max(5.0, interval_s))
            await asyncio.to_thread(ledger._resolve_cleared, time.time() * 1000.0)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("data quality: resolve sweep failed (%s)", type(exc).__name__)


async def publish_escalation(
    escalation: Escalation,
    *,
    ledger: Any | None = None,
    bot: Any | None = None,
    audit: Any | None = None,
) -> str:
    """Send one escalation to Telegram (or the log) and the audit trail.

    Never raises: the sync round trip that opened the escalation must not
    fail because a chat could not be reached. Returns the channel used.
    """
    if ledger is None:
        from modules.data_quality import get_data_quality  # local: avoids a module-scope cycle

        ledger = get_data_quality()
    channel = "log"
    try:
        if bot is None:
            from modules.telegram import get_bot

            bot = get_bot()
        try:
            targets = int(bot.health().get("alert_targets", 0)) if hasattr(bot, "health") else 0
        except Exception:
            targets = 0
        channel = await escalation_channel(escalation, telegram_ok=bool(getattr(bot, "enabled", False) and targets > 0), url=settings.data_ops_webhook_url, rota=settings.data_oncall)
        text = (
            f"<b>Data-quality escalation</b> — {escalation.rule.replace('_', ' ')}\n"
            f"{escalation.detail}.\n"
            f"Rule window {escalation.window_minutes} min; auto-resolves when the condition clears."
        )
        # Addressed to the roles that own data quality; an unset role still gets it.
        await bot.broadcast("warning", text, roles=ESCALATION_ROLES)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        log.error("data-quality escalation delivery failed (%s)", type(exc).__name__)
        channel = "log"
    try:
        if audit is None:
            from modules.audit import get_audit

            audit = get_audit()
        audit.record_risk_event(
            "data_quality_escalation",
            severity="warning",
            actor="data-quality",
            detail=escalation.detail,
            payload={
                "rule": escalation.rule,
                "provider": escalation.provider,
                "count": escalation.count,
                "evaluated": escalation.evaluated,
                "window_minutes": escalation.window_minutes,
                "escalation_id": escalation.id,
                "channel": channel,
            },
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.error("data-quality escalation audit write failed (%s)", type(exc).__name__)
    try:
        ledger.mark_notified(escalation.id, channel)
    except Exception as exc:  # pragma: no cover - defensive
        log.error("data-quality escalation mark failed (%s)", type(exc).__name__)
    return channel
