"""Marks, P&L and exposure — the arithmetic every gate and panel reads.

Read-only over the in-memory book. ``mark()`` is the one memoised call: a single
decision can ask for the same symbol five times, and the per-decision memo in
``submit`` consolidates the venue books once instead.
"""

from __future__ import annotations

from config import settings


class AccountingMixin:
    """Marks, realized/unrealized P&L, equity, drawdown and exposure."""

    def mark(self, symbol: str) -> float | None:
        memo = self._mark_memo
        if memo is not None and symbol in memo:
            return memo[symbol]
        live = self.tca.last_price(symbol) if self.tca else None
        value = live or self._paper_marks.get(symbol)
        if memo is not None:
            memo[symbol] = value
        return value

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
