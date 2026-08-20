"""The hot path: one order, seventeen gates, a verdict in microseconds.

Deliberately one function. Every gate reads state the previous one may have
just derived, the whole battery runs under one lock with one consolidated mark
per symbol, and the budget is sub-millisecond — so a split that put a call
boundary, an allocation or an attribute indirection between two gates would be
paid on every order for a tidier file. ``native_core.py`` holds the compiled
half; the control flow, the detail strings and every ``add("<name>", ...)``
literal stay here, which is what ``modules/risk_proxy/gates.py`` declares and
``tests/test_supabase_schema.py`` harvests from the compiled method.
"""

from __future__ import annotations

import asyncio
import time

from config import settings
from modules.metrics import observe_core_latency, observe_decision_latency
from modules.risk_proxy.clock import _utcnow
from modules.risk_proxy.identity import _order_ids
from modules.risk_proxy.positions import PositionState
from modules.schemas import CheckResult, OrderRequest, RiskDecision


class DecisionMixin:
    """``submit`` — the pre-trade decision."""

    async def submit(self, req: OrderRequest, source: str = "api") -> RiskDecision:
        t0 = time.perf_counter_ns()
        checks: list[CheckResult] = []
        order_id = _order_ids.next()

        def add(name: str, passed: bool, detail: str, observed=None, limit=None) -> bool:
            checks.append(CheckResult(name=name, passed=passed, detail=detail, observed=observed, limit=limit))
            return passed

        async with self._lock:
            self._roll_session_if_needed()
            # One consolidated mark per symbol for the life of this decision.
            self._mark_memo = {}
            try:

                # 1 — kill switch (single boolean; always first)
                add("kill_switch", not self.kill.active, self.kill.reason or "disengaged")
                # 2 — per-symbol halt
                add("symbol_halt", req.symbol not in self.kill.halted_symbols, f"{req.symbol} halt status")
                # 3 — instrument whitelist. Membership against a prebuilt frozenset;
                # the list comprehension this replaced rebuilt and re-uppercased the
                # configured symbols on every single order.
                paper_equity = req.paper_execution is not None
                add("symbol_whitelist", req.symbol in self._whitelist or paper_equity,
                    f"{req.symbol} in the live L2 universe or backed by a trusted paper-equity quote")
                if paper_equity:
                    add(
                        "paper_execution_model",
                        req.order_type == "MARKET",
                        "quote-based paper equity execution supports MARKET orders only; no L2 liquidity is claimed",
                    )
                    quote_age_s = (_utcnow() - req.paper_execution.as_of).total_seconds()
                    quote_fresh = -60.0 <= quote_age_s <= settings.paper_equity_quote_max_age_s
                    add(
                        "reference_freshness",
                        quote_fresh,
                        f"{req.paper_execution.source} quote age {max(quote_age_s, 0.0):.0f}s"
                        + (" (delayed)" if req.paper_execution.delayed else ""),
                        observed=max(quote_age_s, 0.0),
                        limit=settings.paper_equity_quote_max_age_s,
                    )
                # 4 — idempotency: a retrying algo must not double-fire
                dup = bool(req.client_order_id and req.client_order_id in self._seen_set)
                add("duplicate_order", not dup, f"client_order_id={req.client_order_id or '-'}")
                # 5 — rate limit
                allowed = self.bucket.try_consume()
                observed_rate = self.bucket.observed_rate()
                add("rate_limit", allowed, f"{observed_rate:.1f}/s observed",
                    observed=observed_rate, limit=settings.max_orders_per_sec)

                # The native decision core (when it is the active engine) owns
                # the book arithmetic, the numeric gates that follow and the
                # routed slippage walk. The seventeen gates' order, their detail
                # strings and every add("<name>", ...) literal stay here; only
                # the numbers come from the core. A `None` result — the Python
                # engine, or an order the core cannot express — runs the
                # reference path below unchanged.
                core, route_venues = self._native_decide(req, paper_equity)
                if core is not None:
                    self.last_decision_core_ns = core.elapsed_ns
                    observe_core_latency(core.elapsed_ns)

                # 6 — price discovery. No mark => no risk assessment => reject.
                if core is not None:
                    mark = core.mark
                    has_price = core.has_price
                    qty = core.qty
                    notional = core.notional
                else:
                    mark = req.paper_execution.price if paper_equity else self.mark(req.symbol)
                    ref_price = req.limit_price or mark
                    has_price = ref_price is not None and ref_price > 0
                    qty = req.quantity
                    notional = req.notional
                    if has_price:
                        if qty is None and notional is not None:
                            qty = notional / ref_price
                        elif notional is None and qty is not None:
                            notional = qty * ref_price
                add("price_available", bool(has_price), f"mark={mark}" if mark else "no live mark price")
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
                    # 9 — projected gross exposure, likewise.
                    if core is not None:
                        projected_sym = core.projected_sym
                        projected_gross = core.projected_gross
                    else:
                        price_ref = mark or ref_price or 0
                        signed_qty = (qty or 0) * (1 if req.side == "BUY" else -1)
                        projected_sym = self.projected_symbol_notional(req.symbol, signed_qty, price_ref)
                        projected_gross = (
                            self.gross_exposure() - self.symbol_notional(req.symbol) + projected_sym
                        )
                    add("symbol_concentration", projected_sym <= settings.max_symbol_notional_usd,
                        f"${projected_sym:,.0f} projected vs ${settings.max_symbol_notional_usd:,.0f}",
                        observed=projected_sym, limit=settings.max_symbol_notional_usd)
                    add("gross_exposure", projected_gross <= settings.max_gross_exposure_usd,
                        f"${projected_gross:,.0f} projected vs ${settings.max_gross_exposure_usd:,.0f}",
                        observed=projected_gross, limit=settings.max_gross_exposure_usd)

                # 10 — limit price sanity (the other half of fat-finger protection)
                if req.order_type == "LIMIT" and req.limit_price and mark:
                    dev_bps = core.dev_bps if core is not None else abs(req.limit_price - mark) / mark * 1e4
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
                dd = core.dd if core is not None else self.daily_drawdown_pct()
                add("daily_drawdown", dd < settings.max_daily_drawdown_pct,
                    f"{dd:.2%} used of {settings.max_daily_drawdown_pct:.2%}",
                    observed=dd, limit=settings.max_daily_drawdown_pct)

                # 12 — reduce-only mode. Between the soft threshold and the hard
                # breaker the desk may still close positions but not open or add to
                # them: a book in trouble needs a way *out*, and refusing the exit
                # alongside the entry is how a drawdown becomes a liquidation.
                reduce_only_on = core.reduce_only_active if core is not None else self.reduce_only_active()
                if reduce_only_on and notional is not None:
                    if core is not None:
                        reducing = core.reducing
                        budget_used = core.budget_used
                    else:
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
                if paper_equity and notional:
                    model_slippage = settings.paper_equity_slippage_bps
                    add(
                        "est_slippage",
                        model_slippage <= settings.max_est_slippage_bps,
                        f"{model_slippage:.2f}bps fixed paper-equity model; no exchange depth asserted",
                        observed=model_slippage,
                        limit=settings.max_est_slippage_bps,
                    )
                elif self.tca and notional:
                    # The merged-ladder walk itself — the k-way merge, the greedy
                    # consumption and the blended VWAP — is what the core now
                    # evaluates; `route_estimate` remains the reference and still
                    # serves every other caller. Both produce the same four
                    # figures, and the parity fixture is what says so.
                    #
                    # `round()` and the leg string stay here, deliberately:
                    # Python's round is decimal-half-even, and rounding inside
                    # C++ would be a parity break waiting to happen. Both are
                    # display work, and both run after the core's clock stops.
                    if core is not None and core.route_ran:
                        routed = None if core.route_none else (
                            core.route_fillable,
                            round(core.route_filled_notional, 2),
                            core.route_slippage_bps if core.route_has_slip else None,
                            "+".join(route_venues[i] for i in core.route_venue_order),
                        )
                    else:
                        est = self.tca.route_estimate(req.symbol, req.side, notional)
                        routed = None if est is None else (
                            est.fillable, est.filled_notional, est.slippage_bps, est.venue,
                        )
                    if routed is None:
                        add("est_slippage", False, "no routable liquidity")
                    else:
                        fillable, filled_notional, slippage_bps, route_venue = routed
                        if not fillable:
                            add("est_slippage", False,
                                f"only ${filled_notional:,.0f} of ${notional:,.0f} routable across "
                                f"{route_venue or 'all venues'}")
                        elif slippage_bps is not None:
                            add("est_slippage", slippage_bps <= settings.max_est_slippage_bps,
                                f"{slippage_bps:+.2f}bps routing {route_venue}",
                                observed=slippage_bps, limit=settings.max_est_slippage_bps)

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
                latency_ns = time.perf_counter_ns() - t0
                latency_ms = latency_ns / 1e6
                # `latency_ms` on the decision is a single sample and always will be
                # — it belongs to that order. The histogram is what makes the tail
                # visible: one slow decision is invisible in a mean and is the whole
                # story in a p99.9. Integer nanoseconds from the clock; the API
                # field keeps its millisecond unit.
                observe_decision_latency(latency_ns / 1000.0)

                if accepted and qty and notional:
                    if req.client_order_id:
                        if len(self._seen_client_ids) == self._seen_client_ids.maxlen:
                            self._seen_set.discard(self._seen_client_ids[0])
                        self._seen_client_ids.append(req.client_order_id)
                        self._seen_set.add(req.client_order_id)

                    if marketable:
                        status = "FILLED"
                        if req.paper_execution:
                            self._paper_marks[req.symbol] = req.paper_execution.price
                        fill = self._paper_fill(req, qty, notional, mark)
                        position = self.positions.setdefault(req.symbol, PositionState(req.symbol))
                        position.apply_fill(req.side, fill.quantity, fill.price, fill.fee_usd)
                        self._sync_position_book()
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
            finally:
                # Cleared even if a gate raises, so `_monitor_loop` and
                # `state()` never read a mark frozen at a failed decision.
                self._mark_memo = None

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
