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
    #: Where the THIRD arm placed this document, 1-based, or None when Okapi
    #: BM25 did not rank it — never 0, which in a 1-based ranking would read as
    #: "better than first". `research_bm25.fuse` writes this key onto every row
    #: it fuses; without a field for it pydantic drops it on the way out and the
    #: arm looks like it never ran. That is not a hypothetical: it is exactly
    #: how the two ranks above went missing, and the note there is the record.
    bm25_rank: int | None = None
    #: The cross-encoder's relevance score for (query, this document), from
    #: `research_rerank`, which attaches it only to documents it actually
    #: scored. That module OMITS the key rather than writing None, and pydantic
    #: renders the omission as null here — null is still not zero. An unscored
    #: row must never carry 0.0, which reads as "scored, and worst of all".
    #:
    #: This field says what the score WAS, never whose order the list is in:
    #: the fallback returns a perfectly good fused ranking with no scores at
    #: all. `reranked`/`rerank_state` on the response are what answer that, and
    #: "the cross-encoder's pick of twenty" and "RRF's top three" are different
    #: claims about a list that looks identical.
    rerank_score: float | None = None


class ResearchRagSearchResponse(BaseModel):
    """`unavailable` is a state, never an empty match list wearing one's face:
    "searched and found nothing" and "could not search" are different facts."""

    state: Literal["ok", "unavailable", "embed_failed"]
    matches: list[ResearchRagMatch] = Field(default_factory=list)
    #: Embedded documents the query could have matched. `None` when the count
    #: could not be taken — "1 of 1" and "1 of 400" are different answers, and
    #: an unknown denominator must not render as zero.
    corpus_size: int | None = None
    #: WHOSE ORDER `matches` are in. False with a `rerank_state` naming the
    #: reason — "unconfigured", "unavailable", "failed", "empty" — means the
    #: rows are the fused RRF ordering, which is what this desk served before a
    #: cross-encoder existed and is a correct ranking rather than a degradation.
    #:
    #: `rerank_state` None means re-ranking was never REACHED: an unavailable
    #: index or a failed embed has nothing to narrow, which is a different fact
    #: from reaching the stage with no model configured. `ResearchAnswer`
    #: carries the same pair for the same reason.
    reranked: bool = False
    rerank_state: str | None = None
    #: The third lexical arm's own report, in `research_bm25`'s shape, passed
    #: through unaltered. A mapping rather than a sub-model on purpose: a second
    #: definition of a shape that module owns would drift the day it adds a
    #: counter, and a reader holding one report could not tell that drift from a
    #: result — the argument `retrieval._arm_unavailable` already makes.
    #:
    #: Defaulted to None so a response can be built without one; `search` sets
    #: it on EVERY branch, refusals included, so on the wire it is always there.
    bm25: dict[str, Any] | None = None


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
