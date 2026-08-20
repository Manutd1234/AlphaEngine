"""The paper position book — one symbol's average-cost accounting."""

from __future__ import annotations

from dataclasses import dataclass


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
