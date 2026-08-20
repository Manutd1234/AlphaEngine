"""The bar cache: a live fetch merged into whatever history is already there."""

from __future__ import annotations

import logging
from typing import Any

from modules.audit.store import AuditStore

log = logging.getLogger("alphaengine.audit")


class OhlcvCache(AuditStore):
    """Cached OHLCV bars, merged by timestamp range rather than replaced."""

    def cache_ohlcv(self, symbol: str, interval: str, rows: list[tuple]) -> None:
        """A live fetch's bars: merged by timestamp range, so a shorter live
        window can no longer wipe a deeper backfilled history — which the old
        delete-all-then-insert did every time the backtester refreshed."""
        self.upsert_ohlcv(symbol, interval, rows)

    def upsert_ohlcv(self, symbol: str, interval: str, rows: list[tuple]) -> int:
        """Replace the cached bars inside [min ts, max ts] of ``rows`` and insert
        the new ones; bars outside that range are kept. Returns rows written."""
        if not rows or self._closed:
            return 0
        stamps = [r[0] for r in rows]
        lo, hi = min(stamps), max(stamps)
        try:
            with self._lock:
                self._conn.execute(
                    "DELETE FROM ohlcv_cache WHERE symbol = ? AND interval = ? AND ts >= ? AND ts <= ?",
                    (symbol, interval, lo, hi),
                )
                self._conn.executemany(
                    "INSERT INTO ohlcv_cache VALUES (?,?,?,?,?,?,?,?)",
                    [(symbol, interval, *r) for r in rows],
                )
                if self.backend == "sqlite":
                    self._conn.commit()
            return len(rows)
        except Exception as exc:
            log.error("ohlcv cache write failed: %s", exc)
            return 0

    def ohlcv_coverage(self, symbol: str, interval: str) -> dict[str, Any]:
        row = self.query(
            "SELECT COUNT(*) AS rows_, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM ohlcv_cache "
            "WHERE symbol = ? AND interval = ?",
            (symbol, interval),
        )
        first = row[0] if row else {}
        return {"rows": int(first.get("rows_") or 0), "first_ts": first.get("first_ts"), "last_ts": first.get("last_ts")}

    def load_ohlcv(self, symbol: str, interval: str, limit: int) -> list[dict[str, Any]]:
        return self.query(
            "SELECT ts, open, high, low, close, volume FROM ohlcv_cache "
            "WHERE symbol = ? AND interval = ? ORDER BY ts DESC LIMIT ?",
            (symbol, interval, limit),
        )
