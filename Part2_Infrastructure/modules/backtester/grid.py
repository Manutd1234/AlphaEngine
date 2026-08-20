"""The parameter axes a sweep walks."""

from __future__ import annotations

import logging
import math

from config import settings
from modules.backtester.indicators import FREE_FIRST_AXIS, FREE_SECOND_AXIS
from modules.schemas import (
    BacktestRequest,
)

log = logging.getLogger("alphaengine.backtest")

def _axis(low: float, high: float, step: float) -> list[float]:
    """Inclusive range that tolerates a float step.

    `range` is integer-only and `numpy.arange` accumulates error — at step 0.25
    it lands on 2.7499999999999996 and a reader comparing a slider to a result
    sees two different numbers. Multiplying an integer index avoids both.
    """
    if step <= 0:
        return [low]
    count = int(math.floor((high - low) / step + 1e-9)) + 1
    values = [round(low + index * step, 10) for index in range(max(1, count))]
    # Integral axes stay ints. `pandas.rolling()` rejects a float window
    # outright — "window must be an integer 0 or greater" — so returning 5.0
    # where 5 was meant breaks every period-based strategy. It surfaced only as
    # a logged warning from walk-forward, because the parity fixture passes
    # literal ints and never exercised the generated grid.
    if all(float(v).is_integer() for v in (low, high, step)):
        return [int(v) for v in values]
    return values


def param_grid(req: BacktestRequest) -> list[tuple[float, float]]:
    free_fast = FREE_FIRST_AXIS.get(req.strategy)
    fasts = _axis(*free_fast) if free_fast is not None else _axis(req.fast_min, req.fast_max, req.fast_step)

    free = FREE_SECOND_AXIS.get(req.strategy)
    if free is not None:
        # The request's slow_* fields describe a period sweep the UI generated
        # for a period axis. For these strategies the second axis has its own
        # units, so the registry supplies the range and the ordering constraint
        # does not apply — the two numbers are not comparable quantities.
        slows = _axis(*free)
        combos = [(f, s) for f in fasts for s in slows]
    else:
        slows = _axis(req.slow_min, req.slow_max, req.slow_step)
        combos = [(f, s) for f in fasts for s in slows if free_fast is not None or f < s]

    if len(combos) > settings.backtest_max_combos:
        step = math.ceil(len(combos) / settings.backtest_max_combos)
        combos = combos[::step]
    return combos
