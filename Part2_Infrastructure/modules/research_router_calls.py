"""The router's vocabulary: its closed tool set, its rows, and its bound.

Split out of ``modules.research_router`` rather than added to it. That module
sits one line under the 400-line ceiling `tests/test_file_size.py` ratchets, and
the ledger rows below grew the fields a replay actually needs — the text that
was really sent, the filter it was sent with, the document the graph walked
from, how long the call took, and the id that ties one request's rows to each
other. The decisions stayed in ``research_router``; the shapes came here. Every
name is re-exported from ``modules.research_router``, so nothing that imports it
needs to know this file exists.

The one rule that lives here rather than there is `bound_calls`, because it is a
property of the tool set: **the bound drops speculative tools and never the
guaranteed one.** See its docstring for the query that proved it did not.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

#: The closed set. A planner naming anything else is treated as having failed,
#: which is what makes an unbounded tool surface impossible rather than
#: discouraged.
TOOL_HYBRID = "hybrid_search"
TOOL_GRAPH = "graph_traverse"
TOOL_RUNS = "structured_runs"
TOOL_LEXICAL = "lexical_exact"

TOOLS: frozenset[str] = frozenset({TOOL_HYBRID, TOOL_GRAPH, TOOL_RUNS, TOOL_LEXICAL})

#: The tool the bound may never drop, named once so that the guarantee is a
#: constant rather than a sentence in a docstring. Hybrid search is the arm that
#: answers when the specialised ones find nothing; the others are speculative in
#: the precise sense that each can legitimately return nothing at all.
GUARANTEED_TOOL = TOOL_HYBRID

#: Eight hex characters is what this desk's data_hash looks like everywhere it
#: appears, and it is the token a sentence embedder handles worst.
_DATA_HASH = re.compile(r"\b[0-9a-f]{8}\b")
_SYMBOL = re.compile(r"\b[A-Z]{2,10}(?:USDT|USD|PERP)?\b")


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


def new_correlation_id() -> str:
    """One id per research request, stamped on every row the request writes.

    Without it the ledger holds a `research_plan`, three `research_tool_call`
    rows and a `research_generation` row that can only be tied together by
    timestamp and by the first 200 characters of the query — which is exactly
    what fails under concurrency, when two desks ask similar questions in the
    same second and replay silently interleaves their arms.

    Twelve hex characters rather than a full UUID because this is an identifier
    a human pastes into a SQL prompt, and 2.8e14 values is far past the point
    where a collision inside one ledger is a real risk.
    """
    return f"rq_{uuid.uuid4().hex[:12]}"


@dataclass(frozen=True, slots=True)
class ToolCall:
    tool: str
    query: str
    reason: str


def bound_calls(calls: Sequence[ToolCall], max_calls: int) -> list[ToolCall]:
    """Truncate a plan to ``max_calls`` without ever dropping the fallback tool.

    THE DEFECT THIS EXISTS FOR, measured on the real planner rather than
    reasoned about: "how many runs since 3f8a9c21" proposed
    ``['lexical_exact', 'graph_traverse', 'structured_runs', 'hybrid_search']``
    and a plain ``calls[:3]`` cut the last one. So the module docstring promised
    "Hybrid always runs. It is the tool that answers when the others find
    nothing" while the bound deleted precisely that promise for any query rich
    enough to fire three rules — the queries with the most ways to come back
    empty. A bound that can delete the guarantee is not a bound, it is a
    lottery, and it is invisible because every arm it leaves behind still
    reports its own state honestly.

    The fix is positional, not conditional: keep the planner's order, drop from
    the TAIL of the speculative calls (the planner emits them weakest last), and
    let the guaranteed tool take the last slot. The rejected alternative was
    raising ``max_calls`` — which does not fix it, it moves the same cliff to
    four rules, and it loosens the one limit the router exists to enforce.

    A plan that never named the guaranteed tool is truncated and left alone.
    The bound's job is to remove calls, never to invent one the planner did not
    ask for; a planner that deliberately omitted hybrid is making a claim, and
    overruling it here would hide that claim from the ledger.
    """
    ordered = list(calls)
    kept = ordered[:max_calls]
    if any(call.tool == GUARANTEED_TOOL for call in kept):
        return kept
    guaranteed = next((call for call in ordered if call.tool == GUARANTEED_TOOL), None)
    if guaranteed is None:
        return kept
    return kept[: max_calls - 1] + [guaranteed]


@dataclass(frozen=True, slots=True)
class Plan:
    calls: tuple[ToolCall, ...]
    planner: str
    #: True when the router fell back rather than using the planner's answer.
    fallback: bool = False
    fallback_reason: str | None = None
    #: The id every row of this request carries. Defaulted rather than required
    #: so a hand-built `Plan` in a test still constructs; the router always sets
    #: one, and a row with a null id is a row that predates the correlation.
    correlation_id: str | None = None

    def as_audit(self) -> dict[str, Any]:
        """The row the audit log stores. A plan nobody can replay is a plan
        nobody can review."""
        return {
            "correlation_id": self.correlation_id,
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

    THE FIVE FIELDS BELOW ``detail`` ARE THE REPLAY. The row used to record
    tool/reason/state/rows/detail, and none of those is what the call actually
    did: ``lexical_exact`` re-queries with the bare token, which is NOT
    ``call.query``; the width and the kind filter decide what came back; a
    graph walk is entirely determined by the seed document it started from. A
    reader replaying the ledger could see that a tool ran and not what it ran.
    Each is None when it does not apply to that arm — never 0, which for a
    width or a latency would read as a measurement that was taken.
    """

    tool: str
    reason: str
    state: str
    rows: int
    detail: str | None = None
    #: The text actually sent to the arm — the bare token for `lexical_exact`,
    #: the whole query for `hybrid_search`, the statement of what was asked of
    #: the store for `structured_runs`.
    text: str | None = None
    #: The width and the filter the call was made with, as sent.
    match_count: int | None = None
    kind: str | None = None
    #: The document a graph walk started FROM. The single most load-bearing
    #: input to a traversal and the one the row never carried.
    seed: str | None = None
    #: Wall-clock milliseconds for this call alone. The research plane reports
    #: no stage timings anywhere; this is where they belong, because it is the
    #: only place that knows where one arm ends and the next begins.
    latency_ms: float | None = None

    def as_audit(self) -> dict[str, Any]:
        return {
            "tool": self.tool, "reason": self.reason, "state": self.state,
            "rows": self.rows, "detail": self.detail, "text": self.text,
            "match_count": self.match_count, "kind": self.kind, "seed": self.seed,
            "latency_ms": self.latency_ms,
        }


@dataclass
class Execution:
    """What a plan actually returned, merged in the plan's own order.

    The order matters and is the planner's: a data-hash query runs lexical
    before hybrid, so the exact-token hit is the row CRAG grades as "best".

    ``structured`` is kept apart from ``matches`` on purpose. Its rows are
    COMPUTED — a count, an extremum, a mean over the desk's own records — and
    they carry no ``similarity``, because nothing measured one. `matches` is
    served through `ResearchRagMatch`, whose ``similarity`` is a required
    float, so merging them would force a 0.0 onto a row that was never scored:
    "not applicable" written as "worst possible". The answer still reaches the
    caller — the tool call's ``detail`` states it in a sentence and the ledger
    row carries it — and a response field for the typed rows is one line of
    `research_crag`, which this module does not own.
    """

    state: str = "ok"
    matches: list[dict[str, Any]] = field(default_factory=list)
    connected: list[dict[str, Any]] = field(default_factory=list)
    corpus_size: int | None = None
    calls: list[ToolResult] = field(default_factory=list)
    #: The id shared by every ledger row this execution wrote.
    correlation_id: str | None = None
    #: The computed rows from `structured_runs`; see the note above.
    structured: list[dict[str, Any]] = field(default_factory=list)
    #: What `fuse_graph_matches` did to the graph arm, carried whole so the
    #: caller can see whether the neighbours were ranked in or only appended.
    #: None means the graph arm never ran.
    fusion: dict[str, Any] | None = None
