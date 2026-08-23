"""Every knob this package reads, resolved once at import, with the reason.

`config.py` is at its ratchet and may not take another field, so these are
module constants off `os.environ` — the shape `modules/research_quota.py`
argues for. They are read ONCE: a horizon grid or a signal floor that can
change under a run is a run whose numbers cannot be compared with yesterday's,
and the whole point of the ledger is that they can.

`_env_float` raises rather than silently reverting, for the reason
`research_quota` gives: a typo'd bound that quietly becomes the default is a
bound nobody can audit. The helpers are copied rather than imported —
`research_stages._bounded_int_env` would drag the re-ranker, its
`asyncio.Semaphore` and `fastembed` into an offline CLI that needs none of
them.
"""

from __future__ import annotations

import os


def _env_float(name: str, default: float) -> float:
    """A float off the environment, or the default. A blank value is unset."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number, got {raw!r}") from None


def _env_int(name: str, default: int, *, low: int, high: int) -> int:
    """An integer off the environment, bounded, or the default.

    Out of range RAISES rather than clamping. An operator who wrote
    `DIFFUSION_PRE_MIN_BARS=0` meant something; running at 1 and saying nothing
    hides the typo behind a number that looks deliberate.
    """
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from None
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}, got {value}")
    return value


def _env_list(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    """A comma-separated list off the environment, or the default."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    return tuple(part.strip().upper() for part in raw.split(",") if part.strip())


#: The assets a macro event is measured against.
#:
#: Crypto, and that is the point rather than a compromise. An FOMC statement
#: lands at 14:00 ET on a Wednesday; BTC and ETH are quoted through it at one
#: minute with no session boundary, no halt and no auction, and Binance serves
#: that history back to 2017 for free. The equity leg of the same question
#: needs minute bars nobody gives away for a date three years ago, so it
#: accumulates forward instead. This arm is the one that can answer the kill
#: question this month.
DIFFUSION_MACRO_ASSETS = _env_list("DIFFUSION_MACRO_ASSETS", ("BTCUSDT", "ETHUSDT"))

#: The benchmark leg for an equity abnormal return. Unused on the crypto arm,
#: where the raw return IS the abnormal return and the run records that.
DIFFUSION_MARKET_SYMBOL = os.environ.get("DIFFUSION_MARKET_SYMBOL", "SPY").strip().upper()

#: Where a stage's own window ends, in minutes from that stage's t0.
#:
#: The SAME number for both stages, and this is a correctness requirement
#: rather than a convenience. Ending the release window where the press
#: conference begins (30 min) while letting the call window run to ten days
#: makes `absorbed(release, 30m)` identically 1 and bounds its half-life below
#: 30 minutes by construction — the comparison would then be arithmetic, not
#: evidence. One terminal, one grid, both stages.
DIFFUSION_STAGE_TERMINAL_MIN = _env_float("DIFFUSION_STAGE_TERMINAL_MIN", 30.0)

#: Sessions of pre-event history used for the volatility scale and for the
#: matched controls.
DIFFUSION_PRE_WINDOW_SESSIONS = _env_int("DIFFUSION_PRE_WINDOW_SESSIONS", 20, low=5, high=90)

#: Bars below which a pre-event volatility is NOT computed.
#:
#: `numpy.std` of one sample is 0.0, not NaN, and a floor of zero passes every
#: signal gate ever written. Refusing is the only honest answer.
DIFFUSION_PRE_MIN_BARS = _env_int("DIFFUSION_PRE_MIN_BARS", 30, low=2, high=5_000)

#: |terminal abnormal return| below this many pre-event sigmas is no signal.
DIFFUSION_SIGNAL_FLOOR_SIGMA = _env_float("DIFFUSION_SIGNAL_FLOOR_SIGMA", 2.0)

#: Matched non-event windows per event, for the exogenous clock and the placebo.
DIFFUSION_CONTROLS_PER_EVENT = _env_int("DIFFUSION_CONTROLS_PER_EVENT", 5, low=0, high=40)

#: Meetings — not (meeting, asset) rows — below which Phase 0 refuses a verdict.
DIFFUSION_PHASE0_MIN_EVENTS = _env_int("DIFFUSION_PHASE0_MIN_EVENTS", 30, low=5, high=500)

#: Bootstrap resamples. Clusters are resampled, never rows: BTC and ETH answer
#: the same statement, so counting them as two observations halves a standard
#: error that was never halved.
DIFFUSION_BOOTSTRAP_DRAWS = _env_int("DIFFUSION_BOOTSTRAP_DRAWS", 2000, low=200, high=50_000)

#: The seed every resample and every shuffle is drawn from.
DIFFUSION_SEED = _env_int("DIFFUSION_SEED", 7, low=0, high=2**31 - 1)

#: Equity session boundary, for the arm that accumulates forward. There is no
#: exchange calendar anywhere in this repository and adding a dependency for a
#: holiday table is the no-new-dependencies rule in reverse, so sessions are
#: derived from the bars that arrived.
DIFFUSION_SESSION_TZ = os.environ.get("DIFFUSION_SESSION_TZ", "America/New_York").strip()
DIFFUSION_SESSION_CLOSE = os.environ.get("DIFFUSION_SESSION_CLOSE", "16:00").strip()

#: Minutes after an earnings release at which the call is ASSUMED to start when
#: no free feed says. Every row records that the number was assumed.
DIFFUSION_CALL_OFFSET_MIN = _env_float("DIFFUSION_CALL_OFFSET_MIN", 60.0)

#: Which rows of a generic macro calendar are an FOMC decision.
DIFFUSION_FOMC_PATTERN = os.environ.get(
    "DIFFUSION_FOMC_PATTERN", r"(?i)\bfomc\b|federal\s+funds\s+rate|fed\s+interest\s+rate"
).strip()
