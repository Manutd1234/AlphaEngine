"""Bounded latest-state delivery for WebSocket snapshots.

Only superseded market snapshots may be coalesced.  This helper is deliberately
not used for order, execution, or audit events, where dropping one event would
destroy the record rather than merely replace an older view of current state.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Literal

FreshnessState = Literal["live", "partial", "stale", "unavailable"]

#: The public market-state publication contract.  Safety-critical execution,
#: rejection, kill-switch, and breaker events do not use this coalescing feed.
LATEST_STATE_PUBLICATION_INTERVAL_MS = 300
LATEST_STATE_PUBLICATION_INTERVAL_S = LATEST_STATE_PUBLICATION_INTERVAL_MS / 1_000


@dataclass(frozen=True, slots=True)
class LatestStateSample:
    payload: dict[str, Any]
    source_version: str
    source_observed_at: datetime | None
    freshness_state: FreshnessState


class SlowConsumer(TimeoutError):
    """A client could not accept one latest-state frame inside the send budget."""


class StreamSaturated(ConnectionError):
    """A bounded feed refused a topic or consumer before allocating resources."""


@dataclass(slots=True)
class _Topic:
    snapshot: Callable[[], LatestStateSample]
    consumers: dict[int, asyncio.Queue[dict[str, Any]]]
    producer: asyncio.Task[None] | None = None


class LatestStateFeed:
    """One shared producer per topic and a size-one queue per consumer.

    The first subscriber owns the topic's snapshot callback until the last
    subscriber leaves.  Every subscriber to that topic therefore receives the
    same immutable-by-convention frame and source sequence for a publication;
    adding clients does not multiply market-book/TCA computation.
    """

    def __init__(
        self,
        *,
        interval_s: float = LATEST_STATE_PUBLICATION_INTERVAL_S,
        send_timeout_s: float = 2.0,
        max_topics: int = 32,
        max_consumers: int = 64,
        max_consumers_per_topic: int = 32,
        _clock: Callable[[], float] = monotonic,
        _sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.interval_s = max(0.001, interval_s)
        self.send_timeout_s = max(0.001, send_timeout_s)
        self.max_topics = max(1, int(max_topics))
        self.max_consumers = max(1, int(max_consumers))
        self.max_consumers_per_topic = max(1, int(max_consumers_per_topic))
        self._clock = _clock
        self._sleep = _sleep
        self._guard = threading.Lock()
        self._topics: dict[str, _Topic] = {}
        self._next_consumer_id = 0
        self._sequence = 0
        self._active = 0
        self._active_sources = 0
        self._connected = 0
        self._disconnected = 0
        self._coalesced = 0
        self._slow = 0
        self._cancelled = 0
        self._rejected = 0

    def _frame(self, sample: LatestStateSample) -> dict[str, Any]:
        server_time = datetime.now(timezone.utc)
        observed = sample.source_observed_at
        age_ms = max(0.0, (server_time - observed).total_seconds() * 1_000) if observed else None
        with self._guard:
            self._sequence += 1
            sequence = self._sequence
            coalesced = self._coalesced
        return {
            **sample.payload,
            "heartbeat": {
                "server_time": server_time.isoformat(),
                "source_sequence": sequence,
                "source_version": sample.source_version,
                "freshness": {
                    "state": sample.freshness_state,
                    "age_ms": round(age_ms, 3) if age_ms is not None else None,
                    "last_good_at": observed.isoformat() if observed else None,
                },
                "coalesced_total": coalesced,
            },
        }

    async def serve(
        self,
        snapshot: Callable[[], LatestStateSample],
        send: Callable[[dict[str, Any]], Awaitable[None]],
        *,
        topic: str = "default",
    ) -> None:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1)
        with self._guard:
            source = self._topics.get(topic)
            if self._active >= self.max_consumers:
                self._rejected += 1
                raise StreamSaturated("latest-state feed reached its consumer limit")
            if source is None and len(self._topics) >= self.max_topics:
                self._rejected += 1
                raise StreamSaturated("latest-state feed reached its topic limit")
            if source is not None and len(source.consumers) >= self.max_consumers_per_topic:
                self._rejected += 1
                raise StreamSaturated("latest-state topic reached its consumer limit")

            self._next_consumer_id += 1
            consumer_id = self._next_consumer_id
            self._active += 1
            self._connected += 1
            if source is None:
                source = _Topic(snapshot=snapshot, consumers={})
                self._topics[topic] = source
                self._active_sources += 1
            source.consumers[consumer_id] = queue
            if source.producer is None:
                source.producer = asyncio.create_task(
                    self._produce(source), name=f"latest-state:{topic}",
                )
        assert source.producer is not None
        consumer = asyncio.create_task(
            self._consume(queue, send), name=f"latest-state-consumer:{topic}:{consumer_id}",
        )
        try:
            done, _pending = await asyncio.wait(
                {source.producer, consumer}, return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                task.result()
        except asyncio.CancelledError:
            with self._guard:
                self._cancelled += 1
            raise
        finally:
            consumer.cancel()
            await asyncio.gather(consumer, return_exceptions=True)
            producer_to_stop: asyncio.Task[None] | None = None
            with self._guard:
                source.consumers.pop(consumer_id, None)
                if not source.consumers and self._topics.get(topic) is source:
                    self._topics.pop(topic)
                    producer_to_stop = source.producer
                    self._active_sources -= 1
                self._active -= 1
                self._disconnected += 1
            if producer_to_stop is not None:
                producer_to_stop.cancel()
                await asyncio.gather(producer_to_stop, return_exceptions=True)

    async def _produce(self, source: _Topic) -> None:
        next_deadline = self._clock()
        while True:
            frame = self._frame(source.snapshot())
            for queue in tuple(source.consumers.values()):
                if queue.full():
                    queue.get_nowait()
                    with self._guard:
                        self._coalesced += 1
                queue.put_nowait(frame)
            next_deadline += self.interval_s
            now = self._clock()
            # Snapshot/dispatch work consumes the current interval; it must
            # not be followed by another full interval and compound drift.
            # When work overruns, reset at "now" instead of bursting through
            # every missed deadline.
            if next_deadline < now:
                next_deadline = now
            await self._sleep(max(0.0, next_deadline - now))

    async def _consume(
        self,
        queue: asyncio.Queue[dict[str, Any]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        while True:
            frame = await queue.get()
            try:
                async with asyncio.timeout(self.send_timeout_s):
                    await send(frame)
            except TimeoutError as exc:
                with self._guard:
                    self._slow += 1
                raise SlowConsumer("latest-state consumer exceeded its send budget") from exc

    def status(self) -> dict[str, int]:
        with self._guard:
            return {
                "publication_interval_ms": round(self.interval_s * 1_000),
                "queue_capacity": 1,
                "active_sources": self._active_sources,
                "active_consumers": self._active,
                "connected_total": self._connected,
                "disconnected_total": self._disconnected,
                "coalesced_total": self._coalesced,
                "slow_consumer_total": self._slow,
                "cancelled_total": self._cancelled,
                "rejected_total": self._rejected,
                "topic_limit": self.max_topics,
                "consumer_limit": self.max_consumers,
                "per_topic_consumer_limit": self.max_consumers_per_topic,
                "source_sequence": self._sequence,
            }
