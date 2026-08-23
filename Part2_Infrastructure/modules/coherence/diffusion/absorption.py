"""The abnormal-return path after one stage of one announcement.

The measurement, in one line: how much of the move that this stage eventually
produced had already happened by each horizon.

Four decisions are load-bearing and each one had an obvious alternative.

**One terminal for both stages.** `absorbed(h) = ar(h) / ar(T*)`, and `T*` is
the SAME number of minutes from each stage's own t0. Ending the release window
where the press conference starts and letting the conference window run to ten
days would make `absorbed(release, T_release)` identically one and bound the
release half-life below thirty minutes by construction; the two stages would
then differ because of the grid, and the bootstrap would confirm it with any
data at all. The cost of one terminal is that the release stage's late
horizons overlap the conference; that overlap is a modelling problem, and a
modelling problem is better than a tautology.

**The denominator is not clipped.** A path that overshoots and comes back has
`absorbed > 1` somewhere, and that is a real thing markets do. Clipping to
[0, 1] would turn every overshoot into "fully absorbed early" and make the
half-life shorter than it was.

**A horizon the data cannot resolve is a state, not a gap.** `1s` and `30s`
stay in the grid and report `unavailable` with the reason, because the study
was specified over them and a reader must see that they were not measured
rather than not asked.

**The signal gate needs a scale, and a scale needs samples.** `numpy.std` of
one observation is `0.0`, so a floor of `2 sigma` with no pre-window admits
every event. Below `DIFFUSION_PRE_MIN_BARS` the scale is `None` and the report
says `insufficient_pre_window`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from modules.coherence.diffusion import tunables
from modules.coherence.diffusion.bars import BarSeries, log_returns, price_at

CellState = Literal["ok", "pending", "uncaptured", "insufficient", "unavailable"]
SignalState = Literal["ok", "no_signal", "insufficient_pre_window", "unavailable"]

#: Sub-minute horizons are kept and always refused: the v2 grid asked for them
#: and no free source resolves them, which the reader is entitled to see.
_SUB_MINUTE_REASON = "no sub-minute bar source is configured, so this horizon was never measured"


@dataclass(frozen=True)
class Horizon:
    """One point on the grid, and the coarsest interval that can resolve it."""

    label: str
    seconds: float
    #: A horizon is only measurable when at least this many bars fit inside it.
    min_bars: int = 1


#: The stage grid: measured from EACH stage's own t0, and shared by both so the
#: two are commensurable. `DIFFUSION_STAGE_TERMINAL_MIN` is the last entry.
STAGE_HORIZONS: tuple[Horizon, ...] = (
    Horizon("1s", 1.0),
    Horizon("30s", 30.0),
    Horizon("1m", 60.0),
    Horizon("2m", 120.0),
    Horizon("5m", 300.0),
    Horizon("10m", 600.0),
    Horizon("15m", 900.0),
    Horizon("30m", 1_800.0),
)

#: The event grid: measured from the RELEASE t0 only, because they describe the
#: announcement as a whole rather than one of its stages.
EVENT_HORIZONS: tuple[Horizon, ...] = (
    Horizon("2h", 7_200.0),
    Horizon("1d", 86_400.0),
    Horizon("3d", 259_200.0),
    Horizon("10d", 864_000.0),
)


@dataclass(frozen=True)
class HorizonPoint:
    """One cell of the horizon table, including the ones that are not numbers."""

    horizon: str
    state: CellState
    at_ms: int | None = None
    price: float | None = None
    log_return: float | None = None
    market_log_return: float | None = None
    abnormal_return: float | None = None
    absorbed: float | None = None
    bars: int | None = None
    reason: str | None = None


@dataclass(frozen=True)
class PathReport:
    """One (event, stage, asset, interval) path, with why each part is missing."""

    symbol: str
    interval: str
    stage: str
    t0_ms: int
    terminal_horizon: str
    p0: float | None = None
    p0_bar_ts: int | None = None
    points: tuple[HorizonPoint, ...] = ()
    terminal_return: float | None = None
    sigma_pre_per_bar: float | None = None
    sigma_pre_at_terminal: float | None = None
    pre_bars: int = 0
    signal_state: SignalState = "unavailable"
    signal_reason: str | None = None
    market_adjusted: bool = False
    data_hash: str | None = None
    extras: dict[str, object] = field(default_factory=dict)

    def absorbed_at(self, horizon: str) -> float | None:
        for point in self.points:
            if point.horizon == horizon:
                return point.absorbed
        return None

    def measured_horizons(self) -> int:
        return sum(1 for point in self.points if point.state == "ok")


def _pre_window_sigma(asset: BarSeries, t0_ms: int, *, sessions: int, min_bars: int
                      ) -> tuple[float | None, int]:
    """Per-bar volatility before the event, and the bar count behind it."""
    step = asset.step_ms
    span = int(sessions) * 86_400_000
    window = asset.slice(t0_ms - span, t0_ms - step)
    returns = log_returns(window)
    if returns.size < min_bars:
        return None, int(returns.size)
    return float(np.std(returns, ddof=1)), int(returns.size)


def _cell(horizon: Horizon, asset: BarSeries, market: BarSeries | None, t0_ms: int,
          p0: float, m0: float | None, now_ms: int | None) -> HorizonPoint:
    if horizon.seconds < asset.step_ms / 1000.0:
        return HorizonPoint(horizon.label, "unavailable", reason=_SUB_MINUTE_REASON)
    at = t0_ms + int(horizon.seconds * 1000)
    if now_ms is not None and at > now_ms:
        return HorizonPoint(horizon.label, "pending", at_ms=at,
                            reason="the clock has not reached this horizon yet")
    # Coverage first, and this is the subtle one. `price_at` answers with the
    # last bar to FINISH before the horizon, which is right when the series
    # spans it and silently wrong when the series stops short: a capture that
    # ended three minutes after the event would otherwise report its last
    # price at every later horizon, and the terminal move — the denominator of
    # every absorbed fraction — would be a stale quote.
    if len(asset) == 0 or int(asset.end_ts[-1]) < at:
        return HorizonPoint(horizon.label, "uncaptured", at_ms=at,
                            reason="the captured window ends before this horizon")
    found = price_at(asset, at)
    if found is None:
        return HorizonPoint(horizon.label, "uncaptured", at_ms=at,
                            reason="no bar had finished by this horizon in the captured window")
    price, _bar_ts = found
    bars = int(np.count_nonzero((asset.end_ts > t0_ms) & (asset.end_ts <= at)))
    if bars < horizon.min_bars or price <= 0 or p0 <= 0:
        return HorizonPoint(horizon.label, "insufficient", at_ms=at, price=price, bars=bars,
                            reason=f"{bars} bars inside the horizon is below the floor of {horizon.min_bars}")
    asset_return = float(np.log(price / p0))
    market_return: float | None = None
    if market is not None and m0 is not None and m0 > 0:
        market_found = price_at(market, at)
        if market_found is not None and market_found[0] > 0:
            market_return = float(np.log(market_found[0] / m0))
    abnormal = asset_return if market_return is None else asset_return - market_return
    return HorizonPoint(horizon.label, "ok", at_ms=at, price=price, log_return=asset_return,
                        market_log_return=market_return, abnormal_return=abnormal, bars=bars)


def abnormal_path(
    asset: BarSeries,
    t0_ms: int,
    *,
    stage: str,
    market: BarSeries | None = None,
    horizons: tuple[Horizon, ...] = STAGE_HORIZONS,
    now_ms: int | None = None,
    pre_sessions: int | None = None,
    pre_min_bars: int | None = None,
    floor_sigma: float | None = None,
) -> PathReport:
    """The path, its terminal move, and whether that move cleared the noise.

    `market` is the benchmark leg. On the crypto arm there is none and the raw
    return IS the abnormal return; `market_adjusted` records which happened so
    a later reader cannot mistake one for the other.
    """
    pre_sessions = tunables.DIFFUSION_PRE_WINDOW_SESSIONS if pre_sessions is None else pre_sessions
    pre_min_bars = tunables.DIFFUSION_PRE_MIN_BARS if pre_min_bars is None else pre_min_bars
    floor_sigma = tunables.DIFFUSION_SIGNAL_FLOOR_SIGMA if floor_sigma is None else floor_sigma
    terminal = horizons[-1]

    anchored = price_at(asset, t0_ms)
    if anchored is None:
        return PathReport(
            symbol=asset.symbol, interval=asset.interval, stage=stage, t0_ms=t0_ms,
            terminal_horizon=terminal.label, signal_state="unavailable",
            signal_reason=asset.reason or "no bar had finished by the stage timestamp",
            data_hash=asset.data_hash() if len(asset) else None,
        )
    p0, p0_bar_ts = anchored
    m0 = None
    if market is not None:
        market_anchor = price_at(market, t0_ms)
        m0 = market_anchor[0] if market_anchor is not None else None

    points = tuple(_cell(horizon, asset, market, t0_ms, p0, m0, now_ms) for horizon in horizons)
    sigma_bar, pre_bars = _pre_window_sigma(asset, t0_ms, sessions=pre_sessions, min_bars=pre_min_bars)

    terminal_point = next((point for point in points if point.horizon == terminal.label), None)
    terminal_return = terminal_point.abnormal_return if terminal_point is not None else None
    sigma_terminal: float | None = None
    if sigma_bar is not None:
        bars_to_terminal = max(1.0, terminal.seconds * 1000.0 / asset.step_ms)
        sigma_terminal = sigma_bar * float(np.sqrt(bars_to_terminal))

    signal_state, signal_reason = _judge(terminal_return, sigma_bar, sigma_terminal, floor_sigma,
                                         pre_bars, pre_min_bars)
    absorbed_points = _with_absorbed(points, terminal_return) if signal_state == "ok" else points

    return PathReport(
        symbol=asset.symbol, interval=asset.interval, stage=stage, t0_ms=t0_ms,
        terminal_horizon=terminal.label, p0=p0, p0_bar_ts=p0_bar_ts, points=absorbed_points,
        terminal_return=terminal_return, sigma_pre_per_bar=sigma_bar,
        sigma_pre_at_terminal=sigma_terminal, pre_bars=pre_bars,
        signal_state=signal_state, signal_reason=signal_reason,
        market_adjusted=market is not None and m0 is not None,
        data_hash=asset.data_hash(),
    )


def _judge(terminal_return: float | None, sigma_bar: float | None, sigma_terminal: float | None,
           floor_sigma: float, pre_bars: int, pre_min_bars: int) -> tuple[SignalState, str | None]:
    if terminal_return is None:
        return "unavailable", "the terminal horizon was not measured, so there is no move to divide by"
    if sigma_bar is None or sigma_terminal is None:
        return ("insufficient_pre_window",
                f"{pre_bars} pre-event returns is below the floor of {pre_min_bars}, so there is no scale")
    if abs(terminal_return) < floor_sigma * sigma_terminal:
        return ("no_signal",
                f"the terminal move is {abs(terminal_return) / sigma_terminal:.2f} pre-event sigmas, "
                f"below the floor of {floor_sigma:g}")
    return "ok", None


def _with_absorbed(points: tuple[HorizonPoint, ...], terminal_return: float | None
                   ) -> tuple[HorizonPoint, ...]:
    if not terminal_return:
        return points
    filled: list[HorizonPoint] = []
    for point in points:
        if point.state != "ok" or point.abnormal_return is None:
            filled.append(point)
            continue
        filled.append(HorizonPoint(
            point.horizon, point.state, at_ms=point.at_ms, price=point.price,
            log_return=point.log_return, market_log_return=point.market_log_return,
            abnormal_return=point.abnormal_return,
            absorbed=point.abnormal_return / terminal_return,
            bars=point.bars, reason=point.reason,
        ))
    return tuple(filled)
