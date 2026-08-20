"""Execution-cost analytics over the live books: estimates, routing, TCA.

Mixed into :class:`~modules.tca_engine.engine.TCAEngine`. This is the half the
risk gateway calls per order, so it is the half worth reading on its own: every
method here answers "what would this order cost", and none of them touch a
socket or a task.
"""

from __future__ import annotations

from modules.schemas import ExecutionEstimate, RoutingLeg, TCAReport
from modules.tca_engine._runtime import settings, utcnow
from modules.tca_engine.tolerance import _dust, absorbs


class EngineAnalytics:
    """Cost questions answered against whatever ``_live_books`` currently holds."""

    def estimate(self, symbol: str, side: str, notional: float, venue: str | None = None) -> list[ExecutionEstimate]:
        books = self._live_books(symbol.upper())
        if venue:
            books = {k: v for k, v in books.items() if k == venue.upper()}
        return [b.walk(side.upper(), notional) for b in books.values()]

    def smart_route(self, symbol: str, side: str, notional: float) -> tuple[list[RoutingLeg], float | None]:
        """Greedy price-time allocation across the *merged* ladder.

        The consolidated book is the union of every venue's levels sorted by
        price; walking it yields the lowest achievable blended VWAP, and the
        per-venue split of that walk is the routing instruction.
        """
        legs, vwap, _ = self._merged_walk(symbol, side, notional)
        return legs, vwap

    def _merged_walk(
        self, symbol: str, side: str, notional: float
    ) -> tuple[list[RoutingLeg], float | None, float]:
        """``smart_route`` plus the raw notional the walk actually took.

        The legs quantise to cents because they are an instruction a human reads
        and a venue receives, but that rounding must not leak into the fill
        decision: summing rounded legs loses up to half a cent *per leg* against
        a request that is not itself on a cent boundary, and the gate then reads
        "only $10,095 of $10,095 routable". The third element is the unrounded
        measurement, and it is the only figure ``fillable`` may be judged on.
        """
        symbol, side = symbol.upper(), side.upper()
        books = self._live_books(symbol)
        if not books:
            return [], None, 0.0

        merged: list[tuple[float, float, str]] = []
        for name, book in books.items():
            levels = book.sorted_asks() if side == "BUY" else book.sorted_bids()
            merged.extend((p, q, name) for p, q in levels)
        merged.sort(key=lambda x: x[0], reverse=(side == "SELL"))

        remaining = notional
        dust = _dust(notional)
        per_venue: dict[str, list[float]] = {}  # venue -> [notional, qty]
        for price, size, venue in merged:
            if remaining <= dust:
                break
            take = min(price * size, remaining)
            if take <= 0:
                continue
            slot = per_venue.setdefault(venue, [0.0, 0.0])
            slot[0] += take
            slot[1] += take / price
            remaining -= take

        total_notional = sum(v[0] for v in per_venue.values())
        total_qty = sum(v[1] for v in per_venue.values())
        if total_qty <= 0:
            return [], None, 0.0

        legs = [
            RoutingLeg(
                venue=venue,
                notional=round(n, 2),
                qty=q,
                vwap=n / q,
                share_pct=round(n / total_notional * 100, 2),
            )
            for venue, (n, q) in sorted(per_venue.items(), key=lambda kv: -kv[1][0])
        ]
        return legs, total_notional / total_qty, total_notional

    def route_estimate(self, symbol: str, side: str, notional: float) -> ExecutionEstimate | None:
        """Execution estimate for the *routed* order — the merged ladder walk.

        This is the number the risk gateway must gate on, because it is exactly
        what ``risk_proxy._paper_fill`` will execute. Gating on the best single
        venue instead would reject orders the router could actually fill, and
        would understate cost on orders it accepted.
        """
        symbol, side = symbol.upper(), side.upper()
        legs, vwap, filled = self._merged_walk(symbol, side, notional)
        if not legs or not vwap:
            return None

        qty = sum(leg.qty for leg in legs)
        mid = self.consolidated_mid(symbol)
        slip = None
        if mid:
            slip = (vwap - mid) / mid * 1e4 if side == "BUY" else (mid - vwap) / mid * 1e4

        return ExecutionEstimate(
            venue="+".join(leg.venue for leg in legs),
            fillable=absorbs(filled, notional),
            # Rounded for display only, and only after the verdict is decided —
            # a partial fill still reports the depth it truly found.
            filled_notional=round(filled, 2),
            filled_qty=qty,
            vwap=vwap,
            mid=mid,
            slippage_bps=slip,
            levels_consumed=len(legs),
            worst_price=None,
        )

    def tca_report(self, symbol: str, side: str = "BUY", notional: float | None = None) -> TCAReport:
        symbol, side = symbol.upper(), side.upper()
        notional = notional or settings.default_probe_notional
        estimates = self.estimate(symbol, side, notional)
        legs, blended_vwap = self.smart_route(symbol, side, notional)
        cmid = self.consolidated_mid(symbol)

        blended_slip = None
        if blended_vwap and cmid:
            blended_slip = (blended_vwap - cmid) / cmid * 1e4 if side == "BUY" else (cmid - blended_vwap) / cmid * 1e4

        fillable = [e for e in estimates if e.fillable and e.vwap]
        best_venue = None
        saving_bps = saving_usd = None
        if fillable:
            best = min(fillable, key=lambda e: e.vwap) if side == "BUY" else max(fillable, key=lambda e: e.vwap)
            worst = max(fillable, key=lambda e: e.vwap) if side == "BUY" else min(fillable, key=lambda e: e.vwap)
            best_venue = best.venue
            if blended_vwap and worst.vwap:
                diff = (worst.vwap - blended_vwap) if side == "BUY" else (blended_vwap - worst.vwap)
                saving_bps = diff / worst.vwap * 1e4
                saving_usd = diff / worst.vwap * notional

        return TCAReport(
            symbol=symbol,
            side=side,
            target_notional=notional,
            generated_at=utcnow(),
            consolidated_mid=cmid,
            per_venue=estimates,
            best_single_venue=best_venue,
            smart_route=legs,
            smart_route_vwap=blended_vwap,
            smart_route_slippage_bps=round(blended_slip, 3) if blended_slip is not None else None,
            saving_vs_worst_bps=round(saving_bps, 3) if saving_bps is not None else None,
            saving_vs_worst_usd=round(saving_usd, 2) if saving_usd is not None else None,
            venues_online=self.venues_online(symbol),
            synthetic=self.is_synthetic(symbol),
        )
