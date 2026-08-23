"""The states of the world a component's markets pay out in.

The coherence test asks whether a probability measure exists over the possible
futures that reproduces the quoted prices. To ask that you need the futures —
and for a family of markets on one underlying, they are the intervals the
strikes cut it into.

Two shapes cover what Kalshi lists:

**A strike family.** Markets say "above 84", "between 80 and 81", "below 80".
Collect every boundary, sort them, and the intervals between are the states. A
market pays a dollar in exactly the states its own condition covers, which is
the payoff matrix the solver needs and also the honest answer to "what does this
contract do".

**A named family.** Fed decisions, election winners: no numeric strike, just
outcomes the exchange marks mutually exclusive. Each market is its own state.

A component that is neither — no strikes and no exclusivity flag — has no state
space this module can derive, and it says so rather than inventing one. The
markets may still be related; nothing here can prove it.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Sequence

from modules.coherence.kernel.lattice import Component, Node


@dataclass(frozen=True, slots=True)
class StateSpace:
    """The futures, and what each market pays in each one.

    ``payoff[market_index][state_index]`` is 1 or 0. Dense because these are
    tens of markets by tens of states, not thousands, and a dense matrix is
    readable in a test failure.
    """

    tickers: tuple[str, ...]
    labels: tuple[str, ...]
    states: tuple[str, ...]
    payoff: tuple[tuple[int, ...], ...]
    #: True when the states are exhaustive — exactly one must happen. Only then
    #: does "buy every market" buy a guaranteed dollar.
    exhaustive: bool
    note: str = ""

    @property
    def is_empty(self) -> bool:
        return not self.tickers or not self.states


def _pays(node: Node, low: Decimal | None, high: Decimal | None) -> int:
    """Does this market pay in the interval ``(low, high]``?

    The interval is represented by a point strictly inside it; using its
    midpoint would need arithmetic on unbounded ends, so the test is written
    against the bounds directly.
    """
    if node.is_threshold:
        # Pays when the outcome exceeds the floor. True for the whole interval
        # exactly when the interval's lower bound is at or above the floor.
        return 1 if low is not None and node.floor_strike is not None and low >= node.floor_strike else 0
    if node.is_ceiling:
        return 1 if high is not None and node.cap_strike is not None and high <= node.cap_strike else 0
    if node.is_bucket:
        inside_low = low is not None and node.floor_strike is not None and low >= node.floor_strike
        inside_high = high is not None and node.cap_strike is not None and high <= node.cap_strike
        return 1 if inside_low and inside_high else 0
    return 0


def build_states(component: Component) -> StateSpace:
    """The state space for one component, or an empty one with a reason."""
    nodes = component.nodes
    if not nodes:
        return StateSpace((), (), (), (), False, "no active market in this event")

    numeric = [node for node in nodes if node.is_threshold or node.is_ceiling or node.is_bucket]

    # The exclusivity flag wins over the strikes, and this ordering was earned.
    # Cutting the NYC temperature family at its strikes produces nine intervals
    # for six markets, three of which — "81 to 82", "83 to 84", "85 to 86" — no
    # market pays in, because the underlying is whole degrees and the listed
    # buckets are 80-81, 82-83, 84-85. Treating those gaps as reachable states
    # would say the basket does NOT pay a dollar in every future, and the
    # additive constraint would silently stop applying to a family the exchange
    # itself declares exhaustive. The flag is the venue's assertion about its
    # own settlement; the intervals are our inference from two numbers.
    if component.mutually_exclusive:
        return _named_states(nodes)
    if numeric and len(numeric) == len(nodes):
        return _numeric_states(nodes)
    if numeric:
        return StateSpace(
            (), (), (), (), False,
            "this event mixes strike markets with named ones and is not marked mutually exclusive, "
            "so its states cannot be derived",
        )
    return StateSpace(
        (), (), (), (), False,
        "these markets carry no strikes and the event is not mutually exclusive, "
        "so nothing here says how their outcomes relate",
    )


def _named_states(nodes: Sequence[Node]) -> StateSpace:
    """One state per market. Exhaustive by the exchange's own assertion."""
    payoff = tuple(tuple(1 if i == j else 0 for j in range(len(nodes))) for i in range(len(nodes)))
    return StateSpace(
        tickers=tuple(node.ticker for node in nodes),
        labels=tuple(node.label for node in nodes),
        states=tuple(node.label for node in nodes),
        payoff=payoff,
        exhaustive=True,
        note="one state per outcome, because the exchange marks this event mutually exclusive",
    )


def _numeric_states(nodes: Sequence[Node]) -> StateSpace:
    """Intervals cut by every strike in the family.

    Always exhaustive: the intervals tile the real line by construction, from
    below the lowest strike to above the highest. That is a property of the
    partition rather than a claim about the exchange's listing, which is why
    this path does not need the mutual-exclusivity flag.
    """
    boundaries: set[Decimal] = set()
    for node in nodes:
        if node.floor_strike is not None:
            boundaries.add(node.floor_strike)
        if node.cap_strike is not None:
            boundaries.add(node.cap_strike)
    cuts = sorted(boundaries)

    # Intervals: (-inf, c0], (c0, c1], ..., (cn, +inf)
    bounds: list[tuple[Decimal | None, Decimal | None]] = [(None, cuts[0])]
    for low, high in zip(cuts, cuts[1:], strict=False):
        bounds.append((low, high))
    bounds.append((cuts[-1], None))

    labels = []
    for low, high in bounds:
        if low is None:
            labels.append(f"at or below {high}")
        elif high is None:
            labels.append(f"above {low}")
        else:
            labels.append(f"{low} to {high}")

    payoff = tuple(tuple(_pays(node, low, high) for low, high in bounds) for node in nodes)
    return StateSpace(
        tickers=tuple(node.ticker for node in nodes),
        labels=tuple(node.label for node in nodes),
        states=tuple(labels),
        payoff=payoff,
        exhaustive=True,
        note=f"{len(bounds)} intervals cut by {len(cuts)} strike(s)",
    )
