"""``execution_summary``, emitted live: a session closes and the desk files it.

``modules/research_ingest_session.py`` builds the document and
``tools/backfill_research_rag.py`` calls it — which meant that on a RUNNING desk
the summaries existed only for as long as somebody remembered to run the
backfill. The kind was declared in the Postgres enum, in the API ``Literal`` and
in ``research_graph``'s ``promoted_to`` rule, and then produced by a tool. This
module is the in-process caller: the risk monitor's UTC rollover hands it the
session it has just closed, and the document leaves through the SAME bounded
queue every other kind uses. There is no second write path here — everything
below ends in ``ResearchRag._submit``.

**WHY THIS IS NOT A METHOD ON ``writer.py``.** Only the 400-line ceiling.
``writer.py`` measures 382 lines and the argument that follows does not fit in
the eighteen that are left, and shortening the argument to fit is how the next
reader "simplifies" the deferral below back into a blocking call. ``ResearchRag``
is still ONE class: this is a mixin on it, exactly as ``retrieval._RetrievalMixin``
is the read half.

**WHY THE WORK IS DEFERRED RATHER THAN DONE AT THE BOUNDARY.**
``_roll_session_if_needed`` is not only the monitor loop's first step. It is also
called from ``submit`` and from ``sweep_working_orders`` with the gateway's lock
HELD — inside the region ``submit`` times to produce the ``latency_ms`` it
records on the order. ``session_figures`` runs four aggregate queries over a
whole UTC day of the ``orders`` table, so doing it at the call site would put a
table scan inside the trading lock and charge it to whichever order happened to
be the first of a new session. ``on_session_closed`` therefore returns after a
boolean and a ``create_task``, and the reading happens later on a worker thread.
Off the loop rather than merely off the lock because a scan that blocks the event
loop still stalls the breaker, the venue feeds and every open request;
``AuditStore`` documents itself thread-safe and holds a ``threading.Lock`` around
every statement, and ``risk_proxy/deferred_audit.py`` already writes audit rows
from ``asyncio.to_thread`` for exactly this reason.

**WHY THERE IS A SETTLE DELAY, AND WHY IT IS NOT PARANOIA.**
``research_documents`` carries ``unique (desk_id, kind, source_ref)`` and
``research_ingest_delivery.deliver`` posts with
``Prefer: resolution=ignore-duplicates``. For one session the FIRST writer wins
and a later, more complete backfill of ``session:<date>`` is silently ignored —
so an early summary is a PERMANENT one. That is the single failure worth
spending seconds to avoid: rows produced under the lock are appended to
``_deferred_audit`` and written by ``asyncio.to_thread`` only after the lock is
released, so an order that filled in the last instants of a session can still be
in the thread pool when the boundary is crossed. Waiting lets it land.

The rejected alternative was to poll ``gateway._deferred_audit`` and emit once it
is empty. It is empty in precisely the case that matters: ``_drain_deferred_audit``
pops the whole list into a local before its first ``await``, so the list reads
empty while the INSERTs are still in flight. A check that is wrong exactly when
it is load-bearing is worse than a wait that is honest about being one.

A wrong summary is worse than a late one, and the ceiling on "late" here is the
next boundary — a session closed at 00:00:00 and filed at 00:00:05 sorts, ranks
and reads identically.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any

from modules.research_ingest_session import (
    ClosedSession,
    execution_summary_document,
    session_figures,
)

log = logging.getLogger("alphaengine.rag")

#: Seconds between a UTC session boundary and the summary of the session it
#: closed.
#:
#: Read from the environment HERE rather than added to ``config.py``: that file
#: is at its recorded length in ``tests/test_file_size.py`` and one more field
#: would push a documented un-splittable file further over the ceiling. The
#: settings dataclass is the right home for this the day someone splits it.
#:
#: Five seconds is measured against the thing it waits for, not chosen for a
#: round number. What it waits for is one queued ``INSERT`` dispatched to the
#: default executor — sub-millisecond against DuckDB on a local file, and the
#: whole ``_deferred_audit`` batch of a single sweep is a handful of them. Five
#: seconds is three orders of magnitude of headroom over that, and invisible
#: against a document that summarises a day of trading. Set
#: ``RESEARCH_SESSION_SETTLE_S=0`` to file on the next loop turn; a test that
#: wants the emission synchronously patches this module's constant.
SESSION_SUMMARY_SETTLE_S = float(os.environ.get("RESEARCH_SESSION_SETTLE_S", "5"))


class _SessionIngestMixin:
    """``on_session_closed`` — the live counterpart of the backfill's scan.

    The backfill asks the audit log which sessions it can see closed
    (``scan_closed_sessions``, pairing consecutive ``session_rollover`` rows).
    A running desk does not have to ask: it IS the thing that closes them, and
    it knows the date and the instant. So this path skips the scan entirely and
    goes straight to ``session_figures`` for the one session named — the same
    producer, reached with the one fact the tool had to infer.
    """

    def on_session_closed(
        self, audit: Any, session_date: str, closed_at: datetime
    ) -> None:
        """The desk crossed a UTC boundary; file the session it just closed.

        Shaped like ``on_ml_run_complete`` — guard, build, ``_submit`` — with one
        deliberate difference, and the difference is the caller. The backtest and
        ML hooks fire from a job's completion callback, where a few milliseconds
        of rendering are free. This one fires from a trading-state transition
        where they are not, so the build is SCHEDULED and this call returns.

        ``audit`` is passed in rather than reached for. The corpus does not own a
        handle on the audit log and must not open one: ``AuditStore`` refuses to
        be opened twice against the same ``DATA_DIR`` on purpose, and a second
        handle here would either take the DuckDB file lock away from the gateway
        or silently fall back to a SQLite twin holding a different history.

        Failures are logged, never raised. The rollover is a trading-state
        transition and the corpus is best-effort, exactly as the decision hook
        is.
        """
        if not self.enabled or audit is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No running loop — a roll driven synchronously from a tool or a
            # test. Nothing here needs to stay responsive, and dropping the
            # document because there was no loop to defer onto would make the
            # hook's behaviour depend on how it was called.
            self._file_session_summary(audit, session_date, closed_at)
            return
        task = loop.create_task(
            self._file_session_summary_later(audit, session_date, closed_at),
            name=f"research-session-{session_date}",
        )
        # Held for the life of the task. ``create_task`` keeps only a weak
        # reference, so a task nobody holds can be collected mid-``await`` and
        # the summary simply never appears — with no error, which is the failure
        # mode this whole package is written against. The other two hooks need
        # no such set because neither of them creates a task.
        self._session_tasks.add(task)
        task.add_done_callback(self._session_tasks.discard)

    async def _file_session_summary_later(
        self, audit: Any, session_date: str, closed_at: datetime
    ) -> None:
        """Wait out the settle, then read the figures off the event loop."""
        await asyncio.sleep(SESSION_SUMMARY_SETTLE_S)
        await asyncio.to_thread(
            self._file_session_summary, audit, session_date, closed_at
        )

    def _file_session_summary(
        self, audit: Any, session_date: str, closed_at: datetime
    ) -> None:
        """Read the session's figures and queue its document. Runs off the loop.

        Reading the closing session's window from a worker thread while the
        gateway keeps trading is safe because of what the window is: every audit
        table here is append-only and the window ends at the boundary, so the
        only rows the desk can still write are stamped on the far side of it.
        There is nothing for a concurrent write to change in the range being
        read — which is the property that makes the deferral above free rather
        than a trade of latency for accuracy.

        The guard is around the whole of it, and it swallows nothing quietly: a
        session whose figures could not be read is named in the log with the
        exception that stopped it, and the backfill can still file it because
        nothing was written.
        """
        try:
            summary = session_figures(
                audit,
                ClosedSession(session_date=session_date, closed_at=closed_at),
            )
            self._submit(execution_summary_document(summary))
        except Exception as exc:
            log.error(
                "execution summary for session %s was not filed (%s: %s); the "
                "rollover stands and the backfill can still write it",
                session_date, type(exc).__name__, exc,
            )
