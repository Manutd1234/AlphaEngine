"""A fully materialized, exception-safe native decision result."""

from __future__ import annotations

from typing import Any, NamedTuple


class NativeDecisionResult(NamedTuple):
    """Values the Python gate flow consumes after the pybind call returns.

    Constructing this object reads every extension-backed property while the
    native fallback boundary is still active. The gate flow therefore never
    holds a half-converted pybind object whose later accessor can escape the
    fallback path or be reported as a successful native decision.
    """

    elapsed_ns: int
    mark: float | None
    has_price: bool
    qty: float | None
    notional: float | None
    projected_sym: float
    projected_gross: float
    dev_bps: float
    dd: float
    reduce_only_active: bool
    reducing: bool
    budget_used: float
    route_ran: bool
    route_none: bool
    route_fillable: bool
    route_filled_notional: float
    route_has_slip: bool
    route_slippage_bps: float
    route_venue_order: tuple[int, ...]

    @classmethod
    def materialize(
        cls,
        result: Any,
        venue_count: int | None = None,
        native_result_type: type | None = None,
    ) -> NativeDecisionResult:
        packed = getattr(result, "materialize_tuple", None)
        if native_result_type is not None and type(result) is native_result_type and callable(packed):
            return cls(*packed(venue_count))
        materialized = cls(
            int(result.elapsed_ns),
            result.mark,
            bool(result.has_price),
            result.qty,
            result.notional,
            float(result.projected_sym),
            float(result.projected_gross),
            float(result.dev_bps),
            float(result.dd),
            bool(result.reduce_only_active),
            bool(result.reducing),
            float(result.budget_used),
            bool(result.route_ran),
            bool(result.route_none),
            bool(result.route_fillable),
            float(result.route_filled_notional),
            bool(result.route_has_slip),
            float(result.route_slippage_bps),
            tuple(int(venue) for venue in result.route_venue_order),
        )
        materialized.validate_route(venue_count)
        return materialized

    def validate_route(self, venue_count: int | None) -> None:
        if venue_count is None:
            return
        has_route = bool(self.route_venue_order)
        if has_route != (self.route_ran and not self.route_none):
            raise ValueError("native route topology is inconsistent")
        if len(set(self.route_venue_order)) != len(self.route_venue_order):
            raise ValueError("native route contains a duplicate venue")
        if any(venue < 0 or venue >= venue_count for venue in self.route_venue_order):
            raise ValueError("native route venue index is out of range")
