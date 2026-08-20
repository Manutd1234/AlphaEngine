"""Rate limiting — the token bucket that keeps a runaway loop off the venue."""

from __future__ import annotations

import time
from collections import deque


class TokenBucket:
    """Classic token bucket: ``rate`` sustained ops/sec with ``burst`` capacity.

    Chosen over a fixed window because a fixed window lets 2x the limit through
    across a boundary — precisely the pattern that triggers exchange bans.
    """

    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.capacity = float(burst)
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self.recent = deque(maxlen=256)  # timestamps, for observability

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_consume(self, amount: float = 1.0) -> bool:
        self._refill()
        if self.tokens >= amount:
            self.tokens -= amount
            self.recent.append(time.monotonic())
            return True
        return False

    def observed_rate(self, window_s: float = 1.0) -> float:
        cutoff = time.monotonic() - window_s
        return sum(1 for t in self.recent if t >= cutoff) / window_s
