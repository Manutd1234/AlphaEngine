"""Bounded-read, event-loop and authoritative-writer metrics."""

from __future__ import annotations

from typing import Any


def render_runtime_metrics(out: Any) -> None:
    """Append runtime telemetry without creating an import cycle at module load."""
    from modules.audit import get_audit
    from modules.backend_runtime import get_backend_runtime
    from modules.single_writer import status as single_writer_status

    runtime = get_backend_runtime().status()
    out.metric("backend_read_ready", runtime["ready"], help="1 when bounded backend reads are ready.")
    out.metric("backend_read_workers", runtime["max_workers"], help="Owned synchronous read workers.")
    out.metric("backend_read_queue_depth", runtime["queue_depth"], help="Reads waiting for a worker.")
    out.metric("backend_read_running", runtime["running"], help="Synchronous reads currently running.")
    out.metric(
        "backend_read_saturated_total", runtime["saturated_total"],
        help="Reads refused because the worker queue was full.", type="counter",
    )
    out.metric(
        "backend_read_deadlines_total", runtime["deadline_total"],
        help="Backend waits ended by their propagated or local deadline.", type="counter",
    )
    out.metric(
        "backend_read_cancelled_total", runtime["cancelled_total"],
        help="Backend waits cancelled by their caller.", type="counter",
    )
    out.metric(
        "event_loop_lag_ms", runtime["event_loop_lag_p95_ms"],
        help="Recent p95 gateway event-loop scheduling lag in milliseconds.",
        labels=(("quantile", "0.95"),),
    )
    for operation, sample in runtime["operations"].items():
        labels = (("operation", operation),)
        out.metric(
            "backend_read_queue_wait_ms", sample["queue_p95_ms"],
            help="Recent p95 bounded-executor queue wait.", labels=labels,
        )
        out.metric(
            "backend_read_duration_ms", sample["duration_p95_ms"],
            help="Recent p95 synchronous operation duration.", labels=labels,
        )

    audit = get_audit().runtime_health()
    writer = single_writer_status()
    out.metric("audit_writable", audit["writable"], help="1 when the authoritative audit ledger accepts writes.")
    out.metric(
        "audit_write_failures_total", audit["write_failures"],
        help="Audit writes that failed in this process.", type="counter",
    )
    out.metric(
        "single_writer_enforced", writer["held"] and writer["enforced"],
        help="1 when this process owns the state directory through an enforced advisory lock.",
    )
