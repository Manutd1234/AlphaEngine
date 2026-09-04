"""Restart, campaign, and disk boundaries for the coherence recorder."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from typing import Any

from modules.coherence import tunables
from modules.coherence.episodes import EpisodeTracker
from modules.coherence.fs.store import CoherenceStore, TapeUnavailable


def default_campaign_status() -> dict[str, Any]:
    configured = bool(tunables.CAMPAIGN_ID and tunables.CAMPAIGN_TARGET > 0)
    return {
        "configured": configured,
        "state": "pending" if configured else "disabled",
        "campaign_id": tunables.CAMPAIGN_ID or None,
        "unit": "successful_observation_poll",
        "target": tunables.CAMPAIGN_TARGET,
        "successful": 0,
        "remaining": tunables.CAMPAIGN_TARGET,
        "poll_seconds": tunables.POLL_SECONDS,
        "post_campaign_poll_seconds": tunables.POST_CAMPAIGN_POLL_SECONDS,
    }


def default_storage_status() -> dict[str, Any]:
    return {
        "state": "unchecked",
        "min_free_bytes": tunables.MIN_FREE_BYTES,
        "max_tape_bytes": tunables.MAX_TAPE_BYTES,
        "retention_days": tunables.RETENTION_DAYS,
    }


def campaign_status(store: CoherenceStore) -> dict[str, Any]:
    status = store.campaign_progress(tunables.CAMPAIGN_ID, tunables.CAMPAIGN_TARGET)
    status["poll_seconds"] = tunables.POLL_SECONDS
    status["post_campaign_poll_seconds"] = tunables.POST_CAMPAIGN_POLL_SECONDS
    return status


def active_poll_seconds(campaign: dict[str, Any]) -> int:
    """Use 60s for the bounded campaign, then return to the baseline."""
    if campaign.get("state") == "complete":
        return tunables.POST_CAMPAIGN_POLL_SECONDS
    return tunables.POLL_SECONDS


def remaining_poll_delay_s(interval_s: int, started_s: float, finished_s: float) -> float:
    """Keep poll starts on cadence instead of adding collection time to it.

    A ten-second pass configured for 60 seconds should wait 50 seconds, not a
    second full minute. An over-budget pass returns zero and still yields via
    ``asyncio.sleep(0)`` before the next attempt.
    """
    elapsed = max(0.0, finished_s - started_s)
    return max(0.0, float(interval_s) - elapsed)


async def persist_decision(
    store: CoherenceStore,
    *,
    component: Any,
    observation: Any,
    certificate: Any,
    reading: Any,
    violated: bool,
) -> bool:
    """Write one certification decision before RAM advances the episode."""
    return await asyncio.to_thread(
        store.record_certification_decision,
        component_id=component.component_id,
        series_ticker=component.series_ticker,
        event_ticker=component.event_ticker,
        family=certificate.family,
        exchange_index=component.exchange_index,
        ts_ns=observation.ts_ns,
        verdict=certificate.verdict,
        worth_doing=certificate.worth_doing,
        violated=violated,
        ci=reading.ci,
        net_edge=certificate.net_edge,
    )


async def finish_campaign_poll(
    store: CoherenceStore,
    tracked: Any,
    *,
    poll_id: int,
    series_decisions: Mapping[str, int],
    books_written: int,
) -> None:
    """Advance a bounded campaign only after the whole watchlist succeeded."""
    successful = int(tracked.campaign.get("successful", 0))
    required_series = tuple(dict.fromkeys(tunables.SERIES_WATCHLIST))
    certified_observations = sum(max(0, int(series_decisions.get(series, 0))) for series in required_series)
    if (
        not required_series
        or any(series_decisions.get(series_ticker, 0) <= 0 for series_ticker in required_series)
        or not tunables.CAMPAIGN_ID
        or tunables.CAMPAIGN_TARGET <= successful
    ):
        return
    await asyncio.to_thread(
        store.record_collection_poll,
        campaign_id=tunables.CAMPAIGN_ID,
        poll_id=poll_id,
        completed_ts_ns=time.time_ns(),
        event_observations=certified_observations,
        books_written=books_written,
    )
    tracked.campaign = await asyncio.to_thread(campaign_status, store)


def restore_episode_tracker(store: CoherenceStore) -> tuple[EpisodeTracker, int]:
    """Replay unresolved decisions and finish any crash-interrupted close."""
    tracker = EpisodeTracker()
    recovered = 0
    for row in store.unresolved_episode_decisions():
        closed = tracker.observe(
            component_id=str(row["component_id"]),
            series_ticker=str(row["series_ticker"]),
            event_ticker=str(row["event_ticker"]),
            exchange_index=int(row["exchange_index"] or 0),
            ts_ns=int(row["ts_ns"]),
            violated=bool(row["violated"]),
            family=str(row["family"]),
            ci=row["ci"],
            net_edge=row["net_edge"],
        )
        if closed is not None:
            store.record_episode(closed)
            recovered += 1
    tracker.closed.clear()
    return tracker, recovered


def maintain_storage(
    store: CoherenceStore,
    tracked: Any,
    *,
    now_ns: int | None = None,
    force_retention: bool = False,
) -> dict[str, Any]:
    """Apply optional raw-book retention and refuse a capacity-unsafe poll."""
    stamp = time.time_ns() if now_ns is None else int(now_ns)
    last_check = tracked.storage.get("last_retention_check_ts_ns")
    pruned_books = int(tracked.storage.get("retention_pruned_books", 0))
    retention_due = (
        force_retention
        or last_check is None
        or stamp - int(last_check) >= tunables.RETENTION_CHECK_SECONDS * 1_000_000_000
    )
    if retention_due:
        if tunables.RETENTION_DAYS > 0:
            cutoff = stamp - tunables.RETENTION_DAYS * 86_400 * 1_000_000_000
            pruned_books += store.prune_raw_books(before_ts_ns=cutoff)
        last_check = stamp

    status = store.storage_status(
        min_free_bytes=tunables.MIN_FREE_BYTES,
        max_tape_bytes=tunables.MAX_TAPE_BYTES,
        retention_days=tunables.RETENTION_DAYS,
    )
    status["retention_pruned_books"] = pruned_books
    status["last_retention_check_ts_ns"] = last_check
    tracked.storage = status
    if status["state"] == "guarded":
        raise TapeUnavailable(f"coherence storage guard refused a poll: {status['reason']}")
    return status


def initialise_durable_state(store: CoherenceStore, tracked: Any) -> EpisodeTracker:
    """Load tracker, durable counters, campaign progress, and capacity state."""
    tracker, recovered = restore_episode_tracker(store)
    counts = store.counts()
    tracked.episodes_closed = counts.get("violation_episodes", 0)
    tracked.episodes_recovered = recovered
    tracked.certification_decisions = counts.get("certification_decisions", 0)
    tracked.campaign = campaign_status(store)
    maintain_storage(store, tracked, force_retention=True)
    return tracker
