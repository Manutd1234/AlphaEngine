"""How much of a decision is the Python preamble in ``_native_decide``?

``bench_decision.py`` answers "how long does a decision take". This answers
"how much of that is the marshalling we could move into C++" — the five list
builds over every position, plus the memoised ``mark()`` lookup each one needs,
which is the work a C++ ``PositionBook`` mirror would take over.

It is measured *before* that mirror is written rather than after, because the
answer decides whether writing it is worth risking a bit-exact parity surface.
The answer scales with the book: run it again before reconsidering.

    venv/bin/python tools/bench_preamble.py
"""

from __future__ import annotations

import gc
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

#: The whole-decision p50 the preamble is being weighed against, from
#: docs/LATENCY_BUDGET.md §2.1 on the machine that generated it.
DECISION_P50_US = 15.0

SAMPLES = 50_000
WARMUP = 5_000


class _Position:
    """The three fields the preamble reads off a real ``Position``."""

    __slots__ = ("quantity", "avg_price", "realized_pnl")

    def __init__(self, quantity: float, avg_price: float, realized: float) -> None:
        self.quantity = quantity
        self.avg_price = avg_price
        self.realized_pnl = realized


def preamble(positions: dict, marks: dict, symbol: str):
    """The loop as ``_native_decide`` runs it, marks already memoised."""
    quantities: list[float] = []
    avg_prices: list[float] = []
    realized: list[float] = []
    position_marks: list[float | None] = []
    is_order_symbol: list[bool] = []
    for sym, pos in positions.items():
        quantities.append(pos.quantity)
        avg_prices.append(pos.avg_price)
        realized.append(pos.realized_pnl)
        position_marks.append(marks.get(sym))
        is_order_symbol.append(sym == symbol)
    return quantities, avg_prices, realized, position_marks, is_order_symbol


def measure(count: int) -> None:
    positions = {f"SYM{i}": _Position(0.5 + i, 99.5, 0.0) for i in range(count)}
    marks = {f"SYM{i}": 100.0 + i for i in range(count)}
    symbol = "SYM0"

    for _ in range(WARMUP):
        preamble(positions, marks, symbol)

    gc.disable()
    samples: list[int] = []
    for _ in range(SAMPLES):
        started = time.perf_counter_ns()
        preamble(positions, marks, symbol)
        samples.append(time.perf_counter_ns() - started)
    gc.enable()

    samples.sort()
    p50 = samples[len(samples) // 2] / 1000
    p99 = samples[int(len(samples) * 0.99)] / 1000
    share = p50 / DECISION_P50_US * 100
    print(
        f"{count:3} positions   preamble p50={p50:6.3f} us  p99={p99:6.3f} us"
        f"   = {share:4.1f}% of a {DECISION_P50_US:.0f} us decision"
    )


def main() -> None:
    for count in (1, 4, 20, 100):
        measure(count)


if __name__ == "__main__":
    main()
