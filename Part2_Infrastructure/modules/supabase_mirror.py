"""Supabase Postgres mirror of gateway order decisions.

DuckDB stays authoritative. This module streams each already-made
``RiskDecision`` to ``public.order_blotter`` through a bounded queue and a
single drain task — best-effort, batched, and structurally incapable of
touching the order path:

* ``enqueue`` is ``put_nowait``: it cannot block, cannot raise past its own
  frame, and on a full queue it *counts the drop* instead of waiting. A mirror
  that can slow an order down is a mirror that has become load-bearing.
* Failures retry with capped backoff and then give up into a counter. The rule
  is ``AuditLog._exec``'s, one level stricter: never let mirror failures break
  the trade path, and count what was lost instead of pretending it arrived.
* With no ``SUPABASE_URL``/key configured, every method is a no-op — which is
  what keeps the whole suite green with zero environment and CI network-free.

Transport is plain ``httpx`` against PostgREST's RPC endpoint. ``supabase-py``
would drag gotrue/postgrest/realtime/storage3 into the import graph of a
deliberately network-free CI for what is, in the end, one authenticated POST.

``health()`` exposes counters and a *classified* last error — never the URL,
the key, or raw error text. The ops endpoint is polled frequently; identity
and stack traces stay off it (the same rule ``AuditLog.health()`` follows by
omitting its filesystem path).
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

import httpx

from config import settings

if TYPE_CHECKING:  # imported for types only; no runtime dependency edge
    from modules.schemas import OrderRequest, RiskDecision

log = logging.getLogger("alphaengine.supabase")

# Every gate name risk_proxy.submit() can emit maps to a Postgres enum label.
# tests/test_supabase_schema.py asserts this dict against BOTH sides: the
# engine's add("...") calls and the committed order_verdict enum. Identity
# mapping today; the indirection exists so a rename on either side turns into
# a red test instead of a silently dropped mirror row.
GATE_TO_VERDICT: dict[str, str] = {
    "kill_switch": "kill_switch",
    "symbol_halt": "symbol_halt",
    "symbol_whitelist": "symbol_whitelist",
    "duplicate_order": "duplicate_order",
    "rate_limit": "rate_limit",
    "price_available": "price_available",
    "order_sized": "order_sized",
    "max_order_notional": "max_order_notional",
    "symbol_concentration": "symbol_concentration",
    "gross_exposure": "gross_exposure",
    "price_band": "price_band",
    "working_book": "working_book",
    "daily_drawdown": "daily_drawdown",
    "reduce_only": "reduce_only",
    "est_slippage": "est_slippage",
}

_ERROR_KINDS = ("timeout", "auth", "rejected", "unreachable")


def verdict_for(decision: RiskDecision) -> tuple[str, list[str]]:
    """Primary verdict label plus every gate that rejected."""
    labels = [GATE_TO_VERDICT[g] for g in decision.rejected_by if g in GATE_TO_VERDICT]
    if decision.accepted:
        return "ACCEPTED", labels
    return (labels[0] if labels else "kill_switch"), labels


def decision_payload(
    decision: RiskDecision, request: OrderRequest, source: str
) -> dict[str, Any]:
    """The RPC body for one decision — measured values only, nothing invented."""
    primary, rejected = verdict_for(decision)
    fill = decision.fill
    return {
        "desk_id": settings.supabase_desk_id,
        "gateway_order_id": decision.order_id,
        "client_order_id": decision.client_order_id,
        "symbol": decision.symbol,
        "side": decision.side,
        "order_type": request.order_type,
        "quantity": decision.quantity,
        "notional": decision.notional,
        "venue": fill.venue if fill else None,
        "fill_price": fill.price if fill else None,
        "filled_notional": fill.notional if fill else None,
        "slippage_bps": fill.slippage_bps if fill else None,
        "fee_usd": fill.fee_usd if fill else None,
        "latency_ms": decision.latency_ms,
        "verdict": primary,
        "rejected_by": rejected,
        "checks": [c.model_dump() for c in decision.checks],
        "status": decision.status,
        "strategy_tag": request.strategy,
        "source": source,
        "decided_at": decision.timestamp.isoformat(),
        "occurred_at": decision.timestamp.isoformat(),
    }


class SupabaseMirror:
    """Bounded-queue writer; a no-op when unconfigured."""

    def __init__(self) -> None:
        self.enabled = bool(
            settings.supabase_url
            and settings.supabase_service_role_key
            and settings.supabase_mirror_enabled
        )
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(
            maxsize=settings.supabase_mirror_queue_max
        )
        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task[None] | None = None
        self._written = 0
        self._failed = 0
        self._dropped = 0
        self._last_error_kind: str | None = None
        self._drop_logged_at = 0.0

    # ------------------------------------------------------------------ #
    # lifecycle
    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        if not self.enabled or self._task:
            return
        # Client construction lives here, not in __init__ and never at import:
        # module import must succeed with zero environment (network-free CI).
        self._client = httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"),
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            timeout=settings.supabase_timeout_s,
        )
        self._task = asyncio.create_task(self._drain(), name="supabase-mirror")
        log.info("supabase mirror started (queue max %d)", self._queue.maxsize)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------ #
    # write path
    # ------------------------------------------------------------------ #
    def enqueue(self, decision: RiskDecision, request: OrderRequest, source: str) -> None:
        """Non-blocking, non-raising. The order path calls this and moves on."""
        if not self.enabled:
            return
        try:
            self._queue.put_nowait(decision_payload(decision, request, source))
        except asyncio.QueueFull:
            self._dropped += 1
            now = asyncio.get_event_loop().time()
            if now - self._drop_logged_at > 60:
                self._drop_logged_at = now
                log.warning(
                    "supabase mirror queue full; %d decisions dropped so far",
                    self._dropped,
                )
        except Exception as exc:  # defensive: the order path must never see this
            self._failed += 1
            log.error("supabase mirror enqueue failed: %s", type(exc).__name__)

    async def _drain(self) -> None:
        assert self._client is not None
        backoff = 1.0
        while True:
            payload = await self._queue.get()
            for attempt in range(3):
                try:
                    response = await self._client.post(
                        "/rest/v1/rpc/record_alphaengine_decision",
                        json={"payload": payload},
                    )
                    if response.status_code < 300:
                        self._written += 1
                        backoff = 1.0
                        break
                    self._last_error_kind = (
                        "auth" if response.status_code in (401, 403) else "rejected"
                    )
                    log.warning(
                        "supabase mirror write %d (attempt %d)",
                        response.status_code,
                        attempt + 1,
                    )
                except httpx.TimeoutException:
                    self._last_error_kind = "timeout"
                except httpx.HTTPError:
                    self._last_error_kind = "unreachable"
                except Exception as exc:
                    self._last_error_kind = "rejected"
                    log.error("supabase mirror write failed: %s", type(exc).__name__)
                await asyncio.sleep(min(backoff * (2**attempt), 30.0))
            else:
                self._failed += 1
                backoff = min(backoff * 2, 30.0)

    # ------------------------------------------------------------------ #
    # observability — counters and a closed error vocabulary; no identity
    # ------------------------------------------------------------------ #
    def health(self) -> dict[str, Any]:
        kind = self._last_error_kind
        return {
            "configured": self.enabled,
            "running": self._task is not None and not self._task.done(),
            "queued": self._queue.qsize(),
            "written": self._written,
            "failed": self._failed,
            "dropped": self._dropped,
            "last_error_kind": kind if kind in _ERROR_KINDS else None,
        }


_mirror: SupabaseMirror | None = None


def get_mirror() -> SupabaseMirror:
    global _mirror
    if _mirror is None:
        _mirror = SupabaseMirror()
    return _mirror


def reset_mirror() -> None:
    """Test seam: drop the singleton so a re-configured one can be built."""
    global _mirror
    _mirror = None
