"""Supervised research runs and the research knowledge graph.

Split out of ``modules/schemas.py``; field order is a wire contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from modules.schemas_data import DataInterval


# --------------------------------------------------------------------------- #
# Supervised research runs
# --------------------------------------------------------------------------- #
class MLFoldView(BaseModel):
    """One walk-forward fold, out-of-sample only.

    ``purge_bars`` and ``embargo_bars`` are not optional and are not decoration.
    A fold that cannot state its purge is a fold whose leakage is unknown, and
    unknown leakage is indistinguishable from none by the only reader who
    matters — the one deciding whether to allocate.
    """

    fold_index: int
    train_start: datetime
    train_end: datetime
    test_start: datetime
    test_end: datetime
    train_rows: int
    test_rows: int
    purge_bars: int
    embargo_bars: int
    oos_return: float | None = None
    oos_sharpe: float | None = None
    oos_max_drawdown: float | None = None
    trades: int | None = None


class MLFeatureView(BaseModel):
    """The feature set a run was fitted on. A model is its features."""

    spec: dict[str, Any]
    # Digest of the canonical spec, so two runs are compared for feature
    # identity with an equality test rather than by reading two JSON blobs.
    spec_hash: str
    feature_count: int
    label: str
    label_horizon_bars: int


class MLRunSummary(BaseModel):
    """One run, as the list shows it."""

    id: str
    model: str
    symbol: str
    interval: str
    # The exact bars the run saw — same meaning as BacktestResult.data_hash, so
    # an ML run and a sweep over the same window are comparable.
    data_hash: str
    seed: int
    # The tree that fitted it. A fitted model is a function of its code in a way
    # a moving average is not. None on a build with no git.
    git_sha: str | None = None
    # numpy (hand-rolled) or sklearn (optional extra). A run that fell back is a
    # different run and must not be ranked as though it were not.
    engine: str
    status: str
    oos_sharpe: float | None = None
    deflated_sharpe: float | None = None
    pbo: float | None = None
    started_at: datetime
    finished_at: datetime | None = None
    # Never null on a failed row — the table refuses it.
    error: str | None = None


class MLFitRequest(BaseModel):
    """Ask the desk to fit one supervised model and file the evidence.

    Every bound here is a refusal to accept a request that cannot produce a
    readable result: fewer than 200 bars cannot fill five purged folds, and a
    label horizon longer than the test window purges the fold out of existence.
    """

    symbol: str = Field(default="BTCUSDT", min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")
    interval: DataInterval = "4h"
    bars: int = Field(default=1500, ge=200, le=5000)
    model: Literal["ridge", "logistic"] = "ridge"
    params: dict[str, Any] = Field(default_factory=dict)
    n_splits: int = Field(default=5, ge=2, le=10)
    label_horizon: int = Field(default=1, ge=1, le=20)
    label_kind: Literal["return", "direction"] | None = None
    embargo: int = Field(default=0, ge=0, le=100)
    cost_bps: float = Field(default=5.0, ge=0.0, le=100.0)
    seed: int = Field(default=0, ge=0)


class MLRunsResponse(BaseModel):
    """The run list, and whether there was a corpus to list.

    ``state`` distinguishes "no runs" from "no store", which are different
    facts. An empty list under state='unavailable' would report a missing
    Supabase as a desk that has never run anything.
    """

    observed_at: datetime
    #: ``unavailable`` — no Supabase on this deployment, nothing was asked.
    #: ``unreadable`` — a store is configured and the read failed. Distinct on
    #: purpose: the first says nothing about the desk, the second says nothing
    #: about the runs, and both used to render as "no runs yet".
    state: Literal["ok", "unavailable", "unreadable"]
    runs: list[MLRunSummary]


class MLRunDetail(MLRunSummary):
    """One run with the evidence its verdict rests on."""

    params: dict[str, Any] = Field(default_factory=dict)
    folds: list[MLFoldView] = Field(default_factory=list)
    features: MLFeatureView | None = None


class ResearchGraphNeighbour(BaseModel):
    """One document reachable from another, and how it was reached."""

    id: str
    kind: str
    source_ref: str
    symbol: str | None = None
    strategy: str | None = None
    occurred_at: datetime
    title: str
    depth: int
    # The last relation traversed, so a reader is told "shares a data hash"
    # rather than "is related".
    arrived_by: str
    # What that relation had in common — the hash, the symbol, the regime.
    evidence: str | None = None


class ResearchGraphResponse(BaseModel):
    """Reachable documents, or the fact that the graph could not be walked.

    `unavailable` is a state and never an empty list: "connected to nothing"
    and "could not ask" are different answers and the workspace renders them
    differently. A deployment predating the traversal migration reports
    unavailable rather than an error — a corpus that cannot traverse yet is
    not a broken corpus.
    """

    state: Literal["ok", "unavailable"]
    connected: list[ResearchGraphNeighbour]
