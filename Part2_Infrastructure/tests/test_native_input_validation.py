"""Native calls reject malformed parallel inputs without process corruption."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_mismatched_position_vectors_raise_instead_of_crashing_the_process() -> None:
    """Every planted parallel-vector mismatch must stop at the binding seam."""
    script = r'''
import modules._decision_core as core

base = {
    "side_is_buy": True,
    "order_type_is_limit": False,
    "order_quantity": 1.0,
    "order_notional": None,
    "limit_price": None,
    "is_paper": True,
    "paper_price": 100.0,
    "order_books": [],
    "pos_quantities": [1.0],
    "pos_avg_prices": [100.0],
    "pos_realized": [0.0],
    "pos_marks": [100.0],
    "pos_is_order_symbol": [True],
    "working_buys": 0.0,
    "working_sells": 0.0,
    "starting_equity": 1000.0,
    "carried_realized_pnl": 0.0,
    "start_of_day_equity": 1000.0,
    "max_order_notional_usd": 1000.0,
    "max_symbol_notional_usd": 1000.0,
    "max_gross_exposure_usd": 1000.0,
    "max_price_deviation_bps": 100.0,
    "max_daily_drawdown_pct": 0.1,
    "reduce_only_threshold": 0.8,
    "reduce_only_override": False,
    "route_enabled": False,
}

for field in (
    "pos_quantities",
    "pos_avg_prices",
    "pos_realized",
    "pos_marks",
    "pos_is_order_symbol",
):
    planted = dict(base)
    planted[field] = []
    try:
        core.decide(**planted)
    except ValueError as exc:
        assert "pos_* vectors must have identical lengths" in str(exc), str(exc)
    else:
        raise AssertionError(f"mismatched {field} was accepted")

empty_call = dict(base)
empty_call.update(
    is_paper=False,
    paper_price=None,
    order_books=[core.BookLadder()],
    pos_quantities=[],
    pos_avg_prices=[],
    pos_realized=[],
    pos_marks=[],
    pos_is_order_symbol=[],
)
empty_result = core.decide(**empty_call)
assert empty_result.mark is None and not empty_result.has_price

print("POSITION_VECTOR_MISMATCHES_REJECTED")
'''
    run = subprocess.run(  # noqa: S603 - fixed interpreter and committed test program
        [sys.executable, "-c", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert run.returncode == 0, f"native child exited {run.returncode}: {run.stderr}"
    assert run.stdout.strip() == "POSITION_VECTOR_MISMATCHES_REJECTED"
