"""How close to the requested notional a ladder walk has to land."""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# Fill tolerance
# --------------------------------------------------------------------------- #
# A ladder walk reaches the requested notional by subtracting one level at a
# time, so the total lands a few ULPs either side of the request rather than
# exactly on it, and a request that is not on a cent boundary never matches a
# figure that has been quantised to cents anywhere along the way. Deciding
# ``fillable`` with a bare ``>=`` therefore reports "this book cannot absorb the
# order" for orders the book demonstrably absorbs: a SELL of 99.95002498750625 at
# a limit of 101 was rejected by the pre-trade liquidity gate with "only $10,095
# of $10,095 routable" — the two figures identical to the dollar — while the same
# order at a quantity of exactly 99.95 went through.
#
# The tolerance is *relative* because this engine prices instruments from cents
# to tens of thousands. A fixed dollar epsilon is wrong at one end or the other:
# one loose enough to cover accumulation drift on a $50M block would swallow a
# complete miss on a $2 order, and one tight enough for the $2 order rejects the
# block outright. 1e-9 of the request sits several orders of magnitude above the
# drift even a thousand-level ladder can accumulate (~1e-13 relative) and still
# forgives only a single cent on a $10M order.
#
# The direction of the error matters more than its size. ``fillable`` is a
# pre-trade risk gate, so a false *accept* releases an order into a book that
# cannot fill it, whereas a false *reject* is a cosmetic annoyance. This
# tolerance is therefore sized to absorb arithmetic noise and nothing else — it
# must never be widened far enough to hide a real partial fill, and no caller may
# substitute the requested notional for the measured one to make it pass.
FILL_TOLERANCE = 1e-9


def absorbs(filled: float, requested: float) -> bool:
    """Did a walk that measured ``filled`` actually cover ``requested``?

    ``filled`` must be the honest measured figure. Clamping it to ``requested``
    upstream would make this function a tautology and disarm the gate.
    """
    if requested <= 0.0:
        return True
    return filled >= requested - requested * FILL_TOLERANCE


def _dust(target_notional: float) -> float:
    """Residual below which a walk is finished rather than one level short.

    Same tolerance, applied to the loop exit: without it a sub-ULP remainder
    consumes an extra level, inflating ``levels_consumed`` and reporting a
    ``worst_price`` (or, in the router, an extra venue leg) the order never
    actually reaches.
    """
    return max(target_notional, 0.0) * FILL_TOLERANCE
