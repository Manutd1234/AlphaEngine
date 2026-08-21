"""The pre-trade decision instrument, built by the test rather than borrowed.

``_LogLinearHistogram`` was already a class. The third piece of the instrument
was not: ``_core_self_test_samples`` was a loose module ``int``, incremented
under ``global`` by one module function and zeroed under ``global`` by another —
an accidental singleton wrapped around two proper objects, which is the harder
version to notice.

The tell was ``reset_decision_latency``, whose docstring said it was "used by
tests to isolate assertions". Every test in ``tests/test_decision_latency.py``
opens by clearing the whole process's measurements, because there was no other
way for two of them to run in one interpreter — and a test that forgets inherits
whatever the startup self-measure and the rest of the suite left behind. That
file still exercises the module-level API and still passes unchanged; what is
new here is that none of these tests touch the process's numbers at all.

The identity assertions at the end run the other way. ``modules/metrics/__init__``
re-exports ``_decision``, ``_core``, ``_decision_counts`` and ``_DECISION_EDGES``
BY OBJECT, because the facade cannot import more eagerly without recreating the
``telegram -> metrics -> telegram`` cycle that stops the gateway booting. A reset
that allocated fresh histograms — or a fresh counts list — would detach every
reader through the facade silently, with ``/metrics`` still returning 200 and
reporting a histogram nothing writes to any more.
"""

from __future__ import annotations

from modules.metrics import decision_latency as dl
from modules.metrics.decision_latency import DecisionLatency


class TestOneInstrumentPerTest:
    def test_a_fresh_instrument_has_measured_nothing(self):
        """No `reset_*` call, and no dependence on what ran before."""
        instrument = DecisionLatency()
        assert instrument.decision_summary()["samples"] == 0
        assert instrument.core_summary()["samples"] == 0
        assert instrument.core_summary()["self_test_samples"] == 0

    def test_two_instruments_do_not_see_each_others_samples(self):
        first, second = DecisionLatency(), DecisionLatency()
        first.observe_decision(120.0)
        first.observe_core(4_000.0)
        assert second.decision_summary()["samples"] == 0
        assert second.core_summary()["samples"] == 0

    def test_an_instrument_leaves_the_process_wide_one_alone(self):
        before = dl.decision_latency_summary()["samples"]
        DecisionLatency().observe_decision(999.0)
        assert dl.decision_latency_summary()["samples"] == before, (
            "a test building its own instrument must not move the gateway's numbers"
        )


class TestTheSelfMeasureCount:
    def test_a_self_measure_sample_lands_in_the_core_and_is_counted_apart(self):
        instrument = DecisionLatency()
        instrument.observe_core(3_000.0)
        instrument.observe_core_self_test(3_000.0)
        core = instrument.core_summary()
        assert core["samples"] == 2, "the self-measure IS the compiled battery"
        assert core["self_test_samples"] == 1, (
            "but a reader must be able to tell 'timed' from 'timed on real orders'"
        )

    def test_the_decision_histogram_never_receives_a_synthetic_sample(self):
        instrument = DecisionLatency()
        instrument.observe_core_self_test(3_000.0)
        assert instrument.decision_summary()["samples"] == 0

    def test_a_rejected_sample_is_not_counted_as_synthetic(self):
        """The count and the histogram must not be able to disagree.

        A negative or NaN reading is dropped by the histogram, so counting it
        here would report a synthetic sample the histogram does not hold —
        exactly the arithmetic that makes `self_test_samples` untrustworthy.
        """
        instrument = DecisionLatency()
        instrument.observe_core_self_test(-1.0)
        instrument.observe_core_self_test(float("nan"))
        assert instrument.core_summary()["samples"] == 0
        assert instrument.core_summary()["self_test_samples"] == 0

    def test_reset_clears_the_count_with_the_histogram_it_counts_into(self):
        instrument = DecisionLatency()
        instrument.observe_core_self_test(3_000.0)
        instrument.reset()
        core = instrument.core_summary()
        assert (core["samples"], core["self_test_samples"]) == (0, 0), (
            "a count kept past the histogram it belongs to is a count of nothing"
        )


class TestResetHoldsIdentity:
    def test_reset_keeps_the_same_histogram_objects(self):
        instrument = DecisionLatency()
        decision, core = instrument.decision, instrument.core
        instrument.observe_decision(50.0)
        instrument.reset()
        assert instrument.decision is decision, "reset must clear, not reassign"
        assert instrument.core is core

    def test_reset_keeps_the_same_counts_list(self):
        """The facade holds this exact list; allocating a new one detaches it."""
        instrument = DecisionLatency()
        counts = instrument.decision.counts
        instrument.observe_decision(50.0)
        instrument.reset()
        assert instrument.decision.counts is counts
        assert sum(counts) == 0

    def test_the_process_wide_reset_holds_the_same_identities(self):
        decision, core = dl._decision, dl._core
        counts, edges = dl._decision_counts, dl._DECISION_EDGES
        dl.reset_decision_latency()
        assert dl._default.decision is decision
        assert dl._default.core is core
        assert dl._default.decision.counts is counts
        assert dl._default.decision.edges is edges


def test_the_module_level_names_are_the_process_instruments_own():
    # `modules/metrics/__init__` re-exports these by object. If they ever stop
    # being the same objects, every reader through the facade goes stale in
    # silence — with the scrape still returning 200.
    assert dl._decision is dl._default.decision
    assert dl._core is dl._default.core
    assert dl._decision_counts is dl._default.decision.counts
    assert dl._DECISION_EDGES is dl._default.decision.edges


def test_the_facade_re_exports_the_same_objects_the_instrument_writes():
    from modules import metrics

    assert metrics._decision is dl._default.decision
    assert metrics._core is dl._default.core
    assert metrics._decision_counts is dl._default.decision.counts
