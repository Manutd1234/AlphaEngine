"""
Module B — Pre-Trade Risk Gateway & Emergency Kill-Switch
=========================================================

Trading alpha
-------------
The expensive failures in an automated desk are not bad signals — they are
operational: a fat-finger extra zero, a strategy that re-fires in a tight loop
after a rejected ack, an exchange ban from rate-limit abuse, a position that
keeps averaging down through a liquidation cascade. Every order therefore
travels through a single choke point that can say *no* in microseconds, and a
human can shut the whole desk down with one Telegram message.

Design principles
-----------------
1. **Deny by default on ambiguity.** If the gateway cannot price an order (no
   live mark) it rejects rather than guesses.
2. **Fail fast, cheapest check first.** The kill switch is one boolean read;
   the slippage check touches the book. Ordering matters when the budget is
   sub-millisecond.
3. **Every decision is evidence.** Accepted *and* rejected orders are written
   to the audit log with the full check vector, so a post-mortem can answer
   "why did this get through?" without re-running anything.
4. **The breaker is automatic.** A human is not required for the drawdown guard
   to trip — a background monitor marks positions to market and halts trading
   on its own.

Implemented vs. mocked: all validation, limits, accounting and the kill switch
are real. Exchange *execution* is mocked — accepted orders are filled against
the live L2 ladder from Module A (paper trading), which is exactly what a
pre-production risk gateway does before it is pointed at a live venue.

Where things live
-----------------
This was one 2,231-line file. It is now a package, cut along the banners that
file already carried:

===========================  ==================================================
``clock.py``                 the one wall clock, and why it is shared
``gates.py``                 the gate registry every mirror and test reads
``identity.py``              order ids, drawn a block at a time
``rate_limit.py``            the token bucket
``positions.py``             one symbol's average-cost accounting
``accounting.py``            marks, P&L, equity, drawdown, exposure
``working_orders.py``        the resting book and the primitives that move it
``working_control.py``       the sweep, the cancels, the replace
``deferred_audit.py``        rows queued under the lock, flushed after it
``execution.py``             the maker and taker paper-fill models
``kill_switch.py``           the hard halt and the reduce-only regime
``native_core.py``           the compiled gate battery and its book mirror
``rehydrate.py``             what a restarted process may claim to know
``monitor.py``               the breaker loop, the session boundary, the sweep
``decision.py``              ``submit`` — the hot path
``read_model.py``            the published state, and the demo reset
``gateway.py``               ``RiskGateway`` itself: construction and lifecycle
===========================  ==================================================

Rebinding a module global
-------------------------
``modules.risk_proxy`` was a single module for long enough that four harnesses —
``tools/gate_fixture.py`` and three test suites — pin a decision by rebinding a
name on it: ``monkeypatch.setattr(risk_proxy, "settings", limits)``,
``monkeypatch.setattr(risk_proxy, "_utcnow", frozen)``, and the flock claim.

Against a package those are no-ops. Not failures — *no-ops*: the attribute lands
on the package, the code keeps reading its own module global, and a harness that
believed it had frozen the clock and clamped every limit runs against wall time
and the deployed configuration while reporting green. That is the exact shape of
the eleven tests that reached a live vendor after a method moved out from under
a ``monkeypatch.setattr(module.httpx, ...)``.

The alternative — every module reading ``config.settings`` through this package
object — costs an attribute lookup per read, and ``submit`` reads twelve of them
inside its timed region. So the seam is preserved instead: setting a name on
this package sets it on every submodule that defines it, which is what setting
it on the single module used to do. ``tests/test_risk_proxy_package.py`` proves
the fan-out reaches the submodules and that a name it fails to reach is a red
test rather than a quiet no-op.
"""

from __future__ import annotations

import sys as _sys
from types import ModuleType as _ModuleType

from config import settings as settings  # noqa: F401
from modules.risk_proxy.clock import _utcnow as _utcnow  # noqa: F401
from modules.risk_proxy.gates import GATE_ORDER as GATE_ORDER  # noqa: F401
from modules.risk_proxy.gateway import RiskGateway as RiskGateway  # noqa: F401
from modules.risk_proxy.gateway import get_gateway as get_gateway  # noqa: F401
from modules.risk_proxy.hooks import AlertHook as AlertHook  # noqa: F401
from modules.risk_proxy.identity import _order_ids as _order_ids  # noqa: F401
from modules.risk_proxy.identity import _OrderIdPool as _OrderIdPool  # noqa: F401
from modules.risk_proxy.kill_switch import KillSwitch as KillSwitch  # noqa: F401
from modules.risk_proxy.positions import PositionState as PositionState  # noqa: F401
from modules.risk_proxy.rate_limit import TokenBucket as TokenBucket  # noqa: F401
from modules.risk_proxy.working_orders import (  # noqa: F401
    WorkingOrderState as WorkingOrderState,
)
from modules.single_writer import claim as claim_single_writer  # noqa: F401

__all__ = [
    "AlertHook",
    "GATE_ORDER",
    "KillSwitch",
    "PositionState",
    "RiskGateway",
    "TokenBucket",
    "WorkingOrderState",
    "claim_single_writer",
    "get_gateway",
    "settings",
]


def submodules() -> list[_ModuleType]:
    """Every imported ``modules.risk_proxy.*`` module, in import order.

    Public because the harnesses that rebind a module global need to be able to
    say *which* modules they reached, and assert that the count is not zero.
    """
    prefix = __name__ + "."
    return [
        module
        for name, module in list(_sys.modules.items())
        if name.startswith(prefix) and isinstance(module, _ModuleType)
    ]


class _RiskProxyPackage(_ModuleType):
    """A package whose module globals still behave like one module's.

    ``setattr`` on this package fans the new value out to every submodule that
    already defines that name as a global — and only to those, so a name no
    submodule reads stays exactly where it was put. Binding a submodule (what
    the import system itself does) is skipped: that is not a global being
    rebound, it is the package being assembled.

    ``monkeypatch.undo`` restores through the same path, because it restores by
    ``setattr`` on the same target.
    """

    def __setattr__(self, name: str, value: object) -> None:
        _ModuleType.__setattr__(self, name, value)
        if isinstance(value, _ModuleType):
            return
        for module in submodules():
            if name in vars(module):
                _ModuleType.__setattr__(module, name, value)


_sys.modules[__name__].__class__ = _RiskProxyPackage
