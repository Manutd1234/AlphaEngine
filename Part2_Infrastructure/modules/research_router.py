"""A bounded planner over the research plane's four retrieval tools.

Stated plainly, because it is the honest framing: **this is the piece of the
research plane that fights the rest of it.** Every other module here is
deterministic and replayable. A planner that chooses which tool to call is
neither, and adding one to a codebase whose defining claim is reproducibility
needs limits that are structural rather than advisory.

Four of them, and none is a guideline:

1. **The plan is bounded.** At most ``max_calls`` tool invocations, chosen from
   a closed registry. There is no loop that can decide to keep going. The bound
   drops SPECULATIVE calls and never the guaranteed one — see
   `research_router_calls.bound_calls`, which carries the query that proved a
   plain ``[:max_calls]`` was deleting the fallback it promised.
2. **Every plan and every call is written to the audit log**, so a session
   replays from the ledger like every other decision this desk makes. The
   router both plans and EXECUTES, because a plan nothing runs is decoration
   and a call nobody recorded is not replayable: `plan` writes the
   ``research_plan`` row, `execute` writes one ``research_tool_call`` row per
   invocation with what it returned. Every row of one request carries the same
   ``correlation_id``, generated here — see `_write`.
3. **There is always a deterministic fallback.** When the planner is
   unavailable, over budget, or returns something the registry does not
   contain, the query runs plain hybrid search — which is today's behaviour and
   always works.
4. **Routing never invents an answer.** The planner picks tools; the tools
   return rows; CRAG grades them. A refusal downstream is still a refusal.

The default planner is a rule set, not a model
----------------------------------------------

`RuleBasedPlanner` reads the query for the desk's own vocabulary — a symbol, a
data hash, a job id, words like "why" or "after" — and picks tools accordingly.
It is deterministic, free, and gets the common cases right, which is most of
what routing is for. `Planner` is a protocol so a model-backed one can be
substituted; the limits above are enforced by the router, not by the planner,
so substituting one cannot loosen them.

The shapes (`ToolCall`, `Plan`, `ToolResult`, `Execution`, the tool names) live
in `research_router_calls` and the four arms in `research_router_exec`, on the
400-line ceiling's account. They are re-exported here: every existing import of
``modules.research_router`` still means what it meant.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from modules.research_router_calls import (
    _DATA_HASH,
    TOOL_GRAPH,
    TOOL_HYBRID,
    TOOL_LEXICAL,
    TOOL_RUNS,
    TOOLS,
    Execution,
    Plan,
    ToolCall,
    ToolResult,
    bound_calls,
    exact_token,
    new_correlation_id,
)
from modules.research_router_exec import run_call

log = logging.getLogger("alphaengine.research.router")

#: The shapes moved to `research_router_calls` when this module reached the
#: file-length ceiling, and they are re-exported here rather than repointed at
#: their new home: `modules.research_crag`, the route and four test modules all
#: import them from `modules.research_router`, and a split that renames every
#: caller's import is a split that gets reverted. Declared in `__all__` so the
#: re-export is a statement of intent rather than an import lint happens to keep.
__all__ = [
    "TOOLS",
    "TOOL_GRAPH",
    "TOOL_HYBRID",
    "TOOL_LEXICAL",
    "TOOL_RUNS",
    "Execution",
    "Plan",
    "Planner",
    "ResearchRouter",
    "RuleBasedPlanner",
    "ToolCall",
    "ToolResult",
    "exact_token",
]

_CAUSAL = re.compile(r"\b(after|before|caused|led to|followed|because|why)\b", re.I)
_AGGREGATE = re.compile(r"\b(how many|count|total|best|worst|most|least|since|average)\b", re.I)
#: "moving average", "exponential average", "weighted average" are STRATEGY
#: names, not aggregate questions. Without this, "moving average" routed to the
#: structured-runs tool, which answers counts and extrema and has nothing to say
#: about a crossover rule.
_AVERAGE_IN_A_STRATEGY_NAME = re.compile(
    r"\b(moving|exponential|weighted|simple|triple|double|rolling)\s+average\b", re.I
)

#: The order the planner emits speculative calls in, and therefore the order the
#: bound drops them in — weakest last. It is a ladder of how DIRECTLY each arm
#: answers the question it was chosen for: an exact token either matches or does
#: not, a count is computed from records, and a traversal is the most
#: speculative of the three because it needs a seed document it may not get and
#: can only ever be skipped without one.
_PRIORITY: dict[str, int] = {TOOL_LEXICAL: 0, TOOL_RUNS: 1, TOOL_GRAPH: 2, TOOL_HYBRID: 3}


class Planner(Protocol):
    name: str

    def plan(self, query: str, max_calls: int) -> list[ToolCall]:
        ...


@dataclass
class RuleBasedPlanner:
    """Deterministic routing on the desk's own vocabulary."""

    name: str = "rules"
    known_symbols: frozenset[str] = field(default_factory=frozenset)

    def plan(self, query: str, max_calls: int) -> list[ToolCall]:
        calls: list[ToolCall] = []

        if _DATA_HASH.search(query):
            # The exact token the embedder blurs. Lexical first, then the graph
            # — "which other runs saw these bars" is a relation, not a
            # similarity, and it is usually what the question means.
            calls.append(ToolCall(TOOL_LEXICAL, query, "the query names a data hash"))
            calls.append(ToolCall(TOOL_GRAPH, query, "runs sharing a data hash are an edge, not a neighbour"))

        if _CAUSAL.search(query):
            calls.append(ToolCall(TOOL_GRAPH, query, "the query asks what followed what"))

        aggregate = _AGGREGATE.search(query)
        if aggregate and not (
            aggregate.group(1).lower() == "average" and _AVERAGE_IN_A_STRATEGY_NAME.search(query)
        ):
            calls.append(ToolCall(TOOL_RUNS, query, "the query asks for a count or an extremum"))

        # Hybrid always runs. It is the tool that answers when the others find
        # nothing, and a plan that omits it can return empty for a query the
        # corpus could have answered. `bound_calls` is what makes "always" true
        # under the bound; before it, a query firing three rules lost this call.
        calls.append(ToolCall(TOOL_HYBRID, query, "always: the general retrieval path"))

        # De-duplicate keeping the first sighting, sort onto the priority ladder
        # (stable, so rules that fired for the same tier keep their order), then
        # bound. The sort exists so that the call the bound drops is the least
        # direct one rather than whichever rule happened to fire last.
        seen: set[str] = set()
        unique = [c for c in calls if not (c.tool in seen or seen.add(c.tool))]
        unique.sort(key=lambda c: _PRIORITY.get(c.tool, len(_PRIORITY)))
        return bound_calls(unique, max_calls)


class ResearchRouter:
    """Bounds a planner, records it, and falls back when it misbehaves."""

    def __init__(
        self,
        planner: Planner | None = None,
        *,
        max_calls: int = 3,
        audit: Any | None = None,
        correlation_id: str | None = None,
    ) -> None:
        if max_calls < 1:
            raise ValueError("max_calls must be at least 1")
        self.planner = planner or RuleBasedPlanner()
        self.max_calls = int(max_calls)
        self.audit = audit
        #: The id every row this router writes will carry. It arrives one of two
        #: ways and the difference matters.
        #:
        #: PINNED, when the caller mints one before building the router
        #: (`research_quota_gate.correlated_router` does), the id spans the
        #: whole request — including the corrective path's SECOND plan, which is
        #: the same question being retried and not a second question.
        #:
        #: MINTED HERE otherwise, once per `plan()`, so a router built directly
        #: still writes rows that can be tied together. `record_generation` is
        #: the one row that arrives without a plan in hand and reads this
        #: attribute; with a pinned id that is exact, and with a minted one it is
        #: the most recent plan's, which is correct for the production path
        #: because `answer_from_corpus` builds a router per request.
        self._pinned_correlation_id = correlation_id
        self.correlation_id: str | None = correlation_id

    def _fallback(self, query: str, reason: str, correlation_id: str) -> Plan:
        return Plan(
            calls=(ToolCall(TOOL_HYBRID, query, "fallback: plain hybrid search"),),
            planner=getattr(self.planner, "name", "unknown"),
            fallback=True,
            fallback_reason=reason,
            correlation_id=correlation_id,
        )

    def plan(self, query: str) -> Plan:
        """A validated, bounded, recorded plan. Never raises."""
        planner_name = getattr(self.planner, "name", "unknown")
        self.correlation_id = correlation_id = self._pinned_correlation_id or new_correlation_id()
        try:
            proposed = self.planner.plan(query, self.max_calls)
        except Exception as exc:  # noqa: BLE001 — a planner failure is a fallback, not an outage
            plan = self._fallback(query, f"planner raised {type(exc).__name__}", correlation_id)
            self._record(query, plan)
            return plan

        if not proposed:
            plan = self._fallback(query, "planner returned no calls", correlation_id)
            self._record(query, plan)
            return plan

        unknown = [c.tool for c in proposed if c.tool not in TOOLS]
        if unknown:
            # A planner naming a tool that does not exist is a planner that has
            # stopped being trustworthy for this query. Fall back whole rather
            # than executing the half that happened to be valid.
            plan = self._fallback(
                query, f"planner named unknown tools: {sorted(set(unknown))}", correlation_id
            )
            self._record(query, plan)
            return plan

        bounded = tuple(bound_calls(proposed, self.max_calls))
        plan = Plan(calls=bounded, planner=planner_name, correlation_id=correlation_id)
        self._record(query, plan)
        return plan

    # -- execution --------------------------------------------------------- #
    async def execute(
        self,
        plan: Plan,
        rag: Any,
        *,
        match_count: int = 3,
        kind: str | None = None,
    ) -> Execution:
        """Run a plan against the corpus and record every call. Never raises.

        Graph traversal is moved to the END of the plan regardless of where the
        planner put it. That is a data dependency rather than a preference:
        ``traverse_research_graph`` starts FROM a document, so a graph call that
        ran before any retrieval has no document to start from and could only
        ever be skipped. The planner's ordering still decides how the retrieved
        rows are ranked, which is what it was expressing.

        ``self.audit`` is handed to the structured arm as its store, because the
        ledger this router writes to is the same file ``backtest_runs`` is
        written to. One handle, no new configuration, and a gateway with no
        audit log gets a named ``unavailable`` from that arm rather than a crash.
        """
        execution = Execution(correlation_id=plan.correlation_id)
        ordered = (
            [c for c in plan.calls if c.tool != TOOL_GRAPH]
            + [c for c in plan.calls if c.tool == TOOL_GRAPH]
        )
        states: list[str] = []
        for call in ordered:
            result = await run_call(
                call, rag, execution, match_count=match_count, kind=kind, store=self.audit
            )
            execution.calls.append(result)
            self._write(
                "research_tool_call", call.query, result.as_audit(), plan.correlation_id
            )
            if result.state in {"ok", "empty"}:
                states.append("ok")
            elif result.state not in {"skipped", "unsupported"}:
                states.append(result.state)
        # One tool that answered makes the execution answerable. Only when
        # nothing could run does the reason why survive to the caller — and it
        # survives as itself ("unavailable", "embed_failed"), never as empty.
        execution.state = "ok" if "ok" in states else (states[0] if states else "ok")
        return execution

    # -- the ledger -------------------------------------------------------- #
    def _record(self, query: str, plan: Plan) -> None:
        """Write the plan to the audit log. Never fails the query."""
        self._write("research_plan", query, plan.as_audit(), plan.correlation_id)

    def record_generation(self, query: str, report: dict[str, Any]) -> None:
        """One ledger row per generation call actually SPENT. Never raises.

        Gated on ``model_called``, NEVER on ``generated``: a refusal that fired AFTER the call —
        a fabricated citation, a timeout — spent the same money and is exactly the row an auditor
        goes looking for, so gating on the answer would delete the expensive half of the ledger.
        The report is copied WHOLE rather than key by key, because reading each key with ``.get``
        would write a null token count wherever the SDK reported none, which is spend read as nothing.

        The correlation id comes from ``self`` rather than from an argument, because the seam that
        calls this (`research_stages.synthesise`) is handed the router and not the plan. That is
        correct for the production path, where `answer_from_corpus` builds one router per request;
        a router shared between concurrent requests would stamp the generation row with whichever
        plan was made last, so it is written down here rather than discovered later.
        """
        if report.get("model_called"):
            self._write("research_generation", query, dict(report), self.correlation_id)

    def _write(
        self, event: str, query: str, payload: dict[str, Any], correlation_id: str | None = None
    ) -> None:
        """One row in the ledger, through ``AuditLog``'s ACTUAL signature.

        ``record_risk_event`` takes the event name POSITIONALLY. This method
        passed it as ``kind=``, which no audit log has ever accepted: against
        the real store every write raised ``TypeError`` and was swallowed by
        the except below as a warning. Nothing noticed, because the only caller
        was a test whose fake recorder took ``**kwargs`` — so the fake accepted
        an argument the production object rejects, and "every plan is recorded"
        was true of the fake and false of the desk.

        ``correlation_id`` is stamped FIRST and unconditionally. Before it, the
        five rows one request writes could only be tied together by timestamp
        and by the first 200 characters of the query, which is precisely what
        fails when two desks ask similar questions in the same second — replay
        interleaved their arms and nothing said so.
        """
        if self.audit is None:
            return
        try:
            self.audit.record_risk_event(
                event,
                severity="info",
                actor="research",
                detail=query[:200],
                payload={"correlation_id": correlation_id, **payload},
            )
        except Exception as exc:  # noqa: BLE001 — a ledger that is down must not stop a read
            # Logged, not swallowed. A plan that failed to record is a plan
            # that cannot be replayed, which is worth knowing even though it is
            # not worth failing a read over.
            log.warning("%s not recorded (%s)", event, type(exc).__name__)
