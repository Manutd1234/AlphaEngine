"""``RiskGateway`` — the single choke point every order travels through.

The class itself is assembly: construction, the process lifecycle, and the
composition of the mixins that hold the behaviour. Each mixin lives beside the
concern it serves — ``decision.py`` the hot path, ``kill_switch.py`` the halt,
``working_orders.py`` the resting book — and none of them overrides another, so
the MRO here is a declaration of what a gateway is made of rather than a
resolution order anyone has to reason about.

Composed rather than delegated on purpose. A gateway built from collaborator
objects would put an attribute hop in front of ``self.mark()`` and
``self.working_qty()``, both of which the decision path calls inside its own
timed region. Mixins resolve through the type's method cache exactly as methods
on one class do, so the split costs the decision nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque
from datetime import datetime

from config import settings
from modules.risk_proxy.accounting import AccountingMixin
from modules.risk_proxy.clock import _utcnow
from modules.risk_proxy.decision import DecisionMixin
from modules.risk_proxy.deferred_audit import DeferredAuditMixin
from modules.risk_proxy.execution import ExecutionMixin
from modules.risk_proxy.hooks import AlertHook, HookMixin
from modules.risk_proxy.kill_switch import KillSwitch, KillSwitchMixin
from modules.risk_proxy.monitor import MonitorMixin
from modules.risk_proxy.native_core import NativeCoreMixin
from modules.risk_proxy.positions import PositionState
from modules.risk_proxy.rate_limit import TokenBucket
from modules.risk_proxy.read_model import ReadModelMixin
from modules.risk_proxy.rehydrate import RehydrationMixin
from modules.risk_proxy.working_control import WorkingOrderControlMixin
from modules.risk_proxy.working_orders import WorkingBookMixin, WorkingOrderState
from modules.single_writer import claim as claim_single_writer

log = logging.getLogger("alphaengine.risk")


class RiskGateway(
    NativeCoreMixin,
    RehydrationMixin,
    HookMixin,
    AccountingMixin,
    WorkingBookMixin,
    WorkingOrderControlMixin,
    DeferredAuditMixin,
    ExecutionMixin,
    KillSwitchMixin,
    MonitorMixin,
    DecisionMixin,
    ReadModelMixin,
):
    def __init__(self, tca_engine=None, audit=None) -> None:
        self.tca = tca_engine
        self.audit = audit
        self.kill = KillSwitch()
        self.bucket = TokenBucket(settings.max_orders_per_sec, settings.rate_limit_burst)
        # Built once. The whitelist gate runs on every order, and reading it
        # from `settings` there meant rebuilding a list and re-uppercasing each
        # configured symbol per order. Read here rather than at import so a test
        # that patches `settings` before constructing the proxy still sees its
        # own symbols.
        self._whitelist: frozenset[str] = frozenset(s.upper() for s in settings.symbols)
        #: Latched so the drawdown warning fires on entering the band, not on
        #: every tick spent inside it. Cleared at the rollover with everything
        #: else that is scoped to a session.
        self._drawdown_warned: bool = False
        self.positions: dict[str, PositionState] = {}
        # Last trusted server-side equity quote per held symbol. Crypto marks
        # still come from Module A and always take precedence in ``mark``.
        self._paper_marks: dict[str, float] = {}
        # Per-decision memo for `mark()`. Set to a dict at the top of `submit`
        # and back to None on exit, so a decision that marks the same symbol
        # five times (price discovery, gross exposure, drawdown, price band,
        # est_slippage) consolidates the book once. None outside `submit`
        # keeps `_monitor_loop` and `state()` reading live.
        self._mark_memo: dict[str, float | None] | None = None
        # The core's own timing of the last decision, once a native engine
        # exists; the bench harness reads it, the API does not carry it.
        self.last_decision_core_ns: int | None = None
        # The native decision core, or None when the Python reference is the
        # active engine. Resolved through ``sys.modules`` (not a bound name) so
        # the bench harness, which re-imports ``modules.decision_core`` per
        # engine, gets the module it just selected rather than a stale one.
        self._decision_core = self._resolve_decision_core()
        #: The held book, mirrored in C++. Mutated where positions actually
        #: change — a fill, a paper execution, a restore from the audit log —
        #: rather than rebuilt per order, which is the whole reason it exists.
        #: None when no native core is active; every reader handles that.
        self._position_book = (
            self._decision_core.PositionBook() if self._decision_core is not None else None
        )
        #: Which venues were LIVE for each held symbol when the mirror last
        #: took its ladder pointers. The pointers themselves are stable — a
        #: BookState's ladder object outlives every tick, so the feed mutating
        #: a ladder needs no resync at all. What does need noticing is
        #: TCAEngine._live_books changing its mind: it filters on has_book and
        #: staleness, so a venue can drop out of a consolidation with no fill
        #: and no disconnection, just a feed going quiet. -1 marks the mirror
        #: abandoned.
        self._position_book_live: dict[str, tuple[str, ...]] | None = None
        self.start_of_day_equity = settings.starting_equity_usd
        self.session_date = _utcnow().strftime("%Y-%m-%d")
        # Realized P&L banked by sessions that have already closed.
        #
        # ``PositionState.realized_pnl`` is deliberately session-scoped — it is
        # zeroed at every rollover so "realized" means the same thing in the
        # state payload, the blotter and the attribution table. Something has to
        # hold the money those closed sessions actually made, or the account
        # forgets it the instant the UTC date changes.
        #
        # Zero here is only the pre-restore default. It is *not* the value a
        # restarted process keeps: ``_restore_session_baseline_from_audit`` reads
        # the carry back off the durable rollover record below, because
        # ``_restore_positions_from_audit`` replays this session's fills and
        # nothing else, and an opening carry of zero after a rollover would drop
        # every earlier session's money on the floor.
        self.carried_realized_pnl = 0.0
        self._reduce_only_override: bool = False
        self.orders_accepted = 0
        self.orders_rejected = 0
        # The resting book. Live state only: it is deliberately not persisted,
        # because a single-instance paper gateway cannot honour a recovery
        # guarantee, and resurrecting a resting order at a stale price after a
        # restart is worse than cancelling it and saying so.
        self.working: dict[str, WorkingOrderState] = {}
        # The last fill timestamp stamped per symbol. `accepted_fills_for_session`
        # raises on two same-symbol fills sharing a timestamp, and a sweep that
        # fills several orders in one symbol reads the clock once — so the stamps
        # are nudged apart here rather than discovered at the next restart.
        self._last_fill_stamp: dict[str, datetime] = {}
        # Audit rows produced while the lock is held, flushed once it is released.
        self._deferred_audit: list = []
        self._seen_client_ids: deque[str] = deque(maxlen=5000)
        self._seen_set: set[str] = set()
        self._alert_hooks: list[AlertHook] = []
        self._decision_hooks: list = []
        self._monitor: asyncio.Task | None = None
        self._working_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        # Baseline first, positions second. The baseline is what today's replayed
        # fills are measured *against*, and restoring it afterwards would leave a
        # window — however short — in which `daily_drawdown_pct()` divided a real
        # loss by the wrong denominator.
        self._restore_session_baseline_from_audit()
        self._restore_positions_from_audit()

    # -- process lifecycle ------------------------------------------------ #
    async def start(self) -> None:
        claim_single_writer()  # raises if a second process already owns this DATA_DIR
        self._monitor = asyncio.create_task(self._monitor_loop(), name="risk-monitor")
        self._working_task = asyncio.create_task(self._working_loop(), name="risk-working-orders")

    async def stop(self) -> None:
        for task in (self._monitor, self._working_task):
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        # Resting orders do not survive the process. Persisting them would claim
        # a recovery guarantee a single-instance paper gateway cannot honour, and
        # a resurrected order carries a price nobody has re-checked.
        if self.working:
            await self.cancel_all_working("gateway shutdown", actor="system")


_gateway: RiskGateway | None = None


def get_gateway() -> RiskGateway:
    global _gateway
    if _gateway is None:
        from modules.audit import get_audit
        from modules.tca_engine import get_engine

        _gateway = RiskGateway(tca_engine=get_engine(), audit=get_audit())
    return _gateway
