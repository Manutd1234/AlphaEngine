"""The pre-trade decision histograms: the whole decision, and the native core.

Split out of ``modules/metrics.py``. Kept as one file because ``_decision`` and
``_core`` are two instruments of one class and one reset: a test that isolates
the decision histogram must clear the core's samples in the same call, or the
self-measure count leaks across assertions.

``_core_self_test_samples`` is a module-level ``int`` rebound under ``global``.
It is deliberately NOT re-exported from ``modules.metrics`` — a name bound in
the package ``__init__`` would freeze at import time and report a stale count.
Read it through ``core_latency_summary()['self_test_samples']``.
"""

from __future__ import annotations

import math
from bisect import bisect_left

# --------------------------------------------------------------------------- #
# Pre-trade decision latency
#
# Separate from the request window above, and the separation is the point. That
# one answers "is the HTTP tier healthy" over a 200-sample ring in milliseconds.
# This one measures the desk's own risk decision — `RiskGateway.submit`, the
# only part of this system that operates in microseconds — and it is judged on
# its TAIL, not its middle. A 200-sample ring cannot express p99.9 at all: the
# 99.9th percentile of 200 samples is just the maximum wearing a decimal point.
#
# So this is a log-linear histogram over the whole run, in the shape a latency
# desk actually keeps one:
#
#   * every sample counted, never a sliding window — an outlier at 03:00 still
#     shows at 09:00, because "we had a 4ms decision last night" is exactly the
#     fact a window is designed to forget;
#   * bounded memory regardless of volume, because it stores counts per bucket
#     rather than samples;
#   * no allocation on the record path. `bisect_left` over a preallocated list
#     of edges allocates nothing, and the counter increment reuses CPython's
#     small-int cache. A recorder that allocates is measuring its own garbage.
#
# ~12% bucket resolution (8 linear sub-buckets per power of two, 1us..~1s).
# Deliberately coarse: reporting p99.9 to four significant figures from a
# process that shares a core with two venue feed handlers would be inventing
# precision the measurement does not have.
# --------------------------------------------------------------------------- #

class _LogLinearHistogram:
    """Counts per log-linear bucket, every sample for the life of the process.

    One class, two instruments: the whole-decision histogram in microseconds
    (``_decision``) and the native core's own timing in nanoseconds
    (``_core``). Same edges shape, same nearest-rank quantiles clamped to the
    observed maximum, so the two never disagree about what a p99 means.
    """

    __slots__ = ("unit", "edges", "counts", "total", "max_value")

    def __init__(self, unit: str, powers: int) -> None:
        self.unit = unit
        edges: list[float] = []
        for power in range(powers):  # 2^0 .. 2^(powers-1) units, 8 sub-buckets each
            base = float(1 << power)
            step = base / 8.0
            for sub in range(8):
                edges.append(base + step * sub)
        #: Upper bound of each bucket. Ascending, so `bisect_left` finds the
        #: bucket in O(log n) without touching the heap.
        self.edges = edges
        self.counts: list[int] = [0] * (len(edges) + 1)
        self.total = 0
        self.max_value = 0.0

    def observe(self, value: float) -> None:
        """Record one sample. Called on the order path; must stay cheap."""
        if value < 0 or value != value:  # NaN never compares equal
            return
        self.counts[bisect_left(self.edges, value)] += 1
        self.total += 1
        if value > self.max_value:
            self.max_value = value

    def reset(self) -> None:
        for index in range(len(self.counts)):
            self.counts[index] = 0
        self.total = 0
        self.max_value = 0.0

    def quantile(self, target_rank: int) -> float:
        seen = 0
        for index, count in enumerate(self.counts):
            seen += count
            if seen >= target_rank:
                # The bucket's upper edge, rounded up rather than interpolated
                # between two buckets that may have had no samples between them.
                #
                # Clamped to the observed maximum, which is not cosmetic: the
                # edge overestimates by up to the bucket width, so an unclamped
                # p99.99 reported 1152us against a real maximum of 1125us. A
                # quantile above the slowest decision ever recorded is not a
                # rounding artefact to explain in a footnote, it is a number
                # that cannot be true.
                if index >= len(self.edges):
                    return self.max_value
                return min(self.edges[index], self.max_value)
        return self.max_value

    def summary(self) -> dict[str, float]:
        """p50/p99/p99.9/p99.99/max in this histogram's unit, plus the count.

        Quantiles are nearest-rank over bucket upper bounds, matching
        ``_quantile`` above rather than introducing a second convention.
        """
        if self.total == 0:
            return {"samples": 0, "p50": 0.0, "p99": 0.0, "p999": 0.0, "p9999": 0.0, "max": 0.0}
        return {
            "samples": self.total,
            "p50": self.quantile(math.ceil(0.50 * self.total)),
            "p99": self.quantile(math.ceil(0.99 * self.total)),
            "p999": self.quantile(math.ceil(0.999 * self.total)),
            "p9999": self.quantile(math.ceil(0.9999 * self.total)),
            "max": self.max_value,
        }

    def buckets(self) -> list[tuple[float, int]]:
        """(upper edge, count) per bucket, the last edge being +inf."""
        out = list(zip(self.edges, self.counts[:-1], strict=True))
        out.append((math.inf, self.counts[-1]))
        return out


#: The whole ``RiskGateway.submit`` under its lock, in microseconds:
#: 2^0 = 1us .. 2^20 ≈ 1.05s.
_decision = _LogLinearHistogram("us", 21)
#: The native core's own clock around the arithmetic, in nanoseconds:
#: 2^0 = 1ns .. 2^24 ≈ 16.8ms. Empty while the Python engine runs.
_core = _LogLinearHistogram("ns", 25)
#: How many of ``_core``'s samples came from the startup self-measure — the
#: same compiled battery, timed by the same clock, on a synthetic two-venue
#: book rather than a submitted order (``RiskGateway.run_core_self_measure``).
#: Published beside the count so a reader can tell "the core has been timed"
#: from "the core has been timed on real orders". The decision histogram
#: (``_decision``) never receives a synthetic sample.
_core_self_test_samples = 0

# The pre-class names, kept for the callers (and one memory-stability test)
# that read them: the list objects are the histogram's own, not copies.
_DECISION_EDGES = _decision.edges
_decision_counts = _decision.counts


def observe_decision_latency(microseconds: float) -> None:
    """Record one pre-trade decision. Called on the order path; must stay cheap."""
    _decision.observe(microseconds)


def observe_core_latency(nanoseconds: float) -> None:
    """Record the native core's timing of one decision (its own clock)."""
    _core.observe(nanoseconds)


def observe_core_self_test_latency(nanoseconds: float) -> None:
    """Record one startup self-measure sample of the native core.

    The same histogram ``observe_core_latency`` feeds — it *is* the compiled
    battery under its own clock — but counted separately, so the summary can
    say how many of the core's samples were synthetic. Never called on the
    order path.
    """
    global _core_self_test_samples
    before = _core.total
    observe_core_latency(nanoseconds)
    if _core.total != before:  # the histogram accepted it (not NaN, not negative)
        _core_self_test_samples += 1


def reset_decision_latency() -> None:
    """Drop every recorded decision (used by tests to isolate assertions)."""
    global _core_self_test_samples
    _decision.reset()
    _core.reset()
    _core_self_test_samples = 0


def decision_latency_summary() -> dict[str, float]:
    """p50/p99/p99.9/p99.99/max in microseconds, plus the sample count."""
    return _decision.summary()


def core_latency_summary() -> dict[str, float]:
    """p50/p99/p99.9/p99.99/max in nanoseconds for the native core, plus counts.

    ``samples`` is every sample; ``self_test_samples`` is how many of those the
    startup self-measure contributed (see ``observe_core_self_test_latency``).
    """
    summary = _core.summary()
    summary["self_test_samples"] = _core_self_test_samples
    return summary


def decision_latency_buckets() -> list[tuple[float, int]]:
    """(upper edge in µs, count) per bucket — for a CDF, not a summary."""
    return _decision.buckets()
