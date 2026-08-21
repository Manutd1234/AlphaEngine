"""The two optional stages that sit between retrieval and the answer.

`research_crag.answer_from_corpus` was retrieve, grade, rewrite once, answer or
refuse. Two modules were built to sit INSIDE that path — `research_rerank`, a
cross-encoder that re-orders the candidates, and `research_generate`, which
writes a grounded answer over the ones that survive — and both are optional
extras that a normal deployment does not configure at all. This module is the
seam between the corrective path and those two.

It exists for three reasons, and all three are about the CALLER rather than
about the stages themselves.

**The event loop.** `research_rerank.rerank` is synchronous and CPU-bound —
tens of milliseconds for twenty pairs — and was left synchronous on purpose, so
that the choice of executor belongs to whoever knows what else the loop is
carrying. This loop is carrying the pre-trade risk checks, whose budget is
MICROSECONDS: one inline re-rank is three orders of magnitude of that budget,
spent on a research query, while an order waits. So every call goes through
`asyncio.to_thread`, the same bulkhead `modules/research.py::_off_loop` puts
around OpenBB. The rejected alternative was calling `rerank` directly and
"measuring it later": a blocking call on this loop is not a latency regression
that shows up in the research plane's own numbers, it is milliseconds added to
a plane that never reports them.

**The width.** Retrieval is pinned at `match_count=3` because RRF only ever
sees RANK — it cannot promote the one document that answers the question from
eleventh place — so a wider net today adds candidates with nothing to sort them
out again, and recall bought that way is paid for immediately in precision.
`wide` is where that trade is made, and it is made ONLY when a re-ranker is
configured to do the sorting. An unconfigured desk keeps today's number exactly,
which is why `configured()` exists on `research_rerank` rather than the width
being a constant somebody flips.

**The circular import.** `research_generate` reads `ANSWER_BAND` and
`REFUSE_BAND` from `research_crag` deliberately — one definition of the
relevance floor rather than two that can drift apart, and drift in the worst
direction available, with generation refusing at a threshold the grader no
longer uses. That makes a module-level import back from `research_crag`
impossible: whichever module is imported first finds the other half-built and
the `from ... import ANSWER_BAND` raises. `synthesise` defers the import into
the function instead. Restating the two numbers here was the rejected
alternative, and it is precisely the defect the shared constant prevents.

Nothing here decides anything. `narrow` returns the report the caller records,
`wide` returns a number, and `synthesise` returns `research_generate`'s own
report unaltered — including its `verdict`, which the caller must NOT flatten
into CRAG's `state`. "Retrieval was irrelevant" and "a grounding fence stopped
the answer" are different facts and each needs its own field.
"""

from __future__ import annotations

import asyncio
from typing import Any

from modules import research_rerank

#: How many re-ranks may occupy the default executor at once.
#:
#: Two, matching `research._OPENBB_BULKHEAD`, and for its reason: this process
#: owns the pre-trade risk checks, research may wait and risk may not.
#: `asyncio.to_thread` hands work to ONE shared default executor, so with no
#: bound N concurrent research queries pin N of its workers for 30-80 ms each of
#: solid CPU. Two here and two there is at most four occupied workers between
#: the two heavyweight research paths, which the default pool absorbs.
#:
#: A `wait_for` timeout was the rejected second half of that pattern.
#: `to_thread` cannot cancel the thread, so a timeout would release the waiting
#: request while the CPU carried on burning — and it would have to invent a
#: sixth state for a report vocabulary `research_rerank` defines and this module
#: does not own. The bulkhead bounds the cost; a timeout would only hide it.
_RERANK_BULKHEAD = asyncio.Semaphore(2)


def wide(match_count: int) -> int:
    """How many candidates retrieval should fetch for this request.

    `RERANK_CANDIDATES` when a cross-encoder is configured to narrow them again,
    and the caller's own `match_count` when one is not. Both rounds of the
    corrective path must ask for the same width: a first round of twenty scored
    by the cross-encoder and a retry of three scored by RRF would put
    `retry_grade.score >= grade.score` between two different scales.

    One known consequence, written down rather than discovered later: the router
    applies ONE count to every tool in the plan, so on a re-ranking deployment
    `graph_traverse` also asks for twenty neighbours and nothing narrows those —
    they are a different list and the cross-encoder never sees them. It is
    bounded and it is recall, not a wrong answer; the fix is a separate width for
    the graph arm on `ResearchRouter.execute`, which is owed rather than done.
    """
    return research_rerank.RERANK_CANDIDATES if research_rerank.configured() else match_count


async def narrow(
    query: str, matches: list[dict[str, Any]], top_k: int
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Re-rank `matches` off the event loop; return the kept rows and the report.

    `rerank` never raises and never empties the list: with no model configured
    it hands back the fused order truncated to `top_k`, which is what the desk
    serves today. So the rows this returns are always usable and the REPORT is
    the only place the difference is stated — `reranked` and `state`, never the
    list itself.
    """
    async with _RERANK_BULKHEAD:
        report = await asyncio.to_thread(research_rerank.rerank, query, matches, top_k)
    return report["documents"], report


def _mappings(matches: list[Any]) -> list[dict[str, Any]]:
    """The rows as plain mappings, which on the real path they already are.

    `Execution.matches` holds the dicts `rag.search` returned, before pydantic
    ever sees them, so the `model_dump()` the wiring note asked for would raise
    `AttributeError` on every production call. Rows that ARE models are still
    dumped rather than passed through: `ResearchRagMatch` has no `.get`, so
    `generate`'s uncitable precheck would die on `doc.get('id')` instead of
    refusing with a reason, and a fence that raises is a fence that is not there.
    """
    return [m if isinstance(m, dict) else m.model_dump() for m in matches]


async def synthesise(
    query: str, matches: list[Any], score: float | None, router: Any = None
) -> dict[str, Any]:
    """One grounded-answer attempt, and the ledger row it earned.

    `query` must be the question ACTUALLY answered — the rewrite when one was
    used — and `score` the grade of the round that was KEPT, or the answer is
    generated over one query's documents while being judged by another's grade.

    The ledger write lives here rather than at the call site so that "a model
    call happened" and "a row exists" cannot come apart: `research_generate`
    writes nothing itself, by design, so that it stays testable without an audit
    handle, which leaves exactly one place that must not forget. Gating is the
    router's, on `model_called`.
    """
    # Deferred: see the module docstring. `research_generate` imports the
    # relevance bands from `research_crag`, whose `answer_from_corpus` is this
    # function's only caller, so a module-level import here closes the loop.
    from modules import research_generate

    report = await research_generate.generate(query, _mappings(matches), score)
    if router is not None:
        router.record_generation(query, report)
    return report
