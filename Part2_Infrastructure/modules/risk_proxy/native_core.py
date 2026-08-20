"""The compiled gate battery, and the book mirror it decides against.

Everything here is about the C++ decision core: resolving it, keeping the
native ``PositionBook`` mirror in step with the Python book, marshalling one
order into ``decide()``, and timing the battery once at startup on a synthetic
book so the core histogram is not empty after a deploy.

The seventeen gates' control flow, their detail strings and every
``add("<name>", ...)`` literal stay in ``decision.py``; only the numbers come
from here.
"""

from __future__ import annotations

import importlib
import logging

from config import settings
from modules.metrics import observe_core_self_test_latency
from modules.schemas import OrderRequest

log = logging.getLogger("alphaengine.risk")


class NativeCoreMixin:
    """Resolution, mirroring and marshalling for the native decision core."""

    @staticmethod
    def _resolve_decision_core():
        """The native core module when it is the active engine, else None.

        Resolved via ``importlib`` rather than a module-level ``import`` so the
        bench harness — which swaps ``DECISION_CORE`` and re-imports
        ``modules.decision_core`` between runs — hands us the module it just
        selected, not the one bound when this file was first imported.
        """
        try:
            loader = importlib.import_module("modules.decision_core")
            return loader.native()
        except Exception:  # pragma: no cover - a broken loader must not break orders
            log.exception("decision core loader unavailable; using the Python reference")
            return None

    def _sync_position_book(self) -> None:
        """Re-mirror the held book into the native PositionBook.

        Called where positions change, not where they are read: a fill, a paper
        execution, and the audit replay at startup. Between those the mirror is
        already correct, including its marks — it holds pointers to the same
        BookLadder objects the feed funnels mutate, so a venue tick updates
        what the mirror sees without anything crossing the boundary.

        Cheap to call and safe to call twice; it is a full rebuild rather than
        a diff because a diff of five floats per position is more code than the
        rebuild it would save, and this runs on fills.
        """
        book = self._position_book
        if book is None:
            return
        book.clear()
        live: dict[str, tuple[str, ...]] = {}
        for symbol, position in self.positions.items():
            book.upsert(symbol, position.quantity, position.avg_price, position.realized_pnl)
            paper = self._paper_marks.get(symbol)
            if paper is not None:
                book.set_paper_mark(symbol, paper)
            names: tuple[str, ...] = ()
            if self.tca is not None:
                ladders = []
                books = self.tca._live_books(symbol)
                for state in books.values():
                    ladder = state.native_ladder()
                    # A book with no mirror cannot contribute to a mark. Leaving
                    # it out would silently change the consolidation, so the
                    # whole mirror is abandoned and submit() takes the vector
                    # path, exactly as it does when the extension is absent.
                    if ladder is None:
                        self._position_book_live = None
                        book.clear()
                        return
                    ladders.append(ladder)
                book.set_books(symbol, ladders)
                names = tuple(books.keys())
            live[symbol] = names
        self._position_book_live = live

    def _position_book_for(self, symbol: str):
        """The mirror, if it is currently trustworthy.

        Returns None when there is no native core, when the mirror was
        abandoned, or when the set of venue books has changed since it took its
        pointers — in which case it re-syncs first and answers with the fresh
        one. The check is a single integer compare; noticing a new venue any
        other way would cost more than the mirror saves.
        """
        book = self._position_book
        if book is None:
            return None
        mirrored = self._position_book_live
        if mirrored is None or len(mirrored) != len(self.positions):
            self._sync_position_book()
            mirrored = self._position_book_live
            if mirrored is None:
                return None
        if self.tca is not None:
            for symbol in self.positions:
                if mirrored.get(symbol) != tuple(self.tca._live_books(symbol).keys()):
                    # A venue joined or dropped out of this symbol's
                    # consolidation. Re-mirror rather than decide against a set
                    # of ladders the desk no longer considers live.
                    self._sync_position_book()
                    mirrored = self._position_book_live
                    if mirrored is None:
                        return None
                    break
        return book if len(book) == len(self.positions) else None

    def _native_decide(self, req: OrderRequest, paper_equity: bool):
        """Run the numeric gates, the book arithmetic and the routed walk natively.

        Returns ``(core_result, venue_names)``, or ``(None, ())`` to fall back to
        the Python reference. ``venue_names`` is positional with the ladders the
        core walked, so ``submit`` can name the routing legs from the core's
        ``route_venue_order`` *after* its clock has stopped — no string work
        happens inside the measured region.

        The seventeen-gate control flow, the detail strings and every
        ``add("<name>", ...)`` literal stay in ``submit``; only the numbers come
        from here. The book consolidation, the exposure and drawdown arithmetic
        and the routed slippage walk run in C++; the pure input booleans, the set
        memberships and the clock reads stay in Python — see
        ``native/decision_core/decision_core.cpp`` for the exact line.
        """
        core = self._decision_core
        if core is None:
            return None, ()
        try:
            symbol = req.symbol
            order_books = []
            venue_names: tuple[str, ...] = ()
            if not paper_equity and self.tca is not None:
                # The order symbol's live venue books, in the same iteration
                # order `consolidated_mid` folds them and `_merged_walk` extends
                # them. These are BookState's PERSISTENT C++ mirrors, borrowed
                # rather than rebuilt: nothing is re-marshalled per decision, and
                # the routed walk needs every level, not the five the mark reads.
                names: list[str] = []
                for name, book in self.tca._live_books(symbol).items():
                    ladder = book.native_ladder()
                    if ladder is None:
                        # A book with no mirror (extension absent, or the engine
                        # switched under a book that has never updated since).
                        # The Python reference decides the whole order rather
                        # than half of it deciding natively.
                        return None, ()
                    order_books.append(ladder)
                    names.append(name)
                venue_names = tuple(names)

            # The mirror, when it is trustworthy: the core then expands the
            # held book itself, inside its own timed region, and consolidates
            # each position's mark from ladders it already owns. Nothing about
            # the book crosses the boundary per order.
            position_book = self._position_book_for(symbol)
            pos_quantities: list[float] = []
            pos_avg_prices: list[float] = []
            pos_realized: list[float] = []
            pos_marks: list[float | None] = []
            pos_is_order_symbol: list[bool] = []
            if position_book is None:
                for sym, pos in self.positions.items():
                    pos_quantities.append(pos.quantity)
                    pos_avg_prices.append(pos.avg_price)
                    pos_realized.append(pos.realized_pnl)
                    # self.mark(sym): each position's mark is its own
                    # multi-venue consolidation, computed here so the core need
                    # only fold it.
                    pos_marks.append(self.mark(sym))
                    pos_is_order_symbol.append(sym == symbol)

            working_buys, working_sells = self.working_qty(symbol)
            paper_price = req.paper_execution.price if paper_equity else None

            # Positional, not by keyword. pybind11 resolves py::arg names
            # through a dict on every call, and this one has twenty-six of
            # them on the per-order path; the argument order below is the
            # order of decide()'s C++ signature and is checked by the parity
            # fixtures, which would fail loudly on any transposition. The
            # self-measure probe further down keeps the keyword form on
            # purpose — it runs once at startup, where naming beats speed.
            result = core.decide(
                (req.side == "BUY"),                    # side_is_buy
                (req.order_type == "LIMIT"),            # order_type_is_limit
                req.quantity,                           # order_quantity
                req.notional,                           # order_notional
                req.limit_price,                        # limit_price
                paper_equity,                           # is_paper
                paper_price,                            # paper_price
                order_books,                            # order_books
                pos_quantities,                         # pos_quantities
                pos_avg_prices,                         # pos_avg_prices
                pos_realized,                           # pos_realized
                pos_marks,                              # pos_marks
                pos_is_order_symbol,                    # pos_is_order_symbol
                working_buys,                           # working_buys
                working_sells,                          # working_sells
                settings.starting_equity_usd,           # starting_equity
                self.carried_realized_pnl,              # carried_realized_pnl
                self.start_of_day_equity,               # start_of_day_equity
                settings.max_order_notional_usd,        # max_order_notional_usd
                settings.max_symbol_notional_usd,       # max_symbol_notional_usd
                settings.max_gross_exposure_usd,        # max_gross_exposure_usd
                settings.max_price_deviation_bps,       # max_price_deviation_bps
                settings.max_daily_drawdown_pct,        # max_daily_drawdown_pct
                settings.reduce_only_threshold,         # reduce_only_threshold
                self._reduce_only_override,             # reduce_only_override
                # submit() gates on the routed walk only where it has a router
                # to route with; without a TCA engine there is no est_slippage
                # check at all, and the core must not invent one.
                self.tca is not None,                   # route_enabled
                position_book,                          # position_book
                symbol,                                 # order_symbol
            )
            return result, venue_names
        except Exception:  # pragma: no cover - robustness: never fail an order on the core
            log.exception("native decision core raised; falling back to the Python reference")
            return None, ()

    #: The startup self-measure's synthetic book: two venues, five levels a
    #: side, one cent apart around 100.0, the second venue a cent wider, 5 000
    #: units at every level. Fixed on purpose — a self-measure that varied its
    #: input would be measuring its input.
    _SELF_MEASURE_LADDERS: tuple[tuple[list[tuple[float, float]], list[tuple[float, float]]], ...] = (
        (
            [(99.99, 5000.0), (99.98, 5000.0), (99.97, 5000.0), (99.96, 5000.0), (99.95, 5000.0)],
            [(100.01, 5000.0), (100.02, 5000.0), (100.03, 5000.0), (100.04, 5000.0), (100.05, 5000.0)],
        ),
        (
            [(99.98, 5000.0), (99.97, 5000.0), (99.96, 5000.0), (99.95, 5000.0), (99.94, 5000.0)],
            [(100.02, 5000.0), (100.03, 5000.0), (100.04, 5000.0), (100.05, 5000.0), (100.06, 5000.0)],
        ),
    )
    _SELF_MEASURE_WARMUP = 50
    _SELF_MEASURE_SAMPLES = 300

    def run_core_self_measure(self) -> int:
        """Time the compiled battery once at startup, on a synthetic two-venue book.

        The core histogram otherwise contains only submitted orders and empties
        on every restart, so the desk read "no orders yet" after each deploy
        with the nanosecond figure nowhere in sight. This runs the *same*
        ``decide()`` the order path runs — same compiled battery, same
        ``steady_clock`` inside it — against two ``BookLadder`` objects built
        directly from the extension, and records each measured iteration
        through ``observe_core_self_test_latency`` so the count of synthetic
        samples is published beside the total. Fifty warm-up calls first (not
        recorded), then three hundred measured; the whole thing costs well
        under a millisecond.

        What it deliberately does not do: touch the decision (µs) histogram,
        the order counters, the audit log, the token bucket or the TCA engine.
        A self-measure is evidence about the *core*, and the µs plane is the
        whole ``submit()`` under its lock, which nothing synthetic may enter.

        Returns the number of samples recorded: 0 on the Python engine (a
        silent no-op — there is no core to time), and 0 on any failure, which
        is logged and leaves the histogram untouched. Never raises.
        """
        core = self._decision_core
        if core is None:
            return 0
        try:
            ladders = []
            for bids, asks in self._SELF_MEASURE_LADDERS:
                ladder = core.BookLadder()
                ladder.snapshot(bids, asks)
                ladders.append(ladder)
            # The arguments mirror `_native_decide` for a live (non-paper) BUY
            # by notional against the two ladders above, holding one position
            # in the order symbol, with the deployed limits — the shape a real
            # decision takes, minus the strings. Nothing here reads gateway
            # state that an order could have moved.
            kwargs = dict(
                side_is_buy=True,
                order_type_is_limit=False,
                order_quantity=None,
                order_notional=10_000.0,
                limit_price=None,
                is_paper=False,
                paper_price=None,
                order_books=ladders,
                pos_quantities=[0.5],
                pos_avg_prices=[99.5],
                pos_realized=[0.0],
                pos_marks=[100.0],
                pos_is_order_symbol=[True],
                working_buys=0.0,
                working_sells=0.0,
                starting_equity=settings.starting_equity_usd,
                carried_realized_pnl=0.0,
                start_of_day_equity=settings.starting_equity_usd,
                max_order_notional_usd=settings.max_order_notional_usd,
                max_symbol_notional_usd=settings.max_symbol_notional_usd,
                max_gross_exposure_usd=settings.max_gross_exposure_usd,
                max_price_deviation_bps=settings.max_price_deviation_bps,
                max_daily_drawdown_pct=settings.max_daily_drawdown_pct,
                reduce_only_threshold=settings.reduce_only_threshold,
                reduce_only_override=False,
                # Two ladders are supplied, so the routed walk — the expensive
                # end of the battery — is part of what is timed.
                route_enabled=True,
            )
            for _ in range(self._SELF_MEASURE_WARMUP):
                core.decide(**kwargs)
            recorded = 0
            for _ in range(self._SELF_MEASURE_SAMPLES):
                result = core.decide(**kwargs)
                observe_core_self_test_latency(result.elapsed_ns)
                recorded += 1
            log.info("decision core self-measure: %d samples on the synthetic two-venue book", recorded)
            return recorded
        except Exception:
            log.warning("decision core self-measure failed; the core histogram is untouched", exc_info=True)
            return 0
