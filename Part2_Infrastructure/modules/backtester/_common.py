"""Bars-per-year, the clock, and whether vectorbt is here.

The vectorbt probe lives here rather than in `engines` because a run that
fell back to the NumPy engine is a DIFFERENT run, and the flag saying so is
read by the result envelope and the health payload as well as by the engine
chooser. One import attempt, one answer, one place.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("alphaengine.backtest")

_BARS_PER_YEAR = {
    "1m": 525_600, "5m": 105_120, "15m": 35_040, "30m": 17_520,
    "1h": 8_760, "2h": 4_380, "4h": 2_190, "6h": 1_460, "12h": 730,
    "1d": 365, "1w": 52,
}

try:  # pragma: no cover - availability differs per environment
    import vectorbt as vbt

    VECTORBT_AVAILABLE = True
except Exception as _exc:  # pragma: no cover
    vbt = None
    VECTORBT_AVAILABLE = False
    log.info("vectorbt unavailable (%s) — using the built-in NumPy engine", _exc)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def bars_per_year(interval: str) -> float:
    return float(_BARS_PER_YEAR.get(interval, 8_760))
