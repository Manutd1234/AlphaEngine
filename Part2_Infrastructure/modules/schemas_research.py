"""Research RAG (Supabase pgvector) — typed route contracts.

Split out of ``modules/schemas.py``; field order is a wire contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------------------- #
# Research RAG (Supabase pgvector) — typed route contracts
# --------------------------------------------------------------------------- #
class ResearchRagSearchRequest(BaseModel):
    """A similarity query over the desk's own research corpus."""

    query: str = Field(min_length=1, max_length=2000)
    match_count: int = Field(default=3, ge=1, le=20)
    kind: Literal["backtest_run", "chart", "execution_summary", "ml_run", "risk_incident"] | None = None


class ResearchRagEmbedRequest(BaseModel):
    """Text to embed with the same model that embedded the corpus.

    Bounds mirror `supabase/functions/embed-research` exactly — 1..32 texts of
    1..8000 characters. Rejecting here rather than forwarding an oversized batch
    turns a 400 from an edge function the caller cannot see into a validation
    error naming the field.
    """

    texts: list[str] = Field(min_length=1, max_length=32)

    @field_validator("texts")
    @classmethod
    def _bounded_texts(cls, v: list[str]) -> list[str]:
        for text in v:
            if not text.strip():
                raise ValueError("texts may not be blank")
            if len(text) > 8000:
                raise ValueError("each text is limited to 8000 characters")
        return v


class ResearchRagEmbedResponse(BaseModel):
    """Vectors in request order, or `state: unavailable` with none.

    There is no partial success: a caller that received some vectors would have
    to track which positions failed to pair them with the right text, and a
    misaligned embedding ranks confident nonsense rather than erroring.
    """

    state: Literal["ok", "unavailable"]
    embeddings: list[list[float]] = Field(default_factory=list)
    model: str | None = None
    dimensions: int | None = None


class ResearchRagMatch(BaseModel):
    id: str
    kind: str
    source_ref: str
    symbol: str | None = None
    strategy: str | None = None
    occurred_at: datetime
    title: str
    body: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    similarity: float
    #: Where each retriever placed this document, 1-based. Both are None on the
    #: dense-only path — which is a real state during a rollout, not an error.
    #:
    #: Carried through so a reader can be told WHY a document surfaced.
    #: "matched the ticker exactly" and "semantically similar" are different
    #: claims about the same result, and a panel that cannot distinguish them
    #: presents a lexical hit and a paraphrase match as equally confident.
    #:
    #: These were the fields whose absence made hybrid retrieval look broken
    #: after it shipped: pydantic drops unknown keys, so the RPC was returning
    #: both ranks and the response model was silently discarding them. The live
    #: symptom was identical to the 404 fallback, which cost a wrong diagnosis.
    vector_rank: int | None = None
    lexical_rank: int | None = None


class ResearchRagSearchResponse(BaseModel):
    """`unavailable` is a state, never an empty match list wearing one's face:
    "searched and found nothing" and "could not search" are different facts."""

    state: Literal["ok", "unavailable", "embed_failed"]
    matches: list[ResearchRagMatch] = Field(default_factory=list)
    #: Embedded documents the query could have matched. `None` when the count
    #: could not be taken — "1 of 1" and "1 of 400" are different answers, and
    #: an unknown denominator must not render as zero.
    corpus_size: int | None = None


class ResearchRagAnomalyMatch(BaseModel):
    title: str
    kind: str
    similarity: float
    occurred_at: datetime


class ResearchRagStatus(BaseModel):
    """Counters and the cached anomaly retrieval — no URL, no key, no raw error."""

    configured: bool
    running: bool
    queued: int
    indexed: int
    pending_embeddings: int
    failed: int
    dropped: int
    last_anomaly_at: datetime | None = None
    last_anomaly_matches: list[ResearchRagAnomalyMatch] = Field(default_factory=list)
