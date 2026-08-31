"""Backpressure and heartbeat behavior for latest-state WebSocket feeds."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from modules.latest_state_stream import (
    LATEST_STATE_PUBLICATION_INTERVAL_MS,
    LatestStateFeed,
    LatestStateSample,
    SlowConsumer,
    StreamSaturated,
)


def _sample(*, stale: bool = False) -> LatestStateSample:
    observed = datetime.now(timezone.utc) - timedelta(seconds=3 if stale else 0)
    return LatestStateSample(
        payload={"type": "book", "symbol": "BTCUSDT"},
        source_version="venue-book.v1",
        source_observed_at=observed,
        freshness_state="stale" if stale else "live",
    )


def test_the_named_publication_contract_is_exactly_three_hundred_milliseconds():
    feed = LatestStateFeed()

    assert LATEST_STATE_PUBLICATION_INTERVAL_MS == 300
    assert feed.interval_s == 0.3
    assert feed.status()["publication_interval_ms"] == 300


async def test_every_frame_has_attributable_heartbeat_and_monotonic_source_sequence():
    feed = LatestStateFeed(interval_s=0.005, send_timeout_s=0.1)
    frames: list[dict] = []

    async def send(frame: dict) -> None:
        frames.append(frame)
        if len(frames) == 2:
            raise StopAsyncIteration

    with pytest.raises(StopAsyncIteration):
        await feed.serve(_sample, send)

    first, second = frames
    assert first["heartbeat"]["server_time"].endswith("+00:00")
    assert first["heartbeat"]["source_version"] == "venue-book.v1"
    assert second["heartbeat"]["source_sequence"] > first["heartbeat"]["source_sequence"]
    assert first["heartbeat"]["freshness"]["state"] == "live"
    assert first["heartbeat"]["freshness"]["age_ms"] >= 0


async def test_snapshot_work_is_charged_to_the_monotonic_publication_interval():
    clock = [0.0]
    starts: list[float] = []
    sleeps: list[float] = []

    def delayed_snapshot() -> LatestStateSample:
        starts.append(clock[0])
        clock[0] += 0.08
        return _sample()

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)
        clock[0] += delay
        if len(sleeps) == 3:
            raise StopAsyncIteration

    feed = LatestStateFeed(
        interval_s=0.1,
        _clock=lambda: clock[0],
        _sleep=fake_sleep,
    )
    with pytest.raises(StopAsyncIteration):
        await feed.serve(delayed_snapshot, lambda _frame: asyncio.sleep(0))

    assert starts == pytest.approx([0.0, 0.1, 0.2])
    assert sleeps == pytest.approx([0.02, 0.02, 0.02])


async def test_slow_consumer_has_a_bounded_latest_only_queue_and_is_disconnected():
    feed = LatestStateFeed(interval_s=0.001, send_timeout_s=0.02)

    async def blocked_send(_frame: dict) -> None:
        await asyncio.sleep(0.1)

    with pytest.raises(SlowConsumer):
        await feed.serve(_sample, blocked_send)

    status = feed.status()
    assert status["queue_capacity"] == 1
    assert status["coalesced_total"] > 0
    assert status["slow_consumer_total"] == 1
    assert status["active_consumers"] == 0


async def test_cancelling_a_stream_cancels_its_producer_and_records_disconnect():
    feed = LatestStateFeed(interval_s=0.005, send_timeout_s=0.1)
    sent = asyncio.Event()

    async def send(_frame: dict) -> None:
        sent.set()

    task = asyncio.create_task(feed.serve(lambda: _sample(stale=True), send))
    await asyncio.wait_for(sent.wait(), timeout=0.2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    status = feed.status()
    assert status["active_consumers"] == 0
    assert status["active_sources"] == 0
    assert status["cancelled_total"] == 1
    assert status["disconnected_total"] == 1


async def test_consumers_of_one_topic_share_one_snapshot_and_one_frame():
    feed = LatestStateFeed(interval_s=0.1, send_timeout_s=0.2)
    snapshot_calls = 0
    first_frames: list[dict] = []
    second_frames: list[dict] = []
    both_received = asyncio.Event()

    def snapshot() -> LatestStateSample:
        nonlocal snapshot_calls
        snapshot_calls += 1
        return _sample()

    async def collect(target: list[dict], frame: dict) -> None:
        target.append(frame)
        if first_frames and second_frames:
            both_received.set()
        await both_received.wait()
        raise StopAsyncIteration

    first = asyncio.create_task(
        feed.serve(snapshot, lambda frame: collect(first_frames, frame), topic="book:BTCUSDT")
    )
    second = asyncio.create_task(
        feed.serve(snapshot, lambda frame: collect(second_frames, frame), topic="book:BTCUSDT")
    )
    results = await asyncio.gather(first, second, return_exceptions=True)

    assert all(isinstance(result, StopAsyncIteration) for result in results)
    assert snapshot_calls == 1
    assert first_frames[0] is second_frames[0]
    assert (
        first_frames[0]["heartbeat"]["source_sequence"]
        == second_frames[0]["heartbeat"]["source_sequence"]
    )
    assert feed.status()["active_sources"] == 0


async def test_a_slow_consumer_does_not_stall_a_fast_consumer_on_the_same_topic():
    feed = LatestStateFeed(interval_s=0.002, send_timeout_s=0.02)
    fast_frames: list[dict] = []

    async def blocked_send(_frame: dict) -> None:
        await asyncio.sleep(0.1)

    async def fast_send(frame: dict) -> None:
        fast_frames.append(frame)
        if len(fast_frames) == 5:
            raise StopAsyncIteration

    slow = asyncio.create_task(feed.serve(_sample, blocked_send, topic="book:BTCUSDT"))
    fast = asyncio.create_task(feed.serve(_sample, fast_send, topic="book:BTCUSDT"))
    slow_result, fast_result = await asyncio.gather(slow, fast, return_exceptions=True)

    assert isinstance(slow_result, SlowConsumer)
    assert isinstance(fast_result, StopAsyncIteration)
    assert len(fast_frames) == 5
    assert feed.status()["slow_consumer_total"] == 1


async def test_consumer_admission_is_bounded_and_releases_capacity_on_cancel():
    feed = LatestStateFeed(
        interval_s=0.005,
        send_timeout_s=1,
        max_consumers=1,
        max_consumers_per_topic=1,
    )
    entered = asyncio.Event()

    async def hold(_frame: dict) -> None:
        entered.set()
        await asyncio.Event().wait()

    first = asyncio.create_task(feed.serve(_sample, hold, topic="book:BTCUSDT"))
    await asyncio.wait_for(entered.wait(), timeout=0.2)

    with pytest.raises(StreamSaturated, match="consumer limit"):
        await feed.serve(_sample, lambda _frame: asyncio.sleep(0), topic="book:BTCUSDT")

    status = feed.status()
    assert status["active_consumers"] == 1
    assert status["rejected_total"] == 1
    assert status["consumer_limit"] == 1
    assert status["per_topic_consumer_limit"] == 1

    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert feed.status()["active_consumers"] == 0


async def test_topic_cardinality_is_bounded_before_a_second_producer_is_created():
    feed = LatestStateFeed(interval_s=0.005, max_topics=1)
    entered = asyncio.Event()

    async def hold(_frame: dict) -> None:
        entered.set()
        await asyncio.Event().wait()

    first = asyncio.create_task(feed.serve(_sample, hold, topic="book:BTCUSDT"))
    await asyncio.wait_for(entered.wait(), timeout=0.2)
    with pytest.raises(StreamSaturated, match="topic limit"):
        await feed.serve(_sample, lambda _frame: asyncio.sleep(0), topic="book:ETHUSDT")

    assert feed.status()["active_sources"] == 1
    assert feed.status()["topic_limit"] == 1
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
