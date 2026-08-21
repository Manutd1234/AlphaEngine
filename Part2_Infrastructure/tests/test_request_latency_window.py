"""The request-latency window, tested as an object rather than as a global.

Every assertion here was unreachable while the window was two module-level
dicts: a test could only clear the process-wide state and hope nothing else in
the run cared. The tell was ``reset_request_latency``, whose docstring said it
existed "for tests to isolate assertions" — a reset verb that exists only
because state is global is a class that has not been written yet.

The identity assertions are load-bearing in the other direction:
``modules/metrics/__init__`` re-exports ``_latency`` and ``_errors`` BY OBJECT,
because hoisting their values would freeze them and because the facade cannot
import more eagerly without recreating the ``telegram -> metrics -> telegram``
cycle that stops the gateway booting. A ``reset`` that reassigned rather than
cleared would detach every reader going through the facade, silently.
"""

from __future__ import annotations

from modules.metrics import request_latency as rl


def test_two_windows_do_not_see_each_other():
    a = rl.RequestLatencyWindow()
    b = rl.RequestLatencyWindow()
    a.observe("/orders", 12.0)
    assert "/orders" in a.summary()
    assert b.summary() == {}, "a window must not observe another window's traffic"


def test_a_window_is_isolated_from_the_process_wide_one():
    rl.reset_request_latency()
    rl.observe_request("/global", 4.0)
    own = rl.RequestLatencyWindow()
    own.observe("/mine", 9.0)
    assert list(own.summary()) == ["/mine"]
    assert list(rl.request_latency_summary()) == ["/global"]


def test_reset_clears_in_place_and_never_rebinds():
    # The facade holds these exact objects; rebinding detaches it.
    samples, errors = rl._default.samples, rl._default.errors
    rl.observe_request("/x", 1.0, error=True)
    rl.reset_request_latency()
    assert rl._default.samples is samples
    assert rl._default.errors is errors
    assert rl._latency is samples, "the facade re-export must still be the live dict"
    assert rl._errors is errors


def test_errors_are_counted_separately_from_timings():
    w = rl.RequestLatencyWindow()
    w.observe("/r", 5.0)
    w.observe("/r", 5.0, error=True)
    row = w.summary()["/r"]
    assert row["samples"] == 2, "a failed request is still a timing sample"
    assert row["errors"] == 1


def test_route_cardinality_is_bounded_and_aggregates_rather_than_drops():
    # /metrics is unauthenticated, so the route budget is attacker-controlled.
    w = rl.RequestLatencyWindow(max_routes=3)
    for i in range(10):
        w.observe(f"/scan/{i}", 1.0)
    summary = w.summary()
    assert len(summary) <= 4, "the route budget must bound the series count"
    assert rl.UNMATCHED_ROUTE in summary, "overflow aggregates; it does not vanish"
    total = sum(int(row["samples"]) for row in summary.values())
    assert total == 10, "no request may be lost, only its path"


def test_the_window_is_bounded_by_capacity():
    w = rl.RequestLatencyWindow(capacity=5)
    for _ in range(50):
        w.observe("/hot", 1.0)
    assert w.summary()["/hot"]["samples"] <= 5
