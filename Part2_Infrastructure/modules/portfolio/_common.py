"""Shared arithmetic for the portfolio view: percentages and limit headroom.

Split out of ``modules/portfolio.py``. Three functions, no state, no I/O — so
the four view modules cannot each grow their own rounding convention.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("alphaengine.portfolio")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _pct(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def _headroom(used: float, limit: float) -> dict[str, float]:
    """How much of a limit is left, and how close we are to it."""
    return {
        "used": round(used, 2),
        "limit": round(limit, 2),
        "remaining": round(max(0.0, limit - used), 2),
        "utilisation": round(_pct(used, limit), 4),
    }
