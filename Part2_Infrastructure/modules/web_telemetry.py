"""Shared operational state for the serverless web workspace.

The Next.js portal runs on Vercel, where every lambda keeps its own in-memory
telemetry: latency samples, simulated-outage flags and quota counters all live
in per-instance module maps. Two consecutive polls can land on two instances
and describe two different worlds — the p99 chip "collecting" forever and a
simulated outage that only one lambda believes in are both this bug.

This module is the fix the web console's own backlog names: move the ledger to
the one long-lived stateful process that already exists — this gateway — rather
than buying a KV store. Each web instance periodically POSTs the deltas it has
accumulated (latency samples, quota spend, outage commands) and receives the
merged view back in the same round trip. The web keeps its local ledger as the
fallback, so a gateway outage degrades honestly to today's per-instance truth.

Deliberately in-process, like every other ledger here: one VM, one process, no
new infrastructure. A gateway restart forgets this state — that is disclosed by
``observed_at`` plus the retention window, and the web re-fills it within a few
polls. Nothing in here is load-bearing for trading; it is observability truth.

One half of the sync is different: the contract findings each instance pushes
are persisted by ``modules.data_quality`` (SQLite on the data volume) rather
than kept in memory, and the merged quality view rides back in the same
response. That half survives a restart on purpose — a quality ledger that
forgets on deploy is not a ledger.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from modules.data_quality import FINDINGS_BATCH_CAP, DataQualityView, WebContractFinding

# One retention window for everything, matching the web ledger's own 15-minute
# read window so both sides describe the same "now".
RETENTION_MS = 15 * 60_000

# Per-key sample cap. Slightly above the web's per-instance cap (120) so the
# merged view can hold more than one instance's worth of history.
SAMPLE_CAP = 240

# Caps on cardinality, not correctness: the store must survive a misbehaving
# client without growing without bound.
KEY_CAP = 64
QUOTA_CAP = 256
INSTANCE_CAP = 64

# A simulated outage may never outlive the web's own ceiling.
OUTAGE_MAX_MS = 15 * 60_000

# Samples further in the future than this are clock skew we refuse to store.
FUTURE_SLACK_MS = 60_000


# --------------------------------------------------------------------------- #
# Wire contract
# --------------------------------------------------------------------------- #
class WebLatencySample(BaseModel):
    ts: float = Field(ge=0, description="Epoch milliseconds, client clock")
    ms: float = Field(ge=0, le=600_000)
    ok: bool


class WebLatencyBatch(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    samples: list[WebLatencySample] = Field(default_factory=list, max_length=SAMPLE_CAP)


class WebQuotaSpend(BaseModel):
    """Delta spend since the instance's last successful sync — not a total."""

    provider: str = Field(min_length=1, max_length=64)
    window: str = Field(min_length=1, max_length=32, description="Calendar window label, e.g. 2026-08-11")
    spent: int = Field(ge=0, le=100_000)


class WebQuotaReset(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    window: str = Field(min_length=1, max_length=32)


class WebOutageCommand(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    expires_at: float = Field(ge=0, description="Epoch milliseconds; clamped to the outage ceiling")
    note: str = Field(default="operator-simulated outage", max_length=200)


class WebStateSyncRequest(BaseModel):
    schema_version: Literal[1] = 1
    instance: str = Field(min_length=1, max_length=64)
    latency: list[WebLatencyBatch] = Field(default_factory=list, max_length=KEY_CAP)
    quota: list[WebQuotaSpend] = Field(default_factory=list, max_length=64)
    quota_reset: list[WebQuotaReset] = Field(default_factory=list, max_length=16)
    outages_set: list[WebOutageCommand] = Field(default_factory=list, max_length=16)
    outages_cleared: list[str] = Field(default_factory=list, max_length=32, description='Provider ids; "*" clears all')
    # Contract findings since the instance's last successful sync. Persisted by
    # the data-quality ledger, not merged in memory like the rest.
    findings: list[WebContractFinding] = Field(default_factory=list, max_length=FINDINGS_BATCH_CAP)


class WebLatencyKeyView(BaseModel):
    key: str
    samples: list[WebLatencySample] = Field(default_factory=list)


class WebOutageView(BaseModel):
    provider: str
    expires_at: float
    note: str


class WebQuotaView(BaseModel):
    provider: str
    window: str
    spent: int


class WebStateView(BaseModel):
    # Additive optional fields only, like the operations snapshot: the web
    # validator pins version 1 and an older client must keep validating.
    # The lists carry no defaults on purpose — ``sync`` always fills them, and
    # a response field with a default publishes itself as optional in the
    # OpenAPI contract, which would make every generated client hedge against
    # an absence that cannot happen.
    schema_version: Literal[1] = 1
    observed_at: datetime
    window_seconds: float
    instances: list[str]
    latency: list[WebLatencyKeyView]
    outages: list[WebOutageView]
    quota: list[WebQuotaView]
    # The merged, durable quality ledger — required, like every other field.
    data_quality: DataQualityView


# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #
class WebOpsState:
    """Merged web telemetry, in process memory.

    Every mutation happens inside ``sync`` with no ``await`` between reads and
    writes, so the single event loop serialises access without a lock.
    """

    def __init__(self, ledger_view: Callable[[float], DataQualityView] | None = None) -> None:
        self._samples: dict[str, deque[tuple[float, float, bool]]] = {}
        self._outages: dict[str, tuple[float, str]] = {}
        self._quota: dict[tuple[str, str], int] = {}
        self._instances: dict[str, float] = {}
        # Injected so the store can be driven with an in-memory ledger under
        # test, and so this module never opens the SQLite file itself.
        self._ledger_view = ledger_view or _in_memory_ledger_view()

    def reset(self) -> None:
        self._samples.clear()
        self._outages.clear()
        self._quota.clear()
        self._instances.clear()

    # -- ingest ------------------------------------------------------------- #
    def _ingest_latency(self, batches: list[WebLatencyBatch], now_ms: float) -> None:
        for batch in batches:
            bucket = self._samples.get(batch.key)
            if bucket is None:
                if len(self._samples) >= KEY_CAP:
                    self._evict_stalest_key()
                bucket = deque(maxlen=SAMPLE_CAP)
                self._samples[batch.key] = bucket
            for sample in batch.samples:
                # Refuse both the stale and the future: a sample outside the
                # window is either a replay or a broken clock, and storing it
                # would put a lie into every instance's percentiles.
                if sample.ts < now_ms - RETENTION_MS or sample.ts > now_ms + FUTURE_SLACK_MS:
                    continue
                bucket.append((sample.ts, sample.ms, sample.ok))

    def _evict_stalest_key(self) -> None:
        stalest_key = None
        stalest_ts = float("inf")
        for key, bucket in self._samples.items():
            newest = bucket[-1][0] if bucket else 0.0
            if newest < stalest_ts:
                stalest_ts = newest
                stalest_key = key
        if stalest_key is not None:
            del self._samples[stalest_key]

    def _make_quota_room(self, key: tuple[str, str]) -> None:
        if key not in self._quota and len(self._quota) >= QUOTA_CAP:
            # Insertion order is oldest-window-first, which is the right
            # eviction order for calendar-labelled counters.
            oldest = next(iter(self._quota))
            del self._quota[oldest]

    def _ingest_quota(self, spends: list[WebQuotaSpend], resets: list[WebQuotaReset]) -> None:
        # Resets apply first: an instance that resets and immediately re-spends
        # in one sync means "start the window from this spend". A reset leaves
        # an explicit zero rather than deleting the counter — an absent entry
        # cannot tell other instances to drop their stale high-water marks,
        # and hydrating "missing means zero" would erase real spend records
        # whenever this process restarts.
        for reset in resets:
            key = (reset.provider, reset.window)
            self._make_quota_room(key)
            self._quota[key] = 0
        for spend in spends:
            if spend.spent <= 0:
                continue
            key = (spend.provider, spend.window)
            self._make_quota_room(key)
            self._quota[key] = self._quota.get(key, 0) + spend.spent

    def _ingest_outages(self, set_commands: list[WebOutageCommand], cleared: list[str], now_ms: float) -> None:
        for command in set_commands:
            expires_at = min(command.expires_at, now_ms + OUTAGE_MAX_MS)
            if expires_at <= now_ms:
                continue
            self._outages[command.provider] = (expires_at, command.note)
        for provider in cleared:
            if provider == "*":
                self._outages.clear()
            else:
                self._outages.pop(provider, None)

    # -- prune -------------------------------------------------------------- #
    def _prune(self, now_ms: float) -> None:
        cutoff = now_ms - RETENTION_MS
        for key in [k for k, bucket in self._samples.items() if not bucket or bucket[-1][0] < cutoff]:
            del self._samples[key]
        for provider in [p for p, (expires_at, _) in self._outages.items() if expires_at <= now_ms]:
            del self._outages[provider]
        for instance in [i for i, seen in self._instances.items() if seen < cutoff]:
            del self._instances[instance]

    # -- the one entry point ------------------------------------------------ #
    def sync(self, request: WebStateSyncRequest, now_ms: float | None = None) -> WebStateView:
        now = now_ms if now_ms is not None else time.time() * 1000.0
        if request.instance not in self._instances and len(self._instances) >= INSTANCE_CAP:
            oldest = min(self._instances, key=self._instances.get)  # type: ignore[arg-type]
            del self._instances[oldest]
        self._instances[request.instance] = now
        self._ingest_latency(request.latency, now)
        self._ingest_quota(request.quota, request.quota_reset)
        self._ingest_outages(request.outages_set, request.outages_cleared, now)
        # The read is the same prune-and-project ``view`` performs; calling it
        # here keeps the sync response and a bare read byte-identical rather than
        # letting two copies of the projection drift.
        return self.view(now)

    # -- the read half, without ingesting ----------------------------------- #
    def view(self, now_ms: float | None = None) -> WebStateView:
        """Prune to the retention window and project the merged view — no ingest.

        The read half of :meth:`sync`, split out so a reader that has nothing to
        contribute (the Telegram companion's ``/providers`` and ``/webops``) can
        see the same ledger the web instances POST into without inventing an
        empty instance to POST as. ``sync`` calls this after ingesting, so a web
        poll behaves exactly as it did before this method existed.
        """
        now = now_ms if now_ms is not None else time.time() * 1000.0
        self._prune(now)

        cutoff = now - RETENTION_MS
        latency = [
            WebLatencyKeyView(
                key=key,
                samples=[
                    WebLatencySample(ts=ts, ms=ms, ok=ok)
                    for ts, ms, ok in sorted(bucket, key=lambda s: s[0])
                    if ts >= cutoff
                ],
            )
            for key, bucket in sorted(self._samples.items())
        ]
        return WebStateView(
            observed_at=datetime.now(timezone.utc),
            window_seconds=RETENTION_MS / 1000.0,
            instances=sorted(self._instances),
            latency=[view for view in latency if view.samples],
            outages=[
                WebOutageView(provider=provider, expires_at=expires_at, note=note)
                for provider, (expires_at, note) in sorted(self._outages.items())
            ],
            quota=[
                WebQuotaView(provider=provider, window=window, spent=spent)
                for (provider, window), spent in sorted(self._quota.items())
            ],
            data_quality=self._ledger_view(now),
        )


def _in_memory_ledger_view() -> Callable[[float], DataQualityView]:
    from modules.data_quality import DataQualityLedger

    ledger = DataQualityLedger.in_memory()
    return ledger.view


_web_ops: WebOpsState | None = None


def get_web_ops() -> WebOpsState:
    global _web_ops
    if _web_ops is None:
        from modules.data_quality import get_data_quality

        _web_ops = WebOpsState(get_data_quality().view)
    return _web_ops
