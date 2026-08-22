"""The background loops: the breaker, the session boundary, the sweep timer.

The risk monitor is what makes the drawdown guard automatic — no human is
required for it to trip. It also owns the UTC session rollover, which is the
first thing it does on every tick and the one step whose failure must not take
the breaker down with it.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime

from config import settings
from modules.risk_proxy.clock import _utcnow

log = logging.getLogger("alphaengine.risk")


class MonitorMixin:
    """The equity snapshot, the risk monitor, the rollover and the sweep loop."""

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
        """Marks the book to market and trips the breaker without human input.

        Runs at `RISK_MONITOR_INTERVAL_S` (1s), not the 5s it used to. Every
        step below is arithmetic over an in-memory book, so the cost of the
        faster tick is negligible and the breaker reacts four seconds sooner.
        The two genuinely expensive things it can do — the session rollover's
        durable write and the equity snapshot — are gated on their own
        intervals, so raising the tick rate does not raise their rate.
        """
        last_snapshot = 0.0
        while True:
            await asyncio.sleep(max(0.05, settings.risk_monitor_interval_s))
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
                limit = settings.max_daily_drawdown_pct
                if dd >= limit:
                    await self.trigger_kill(
                        reason=f"AUTO: daily drawdown {dd:.2%} >= limit {limit:.2%}",
                        actor="circuit-breaker",
                    )
                # Edge-triggered, with hysteresis. This used to alert on every
                # tick the drawdown spent above 80% of the limit — roughly 720
                # Telegram messages an hour at the old 5s cadence, and the tick
                # is now 1s. A warning that repeats every second is not a
                # warning; it is why the next real one goes unread.
                #
                # Rearming lower than it fires (70% vs 80%) is what stops a
                # drawdown hovering on the threshold from flapping the alert
                # once a second. The same shape the venue-feed watchdog uses.
                elif dd >= limit * 0.8:
                    if not self._drawdown_warned:
                        self._drawdown_warned = True
                        await self._alert(
                            "warning",
                            f"⚠️ Drawdown warning: {dd:.2%} of {limit:.2%} daily limit used "
                            f"({dd / limit:.0%} of budget).",
                        )
                elif dd < limit * 0.7 and self._drawdown_warned:
                    self._drawdown_warned = False
                    await self._alert(
                        "info",
                        f"✅ Drawdown recovered: {dd:.2%} of {limit:.2%} daily limit used.",
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

        # The label of the session being CLOSED, taken before the reassignment
        # below overwrites it. The corpus write at the end of this method is the
        # only reader; it is captured here rather than there so that a later edit
        # moving that call cannot silently start summarising the wrong day.
        closing_session = self.session_date

        self.session_date = today
        self.carried_realized_pnl = banked
        for pos in self.positions.values():
            pos.realized_pnl = 0.0
        # The rollover zeroes every per-position realized counter, which is a
        # position change the mirror cannot see: it holds copies of those
        # numbers, not references to the PositionState objects. Missing this
        # left the mirror carrying yesterday's realized P&L into today's
        # drawdown and tripped reduce-only on the first opening order of a new
        # session — caught by test_session_rollover, and the reason every
        # mutation of self.positions in this file now ends in this call.
        self._sync_position_book()
        self.start_of_day_equity = baseline
        # The warning latch is scoped to a session like everything else here.
        # Left set, a desk that ended yesterday in the warning band would start
        # today already "warned" and stay silent through its first real breach.
        self._drawdown_warned = False

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

        # LAST, and deliberately after every state mutation above. The session
        # that just closed is now a finished, immutable range of an append-only
        # log, which is the only condition under which it can be summarised
        # truthfully — and by standing here the corpus cannot come between the
        # durable rollover row and the book it describes.
        self._file_execution_summary(closing_session, now)

    def _file_execution_summary(self, session_date: str, closed_at: datetime) -> None:
        """Hand the closed session to the research corpus, and never wait for it.

        ``execution_summary`` is declared in the Postgres enum, in the API
        ``Literal`` and in ``research_graph``'s ``promoted_to`` rule, and until
        this call existed the only thing in the tree that produced one was
        ``tools/backfill_research_rag.py``. So a desk that read its own README —
        which lists session execution summaries as an ingested source — and
        searched for one got sweeps back, ranked, looking exactly like an answer.
        This is the seam that makes the claim true on a running desk, because
        this method is the only place in the process that knows a session has
        ended and when.

        Best-effort in one direction only, exactly like the decision hooks in
        ``hooks.py``: a rollover is a trading-state transition and everything
        that has to happen for it has already happened by the time control gets
        here. The corpus is an observer. It gets a guard rather than the caller's
        trust because the alternative once cost this desk a boundary — a
        rollover that raises leaves ``session_date`` on yesterday, so the monitor
        retries the WHOLE roll on the next tick and re-banks the carry, and the
        decision path's copy of the roll would surface an indexing failure as a
        rejected order.

        ``get_rag`` is imported here rather than at module scope. The risk proxy
        is imported by the gate-parity harness and by the native-core suite,
        neither of which has any business dragging in httpx, the card renderers,
        the graph writer and bm25 to decide whether an order passes; and the
        research package imports ``config`` and the audit reader itself, so a
        module-level edge from the trade path into it is a cycle waiting for one
        more import. ``modules/ml/fit.py`` reaches the corpus the same way for
        the same reason.
        """
        if not self.audit:
            # No audit log means no rollover row was written and no figures can
            # be read. A summary here would be an empty card asserting a day of
            # no trading, which is a different and worse thing than no card.
            return
        try:
            from modules.research_rag import get_rag

            get_rag().on_session_closed(self.audit, session_date, closed_at)
        except Exception as exc:
            # Named, not counted. The document that did not get filed is one
            # specific session, and an operator who knows which one can run the
            # backfill for it — nothing was written, so nothing blocks that.
            log.error(
                "session %s closed but its execution summary could not be handed to "
                "the research corpus (%s: %s); the rollover stands and the backfill "
                "can still file it",
                session_date, type(exc).__name__, exc,
            )

    async def _working_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.working_order_sweep_s)
            try:
                await self.sweep_working_orders()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("working-order sweep error: %s", exc)
