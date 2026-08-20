"""The two grants — the allow-list and a live web binding — and the rate window.

See `AuthMixin._authorised` for why the second grant is not an authentication
bypass.
"""

from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

from config import settings
from modules.telegram.link import _LINK_KIND_BYTE, LINK_KIND_GUEST


class AuthMixin:
    # A few seconds. `_authorised` runs on every update and once per subscriber
    # inside the alert loops, so an uncached lookup makes a broadcast to twenty
    # chats twenty DuckDB round trips. Short enough that an expired binding
    # stops granting almost at once, and dropped outright when one is written.
    _BINDING_CACHE_TTL_S = 5.0

    def _allow_listed(self, user_id: str) -> bool:
        """The operator's own read list. Fail-closed on empty, as it always was."""
        return bool(self.allowed_user_ids) and user_id in self.allowed_user_ids

    def _live_bindings(self) -> list[dict[str, Any]]:
        """Bindings this gateway still honours, with the guest clock applied.

        Guest bindings age out; account bindings do not. A guest desk pass is a
        browser-session cookie this process cannot watch expire, so its mirror
        here carries its own clock — see ``TELEGRAM_GUEST_LINK_TTL_S``. An
        account binding has a durable Supabase row behind it and ends with the
        account, through the ``on delete cascade``.

        Factored out so the authorisation check and the desk's own "am I
        connected?" probe read ONE freshness rule. Two copies of an expiry
        policy is how a chip goes on saying Connected for a binding that stopped
        granting hours ago — which is the defect the probe exists to prevent,
        inverted.
        """
        if not self.audit:
            return []
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            seconds=settings.telegram_guest_link_ttl_s
        )
        live: list[dict[str, Any]] = []
        for binding in self.audit.web_bindings():
            user_id = str(binding.get("user_id") or "")
            identity = str(binding.get("web_identity") or "")
            kind = identity.split(":", 1)[0]
            # Unknown prefixes grant nothing. A binding whose shape this build
            # does not recognise is a binding it cannot reason about.
            if not user_id or kind not in _LINK_KIND_BYTE:
                continue
            if kind == LINK_KIND_GUEST and binding["linked_at"] < cutoff:
                continue
            live.append(binding)
        return live

    def _bound_user_ids(self) -> set[str]:
        """Telegram user ids holding a live binding to a web desk pass."""
        if not self.audit:
            return set()
        now = time.monotonic()
        if (
            self._bound_users_read_at is not None
            and now - self._bound_users_read_at < self._BINDING_CACHE_TTL_S
        ):
            return self._bound_users

        self._bound_users = {str(binding["user_id"]) for binding in self._live_bindings()}
        self._bound_users_read_at = now
        return self._bound_users

    def binding_status(self, kind: str, identity: str) -> str:
        """Is this WEB identity bound to a chat right now? Three answers, never two.

        ``"linked"``, ``"not-linked"``, or ``"unknown"`` when this gateway has no
        store to read and therefore knows nothing — which is a different fact
        from "no binding" and must not be flattened into it. Reporting an
        unreadable store as "not linked" would invite someone to reconnect a
        chat they had already connected.

        The answer is a state, never an identity: the caller learns whether the
        desk pass it already holds is bound, and nothing about WHICH chat,
        WHICH Telegram account, or how many others exist. That is the same line
        ``health()``'s ``links`` block draws, applied to a single row.

        Uncached deliberately. ``_bound_user_ids`` caches for five seconds
        because it runs once per subscriber inside every alert broadcast; this
        runs once per header load, and a chip that says "not connected" for five
        seconds after the bot said "Connected" is exactly the confusion the
        whole feature is here to remove.
        """
        if not self.audit:
            return "unknown"
        wanted = f"{kind}:{identity}"
        for binding in self._live_bindings():
            if str(binding.get("web_identity") or "") == wanted:
                return "linked"
        return "not-linked"

    def _forget_bindings(self) -> None:
        """Drop the cache so the next read sees a binding written just now."""
        self._bound_users_read_at = None

    def _authorised(self, user_id: str) -> bool:
        """May this Telegram user read desk data?

        Two independent grants, kept nameable so an auditor can tell which one
        admitted a given user:

          1. ``TELEGRAM_ALLOWED_USER_IDS`` — the operator's list, unchanged.
          2. A live web binding — this Telegram account completed ``/start``
             with a one-time token minted for a desk pass someone was already
             holding.

        (2) IS NOT AN AUTHENTICATION BYPASS, and the argument is arithmetic
        rather than judgement. The token can only be minted by a request that
        already carries a desk pass, and ``POST /api/auth/guest`` hands a pass to
        anyone who asks. So a bound user is shown exactly what they could
        already read by opening the workspace — one shared book, one kill
        switch, one set of counters — over a second transport. Binding moves
        data between transports it was already on; it unlocks none.

        The direction matters too, and it is the direction the invariant in
        ``config.py`` states: a *web* identity authorises a *Telegram* read.
        Nothing here lets a Telegram identity authenticate a web request.

        What this deliberately does not touch is `_may_control`, which reads
        ``TELEGRAM_CONTROL_USER_IDS`` and nothing else. A binding — guest or
        account — cannot halt, resume, flatten, set reduce-only or reset the
        book. Read parity is the entire grant.
        """
        return self._allow_listed(user_id) or (
            bool(user_id) and user_id in self._bound_user_ids()
        )

    def _rate_allowed(self, user_id: str) -> bool:
        now = time.monotonic()
        window = self._rate_windows.setdefault(user_id, deque())
        while window and now - window[0] > 10.0:
            window.popleft()
        if len(window) >= 15:
            return False
        window.append(now)
        return True
