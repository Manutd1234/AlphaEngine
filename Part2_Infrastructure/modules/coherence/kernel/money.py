"""Fixed-point money for the coherence engine. No float ever touches a price.

This is the first module in the repository to use ``Decimal``, and it needs an
argument, because the house convention everywhere else is a float carried in a
``DOUBLE`` column. That convention is right for the rest of the desk and wrong
here, for one reason: **every decision this engine makes is a comparison at the
fourth decimal place.**

Kalshi prices are fixed-point dollar strings — ``"0.4200"`` — on a grid whose
step can be as fine as ``$0.0001``. The trade fee is ceiled to ``$0.0001``. The
question the engine asks is whether a basket costs less than one dollar *after*
fees, and the interesting baskets miss or clear by a tick. ``0.1`` is not
representable in binary64; a sum of eight leg prices accumulates error in the
last places; and the sign of ``total - 1`` is the whole answer. A float engine
would not be slightly wrong, it would be wrong exactly on the marginal cases,
which are the only cases that matter.

So: parse the venue's string into ``Decimal``, keep the string too, and never
convert to float inside ``kernel/``. ``tests/test_coherence_no_float.py`` reads
this package's source and fails on ``float(``, ``: float`` and ``math.``.

Two representations, deliberately not one:

* **Price** — a ``Decimal`` in dollars. Kalshi documents ``FixedPointDollars``
  as emitting *up to six* decimals (the WebSocket sends ``"0.960"``, REST sends
  ``"0.4200"``), so nothing here may assume a width. Canonical form is four
  decimals because that is the finest grid the exchange quotes on, and
  ``ceil_to_centicent`` is the fee rule.
* **Qty** — contracts, held as an ``int`` of hundredths. Fractional contracts
  are unconditional on Kalshi at ``0.01`` granularity, and a count that is
  always an integer number of hundredths cannot drift at all. The wire form
  ``FixedPointCount`` always carries two decimals.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Final

# The exchange's own quanta, as Decimals so no call site writes a literal.
CENTICENT: Final = Decimal("0.0001")  # the trade-fee ceiling and the finest tick
CENT: Final = Decimal("0.01")  # a non-direct member's balance precision
DOLLAR: Final = Decimal("1")  # what one contract pays when it resolves YES
CONTRACT_QUANTUM: Final = Decimal("0.01")  # the smallest tradable size

# Kalshi emits up to six decimals on a price. Anything longer is not a price we
# recognise, and guessing is how a parser turns a protocol change into a number.
MAX_PRICE_DECIMALS: Final = 6
MAX_COUNT_DECIMALS: Final = 2


class MoneyError(ValueError):
    """A venue string did not parse. Never substituted with a default.

    There is no sensible fallback for an unparseable price: zero is a legal
    Kalshi price, and any other guess invents liquidity. The caller reports the
    market as unreadable instead.
    """


def parse_dollars(raw: str | Decimal) -> Decimal:
    """A ``FixedPointDollars`` string to a Decimal, or ``MoneyError``.

    Accepts a Decimal unchanged so a re-parse is harmless. Rejects float on
    purpose — by the time a float arrives the precision is already gone, and
    accepting it here would make the no-float rule unenforceable one layer up.
    """
    if isinstance(raw, Decimal):
        return raw
    if isinstance(raw, bool) or not isinstance(raw, str):
        raise MoneyError(f"price must be a string from the venue, got {type(raw).__name__}")
    text = raw.strip()
    if not text:
        raise MoneyError("price string is empty")
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise MoneyError(f"price string {raw!r} is not a decimal") from exc
    if value.is_nan() or value.is_infinite():
        raise MoneyError(f"price string {raw!r} is not finite")
    if -value.as_tuple().exponent > MAX_PRICE_DECIMALS:
        raise MoneyError(f"price string {raw!r} carries more than {MAX_PRICE_DECIMALS} decimals")
    return value


def parse_fp(raw: str | Decimal) -> int:
    """A ``FixedPointCount`` string to hundredths of a contract.

    Returns an ``int`` rather than a Decimal so that arithmetic on sizes is
    exact by construction rather than by discipline.
    """
    if isinstance(raw, Decimal):
        value = raw
    elif isinstance(raw, bool) or not isinstance(raw, str):
        raise MoneyError(f"count must be a string from the venue, got {type(raw).__name__}")
    else:
        text = raw.strip()
        if not text:
            raise MoneyError("count string is empty")
        try:
            value = Decimal(text)
        except InvalidOperation as exc:
            raise MoneyError(f"count string {raw!r} is not a decimal") from exc
    if value.is_nan() or value.is_infinite():
        raise MoneyError(f"count string {raw!r} is not finite")
    if -value.as_tuple().exponent > MAX_COUNT_DECIMALS:
        raise MoneyError(f"count string {raw!r} is finer than 0.01 contracts")
    scaled = value * 100
    if scaled != scaled.to_integral_value():
        raise MoneyError(f"count string {raw!r} is not a whole number of hundredths")
    return int(scaled)


def contracts(hundredths: int) -> Decimal:
    """Hundredths back to contracts, for display and for money arithmetic."""
    return (Decimal(hundredths) / 100).quantize(CONTRACT_QUANTUM)


def format_dollars(value: Decimal, places: int = 4) -> str:
    """Canonical wire form. Four decimals unless a caller needs the fee's six."""
    quantum = Decimal(1).scaleb(-places)
    return str(value.quantize(quantum, rounding=ROUND_HALF_UP))


def ceil_to_centicent(value: Decimal) -> Decimal:
    """Round UP to $0.0001 — Kalshi's trade-fee rule, and only that.

    Named for the quantum rather than for "fee" because the grid uses the same
    quantum for a different purpose, and a function called ``round_fee`` would
    invite a call site that means "snap to the tick".
    """
    return value.quantize(CENTICENT, rounding=ROUND_CEILING)


def floor_to_precision(value: Decimal, precision: Decimal) -> Decimal:
    """Round toward negative infinity to an account's balance precision.

    This is the second of Kalshi's three fee components: the balance change is
    floored to the member's precision ($0.01 for most accounts, $0.0001 for
    direct members) and the shortfall is charged as the rounding fee. Floor,
    not truncate — the two differ on negative amounts, and a balance change is
    negative every time you buy.
    """
    if precision <= 0:
        raise MoneyError("balance precision must be positive")
    return value.quantize(precision, rounding=ROUND_FLOOR)


def one_minus(price: Decimal) -> Decimal:
    """The complementary price.

    A YES bid at ``p`` is a NO ask at ``1 - p``: the same claim, read from the
    other side. It has a name because it appears in every book conversion and
    in the identity of Lesson 0, and because writing ``1 - p`` inline invites
    someone to write ``100 - p`` when they are thinking in cents.
    """
    return DOLLAR - price
