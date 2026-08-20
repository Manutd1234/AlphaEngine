"""Module C: retrieval over the desk's own research, backtests, and the OpenBB bridge.

``from modules import research`` below is an absolute import and resolves to the
OpenBB bridge at ``modules/research.py`` — a different module from this one,
which is ``modules.api.research``. Python 3 has no implicit relative imports, so
there is no ambiguity to resolve; the note is here for the reader, not for the
interpreter.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from modules import research
from modules.api.deps import trader_identity
from modules.audit import get_audit
from modules.backtester import run_backtest
from modules.jobs import get_queue
from modules.research_crag import ResearchAnswer, answer_from_corpus
from modules.research_rag import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, get_rag
from modules.schemas import (
    BacktestRequest,
    ResearchGraphResponse,
    ResearchRagEmbedRequest,
    ResearchRagEmbedResponse,
    ResearchRagSearchRequest,
    ResearchRagSearchResponse,
    ResearchRagStatus,
)

router = APIRouter(tags=["C · Research"])


@router.post("/api/research/rag/search")
async def research_rag_search(req: ResearchRagSearchRequest, _actor: str = Depends(trader_identity)) -> ResearchRagSearchResponse:
    """Similarity search over the desk's own backtests, summaries and incidents.

    Returns `state: unavailable` when Supabase is not configured — deliberately
    not an empty list, which would mean "searched, found nothing".
    """
    result = await get_rag().search(req.query, match_count=req.match_count, kind=req.kind)
    return ResearchRagSearchResponse(**result)


@router.post("/api/research/rag/ask", response_model=ResearchAnswer)
async def research_rag_ask(req: ResearchRagSearchRequest, _actor: str = Depends(trader_identity)) -> ResearchAnswer:
    """Corrective retrieval: the same corpus, graded before it is offered as an answer.

    `/api/research/rag/search` returns what the index ranked closest, ungraded.
    This routes the query through a bounded plan (both the plan and every tool
    call land in the audit log), grades what came back, rewrites a mid-band
    query ONCE from the corpus's own vocabulary and re-queries, and refuses
    below the relevance floor with the reason and the number of documents
    searched. `refused` is a state of its own: it is not `ok` with no matches
    ("searched, found nothing") and not `unavailable` ("could not search").
    """
    return await answer_from_corpus(get_rag(), req.query, match_count=req.match_count, kind=req.kind, audit=get_audit())


@router.post("/api/research/rag/embed")
async def research_rag_embed(req: ResearchRagEmbedRequest, _actor: str = Depends(trader_identity)) -> ResearchRagEmbedResponse:
    """Embed text with the same model that embedded the corpus.

    Exists so the Oracle vector-search route can embed a query without becoming
    a second embedding vendor. Vectors are comparable only within one model, so
    a query embedded by anything other than the `gte-small` session in
    `supabase/functions/embed-research` would return confident, meaningless
    neighbours — a failure indistinguishable from success.

    `state: unavailable` rather than an error when the index is not configured
    or the service did not answer, matching the search route: "not configured"
    and "found nothing" are different facts and neither is an exception.
    """
    rag = get_rag()
    vectors = await rag.embed_many(req.texts)
    if vectors is None:
        return ResearchRagEmbedResponse(state="unavailable")
    return ResearchRagEmbedResponse(
        state="ok",
        embeddings=vectors,
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIMENSIONS,
    )


@router.get("/api/research/graph/{document_id}", response_model=ResearchGraphResponse)
async def research_graph(
    document_id: str,
    max_depth: int = Query(default=2, ge=1, le=4),
    limit: int = Query(default=10, ge=1, le=50),
    _actor: str = Depends(trader_identity),
) -> ResearchGraphResponse:
    """What is CONNECTED to one research document — the question similarity cannot answer.

    `/api/research/rag/search` finds what a document resembles. This walks
    research_edges instead: every run that saw the same bars, the incident that
    followed a promotion, the regime a parameter set was fitted in. Those are
    relations between documents, and a fused similarity ranking has no way to
    express one — the two documents at either end of the most useful edge here
    typically read nothing alike.

    Depth is capped at 4 by the SQL function regardless of what is asked for,
    and every row carries the relation and the evidence that reached it.
    """
    result = await get_rag().connected(document_id, max_depth=max_depth, match_count=limit)
    return ResearchGraphResponse(**result)


@router.get("/api/research/rag/status")
async def research_rag_status(_actor: str = Depends(trader_identity)) -> ResearchRagStatus:
    """Index counters plus the cached matches from the last execution anomaly."""
    return ResearchRagStatus(**get_rag().status())


@router.post("/api/backtest")
async def submit_backtest(req: BacktestRequest, actor: str = Depends(trader_identity)) -> dict[str, Any]:
    record = get_queue().submit(
        "backtest", run_backtest, req.model_dump(),
        meta={"chat_id": req.notify_chat_id, "symbol": req.symbol, "actor": actor},
    )
    return {"job_id": record.job_id, "status": record.status, "backend": record.backend,
            "poll": f"/api/jobs/{record.job_id}"}


@router.get("/api/jobs")
async def list_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    queue = get_queue()
    return {"stats": queue.stats(), "jobs": [j.to_status().model_dump(mode="json") for j in queue.list(limit)]}


@router.get("/api/jobs/{job_id}")
async def job_status(job_id: str, _actor: str = Depends(trader_identity)) -> dict[str, Any]:
    record = get_queue().get(job_id)
    if not record:
        raise HTTPException(404, f"unknown job {job_id}")
    out = record.to_status().model_dump(mode="json")
    if record.status == "succeeded":
        out["result"] = record.result
    return out


# --------------------------------------------------------------------------- #
# OpenBB research bridge
#
# OpenBB is a Python library, not a hosted API, so this gateway is where it
# runs; the Vercel portal's `openbb` provider adapter is a client of these
# routes. Failures return {"ok": false} with HTTP 200 on purpose: a missing
# downstream key inside OpenBB is a routing signal for the portal's registry,
# not a gateway error its circuit breaker should count against this process.
# --------------------------------------------------------------------------- #
@router.get("/api/research/openbb/health")
async def openbb_health(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    return await research.openbb_status_async()


@router.get("/api/research/openbb/quote")
async def openbb_quote(
    symbol: str = Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    asset: str = Query(default="equity", pattern=r"^(equity|crypto)$"),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    return await research.quote(symbol.upper(), asset)


@router.get("/api/research/openbb/bars")
async def openbb_bars(
    symbol: str = Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    asset: str = Query(default="equity", pattern=r"^(equity|crypto)$"),
    interval: str = Query(default="1d", pattern=r"^(15m|1h|4h|1d)$"),
    limit: int = Query(default=500, ge=10, le=5000),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    return await research.bars(symbol.upper(), asset, interval, limit)


@router.get("/api/research/openbb/news")
async def openbb_news(
    symbols: str = Query(default="", max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    parsed = [s.strip().upper() for s in symbols.split(",") if s.strip()][:6]
    return await research.news(parsed, limit)


@router.get("/api/research/openbb/fundamentals")
async def openbb_fundamentals(
    symbol: str = Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    return await research.fundamentals(symbol.upper())
