"""What a fill actually costs. Three components, and everyone models one.

Kalshi charges a **trade fee**, a **rounding fee** and a **rebate**, and the
middle one is the reason this module is longer than a one-line formula.

**Trade fee.** ``multiplier x rate x C x p x (1 - p)``, rounded UP to $0.0001.
The ``p(1-p)`` shape is Bernoulli variance: the fee peaks at fifty cents and
collapses toward the tails. That matters for arbitrage more than it looks —
``Σ ask < 1`` is not a conservative approximation of the fee-aware test, it is a
different test, and it is wrongest in the middle of the book where the volume
is. The multiplier is per series and can be overridden per event; it MULTIPLIES
the base rate rather than replacing it.

**Rounding fee.** The exchange floors your balance change to the account's
precision — a hundredth of a cent for direct members, a whole cent for everyone
else — and charges the shortfall. On a small fill this dwarfs the trade fee.
Kalshi's own worked example buys 0.09 contracts at $0.3301 in three lots and the
first fill pays $0.000500 of trade fee against $0.009597 of rounding: nineteen
times larger, on $0.0099 of notional. The net fee exceeded the notional.

**Rebate.** A per-order accumulator returns a whole cent once accumulated
rounding passes $0.01. The accumulator persists across an order's fills, which
is why this is a stateful class rather than a function.

**What the accumulator actually does to fragmentation, measured.** The received
wisdom — and the design note this engine was built from — is that splitting an
order across many fills is itself a cost, because each fill pays its own
rounding. Run the model and that is very nearly false: buying 0.09 contracts at
$0.3301 costs $0.010291 net whether it fills in one piece, three or nine, and
20 contracts at $0.45 costs $0.3500 across one fill or a hundred. The rounding
component grows exactly as the rebate grows, and they cancel. That is what the
accumulator is for.

What survives is a **residual bounded by one cent per order**: the accumulator
only refunds whole cents, so whatever sits below $0.01 when the order finishes
is never returned. A fragmented order can therefore cost up to a cent more than
the same position in one fill, and no more. Sweeping prices and sizes, the
difference is zero almost everywhere and exactly $0.0100 in the corner cases.

So the honest consequences are narrower than the folklore and still sharp.
There is a hard **minimum economic clip size**, derivable rather than guessed,
and it is driven by the ABSOLUTE fee floor — a trade fee ceiled to a centicent
plus up to a cent of unreturned rounding — rather than by a per-fill tax. On a
small enough clip that floor exceeds the notional outright, which is the case
Kalshi's own example demonstrates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from modules.coherence.kernel.money import CENT, DOLLAR, ceil_to_centicent, contracts, floor_to_precision

# Kalshi's published general rate, and the maker discount on it. Both are
# starting hypotheses: the effective rate should be derived from real fills
# once there are any, because the published number is what the schedule says
# and the fills are what happened.
DEFAULT_TAKER_RATE = Decimal("0.07")
DEFAULT_MAKER_RATIO = Decimal("0.25")


@dataclass(frozen=True, slots=True)
class FeeSchedule:
    """The fee shape one market trades under.

    ``multiplier`` is the per-series value, overridden per event. Live it is 1
    on almost every series and 0.5 or 0 on a few, so reading it as the rate
    prices every fee seven cents on the dollar too low.
    """

    multiplier: Decimal = Decimal(1)
    taker_rate: Decimal = DEFAULT_TAKER_RATE
    maker_ratio: Decimal = DEFAULT_MAKER_RATIO
    #: $0.01 for an ordinary account, $0.0001 for a direct member. Worth a
    #: hundredfold on the rounding component.
    balance_precision: Decimal = CENT

    def rate(self, maker: bool) -> Decimal:
        return self.multiplier * self.taker_rate * (self.maker_ratio if maker else Decimal(1))


@dataclass(frozen=True, slots=True)
class Fill:
    """One execution: a price, a size in hundredths, and which side of the book."""

    price: Decimal
    size_hundredths: int
    maker: bool = False
    #: True when the contract is being sold rather than bought. The trade fee is
    #: the same either way — it is charged on the variance of the contract, not
    #: on the direction — but the balance change flips sign, and the rounding
    #: fee is computed from the balance change.
    selling: bool = False

    @property
    def size(self) -> Decimal:
        return contracts(self.size_hundredths)

    @property
    def notional(self) -> Decimal:
        return self.price * self.size


@dataclass(frozen=True, slots=True)
class FeeBreakdown:
    """What one fill cost, component by component."""

    trade_fee: Decimal
    rounding_fee: Decimal
    rebate: Decimal
    notional: Decimal

    @property
    def net(self) -> Decimal:
        """Never below zero: the rebate returns overpayment, it does not pay you."""
        return max(Decimal(0), self.trade_fee + self.rounding_fee - self.rebate)

    @property
    def as_fraction_of_notional(self) -> Decimal | None:
        """None rather than a division by zero when nothing was traded."""
        return None if self.notional == 0 else self.net / self.notional


def trade_fee(fill: Fill, schedule: FeeSchedule) -> Decimal:
    """``ceil(multiplier x rate x C x p x (1 - p))`` to the centicent."""
    raw = schedule.rate(fill.maker) * fill.size * fill.price * (DOLLAR - fill.price)
    return ceil_to_centicent(raw)


@dataclass
class OrderFees:
    """One order's fills, with the rebate accumulator that spans them.

    Stateful because the accumulator is: Kalshi tracks accumulated rounding per
    ORDER and returns a cent each time it passes one, so the cost of a fill
    depends on the fills before it. A stateless per-fill function would
    overstate a fragmented order's cost by exactly the rebates it never saw.
    """

    schedule: FeeSchedule = field(default_factory=FeeSchedule)
    accumulated_rounding: Decimal = field(default=Decimal(0), init=False)
    fills: list[FeeBreakdown] = field(default_factory=list, init=False)

    def add(self, fill: Fill) -> FeeBreakdown:
        """Charge one fill and return what it cost."""
        fee = trade_fee(fill, self.schedule)

        # The signed change to the account, before rounding: paying out when
        # buying, receiving when selling, minus the fee either way.
        revenue = fill.notional if fill.selling else -fill.notional
        balance_change = revenue - fee

        # Floor toward negative infinity, then charge the shortfall. Floor, not
        # truncate: a purchase is a negative change, and the two differ there.
        floored = floor_to_precision(balance_change, self.schedule.balance_precision)
        rounding = balance_change - floored

        self.accumulated_rounding += rounding
        rebate = Decimal(0)
        while self.accumulated_rounding >= CENT:
            rebate += CENT
            self.accumulated_rounding -= CENT

        breakdown = FeeBreakdown(
            trade_fee=fee, rounding_fee=rounding, rebate=rebate, notional=fill.notional
        )
        self.fills.append(breakdown)
        return breakdown

    @property
    def total(self) -> FeeBreakdown:
        """Every fill on this order, summed."""
        return FeeBreakdown(
            trade_fee=sum((f.trade_fee for f in self.fills), Decimal(0)),
            rounding_fee=sum((f.rounding_fee for f in self.fills), Decimal(0)),
            rebate=sum((f.rebate for f in self.fills), Decimal(0)),
            notional=sum((f.notional for f in self.fills), Decimal(0)),
        )


def net_fee(price: Decimal, size_hundredths: int, schedule: FeeSchedule, fills: int = 1, maker: bool = False) -> FeeBreakdown:
    """What a position of this size costs if it fills in ``fills`` pieces.

    ``fills`` is the parameter nobody models. One fill and twenty fills of the
    same total size cost materially different amounts, because each one pays
    its own rounding, and the accumulator only partly gives it back.
    """
    order = OrderFees(schedule=schedule)
    per_fill = max(1, size_hundredths // max(1, fills))
    remaining = size_hundredths
    while remaining > 0:
        piece = min(per_fill, remaining)
        order.add(Fill(price=price, size_hundredths=piece, maker=maker))
        remaining -= piece
    return order.total


def minimum_clip_hundredths(
    price: Decimal,
    edge_per_contract: Decimal,
    schedule: FeeSchedule,
    expected_fills: int = 1,
) -> int | None:
    """The smallest size at which an edge survives its own fees.

    Returns None when no size does — which happens more often than it sounds.
    The rounding component is roughly fixed per fill, so it is amortised by
    size and multiplied by fragmentation; below some clip the fees exceed any
    edge, and above it the trade fee (which scales with size) eventually eats
    the rest.

    Searched rather than solved: the fee has a ceiling and a floor in it, so it
    is a step function of size and the closed form would be a fiction that
    happens to agree at the tested points.
    """
    if edge_per_contract <= 0:
        return None
    for hundredths in (1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000):
        gross = edge_per_contract * contracts(hundredths)
        fees = net_fee(price, hundredths, schedule, fills=expected_fills)
        if gross > fees.net:
            return hundredths
    return None


def no_arbitrage_bound(prices: list[Decimal], schedule: FeeSchedule, size_hundredths: int = 100) -> Decimal:
    """``1 - Σ net_fee`` — the real threshold a basket has to beat.

    The test everybody writes is ``Σ ask < 1``. This is the one that is true,
    and the gap between them is where the invented arbitrages live: the fee is
    a parabola in price, so the threshold depends on WHERE the legs sit, and
    the naive test is furthest wrong for baskets priced near the middle.
    """
    total = Decimal(0)
    for price in prices:
        total += net_fee(price, size_hundredths, schedule).net
    return DOLLAR - (total / contracts(size_hundredths) if size_hundredths else Decimal(0))
