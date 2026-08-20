"""Historical VaR and expected shortfall: the empirical twin of the
parametric figure.

``HistoricalVaR.bootstrap`` was already how every caller used the pair —
``bootstrap_terminal_distribution(list(hv.daily_pnl), horizon, ...)`` in
``/montecarlo`` is a caller reaching into an object for the field it should
have been able to ask for. The maths did not move: it is still
:func:`~modules.quant_risk.montecarlo.bootstrap_terminal_distribution`, and
``historical_var`` below is still a free factory, because a function that
may decline to build the object is not a constructor.

The Monte Carlo half moved to ``montecarlo.py`` when the two stopped
fitting under the file-size ceiling. Its names are re-exported here: the
package has exported them from this path since it was one module, and
``tests/test_mc_resampler.py`` imports ``_loss_band`` from it by name.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from modules.quant_risk._common import (
    _mean,
)
from modules.quant_risk.montecarlo import RESAMPLERS as RESAMPLERS  # noqa: F401
from modules.quant_risk.montecarlo import LossBand as LossBand  # noqa: F401
from modules.quant_risk.montecarlo import MonteCarlo as MonteCarlo  # noqa: F401
from modules.quant_risk.montecarlo import _loss_band as _loss_band  # noqa: F401
from modules.quant_risk.montecarlo import _nearest_rank as _nearest_rank  # noqa: F401
from modules.quant_risk.montecarlo import _resolve_resampler as _resolve_resampler  # noqa: F401
from modules.quant_risk.montecarlo import (  # noqa: F401
    bootstrap_terminal_distribution as bootstrap_terminal_distribution,
)
from modules.quant_risk.montecarlo import derived_block_length as derived_block_length  # noqa: F401

# --------------------------------------------------------------------------- #
# Historical VaR — the empirical twin of the parametric figure
#
# The parametric number assumes returns are normal. Crypto returns are not: the
# tail is fatter, so the normal figure understates the loss in exactly the
# conditions a risk manager cares about. Reporting both, side by side, makes
# that gap visible instead of a hidden modelling choice. Ported from
# `historicalVar` in web/lib/portfolio-risk.ts, same conventions.
# --------------------------------------------------------------------------- #

@dataclass
class HistoricalVaR:
    var95: float
    cvar95: float
    observations: int
    # The replayed per-day P&L behind the quantiles above. Default-valued so no
    # existing caller changes; it exists because the distribution is worth
    # showing and recomputing it elsewhere would risk a second, disagreeing
    # answer. Sorted ascending, i.e. worst first.
    daily_pnl: tuple[float, ...] = ()

    def bootstrap(self, horizon: int, **kwargs) -> "MonteCarlo | None":
        """Resample *this* book's replayed P&L ``horizon`` bars forward.

        The series a Monte Carlo should resample is the one the historical
        figure was read off, so that the two are describing one distribution
        rather than two. Every caller was already spelling that out —
        ``bootstrap_terminal_distribution(list(hv.daily_pnl), horizon, ...)`` in
        ``/montecarlo`` — which is a caller reaching into an object for the
        field it should have been able to ask.

        ``kwargs`` are :func:`bootstrap_terminal_distribution`'s, unchanged and
        undocumented here on purpose: one signature, described in one place.
        """
        return bootstrap_terminal_distribution(self.daily_pnl, horizon, **kwargs)


def historical_var(
    positions: Sequence[Mapping[str, Any]],
    returns_by_symbol: Mapping[str, Sequence[float]],
    equity: float,
) -> HistoricalVaR | None:
    """Replay today's book through history and read the 5th-percentile day.

    No distribution is assumed: the book's *current* weights are applied to each
    past day's returns, and the loss that is worse than 95% of those days is the
    VaR. CVaR is the mean of the tail beyond it — the number that answers "and
    how bad is it when it is bad", which VaR alone never does.

    Requires at least 20 aligned observations; below that a percentile is a
    single data point wearing a statistic's name, and ``None`` is the honest
    answer.
    """
    usable = [
        p for p in positions
        if len(returns_by_symbol.get(str(p.get("symbol")), ())) >= 20
    ]
    if not usable or equity <= 0:
        return None

    window = min(len(returns_by_symbol[str(p.get("symbol"))]) for p in usable)
    if window < 20:
        return None

    daily_pnl: list[float] = []
    for t in range(window):
        total = 0.0
        for p in usable:
            symbol = str(p.get("symbol"))
            series = returns_by_symbol[symbol]
            direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
            signed = direction * abs(float(p.get("notional") or 0.0))
            total += signed * series[len(series) - window + t]
        daily_pnl.append(total)

    daily_pnl.sort()
    k = max(1, math.ceil(0.05 * len(daily_pnl)))
    tail = daily_pnl[:k]
    return HistoricalVaR(
        # Reported positive-as-loss so it reads beside the parametric figure.
        var95=-daily_pnl[k - 1],
        cvar95=-_mean(tail),
        observations=window,
        daily_pnl=tuple(daily_pnl),
    )
