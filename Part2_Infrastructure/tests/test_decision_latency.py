"""The pre-trade decision latency histogram.

Two things are being protected here, and only one of them is the arithmetic.

The first is that the histogram tells the truth about its *tail*. A latency
number that is only ever reported as a mean, or over a window short enough to
forget, is worse than no number: it reads as reassurance while hiding exactly
the events anyone measuring a trading path cares about.

The second is that recording stays cheap enough to leave on the order path. A
measurement that costs more than the thing it measures changes the answer.
"""

from __future__ import annotations

import random

from modules.metrics import (
    decision_latency_summary,
    observe_decision_latency,
    render_metrics,
    reset_decision_latency,
)


def test_empty_histogram_reports_no_samples_rather_than_zero_latency():
    reset_decision_latency()
    summary = decision_latency_summary()
    assert summary["samples"] == 0
    # Zeros with samples==0 is the honest shape: "nothing measured", not "every
    # decision took 0us". The renderer below is what keeps them apart.
    assert summary["p99"] == 0.0


def test_quantiles_are_monotone_and_never_exceed_the_observed_maximum():
    reset_decision_latency()
    random.seed(11)
    for _ in range(9_900):
        observe_decision_latency(random.gauss(50, 6))
    for _ in range(100):
        observe_decision_latency(random.gauss(900, 120))

    s = decision_latency_summary()
    assert s["samples"] == 10_000
    assert s["p50"] <= s["p99"] <= s["p999"] <= s["p9999"] <= s["max"]

    # The bucket upper bound overestimates by up to the bucket width, so without
    # clamping p99.99 came out above the slowest decision ever recorded — a
    # value that cannot be true of any real sample.
    assert s["p9999"] <= s["max"]


def test_the_slow_tail_survives_into_p999():
    """A 1% tail at 18x the median must not be averaged away."""
    reset_decision_latency()
    for _ in range(9_900):
        observe_decision_latency(50.0)
    for _ in range(100):
        observe_decision_latency(900.0)

    s = decision_latency_summary()
    assert s["p50"] < 100.0, "the median should still describe the common case"
    assert s["p999"] > 500.0, "the 1% tail is the whole reason this histogram exists"


def test_every_sample_counts_forever_rather_than_ageing_out():
    """No sliding window.

    The request-latency ring above deliberately forgets, because a cold-start
    outlier should not pin an HTTP alert for days. This one deliberately does
    not: 'we had a 4ms decision last night' is a fact about the trading path
    that must still be visible in the morning.
    """
    reset_decision_latency()
    observe_decision_latency(4_000.0)
    for _ in range(50_000):
        observe_decision_latency(45.0)

    s = decision_latency_summary()
    assert s["samples"] == 50_001
    assert s["max"] == 4_000.0


def test_bad_samples_are_ignored_without_corrupting_the_distribution():
    reset_decision_latency()
    observe_decision_latency(float("nan"))
    observe_decision_latency(-1.0)
    assert decision_latency_summary()["samples"] == 0

    observe_decision_latency(60.0)
    assert decision_latency_summary()["samples"] == 1


def test_recording_does_not_allocate_per_sample():
    """The record path holds counts, not samples.

    Bounded memory is what lets this stay on the order path with no window and
    no eviction. If it ever starts retaining per-sample state, memory grows with
    order volume and the histogram becomes a leak on the money path.
    """
    reset_decision_latency()
    import sys

    from modules import metrics

    before = sys.getsizeof(metrics._decision_counts)
    for value in range(20_000):
        observe_decision_latency(float(value % 900) + 1.0)
    after = sys.getsizeof(metrics._decision_counts)

    assert before == after, "the bucket array grew — something is storing samples"
    assert decision_latency_summary()["samples"] == 20_000


def test_metrics_render_reports_microseconds_and_omits_quantiles_when_unmeasured():
    reset_decision_latency()
    text = render_metrics()
    # The counter exists at zero so a dashboard has a series before the first
    # order, but quantiles of nothing are not published as zeros.
    assert "alphaengine_decision_samples_total 0" in text
    assert "alphaengine_decision_latency_us" not in text

    for _ in range(1_000):
        observe_decision_latency(55.0)
    text = render_metrics()
    assert 'alphaengine_decision_latency_us{quantile="0.999"}' in text
    assert "alphaengine_decision_latency_max_us" in text
