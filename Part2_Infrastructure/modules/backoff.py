"""Bounded geometric backoff, in one place.

Four hand-rolled versions of this exist in the gateway — `SupabaseMirror._drain`,
`tca_engine`'s WebSocket reconnect, the Telegram polling loop, and the CRAG
rewrite — and none is importable, so a fifth caller would have written a fifth.
They agree on the shape and differ in every detail: base, ceiling, whether the
count resets, whether the ceiling is ever reached.

The ceiling matters more than the curve. An uncapped geometric backoff on a
long-lived process reaches hours, at which point the loop is effectively dead
without ever having said so — which is the failure mode this codebase is most
alert to elsewhere and had not written down here.

Deliberately not async and deliberately not a decorator: it computes a delay
and counts failures. Sleeping, scheduling and giving up are the caller's
decisions, because each of the four sites makes them differently and a helper
that took them over would fit none of them.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Backoff:
    """How long to wait, given how many attempts have failed in a row."""

    base_s: float
    ceiling_s: float
    #: Attempts that have failed since the last success.
    failures: int = 0

    def __post_init__(self) -> None:
        if self.base_s <= 0:
            raise ValueError("base_s must be positive")
        if self.ceiling_s < self.base_s:
            raise ValueError("ceiling_s cannot be below base_s")

    @property
    def delay_s(self) -> float:
        """Seconds before the next attempt. `base_s` while healthy.

        `2 ** failures` capped, with the exponent itself capped at 16 so a very
        long outage cannot overflow the float before the ceiling clamps it.
        """
        if self.failures <= 0:
            return self.base_s
        return min(self.ceiling_s, self.base_s * 2 ** min(self.failures, 16))

    @property
    def exhausted(self) -> bool:
        """True once the delay has reached its ceiling — the loop is not
        recovering, and a caller that wants to say so has something to say it
        with."""
        return self.delay_s >= self.ceiling_s

    def failed(self) -> float:
        """Record a failure and return the new delay."""
        self.failures += 1
        return self.delay_s

    def succeeded(self) -> None:
        """Recovery is immediate. A loop that stays slow after it starts working
        again is a loop that is still reporting an outage that has ended."""
        self.failures = 0
