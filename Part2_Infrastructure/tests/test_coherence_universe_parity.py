"""The gateway still builds the universe the desk was written against.

The browser cannot call this code and this code cannot call the browser, so the
only thing holding the two to one answer is a committed payload they both read.
``tools/make_coherence_fixture.py`` records it from real captures; this asserts
the live shaping still reproduces it, and
``web/tests/coherence-universe-parity.test.ts`` asserts the desk still reads it.

A failure here is a wire change. Regenerate deliberately — and expect the
TypeScript half to fail in the same run if the change dropped something the
desk reads.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from make_coherence_fixture import OUT, build  # noqa: E402


@pytest.fixture(scope="module")
def committed() -> dict:
    if not OUT.exists():
        pytest.fail(f"missing {OUT}; run tools/make_coherence_fixture.py")
    return json.loads(OUT.read_text(encoding="utf-8"))


def test_the_live_shaping_reproduces_the_committed_fixture(committed):
    assert build() == committed, (
        "the gateway no longer builds the payload the desk was written against. "
        "If the change is deliberate, run tools/make_coherence_fixture.py and "
        "check web/tests/coherence-universe-parity.test.ts in the same commit"
    )


def test_the_corpus_still_covers_what_it_was_chosen_for(committed):
    """Guards the fixture's usefulness, not the code.

    A re-capture that quietly lost the incoherent basket or the never-traded
    ladder would leave every assertion below still passing over a corpus that
    no longer exercises the branches they were written for.
    """
    events = committed["universe"]["events"]
    assert len(events) == 3

    exclusive = [event for event in events if event["mutually_exclusive"]]
    assert len(exclusive) == 1, "the only family carrying the venue's own flag has gone"
    # $1.06 to buy a dollar. The basket branch is only interesting when it is
    # priced, and this is the one family in the corpus that is.
    assert exclusive[0]["yes_ask_total"] == "1.0600"

    # Two families with no basket total, which is the live desk's own shape and
    # the branch the composition ring's two refusal slices are drawn from.
    assert sum(1 for event in events if event["yes_ask_total"] is None) == 2


def test_the_one_captured_category_is_recorded_whole(committed):
    """The bug this assertion exists for shipped once already.

    The category is nested under ``series`` in the capture, and the generator
    first read it off the top level and defaulted to "". An empty string is
    falsy on the desk, so it renders as "uncategorised" — a capture that HAS
    the category became indistinguishable from one that does not, and the one
    labelled slice this corpus exists to fill was silently empty.
    """
    categories = committed["universe"]["categories"]
    assert categories == {"KXHIGHNY": "Climate and Weather"}, (
        "the recorded category is gone or empty; the labelled slice is untested"
    )


def test_a_measured_zero_and_a_real_figure_both_survive_the_round_trip(committed):
    """The corpus carries both, and they must not have converged."""
    totals = {event["event_ticker"]: event["open_interest_total"] for event in committed["universe"]["events"]}
    assert "0.00" in totals.values(), "the never-traded ladder has gone; the zero path is untested"
    assert any(value not in (None, "0.00") for value in totals.values()), "no family carries real size"


def test_the_size_fields_disagree_with_each_other_and_are_not_reconciled(committed):
    """The trap that makes deriving one figure from another wrong.

    The Fed family reports zero resting liquidity on markets that have traded
    1,687 contracts and hold 164 in open interest. Any surface that computed
    one of those from another would print a number the exchange never sent.
    """
    fed = next(e for e in committed["universe"]["events"] if e["mutually_exclusive"])
    leg = fed["markets"][0]
    assert leg["liquidity"] == "0.0000"
    assert leg["volume"] != "0.00"
    assert leg["open_interest"] != "0.00"


def test_every_leg_carries_all_four_fields_or_says_it_does_not(committed):
    for event in committed["universe"]["events"]:
        for market in event["markets"]:
            for field in ("open_interest", "liquidity", "volume", "notional_value"):
                assert field in market, f"{market['ticker']} lost {field} on the way to the wire"
                assert market[field] is None or isinstance(market[field], str), (
                    f"{market['ticker']}.{field} crossed as {type(market[field]).__name__}; "
                    "JSON's one numeric type is binary64 and would round it"
                )
