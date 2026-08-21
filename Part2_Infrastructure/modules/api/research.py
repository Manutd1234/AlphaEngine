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

from modules import research, research_stages
from modules.api.deps import trader_identity
from modules.audit import get_audit
from modules.backtester import run_backtest
from modules.jobs import get_queue
from modules.research_crag import ResearchAnswer, answer_from_corpus
from modules.research_graph_reads import community_report
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

    RETRIEVE WIDE, THEN NARROW — both ends, or neither. `research_stages.wide`
    asks the index for `RERANK_CANDIDATES` when a cross-encoder is configured to
    sort them out again, and for the caller's own `match_count` when one is not.
    Widening without narrowing would buy recall and pay for it in precision on
    the same request, which is the trade `research_rerank` exists to break; the
    two lines belong together and this is the only place they are written.

    `research_stages.narrow` rather than `asyncio.to_thread(rerank, ...)` here,
    and the difference is the bulkhead rather than the call. `rerank` is tens of
    milliseconds of solid CPU and this process also serves the pre-trade risk
    checks — research may wait, risk may not. The stage owns a semaphore of two
    over the shared default executor; a second, unbounded path through the same
    executor would silently double the occupancy that bound was sized for.

    `rerank_state` stays None on any state but `ok`: nothing was retrieved, so
    the stage was never REACHED — a different fact from reaching it with no
    model configured, which reports "unconfigured".
    """
    result = await get_rag().search(
        req.query, match_count=research_stages.wide(req.match_count), kind=req.kind,
    )
    if result["state"] == "ok":
        result["matches"], report = await research_stages.narrow(
            req.query, result["matches"], req.match_count,
        )
        result["reranked"] = report["reranked"]
        result["rerank_state"] = report["state"]
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


# DECLARED BEFORE `/api/research/graph/{document_id}`, and the order is the
# contract rather than a preference: Starlette matches routes in registration
# order, so the parameterised path declared first would swallow "communities" as
# a document id and answer HTTP 200 with a neighbour list. A wrong shape under a
# right status code is the failure this ordering exists to prevent, and moving
# this handler below the next one is all it takes to bring it back.
@router.get("/api/research/graph/communities")
async def research_graph_communities(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    """Louvain over the WHOLE corpus of derived edges, in one sweep.

    The question neither of the other research routes can answer. `rag/search`
    ranks documents against a query and `graph/{document_id}` walks outward from
    one document; this partitions the corpus into the clusters it actually has,
    and a partition is a property of the whole graph rather than of any one
    query — which is why the read behind it refuses to partition a truncated
    page walk instead of partitioning the fragment it got.

    DETECTION ONLY. `research_communities.rank_documents` (PageRank over the
    same edges) is deliberately not called here: it is a second whole-corpus
    computation answering a different question, and the sweep this route calls
    does not hand the edge rows back for one — a whole-corpus edge list is a
    payload, not a report. Centrality is owed its own route, not a passenger
    on this one.

    READ-ONLY, so `project=False` is fixed here rather than exposed as a
    parameter. A GET that wrote community labels into Neo4j would be a GET with
    a side effect, and any crawler, prefetch or retry would repartition the
    desk's graph. The projection sub-report still comes back, saying the caller
    asked for a partition only — a named reason, not a silently missing key.
    Writing labels is `research_reconcile`'s sweep, on its own cadence.

    THE REPORT IS RETURNED UNALTERED, and untyped for that reason. Absence
    carries meaning in it: `detection.modularity` is missing when the graph had
    no tie to measure, and `projection.labelled` is missing when nothing was
    written. A response model would have to declare both optional, which
    MATERIALISES them as null on the wire — and a null measurement in a report
    is the one somebody later reads through `?? 0`. It is already JSON-safe:
    string keys, plain ints and lists, and modularity cast to float so no numpy
    scalar reaches the serialiser.
    """
    return await community_report(project=False)


@router.get("/api/research/graph/centrality")
async def research_graph_centrality(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    """PageRank over the whole corpus: the documents research keeps returning to.

    The debt the communities route wrote down — "centrality is owed its own
    route" — paid. Same literal-before-parameter placement as its sibling, for
    the same reason: declared below the `{document_id}` handler, "centrality"
    would be swallowed as a document id and answered 200 with a neighbour list.

    Untyped like the communities report and for the same argument: absence
    carries meaning (`ranking.scores` is missing when nothing was ranked, and
    `ranking.reason` says whether that is a corpus that could not be read or a
    graph with no edges — different facts a response model would flatten).
    """
    from modules.research_graph_reads import centrality_report

    return await centrality_report()


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
