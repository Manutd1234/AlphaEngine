"""
Prometheus text exposition for the gateway.
===========================================

``/health`` answers "is the process alive and what is it doing right now" for a
human. This module answers the same question for a scraper: the identical state
accessors, rendered as a time series a Grafana panel or an alert rule can act
on.

It is written by hand against the 0.0.4 text exposition format rather than
pulling in ``prometheus_client``. The gateway's dependency floor is a feature —
``requirements-core.txt`` is what a reviewer installs to run the tests — and the
exporter is a formatting problem, not a runtime one: almost every number here
already exists in memory, so the scrape is O(number of feeds) with no lock and
nothing computed for the sake of the endpoint. The one exception is the audit
row counts, which are full table scans and are therefore sampled on a timer
rather than run per scrape.

Two conventions worth stating because they are easy to get wrong:

* Counters are exported at their process-lifetime value with a ``_total``
  suffix; Prometheus computes rates. Restarting the gateway resets them, which
  is the standard counter contract.
* A metric is emitted even when its value is zero (no positions, no jobs of a
  given status). A missing series and a zero series mean different things to an
  alert rule, and "the kill switch metric disappeared" must not read as "the
  kill switch is fine".

The module became a package. Nothing moved between instruments — the exposition
primitives are in ``exposition.py``, the two latency windows in
``request_latency.py`` and ``decision_latency.py``, and ``render_metrics`` in
``render.py``. Every name the old module exported is re-exported below, so
``from modules.metrics import X`` and ``from modules import metrics; metrics.X``
both still resolve.

Two things a reader porting a patch needs to know.

``render.py`` carries the ``# local: metrics imports first`` deferrals. They are
function-scope because ``modules/telegram/*``, ``modules/risk_proxy`` and
``modules/audit`` all reach this package, and this package reaches back into
them to read state. Hoisting one to module scope recreates
``telegram -> metrics -> telegram`` and the gateway fails to boot. Verify with
``venv/bin/python -c "import main"``.

The mutable module state below is re-exported by OBJECT, not by value. Lists and
dicts (``_decision_counts``, ``_latency``, ``_errors``) are the submodule's own
objects, so a reader through the facade sees live mutations. The two rebound
scalars — ``_core_self_test_samples`` in ``decision_latency`` and
``_audit_counted_at`` in ``render`` — are deliberately absent here: a name bound
at package-import time would freeze at its initial value and lie. Read them
through ``core_latency_summary()`` or the submodule.
"""

from __future__ import annotations

from modules.metrics.decision_latency import _DECISION_EDGES as _DECISION_EDGES  # noqa: F401
from modules.metrics.decision_latency import _core as _core  # noqa: F401
from modules.metrics.decision_latency import _decision as _decision  # noqa: F401
from modules.metrics.decision_latency import _decision_counts as _decision_counts  # noqa: F401
from modules.metrics.decision_latency import _LogLinearHistogram as _LogLinearHistogram  # noqa: F401
from modules.metrics.decision_latency import core_latency_summary as core_latency_summary  # noqa: F401
from modules.metrics.decision_latency import decision_latency_buckets as decision_latency_buckets  # noqa: F401
from modules.metrics.decision_latency import decision_latency_summary as decision_latency_summary  # noqa: F401
from modules.metrics.decision_latency import observe_core_latency as observe_core_latency  # noqa: F401
from modules.metrics.decision_latency import (  # noqa: F401
    observe_core_self_test_latency as observe_core_self_test_latency,
)
from modules.metrics.decision_latency import observe_decision_latency as observe_decision_latency  # noqa: F401
from modules.metrics.decision_latency import reset_decision_latency as reset_decision_latency  # noqa: F401
from modules.metrics.exposition import _JOB_STATES as _JOB_STATES  # noqa: F401
from modules.metrics.exposition import PREFIX as PREFIX  # noqa: F401
from modules.metrics.exposition import _escape_label as _escape_label  # noqa: F401
from modules.metrics.exposition import _labels as _labels  # noqa: F401
from modules.metrics.exposition import _num as _num  # noqa: F401
from modules.metrics.exposition import _Writer as _Writer  # noqa: F401
from modules.metrics.render import _AUDIT_COUNT_INTERVAL_S as _AUDIT_COUNT_INTERVAL_S  # noqa: F401
from modules.metrics.render import _audit_counts as _audit_counts  # noqa: F401
from modules.metrics.render import _audit_row_counts as _audit_row_counts  # noqa: F401
from modules.metrics.render import render_metrics as render_metrics  # noqa: F401
from modules.metrics.request_latency import _LATENCY_CAPACITY as _LATENCY_CAPACITY  # noqa: F401
from modules.metrics.request_latency import _MAX_ROUTES as _MAX_ROUTES  # noqa: F401
from modules.metrics.request_latency import (  # noqa: F401
    REQUEST_LATENCY_WINDOW_SECONDS as REQUEST_LATENCY_WINDOW_SECONDS,
)
from modules.metrics.request_latency import UNMATCHED_ROUTE as UNMATCHED_ROUTE  # noqa: F401
from modules.metrics.request_latency import RequestTimingMiddleware as RequestTimingMiddleware  # noqa: F401
from modules.metrics.request_latency import _errors as _errors  # noqa: F401
from modules.metrics.request_latency import _latency as _latency  # noqa: F401
from modules.metrics.request_latency import _quantile as _quantile  # noqa: F401
from modules.metrics.request_latency import observe_request as observe_request  # noqa: F401
from modules.metrics.request_latency import request_latency_summary as request_latency_summary  # noqa: F401
from modules.metrics.request_latency import reset_request_latency as reset_request_latency  # noqa: F401

__all__ = [
    "PREFIX",
    "REQUEST_LATENCY_WINDOW_SECONDS",
    "RequestTimingMiddleware",
    "UNMATCHED_ROUTE",
    "core_latency_summary",
    "decision_latency_buckets",
    "decision_latency_summary",
    "observe_core_latency",
    "observe_core_self_test_latency",
    "observe_decision_latency",
    "observe_request",
    "render_metrics",
    "request_latency_summary",
    "reset_decision_latency",
    "reset_request_latency",
]
