"""Paper execution: how a fill is priced.

Two fill models, kept side by side because the difference between them is the
whole point. A marketable order crosses the spread and pays for it, so
``_paper_fill`` walks the routed ladder. A resting order is on the other side of
that trade — someone crossed to reach it — so ``_maker_fill`` fills at its own
limit and pays the maker fee, which usually makes its slippage figure negative.

Filling at mid is the single most common way a paper system flatters itself;
neither of these does.
"""

from __future__ import annotations

from config import settings
from modules.risk_proxy.working_orders import WorkingOrderState
from modules.schemas import Fill, OrderRequest


class ExecutionMixin:
    """The maker and taker paper-fill models."""

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

    def _paper_fill(self, req: OrderRequest, qty: float, notional: float, mark: float | None) -> Fill:
        """Simulate execution against the live ladder (Module A), not at mid.

        Filling at mid is the single most common way a backtest or paper system
        flatters itself. Here the fill price is the actual VWAP of the smart
        route, so paper PnL carries the same cost structure as live trading.
        """
        if req.paper_execution:
            slippage_bps = settings.paper_equity_slippage_bps
            direction = 1.0 if req.side == "BUY" else -1.0
            price = req.paper_execution.price * (1.0 + direction * slippage_bps / 1e4)
            return Fill(
                price=price,
                quantity=notional / price,
                notional=notional,
                fee_usd=notional * settings.paper_fee_bps / 1e4,
                slippage_bps=round(slippage_bps, 3),
                venue=f"PAPER_EQUITY/{req.paper_execution.source}",
                simulated=True,
            )

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
