"""Notification subscribers, desk bindings and the one-time link tokens.

Kept in the same store as everything else so a restart does not silently stop
delivering risk alerts — the failure mode where nobody notices the kill switch
tripped because the alert list was in memory.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from modules.audit.clock import _KEEP, _audit_timestamp, utcnow
from modules.audit.store import AuditStore

log = logging.getLogger("alphaengine.audit")


class Subscribers(AuditStore):
    """Who gets told, which desk pass bound them, and which tokens are spent."""

    def upsert_subscriber(self, chat_id: str, username: str | None,
                          alerts: bool = True, watches: list[dict] | None = None,
                          *, user_id: str | None = None,
                          web_identity: Any = _KEEP, linked_at: Any = _KEEP,
                          role: Any = _KEEP) -> None:
        existing = self.get_subscriber(chat_id) or {}
        payload = json.dumps(watches if watches is not None else existing.get("watches", []))
        owner_id = str(user_id) if user_id is not None else None
        identity = existing.get("web_identity") if web_identity is _KEEP else web_identity
        bound_at = existing.get("linked_at") if linked_at is _KEEP else linked_at
        # _KEEP, like the two above: /subscribe must not reset a role the chat
        # chose, and /role must not clear a binding the chat did not mention.
        desk_role = existing.get("role") if role is _KEEP else role
        self._exec("DELETE FROM subscribers WHERE chat_id = ?", (str(chat_id),))
        self._exec(
            "INSERT INTO subscribers "
            "(chat_id, username, subscribed_at, alerts, watches, user_id, web_identity, linked_at, role) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (str(chat_id), username,
             existing.get("subscribed_at") or utcnow(), alerts, payload, owner_id,
             identity, bound_at, desk_role),
        )

    def web_bindings(self) -> list[dict[str, Any]]:
        """Every chat bound to a web desk pass, with its Telegram owner and age.

        ``linked_at`` is normalised here rather than by the caller, for the
        reason ``_audit_timestamp`` exists: DuckDB returns a ``datetime`` and the
        SQLite fallback returns the ISO string it was handed, and an expiry
        policy comparing one against the other either raises or silently expires
        nothing at all.

        A row whose timestamp is missing or unreadable is dropped, not repaired.
        A binding that cannot be aged is a binding that could never be revoked.
        """
        rows = self.query(
            "SELECT chat_id, user_id, web_identity, linked_at FROM subscribers "
            "WHERE web_identity IS NOT NULL AND user_id IS NOT NULL"
        )
        bindings: list[dict[str, Any]] = []
        for row in rows:
            try:
                row["linked_at"] = _audit_timestamp(row.get("linked_at"), context="subscribers.linked_at")
            except RuntimeError as exc:
                log.error("dropping unreadable web binding: %s", exc)
                continue
            bindings.append(row)
        return bindings

    def claim_link_token(self, token_hash: str, expires_at: datetime) -> bool:
        """Spend a one-time link token. ``False`` if it was already spent.

        The read and the write are one critical section, which is the whole
        point: two ``/start`` messages carrying the same token — a double tap, a
        forwarded link — would otherwise both find an empty ledger and both
        bind. ``_exec``/``query`` each take the lock themselves, so this cannot
        be built from them without releasing it in between.

        Only the hash is stored. The ledger outlives the token it describes, and
        an audit file holding live credentials is a second place to leak them.

        Expired rows are pruned on the way past: this table only has to remember
        a token for as long as the token itself could still be presented.
        """
        if self._closed:
            return False
        now = utcnow()
        stamp = now.isoformat() if self.backend == "sqlite" else now
        expiry = expires_at.isoformat() if self.backend == "sqlite" else expires_at
        try:
            with self._lock:
                self._conn.execute("DELETE FROM telegram_link_tokens WHERE expires_at < ?", (stamp,))
                cursor = self._conn.execute(
                    "SELECT count(*) FROM telegram_link_tokens WHERE token_hash = ?",
                    (token_hash,),
                )
                already = int((cursor.fetchone() or [0])[0])
                if not already:
                    self._conn.execute(
                        "INSERT INTO telegram_link_tokens VALUES (?,?,?)",
                        (token_hash, stamp, expiry),
                    )
                if self.backend == "sqlite":
                    self._conn.commit()
            return not already
        except Exception as exc:
            # Fail closed. An unreadable ledger cannot prove a token is unspent,
            # and "probably fine" is not a property a single-use token has.
            log.error("link token claim failed: %s", exc)
            return False

    def get_subscriber(self, chat_id: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM subscribers WHERE chat_id = ?", (str(chat_id),))
        if not rows:
            return None
        row = rows[0]
        row["watches"] = json.loads(row.get("watches") or "[]")
        return row

    def list_subscribers(self, alerts_only: bool = True) -> list[dict[str, Any]]:
        # The only variable part is a fixed clause chosen by a boolean; no
        # caller-supplied value reaches the SQL text.
        sql = "SELECT * FROM subscribers" + (" WHERE alerts" if alerts_only else "")  # noqa: S608
        rows = self.query(sql)
        for row in rows:
            row["watches"] = json.loads(row.get("watches") or "[]")
        return rows

    def remove_subscriber(self, chat_id: str) -> None:
        self._exec("DELETE FROM subscribers WHERE chat_id = ?", (str(chat_id),))
