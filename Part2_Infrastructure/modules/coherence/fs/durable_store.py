"""Durable episode decisions, campaigns, and capacity evidence for the tape."""

from __future__ import annotations

import json
import shutil
from decimal import Decimal
from typing import Any

DURABILITY_DDL: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS certification_decisions (
        component_id VARCHAR NOT NULL, series_ticker VARCHAR NOT NULL,
        event_ticker VARCHAR NOT NULL, family VARCHAR NOT NULL,
        exchange_index INTEGER, ts_ns BIGINT NOT NULL, verdict VARCHAR NOT NULL,
        worth_doing BOOLEAN NOT NULL, violated BOOLEAN NOT NULL,
        ci DECIMAL(12,6), net_edge DECIMAL(12,6),
        PRIMARY KEY (component_id, ts_ns)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS collection_polls (
        campaign_id VARCHAR NOT NULL, poll_id BIGINT NOT NULL,
        completed_ts_ns BIGINT NOT NULL, event_observations INTEGER NOT NULL,
        books_written INTEGER NOT NULL, PRIMARY KEY (campaign_id, poll_id)
    )
    """,
)


class DurableCoherenceStoreMixin:
    """Methods split from ``CoherenceStore`` to keep its file-size ratchet."""

    def record_certification_decision(
        self,
        *,
        component_id: str,
        series_ticker: str,
        event_ticker: str,
        family: str,
        exchange_index: int,
        ts_ns: int,
        verdict: str,
        worth_doing: bool,
        violated: bool,
        ci: Decimal | None,
        net_edge: Decimal | None,
    ) -> bool:
        """Persist one decision once; return whether this call inserted it."""
        with self._lock:
            inserted = self._connect().execute(
                """
                INSERT INTO certification_decisions
                    (component_id, series_ticker, event_ticker, family, exchange_index,
                     ts_ns, verdict, worth_doing, violated, ci, net_edge)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                RETURNING component_id
                """,
                (
                    component_id, series_ticker, event_ticker, family, exchange_index,
                    int(ts_ns), verdict, bool(worth_doing), bool(violated), ci, net_edge,
                ),
            ).fetchone()
        return inserted is not None

    def unresolved_episode_decisions(self) -> list[dict[str, Any]]:
        """The suffix from each first violation after its latest durable close."""
        with self._lock:
            rows = self._connect().execute(
                """
                WITH latest_close AS (
                    SELECT component_id, MAX(closed_ts_ns) AS last_closed_ts
                    FROM violation_episodes GROUP BY component_id
                ), first_unpersisted_violation AS (
                    SELECT decision.component_id, MIN(decision.ts_ns) AS first_violation_ts
                    FROM certification_decisions AS decision
                    LEFT JOIN latest_close AS closed
                      ON closed.component_id = decision.component_id
                    WHERE decision.violated
                      AND decision.ts_ns > COALESCE(closed.last_closed_ts, -1)
                    GROUP BY decision.component_id
                )
                SELECT d.component_id, d.series_ticker, d.event_ticker, d.family,
                       d.exchange_index, d.ts_ns, d.verdict, d.worth_doing,
                       d.violated, d.ci, d.net_edge
                FROM certification_decisions AS d
                JOIN first_unpersisted_violation AS violation
                  ON violation.component_id = d.component_id
                WHERE d.ts_ns >= violation.first_violation_ts
                ORDER BY d.ts_ns ASC, d.component_id ASC
                """
            ).fetchall()
        columns = (
            "component_id", "series_ticker", "event_ticker", "family",
            "exchange_index", "ts_ns", "verdict", "worth_doing", "violated",
            "ci", "net_edge",
        )
        return [dict(zip(columns, row, strict=True)) for row in rows]

    def record_episode(self, episode: Any) -> None:
        """Upsert one logical close, including on constraint-free old tapes."""
        row = episode.to_dict()
        values = (
            row["component_id"], row["series_ticker"], row["event_ticker"], row["family"],
            row["exchange_index"], row["opened_ts_ns"], row["closed_ts_ns"],
            None if row["peak_ci"] is None else Decimal(row["peak_ci"]),
            None if row["peak_net_edge_dollars"] is None else Decimal(row["peak_net_edge_dollars"]),
            json.dumps(row["samples"]),
        )
        with self._lock:
            conn = self._connect()
            conn.execute("BEGIN TRANSACTION")
            try:
                conn.execute(
                    "DELETE FROM violation_episodes WHERE component_id = ? AND opened_ts_ns = ?",
                    (row["component_id"], row["opened_ts_ns"]),
                )
                conn.execute(
                    """
                    INSERT INTO violation_episodes
                        (component_id, series_ticker, event_ticker, family, exchange_index,
                         opened_ts_ns, closed_ts_ns, peak_ci, peak_net_edge, samples)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def record_collection_poll(
        self,
        *,
        campaign_id: str,
        poll_id: int,
        completed_ts_ns: int,
        event_observations: int,
        books_written: int,
    ) -> None:
        """Record one complete, observation-bearing watchlist pass once."""
        with self._lock:
            self._connect().execute(
                """
                INSERT INTO collection_polls
                    (campaign_id, poll_id, completed_ts_ns, event_observations, books_written)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
                """,
                (
                    campaign_id, int(poll_id), int(completed_ts_ns),
                    int(event_observations), int(books_written),
                ),
            )

    def campaign_progress(self, campaign_id: str, target: int) -> dict[str, Any]:
        """Durable progress whose unit cannot be confused with an episode."""
        if not campaign_id or target <= 0:
            return {
                "configured": False, "state": "disabled",
                "unit": "successful_observation_poll", "target": max(0, int(target)),
                "successful": 0, "remaining": max(0, int(target)),
            }
        with self._lock:
            row = self._connect().execute(
                """
                SELECT COUNT(*), COALESCE(SUM(event_observations), 0),
                       COALESCE(SUM(books_written), 0), MIN(completed_ts_ns),
                       MAX(completed_ts_ns)
                FROM collection_polls WHERE campaign_id = ?
                """,
                (campaign_id,),
            ).fetchone()
        successful = int(row[0])
        return {
            "configured": True,
            "state": "complete" if successful >= target else "running",
            "campaign_id": campaign_id,
            "unit": "successful_observation_poll",
            "target": int(target),
            "successful": successful,
            "remaining": max(0, int(target) - successful),
            "event_observations": int(row[1]),
            "books_written": int(row[2]),
            "first_completed_ts_ns": None if row[3] is None else int(row[3]),
            "last_completed_ts_ns": None if row[4] is None else int(row[4]),
        }

    def prune_raw_books(self, *, before_ts_ns: int) -> int:
        """Prune raw ladders only; decisions, indices and episodes remain."""
        with self._lock:
            conn = self._connect()
            before = int(conn.execute("SELECT COUNT(*) FROM book_snapshots").fetchone()[0])
            conn.execute("DELETE FROM book_snapshots WHERE ts_ns < ?", (int(before_ts_ns),))
            after = int(conn.execute("SELECT COUNT(*) FROM book_snapshots").fetchone()[0])
        return before - after

    def storage_status(
        self, *, min_free_bytes: int = 0, max_tape_bytes: int = 0, retention_days: int = 0,
    ) -> dict[str, Any]:
        """Filesystem evidence and its fail-closed capacity decision."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        usage = shutil.disk_usage(self.db_path.parent)
        tape_bytes = self.db_path.stat().st_size if self.db_path.exists() else 0
        reasons: list[str] = []
        if min_free_bytes > 0 and usage.free < min_free_bytes:
            reasons.append(f"disk free {usage.free} bytes is below guard {min_free_bytes}")
        if max_tape_bytes > 0 and tape_bytes >= max_tape_bytes:
            reasons.append(f"tape size {tape_bytes} bytes reached guard {max_tape_bytes}")
        return {
            "state": "guarded" if reasons else "ok",
            "reason": "; ".join(reasons) if reasons else None,
            "tape_bytes": int(tape_bytes),
            "disk_total_bytes": int(usage.total),
            "disk_free_bytes": int(usage.free),
            "min_free_bytes": max(0, int(min_free_bytes)),
            "max_tape_bytes": max(0, int(max_tape_bytes)),
            "retention_days": max(0, int(retention_days)),
        }

    def durability_counts(self) -> dict[str, int]:
        """Small durable products that live beside, not inside, the raw tape."""
        with self._lock:
            conn = self._connect()
            decisions = conn.execute("SELECT COUNT(*) FROM certification_decisions").fetchone()
            campaign_polls = conn.execute("SELECT COUNT(*) FROM collection_polls").fetchone()
        return {
            "certification_decisions": int(decisions[0]),
            "collection_polls": int(campaign_polls[0]),
        }

    def extended_health(self, counts: dict[str, int]) -> dict[str, Any]:
        """Join readable-tape health with independent recorder capacity evidence."""
        from modules.coherence import tunables

        storage = self.storage_status(
            min_free_bytes=tunables.MIN_FREE_BYTES,
            max_tape_bytes=tunables.MAX_TAPE_BYTES,
            retention_days=tunables.RETENTION_DAYS,
        )
        return {
            # Reaching this method means ``counts`` read the tape successfully.
            # A capacity guard refuses the next recorder poll, but it must not
            # make an otherwise readable gateway fail startup and restart-loop.
            "state": "ok", "path": self.db_path.name,
            **counts, "storage": storage,
        }
