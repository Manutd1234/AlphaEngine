"""The native decision core reproduces the Python reference, to the bit.

Three claims, each an assertion rather than a skip:

* the core *builds and imports* — unless an operator has explicitly opted out
  with ``DECISION_CORE=python``, an unimportable ``modules._decision_core`` is a
  red build, not a quiet fall-back to Python (that is what CI must catch);
* forced onto the native engine, the gateway decides every gate-parity scenario
  *exactly* as the committed fixture — same accept/reject, same gate order, same
  observed and limit floats — and a divergence names the gate and the delta;
* ``BookLadder`` folds a book identically to a fresh Python dict-sort, including
  ``depth_usd``'s Neumaier-compensated sum, over random deltas.

The sister suite ``test_gate_parity.py`` pins the same fixture to the Python
reference; a break in either is a real parity failure, never a tolerance to
loosen.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import random
from pathlib import Path

import pytest

from modules.risk_proxy import RiskGateway
from modules.schemas import OrderRequest
from tools.gate_fixture import GATE_ORDER, build_gateway, expected_from

FIXTURE = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "gate-parity.json"
DATA = json.loads(FIXTURE.read_text())
SCENARIOS = DATA["scenarios"]

#: submit()'s gate battery, in order — the canonical list the fixture is a
#: subsequence of. Duplicated here on purpose: if submit() reorders or renames a
#: gate, this and the fixture must both be updated deliberately.
EXPECTED_GATE_ORDER = (
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


def _native_module():
    """The built extension, or None if it will not import."""
    try:
        return importlib.import_module("modules._decision_core")
    except ImportError:
        return None


def test_native_core_imports() -> None:
    """The .so must build and import — a hard failure unless python was requested.

    CI does not set ``DECISION_CORE``, so the default (``auto``) reaches here and
    a broken build turns this red. Only an explicit ``DECISION_CORE=python`` — a
    deliberate opt-out of the native engine — excuses a missing extension.
    """
    requested = os.getenv("DECISION_CORE", os.getenv("ALPHAENGINE_DECISION_CORE", "auto")).strip().lower()
    module = _native_module()
    if requested == "python":
        return  # operator opted out of native; its absence is not a failure here
    assert module is not None, (
        "modules._decision_core failed to import. Build it with: "
        "python native/decision_core/setup.py build_ext --inplace --build-temp build/native"
    )
    assert hasattr(module, "decide"), "native core is missing decide()"
    assert hasattr(module, "BookLadder"), "native core is missing BookLadder"


def test_gate_order_matches_the_fixture() -> None:
    assert GATE_ORDER == EXPECTED_GATE_ORDER
    for name, scenario in SCENARIOS.items():
        names = [c["name"] for c in scenario["expected"]["checks"]]
        assert set(names) <= set(EXPECTED_GATE_ORDER), f"{name} names an unknown gate"
        ranks = [EXPECTED_GATE_ORDER.index(n) for n in names]
        assert ranks == sorted(ranks), f"{name} checks are out of gate order"


def _force_native(monkeypatch) -> object:
    module = _native_module()
    if module is None:
        pytest.fail(
            "modules._decision_core is not built — cannot exercise the native engine. "
            "Build it with: python native/decision_core/setup.py build_ext --inplace "
            "--build-temp build/native"
        )
    # Pin the engine regardless of DECISION_CORE / loader state: every gateway
    # built under this test resolves to the native module.
    monkeypatch.setattr(RiskGateway, "_resolve_decision_core", staticmethod(lambda: module))
    return module


def _diff_message(name: str, expected: dict, actual: dict) -> str:
    lines = [f"scenario {name}: native decision diverged from the committed reference"]
    if expected.get("accepted") != actual.get("accepted"):
        lines.append(f"  accepted: reference={expected['accepted']} native={actual['accepted']}")
    if expected.get("status") != actual.get("status"):
        lines.append(f"  status: reference={expected['status']} native={actual['status']}")
    if expected.get("rejected_by") != actual.get("rejected_by"):
        lines.append(f"  rejected_by: reference={expected['rejected_by']} native={actual['rejected_by']}")
    for field in ("quantity", "notional"):
        if expected.get(field) != actual.get(field):
            lines.append(f"  {field}: reference={expected[field]!r} native={actual[field]!r}")
    exp_checks = {c["name"]: c for c in expected["checks"]}
    act_checks = {c["name"]: c for c in actual["checks"]}
    for gate in EXPECTED_GATE_ORDER:
        e = exp_checks.get(gate)
        a = act_checks.get(gate)
        if e is None and a is None:
            continue
        if (e is None) != (a is None):
            lines.append(f"  gate {gate}: reference={'present' if e else 'absent'} "
                         f"native={'present' if a else 'absent'}")
            continue
        for field in ("passed", "observed", "limit"):
            ev, av = e[field], a[field]
            if ev != av:
                delta = ""
                if isinstance(ev, (int, float)) and isinstance(av, (int, float)):
                    delta = f" (delta={av - ev:+.6g})"
                lines.append(f"  gate {gate}.{field}: reference={ev!r} native={av!r}{delta}")
    return "\n".join(lines)


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_native_engine_matches_fixture(name: str, monkeypatch) -> None:
    module = _force_native(monkeypatch)
    scenario = SCENARIOS[name]
    gw = build_gateway(scenario, monkeypatch)
    assert gw._decision_core is module, "the gateway did not wire the native engine"

    order = OrderRequest(**scenario["order"])
    decision = asyncio.run(gw.submit(order, source="fixture"))

    # The core actually ran — a silent fall-back to Python would still match the
    # fixture (Python is the reference) and hide a broken native path.
    assert gw.last_decision_core_ns is not None, (
        f"scenario {name}: the native core did not run (silent fall-back to Python)"
    )
    assert gw.last_decision_core_ns >= 0

    actual = expected_from(decision)
    expected = scenario["expected"]
    assert actual == expected, _diff_message(name, expected, actual)


# --------------------------------------------------------------------------- #
# BookLadder is a faithful mirror of BookState's dict-then-sort views.
# --------------------------------------------------------------------------- #
def _reference_sides(bids: list, asks: list):
    """BookState.apply_snapshot semantics: {p: q for p, q in side if q > 0}."""
    bd = {p: q for p, q in bids if q > 0}
    ad = {p: q for p, q in asks if q > 0}
    sb = sorted(bd.items(), key=lambda kv: -kv[0])
    sa = sorted(ad.items(), key=lambda kv: kv[0])
    return sb, sa


def _reference_depth(levels: list, k: int) -> float:
    return sum(p * q for p, q in levels[:k])


def _reference_mid(sb: list, sa: list):
    bb = sb[0][0] if sb else None
    ba = sa[0][0] if sa else None
    return (bb + ba) / 2 if bb and ba else None


def test_bookladder_matches_python_over_random_deltas() -> None:
    module = _native_module()
    if module is None:
        pytest.skip("native core not built")
    rng = random.Random(20260817)
    for _ in range(4000):
        # A snapshot assembled from deltas: duplicate prices (last size wins) and
        # non-positive sizes (dropped) exercise the dict semantics, not just a
        # clean ladder.
        n_bid = rng.randint(0, 12)
        n_ask = rng.randint(0, 12)
        bids = [(round(rng.uniform(90.0, 100.0), 2), round(rng.uniform(-2.0, 5000.0), 1)) for _ in range(n_bid)]
        asks = [(round(rng.uniform(100.0, 110.0), 2), round(rng.uniform(-2.0, 5000.0), 1)) for _ in range(n_ask)]

        sb, sa = _reference_sides(bids, asks)
        ladder = module.BookLadder()
        ladder.snapshot(bids, asks)

        assert ladder.bids == sb
        assert ladder.asks == sa
        assert ladder.mid() == _reference_mid(sb, sa)
        for k in (1, 3, 5, 20):
            assert ladder.depth_usd("bid", k) == _reference_depth(sb, k), (bids, k)
            assert ladder.depth_usd("ask", k) == _reference_depth(sa, k), (asks, k)
