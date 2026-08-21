"""The /metrics audit-count sampler, driven by a clock the test owns.

None of this was reachable while the cache was a module dict, a module float
and a ``global`` statement: exercising the expiry meant either waiting five
minutes or monkeypatching ``time.monotonic`` for every other test in the
process. So the branch deciding whether a Prometheus scrape hits the database
went untested, on the one path in ``render_metrics`` that is not already in
memory.

The identity assertions run the other way. ``modules/metrics/__init__``
re-exports ``_audit_counts`` BY OBJECT, so a sampler that reassigned its dict
instead of clearing it would detach every reader through the facade — silently,
with the scrape still returning 200 and reporting stale numbers forever.
"""

from __future__ import annotations

from modules.metrics import render as r


class FakeAudit:
    """An audit table that counts how often it was actually scanned."""

    def __init__(self, n: int | None = 7) -> None:
        self.calls = 0
        self.n = n

    def query(self, _sql: str):
        self.calls += 1
        return [{"n": self.n}]


def _at(t: float):
    """A clock stuck at ``t`` until the test moves it."""
    box = {"t": t}
    return box, (lambda: box["t"])


def test_the_first_scrape_scans_every_table():
    audit = FakeAudit()
    box, clock = _at(1_000.0)
    sampler = r.AuditRowCounts(interval_s=300.0, now=clock)
    counts = sampler.sample(audit)
    assert audit.calls == 4, "one scan per audit table"
    assert counts == {t: 7 for t in r._AUDIT_TABLES}


def test_a_second_scrape_inside_the_interval_scans_nothing():
    # A scrape arrives every 15s; a count is a full scan. Sampling is the whole
    # point of this class.
    audit = FakeAudit()
    box, clock = _at(1_000.0)
    sampler = r.AuditRowCounts(interval_s=300.0, now=clock)
    sampler.sample(audit)
    box["t"] = 1_299.0
    sampler.sample(audit)
    assert audit.calls == 4, "the cached sample must serve the whole interval"


def test_the_scan_resumes_once_the_interval_lapses():
    audit = FakeAudit()
    box, clock = _at(1_000.0)
    sampler = r.AuditRowCounts(interval_s=300.0, now=clock)
    sampler.sample(audit)
    box["t"] = 1_301.0
    sampler.sample(audit)
    assert audit.calls == 8, "past the interval the figures are re-counted"


def test_an_empty_cache_is_never_fresh():
    """A desk that has answered nothing must go and look.

    Otherwise the first scrape after a restart reports silence as though it
    were a measured zero — the coercion this codebase is most alert to.
    """
    _, clock = _at(5_000.0)
    sampler = r.AuditRowCounts(interval_s=300.0, now=clock)
    assert sampler.fresh(5_000.0) is False


def test_a_scan_that_returns_nothing_does_not_start_the_clock():
    # A query returning no usable rows is not evidence the tables are empty.
    # Treating it as a fresh sample would hold that silence for a full interval.
    audit = FakeAudit(n=None)
    box, clock = _at(1_000.0)
    sampler = r.AuditRowCounts(interval_s=300.0, now=clock)
    assert sampler.sample(audit) == {}
    assert sampler.counted_at == 0.0, "an empty result must not mark the cache fresh"
    box["t"] = 1_001.0
    sampler.sample(audit)
    assert audit.calls == 8, "it tries again immediately rather than waiting out the interval"


def test_two_samplers_do_not_share_state():
    a, b = FakeAudit(), FakeAudit()
    _, clock = _at(1_000.0)
    first = r.AuditRowCounts(interval_s=300.0, now=clock)
    second = r.AuditRowCounts(interval_s=300.0, now=clock)
    first.sample(a)
    assert second.counts == {}, "a sampler must not see another sampler's scan"
    assert b.calls == 0


def test_refreshing_clears_in_place_and_never_rebinds():
    """The facade holds this exact dict; rebinding detaches it."""
    audit = FakeAudit()
    box, clock = _at(1_000.0)
    sampler = r.AuditRowCounts(interval_s=300.0, now=clock)
    counts = sampler.counts
    sampler.sample(audit)
    box["t"] = 1_301.0
    sampler.sample(audit)
    assert sampler.counts is counts, "refresh must clear, not reassign"


def test_the_module_level_dict_is_the_process_samplers_own():
    # `modules/metrics/__init__` re-exports this by object. If these ever stop
    # being the same dict, every reader through the facade goes stale in silence.
    assert r._audit_counts is r._audit_sampler.counts
