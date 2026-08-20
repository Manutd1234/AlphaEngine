"""Historical VaR, expected shortfall, and the bootstrap terminal distribution."""

from __future__ import annotations

import math
import random
import zlib
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from modules.quant_risk._common import (
    _mean,
)

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


# --------------------------------------------------------------------------- #
# Monte Carlo — bootstrap of the terminal book P&L over a horizon
#
# A single-horizon VaR answers "how bad is one bad bar". A desk closing a
# position over several bars wants the *distribution of where the book lands*,
# and the honest way to get it without assuming a shape is to resample the days
# the book actually lived through. This is an i.i.d. bootstrap: draw ``horizon``
# daily P&L figures with replacement, sum them into a path, repeat. Its one
# stated limit is that it forgets the ordering — a real drawdown clusters, and a
# resample that treats each day as independent understates a losing streak. That
# is why the number is reported beside the historical figure rather than instead
# of it.
# --------------------------------------------------------------------------- #

@dataclass
class MonteCarlo:
    horizon: int
    paths: int
    seed: int
    observations: int
    #: Sorted-ascending terminal cumulative P&L across every simulated path.
    terminal_pnl: tuple[float, ...]
    #: Positive-as-loss, read off the terminal distribution's 5th percentile.
    var95: float
    cvar95: float
    #: Per-step cumulative-P&L percentile bands, each length ``horizon``. The
    #: fan a cone chart draws; p50 is the median path, the outer pair the 5/95.
    p5: tuple[float, ...]
    p25: tuple[float, ...]
    p50: tuple[float, ...]
    p75: tuple[float, ...]
    p95: tuple[float, ...]
    #: Mean block length of the stationary bootstrap, in bars. 1 is an i.i.d.
    #: draw — what this function did exclusively until blocks were added, and
    #: what it still does by default so the figure a desk has been reading does
    #: not change under it. Defaulted, so it sits last.
    mean_block_length: int = 1


def _nearest_rank(sorted_values: Sequence[float], q: float) -> float:
    """The value some observation actually took — the same nearest-rank rule
    ``metrics._quantile`` and both TypeScript stacks use, so no two percentiles
    in this repo are computed two different ways."""
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, max(0, math.ceil(q * len(sorted_values)) - 1))
    return sorted_values[index]


def bootstrap_terminal_distribution(
    book_returns_usd: Sequence[float],
    horizon: int,
    *,
    paths: int = 2000,
    seed: int | None = None,
    mean_block_length: int = 1,
) -> MonteCarlo | None:
    """I.i.d. bootstrap of the book's cumulative P&L ``horizon`` bars out.

    ``book_returns_usd`` is the book's realised per-bar P&L in dollars — the
    same series ``historical_var`` replays, so the Monte Carlo and the
    historical VaR are resampling one distribution rather than two. Each of
    ``paths`` simulations draws ``horizon`` of those figures with replacement
    and accumulates them; the terminal values become the P&L distribution and
    the per-step percentiles become the cone.

    Returns ``None`` below 60 observations: a bootstrap cannot manufacture tail
    shape a short sample never showed, and a cone drawn from a dozen days would
    give false confidence to noise.

    ``mean_block_length`` selects the resampler, and 1 — the default — is the
    i.i.d. draw this function did exclusively until blocks were added. It stays
    the default so the figure a desk has been reading does not change under it.

    Above 1 it is the stationary bootstrap (Politis & Romano 1994): blocks of
    geometric length with the given expected size, which is the same resampler
    the workspace's equity band uses. That matters because the two sides
    otherwise answer the same question with different methods and neither says
    so.

    The method's limit, stated plainly, and it is the reason blocks exist:
    an i.i.d. draw has **no volatility clustering**. It assumes each future bar
    is an independent draw from the past, which understates a sustained
    drawdown where losses arrive in runs. Report either beside the historical
    figure, never as a replacement.

    ``seed`` defaults to ``zlib.crc32`` of the input series, so a refresh with
    the same book redraws the same cone — reproducible without a stored state.
    """
    usable = [float(value) for value in book_returns_usd if value is not None and value == value]
    if len(usable) < 60 or horizon < 1:
        return None
    horizon = int(min(horizon, 60))
    paths = int(max(200, min(paths, 20_000)))

    if seed is None:
        payload = ",".join(f"{value:.6g}" for value in usable).encode("utf-8")
        seed = zlib.crc32(payload)
    rng = random.Random(seed)

    # Column t across every path, so a percentile can be read per step. Bounded
    # memory: horizon <= 60 and paths <= 20k.
    steps: list[list[float]] = [[] for _ in range(horizon)]
    terminal: list[float] = []
    n = len(usable)
    block = max(1, min(int(mean_block_length), max(1, n)))

    if block == 1:
        # The i.i.d. draw, UNCHANGED, and separated on purpose.
        #
        # The block loop below consumes two rng values per step (a uniform to
        # decide whether to start a block, then an index) where this consumes
        # one. Routing block == 1 through it would therefore produce a
        # different sequence for the same seed — every existing Monte Carlo
        # figure would move, silently, with no code that looks like it changed
        # a number. The default must stay bit-for-bit what it was.
        for _ in range(paths):
            running = 0.0
            for t in range(horizon):
                running += usable[rng.randrange(n)]
                steps[t].append(running)
            terminal.append(running)
    else:
        # Stationary bootstrap: with probability 1/block start a new block at a
        # uniform position, otherwise continue sequentially and wrap, so
        # end-of-sample bars are not under-drawn. The same convention — and the
        # same two-draws-per-step order — as lib/montecarlo.ts.
        p_new = 1.0 / block
        for _ in range(paths):
            running = 0.0
            cursor = rng.randrange(n)
            for t in range(horizon):
                if t > 0:
                    cursor = rng.randrange(n) if rng.random() < p_new else (cursor + 1) % n
                running += usable[cursor]
                steps[t].append(running)
            terminal.append(running)

    terminal.sort()
    k = max(1, math.ceil(0.05 * len(terminal)))
    tail = terminal[:k]

    def band(q: float) -> tuple[float, ...]:
        return tuple(_nearest_rank(sorted(column), q) for column in steps)

    return MonteCarlo(
        horizon=horizon,
        paths=paths,
        seed=int(seed),
        observations=n,
        mean_block_length=block,
        terminal_pnl=tuple(terminal),
        var95=-terminal[k - 1],
        cvar95=-_mean(tail),
        p5=band(0.05),
        p25=band(0.25),
        p50=band(0.50),
        p75=band(0.75),
        p95=band(0.95),
    )
