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
   replays from the ledger like every other decision this desk makes. The
   router both plans and EXECUTES, because a plan nothing runs is decoration
   and a call nobody recorded is not replayable: `plan` writes the
   ``research_plan`` row, `execute` writes one ``research_tool_call`` row per
   invocation with what it returned.
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


@dataclass(frozen=True, slots=True)
class ToolResult:
    """One executed — or deliberately not executed — tool call.

    ``state`` is the tool's own outcome and is never flattened into a boolean:
    ``ok`` (rows), ``empty`` (ran, returned nothing), ``unavailable`` /
    ``embed_failed`` (could not run), ``skipped`` (the call needed something
    this query did not have), ``unsupported`` (no executor on this gateway).
    The same distinction ``search`` draws between "found nothing" and "could
    not search", one level down.
    """

    tool: str
    reason: str
    state: str
    rows: int
    detail: str | None = None

    def as_audit(self) -> dict[str, Any]:
        return {
            "tool": self.tool, "reason": self.reason, "state": self.state,
            "rows": self.rows, "detail": self.detail,
        }


@dataclass
class Execution:
    """What a plan actually returned, merged in the plan's own order.

    The order matters and is the planner's: a data-hash query runs lexical
    before hybrid, so the exact-token hit is the row CRAG grades as "best".
    """

    state: str = "ok"
    matches: list[dict[str, Any]] = field(default_factory=list)
    connected: list[dict[str, Any]] = field(default_factory=list)
    corpus_size: int | None = None
    calls: list[ToolResult] = field(default_factory=list)


def exact_token(query: str) -> str | None:
    """The one token in a query the embedder handles worst, or None.

    A data hash first, then a ticker. This is what ``lexical_exact`` re-queries
    with: the bare identifier, so the lexical half of the fused index ranks it
    first instead of ranking three documents that discuss identifiers.
    """
    found = _DATA_HASH.search(query)
    if found:
        return found.group(0)
    symbol = _SYMBOL.search(query)
    return symbol.group(0) if symbol else None


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
        """
        execution = Execution()
        ordered = (
            [c for c in plan.calls if c.tool != TOOL_GRAPH]
            + [c for c in plan.calls if c.tool == TOOL_GRAPH]
        )
        states: list[str] = []
        for call in ordered:
            result = await self._execute_one(
                call, rag, execution, match_count=match_count, kind=kind
            )
            execution.calls.append(result)
            self._write("research_tool_call", call.query, result.as_audit())
            if result.state in {"ok", "empty"}:
                states.append("ok")
            elif result.state not in {"skipped", "unsupported"}:
                states.append(result.state)
        # One tool that answered makes the execution answerable. Only when
        # nothing could run does the reason why survive to the caller — and it
        # survives as itself ("unavailable", "embed_failed"), never as empty.
        execution.state = "ok" if "ok" in states else (states[0] if states else "ok")
        return execution

    async def _execute_one(
        self,
        call: ToolCall,
        rag: Any,
        execution: Execution,
        *,
        match_count: int,
        kind: str | None,
    ) -> ToolResult:
        if call.tool == TOOL_GRAPH:
            return await self._walk(call, rag, execution, match_count=match_count)
        if call.tool == TOOL_RUNS:
            # Named rather than hidden. The planner routes counts and extrema
            # here and this gateway has no structured-runs reader, so the call
            # is recorded as unsupported and the plan's always-present hybrid
            # call answers instead — rule 3, working as written.
            return ToolResult(
                call.tool, call.reason, "unsupported", 0,
                "no structured-runs reader on this gateway; hybrid answers instead",
            )
        text = call.query if call.tool == TOOL_HYBRID else exact_token(call.query)
        if not text:
            return ToolResult(
                call.tool, call.reason, "skipped", 0, "the query names no exact token"
            )
        result = await rag.search(
            text,
            match_count=match_count,
            kind=kind if call.tool == TOOL_HYBRID else None,
        )
        state = str(result.get("state") or "unavailable")
        if state != "ok":
            return ToolResult(call.tool, call.reason, state, 0, f"retrieval reported {state}")
        rows = self._merge(execution, result)
        return ToolResult(call.tool, call.reason, "ok" if rows else "empty", rows)

    async def _walk(
        self, call: ToolCall, rag: Any, execution: Execution, *, match_count: int
    ) -> ToolResult:
        seed = next((m.get("id") for m in execution.matches if m.get("id")), None)
        if not seed:
            return ToolResult(
                call.tool, call.reason, "skipped", 0, "no retrieved document to walk from"
            )
        result = await rag.connected(str(seed), match_count=match_count)
        if result.get("state") != "ok":
            return ToolResult(
                call.tool, call.reason, "unavailable", 0, "the graph could not be walked"
            )
        rows = list(result.get("connected") or [])
        execution.connected.extend(rows)
        return ToolResult(call.tool, call.reason, "ok" if rows else "empty", len(rows))

    @staticmethod
    def _merge(execution: Execution, result: dict[str, Any]) -> int:
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

    # -- the ledger -------------------------------------------------------- #
    def _record(self, query: str, plan: Plan) -> None:
        """Write the plan to the audit log. Never fails the query."""
        self._write("research_plan", query, plan.as_audit())

    def record_generation(self, query: str, report: dict[str, Any]) -> None:
        """One ledger row per generation call actually SPENT. Never raises.

        Gated on ``model_called``, NEVER on ``generated``: a refusal that fired AFTER the call —
        a fabricated citation, a timeout — spent the same money and is exactly the row an auditor
        goes looking for, so gating on the answer would delete the expensive half of the ledger.
        The report is copied WHOLE rather than key by key, because reading each key with ``.get``
        would write a null token count wherever the SDK reported none, which is spend read as nothing.
        """
        if report.get("model_called"):
            self._write("research_generation", query, dict(report))

    def _write(self, event: str, query: str, payload: dict[str, Any]) -> None:
        """One row in the ledger, through ``AuditLog``'s ACTUAL signature.

        ``record_risk_event`` takes the event name POSITIONALLY. This method
        passed it as ``kind=``, which no audit log has ever accepted: against
        the real store every write raised ``TypeError`` and was swallowed by
        the except below as a warning. Nothing noticed, because the only caller
        was a test whose fake recorder took ``**kwargs`` — so the fake accepted
        an argument the production object rejects, and "every plan is recorded"
        was true of the fake and false of the desk.
        """
        if self.audit is None:
            return
        try:
            self.audit.record_risk_event(
                event,
                severity="info",
                actor="research",
                detail=query[:200],
                payload=payload,
            )
        except Exception as exc:  # noqa: BLE001 — a ledger that is down must not stop a read
            # Logged, not swallowed. A plan that failed to record is a plan
            # that cannot be replayed, which is worth knowing even though it is
            # not worth failing a read over.
            log.warning("%s not recorded (%s)", event, type(exc).__name__)
