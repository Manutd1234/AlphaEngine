"""The read model: the state payload, and the demo reset that clears it."""

from __future__ import annotations

from config import settings
from modules.schemas import Position, RiskState


class ReadModelMixin:
    """The published risk state, and the paper-book reset."""

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
        self._paper_marks.clear()
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
