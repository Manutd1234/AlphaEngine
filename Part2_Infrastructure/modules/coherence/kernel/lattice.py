"""The logical structure between markets, taken from the exchange's own metadata.

Kalshi markets are not independent binaries. "NYC tops 84F" implies "NYC tops
82F"; a family of buckets covers every outcome exactly once; a threshold ladder
samples one survival function at several strikes. That structure is what makes a
coherence test possible at all — without it there is nothing for a set of prices
to be inconsistent *with*.

**The structure comes from the venue, never from the words.** Two rules follow.

First, ``mutually_exclusive`` is the licence for "these prices sum to one", and
nothing else is. It is tempting to infer exclusivity from the strikes — the NYC
temperature buckets do tile the integer degrees — but floor and cap carry no
claim that the buckets are contiguous, and reading one into them asserts
something the exchange did not. Where the flag is absent the sum is unconstrained
and this module says so.

Second, two markets are the same payoff only when they share a settlement
source. Matching by title similarity is how a "hedged" position ends up paying
zero or two dollars instead of one: two similarly-worded markets can settle on
different sources with different cut-offs, and the day they disagree is the day
the hedge was never a hedge.

What this module does NOT do is decide anything about prices. It builds the
graph; ``constraints`` turns the graph into rows and ``dutchbook`` prices them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Literal, Sequence

from modules.coherence.drivers.kalshi_parse import Event, Market

# How two markets are related. Each name is a claim that can be violated by a
# price vector, which is what makes it a constraint family rather than a label.
EdgeKind = Literal["implies", "exclusive", "bucket_of", "complement"]

# Where the legs of a relation live. Same-event edges are always same-shard —
# Kalshi guarantees an event's children share an exchange instance — and that
# is what makes intra-event structures the safest to act on.
EdgeScope = Literal["same-event", "same-shard", "cross-shard"]


@dataclass(frozen=True, slots=True)
class Node:
    """One market, with the part of its identity the lattice reasons about."""

    ticker: str
    event_ticker: str
    series_ticker: str
    exchange_index: int
    strike_kind: str
    floor_strike: Decimal | None
    cap_strike: Decimal | None
    settlement_sources: tuple[str, ...]
    label: str

    @property
    def is_threshold(self) -> bool:
        """Samples a survival function: P(X > k) or P(X >= k)."""
        return self.strike_kind in {"greater", "greater_or_equal"} and self.floor_strike is not None

    @property
    def is_ceiling(self) -> bool:
        """Samples a distribution function: P(X < k) or P(X <= k)."""
        return self.strike_kind in {"less", "less_or_equal"} and self.cap_strike is not None

    @property
    def is_bucket(self) -> bool:
        return self.strike_kind == "between" and self.floor_strike is not None and self.cap_strike is not None


@dataclass(frozen=True, slots=True)
class Edge:
    """A relation between two markets that a price vector can contradict.

    ``because`` is the sentence the certificate prints. It is stored with the
    edge rather than rebuilt at render time so that the reason a trade exists
    and the reason the constraint exists cannot drift apart.
    """

    kind: EdgeKind
    source: str
    target: str
    scope: EdgeScope
    because: str


@dataclass(slots=True)
class Component:
    """A family of markets whose prices constrain one another.

    One component is one coherence problem. Splitting the universe into
    components is what keeps the solver small: markets in different components
    cannot contradict each other, so solving them together buys nothing and
    costs a bigger matrix.
    """

    component_id: str
    event_ticker: str
    series_ticker: str
    exchange_index: int
    mutually_exclusive: bool
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def tickers(self) -> list[str]:
        return [node.ticker for node in self.nodes]

    @property
    def scope(self) -> EdgeScope:
        """The worst scope any edge in this component has.

        Drives the legging tier: an intra-event structure can be protected by
        an order group, a cross-shard one cannot, and the difference is a real
        cost rather than a caveat.
        """
        if any(edge.scope == "cross-shard" for edge in self.edges):
            return "cross-shard"
        if any(edge.scope == "same-shard" for edge in self.edges):
            return "same-shard"
        return "same-event"


def node_from(market: Market, settlement_sources: Sequence[str]) -> Node:
    return Node(
        ticker=market.ticker,
        event_ticker=market.event_ticker,
        series_ticker=market.series_ticker,
        exchange_index=market.exchange_index,
        strike_kind=market.strike_kind,
        floor_strike=market.floor_strike,
        cap_strike=market.cap_strike,
        settlement_sources=tuple(settlement_sources),
        label=market.yes_sub_title or market.ticker,
    )


def _scope_between(left: Node, right: Node) -> EdgeScope:
    if left.event_ticker == right.event_ticker:
        return "same-event"
    return "same-shard" if left.exchange_index == right.exchange_index else "cross-shard"


def _threshold_edges(nodes: Sequence[Node]) -> list[Edge]:
    """Monotonicity along a ladder: a higher strike cannot be more likely.

    ``{X > 100} ⊆ {X > 95}``, so P(X > 100) <= P(X > 95). Only adjacent strikes
    are linked: the relation is transitive, so every non-adjacent pair is
    implied by the chain, and emitting all of them would inflate the matrix
    without adding a single constraint.
    """
    ladder = sorted((node for node in nodes if node.is_threshold), key=lambda n: n.floor_strike or Decimal(0))
    edges: list[Edge] = []
    for lower, higher in zip(ladder, ladder[1:], strict=False):
        edges.append(
            Edge(
                kind="implies",
                source=higher.ticker,
                target=lower.ticker,
                scope=_scope_between(higher, lower),
                because=(
                    f"every outcome above {higher.floor_strike} is also above {lower.floor_strike}, "
                    f"so P({higher.label}) cannot exceed P({lower.label})"
                ),
            )
        )
    return edges


def _ceiling_edges(nodes: Sequence[Node]) -> list[Edge]:
    """The mirror of the ladder: a lower cap cannot be more likely."""
    ladder = sorted((node for node in nodes if node.is_ceiling), key=lambda n: n.cap_strike or Decimal(0))
    edges: list[Edge] = []
    for lower, higher in zip(ladder, ladder[1:], strict=False):
        edges.append(
            Edge(
                kind="implies",
                source=lower.ticker,
                target=higher.ticker,
                scope=_scope_between(lower, higher),
                because=(
                    f"every outcome below {lower.cap_strike} is also below {higher.cap_strike}, "
                    f"so P({lower.label}) cannot exceed P({higher.label})"
                ),
            )
        )
    return edges


def _bucket_edges(nodes: Sequence[Node]) -> list[Edge]:
    """A bucket implies every threshold it sits entirely above.

    ``{a <= X < b} ⊆ {X > k}`` whenever ``k <= a``. Only the tightest such
    threshold is linked, for the same transitivity reason as the ladder.
    """
    thresholds = sorted((node for node in nodes if node.is_threshold), key=lambda n: n.floor_strike or Decimal(0))
    edges: list[Edge] = []
    for bucket in (node for node in nodes if node.is_bucket):
        floor = bucket.floor_strike
        below = [node for node in thresholds if node.floor_strike is not None and floor is not None and node.floor_strike <= floor]
        if not below:
            continue
        tightest = below[-1]
        edges.append(
            Edge(
                kind="implies",
                source=bucket.ticker,
                target=tightest.ticker,
                scope=_scope_between(bucket, tightest),
                because=(
                    f"{bucket.label} sits entirely above {tightest.floor_strike}, "
                    f"so P({bucket.label}) cannot exceed P({tightest.label})"
                ),
            )
        )
    return edges


def build_component(event: Event, markets: Iterable[Market] | None = None) -> Component:
    """One event's markets as a coherence problem.

    Markets that are not open are left out rather than priced at their last
    quote: a closed market's price is a historical fact, and mixing it with
    live quotes produces a "violation" that no trade could ever capture.
    """
    rows = list(markets if markets is not None else event.markets)
    nodes = [node_from(market, event.settlement_sources) for market in rows if market.is_open]
    component = Component(
        component_id=event.event_ticker,
        event_ticker=event.event_ticker,
        series_ticker=event.series_ticker,
        exchange_index=event.exchange_index,
        mutually_exclusive=event.mutually_exclusive,
        nodes=nodes,
    )

    if len(rows) != len(nodes):
        component.notes.append(
            f"{len(rows) - len(nodes)} market(s) in this event are not active and were left out; "
            "a closed market's last price is history, not a quote"
        )

    if event.mutually_exclusive and len(nodes) > 1:
        component.edges.append(
            Edge(
                kind="exclusive",
                source=event.event_ticker,
                target=event.event_ticker,
                scope="same-event",
                because=(
                    "the exchange marks this event mutually exclusive, so exactly one outcome "
                    "resolves YES and the outcome prices must sum to one dollar"
                ),
            )
        )
    elif len(nodes) > 1:
        component.notes.append(
            "this event is not marked mutually exclusive, so its prices are not required to sum to anything"
        )

    component.edges.extend(_threshold_edges(nodes))
    component.edges.extend(_ceiling_edges(nodes))
    component.edges.extend(_bucket_edges(nodes))

    sources = {node.settlement_sources for node in nodes}
    if len(sources) > 1:
        component.notes.append(
            "these markets do not all share a settlement source, so they are not all the same payoff"
        )
    return component
