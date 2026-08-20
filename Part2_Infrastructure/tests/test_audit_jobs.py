"""The audit log's `jobs` table holds one row per job, not one per call.

`record_job` did a plain INSERT, and it is called at every transition — a job
that goes queued -> running -> succeeded wrote three rows. `/api/data/jobs`
then listed the same job three times at three different statuses, and which one
a reader saw first depended on scan order.

The audit log's EVENTS stay append-only; that is what it is for. A job row is
the exception because it is the current state of one thing rather than evidence
of a moment, which is the same reason `upsert_subscriber` deletes before it
inserts.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from modules.audit import AuditLog


@pytest.fixture
def log(tmp_path):
    audit = AuditLog(str(tmp_path / "audit.duckdb"))
    yield audit
    audit.close()


def _record(audit: AuditLog, status: str, *, job_id: str = "job-1", error=None) -> None:
    audit.record_job(
        job_id, "data.replay", status,
        datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        datetime(2026, 8, 20, 10, 5, tzinfo=timezone.utc) if status != "queued" else None,
        "in-process", error,
    )


def test_three_transitions_leave_one_row(log):
    for status in ("queued", "running", "succeeded"):
        _record(log, status)
    rows = [r for r in log.list_jobs(limit=50) if r["job_id"] == "job-1"]
    assert len(rows) == 1, f"{len(rows)} rows for one job: {[r['status'] for r in rows]}"


def test_the_surviving_row_is_the_latest_state(log):
    _record(log, "queued")
    _record(log, "running")
    _record(log, "failed", error="the venue refused")
    row = next(r for r in log.list_jobs(limit=50) if r["job_id"] == "job-1")
    assert row["status"] == "failed"
    assert row["error"] == "the venue refused", (
        "a failed job that cannot say why is the state this table exists to record"
    )


def test_two_jobs_are_two_rows(log):
    """The dedupe is per job_id, not a truncate."""
    _record(log, "succeeded", job_id="job-1")
    _record(log, "succeeded", job_id="job-2")
    ids = {r["job_id"] for r in log.list_jobs(limit=50)}
    assert {"job-1", "job-2"} <= ids


def test_the_index_that_makes_the_delete_cheap_exists():
    from modules.audit import _DDL

    joined = "\n".join(_DDL)
    assert "ix_jobs_job_id" in joined, (
        "record_job now deletes by job_id on every call; without the index that "
        "is a scan of the whole table per transition"
    )
