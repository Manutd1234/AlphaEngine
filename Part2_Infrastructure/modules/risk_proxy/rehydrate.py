"""Startup rehydration: what a restarted process may claim to know.

Two reads off the durable audit log, in this order — the session baseline (what
closed sessions banked, and what today opened on), then this session's accepted
fills. Both are strict: an unreadable or ambiguous record aborts construction
rather than starting the desk on a fabricated baseline.
"""

from __future__ import annotations

import logging
import math

from config import settings
from modules.risk_proxy.positions import PositionState

log = logging.getLogger("alphaengine.risk")


class RehydrationMixin:
    """Rebuild the session baseline and the position book from the audit log."""

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
            if symbol not in self._whitelist:
                # The audit's accepted fill is the durable fallback mark after
                # a restart. The next equity order replaces it with a fresh
                # provider quote before any new exposure is accepted.
                self._paper_marks[symbol] = price

        self.positions.update(restored)
        # The replayed session is a position change like any other.
        self._sync_position_book()
        if fills:
            log.info(
                "rehydrated %d accepted fills into %d current-session positions",
                len(fills), len(restored),
            )
