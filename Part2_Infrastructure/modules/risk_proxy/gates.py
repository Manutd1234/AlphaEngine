"""The gate registry: every name ``RiskGateway.submit`` can put on a decision.

One declared tuple, in evaluation order, read by three things that must agree:

* ``tools/gate_fixture.py`` — the parity harness, which asserts a fixture's
  checks are a subsequence of this order;
* ``modules/supabase_mirror.py`` — which maps each name to a Postgres enum
  label, so a mirrored rejection says what the gateway actually said;
* ``tests/test_supabase_schema.py`` — which harvests the names ``submit``
  really emits from the compiled method and asserts they are exactly this
  tuple.

The registry is a declaration, not a source of truth the hot path reads:
``submit`` still writes each literal itself, because validating a name against
this tuple would put a set lookup on the decision path seventeen times per
order for a property a test can prove once.
"""

from __future__ import annotations

#: The seventeen gates, in the order ``submit()`` evaluates them.
GATE_ORDER: tuple[str, ...] = (
    "kill_switch",
    "symbol_halt",
    "symbol_whitelist",
    "paper_execution_model",
    "reference_freshness",
    "duplicate_order",
    "rate_limit",
    "price_available",
    "order_sized",
    "max_order_notional",
    "symbol_concentration",
    "gross_exposure",
    "price_band",
    "working_book",
    "daily_drawdown",
    "reduce_only",
    "est_slippage",
)
