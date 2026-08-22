"""What one planned call actually does, timed, with what it did recorded.

``ResearchRouter`` keeps the decisions — plan, bound, fall back, write the
ledger — and this module keeps the four arms. They were one file until the
ledger rows grew the fields a replay needs and the graph arm gained a fusion
step; ``research_router`` is one line under the 400-line ceiling
`tests/test_file_size.py` ratchets, so the arms moved rather than the ceiling.

TIMING LIVES HERE, once, around the dispatch. The research plane reports no
stage timings anywhere on this path — a query that took four seconds and a query
that took forty milliseconds produce identical ledger rows — and this is the
only place that knows where one arm ends and the next begins. It is wall clock
from just before the call to just after it, so it includes the network to
Supabase, which is the number an operator is actually asking about.
"""

from __future__ import annotations

import logging
import time
from dataclasses import replace
from typing import Any

from modules import research_structured
from modules.research_router_calls import (
    TOOL_GRAPH,
    TOOL_HYBRID,
    TOOL_RUNS,
    Execution,
    ToolCall,
    ToolResult,
    exact_token,
)

log = logging.getLogger("alphaengine.research.router")


async def run_call(
    call: ToolCall,
    rag: Any,
    execution: Execution,
    *,
    match_count: int,
    kind: str | None,
    store: Any = None,
) -> ToolResult:
    """Run one planned call and stamp it with how long it took. Never raises."""
    started = time.perf_counter()
    result = await _dispatch(call, rag, execution, match_count=match_count, kind=kind, store=store)
    return replace(result, latency_ms=round((time.perf_counter() - started) * 1000.0, 3))


async def _dispatch(
    call: ToolCall,
    rag: Any,
    execution: Execution,
    *,
    match_count: int,
    kind: str | None,
    store: Any,
) -> ToolResult:
    if call.tool == TOOL_GRAPH:
        return await _walk(call, rag, execution, match_count=match_count)
    if call.tool == TOOL_RUNS:
        return _runs(call, execution, store)
    # The text the arm is really sent, which for `lexical_exact` is the bare
    # identifier and NOT `call.query`. That difference is why the ledger row
    # carries `text`: a reader replaying "lexical_exact on 'how many runs since
    # 3f8a9c21'" would be replaying a query that was never made.
    text = call.query if call.tool == TOOL_HYBRID else exact_token(call.query)
    if not text:
        return ToolResult(
            call.tool, call.reason, "skipped", 0, "the query names no exact token"
        )
    filter_kind = kind if call.tool == TOOL_HYBRID else None
    result = await rag.search(text, match_count=match_count, kind=filter_kind)
    state = str(result.get("state") or "unavailable")
    if state != "ok":
        return ToolResult(
            call.tool, call.reason, state, 0, f"retrieval reported {state}",
            text=text, match_count=match_count, kind=filter_kind,
        )
    rows = merge(execution, result)
    return ToolResult(
        call.tool, call.reason, "ok" if rows else "empty", rows,
        text=text, match_count=match_count, kind=filter_kind,
    )


def _runs(call: ToolCall, execution: Execution, store: Any) -> ToolResult:
    """The structured arm: a count or an extremum over ``backtest_runs``.

    The rows go to ``execution.structured`` rather than to ``matches`` — see the
    note on `Execution` — and the ANSWER goes into the tool call's ``detail``,
    where the existing `ToolCallView` already carries it to the caller. That is
    the whole wiring: no new response field is needed for the number to arrive,
    and the typed rows are there for the panel that wants to render it properly.
    """
    answer = research_structured.answer_structured(call.query, store)
    execution.structured.extend(answer.rows)
    return ToolResult(
        call.tool, call.reason, answer.state, len(answer.rows), answer.detail,
        text=answer.text,
    )


async def _walk(
    call: ToolCall, rag: Any, execution: Execution, *, match_count: int
) -> ToolResult:
    seed = next((m.get("id") for m in execution.matches if m.get("id")), None)
    if not seed:
        return ToolResult(
            call.tool, call.reason, "skipped", 0, "no retrieved document to walk from"
        )
    result = await rag.connected(str(seed), match_count=match_count)
    if result.get("state") != "ok":
        return ToolResult(
            call.tool, call.reason, "unavailable", 0, "the graph could not be walked",
            seed=str(seed), match_count=match_count,
        )
    rows = list(result.get("connected") or [])
    execution.connected.extend(rows)
    fusion = _fuse(execution, rows)
    return ToolResult(
        call.tool, call.reason, "ok" if rows else "empty", len(rows),
        detail=_fusion_detail(fusion),
        seed=str(seed), match_count=match_count,
    )


def _fusion_detail(fusion: dict[str, Any]) -> str:
    """What fusion did, in the field a reader of the ledger already looks at.

    Carried on the row rather than left only in ``execution.fusion`` because the
    two can disagree in the one way that matters: a walk that returned rows and
    a walk whose rows were never ranked in look identical in ``state``/``rows``.
    """
    state = str(fusion.get("state") or "unknown")
    reason = fusion.get("reason")
    return f"graph fusion {state}" + (f": {reason}" if reason else "")


def _fuse(execution: Execution, neighbours: list[dict[str, Any]]) -> dict[str, Any]:
    """Rank the graph arm INTO the ranking instead of appending it beside it.

    Until now the neighbours went to ``execution.connected`` and stopped there:
    a document the graph reached was never a candidate CRAG could grade, so the
    arm could not change an answer, only decorate one. `fuse_graph_matches` is
    the graph plane's own primitive for this and it is CALLED rather than
    reimplemented — a second fusion rule here would drift from theirs, and the
    two would disagree about the same corpus while both looked right.

    Imported inside the function on purpose. `modules/research_rag/retrieval`
    is the corpus client; a module-level import from the router's execution path
    would tie the two together at import time for a feature that may be absent
    on a given deployment, and an absent primitive is reported as a named
    fusion state rather than as a crash — the same contract every other arm has.
    """
    try:
        from modules.research_rag.retrieval import fuse_graph_matches
    except ImportError as exc:
        report = {
            "state": "unavailable",
            "reason": f"fuse_graph_matches could not be imported ({exc})",
            "fused": 0,
        }
    else:
        try:
            fused_rows, fusion_report = fuse_graph_matches(execution.matches, neighbours)
        except Exception as exc:  # noqa: BLE001 — a fusion that failed must not fail the read
            # Logged rather than swallowed. The retrieved rows are still good;
            # what is lost is the graph arm's influence on their ORDER, and a
            # reader must be able to see that it was lost rather than infer it.
            log.warning("graph fusion failed (%s)", type(exc).__name__)
            report = {
                "state": "failed",
                "reason": f"fuse_graph_matches raised {type(exc).__name__}",
                "fused": 0,
            }
        else:
            execution.matches = list(fused_rows)
            report = dict(fusion_report)
    execution.fusion = report
    return report


def merge(execution: Execution, result: dict[str, Any]) -> int:
    """Append this tool's rows, keeping the first sighting of each document."""
    if execution.corpus_size is None:
        execution.corpus_size = result.get("corpus_size")
    seen = {m.get("id") or m.get("source_ref") for m in execution.matches}
    rows = list(result.get("matches") or [])
    for row in rows:
        key = row.get("id") or row.get("source_ref")
        if key in seen:
            continue
        seen.add(key)
        execution.matches.append(row)
    return len(rows)
