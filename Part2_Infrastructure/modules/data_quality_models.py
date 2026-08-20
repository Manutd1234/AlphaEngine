"""The data-quality wire models.

Lifted out of `data_quality.py` when that file grew past its size ceiling
adding a second backend. These are the shapes the gateway publishes — findings,
counts, per-provider and per-capability rollups, escalations, the merged view —
and they have no dependency on the store that fills them, which is what makes
them the clean cut.

Imported back into `data_quality` so every existing `from modules.data_quality
import DataQualityView` keeps working.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Wire contract — what an instance pushes, and the view every instance reads
# --------------------------------------------------------------------------- #

Severity = Literal["fatal", "warn", "drift"]

# Bounds on cardinality, not correctness: the ledger must survive a
# misbehaving client without growing without bound.
FINDINGS_BATCH_CAP = 200
CHECKS_PER_FINDING_CAP = 32
FUTURE_SLACK_MS = 60_000


class WebContractCheck(BaseModel):
    check: str = Field(min_length=1, max_length=64)
    severity: Severity
    message: str = Field(default="", max_length=200)


class WebContractFinding(BaseModel):
    """One contract evaluation, as the web instance recorded it.

    ``seq`` is the instance's own monotonic counter: with ``UNIQUE(instance,
    seq)`` a batch the instance restores and re-pushes after a failed sync is
    de-duplicated rather than counted twice.
    """

    seq: int = Field(ge=0)
    observed_at: float = Field(ge=0, description="Epoch milliseconds, client clock")
    capability: str = Field(min_length=1, max_length=32)
    provider: str = Field(min_length=1, max_length=64)
    symbol: str | None = Field(default=None, max_length=24)
    key: str = Field(default="", max_length=160)
    passed: bool
    fatal: int = Field(default=0, ge=0, le=100)
    warn: int = Field(default=0, ge=0, le=100)
    drift: int = Field(default=0, ge=0, le=100)
    not_evaluated: int = Field(default=0, ge=0, le=100)
    checks: list[WebContractCheck] = Field(default_factory=list, max_length=CHECKS_PER_FINDING_CAP)


class DataQualityCounts(BaseModel):
    evaluated: int
    passed: int
    fatal: int
    warn: int
    drift: int
    not_evaluated: int


class DataQualityProviderRow(DataQualityCounts):
    provider: str
    # None when nothing was evaluated — never 0, which would read as "perfect".
    fail_rate: float | None


class DataQualityCapabilityRow(DataQualityCounts):
    capability: str


class DataQualityFindingView(BaseModel):
    id: int
    observed_at: datetime
    instance: str
    source: Literal["web", "replay", "backfill"]
    capability: str
    provider: str
    symbol: str | None
    key: str
    passed: bool
    severity: Literal["fatal", "warn", "drift", "clean"]
    checks: list[str]


class DataQualityEscalationView(BaseModel):
    id: int
    rule: Literal["fatal_burst", "fail_rate"]
    provider: str
    opened_at: datetime
    window_minutes: int
    count: int
    evaluated: int | None
    detail: str
    notified_at: datetime | None
    channel: Literal["telegram", "log", "webhook"] | None
    resolved_at: datetime | None
    #: When someone took it, and who. NULL means nobody has — including for
    #: every row written before these columns existed, which is the same fact.
    acknowledged_at: datetime | None
    #: `telegram:<user id>` names a person. `web:token` names a credential and
    #: nothing more, and is left as-is rather than rendered as a person.
    acknowledged_by: str | None


class DataQualityView(BaseModel):
    """The merged ledger, as every instance reads it back.

    Every field is required on purpose (the same house rule as
    ``WebStateView``): a response field with a default publishes itself as
    optional in the OpenAPI contract, and a generated client would then hedge
    against an absence that cannot happen.
    """

    schema_version: Literal[1] = 1
    backend: Literal["sqlite", "postgres"]
    retention_days: int
    window_minutes: int
    observed_at: datetime
    first_observed_at: datetime | None
    last_observed_at: datetime | None
    instances: int
    total: DataQualityCounts
    by_provider: list[DataQualityProviderRow]
    by_capability: list[DataQualityCapabilityRow]
    recent: list[DataQualityFindingView]
    escalations: list[DataQualityEscalationView]


class DataQualityFindingsResponse(BaseModel):
    findings: list[DataQualityFindingView]
    total: int
    retention_days: int
    window_minutes: int
    observed_at: datetime
