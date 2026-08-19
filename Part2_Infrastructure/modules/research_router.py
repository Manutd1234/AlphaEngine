"""A bounded planner over the research plane's four retrieval tools.

Stated plainly, because it is the honest framing: **this is the piece of the
research plane that fights the rest of it.** Every other module here is
deterministic and replayable. A planner that chooses which tool to call is
neither, and adding one to a codebase whose defining claim is reproducibility
needs limits that are structural rather than advisory.

Four of them, and none is a guideline:

1. **The plan is bounded.** At most ``max_calls`` tool invocations, chosen from
   a closed registry. There is no loop that can decide to keep going.
2. **Every plan and every call is written to the audit log**, so a session
   replays from the ledger like every other decision this desk makes.
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
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

#: The closed set. A planner naming anything else is treated as having failed,
#: which is what makes an unbounded tool surface impossible rather than
#: discouraged.
TOOL_HYBRID = "hybrid_search"
TOOL_GRAPH = "graph_traverse"
TOOL_RUNS = "structured_runs"
TOOL_LEXICAL = "lexical_exact"

TOOLS: frozenset[str] = frozenset({TOOL_HYBRID, TOOL_GRAPH, TOOL_RUNS, TOOL_LEXICAL})

log = logging.getLogger("alphaengine.research.router")

#: Eight hex characters is what this desk's data_hash looks like everywhere it
#: appears, and it is the token a sentence embedder handles worst.
_DATA_HASH = re.compile(r"\b[0-9a-f]{8}\b")
_SYMBOL = re.compile(r"\b[A-Z]{2,10}(?:USDT|USD|PERP)?\b")
_CAUSAL = re.compile(r"\b(after|before|caused|led to|followed|because|why)\b", re.I)
_AGGREGATE = re.compile(r"\b(how many|count|total|best|worst|most|least|since|average)\b", re.I)
#: "moving average", "exponential average", "weighted average" are STRATEGY
#: names, not aggregate questions. Without this, "moving average" routed to the
#: structured-runs tool, which answers counts and extrema and has nothing to say
#: about a crossover rule.
_AVERAGE_IN_A_STRATEGY_NAME = re.compile(
    r"\b(moving|exponential|weighted|simple|triple|double|rolling)\s+average\b", re.I
)


@dataclass(frozen=True, slots=True)
class ToolCall:
    tool: str
    query: str
    reason: str


@dataclass(frozen=True, slots=True)
class Plan:
    calls: tuple[ToolCall, ...]
    planner: str
    #: True when the router fell back rather than using the planner's answer.
    fallback: bool = False
    fallback_reason: str | None = None

    def as_audit(self) -> dict[str, Any]:
        """The row the audit log stores. A plan nobody can replay is a plan
        nobody can review."""
        return {
            "planner": self.planner,
            "fallback": self.fallback,
            "fallback_reason": self.fallback_reason,
            "calls": [{"tool": c.tool, "query": c.query, "reason": c.reason} for c in self.calls],
        }


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
        # corpus could have answered.
        calls.append(ToolCall(TOOL_HYBRID, query, "always: the general retrieval path"))

        # De-duplicate, keep order, then bound.
        seen: set[str] = set()
        unique = [c for c in calls if not (c.tool in seen or seen.add(c.tool))]
        return unique[:max_calls]


class ResearchRouter:
    """Bounds a planner, records it, and falls back when it misbehaves."""

    def __init__(
        self,
        planner: Planner | None = None,
        *,
        max_calls: int = 3,
        audit: Any | None = None,
    ) -> None:
        if max_calls < 1:
            raise ValueError("max_calls must be at least 1")
        self.planner = planner or RuleBasedPlanner()
        self.max_calls = int(max_calls)
        self.audit = audit

    def _fallback(self, query: str, reason: str) -> Plan:
        return Plan(
            calls=(ToolCall(TOOL_HYBRID, query, "fallback: plain hybrid search"),),
            planner=getattr(self.planner, "name", "unknown"),
            fallback=True,
            fallback_reason=reason,
        )

    def plan(self, query: str) -> Plan:
        """A validated, bounded, recorded plan. Never raises."""
        planner_name = getattr(self.planner, "name", "unknown")
        try:
            proposed = self.planner.plan(query, self.max_calls)
        except Exception as exc:  # noqa: BLE001 — a planner failure is a fallback, not an outage
            plan = self._fallback(query, f"planner raised {type(exc).__name__}")
            self._record(query, plan)
            return plan

        if not proposed:
            plan = self._fallback(query, "planner returned no calls")
            self._record(query, plan)
            return plan

        unknown = [c.tool for c in proposed if c.tool not in TOOLS]
        if unknown:
            # A planner naming a tool that does not exist is a planner that has
            # stopped being trustworthy for this query. Fall back whole rather
            # than executing the half that happened to be valid.
            plan = self._fallback(query, f"planner named unknown tools: {sorted(set(unknown))}")
            self._record(query, plan)
            return plan

        bounded = tuple(proposed[: self.max_calls])
        plan = Plan(calls=bounded, planner=planner_name)
        self._record(query, plan)
        return plan

    def _record(self, query: str, plan: Plan) -> None:
        """Write the plan to the audit log. Never fails the query."""
        if self.audit is None:
            return
        try:
            self.audit.record_risk_event(
                kind="research_plan",
                severity="info",
                detail=query[:200],
                payload=plan.as_audit(),
            )
        except Exception as exc:  # noqa: BLE001 — a ledger that is down must not stop a read
            # Logged, not swallowed. A plan that failed to record is a plan
            # that cannot be replayed, which is worth knowing even though it is
            # not worth failing a read over.
            log.warning("research plan not recorded (%s)", type(exc).__name__)
