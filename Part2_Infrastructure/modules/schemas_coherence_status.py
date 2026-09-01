"""Status wire models for the live coherence recorder and its durable tape."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CoherenceHostStatus(BaseModel):
    """Whether Kalshi answered, and which host did."""

    host: str
    reachable: bool
    detail: str | None = None


class CoherenceShardStatus(BaseModel):
    """One exchange instance. Collateral is per shard, so this is a hard gate."""

    exchange_index: int
    description: str
    exchange_active: bool
    trading_active: bool


class CoherenceObservationCampaignStatus(BaseModel):
    """A bounded count of successful observation polls, never episodes."""

    configured: bool = False
    state: str = "disabled"
    campaign_id: str | None = None
    unit: str = "successful_observation_poll"
    target: int = 0
    successful: int = 0
    remaining: int = 0
    event_observations: int = 0
    books_written: int = 0
    first_completed_ts_ns: int | None = None
    last_completed_ts_ns: int | None = None
    poll_seconds: int = 60
    post_campaign_poll_seconds: int = 300


class CoherenceRecorderStorageStatus(BaseModel):
    """The tape's measured capacity and fail-closed guard state."""

    state: str = "unchecked"
    reason: str | None = None
    tape_bytes: int | None = None
    disk_total_bytes: int | None = None
    disk_free_bytes: int | None = None
    min_free_bytes: int = 0
    max_tape_bytes: int = 0
    retention_days: int = 0
    retention_pruned_books: int = 0
    last_retention_check_ts_ns: int | None = None


class CoherenceRecorderStatus(BaseModel):
    """What the recorder has done, not what it was configured to do."""

    running: bool
    configured: bool
    poll_seconds: int
    watchlist: list[str]
    polls: int
    books_written: int
    seconds_since_last_poll: float | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    series_seen: list[str] = Field(default_factory=list)
    last_poll_ts_ns: int | None = None
    episodes_closed: int = 0
    episodes_recovered: int = 0
    certification_decisions: int = 0
    campaign: CoherenceObservationCampaignStatus = Field(default_factory=CoherenceObservationCampaignStatus)
    storage: CoherenceRecorderStorageStatus = Field(default_factory=CoherenceRecorderStorageStatus)


class CoherenceBudgetStatus(BaseModel):
    """The client's model of its own read bucket, with the basis for it."""

    tokens_per_second: int
    burst: int
    tokens_available: float
    default_cost: int
    published_costs_known: int
    tokens_spent: int
    refusals: int
    basis: str


class CoherenceStatus(BaseModel):
    """Everything a reader needs to judge whether the rest of the tab is real."""

    state: str
    hosts: list[CoherenceHostStatus] = Field(default_factory=list)
    shards: list[CoherenceShardStatus] = Field(default_factory=list)
    schema_probe: dict[str, object] = Field(default_factory=dict)
    recorder: CoherenceRecorderStatus
    budget: CoherenceBudgetStatus
    tape: dict[str, object] = Field(default_factory=dict)
    solver: dict[str, object] = Field(default_factory=dict)
    signing: dict[str, object] = Field(default_factory=dict)
    dry_run: bool = True
    notes: list[str] = Field(default_factory=list)
