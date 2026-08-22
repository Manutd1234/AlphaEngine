"""The router's limits, tested as limits rather than as behaviour.

A planner that chooses tools is the one non-deterministic thing in the research
plane. What makes it acceptable is not that its choices are good — it is that
its choices cannot escape a bound, cannot go unrecorded, and cannot leave a
query unanswered. These tests are about those three, and they hold for ANY
planner, including one that misbehaves on purpose.

THE AUDIT TESTS USE A REAL ``AuditLog``, and that is the whole point of this
file's second half. They used to use a recorder whose ``record_risk_event``
took ``**kwargs``, so it accepted the ``kind=`` keyword the router was passing
— a keyword ``AuditLog.record_risk_event`` has never had. Against the real
store every write raised ``TypeError``, was caught by the router's
never-fail-a-read handler, and logged a warning nobody was reading. "Every plan
reaches the audit log" was a property of the fake. A stand-in that accepts an
argument the production object rejects is not a test of the production object.
"""

from __future__ import annotations

import pytest

from modules.audit import AuditLog
from modules.research_router import (
    TOOL_GRAPH,
    TOOL_HYBRID,
    TOOL_LEXICAL,
    TOOL_RUNS,
    Plan,
    ResearchRouter,
    RuleBasedPlanner,
    ToolCall,
)

#: The query that proved the bound was dropping the tool the docstring promised
#: always runs. Written once, used by the tests that pin the fix, because the
#: defect is a property of THIS query rather than of queries in general.
TRUNCATION_QUERY = "how many runs since 3f8a9c21"


@pytest.fixture
def audit(tmp_path):
    """The real ledger, on a throwaway file."""
    log = AuditLog(tmp_path / "router.duckdb")
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


class _Greedy:
    name = "greedy"

    def plan(self, query, max_calls):
        return [ToolCall(TOOL_HYBRID, query, "again") for _ in range(50)]


class _Inventive:
    name = "inventive"

    def plan(self, query, max_calls):
        return [ToolCall("shell_exec", query, "trust me")]


class _Broken:
    name = "broken"

    def plan(self, query, max_calls):
        raise RuntimeError("planner died")


class _Silent:
    name = "silent"

    def plan(self, query, max_calls):
        return []


# -- the three limits ------------------------------------------------------ #

def test_a_greedy_planner_is_bounded_rather_than_obeyed():
    plan = ResearchRouter(_Greedy(), max_calls=3).plan("anything")
    assert len(plan.calls) == 3
    assert not plan.fallback, "bounding is not a failure; the plan was valid, just long"


def test_a_planner_naming_a_tool_that_does_not_exist_falls_back_whole():
    # Not "execute the valid half". A planner that has invented a tool has
    # stopped being trustworthy for this query.
    plan = ResearchRouter(_Inventive()).plan("anything")
    assert plan.fallback
    assert [c.tool for c in plan.calls] == [TOOL_HYBRID]
    assert "shell_exec" in plan.fallback_reason


@pytest.mark.parametrize("planner,reason", [(_Broken(), "raised"), (_Silent(), "no calls")])
def test_a_planner_that_fails_still_answers_the_query(planner, reason):
    plan = ResearchRouter(planner).plan("anything")
    assert plan.fallback
    assert reason in plan.fallback_reason
    assert [c.tool for c in plan.calls] == [TOOL_HYBRID], (
        "the fallback is plain hybrid search, which is today's behaviour and always works"
    )


def test_every_plan_reaches_the_audit_log(audit):
    query = "why did BTCUSDT drop after promotion"
    ResearchRouter(RuleBasedPlanner(), audit=audit).plan(query)
    written = rows(audit, "research_plan")
    assert len(written) == 1, "the plan did not reach the ledger the desk actually keeps"
    assert written[0]["detail"] == query, "a plan nobody can tie to a query is not replayable"
    assert [c["tool"] for c in written[0]["payload"]["calls"]]


def test_the_event_name_is_passed_the_way_the_audit_log_takes_it(audit):
    # The regression. ``record_risk_event`` takes the event POSITIONALLY; the
    # router passed ``kind=`` and every write raised TypeError into a warning.
    ResearchRouter(RuleBasedPlanner(), audit=audit).plan("anything")
    assert [r["event"] for r in audit.recent_events(10)] == ["research_plan"]


def test_a_fallback_is_recorded_with_its_reason(audit):
    ResearchRouter(_Broken(), audit=audit).plan("anything")
    payload = rows(audit, "research_plan")[0]["payload"]
    assert payload["fallback"] is True
    assert "raised" in payload["fallback_reason"]


def test_an_audit_log_that_is_down_does_not_fail_the_query():
    class _Dead:
        def record_risk_event(self, **kw):
            raise OSError("ledger unreachable")

    plan = ResearchRouter(RuleBasedPlanner(), audit=_Dead()).plan("anything")
    assert plan.calls, "a read must survive a ledger that is down"


def test_max_calls_must_be_at_least_one():
    with pytest.raises(ValueError, match="at least 1"):
        ResearchRouter(max_calls=0)


# -- the default planner's routing ----------------------------------------- #

def test_a_data_hash_routes_to_lexical_first_then_the_graph():
    # Eight hex characters is the token gte-small handles worst, and "which
    # other runs saw these bars" is an edge rather than a neighbour.
    plan = ResearchRouter().plan("what else ran on 9f9602c7")
    tools = [c.tool for c in plan.calls]
    assert tools[0] == TOOL_LEXICAL
    assert TOOL_GRAPH in tools


def test_a_causal_question_routes_to_the_graph():
    plan = ResearchRouter().plan("what happened after the ma_crossover promotion")
    assert TOOL_GRAPH in [c.tool for c in plan.calls]


def test_an_aggregate_question_routes_to_the_structured_runs():
    plan = ResearchRouter().plan("how many sweeps since August")
    assert TOOL_RUNS in [c.tool for c in plan.calls]


def test_a_strategy_named_average_is_not_an_aggregate_question():
    # "moving average" routed to the counts-and-extrema tool, which has nothing
    # to say about a crossover rule. Found by reading the router's own output.
    for query in ("moving average crossover", "triple moving average", "exponential average"):
        tools = [c.tool for c in ResearchRouter().plan(query).calls]
        assert TOOL_RUNS not in tools, query
    assert TOOL_RUNS in [c.tool for c in ResearchRouter().plan("average Sharpe across runs").calls]


def test_hybrid_search_is_always_in_the_plan():
    # It is the tool that answers when the others find nothing. A plan that
    # omits it can return empty for a query the corpus could have answered.
    for query in ("9f9602c7", "why did it fail", "how many runs", "anything at all"):
        assert TOOL_HYBRID in [c.tool for c in ResearchRouter().plan(query).calls], query


def test_the_plan_is_deterministic_for_one_query():
    # The DECISIONS are deterministic; the correlation id is per-request
    # identity and is the one field that must differ, or it is not identifying
    # anything. Compared field by field rather than through `as_audit` for
    # exactly that reason.
    a = ResearchRouter().plan("what else ran on 9f9602c7")
    b = ResearchRouter().plan("what else ran on 9f9602c7")
    assert [(c.tool, c.query, c.reason) for c in a.calls] == [
        (c.tool, c.query, c.reason) for c in b.calls
    ]
    assert (a.planner, a.fallback) == (b.planner, b.fallback)
    assert a.correlation_id != b.correlation_id


def test_the_audit_payload_is_replayable():
    plan = ResearchRouter().plan("why did BTCUSDT fail after 9f9602c7")
    payload = plan.as_audit()
    assert set(payload) == {"correlation_id", "planner", "fallback", "fallback_reason", "calls"}
    assert all(set(c) == {"tool", "query", "reason"} for c in payload["calls"])
    assert isinstance(Plan(calls=(), planner="x").as_audit(), dict)


# -- the bound may not drop the guarantee ----------------------------------- #
#
# Measured on the real planner, not reasoned about: `TRUNCATION_QUERY` fires
# three rules, proposed ['lexical_exact', 'graph_traverse', 'structured_runs',
# 'hybrid_search'], and a plain `[:3]` cut the last one — so the module
# docstring's "Hybrid always runs. It is the tool that answers when the others
# find nothing" was false for precisely the queries with the most ways to come
# back empty, and nothing in the ledger said so.

def test_the_bound_drops_a_speculative_tool_never_the_fallback():
    plan = ResearchRouter(max_calls=3).plan(TRUNCATION_QUERY)
    tools = [c.tool for c in plan.calls]
    assert len(tools) == 3, "the bound still bounds"
    assert TOOL_HYBRID in tools, "the tool that answers when the others find nothing was cut"
    assert TOOL_LEXICAL in tools and TOOL_RUNS in tools, (
        "the two arms that answer this query most directly are the ones kept"
    )
    assert not plan.fallback, "bounding is not a failure; the plan was valid, just long"


def test_the_bound_holds_when_the_planner_itself_puts_the_fallback_last():
    # The planner is not the only place the bound runs: `ResearchRouter.plan`
    # truncates whatever a substituted planner returns, and the guarantee has to
    # survive there too or a model-backed planner reintroduces the defect.
    class _Verbose:
        name = "verbose"

        def plan(self, query, max_calls):
            return [
                ToolCall(TOOL_LEXICAL, query, "first"),
                ToolCall(TOOL_GRAPH, query, "second"),
                ToolCall(TOOL_RUNS, query, "third"),
                ToolCall(TOOL_HYBRID, query, "last, and truncated away before this"),
            ]

    plan = ResearchRouter(_Verbose(), max_calls=3).plan("anything")
    tools = [c.tool for c in plan.calls]
    assert len(tools) == 3 and TOOL_HYBRID in tools


def test_a_bound_of_one_is_the_fallback_alone():
    assert [c.tool for c in ResearchRouter(max_calls=1).plan(TRUNCATION_QUERY).calls] == [
        TOOL_HYBRID
    ]


def test_the_bound_does_not_invent_a_fallback_the_planner_left_out():
    # Removing calls is the bound's job; adding one is not. A planner that
    # deliberately omitted hybrid is making a claim, and overruling it here
    # would hide that claim from the ledger.
    class _NoHybrid:
        name = "no-hybrid"

        def plan(self, query, max_calls):
            return [ToolCall(TOOL_LEXICAL, query, "only this") for _ in range(5)]

    plan = ResearchRouter(_NoHybrid(), max_calls=3).plan("9f9602c7")
    assert [c.tool for c in plan.calls] == [TOOL_LEXICAL] * 3
