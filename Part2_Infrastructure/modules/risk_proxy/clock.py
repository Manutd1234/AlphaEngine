"""The one wall clock every part of the gateway reads.

Its own module for a reason that outlives the split. ``_utcnow`` is patched by
the gate-parity harness and by the session/rehydration suites to pin a decision
to a fixed instant, and a clock that each module defined for itself would let
two of them disagree about what "now" is inside a single decision.

Bound by ``from ... import _utcnow`` at every call site rather than reached
through this module object: the decision path calls it inside its own timed
region, and a module attribute lookup there is an indirection the microsecond
budget does not have. Rebinding it therefore has to reach every module that
imported it — which is what ``modules/risk_proxy/__init__.py`` arranges.
"""

from __future__ import annotations

from datetime import datetime, timezone


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
