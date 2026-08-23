"""How much to bet, when the bets are on outcomes that cannot both happen.

Sizing a single contract is the textbook Kelly fraction. Sizing a *family* of
contracts is not the textbook problem repeated, because the positions are not
separate gambles — exactly one outcome of a mutually exclusive event resolves
YES, so a dollar on one outcome is partly a hedge for the dollar on another.
Sizing each leg with a scalar formula and adding them up over-stakes the family
and can stake more than the bankroll on a set that pays out once.

The right object is the joint distribution. With bankroll normalised to one,
staking ``f_s`` on outcome ``s`` at price ``a_s`` leaves ``1 - Σf`` in cash and
returns ``f_s / a_s`` if ``s`` happens, so the problem is

    maximise  Σ_s q_s · log( 1 - Σ_j f_j + f_s / a_s )     over f >= 0

and it has an exact solution — no solver, no gradient steps. Order the outcomes
by ``q_s / a_s``, the expected payoff per dollar. Take the first ``t`` of them
and define the rate at which cash is still worth holding,

    R_t = ( 1 - Σ_{s<=t} q_s ) / ( 1 - Σ_{s<=t} a_s )

which reads as *the probability you have not covered, divided by the money you
have not spent*. Keep admitting outcomes while ``q_s / a_s > R_t``; then

    f_s = q_s - R · a_s

**Growth-optimal is not riskless.** If the outcomes cost less than a dollar in
total then ``R`` reaches zero, ``f_s = q_s`` and ``Σ f_s = 1``: Kelly holds no
cash and stakes the lot. That is not the Dutch book of ``dutchbook.py`` arriving
from the other direction. The Dutch book buys *equal numbers of contracts*,
which is what makes its payoff a flat dollar in every state and its profit
certain; Kelly buys stakes proportional to ``q``, a different portfolio with a
payoff that is not flat. On a family costing $0.94 with ``q = (0.50, 0.30,
0.20)`` against prices ``(0.30, 0.32, 0.32)`` the arbitrage turns $1 into
$1.0638 with certainty while Kelly turns it into anything from $0.63 to $1.67
and grows faster — 0.1421 against 0.0619 — precisely because it takes a risk the
arbitrage refuses. The certificate answers "what can I be paid for holding
nothing?"; Kelly answers "what maximises growth if my measure is right?" Both
the expected growth and the worst state are reported, and where an arbitrage
exists the riskless alternative sits beside the risky plan.

**Where ``q`` comes from decides whether any of this means anything.** Feed this
the market's own mid prices and it will correctly tell you to bet almost nothing,
because you have no edge over the prices you are quoting back. The measure worth
feeding it is the *coherent* one — the nearest price vector that admits a
probability, which ``dutchbook`` and ``coherence_index`` already compute. Then
the edge being sized is the incoherence itself, which is the only edge this
engine ever claims to find.

**Full Kelly is not a recommendation.** It maximises long-run growth under the
assumption that ``q`` is correct, and ``q`` here is inferred from quotes that
move. Kelly's growth curve is flat near the optimum and steep past it, so
over-betting costs far more than under-betting: half Kelly gives up a quarter of
the growth for half the variance. The default shrinkage is a quarter, both
fractions are reported, and the caller is told which one it is looking at.

**Two corrections, not the same one twice.** Fractional Kelly scales the ANSWER
down afterwards; the estimation haircut corrects the INPUT first, by shrinking
the measure toward the market's own — ``shrinkage.py`` holds that construction
and the argument for it. ``Candidate.uncertainty`` carries each leg's width,
half its bid-ask spread at the least.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Sequence

from modules.coherence.kernel import shrinkage
from modules.coherence.kernel.money import DOLLAR, format_dollars

#: The default fraction of full Kelly. A quarter, not a half, because ``q`` is
#: not a belief here — it is an estimate read off a moving book, and the
#: estimation error is not in the model.
DEFAULT_SHRINKAGE: Decimal = Decimal("0.25")

Engine = Literal["exclusive", "unavailable"]


@dataclass(frozen=True, slots=True)
class Candidate:
    """One outcome that can be bought, and what the measure says about it."""

    ticker: str
    label: str
    probability: Decimal
    price: Decimal
    #: How far this probability could be wrong, in the same units — half the
    #: leg's bid-ask spread at the least. Zero asserts certainty.
    uncertainty: Decimal = Decimal(0)




@dataclass(frozen=True, slots=True)
class Stake:
    """What to put on one outcome, as a fraction of the bankroll."""

    ticker: str
    label: str
    probability: Decimal
    price: Decimal
    full_fraction: Decimal
    fraction: Decimal

    @property
    def edge(self) -> Decimal:
        """Probability minus price: the per-contract expected profit."""
        return self.probability - self.price

    @property
    def admitted(self) -> bool:
        return self.full_fraction > 0


@dataclass(frozen=True, slots=True)
class Plan:
    """The sized family, or the reason it cannot be sized."""

    engine: Engine
    stakes: tuple[Stake, ...]
    reserve_rate: Decimal | None
    cash_fraction: Decimal | None
    full_cash_fraction: Decimal | None
    shrinkage: Decimal
    growth_rate: Decimal | None
    full_growth_rate: Decimal | None
    basket_cost: Decimal | None
    #: True when the family costs under a dollar and a *riskless* profit exists.
    #: It does not mean this plan is that profit — see ``riskless_growth``.
    arbitrage_available: bool
    #: Log growth of the equal-contract arbitrage basket, when there is one.
    #: Reported so the certain alternative can be compared with the risky plan.
    riskless_growth: Decimal | None
    #: The smallest bankroll multiple this plan can leave, across all outcomes.
    #: One means it cannot lose; below one it can, whatever the growth rate says.
    worst_case_wealth: Decimal | None
    detail: str

    @property
    def staked_fraction(self) -> Decimal | None:
        if self.cash_fraction is None:
            return None
        return DOLLAR - self.cash_fraction

    def dollars(self, capital: Decimal) -> tuple[tuple[str, Decimal], ...]:
        """The plan in money, at a given bankroll."""
        return tuple((stake.ticker, (stake.fraction * capital)) for stake in self.stakes if stake.admitted)


def _unavailable(detail: str, shrinkage: Decimal) -> Plan:
    return Plan(
        engine="unavailable",
        stakes=(),
        reserve_rate=None,
        cash_fraction=None,
        full_cash_fraction=None,
        shrinkage=shrinkage,
        growth_rate=None,
        full_growth_rate=None,
        basket_cost=None,
        arbitrage_available=False,
        riskless_growth=None,
        worst_case_wealth=None,
        detail=detail,
    )


def _shrink(rows: list[Candidate]) -> tuple[list[Candidate], Decimal]:
    """Apply the estimation haircut, keeping every other field of the candidate."""
    values, lam = shrinkage.toward_market(
        [item.probability for item in rows],
        [item.price for item in rows],
        [item.uncertainty for item in rows],
    )
    if lam <= 0:
        return rows, Decimal(0)
    return [
        Candidate(item.ticker, item.label, value, item.price, item.uncertainty)
        for item, value in zip(rows, values, strict=False)
    ], lam


def _worst_case(candidates: Sequence[Candidate], fractions: Sequence[Decimal]) -> Decimal | None:
    """The worst bankroll multiple this plan can leave.

    The growth rate is an average over states and says nothing about the bad
    ones. This is the number that tells a reader a log-optimal plan can still
    lose a third of the bankroll on a single settlement.
    """
    cash = DOLLAR - sum(fractions, Decimal(0))
    outcomes = [
        cash + (fraction / candidate.price if candidate.price > 0 else Decimal(0))
        for candidate, fraction in zip(candidates, fractions, strict=False)
    ]
    return min(outcomes) if outcomes else None


def unsizeable(detail: str, shrinkage: Decimal = DEFAULT_SHRINKAGE) -> Plan:
    """A family this module will not size, and the reason why.

    Public because refusing is a real answer that callers need to give. The
    alternative — handing ``solve`` an empty or partial candidate list — makes
    a refusal indistinguishable from a small family, and a small family gets
    priced as though the outcomes left out could not happen.
    """
    return _unavailable(detail, shrinkage)


def _growth(candidates: Sequence[Candidate], fractions: Sequence[Decimal]) -> Decimal | None:
    """Expected log growth of the bankroll under this plan.

    ``None`` when any outcome would wipe the bankroll out, which cannot happen
    for a Kelly solution but can for a hand-supplied one, and returning a
    number there would hide a total loss behind an average.
    """
    cash = DOLLAR - sum(fractions, Decimal(0))
    total = Decimal(0)
    for candidate, fraction in zip(candidates, fractions, strict=False):
        wealth = cash + (fraction / candidate.price if candidate.price > 0 else Decimal(0))
        if wealth <= 0:
            return None
        total += candidate.probability * wealth.ln()
    return total


def _admit(ordered: Sequence[Candidate]) -> tuple[Decimal, int]:
    """How many outcomes clear the cash rate, and what that rate settles at.

    Walks the outcomes best-first, admitting one while its payoff per dollar
    beats the rate at which the cash it would consume is still worth holding.
    Split out of ``solve`` because it is the whole of the Kelly derivation and
    reads as one idea.
    """
    reserve = DOLLAR
    admitted = 0
    covered_probability = Decimal(0)
    covered_cost = Decimal(0)
    for index, item in enumerate(ordered, start=1):
        covered_probability += item.probability
        covered_cost += item.price
        if covered_cost >= DOLLAR:
            # The cash rate is "probability not covered over money not spent",
            # so it needs money left to spend. Once the outcomes admitted so far
            # cost a dollar there is none, and there is nothing to admit: buying
            # the whole family for a dollar or more buys a dollar for a dollar.
            # The genuinely riskless case, Σa < 1, never reaches this branch —
            # its cost stays under a dollar and it is handled by the caller.
            break
        candidate_reserve = (DOLLAR - covered_probability) / (DOLLAR - covered_cost)
        if item.probability / item.price <= candidate_reserve:
            break
        reserve = candidate_reserve
        admitted = index
    return reserve, admitted


def solve(
    candidates: Sequence[Candidate],
    shrinkage: Decimal = DEFAULT_SHRINKAGE,
    arbitrage_bound: Decimal = DOLLAR,
) -> Plan:
    """Log-optimal stakes over one mutually exclusive family.

    ``candidates`` must be the whole family: every outcome, priced at what it
    costs to buy. A partial family is a different problem — the outcomes left
    out still absorb probability, and pretending they cannot happen inflates
    every stake. The caller is responsible for that; this function cannot tell
    a family with a missing member from a smaller family.

    ``arbitrage_bound`` is what the basket must beat before a riskless profit is
    claimed. It defaults to a dollar, the GROSS test, which is wrong by exactly
    the fees: ``costs.no_arbitrage_bound`` computes ``1 - Σ net_fee`` and is what
    a caller with a schedule should pass. A basket costing $0.98 does not earn
    two cents if its legs' fees come to three, and this module has no schedule
    of its own — so the threshold is an argument, not a constant.
    """
    rows = [item for item in candidates if item.price > 0]
    if len(rows) < 2:
        return _unavailable(
            "fewer than two outcomes of this family are offered, so there is no joint "
            "distribution to size against",
            shrinkage,
        )
    if any(item.probability < 0 for item in rows):
        return _unavailable("the supplied measure has a negative probability in it", shrinkage)
    if any(item.uncertainty < 0 for item in rows):
        return _unavailable("an outcome was given a negative estimation error", shrinkage)
    if shrinkage <= 0 or shrinkage > 1:
        return _unavailable("the Kelly shrinkage must sit in (0, 1]", shrinkage)

    mass = sum((item.probability for item in rows), Decimal(0))
    if mass <= 0:
        return _unavailable("the supplied measure puts no mass on this family", shrinkage)
    notes: list[str] = []
    if mass != DOLLAR:
        rows = [
            Candidate(item.ticker, item.label, item.probability / mass, item.price, item.uncertainty)
            for item in rows
        ]
        notes.append(f"the supplied measure summed to {mass} and was normalised to one")

    rows, lam = _shrink(rows)
    if lam > 0:
        notes.append(
            f"the measure was shrunk {lam} of the way toward the market's own before sizing, which is "
            "the share of the apparent edge these spreads could account for"
        )

    basket = sum((item.price for item in rows), Decimal(0))
    ordered = sorted(rows, key=lambda item: item.probability / item.price, reverse=True)

    # Admit outcomes while the next one beats the rate at which held cash is
    # still worth more than the bet it would fund.
    reserve, admitted = _admit(ordered)

    if admitted == 0:
        return Plan(
            engine="exclusive",
            stakes=tuple(
                Stake(item.ticker, item.label, item.probability, item.price, Decimal(0), Decimal(0))
                for item in ordered
            ),
            reserve_rate=reserve,
            cash_fraction=DOLLAR,
            full_cash_fraction=DOLLAR,
            shrinkage=shrinkage,
            growth_rate=Decimal(0),
            full_growth_rate=Decimal(0),
            basket_cost=basket,
            arbitrage_available=basket < DOLLAR,
            riskless_growth=None,
            worst_case_wealth=DOLLAR,
            detail=(
                "no outcome in this family is priced below what the measure says it is worth, "
                "so the log-optimal stake is nothing at all"
                + ("; " + "; ".join(notes) if notes else "")
            ),
        )

    arbitrage = basket < arbitrage_bound
    riskless_growth: Decimal | None = None
    if arbitrage:
        # Σ a_s < 1: one contract of every outcome costs less than the dollar it
        # is certain to pay. The cash rate collapses to zero, so Kelly holds no
        # cash and stakes the measure. That is a different portfolio from the
        # arbitrage basket, and its certain-profit alternative is priced here so
        # the two can be compared rather than confused.
        reserve = Decimal(0)
        admitted = len(ordered)
        riskless_growth = (DOLLAR / basket).ln()
        threshold = (
            "a dollar" if arbitrage_bound == DOLLAR
            else f"{format_dollars(arbitrage_bound)}, which is a dollar less the fees on these legs"
        )
        notes.append(
            f"one contract of each outcome costs {basket} against a threshold of {threshold} and pays "
            f"a dollar whatever happens, so a riskless {format_dollars(riskless_growth)} of log growth "
            "is available; the plan below stakes the measure instead, which grows faster and can lose"
        )

    full = [
        (item.probability - reserve * item.price) if index < admitted else Decimal(0)
        for index, item in enumerate(ordered)
    ]
    full = [value if value > 0 else Decimal(0) for value in full]
    shrunk = [value * shrinkage for value in full]

    stakes = tuple(
        Stake(
            ticker=item.ticker,
            label=item.label,
            probability=item.probability,
            price=item.price,
            full_fraction=full_value,
            fraction=shrunk_value,
        )
        for item, full_value, shrunk_value in zip(ordered, full, shrunk, strict=False)
    )
    full_cash = DOLLAR - sum(full, Decimal(0))
    cash = DOLLAR - sum(shrunk, Decimal(0))
    notes.insert(0, f"{admitted} of {len(ordered)} outcome(s) clear the cash rate of {reserve}")

    return Plan(
        engine="exclusive",
        stakes=stakes,
        reserve_rate=reserve,
        cash_fraction=cash,
        full_cash_fraction=full_cash,
        shrinkage=shrinkage,
        growth_rate=_growth(ordered, shrunk),
        full_growth_rate=_growth(ordered, full),
        basket_cost=basket,
        arbitrage_available=arbitrage,
        riskless_growth=riskless_growth,
        worst_case_wealth=_worst_case(ordered, shrunk),
        detail="; ".join(notes),
    )
