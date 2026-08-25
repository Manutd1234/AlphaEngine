"""The proof a signal ships with.

A number saying "arbitrage, 3.2 cents" is not evidence. What this renders is the
whole argument: the quoted prices, the logical claim they contradict, the
portfolio that exploits it, the payoff in the worst state of the world, every
fee component subtracted, and the reason it is or is not worth doing. A reader
can check it by hand, which is the only standard that makes a signal teachable.

The same object is produced by the closed-form checks and by the linear
programme, and it always names which engine produced it. That is not
bookkeeping: the closed-form checks find a subset of what the LP finds, so a
certificate that does not say which one answered leaves a reader unable to tell
"no arbitrage here" from "no arbitrage the weaker engine can see".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from modules.coherence.kernel.costs import FeeBreakdown
from modules.coherence.kernel.lattice import EdgeScope
from modules.coherence.kernel.money import contracts, format_dollars

Engine = Literal["closed_form", "highs"]
Verdict = Literal["incoherent", "coherent", "untestable"]

# The legging tier, from the widest scope any leg spans. Kalshi's order groups
# cancel the rest of a group when one leg over-fills — but they do not work
# across exchange instances, so a cross-shard portfolio has no such protection
# and has to be worth several times more to be worth the same risk.
TIER_BY_SCOPE: dict[EdgeScope, int] = {"same-event": 1, "same-shard": 2, "cross-shard": 3}

TIER_NOTE: dict[int, str] = {
    1: "one event, one shard: an order group with a contracts limit cancels the rest if a leg over-fills",
    2: "two events on one shard: an order group still protects the legs",
    3: "across exchange instances: order groups do not work here, and each shard needs its own collateral",
}


@dataclass(frozen=True, slots=True)
class CertificateLeg:
    """One order in the proposed portfolio, priced and sized."""

    ticker: str
    label: str
    direction: str
    price: Decimal
    size_hundredths: int
    fees: FeeBreakdown

    @property
    def size(self) -> Decimal:
        return contracts(self.size_hundredths)

    @property
    def notional(self) -> Decimal:
        return self.price * self.size


@dataclass(slots=True)
class Certificate:
    """One coherence result, with everything needed to check it.

    Produced whether or not a violation was found. A detector that returns
    nothing on the healthy case leaves a caller unable to tell "no opportunity"
    from "the feed is down", and this engine's most common answer — correctly —
    is that the market is coherent.
    """

    verdict: Verdict
    engine: Engine
    component_id: str
    series_ticker: str
    exchange_index: int
    family: str = ""
    because: str = ""
    scope: EdgeScope = "same-event"
    legs: tuple[CertificateLeg, ...] = ()
    gross_edge: Decimal | None = None
    worst_case_payoff: Decimal | None = None
    total_fees: Decimal | None = None
    net_edge: Decimal | None = None
    rows_tested: int = 0
    rows_untestable: int = 0
    #: The linear programme's optimum — the most any portfolio of these quotes
    #: can guarantee itself in the worst state, before fees. It is the quantity
    #: the coherent verdict is READ OFF, and until 2026-08-25 it was computed,
    #: compared against the threshold and then thrown away, so the one figure
    #: the common answer rests on was the one figure the certificate did not
    #: carry. Distinct from ``worst_case_payoff``, which describes the portfolio
    #: actually reported and is therefore absent when there is none: this is
    #: about the whole feasible set, is signed, and is at or below zero exactly
    #: when a probability measure exists. ``None`` from the closed-form engine,
    #: which solves no programme and so has no optimum to report.
    margin: Decimal | None = None
    #: The prices admit no probability measure, but no portfolio survives the
    #: fees. Distinct from ``coherent`` on purpose: a family quoted at $0.98
    #: for a dollar of payoff IS incoherent, and reporting it as coherent
    #: because the edge is priced out states something false about the prices
    #: in order to say something true about the trade. This engine exists to
    #: hold those two apart, so it carries both.
    priced_out: bool = False
    notes: list[str] = field(default_factory=list)

    @property
    def tier(self) -> int:
        return TIER_BY_SCOPE[self.scope]

    @property
    def worth_doing(self) -> bool:
        """Net of every fee component. Gross edge is not an answer."""
        return self.net_edge is not None and self.net_edge > 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "priced_out": self.priced_out,
            "engine": self.engine,
            "component_id": self.component_id,
            "series_ticker": self.series_ticker,
            "exchange_index": self.exchange_index,
            "family": self.family,
            "because": self.because,
            "scope": self.scope,
            "tier": self.tier,
            "tier_note": TIER_NOTE[self.tier],
            "legs": [
                {
                    "ticker": leg.ticker,
                    "label": leg.label,
                    "direction": leg.direction,
                    "price": format_dollars(leg.price),
                    "size": str(leg.size),
                    "notional": format_dollars(leg.notional),
                    "trade_fee": format_dollars(leg.fees.trade_fee, 6),
                    "rounding_fee": format_dollars(leg.fees.rounding_fee, 6),
                    "rebate": format_dollars(leg.fees.rebate, 6),
                    "net_fee": format_dollars(leg.fees.net, 6),
                }
                for leg in self.legs
            ],
            "gross_edge": None if self.gross_edge is None else format_dollars(self.gross_edge),
            "worst_case_payoff": None if self.worst_case_payoff is None else format_dollars(self.worst_case_payoff),
            "total_fees": None if self.total_fees is None else format_dollars(self.total_fees, 6),
            "net_edge": None if self.net_edge is None else format_dollars(self.net_edge),
            # Six decimals, like the fees: the margin is routinely smaller
            # than a centicent and the whole verdict turns on its sign, so
            # four places would round the interesting cases to "0.0000".
            "margin": None if self.margin is None else format_dollars(self.margin, 6),
            "worth_doing": self.worth_doing,
            "rows_tested": self.rows_tested,
            "rows_untestable": self.rows_untestable,
            "notes": list(self.notes),
        }

    def render_text(self) -> str:
        """The proof, as a reader checks it.

        Fixed-width and line-oriented on purpose: this is the artefact that
        gets pasted into a message or a notebook, and it has to survive being
        read somewhere this application does not control.
        """
        if self.verdict == "untestable":
            lines = [f"UNTESTABLE - {self.component_id} - shard {self.exchange_index}"]
            lines += [f"  {note}" for note in self.notes]
            return "\n".join(lines)

        if self.verdict == "coherent" and self.priced_out:
            return "\n".join(
                [
                    f"INCOHERENT BUT NOT TRADABLE - {self.component_id} - "
                    f"shard {self.exchange_index} - engine {self.engine}",
                    f"  {self.rows_tested} constraint(s) tested; the prices admit no probability measure,",
                    "  and no portfolio over them survives the fees.",
                    *([f"  {self.rows_untestable} could not be tested: a leg was unquoted."] if self.rows_untestable else []),
                    *[f"  {note}" for note in self.notes],
                ]
            )

        if self.verdict == "coherent":
            return "\n".join(
                [
                    f"COHERENT - {self.component_id} - shard {self.exchange_index} - engine {self.engine}",
                    f"  {self.rows_tested} constraint(s) tested, none violated.",
                    *(
                        [f"  best guaranteed worst-case payoff {format_dollars(self.margin, 6)}, at or below zero."]
                        if self.margin is not None
                        else []
                    ),
                    *([f"  {self.rows_untestable} could not be tested: a leg was unquoted."] if self.rows_untestable else []),
                    *[f"  {note}" for note in self.notes],
                ]
            )

        lines = [
            f"INCOHERENT - {self.component_id} - {self.family} - shard {self.exchange_index} - Tier {self.tier}",
            f"  {self.because}",
            "",
            "  PORTFOLIO",
        ]
        for leg in self.legs:
            lines.append(
                f"    {leg.direction:<4} {str(leg.size):>10} x {leg.label[:38]:<38} @ {format_dollars(leg.price)}"
            )
        lines.append("")
        if self.worst_case_payoff is not None:
            lines.append(f"  Worst-case payoff        {format_dollars(self.worst_case_payoff):>12}")
        trade = sum((leg.fees.trade_fee for leg in self.legs), Decimal(0))
        rounding = sum((leg.fees.rounding_fee for leg in self.legs), Decimal(0))
        rebate = sum((leg.fees.rebate for leg in self.legs), Decimal(0))
        lines.append(f"  Trade fees ({len(self.legs)} legs){'':<6}{'-' + format_dollars(trade, 6):>12}")
        lines.append(f"  Rounding fees{'':<12}{'-' + format_dollars(rounding, 6):>12}")
        if rebate > 0:
            lines.append(f"  Rebate{'':<19}{'+' + format_dollars(rebate, 6):>12}")
        lines.append("  " + "-" * 38)
        if self.net_edge is not None:
            lines.append(f"  NET{'':<22}{format_dollars(self.net_edge):>12}")
        lines.append("")
        lines.append(f"  Legging: Tier {self.tier} - {TIER_NOTE[self.tier]}")
        if not self.worth_doing:
            lines.append("  NOT WORTH DOING: the fees exceed the gross edge.")
        for note in self.notes:
            lines.append(f"  {note}")
        return "\n".join(lines)
