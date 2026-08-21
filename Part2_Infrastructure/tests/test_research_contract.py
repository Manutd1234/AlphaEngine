"""The scheduler and the sweep, pinned to each other with no stand-in between.

Two modules were written in parallel — ``research_schedule`` (when a sweep runs)
and ``research_reconcile`` (what a sweep does) — and they did not meet. The
scheduler resolved an entry point by NAME from a tuple of candidates and called
it with keyword arguments filtered against the callee's signature; the sweep
exported different names and took a positional params dict. Resolution failed,
the reconciliation never ran, and **the full suite stayed green** — because
``tests/test_research_schedule.py`` monkeypatches ``modules.research_reconcile``
with a stand-in whose members the test itself chooses.

That is the defect this file exists for, and it is worth naming precisely: not
that the modules disagreed, but that BOTH sides tested against a fiction of the
other. Each suite proved its own half in isolation and neither proved the seam.
A mocked collaborator cannot fail a contract.

So nothing here substitutes anything. Every assertion imports both real modules
and asks whether the real one satisfies the real other. That is the only kind of
test that could have caught it, and the only kind that will catch it coming back.
"""

from __future__ import annotations

import inspect

import pytest

from modules import research_reconcile, research_schedule


class TestTheSchedulerCanReachTheSweep:
    def test_every_scheduled_scope_resolves_to_a_real_callable(self):
        """No scope may be scheduled that cannot be reached.

        ``DEFAULT_RECONCILE_SCHEDULES`` is what actually gets registered, so a
        scope named there and unreachable is a job that fails on a cadence for
        ever — a schedule that reports a problem it created.
        """
        for expression in research_schedule.DEFAULT_RECONCILE_SCHEDULES:
            scope = expression.split(":", 1)[1].split("@", 1)[0]
            fn, name = research_schedule._resolve(scope)
            assert callable(fn), f"scope {scope!r} resolved to something uncallable"
            assert getattr(research_reconcile, name, None) is fn, (
                f"{scope!r} resolved to {name!r}, which is not that attribute of the real module"
            )

    def test_the_resolved_entry_point_accepts_what_the_scheduler_offers(self):
        """The second layer of the original break.

        Renaming alone would not have fixed it: ``_invoke`` filters the offered
        keywords to those the callee declares and then calls with keywords only.
        An entry point taking a positional argument raises ``TypeError`` no
        matter how well its name resolves.
        """
        offered = {"desk_id", "limit", "now_ms", "job_id"}
        for expression in research_schedule.DEFAULT_RECONCILE_SCHEDULES:
            scope = expression.split(":", 1)[1].split("@", 1)[0]
            fn, name = research_schedule._resolve(scope)
            params = inspect.signature(fn).parameters

            required_positional = [
                p.name for p in params.values()
                if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
                and p.default is inspect.Parameter.empty
            ]
            assert not required_positional, (
                f"{name} requires positional {required_positional}; the scheduler calls "
                "with keywords only, so this entry point can never be invoked"
            )

            unsatisfied = [
                p.name for p in params.values()
                if p.default is inspect.Parameter.empty
                and p.kind is p.KEYWORD_ONLY
                and p.name not in offered
            ]
            assert not unsatisfied, (
                f"{name} requires {unsatisfied}, which the scheduler does not offer "
                f"(it offers {sorted(offered)})"
            )

    def test_a_scope_that_is_declared_but_unimplemented_is_not_scheduled(self):
        """`chart_docs` is the live example.

        It stays in ``ENTRYPOINTS`` so an implementation is one line away, and it
        is deliberately absent from the schedules so nothing fires against it.
        Declaring a scope is a plan; scheduling one is a promise.
        """
        scheduled = {
            e.split(":", 1)[1].split("@", 1)[0]
            for e in research_schedule.DEFAULT_RECONCILE_SCHEDULES
        }
        for scope in research_schedule.ENTRYPOINTS:
            if scope in scheduled:
                continue
            with pytest.raises(research_schedule.ReconcileUnavailable):
                research_schedule._resolve(scope)


class TestTheSweepAnswersRatherThanVanishing:
    def test_an_unreachable_corpus_is_reported_not_counted_as_clean(self):
        """"Could not sweep" and "nothing to sweep" are different facts.

        The whole hazard of a reconciliation loop is that it reports success
        while doing nothing, so the no-client path must say so in the report
        rather than returning an empty, contented result.
        """
        report = research_reconcile.run_reconcile({"desk_id": "desk", "max_documents": 5}, now_ms=0.0)
        assert isinstance(report, dict)
        # The sweep carries the distinction in a field rather than in prose, which
        # is the stronger form: a caller can branch on it.
        assert report.get("reachable") is False, (
            f"a sweep with no corpus returned {report!r}, which does not distinguish "
            "'could not sweep' from 'nothing needed sweeping'"
        )
        assert report.get("documents_swept") == 0

    def test_the_adapter_and_the_job_body_agree(self):
        """`reconcile_graph` is a thin adapter and must stay one."""
        out = research_reconcile.reconcile_graph(desk_id="desk", limit=3, now_ms=0.0)
        direct = research_reconcile.run_reconcile({"desk_id": "desk", "max_documents": 3}, now_ms=0.0)
        assert set(out) == set(direct), (
            "the adapter's report shape drifted from run_reconcile's; the scheduler and a "
            "direct caller would then see different keys for the same sweep"
        )
