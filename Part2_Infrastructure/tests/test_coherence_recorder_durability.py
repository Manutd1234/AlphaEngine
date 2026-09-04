"""Restart and capacity boundaries for the always-on Kalshi recorder."""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence import recorder, tunables
from modules.coherence.drivers.kalshi_rest import KalshiUnavailable
from modules.coherence.episodes import Episode
from modules.coherence.fs.store import CoherenceStore, TapeUnavailable
from modules.schemas_coherence import CoherenceObservationCampaignStatus, CoherenceRecorderStorageStatus


def _decision(store: CoherenceStore, ts_ns: int, *, violated: bool) -> bool:
    return store.record_certification_decision(
        component_id="component-A",
        series_ticker="KXBTCD",
        event_ticker="KXBTCD-EVENT",
        family="additive",
        exchange_index=2,
        ts_ns=ts_ns,
        verdict="incoherent" if violated else "coherent",
        worth_doing=violated,
        violated=violated,
        ci=Decimal("0.04") if violated else Decimal("0"),
        net_edge=Decimal("0.02") if violated else None,
    )


def test_open_episode_and_close_counter_survive_restart(tmp_path) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    assert _decision(store, 1_000_000_000, violated=True)
    assert _decision(store, 2_000_000_000, violated=False)

    open_episodes, recovered = recorder.restore_episode_tracker(store)
    assert (open_episodes, recovered) == (1, 0)
    assert recorder.episode_tracker().open_episodes[0]._coherent_polls == 1

    # Simulate the crash window: the second coherent decision landed, while
    # the closed episode insert did not. Startup must finish that transaction.
    assert _decision(store, 3_000_000_000, violated=False)
    open_episodes, recovered = recorder.restore_episode_tracker(store)
    assert (open_episodes, recovered) == (0, 1)
    assert len(store.episodes()) == 1

    # The next restart neither replays nor duplicates the recovered close.
    assert recorder.restore_episode_tracker(store) == (0, 0)
    assert len(store.episodes()) == 1


def test_repeated_violation_does_not_move_the_recovered_opening_time(tmp_path) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    _decision(store, 1_000_000_000, violated=True)
    _decision(store, 2_000_000_000, violated=False)
    _decision(store, 3_000_000_000, violated=True)

    assert recorder.restore_episode_tracker(store) == (1, 0)
    episode = recorder.episode_tracker().open_episodes[0]
    assert episode.opened_ts_ns == 1_000_000_000
    assert episode._coherent_polls == 0


def test_decisions_and_closed_episodes_are_idempotent(tmp_path) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    assert _decision(store, 1, violated=True) is True
    assert _decision(store, 1, violated=True) is False

    episode = Episode(
        component_id="component-A",
        series_ticker="KXBTCD",
        event_ticker="KXBTCD-EVENT",
        family="additive",
        exchange_index=2,
        opened_ts_ns=1,
        closed_ts_ns=3,
        samples=[(1, Decimal("0.04")), (2, Decimal("0")), (3, Decimal("0"))],
    )
    store.record_episode(episode)
    store.record_episode(episode)
    assert store.counts()["certification_decisions"] == 1
    assert len(store.episodes()) == 1


def test_campaign_counts_full_polls_and_never_calls_them_episodes(tmp_path) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    store.record_collection_poll(
        campaign_id="kalshi-1000-60s-v1",
        poll_id=10,
        completed_ts_ns=20,
        event_observations=4,
        books_written=274,
    )
    # Retrying the acknowledgement is safe.
    store.record_collection_poll(
        campaign_id="kalshi-1000-60s-v1",
        poll_id=10,
        completed_ts_ns=20,
        event_observations=4,
        books_written=274,
    )
    progress = store.campaign_progress("kalshi-1000-60s-v1", 2)
    assert progress == {
        "configured": True,
        "state": "running",
        "campaign_id": "kalshi-1000-60s-v1",
        "unit": "successful_observation_poll",
        "target": 2,
        "successful": 1,
        "remaining": 1,
        "event_observations": 4,
        "books_written": 274,
        "first_completed_ts_ns": 20,
        "last_completed_ts_ns": 20,
    }
    assert store.counts()["violation_episodes"] == 0


def test_completed_campaign_returns_to_the_baseline_cadence(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tunables, "POLL_SECONDS", 60)
    monkeypatch.setattr(tunables, "POST_CAMPAIGN_POLL_SECONDS", 300)
    assert recorder.durable.active_poll_seconds({"state": "running"}) == 60
    assert recorder.durable.active_poll_seconds({"state": "complete"}) == 300


def test_recorder_cadence_subtracts_the_time_spent_collecting() -> None:
    assert recorder.durable.remaining_poll_delay_s(60, 100.0, 108.5) == pytest.approx(51.5)
    assert recorder.durable.remaining_poll_delay_s(60, 100.0, 165.0) == 0


def test_campaign_contract_carries_both_cadences_without_false_storage_measurements(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(tunables, "POLL_SECONDS", 60)
    monkeypatch.setattr(tunables, "POST_CAMPAIGN_POLL_SECONDS", 300)
    campaign = CoherenceObservationCampaignStatus(**recorder.durable.default_campaign_status())
    storage = CoherenceRecorderStorageStatus(**recorder.durable.default_storage_status())
    assert (campaign.poll_seconds, campaign.post_campaign_poll_seconds) == (60, 300)
    assert (storage.tape_bytes, storage.disk_total_bytes, storage.disk_free_bytes) == (None, None, None)


@pytest.mark.anyio
async def test_partial_watchlist_failure_cannot_reach_the_campaign_acknowledgement(
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    state = recorder.RecorderState()
    acknowledged = False

    async def observe(_client, series_ticker, **kwargs):
        assert kwargs["require_selected_complete"] is True
        if series_ticker == "BROKEN":
            raise KalshiUnavailable("partial series")
        return []

    async def acknowledge(*_args, **_kwargs):
        nonlocal acknowledged
        acknowledged = True

    monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("GOOD", "BROKEN"))
    monkeypatch.setattr(recorder, "observe_series", observe)
    monkeypatch.setattr(recorder.durable, "finish_campaign_poll", acknowledge)

    with pytest.raises(KalshiUnavailable, match="partial series"):
        await recorder.poll_once(object(), store, state)  # type: ignore[arg-type]
    assert not acknowledged
    assert state.polls == 0


@pytest.mark.anyio
async def test_empty_control_series_does_not_advance_an_otherwise_nonempty_campaign_poll(
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    available: dict[str, list[object]] = {"KXBTCD": [object()], "KXHIGHNY": []}

    async def observe(_client, series_ticker, **_kwargs):
        return available[series_ticker]

    async def measured(_observation, _store, _state):
        return True

    monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXBTCD", "KXHIGHNY"))
    monkeypatch.setattr(tunables, "CAMPAIGN_ID", "complete-watchlist-v1")
    monkeypatch.setattr(tunables, "CAMPAIGN_TARGET", 2)
    monkeypatch.setattr(recorder, "observe_series", observe)
    monkeypatch.setattr(recorder, "rows_from", lambda _observation: [object()])
    monkeypatch.setattr(recorder, "_measure", measured)
    monkeypatch.setattr(store, "record_books", lambda rows: len(rows))
    state = recorder.RecorderState(campaign={"successful": 0})

    await recorder.poll_once(object(), store, state)  # type: ignore[arg-type]
    assert store.campaign_progress("complete-watchlist-v1", 2)["successful"] == 0

    available["KXHIGHNY"] = [object()]
    await recorder.poll_once(object(), store, state)  # type: ignore[arg-type]
    progress = store.campaign_progress("complete-watchlist-v1", 2)
    assert (progress["successful"], progress["event_observations"]) == (1, 2)


def test_storage_guard_refuses_a_poll_before_the_disk_reserve_is_spent(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    state = recorder.RecorderState()
    free = store.storage_status()["disk_free_bytes"]
    monkeypatch.setattr(tunables, "MIN_FREE_BYTES", int(free) + 1)
    monkeypatch.setattr(tunables, "MAX_TAPE_BYTES", 0)
    monkeypatch.setattr(tunables, "RETENTION_DAYS", 0)

    with pytest.raises(TapeUnavailable, match="storage guard refused"):
        recorder.maintain_storage(store, state, now_ns=1, force_retention=True)
    assert state.storage["state"] == "guarded"
    assert state.storage["disk_free_bytes"] == free
    health = store.health()
    assert health["state"] == "ok", "a readable tape must keep gateway readiness live"
    assert health["storage"]["state"] == "guarded"


def test_retention_prunes_only_raw_books(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CoherenceStore(tmp_path / "coherence.duckdb")
    with store.connection() as conn:
        conn.execute(
            """
            INSERT INTO book_snapshots
                (ts_ns, ticker, yes_ladder, no_ladder, depth, source)
            VALUES (1, 'OLD', '[]', '[]', 'full', 'test'),
                   (300000000000000, 'NEW', '[]', '[]', 'full', 'test')
            """
        )
    _decision(store, 1, violated=True)
    monkeypatch.setattr(tunables, "RETENTION_DAYS", 1)
    monkeypatch.setattr(tunables, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(tunables, "MAX_TAPE_BYTES", 0)

    state = recorder.RecorderState()
    recorder.maintain_storage(
        store,
        state,
        now_ns=200_000_000_000_000,
        force_retention=True,
    )
    assert state.storage["retention_pruned_books"] == 1
    assert store.counts()["book_snapshots"] == 1
    assert store.counts()["certification_decisions"] == 1
