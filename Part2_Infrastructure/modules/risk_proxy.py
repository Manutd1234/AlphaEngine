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
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from config import settings
from modules.schemas import (
    CheckResult,
    Fill,
    OrderAck,
    OrderRequest,
    Position,
    ReplaceRequest,
    RiskDecision,
    RiskState,
    WorkingOrder,
)

log = logging.getLogger("alphaengine.risk")

AlertHook = Callable[[str, str], Awaitable[None]]  # (severity, message)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
class TokenBucket:
    """Classic token bucket: ``rate`` sustained ops/sec with ``burst`` capacity.

    Chosen over a fixed window because a fixed window lets 2x the limit through
    across a boundary — precisely the pattern that triggers exchange bans.
    """

    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.capacity = float(burst)
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self.recent = deque(maxlen=256)  # timestamps, for observability

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_consume(self, amount: float = 1.0) -> bool:
        self._refill()
        if self.tokens >= amount:
            self.tokens -= amount
            self.recent.append(time.monotonic())
            return True
        return False

    def observed_rate(self, window_s: float = 1.0) -> float:
        cutoff = time.monotonic() - window_s
        return sum(1 for t in self.recent if t >= cutoff) / window_s


# --------------------------------------------------------------------------- #
# Paper position book
# --------------------------------------------------------------------------- #
@dataclass
class PositionState:
    symbol: str
    quantity: float = 0.0
    avg_price: float = 0.0
    realized_pnl: float = 0.0

    def apply_fill(self, side: str, qty: float, price: float, fee: float) -> None:
        signed = qty if side == "BUY" else -qty
        self.realized_pnl -= fee

        if self.quantity == 0 or (self.quantity > 0) == (signed > 0):
            # opening or adding
            total_cost = self.avg_price * abs(self.quantity) + price * qty
            self.quantity += signed
            self.avg_price = total_cost / abs(self.quantity) if self.quantity else 0.0
        else:
            # reducing / flipping
            closing = min(abs(signed), abs(self.quantity))
            direction = 1 if self.quantity > 0 else -1
            self.realized_pnl += (price - self.avg_price) * closing * direction
            self.quantity += signed
            if abs(self.quantity) < 1e-12:
                self.quantity = 0.0
                self.avg_price = 0.0
            elif (self.quantity > 0) != (direction > 0):
                self.avg_price = price  # flipped side

    def unrealized(self, mark: float | None) -> float:
        if not mark or self.quantity == 0:
            return 0.0
        return (mark - self.avg_price) * self.quantity


# --------------------------------------------------------------------------- #
# Gateway
# --------------------------------------------------------------------------- #
@dataclass
class KillSwitch:
    active: bool = False
    reason: str | None = None
    actor: str | None = None
    at: datetime | None = None
    halted_symbols: set[str] = field(default_factory=set)


@dataclass
class WorkingOrderState:
    """One order resting on the book.

    Holds the original request so a fill can be recorded with the same evidence
    a same-instant fill carries — the check vector that let it through, the
    strategy that sent it, and the moment the gates ran.
    """

    order_id: str
    request: OrderRequest
    quantity: float
    limit_price: float
    time_in_force: str
    source: str
    accepted_at: datetime
    checks: list[CheckResult]
    latency_ms: float

    @property
    def symbol(self) -> str:
        return self.request.symbol

    @property
    def side(self) -> str:
        return self.request.side

    @property
    def notional(self) -> float:
        """Committed capital. A resting order is not free exposure."""
        return self.quantity * self.limit_price

    @property
    def signed_quantity(self) -> float:
        return self.quantity if self.side == "BUY" else -self.quantity

    def expires_at(self) -> datetime | None:
        """DAY orders die at the UTC session boundary; nothing else expires."""
        if self.time_in_force != "DAY":
            return None
        midnight = self.accepted_at.replace(hour=0, minute=0, second=0, microsecond=0)
        return midnight + timedelta(days=1)


class RiskGateway:
    def __init__(self, tca_engine=None, audit=None) -> None:
        self.tca = tca_engine
        self.audit = audit
        self.kill = KillSwitch()
        self.bucket = TokenBucket(settings.max_orders_per_sec, settings.rate_limit_burst)
        self.positions: dict[str, PositionState] = {}
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

    # -- wiring ----------------------------------------------------------- #
    def _restore_session_baseline_from_audit(self) -> None:
        """Restore the banked carry and the drawdown baseline from the durable record.

        ``_restore_positions_from_audit`` replays *this* session's fills, so
        everything earlier reaches a restarted process through exactly two
        numbers: what the closed sessions banked, and the equity this session
        opened on. Both are written at the boundary that produced them
        (``_roll_session_if_needed``) and read back here.

        Without this the rollover fix simply moved its discontinuity: a process
        restarted after any rollover republished an equity lower by the entire
        carry — a step *inside* one session's equity curve, with no order behind
        it and nothing in the panel able to explain it — and re-anchored
        ``start_of_day_equity`` to the configured starting balance, which after a
        losing session quietly handed back drawdown budget the desk had spent.

        No record is not an error. A first-ever session, or a restart before this
        session's first rollover, has genuinely banked nothing, and 0.0 with the
        configured starting equity are then the only values consistent with a
        replay that covers today and nothing else.
        """
        if self.audit is None:
            return

        try:
            record = self.audit.latest_session_rollover(self.session_date)
        except Exception as exc:
            # Raise rather than fall back, for the same reason
            # ``accepted_fills_for_session`` refuses to hand back a partial book.
            # The fallback values are not neutral: 0.0 and ``starting_equity_usd``
            # actively assert that nothing has been banked and that today opened
            # on the opening balance. After a losing week both claims are false
            # in the direction that *widens* the drawdown budget, so an
            # unreadable record would start the desk with risk capacity it never
            # had. A gateway that will not construct is loud; one that starts
            # with a fabricated baseline is not.
            raise RuntimeError(
                f"cannot safely restore the {self.session_date} session baseline"
            ) from exc

        if record is None:
            # Two opposite claims arrive here as the same `None`, and telling
            # them apart is the difference between an honest clean slate and a
            # fabricated one:
            #
            #   (a) nothing has ever closed in this store — a first-ever session,
            #       or a restart before today's first rollover. Zero banked and
            #       the configured opening balance are then the only values
            #       consistent with a replay that covers today and nothing else.
            #   (b) a session closed while this process was down. Something was
            #       banked, and the boundary that would have recorded it never
            #       ran because nothing was running.
            #
            # Reading (b) as (a) is the same failure the durable record was added
            # to stop, one boundary over: after a losing week the desk restarts
            # with its entire drawdown budget handed back, and the first order of
            # the day passes a gate that should have refused it.
            try:
                had_earlier = self.audit.has_activity_before(self.session_date)
            except Exception as exc:
                raise RuntimeError(
                    f"cannot establish whether a session closed before {self.session_date}"
                ) from exc
            if not had_earlier:
                return

            # Case (b). What those sessions banked is genuinely unrecoverable
            # from here — reconstructing it needs a per-session average-cost
            # replay this class does not do — so the gateway starts on the
            # configured balance, which is the only value it can justify, and
            # says so at WARNING rather than letting the panel imply it was
            # earned.
            #
            # Refusing to construct was the other candidate and is wrong:
            # stopping a paper desk overnight and starting it in the morning is
            # ordinary operation, and a gateway that will not boot after it is
            # the more damaging failure. The residual is a *level* error, not a
            # budget one — the daily drawdown limit is meant to reset each
            # session — but the denominator it resets against is now the opening
            # balance rather than what the account is really worth, so a given
            # dollar loss reads as a smaller fraction than it is. That gap is
            # disclosed in the README beside the start-of-day-mark gap it shares
            # a cause with.
            log.warning(
                "the %s session has no rollover record, but this audit store holds activity "
                "from earlier sessions: the gateway was down across a UTC boundary. The P&L "
                "those sessions banked cannot be reconstructed from a session-scoped replay, "
                "so the desk opens on the configured balance of %.2f and the drawdown budget "
                "is measured against that rather than against what the account is really worth.",
                self.session_date, settings.starting_equity_usd,
            )
            return

        def finite_number(field: str) -> float:
            raw = record.get(field)
            if isinstance(raw, bool):
                raise RuntimeError(f"session rollover record has invalid {field}: {raw!r}")
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise RuntimeError(f"session rollover record is missing numeric {field}") from exc
            if not math.isfinite(value):
                raise RuntimeError(f"session rollover record has invalid {field}: {raw!r}")
            return value

        recorded_session = record.get("session_date")
        if recorded_session != self.session_date:
            # The row was found by the session window its timestamp falls in, so
            # a payload naming another day means the record disagrees with its
            # own clock. Applying it would anchor today's drawdown budget to some
            # other day's balance — a wrong denominator that looks entirely
            # plausible in the panel.
            raise RuntimeError(
                f"session rollover record names {recorded_session!r}, "
                f"not the {self.session_date} session it was filed under"
            )

        # Both read before either is applied. A record that validates halfway is
        # not applied halfway: a book whose equity came from this session's
        # record and whose drawdown denominator came from the constructor's
        # default is self-consistent nowhere, and wrong by an amount nothing
        # publishes.
        banked = finite_number("carried_realized_pnl")
        baseline = finite_number("start_of_day_equity")
        # Older records predate the field. Absent means the writer had no
        # overnight book to describe *or* was a version that could not say — and
        # 0.0 is the reading that leaves the baseline exactly as it was written,
        # which is the pre-existing behaviour rather than a new claim.
        overnight_mark = 0.0
        if "unrealized_at_rollover" in record:
            overnight_mark = finite_number("unrealized_at_rollover")

        # The subtraction is the point.
        #
        # `start_of_day_equity` was written from `equity()`, which holds the mark
        # of every position open at the boundary. `_restore_positions_from_audit`
        # replays one UTC day, so those positions do not come back — the restarted
        # gateway's `equity()` is short by exactly that mark. Restoring the
        # baseline whole would measure the smaller book against the larger
        # opening balance and publish the difference as a loss nobody took: on a
        # real book, large enough to open in reduce-only, reject an order, and
        # satisfy the hard breaker on a session that had not traded.
        #
        # Removing the term restores the property that actually matters — a fresh
        # session opens at zero P&L and an unspent budget, live and restarted
        # alike. What it cannot restore is the equity *level*: the restarted
        # process publishes a smaller book because it genuinely does not know
        # about those positions, and claiming their mark would be the fabrication
        # this subtraction exists to prevent. The gap is the one the README
        # discloses — no durable start-of-day position snapshot — and it is named
        # in the log below rather than left for someone to find on a chart.
        self.carried_realized_pnl = banked
        self.start_of_day_equity = baseline - overnight_mark
        if overnight_mark:
            log.warning(
                "the %s session opened holding %.2f of unrealized P&L on positions this "
                "replay cannot rebuild; the drawdown baseline drops that term so the budget "
                "still opens unspent, but published equity is lower than the live process by "
                "the same amount",
                self.session_date, overnight_mark,
            )
        log.info(
            "restored the %s session baseline: carried %.2f, opened at %.2f",
            self.session_date, self.carried_realized_pnl, self.start_of_day_equity,
        )

    def _restore_positions_from_audit(self) -> None:
        """Rebuild only the current session's position accounting from fills.

        Rehydration calls ``PositionState.apply_fill`` directly: it must not
        resubmit orders, emit alerts, increment operational counters, repopulate
        idempotency keys or append new audit rows. Kill/halt state is not restored
        because the audit contains events, not a durable current-state snapshot;
        inferring it here could silently choose the wrong side of a release race.

        The audit loader is strict and reset-aware. Any incomplete or ambiguous
        accepted fill aborts gateway construction instead of starting with an
        understated partial book.
        """
        if self.audit is None:
            return

        try:
            fills = self.audit.accepted_fills_for_session(self.session_date)
        except Exception as exc:
            raise RuntimeError(
                f"cannot safely rehydrate the {self.session_date} position book"
            ) from exc

        restored: dict[str, PositionState] = {}
        seen_order_ids: set[str] = set()
        seen_symbol_timestamps: set[tuple[str, str]] = set()

        def finite_number(row: dict, field: str, *, positive: bool) -> float:
            raw = row.get(field)
            if isinstance(raw, bool):
                raise RuntimeError(f"accepted fill has invalid {field}: {raw!r}")
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise RuntimeError(f"accepted fill is missing numeric {field}") from exc
            valid = math.isfinite(value) and (value > 0 if positive else value >= 0)
            if not valid:
                raise RuntimeError(f"accepted fill has invalid {field}: {raw!r}")
            return value

        for row in fills:
            if not isinstance(row, dict):
                raise RuntimeError("accepted fill replay returned a non-object row")

            order_id = row.get("order_id")
            if not isinstance(order_id, str) or not order_id.strip():
                raise RuntimeError("accepted fill is missing its order id")
            if order_id in seen_order_ids:
                raise RuntimeError(f"duplicate accepted fill in audit: {order_id}")
            seen_order_ids.add(order_id)

            symbol_value = row.get("symbol")
            symbol = symbol_value.strip().upper() if isinstance(symbol_value, str) else ""
            if not symbol:
                raise RuntimeError(f"accepted fill {order_id} is missing its symbol")

            side = row.get("side")
            if side not in {"BUY", "SELL"}:
                raise RuntimeError(f"accepted fill {order_id} has invalid side: {side!r}")

            timestamp = row.get("ts")
            if timestamp is None:
                raise RuntimeError(f"accepted fill {order_id} is missing its timestamp")
            timestamp_key = (symbol, str(timestamp))
            if timestamp_key in seen_symbol_timestamps:
                # Fill order is path-dependent when a position is reduced or
                # flipped. The audit has no sequence column to break an exact
                # same-symbol timestamp tie, so guessing would fabricate P&L.
                raise RuntimeError(
                    f"accepted fills for {symbol} share an ambiguous timestamp: {timestamp}"
                )
            seen_symbol_timestamps.add(timestamp_key)

            quantity = finite_number(row, "fill_qty", positive=True)
            price = finite_number(row, "fill_price", positive=True)
            fee = finite_number(row, "fee_usd", positive=False)
            restored.setdefault(symbol, PositionState(symbol)).apply_fill(side, quantity, price, fee)

        self.positions.update(restored)
        if fills:
            log.info(
                "rehydrated %d accepted fills into %d current-session positions",
                len(fills), len(restored),
            )

    def add_alert_hook(self, hook: AlertHook) -> None:
        self._alert_hooks.append(hook)

    def add_decision_hook(self, hook) -> None:
        """Register a post-decision observer (mirror, RAG anomaly detector).

        Hooks run after the audit write, outside the lock, and are called
        synchronously with (decision, request, source) — so a hook must be
        cheap and non-blocking (the Supabase mirror's enqueue is put_nowait).
        A hook that raises is logged and dropped from the call, never allowed
        to break the order path.
        """
        self._decision_hooks.append(hook)

    def _notify_decision(self, decision, req, source: str) -> None:
        for hook in self._decision_hooks:
            try:
                hook(decision, req, source)
            except Exception as exc:  # observers must never break trading
                log.error("decision hook failed: %s", type(exc).__name__)

    async def _alert(self, severity: str, message: str) -> None:
        for hook in self._alert_hooks:
            try:
                await hook(severity, message)
            except Exception as exc:  # an alert transport must never break trading
                log.error("alert hook failed: %s", exc)

    async def start(self) -> None:
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

    def reduce_only_active(self) -> bool:
        """True when the desk has spent enough of its budget or operator overrode to go defensive."""
        if self._reduce_only_override:
            return True
        limit = settings.max_daily_drawdown_pct
        if limit <= 0 or settings.reduce_only_threshold >= 1.0:
            return False
        return (self.daily_drawdown_pct() / limit) >= settings.reduce_only_threshold

    async def set_reduce_only(self, enabled: bool, actor: str = "operator", reason: str = "") -> RiskState:
        """Operator override for reduce-only mode (the soft halt)."""
        self._reduce_only_override = enabled
        await self._audit("REDUCE_ONLY_TOGGLED", {"enabled": enabled, "actor": actor, "reason": reason})
        await self._alert("REDUCE_ONLY_TOGGLED", f"Reduce-only mode set to {enabled} by {actor}: {reason}")
        return self.get_state()

    def snapshot_equity(self) -> None:
        """Write one equity observation to the audit log.

        Separate from the loop so tests (and an operator at a REPL) can take a
        snapshot deterministically instead of waiting out a timer. Failures are
        swallowed by the audit layer: losing a chart point must never interrupt
        the drawdown breaker sharing this loop.
        """
        if self.audit:
            self.audit.record_equity_snapshot(self.state())

    async def _monitor_loop(self) -> None:
        """Marks the book to market and trips the breaker without human input."""
        last_snapshot = 0.0
        while True:
            await asyncio.sleep(5)
            try:
                try:
                    self._roll_session_if_needed()
                except Exception as exc:
                    # The roll is in its own guard because it is the FIRST thing
                    # this loop does, and everything that protects the desk comes
                    # after it. A durable-write failure that propagated here
                    # skipped the drawdown check — and because a failed roll
                    # deliberately leaves `session_date` on yesterday, it skipped
                    # it again every five seconds, forever. Fail-closed on the
                    # boundary is right; fail-closed on the breaker is not, and
                    # letting one become the other is the worse of the two bugs.
                    #
                    # The measurement that follows is then against yesterday's
                    # baseline, which is stale rather than absent, and stale in
                    # the conservative direction: an un-rolled baseline still
                    # holds whatever the desk lost, so the breaker can only trip
                    # sooner than it should, never later.
                    log.error(
                        "session rollover failed; measuring drawdown against the stale "
                        "%s baseline and retrying the roll next tick: %s",
                        self.session_date, exc,
                    )

                # The book is already marked here, so recording it is nearly
                # free. Done before the kill-switch check on purpose: the
                # minutes after a halt are exactly when a risk manager wants
                # the curve to keep updating.
                interval = settings.equity_snapshot_interval_s
                now = time.monotonic()
                if interval > 0 and now - last_snapshot >= interval:
                    last_snapshot = now
                    self.snapshot_equity()

                if self.kill.active:
                    continue
                dd = self.daily_drawdown_pct()
                if dd >= settings.max_daily_drawdown_pct:
                    await self.trigger_kill(
                        reason=f"AUTO: daily drawdown {dd:.2%} >= limit {settings.max_daily_drawdown_pct:.2%}",
                        actor="circuit-breaker",
                    )
                elif dd >= settings.max_daily_drawdown_pct * 0.8:
                    await self._alert(
                        "warning",
                        f"⚠️ Drawdown warning: {dd:.2%} of {settings.max_daily_drawdown_pct:.2%} daily limit used "
                        f"({dd / settings.max_daily_drawdown_pct:.0%} of budget).",
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("risk monitor error: %s", exc)

    def _roll_session_if_needed(self) -> None:
        now = _utcnow()
        today = now.strftime("%Y-%m-%d")
        if today == self.session_date:
            return

        log.info("session rollover %s -> %s; resetting drawdown baseline", self.session_date, today)

        # The closing session's realized P&L is banked, the per-position counters
        # are zeroed so "realized" keeps meaning "today", and the drawdown
        # baseline is re-marked. The two figures are computed here, before
        # anything moves, because the durable record below has to be written
        # first — see the persist step.
        #
        # `equity()` read *before* the banking is the same number it returns
        # after: the closing session's realized leg only moves from one term of
        # the sum to another. That identity is the fix, so the new baseline is
        # taken from it directly rather than recomputed once the counters are
        # zero — a recomputation would agree by construction and prove nothing.
        #
        # The obvious order — snapshot the baseline, then zero the counters — is
        # the bug this replaced. It left `equity()` short by yesterday's realized
        # P&L while `start_of_day_equity` still contained it, so a new session
        # opened at -R before a single order was sent: a desk that made money
        # yesterday started today already down, and one that made enough of it
        # opened in reduce-only or tripped the breaker on a book it had not
        # traded. The losing case is worse than the embarrassing one — a session
        # that lost R opened at +R of phantom profit, silently handing back the
        # drawdown budget it had spent.
        banked = self.carried_realized_pnl + self.realized_pnl()
        baseline = self.equity()
        # The one term of that baseline a restart cannot reproduce, kept apart so
        # the reader can subtract it. See `_restore_session_baseline_from_audit`.
        overnight_mark = self.unrealized_pnl()

        if self.audit:
            # Persist before mutating, exactly as `reset_book` does, and for the
            # same reason: a boundary that exists in memory and nowhere else is
            # undone by the next restart. If this write fails nothing has moved —
            # `session_date` is still yesterday — so the monitor loop retries the
            # whole roll on its next pass rather than leaving the account holding
            # a carry no restart can find.
            self.audit.record_session_rollover(
                today,
                carried_realized_pnl=banked,
                start_of_day_equity=baseline,
                unrealized_at_rollover=overnight_mark,
                at=now,
            )

        self.session_date = today
        self.carried_realized_pnl = banked
        for pos in self.positions.values():
            pos.realized_pnl = 0.0
        self.start_of_day_equity = baseline

        # A DAY order that reaches the boundary has *expired* — it did exactly
        # what its time-in-force promised, and the blotter should say so. It has
        # to be retired before the blanket cancel below, because that cancel
        # takes everything: with the generic sweep first, `EXPIRED` was a state
        # the schema declares and production could not reach by this route, and
        # a DAY order read as though the system had pulled it.
        self._retire_working_where(
            lambda wo: wo.time_in_force == "DAY",
            "EXPIRED",
            "DAY order reached the session boundary",
            "system",
        )
        # Every *other* resting order dies at the boundary too. That is what
        # guarantees an order's decision and its fill always land in the same
        # UTC session and on the same side of a book_reset — the property the
        # rehydration replay depends on without knowing this code exists.
        self._cancel_working_where(lambda _wo: True, "session rollover", "system")
        self._last_fill_stamp.clear()

    # -- accounting ------------------------------------------------------- #
    def mark(self, symbol: str) -> float | None:
        return self.tca.last_price(symbol) if self.tca else None

    def realized_pnl(self) -> float:
        """*This session's* realized P&L — closed sessions live in ``carried_realized_pnl``.

        Spelled out because the state payload, the blotter and the attribution
        table all publish this number under the bare word "realized", and a
        caller that read it as a lifetime figure would understate the account by
        everything the desk has ever banked.
        """
        return sum(p.realized_pnl for p in self.positions.values())

    def unrealized_pnl(self) -> float:
        return sum(p.unrealized(self.mark(s)) for s, p in self.positions.items())

    def equity(self) -> float:
        # Four terms, and the carried one is not optional: `realized_pnl()` only
        # ever answers for the current session, so an account that closed a
        # profitable week and one that opened this morning would otherwise
        # report the same equity.
        return (
            settings.starting_equity_usd
            + self.carried_realized_pnl
            + self.realized_pnl()
            + self.unrealized_pnl()
        )

    def daily_pnl(self) -> float:
        return self.equity() - self.start_of_day_equity

    def daily_drawdown_pct(self) -> float:
        """Share of the opening balance the session has lost, floored at zero.

        This is the number the reduce-only threshold and the hard breaker both
        read, so the known hole in it belongs here rather than in a ticket.

        **A non-positive ``start_of_day_equity`` disables both guards.** A zero
        baseline short-circuits to 0.0 and a negative one flips the sign of the
        ratio, which ``max`` then floors to 0.0 — so an account that opened the
        session already wiped out reports "no drawdown" however much further it
        falls, and neither ``reduce_only_active`` nor ``_monitor_loop`` ever
        fires. It reads as good news, which is the class of wrong number nobody
        reports.

        The formula predates the carry, but the carry changed how the case is
        reached. Before it, only a single session that lost more than the whole
        account could produce a non-positive baseline; now ``carried_realized_pnl``
        accumulates across sessions and survives a restart, so a long enough run
        of losses arrives at the same place gradually.

        Left as-is deliberately, not by omission. ``web/lib/blotter.ts`` holds a
        bit-for-bit mirror of this expression for the sandbox desk, and the two
        halves have to move together or the mirror is a lie — a Python-only clamp
        would make the sandbox and the gateway disagree about whether an order is
        blocked. The honest repair is a shared decision about what a fraction of
        a non-positive denominator *means* (saturate at 1.0? publish null and
        halt?), taken across both implementations at once.
        """
        pnl = self.daily_pnl()
        return max(0.0, -pnl / self.start_of_day_equity) if self.start_of_day_equity else 0.0

    def gross_exposure(self) -> float:
        total = 0.0
        for sym, pos in self.positions.items():
            mark = self.mark(sym) or pos.avg_price
            total += abs(pos.quantity) * mark
        return total

    def symbol_notional(self, symbol: str) -> float:
        pos = self.positions.get(symbol)
        if not pos:
            return 0.0
        mark = self.mark(symbol) or pos.avg_price
        return abs(pos.quantity) * mark

    # -- the resting book ------------------------------------------------- #
    def working_qty(self, symbol: str) -> tuple[float, float]:
        """``(resting buy quantity, resting sell quantity)`` for one symbol."""
        buys = sells = 0.0
        for wo in self.working.values():
            if wo.symbol != symbol:
                continue
            if wo.side == "BUY":
                buys += wo.quantity
            else:
                sells += wo.quantity
        return buys, sells

    def working_notional(self) -> float:
        """Committed capital across the whole resting book, worst side per symbol."""
        by_symbol: dict[str, list[float]] = {}
        for wo in self.working.values():
            slot = by_symbol.setdefault(wo.symbol, [0.0, 0.0])
            slot[0 if wo.side == "BUY" else 1] += wo.notional
        return sum(max(buy, sell) for buy, sell in by_symbol.values())

    def projected_symbol_notional(
        self, symbol: str, incoming_signed_qty: float, price: float,
    ) -> float:
        """Worst-case symbol exposure once the resting book is included.

        Netting a resting buy against a resting sell would assume they fill
        together. They do not have to — either side can be lifted alone — so each
        is projected on its own and the larger is taken. That is the standard
        worst-case-fill convention, and without it two resting orders can each
        pass a cap that their sum breaches.
        """
        pos = self.positions.get(symbol)
        held = pos.quantity if pos else 0.0
        resting_buys, resting_sells = self.working_qty(symbol)
        if_buys_fill = abs(held + incoming_signed_qty + resting_buys)
        if_sells_fill = abs(held + incoming_signed_qty - resting_sells)
        return max(if_buys_fill, if_sells_fill) * price

    def list_working(self, symbol: str | None = None) -> list[WorkingOrder]:
        now = _utcnow()
        out: list[WorkingOrder] = []
        for wo in self.working.values():
            if symbol and wo.symbol != symbol.upper():
                continue
            mark = self.mark(wo.symbol)
            out.append(WorkingOrder(
                order_id=wo.order_id,
                client_order_id=wo.request.client_order_id,
                symbol=wo.symbol,
                side=wo.side,
                order_type=wo.request.order_type,
                time_in_force=wo.time_in_force,
                quantity=wo.quantity,
                limit_price=wo.limit_price,
                notional=wo.notional,
                strategy=wo.request.strategy,
                source=wo.source,
                status="WORKING",
                accepted_at=wo.accepted_at,
                age_seconds=max(0.0, (now - wo.accepted_at).total_seconds()),
                mark_price=mark,
                # Null, never zero, when there is no mark: "at the touch" and
                # "nobody is quoting this" are opposite claims.
                distance_bps=(
                    round((wo.limit_price - mark) / mark * 1e4, 2) if mark else None
                ),
                expires_at=wo.expires_at(),
            ))
        out.sort(key=lambda o: o.accepted_at)
        return out

    def _fill_stamp(self, symbol: str, now: datetime) -> datetime:
        """A strictly increasing per-symbol fill timestamp.

        ``accepted_fills_for_session`` raises when two fills in one symbol share a
        timestamp, because it cannot order them against a ``book_reset``. A sweep
        reads the clock once and can fill several orders in the same symbol, so
        the stamps are separated here — otherwise the failure surfaces at the
        *next restart* as a gateway that refuses to construct.
        """
        last = self._last_fill_stamp.get(symbol)
        stamp = now if last is None or now > last else last + timedelta(microseconds=1)
        self._last_fill_stamp[symbol] = stamp
        return stamp

    def _terminal_decision(
        self, wo: WorkingOrderState, status: str, fill: Fill | None, reason: str | None,
    ) -> RiskDecision:
        return RiskDecision(
            order_id=wo.order_id,
            client_order_id=wo.request.client_order_id,
            accepted=True,
            symbol=wo.symbol,
            side=wo.side,
            quantity=wo.quantity,
            notional=wo.notional,
            checks=wo.checks,
            rejected_by=[],
            reason=reason,
            latency_ms=wo.latency_ms,
            timestamp=wo.accepted_at,
            fill=fill,
            status=status,
            time_in_force=wo.time_in_force,
        )

    def _maker_fill(self, wo: WorkingOrderState, price: float, venue: str) -> Fill:
        """A resting order fills at its own limit, and pays the maker fee.

        ``_paper_fill`` walks the ladder because a marketable order crosses the
        spread and pays for it. A resting order is on the other side of that
        trade: someone crossed to reach it. Charging it a taker fee, or filling it
        at a route VWAP that walked through its own limit, would report a cost the
        desk did not pay.

        The slippage figure is therefore usually *negative* — price improvement
        against the mark — which is the honest number and makes maker versus taker
        economics visible in the blotter rather than a footnote.
        """
        notional = wo.quantity * price
        mark = self.mark(wo.symbol)
        slippage_bps = None
        if mark:
            slippage_bps = round(
                ((price - mark) / mark * 1e4) if wo.side == "BUY" else ((mark - price) / mark * 1e4),
                3,
            )
        return Fill(
            price=price,
            quantity=wo.quantity,
            notional=notional,
            fee_usd=notional * settings.paper_maker_fee_bps / 1e4,
            slippage_bps=slippage_bps,
            venue=venue,
            simulated=True,
        )

    def _retire(
        self,
        wo: WorkingOrderState,
        status: str,
        *,
        fill: Fill | None = None,
        reason: str | None = None,
        actor: str = "system",
        at: datetime | None = None,
    ) -> RiskDecision:
        """Take an order off the resting book and queue its audit rows.

        Called under the lock. The audit writes are deferred rather than issued
        here so they land off the hot path, and so a caller holding the lock never
        blocks on a database.
        """
        self.working.pop(wo.order_id, None)
        outcome_at = at or _utcnow()
        decision = self._terminal_decision(wo, status, fill, reason)
        self._deferred_audit.append(("order", decision, wo.request, wo.source, outcome_at))
        self._deferred_audit.append(("event", {
            "order_id": wo.order_id,
            "client_order_id": wo.request.client_order_id,
            "event": status,
            "status": status,
            "symbol": wo.symbol,
            "side": wo.side,
            "order_type": wo.request.order_type,
            "time_in_force": wo.time_in_force,
            "quantity": wo.quantity,
            "limit_price": wo.limit_price,
            "notional": wo.notional,
            "fill_price": fill.price if fill else None,
            "fill_qty": fill.quantity if fill else None,
            "fee_usd": fill.fee_usd if fill else None,
            "venue": fill.venue if fill else None,
            "actor": actor,
            "detail": reason or "",
            "at": outcome_at,
        }))
        return decision

    def _drain_deferred_audit_sync(self) -> None:
        """Flush queued audit rows from a synchronous caller (``reset_book``)."""
        if not self.audit or not self._deferred_audit:
            self._deferred_audit.clear()
            return
        pending, self._deferred_audit = self._deferred_audit, []
        for entry in pending:
            try:
                if entry[0] == "order":
                    _, decision, request, source, outcome_at = entry
                    self.audit.record_order(decision, request, source, outcome_at=outcome_at)
                else:
                    self.audit.record_order_event(**entry[1])
            except Exception as exc:
                log.error("deferred audit write failed: %s", exc)

    async def _drain_deferred_audit(self) -> None:
        """Flush queued audit rows once the lock has been released."""
        if not self.audit or not self._deferred_audit:
            self._deferred_audit.clear()
            return
        pending, self._deferred_audit = self._deferred_audit, []
        for entry in pending:
            try:
                if entry[0] == "order":
                    _, decision, request, source, outcome_at = entry
                    await asyncio.to_thread(
                        self.audit.record_order, decision, request, source, outcome_at=outcome_at,
                    )
                else:
                    await asyncio.to_thread(self.audit.record_order_event, **entry[1])
            except Exception as exc:  # an audit failure must not break the desk
                log.error("deferred audit write failed: %s", exc)

    def _retire_working_where(
        self,
        predicate: Callable[[WorkingOrderState], bool],
        status: str,
        reason: str,
        actor: str,
    ) -> list[str]:
        """Take every resting order matching ``predicate`` off the book, with a
        terminal ``status``. Caller holds the lock.

        The status is a parameter rather than always ``CANCELLED`` because *why*
        an order left the book is the whole content of the blotter row. An order
        the desk pulled and one that ran out its own clock are different events,
        and reporting both as a cancel loses the only distinction a post-mortem
        can act on.
        """
        doomed = [wo for wo in self.working.values() if predicate(wo)]
        for wo in doomed:
            self._retire(wo, status, reason=reason, actor=actor)
        return [wo.order_id for wo in doomed]

    def _cancel_working_where(
        self, predicate: Callable[[WorkingOrderState], bool], reason: str, actor: str,
    ) -> list[str]:
        """Pull every resting order matching ``predicate``. Caller holds the lock."""
        return self._retire_working_where(predicate, "CANCELLED", reason, actor)

    def _would_increase_risk(self, wo: WorkingOrderState) -> bool:
        """True when filling this resting order would grow the position.

        Same test the reduce-only gate applies to an incoming order: reducing
        means moving toward flat, on the opposite side to the holding and no
        larger than what is held. An oversized "close" that flips the book is an
        opening trade wearing a closing trade's clothes.
        """
        pos = self.positions.get(wo.symbol)
        held = pos.quantity if pos else 0.0
        if abs(held) <= 1e-12:
            return True
        signed = wo.signed_quantity
        reducing = (held > 0) != (signed > 0) and abs(signed) <= abs(held) + 1e-9
        return not reducing

    def _rest_order(
        self,
        order_id: str,
        req: OrderRequest,
        qty: float,
        limit_price: float,
        tif: str,
        source: str,
        checks: list[CheckResult],
        latency_ms: float,
        at: datetime,
    ) -> WorkingOrderState:
        wo = WorkingOrderState(
            order_id=order_id,
            request=req,
            quantity=qty,
            limit_price=limit_price,
            time_in_force=tif,
            source=source,
            accepted_at=at,
            checks=checks,
            latency_ms=latency_ms,
        )
        self.working[order_id] = wo
        self._deferred_audit.append(("event", {
            "order_id": order_id,
            "client_order_id": req.client_order_id,
            "event": "ACCEPTED_WORKING",
            "status": "WORKING",
            "symbol": req.symbol,
            "side": req.side,
            "order_type": req.order_type,
            "time_in_force": tif,
            "quantity": qty,
            "limit_price": limit_price,
            "notional": wo.notional,
            "actor": source,
            "detail": "resting on the book",
            "at": at,
        }))
        return wo

    async def sweep_working_orders(self, now: datetime | None = None) -> list[RiskDecision]:
        """Fill every resting order the consolidated touch has crossed.

        Directly callable and deterministic, for the same reason ``snapshot_equity``
        is: a test that had to wait out a timer to observe a fill would be a slow
        test that still could not say *when* the fill happened.
        """
        now = now or _utcnow()
        filled: list[RiskDecision] = []

        async with self._lock:
            self._roll_session_if_needed()

            # Reduce-only says "only orders that make the book smaller". A
            # resting order placed before the threshold was crossed does not know
            # that, and one that fills afterwards makes the book bigger — which
            # would make the regime a claim rather than a control.
            if self.reduce_only_active():
                self._cancel_working_where(
                    self._would_increase_risk,
                    "reduce-only engaged — resting orders that would add risk are pulled",
                    "circuit-breaker",
                )

            for wo in list(self.working.values()):
                if wo.order_id not in self.working:
                    continue  # the session roll or reduce-only took it

                expires = wo.expires_at()
                if expires and now >= expires:
                    self._retire(wo, "EXPIRED", reason="DAY order reached the session boundary", at=now)
                    continue

                if not self.tca:
                    continue
                best_bid, bid_venue, best_ask, ask_venue = self.tca.top_of_book(wo.symbol)
                if wo.side == "BUY":
                    if best_ask is None or best_ask > wo.limit_price:
                        continue
                    venue = ask_venue or "PAPER"
                else:
                    if best_bid is None or best_bid < wo.limit_price:
                        continue
                    venue = bid_venue or "PAPER"

                fill = self._maker_fill(wo, wo.limit_price, venue)
                position = self.positions.setdefault(wo.symbol, PositionState(wo.symbol))
                position.apply_fill(wo.side, fill.quantity, fill.price, fill.fee_usd)
                self.orders_accepted += 1
                filled.append(self._retire(
                    wo, "FILLED", fill=fill,
                    reason=f"crossed at {fill.price:,.2f} on {venue}",
                    at=self._fill_stamp(wo.symbol, now),
                ))

        await self._drain_deferred_audit()

        # The breaker runs outside the lock, exactly as it does after a submit —
        # `trigger_kill` cancels the resting book and would deadlock on a
        # non-reentrant lock otherwise.
        if filled:
            dd_after = self.daily_drawdown_pct()
            if dd_after >= settings.max_daily_drawdown_pct:
                await self.trigger_kill(
                    reason=f"AUTO: drawdown {dd_after:.2%} breached after a resting fill",
                    actor="circuit-breaker",
                )
        return filled

    async def _working_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.working_order_sweep_s)
            try:
                await self.sweep_working_orders()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("working-order sweep error: %s", exc)

    async def cancel_working(
        self, order_id: str, actor: str = "api", reason: str = "manual cancel",
    ) -> OrderAck | None:
        """Pull one resting order. ``None`` when the id is not resting."""
        async with self._lock:
            wo = self.working.get(order_id)
            if wo is None:
                return None
            self._retire(wo, "CANCELLED", reason=reason, actor=actor)
        await self._drain_deferred_audit()
        return OrderAck(
            order_id=order_id, status="CANCELLED", actor=actor, reason=reason, at=_utcnow(),
        )

    async def cancel_all_working(
        self, reason: str, actor: str = "system", symbol: str | None = None,
    ) -> list[str]:
        async with self._lock:
            cancelled = self._cancel_working_where(
                lambda wo: symbol is None or wo.symbol == symbol.upper(), reason, actor,
            )
        await self._drain_deferred_audit()
        return cancelled

    async def replace_working(
        self, order_id: str, req: ReplaceRequest, actor: str = "api",
    ) -> RiskDecision | None:
        """Cancel-and-new. ``None`` when the id is not resting.

        The replacement runs the full gate battery and the caller gets *its*
        check vector, not the original's. A replace is a new order — it can be
        rejected for reasons the first one passed, and returning stale evidence
        would hide that. This is also what most venues do for a price change or a
        size increase, so nothing is being modelled that a real desk would not
        recognise.
        """
        async with self._lock:
            wo = self.working.get(order_id)
            if wo is None:
                return None
            original = wo.request
            source = wo.source
            self._retire(wo, "CANCELLED", reason=f"replaced by {actor}: {req.reason}", actor=actor)
            replacement = OrderRequest(
                symbol=original.symbol,
                side=original.side,
                quantity=(
                    req.quantity if req.quantity is not None
                    else (None if req.notional is not None else wo.quantity)
                ),
                notional=req.notional,
                order_type="LIMIT",
                limit_price=req.limit_price or wo.limit_price,
                strategy=original.strategy,
                # Deliberately not carried over: the original id is already spent
                # against the idempotency gate, and a replacement that reused it
                # would be rejected as a duplicate of the order it replaces.
                client_order_id=None,
                time_in_force=wo.time_in_force,
            )

        await self._drain_deferred_audit()
        decision = await self.submit(replacement, source=source)

        if self.audit:
            await asyncio.to_thread(
                self.audit.record_order_event,
                order_id=decision.order_id,
                event="REPLACED",
                status=decision.status,
                symbol=decision.symbol,
                side=decision.side,
                order_type="LIMIT",
                time_in_force=decision.time_in_force,
                quantity=decision.quantity,
                limit_price=replacement.limit_price,
                notional=decision.notional,
                actor=actor,
                detail=req.reason,
                replaces=order_id,
            )
        return decision

    # -- kill switch ------------------------------------------------------ #
    async def trigger_kill(self, reason: str, actor: str, symbol: str | None = None) -> KillSwitch:
        if symbol:
            self.kill.halted_symbols.add(symbol.upper())
            detail = f"{symbol.upper()} halted by {actor}: {reason}"
            severity = "warning"
        else:
            self.kill.active = True
            self.kill.reason = reason
            self.kill.actor = actor
            self.kill.at = _utcnow()
            detail = f"GLOBAL KILL by {actor}: {reason}"
            severity = "critical"

        log.critical(detail)
        # The alert below says "all new orders are now rejected". With resting
        # orders alive that sentence is false: an order placed before the halt
        # would keep trading through it. A halt that does not reach the resting
        # book is not a halt.
        cancelled = await self.cancel_all_working(
            reason=f"kill switch: {reason}", actor=actor, symbol=symbol,
        )
        if cancelled:
            detail = f"{detail} ({len(cancelled)} resting order(s) cancelled)"

        if self.audit:
            self.audit.record_risk_event(
                "kill_switch_engaged", severity=severity, actor=actor, symbol=symbol, detail=detail,
                payload={"equity": self.equity(), "drawdown_pct": self.daily_drawdown_pct()},
            )
        await self._alert(
            severity,
            f"🛑 <b>KILL SWITCH ENGAGED</b>\n{detail}\n"
            f"Equity: ${self.equity():,.0f} | Daily PnL: ${self.daily_pnl():,.0f} "
            f"({self.daily_drawdown_pct():.2%} DD)\nAll new orders are now rejected.",
        )
        return self.kill

    async def release_kill(self, actor: str, symbol: str | None = None,
                           reason: str | None = None) -> KillSwitch:
        """Resume trading, recording *why*.

        A halt records what tripped it; a resume recorded only who pressed the
        button leaves the audit trail with half a story. "Resumed after the feed
        recovered" and "resumed because the desk wanted to keep trading" are the
        two answers a post-incident review needs to tell apart, and only the
        operator can supply which one it was.
        """
        tripped_by = self.kill.reason
        if symbol:
            self.kill.halted_symbols.discard(symbol.upper())
            detail = f"{symbol.upper()} resumed by {actor}"
        else:
            self.kill.active = False
            self.kill.reason = None
            self.kill.actor = None
            self.kill.at = None
            detail = f"Global trading resumed by {actor}"
        if reason:
            detail += f" — {reason}"
        log.warning(detail)
        if self.audit:
            self.audit.record_risk_event(
                "kill_switch_released", severity="warning", actor=actor, symbol=symbol, detail=detail,
                payload={
                    "reason": reason,
                    # What the halt was for, carried onto the resume so the two
                    # events can be read as one incident.
                    "tripped_by": tripped_by,
                    "drawdown_pct": round(self.daily_drawdown_pct(), 5),
                },
            )
        await self._alert("info", f"✅ <b>Trading resumed</b>\n{detail}")
        return self.kill

    # -- the hot path ----------------------------------------------------- #
    async def submit(self, req: OrderRequest, source: str = "api") -> RiskDecision:
        t0 = time.perf_counter()
        checks: list[CheckResult] = []
        order_id = uuid.uuid4().hex[:16]

        def add(name: str, passed: bool, detail: str, observed=None, limit=None) -> bool:
            checks.append(CheckResult(name=name, passed=passed, detail=detail, observed=observed, limit=limit))
            return passed

        async with self._lock:
            self._roll_session_if_needed()

            # 1 — kill switch (single boolean; always first)
            add("kill_switch", not self.kill.active, self.kill.reason or "disengaged")
            # 2 — per-symbol halt
            add("symbol_halt", req.symbol not in self.kill.halted_symbols, f"{req.symbol} halt status")
            # 3 — instrument whitelist
            add("symbol_whitelist", req.symbol in [s.upper() for s in settings.symbols],
                f"{req.symbol} in {settings.symbols}")
            # 4 — idempotency: a retrying algo must not double-fire
            dup = bool(req.client_order_id and req.client_order_id in self._seen_set)
            add("duplicate_order", not dup, f"client_order_id={req.client_order_id or '-'}")
            # 5 — rate limit
            allowed = self.bucket.try_consume()
            add("rate_limit", allowed, f"{self.bucket.observed_rate():.1f}/s observed",
                observed=self.bucket.observed_rate(), limit=settings.max_orders_per_sec)

            # 6 — price discovery. No mark => no risk assessment => reject.
            mark = self.mark(req.symbol)
            ref_price = req.limit_price or mark
            has_price = ref_price is not None and ref_price > 0
            add("price_available", bool(has_price), f"mark={mark}" if mark else "no live mark price")

            qty = req.quantity
            notional = req.notional
            if has_price:
                if qty is None and notional is not None:
                    qty = notional / ref_price
                elif notional is None and qty is not None:
                    notional = qty * ref_price
            add("order_sized", qty is not None and notional is not None, "quantity or notional required")

            if notional is not None:
                # 7 — fat-finger notional ceiling
                add("max_order_notional", notional <= settings.max_order_notional_usd,
                    f"${notional:,.0f} vs ${settings.max_order_notional_usd:,.0f} cap",
                    observed=notional, limit=settings.max_order_notional_usd)

                # 8 — projected per-symbol concentration, resting orders included.
                # Without the resting book two $140k orders each pass a $150k cap,
                # both fill, and the book sits at 187% of a hard limit with no gate
                # having fired. Committed capital is exposure whether or not it has
                # landed yet.
                price_ref = mark or ref_price or 0
                signed_qty = (qty or 0) * (1 if req.side == "BUY" else -1)
                projected_sym = self.projected_symbol_notional(req.symbol, signed_qty, price_ref)
                add("symbol_concentration", projected_sym <= settings.max_symbol_notional_usd,
                    f"${projected_sym:,.0f} projected vs ${settings.max_symbol_notional_usd:,.0f}",
                    observed=projected_sym, limit=settings.max_symbol_notional_usd)

                # 9 — projected gross exposure, likewise
                projected_gross = (
                    self.gross_exposure() - self.symbol_notional(req.symbol) + projected_sym
                )
                add("gross_exposure", projected_gross <= settings.max_gross_exposure_usd,
                    f"${projected_gross:,.0f} projected vs ${settings.max_gross_exposure_usd:,.0f}",
                    observed=projected_gross, limit=settings.max_gross_exposure_usd)

            # 10 — limit price sanity (the other half of fat-finger protection)
            if req.order_type == "LIMIT" and req.limit_price and mark:
                dev_bps = abs(req.limit_price - mark) / mark * 1e4
                add("price_band", dev_bps <= settings.max_price_deviation_bps,
                    f"{dev_bps:.1f}bps from mark {mark:,.2f}",
                    observed=dev_bps, limit=settings.max_price_deviation_bps)

            # 11 — the resting book has a ceiling of its own. An algo that keeps
            # placing and never cancelling is unbounded memory and an unbounded
            # sweep, which is the runaway-loop failure this module exists to stop.
            if req.order_type == "LIMIT":
                resting = len(self.working)
                add("working_book", resting < settings.max_working_orders,
                    f"{resting} resting vs {settings.max_working_orders} cap",
                    observed=float(resting), limit=float(settings.max_working_orders))

            # 12 — drawdown budget
            dd = self.daily_drawdown_pct()
            add("daily_drawdown", dd < settings.max_daily_drawdown_pct,
                f"{dd:.2%} used of {settings.max_daily_drawdown_pct:.2%}",
                observed=dd, limit=settings.max_daily_drawdown_pct)

            # 12 — reduce-only mode. Between the soft threshold and the hard
            # breaker the desk may still close positions but not open or add to
            # them: a book in trouble needs a way *out*, and refusing the exit
            # alongside the entry is how a drawdown becomes a liquidation.
            if self.reduce_only_active() and notional is not None:
                pos = self.positions.get(req.symbol)
                held = pos.quantity if pos else 0.0
                # An unsized order cannot be shown to reduce anything, so it is
                # refused rather than assumed either way. Deriving the sign from
                # `qty or 0` treated a missing quantity as reducing on a long
                # book and not on a short one — the same order, two answers.
                signed_qty = qty * (1 if req.side == "BUY" else -1) if qty is not None else None
                # Reducing means moving toward flat: opposite sign to the
                # position, and no larger than what is held (an over-sized
                # "close" that flips the book is an opening trade in disguise).
                reducing = (
                    signed_qty is not None
                    and abs(held) > 1e-12
                    and (held > 0) != (signed_qty > 0)
                    and abs(signed_qty) <= abs(held) + 1e-9
                )
                budget_used = dd / settings.max_daily_drawdown_pct if settings.max_daily_drawdown_pct else 0.0
                add("reduce_only", reducing,
                    f"reduce-only at {budget_used:.0%} of the drawdown budget — "
                    + ("closing order allowed" if reducing else "only position-reducing orders accepted"),
                    observed=budget_used, limit=settings.reduce_only_threshold)

            # 12 — liquidity: does the live book support this size at a sane cost?
            # Measured on the *routed* execution, because that is what will fill.
            if self.tca and notional:
                est = self.tca.route_estimate(req.symbol, req.side, notional)
                if est is None:
                    add("est_slippage", False, "no routable liquidity")
                elif not est.fillable:
                    add("est_slippage", False,
                        f"only ${est.filled_notional:,.0f} of ${notional:,.0f} routable across "
                        f"{est.venue or 'all venues'}")
                elif est.slippage_bps is not None:
                    add("est_slippage", est.slippage_bps <= settings.max_est_slippage_bps,
                        f"{est.slippage_bps:+.2f}bps routing {est.venue}",
                        observed=est.slippage_bps, limit=settings.max_est_slippage_bps)

            rejected_by = [c.name for c in checks if not c.passed]
            accepted = not rejected_by

            # The sensible default differs by order type, which is why the field
            # has no default of its own. Every client that never sends one
            # behaves exactly as it did before resting orders existed.
            tif = req.time_in_force or ("GTC" if req.order_type == "LIMIT" else "IOC")

            # Is this LIMIT order marketable right now? A limit that crosses the
            # spread is a taker and goes down the original path unchanged; only a
            # limit nobody is willing to meet has anything to rest for.
            marketable = True
            if accepted and req.order_type == "LIMIT" and req.limit_price:
                marketable = False
                if self.tca:
                    best_bid, _bv, best_ask, _av = self.tca.top_of_book(req.symbol)
                    if req.side == "BUY":
                        marketable = best_ask is not None and req.limit_price >= best_ask
                    else:
                        marketable = best_bid is not None and req.limit_price <= best_bid

            fill = None
            status = "REJECTED"
            decided_at = _utcnow()
            latency_ms = (time.perf_counter() - t0) * 1000

            if accepted and qty and notional:
                if req.client_order_id:
                    if len(self._seen_client_ids) == self._seen_client_ids.maxlen:
                        self._seen_set.discard(self._seen_client_ids[0])
                    self._seen_client_ids.append(req.client_order_id)
                    self._seen_set.add(req.client_order_id)

                if marketable:
                    status = "FILLED"
                    fill = self._paper_fill(req, qty, notional, mark)
                    position = self.positions.setdefault(req.symbol, PositionState(req.symbol))
                    position.apply_fill(req.side, fill.quantity, fill.price, fill.fee_usd)
                    self.orders_accepted += 1
                    self._fill_stamp(req.symbol, decided_at)
                elif tif == "IOC":
                    # Immediate-or-cancel with nothing to be immediate against.
                    # Accepted — it passed every gate — but dead on arrival, and
                    # saying so costs no machinery at all.
                    status = "EXPIRED"
                    self.orders_accepted += 1
                else:
                    status = "WORKING"
                    self.orders_accepted += 1
                    self._rest_order(
                        order_id, req, qty, req.limit_price or 0.0, tif, source,
                        checks, latency_ms, decided_at,
                    )
            else:
                self.orders_rejected += 1

            decision = RiskDecision(
                order_id=order_id,
                client_order_id=req.client_order_id,
                accepted=accepted,
                symbol=req.symbol,
                side=req.side,
                quantity=qty,
                notional=notional,
                checks=checks,
                rejected_by=rejected_by,
                reason=None if accepted else "; ".join(
                    f"{c.name}: {c.detail}" for c in checks if not c.passed
                ),
                latency_ms=latency_ms,
                timestamp=decided_at,
                fill=fill,
                status=status,
                time_in_force=tif,
            )

        # A resting order has no outcome yet, so it gets no `orders` row: that
        # table holds one row per order, written once, when it terminates. Its
        # acceptance is already in `order_events`.
        if self.audit and status != "WORKING":
            await asyncio.to_thread(self.audit.record_order, decision, req, source)
        await self._drain_deferred_audit()
        self._notify_decision(decision, req, source)

        # Post-decision side effects run outside the lock.
        if not accepted:
            await self._on_reject(decision)
        else:
            dd_after = self.daily_drawdown_pct()
            if dd_after >= settings.max_daily_drawdown_pct:
                await self.trigger_kill(
                    reason=f"AUTO: drawdown {dd_after:.2%} breached after fill on {req.symbol}",
                    actor="circuit-breaker",
                )
        return decision

    def _paper_fill(self, req: OrderRequest, qty: float, notional: float, mark: float | None) -> Fill:
        """Simulate execution against the live ladder (Module A), not at mid.

        Filling at mid is the single most common way a backtest or paper system
        flatters itself. Here the fill price is the actual VWAP of the smart
        route, so paper PnL carries the same cost structure as live trading.
        """
        venue = "PAPER"
        price = mark or req.limit_price or 0.0
        slippage_bps = 0.0

        if self.tca:
            legs, vwap = self.tca.smart_route(req.symbol, req.side, notional)
            if vwap:
                price = vwap
                venue = "+".join(leg.venue for leg in legs) or "PAPER"
                if mark:
                    slippage_bps = ((price - mark) / mark * 1e4) if req.side == "BUY" else ((mark - price) / mark * 1e4)

        filled_qty = notional / price if price else qty
        fee = notional * settings.paper_fee_bps / 1e4
        return Fill(
            price=price,
            quantity=filled_qty,
            notional=notional,
            fee_usd=fee,
            slippage_bps=round(slippage_bps, 3),
            venue=venue,
            simulated=True,
        )

    async def _on_reject(self, decision: RiskDecision) -> None:
        severe = {"max_order_notional", "daily_drawdown", "gross_exposure", "kill_switch", "price_band"}
        if self.audit:
            self.audit.record_risk_event(
                "order_rejected", severity="warning", actor="gateway", symbol=decision.symbol,
                detail=decision.reason or "", payload={"order_id": decision.order_id, "rejected_by": decision.rejected_by},
            )
        if severe & set(decision.rejected_by):
            await self._alert(
                "warning",
                f"🚫 <b>Order rejected</b> — {decision.symbol} {decision.side} "
                f"${(decision.notional or 0):,.0f}\n<code>{decision.reason}</code>",
            )

    # -- read model ------------------------------------------------------- #
    def state(self) -> RiskState:
        positions = []
        for sym, pos in self.positions.items():
            if abs(pos.quantity) < 1e-12 and pos.realized_pnl == 0:
                continue
            mark = self.mark(sym)
            positions.append(
                Position(
                    symbol=sym,
                    quantity=pos.quantity,
                    avg_price=pos.avg_price,
                    mark_price=mark,
                    notional=abs(pos.quantity) * (mark or pos.avg_price),
                    unrealized_pnl=pos.unrealized(mark),
                    realized_pnl=pos.realized_pnl,
                )
            )
        dd = self.daily_drawdown_pct()
        return RiskState(
            kill_switch_active=self.kill.active,
            kill_reason=self.kill.reason,
            killed_at=self.kill.at,
            killed_by=self.kill.actor,
            halted_symbols=sorted(self.kill.halted_symbols),
            equity=self.equity(),
            start_of_day_equity=self.start_of_day_equity,
            realized_pnl=self.realized_pnl(),
            # Published so the payload reconciles. `realized_pnl` above is
            # session-scoped, so after the first rollover
            # `equity != starting + realized + unrealized` and the missing term
            # had no name on the wire — a reader could only conclude the numbers
            # disagreed.
            carried_realized_pnl=self.carried_realized_pnl,
            unrealized_pnl=self.unrealized_pnl(),
            daily_pnl=self.daily_pnl(),
            daily_drawdown_pct=dd,
            drawdown_budget_used_pct=dd / settings.max_daily_drawdown_pct if settings.max_daily_drawdown_pct else 0.0,
            reduce_only=self.reduce_only_active(),
            reduce_only_threshold=settings.reduce_only_threshold,
            reduce_only_source="operator" if self._reduce_only_override else ("threshold" if self.reduce_only_active() else "off"),
            gross_exposure=self.gross_exposure(),
            positions=positions,
            orders_accepted=self.orders_accepted,
            orders_rejected=self.orders_rejected,
            working_orders=len(self.working),
            working_notional=self.working_notional(),
            orders_last_second=self.bucket.observed_rate(),
            limits=settings.risk_limits_dict(),
            session_date=self.session_date,
        )

    def reset_book(self, actor: str = "api") -> None:
        """Flatten the paper book (demo/reset helper — audited like everything else)."""
        if self.audit:
            # Persist first. Clearing before this durable boundary exists could
            # resurrect the old fills on the next process restart.
            self.audit.record_book_reset(actor)
        self.positions.clear()
        self.orders_accepted = 0
        self.orders_rejected = 0
        self._seen_client_ids.clear()
        self._seen_set.clear()
        # A reset is a durable replay boundary. Leaving orders resting across one
        # would let a fill land after the boundary for a decision taken before
        # it, which is exactly the ambiguity the replay refuses to guess at.
        self._cancel_working_where(lambda _wo: True, f"book reset by {actor}", actor)
        self._drain_deferred_audit_sync()
        self._last_fill_stamp.clear()
        # A reset puts the paper account back on its opening balance, so the
        # carried total goes out with the positions. Keeping it would leave a
        # flat, freshly reset book whose equity still claimed prior sessions'
        # money — and a `daily_pnl` that opened at exactly that stale amount.
        self.carried_realized_pnl = 0.0
        self.start_of_day_equity = settings.starting_equity_usd


_gateway: RiskGateway | None = None


def get_gateway() -> RiskGateway:
    global _gateway
    if _gateway is None:
        from modules.audit import get_audit
        from modules.tca_engine import get_engine

        _gateway = RiskGateway(tca_engine=get_engine(), audit=get_audit())
    return _gateway
