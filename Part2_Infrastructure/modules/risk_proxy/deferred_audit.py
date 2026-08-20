"""Audit rows produced under the lock, flushed once it is released.

``_retire`` and ``_rest_order`` run with ``self._lock`` held and must not block
on a database there, so their rows are queued and drained by whichever caller
released the lock. Two drains rather than one because ``reset_book`` is
synchronous: an async-only drain would have left its rows queued behind a
boundary that has already happened.

A failed write is logged and dropped. An audit outage must not take the desk
down with it — the alternative is a gateway that stops accepting orders because
a disk is full.
"""

from __future__ import annotations

import asyncio
import logging

log = logging.getLogger("alphaengine.risk")


class DeferredAuditMixin:
    """Drain the queued audit rows, synchronously or off the event loop."""

    def _drain_deferred_audit_sync(self) -> None:
        """Flush queued audit rows from a synchronous caller (``reset_book``)."""
        if not self.audit or not self._deferred_audit:
            self._deferred_audit.clear()
            return
        pending, self._deferred_audit = self._deferred_audit, []
        for entry in pending:
            try:
                if entry[0] == "order":
                    _, decision, request, source, outcome_at = entry
                    self.audit.record_order(decision, request, source, outcome_at=outcome_at)
                else:
                    self.audit.record_order_event(**entry[1])
            except Exception as exc:
                log.error("deferred audit write failed: %s", exc)

    async def _drain_deferred_audit(self) -> None:
        """Flush queued audit rows once the lock has been released."""
        if not self.audit or not self._deferred_audit:
            self._deferred_audit.clear()
            return
        pending, self._deferred_audit = self._deferred_audit, []
        for entry in pending:
            try:
                if entry[0] == "order":
                    _, decision, request, source, outcome_at = entry
                    await asyncio.to_thread(
                        self.audit.record_order, decision, request, source, outcome_at=outcome_at,
                    )
                else:
                    await asyncio.to_thread(self.audit.record_order_event, **entry[1])
            except Exception as exc:  # an audit failure must not break the desk
                log.error("deferred audit write failed: %s", exc)
