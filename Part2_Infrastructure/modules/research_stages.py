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
measured at 197 ms for twenty pairs of short rows and 1,523 ms for twenty at
the truncation ceiling `research_rerank.MAX_DOCUMENT_CHARS` permits, by
`tools/bench_rerank.py` against the real weights — and was left synchronous on
purpose, so that the choice of executor belongs to whoever knows what else the
loop is carrying. This loop is carrying the pre-trade risk checks, whose budget
is MICROSECONDS: one inline re-rank is four to five orders of magnitude of that
budget, spent on a research query, while an order waits. So every call goes through
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

Two widths, not one, and `graph_width` is the second. The router applies a
single `match_count` to every tool in a plan, so widening for the cross-encoder
also widened `graph_traverse` — neighbours nothing narrows, on a deployment
whose whole justification for the wide net is that something does. `wide` is
for the arm the cross-encoder reads; `graph_width` is for the arm it never
sees, and `with_graph_width` is how the second reaches the corpus without
teaching every planner about a count only one tool uses.

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
import logging
import os
from typing import Any

from modules import research_rerank

log = logging.getLogger("alphaengine.research_stages")

#: How many re-ranks may run at once. ONE — it was two, and the premise that
#: made it two has been measured and did not hold.
#:
#: The REASON is unchanged and is the reason for the change: this process owns
#: the pre-trade risk checks, research may wait and risk may not. What moved is
#: the arithmetic under it. The old note read "N concurrent research queries pin
#: N of its workers for 30-80 ms each of solid CPU. Two here and two there is at
#: most four occupied workers, which the default pool absorbs." Both halves of
#: that are wrong against the real model.
#:
#: MEASURED by `tools/bench_rerank.py` — BAAI/bge-reranker-base through
#: fastembed 0.7.4 / onnxruntime 1.29.0, 18-core arm64, median of seven runs,
#: twenty pairs, weights seeded on disk:
#:
#:     short rows (~200 chars)          197 ms wall     1,776 ms CPU
#:     at MAX_DOCUMENT_CHARS (2,000)  1,523 ms wall    12,573 ms CPU
#:
#: The first correction is the smaller one: it is not 30-80 ms, it is a fifth
#: of a second at best and a second and a half at the length this module's own
#: widening lets through.
#:
#: The second correction is the one that decides the number. An executor WORKER
#: was never the scarce resource. `asyncio.to_thread` occupies exactly one
#: thread; onnxruntime's intra-op pool then spreads that single re-rank across
#: ~9 of this box's 18 cores — the CPU column above divided by the wall column.
#: Counting workers, this semaphore was bounding the wrong thing, and "four
#: occupied workers, which the default pool absorbs" was true and irrelevant.
#:
#: So a second simultaneous re-rank does not buy a second box's worth of work,
#: and that is measurable rather than arguable. Two at once took 307 ms against
#: 199 ms for one on short rows, and 2,122 ms against 1,456 ms at the ceiling:
#: 1.30-1.37x the throughput, bought with 1.46-1.54x the latency on EVERY
#: request and double the CPU claim against the plane that may not wait. Four
#: at once reached only 1.52x. On the deployment container — a handful of vCPUs,
#: not eighteen — one re-rank is already the whole box, and the second slot buys
#: nothing whatsoever while still doubling the queue in front of the risk path.
#:
#: One admits the same work at roughly three quarters of the throughput and
#: leaves half this box, and effectively all of a small one, to the risk checks.
#: Research may wait. That was always the premise; this is the first version of
#: this number that acts on it rather than asserting it.
#:
#: A `wait_for` timeout was the rejected second half of that pattern and stays
#: rejected, unchanged. `to_thread` cannot cancel the thread, so a timeout would
#: release the waiting request while the CPU carried on burning — and it would
#: have to invent a sixth state for a report vocabulary `research_rerank`
#: defines and this module does not own. The bulkhead bounds the cost; a timeout
#: would only hide it. The measurement makes that worse, not better: a timeout
#: at 1.5 s would abandon a request that still owns nine cores.
#:
#: The lever this measurement actually points at is not here at all. It is
#: `TextCrossEncoder(threads=...)` — bounding onnxruntime's own pool instead of
#: the queue in front of it. On an idle box at the truncation ceiling,
#: `threads=4` finished in 1,532 ms against the default pool's 1,532 ms, for
#: 6,015 ms of CPU against 13,412: half the CPU for no wall-clock cost, the best
#: figure the bench produced. It is deliberately NOT taken here. The right value
#: is a function of the core count of the box that runs it, it has been measured
#: on exactly one machine, a hardcoded 4 shipped to a 2-vCPU container
#: over-subscribes it, and the same sweep on a BUSY box read 2,283 ms — which is
#: precisely why `tools/bench_rerank.py --threads` exists and why this is owed
#: on the deployment box rather than guessed here.
_RERANK_BULKHEAD = asyncio.Semaphore(1)


def _bounded_int_env(name: str, default: int, *, low: int, high: int) -> int:
    """One integer off the environment, bounded, or the default. Never raises.

    A module constant read from ``os.environ`` rather than a ``Settings``
    field, because ``config.py`` is over the file-length ceiling and may not
    take new settings; the shape is the one ``modules/decision_core.py`` uses
    for ``DECISION_CORE``. Unparseable and out-of-range both fall back to the
    default and SAY SO rather than clamping: an operator who typed
    ``RESEARCH_WIDEN_FACTOR=0`` meant something, and quietly running at 1 would
    hide the typo behind a number that looks deliberate.
    """
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("research stages: %s=%r is not an integer; using %d", name, raw, default)
        return default
    if not low <= value <= high:
        log.warning(
            "research stages: %s=%d is outside %d-%d; using %d", name, value, low, high, default,
        )
        return default
    return value


#: How much wider than the CALLER'S OWN ``match_count`` the net is cast when a
#: cross-encoder is there to narrow it again.
#:
#: A multiple rather than a flat number, and that is a defect closed rather
#: than a refinement. `wide` used to return `research_rerank.RERANK_CANDIDATES`
#: outright, so a request that already asked for twenty documents widened to
#: twenty and narrowed to twenty — the cross-encoder re-ordering exactly the
#: rows it was then going to keep, while every document describing this stage
#: said "retrieve twenty, keep three". Four is the smallest multiple that holds
#: the property the stage exists for at EVERY request size: strictly more
#: candidates scored than kept, so the model always has something to promote.
WIDEN_FACTOR = _bounded_int_env("RESEARCH_WIDEN_FACTOR", 4, low=2, high=10)

#: The ceiling on that multiple. Sixty is three times the twenty
#: `research_rerank`'s measured table is taken at, and it is the most this seam
#: will put on a request path that shares a process with the pre-trade risk
#: checks.
#:
#: What that ceiling costs is now measured rather than implied, and it is not
#: cheap: sixty pairs took 713 ms on short rows and 4,153 ms — with 31,267 ms of
#: CPU — at `MAX_DOCUMENT_CHARS`. Kept at sixty anyway, and the reason is who
#: pays. The ceiling is reachable only by a caller that explicitly asks for
#: `match_count >= 15`; the desk's default 3 widens to the `RERANK_CANDIDATES`
#: floor of 20 and stops there. So this bounds a deliberate request rather than
#: naming a bill the desk pays per query, and `RESEARCH_MAX_CANDIDATES` is how a
#: smaller box lowers it once `tools/bench_rerank.py` has said what it costs
#: there. Bounded rather than unbounded because `match_count` arrives on an HTTP
#: request: without a ceiling a caller asking for two hundred documents buys
#: eight hundred cross-encoder pairs, and `_RERANK_BULKHEAD` bounds CONCURRENCY,
#: not batch size.
MAX_CANDIDATES = _bounded_int_env(
    "RESEARCH_MAX_CANDIDATES", 60, low=research_rerank.RERANK_CANDIDATES, high=200,
)


def wide(match_count: int) -> int:
    """How many candidates retrieval should fetch for this request.

    A genuine multiple of what the caller asked for when a cross-encoder is
    configured to narrow them again — floored at `RERANK_CANDIDATES`, the width
    the measured latency table was taken at, and ceilinged at `MAX_CANDIDATES` —
    and the caller's own `match_count`, untouched, when one is not. An
    unconfigured desk keeps today's number exactly, which is why `configured()`
    exists on `research_rerank` rather than the width being a constant somebody
    flips.

    The floor and the ceiling never invert the request: the result is never
    BELOW `match_count`, or a caller asking for a hundred documents would be
    served sixty and told they were the top hundred.

    Both rounds of the corrective path must ask for the same width: a first
    round of twenty scored by the cross-encoder and a retry of three scored by
    RRF would put `retry_grade.score >= grade.score` between two different
    scales.
    """
    if not research_rerank.configured():
        return match_count
    requested = max(1, int(match_count))
    widened = min(MAX_CANDIDATES, max(research_rerank.RERANK_CANDIDATES, requested * WIDEN_FACTOR))
    return max(requested, widened)


def graph_width(match_count: int) -> int:
    """How many neighbours the GRAPH arm should ask for: what the caller asked.

    The router applies one `match_count` to every tool in a plan, so widening
    for the cross-encoder widened `graph_traverse` too — twenty neighbours on a
    re-ranking deployment, from a list the cross-encoder never sees and nothing
    else narrows. That was written down here as owed rather than done; this is
    the second width it owed.

    Not widened at all, rather than widened less: the graph arm has no
    narrowing stage, so every row it asks for is a row the caller is served.
    The number that belongs there is therefore the caller's own — which is
    exactly what an unconfigured desk already gets, so this moves nothing for
    the default deployment and moves the re-ranking one back onto it.
    """
    return max(1, int(match_count))


class _GraphArm:
    """`rag`, with the graph arm's width pinned, and nothing else changed.

    The width belongs to the CALL, not to the plan: `ResearchRouter.execute`
    takes one count and hands it to every tool, and teaching it a second one
    means teaching every planner, every fake and every caller about a parameter
    only one tool reads. Pinning it on the handle the graph tool reaches
    through is the smaller change and it cannot be forgotten by a new planner:
    whatever the plan asks for, `connected` is served the caller's own width.

    `search` is delegated untouched — it is the arm the cross-encoder narrows,
    so the wide count is correct there — and anything else the handle carries
    passes straight through, because this stands in for a corpus object this
    module does not own.
    """

    __slots__ = ("_rag", "width")

    def __init__(self, rag: Any, width: int) -> None:
        self._rag, self.width = rag, width

    async def search(self, *args: Any, **kwargs: Any) -> Any:
        return await self._rag.search(*args, **kwargs)

    async def connected(self, document_id: str, **kwargs: Any) -> Any:
        # `match_count` is DROPPED rather than defaulted: the router passes the
        # widened count positionally-by-keyword and letting it through would be
        # the defect this class exists to close.
        kwargs.pop("match_count", None)
        return await self._rag.connected(document_id, match_count=self.width, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._rag, name)


def with_graph_width(rag: Any, match_count: int) -> Any:
    """`rag`, with its graph arm pinned to `match_count` when anything widened.

    Returns the handle ITSELF when no re-ranker is configured. Nothing widened
    on that path, so there is nothing to pin back, and an unconfigured desk
    keeps not just the same numbers but the same object — which is the strongest
    form of "this stage is invisible when it is off" available here.
    """
    if not research_rerank.configured():
        return rag
    return _GraphArm(rag, graph_width(match_count))


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
