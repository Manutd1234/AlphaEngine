"""The running gateway still decides what the committed fixture recorded.

`tools/make_gate_fixture.py` recorded the Python reference's verdict for twenty
scenarios. This asserts the live `RiskGateway.submit` reproduces each one
exactly — the same accept/reject, the same gate order, the same observed and
limit numbers. When a native decision core lands, `test_decision_core_native.py`
asserts the SAME fixture; a divergence in either is a real parity break, not a
test to loosen.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.gate_fixture import GATE_ORDER, expected_from, judge

FIXTURE = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "gate-parity.json"
DATA = json.loads(FIXTURE.read_text())
SCENARIOS = DATA["scenarios"]


def test_the_fixture_is_present_and_shaped() -> None:
    assert DATA["version"] == 1
    assert len(SCENARIOS) == 20
    for name, scenario in SCENARIOS.items():
        expected = scenario["expected"]
        names = [c["name"] for c in expected["checks"]]
        # Every recorded check is a real gate, in submit() order.
        assert set(names) <= set(GATE_ORDER), f"{name} names a gate that does not exist"
        ranks = [GATE_ORDER.index(n) for n in names]
        assert ranks == sorted(ranks), f"{name} checks are out of gate order"
        assert expected["accepted"] == (not expected["rejected_by"])


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_python_engine_matches_fixture(name: str, monkeypatch) -> None:
    scenario = SCENARIOS[name]
    decision = judge(scenario, monkeypatch)
    assert expected_from(decision) == scenario["expected"], (
        f"scenario {name}: the live decision no longer matches the committed reference"
    )
