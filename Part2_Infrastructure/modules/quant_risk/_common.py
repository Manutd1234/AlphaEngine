"""Constants and the two helpers the rest of the package shares.

Split out because covariance, regimes, var, backtest and allocation all
reach for them, and a circular import between siblings is the one thing
this package must not grow.
"""

from __future__ import annotations

import math
from typing import Sequence

# 95% one-tailed normal quantile.
Z95 = 1.6448536269514722

# E[X | X < -z] for the standard normal at 95%: φ(1.645) / 0.05.
ES95_MULTIPLIER = 2.0627128027825736

BARS_PER_YEAR: dict[str, float] = {
    "15m": 35_040, "1h": 8_760, "4h": 2_190, "1d": 365,
}


def _mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _stdev(xs: Sequence[float], ddof: int = 1) -> float:
    n = len(xs)
    if n - ddof <= 0:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - ddof))


def returns_from_closes(closes: Sequence[float]) -> list[float]:
    """Simple per-bar returns. A zero previous close yields 0, never a divide."""
    out: list[float] = []
    for i in range(1, len(closes)):
        prev = closes[i - 1]
        out.append((closes[i] / prev - 1.0) if prev else 0.0)
    return out
