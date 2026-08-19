"""The mirrored PositionBook decides identically to the five vectors.

decide() has two ways to learn the held book: five parallel Python lists the
caller builds per order, or a PositionBook the gateway mutates on fills. The
fixture suite drives the vector path. This drives both and demands the same
doubles out — not close, the same, because every gate downstream of these folds
is compared against a limit and a ULP is a different decision at the boundary.
"""

from __future__ import annotations

import pytest

from modules import decision_core

core = decision_core.native()
pytestmark = pytest.mark.skipif(core is None, reason="native decision core not built")


def _ladder(mid: float, size: float = 5000.0, levels: int = 50):
    ladder = core.BookLadder()
    ladder.snapshot(
        bids=[(round(mid - i * 0.01, 4), size) for i in range(levels)],
        asks=[(round(mid + i * 0.01, 4), size) for i in range(levels)],
    )
    return ladder


#: (symbol, quantity, avg_price, ladder mid or None, paper mark or None)
BOOKS = [
    ("BTCUSDT", 0.5, 99.5, 100.0, None),
    ("ETHUSDT", -2.0, 50.25, 50.0, None),
    ("AAPL", 10.0, 180.0, None, 190.5),      # paper-marked, no live book
    ("SOLUSDT", 0.0, 0.0, 140.0, None),      # flat but still held
]

FIELDS = (
    "mark", "has_price", "qty", "notional", "projected_sym", "projected_gross",
    "dev_bps", "dd", "reduce_only_active", "reducing", "budget_used",
    "route_ran", "route_none", "route_fillable", "route_filled_notional",
    "route_has_slip", "route_slippage_bps", "route_venue_order",
)


def _decide(order_books, *, book=None, vectors=None, symbol="BTCUSDT"):
    quantities, avg_prices, realized, marks, is_order = vectors or ([], [], [], [], [])
    return core.decide(
        True, False, None, 10_000.0, None, False, None, order_books,
        quantities, avg_prices, realized, marks, is_order,
        0.0, 0.0, 1_000_000.0, 0.0, 1_000_000.0,
        250_000.0, 500_000.0, 2_000_000.0, 500.0, 0.05, 0.80, False, True,
        book, symbol,
    )


@pytest.mark.parametrize("order_symbol", ["BTCUSDT", "ETHUSDT", "AAPL", "SOLUSDT", "XRPUSDT"])
def test_the_mirror_and_the_vectors_produce_identical_doubles(order_symbol):
    ladders = {sym: (_ladder(mid) if mid is not None else None) for sym, _q, _a, mid, _p in BOOKS}
    order_books = [ladders["BTCUSDT"]]

    book = core.PositionBook()
    quantities, avg_prices, realized, marks, is_order = [], [], [], [], []
    for symbol, quantity, avg_price, _mid, paper in BOOKS:
        book.upsert(symbol, quantity, avg_price, 12.5)
        ladder = ladders[symbol]
        if ladder is not None:
            book.set_books(symbol, [ladder])
        if paper is not None:
            book.set_paper_mark(symbol, paper)

        quantities.append(quantity)
        avg_prices.append(avg_price)
        realized.append(12.5)
        # RiskGateway.mark(): the consolidated mid, or the paper mark when
        # there is no live one. Python's `or` treats 0.0 as falsy.
        live = ladder.mid() if ladder is not None else None
        marks.append(live if live else paper)
        is_order.append(symbol == order_symbol)

    from_vectors = _decide(order_books, vectors=(quantities, avg_prices, realized, marks, is_order),
                           symbol=order_symbol)
    from_book = _decide(order_books, book=book, symbol=order_symbol)

    for field in FIELDS:
        assert getattr(from_book, field) == getattr(from_vectors, field), field


def test_an_empty_mirror_matches_an_empty_book():
    ladder = _ladder(100.0)
    book = core.PositionBook()
    assert len(book) == 0
    a = _decide([ladder], vectors=([], [], [], [], []))
    b = _decide([ladder], book=book)
    for field in FIELDS:
        assert getattr(a, field) == getattr(b, field), field


def test_a_zero_live_mid_falls_through_to_the_paper_mark():
    # `live or paper` — Python's `or`, where 0.0 is falsy. value_or would keep
    # the zero and mark the position at nothing.
    empty = core.BookLadder()
    empty.snapshot(bids=[], asks=[])
    book = core.PositionBook()
    book.upsert("AAPL", 10.0, 180.0, 0.0)
    book.set_books("AAPL", [empty])
    book.set_paper_mark("AAPL", 190.5)

    ladder = _ladder(100.0)
    from_book = _decide([ladder], book=book, symbol="BTCUSDT")
    from_vectors = _decide([ladder], vectors=([10.0], [180.0], [0.0], [190.5], [False]),
                           symbol="BTCUSDT")
    assert from_book.projected_gross == from_vectors.projected_gross


def test_the_mirror_keeps_its_ladders_alive():
    # BookState.native_ladder() documents the ladder as borrowed for one
    # synchronous call. A stored mirror outlives that, and holding the raw
    # pointer alone segfaulted the suite. The Entry holds a py::object too.
    book = core.PositionBook()
    book.upsert("BTCUSDT", 1.0, 100.0, 0.0)
    book.set_books("BTCUSDT", [_ladder(100.0)])   # no local reference kept
    import gc

    gc.collect()
    ladder = _ladder(100.0)
    result = _decide([ladder], book=book, symbol="BTCUSDT")
    assert result.projected_gross > 0
