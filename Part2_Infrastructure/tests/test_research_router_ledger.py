"""The execution half of the router: what each arm did, and the row that says so.

Split from `test_research_router.py` on the 400-line ceiling. The line it was
split along is a real one: that file is about the PLAN — bounded, validated,
recorded, never unanswered — and this one is about what happens once a plan is
run. The audit tests here use a real ``AuditLog`` for the reason that file
records at length: a fake recorder taking ``**kwargs`` accepted an argument the
production object rejects, and "every call reaches the ledger" was a property of
the fake.

What is pinned here is replay. A ``research_tool_call`` row used to record
tool/reason/state/rows/detail, none of which is what the call actually DID:
`lexical_exact` re-queries with the bare token rather than with `call.query`,
the width and the kind filter decide what came back, a traversal is entirely
determined by its seed document, no row carried a latency, and nothing tied the
five rows of one request to each other. Each of those is a test below, because
each of them fails separately.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from modules import research_router_exec
from modules.audit import AuditLog
from modules.research_router import (
    TOOL_GRAPH,
    TOOL_HYBRID,
    TOOL_LEXICAL,
    TOOL_RUNS,
    ResearchRouter,
)


@pytest.fixture
def audit(tmp_path):
    """The real ledger, on a throwaway file."""
    log = AuditLog(tmp_path / "router-ledger.duckdb")
    yield log
    log.close()


def rows(audit, event):
    import json

    return [
        {**row, "payload": json.loads(row["payload"])}
        for row in audit.query(
            "SELECT event, actor, detail, payload FROM risk_events WHERE event = ? ORDER BY ts",
            (event,),
        )
    ]


# -- execution: the ledger a session replays from --------------------------- #
class _Corpus:
    """The wire, and nothing else.

    A stand-in for `ResearchRag`'s two async methods rather than for a module:
    the real one is an httpx client against Supabase and the suite is offline.
    Everything under test — the plan, the ordering, the merge, the rows written
    to the ledger — is the production code path.
    """

    def __init__(self, matches=None, connected=None, state="ok"):
        self.matches = matches if matches is not None else [
            {"id": "doc-1", "source_ref": "run:1", "title": "a sweep"},
            {"id": "doc-2", "source_ref": "run:2", "title": "another sweep"},
        ]
        self.neighbours = connected if connected is not None else [{"id": "doc-9"}]
        self.state = state
        self.searched: list[tuple[str, int, str | None]] = []
        self.walked: list[str] = []
        self.search_scopes: list[str | None] = []
        self.graph_scopes: list[str | None] = []

    async def search(self, text, match_count=3, kind=None, desk_id=None):
        self.searched.append((text, match_count, kind))
        self.search_scopes.append(desk_id)
        if self.state != "ok":
            return {"state": self.state, "matches": []}
        return {"state": "ok", "matches": list(self.matches), "corpus_size": 412}

    async def connected(self, document_id, match_count=10, desk_id=None):
        self.walked.append(document_id)
        self.graph_scopes.append(desk_id)
        return {"state": "ok", "connected": list(self.neighbours)}


def payloads(audit, event):
    return [row["payload"] for row in rows(audit, event)]


async def test_every_row_of_one_request_carries_one_correlation_id(audit):
    router = ResearchRouter(audit=audit)
    plan = router.plan("why did BTCUSDT fail after 9f9602c7")
    await router.execute(plan, _Corpus())
    router.record_generation(plan.calls[0].query, {"model_called": True, "generated": True})

    written = payloads(audit, "research_plan") + payloads(audit, "research_tool_call") \
        + payloads(audit, "research_generation")
    ids = {p["correlation_id"] for p in written}
    assert len(written) >= 4
    assert ids == {plan.correlation_id}, (
        "rows a reader cannot tie together are rows that cannot replay one session"
    )
    assert plan.correlation_id.startswith("rq_")

    second = ResearchRouter(audit=audit).plan("a different question entirely")
    assert second.correlation_id != plan.correlation_id


async def test_the_ledger_records_the_text_that_was_actually_sent(audit):
    # `lexical_exact` re-queries with the BARE token, which is not `call.query`.
    # A reader replaying "lexical_exact on 'what else ran on 9f9602c7'" would be
    # replaying a query that was never made.
    router = ResearchRouter(audit=audit)
    corpus = _Corpus()
    query = "what else ran on 9f9602c7"
    execution = await router.execute(router.plan(query), corpus, match_count=7, kind="backtest")

    by_tool = {p["tool"]: p for p in payloads(audit, "research_tool_call")}
    assert by_tool[TOOL_LEXICAL]["text"] == "9f9602c7"
    assert by_tool[TOOL_HYBRID]["text"] == query
    assert by_tool[TOOL_LEXICAL]["match_count"] == 7
    assert by_tool[TOOL_HYBRID]["kind"] == "backtest"
    assert by_tool[TOOL_LEXICAL]["kind"] is None, (
        "the exact-token arm is deliberately unfiltered, and the row says so"
    )
    assert corpus.searched[0][0] == "9f9602c7"
    assert execution.correlation_id


async def test_the_graph_row_records_the_document_it_walked_from(audit):
    router = ResearchRouter(audit=audit)
    corpus = _Corpus()
    await router.execute(router.plan("what happened after the 9f9602c7 promotion"), corpus)
    graph = {p["tool"]: p for p in payloads(audit, "research_tool_call")}[TOOL_GRAPH]
    assert graph["seed"] == corpus.walked[0] == "doc-1", (
        "a traversal is entirely determined by its seed; without it the row is unreplayable"
    )


async def test_one_scope_reaches_search_and_graph_arms(audit):
    corpus = _Corpus()
    router = ResearchRouter(audit=audit)

    await router.execute(
        router.plan("what happened after the 9f9602c7 promotion"),
        corpus, desk_id="desk-7",
    )

    assert corpus.search_scopes and set(corpus.search_scopes) == {"desk-7"}
    assert corpus.graph_scopes == ["desk-7"]


async def test_every_call_is_timed(audit):
    router = ResearchRouter(audit=audit)
    await router.execute(router.plan("what else ran on 9f9602c7"), _Corpus())
    latencies = [p["latency_ms"] for p in payloads(audit, "research_tool_call")]
    assert latencies and all(isinstance(v, float) and v >= 0.0 for v in latencies), (
        "the research plane reports no stage timings anywhere; this is where they belong"
    )


async def test_a_skipped_call_records_no_width_rather_than_a_zero(audit):
    # Nothing was sent, so there is no width to report. Zero would read as a
    # request for no rows, which is a measurement nobody took.
    router = ResearchRouter(audit=audit)
    await router.execute(router.plan("what happened after the promotion"), _Corpus(matches=[]))
    graph = {p["tool"]: p for p in payloads(audit, "research_tool_call")}[TOOL_GRAPH]
    assert graph["state"] == "skipped"
    assert graph["seed"] is None and graph["match_count"] is None


# -- the structured arm, wired ---------------------------------------------- #
async def test_the_structured_arm_answers_from_the_ledger_it_is_given(audit):
    # The router hands the audit log to the structured arm as its store, so the
    # tool the planner has always routed counts to now has an executor. Seeded
    # through the store's own primitive; see tests/test_research_structured.py.
    for job in ("j1", "j2"):
        audit._exec(
            "INSERT INTO backtest_runs (ts, job_id, symbol, interval, strategy) "
            "VALUES (?,?,?,?,?)",
            (datetime(2026, 8, 22, tzinfo=UTC), job, "BTCUSDT", "1h", "ma_crossover"),
        )
    router = ResearchRouter(audit=audit)
    execution = await router.execute(router.plan("how many BTCUSDT runs are recorded"), _Corpus())

    call = {c.tool: c for c in execution.calls}[TOOL_RUNS]
    assert call.state == "ok", "the planner's counting tool must no longer be unsupported"
    assert "2 of 2" in call.detail
    assert execution.structured and execution.structured[0]["kind"] == "structured_runs"
    recorded = {p["tool"]: p for p in payloads(audit, "research_tool_call")}[TOOL_RUNS]
    assert recorded["state"] == "ok" and "SELECT" in recorded["text"]


async def test_a_structured_arm_with_no_store_is_unavailable_not_zero():
    router = ResearchRouter()  # no audit log at all
    execution = await router.execute(router.plan("how many runs are recorded"), _Corpus())
    call = {c.tool: c for c in execution.calls}[TOOL_RUNS]
    assert call.state == "unavailable" and call.rows == 0
    assert execution.state == "ok", "one arm that could not run must not fail the query"


# -- the graph arm is fused, not appended ----------------------------------- #
async def test_the_graph_arm_is_fused_into_the_ranking_or_names_why_not(audit):
    router = ResearchRouter(audit=audit)
    corpus = _Corpus()
    execution = await router.execute(router.plan("what happened after the 9f9602c7 promotion"), corpus)

    assert execution.connected, "the neighbours are still returned to the caller"
    assert execution.fusion is not None, "a graph walk that ran must say what fusion did"
    if execution.fusion.get("state") in {"unavailable", "failed"}:
        # `fuse_graph_matches` is the graph plane's primitive and lands in their
        # module; until it does, the arm reports a NAMED state rather than
        # crashing or silently going back to appending.
        assert "fuse_graph_matches" in execution.fusion["reason"]
        assert execution.matches, "the retrieved rows survive a fusion that could not run"
    else:
        assert len(execution.matches) >= 2
    graph = {c.tool: c for c in execution.calls}[TOOL_GRAPH]
    assert graph.detail.startswith("graph fusion")


def test_the_fusion_is_the_graph_planes_own_primitive_rather_than_a_second_one():
    # Called, not reimplemented. Two fusion rules over one corpus drift, and
    # both look right while they disagree.
    source = Path(research_router_exec.__file__).read_text()
    assert "from modules.research_rag.retrieval import fuse_graph_matches" in source
    assert "fuse_graph_matches(execution.matches, neighbours)" in source


async def test_a_caller_may_pin_the_correlation_id_before_the_router_exists(audit):
    """`research_quota_gate.correlated_router` mints the id and passes it in.

    It has to: the id is reported to the caller and written to three kinds of
    row at three points of one request, so it must exist before the first of
    them. That module currently catches `TypeError` from this constructor as a
    rollout path and then reports NO id at all — this is the argument that makes
    the rollout path dead code rather than the live one.

    The pinned id also spans the corrective path's second plan, which is the
    same question retried; a per-plan id would split one request in two.
    """
    router = ResearchRouter(audit=audit, correlation_id="minted-by-the-caller")
    first = router.plan("what else ran on 9f9602c7")
    second = router.plan("what else ran on 9f9602c7 BTCUSDT")
    await router.execute(first, _Corpus())
    router.record_generation("q", {"model_called": True})

    assert router.correlation_id == "minted-by-the-caller"
    assert first.correlation_id == second.correlation_id == "minted-by-the-caller"
    written = payloads(audit, "research_plan") + payloads(audit, "research_tool_call") \
        + payloads(audit, "research_generation")
    assert {p["correlation_id"] for p in written} == {"minted-by-the-caller"}
