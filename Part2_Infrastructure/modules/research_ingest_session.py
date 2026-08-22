"""The ``execution_summary`` document: the desk's own trading session, indexed.

``execution_summary`` was declared three times over and written by nothing. It
is in the Postgres enum (migration 20260808120400), in the API's ``Literal``,
and in ``research_graph``'s ``promoted_to`` rule — the edge that links a sweep
to the session in which its strategy was actually traded — while the PRD,
ARCHITECTURE.md and the README all list session execution summaries as an
ingested source. A desk that read its own documentation and searched for one got
sweeps back, ranked, looking exactly like an answer. This module is the
producer, and ``tools/backfill_research_rag.py`` is its caller.

**NO NEW INSTRUMENTATION AND NO INVENTED NUMBERS.** Every figure comes from a
row the gateway already writes:

* ``ReadModels.session_costs`` — fills, filled notional, fees and the realised
  slippage cost in dollars, over the session's own UTC window, plus the count of
  fills whose slippage was never measured, which is what makes the cost leg a
  lower bound rather than a claim;
* ``equity_snapshots`` through ``equity_history(session_date=…)`` — the closing
  mark of the book, read as the newest snapshot inside the session;
* the ``orders`` table — the decision count, the accept/reject split, the
  decision-latency mean and tail, the strategies traded and the venue mix.

Nothing here derives a P&L the desk does not keep, and a figure the desk did not
record is rendered as "not recorded", never as zero. A session with no fills has
a slippage cost of zero; a session whose fills were never priced has an unknown
one, and an execution review that could not tell those apart would be worse than
having no card at all.

**WHICH SESSIONS ARE SUMMARISED.** Only closed ones, and closure is read from
the desk's own record of it rather than from a clock. Every ``session_rollover``
row in ``risk_events`` opens a session at a known instant, so consecutive
rollover rows bracket exactly one session: the row that opened it, and the row
that ended it. The newest session is therefore never summarised — it is still
running, and a summary of a session still being traded would be filed with a
close time it does not have. The desk being down for a week is handled by the
same rule for free: it is the rollover rows that pair up, not the calendar.

The card lives here rather than in ``research_cards.py`` because that file would
have crossed the 400-line ceiling to hold it, and because a card split from the
queries that feed it drifts from them. ``body`` is still the embedded text
verbatim: changing a line below re-indexes every summary ever written.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from modules.audit import _audit_timestamp

log = logging.getLogger("alphaengine.rag")

#: The kind this module produces. Named once so the enum, the CHECK constraint
#: and the graph rule all have one string in the tree to grep for.
EXECUTION_SUMMARY = "execution_summary"

#: How many closed sessions a scan looks back over by default. A ceiling rather
#: than "all of them": the audit log is append-only and a desk that has run for
#: a year would otherwise re-render a year of cards on every backfill.
DEFAULT_SESSION_LIMIT = 60


# --------------------------------------------------------------------------- #
# which sessions are closed — a scan that always says what it found and why
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ClosedSession:
    """One session and the instant the desk's own record says it ended."""

    session_date: str
    closed_at: datetime


@dataclass(frozen=True)
class SessionScan:
    """The result of looking for closed sessions — never a bare list.

    ``scanned=False`` is "could not look", ``sessions=()`` with ``scanned=True``
    is "looked, and there are none". Those are different facts about a desk and
    the caller prints them differently; an empty list standing in for both is
    the defect this codebase is most alert to after ``or 0``.
    """

    sessions: tuple[ClosedSession, ...]
    scanned: bool
    reason: str
    detail: str


def scan_closed_sessions(audit: Any, limit: int = DEFAULT_SESSION_LIMIT) -> SessionScan:
    """Every session the audit log shows opened AND closed, newest last."""
    if not audit.health().get("available"):
        # ``AuditStore.query`` logs its failures and returns ``[]``, so an
        # unreadable log and an empty one are indistinguishable one level down.
        # This is the only place the difference can still be seen.
        return SessionScan((), False, "audit_unavailable",
                           "the audit log is closed, so no session could be read")
    rows = audit.query(
        "SELECT ts, payload FROM risk_events WHERE event = 'session_rollover' "
        "ORDER BY ts DESC LIMIT ?",
        (limit + 1,),
    )
    boundaries: list[tuple[datetime, str]] = []
    for row in reversed(rows):  # ascending: a session is closed by the NEXT roll
        try:
            at = _audit_timestamp(row.get("ts"), context="risk_events.ts")
        except RuntimeError as exc:
            # A boundary that cannot be placed in time cannot bracket a session.
            log.error("dropping unreadable session boundary: %s", exc)
            continue
        try:
            payload = json.loads(row.get("payload") or "{}")
        except (TypeError, ValueError):
            payload = {}
        session_date = payload.get("session_date")
        if session_date:
            boundaries.append((at, str(session_date)))

    if not boundaries:
        return SessionScan((), True, "no_session_boundaries",
                           "this desk has not crossed a UTC session boundary")
    if len(boundaries) == 1:
        return SessionScan((), True, "no_closed_session",
                           f"session {boundaries[0][1]} is the current one and is still open")
    closed = tuple(
        ClosedSession(session_date=date, closed_at=boundaries[i + 1][0])
        for i, (_at, date) in enumerate(boundaries[:-1])
    )
    return SessionScan(closed, True, "scanned", f"{len(closed)} closed sessions")


# --------------------------------------------------------------------------- #
# the figures — every one of them already recorded
# --------------------------------------------------------------------------- #
def _window(audit: Any, session_date: str) -> tuple[Any, ...]:
    """The session's UTC day as query parameters, in the backend's own shape.

    DuckDB compares ``TIMESTAMP`` against a ``datetime``; the SQLite fallback
    stores the ISO string it was handed and compares text. ``session_costs``
    makes exactly this branch for exactly this reason, and a summary that
    silently matched no rows on one backend would report a day of no trading.
    """
    start = datetime.strptime(session_date, "%Y-%m-%d")
    end = start + timedelta(days=1)
    if audit.backend == "sqlite":
        return (start.isoformat(), end.isoformat())
    return (start, end)


def session_figures(audit: Any, session: ClosedSession) -> dict[str, Any]:
    """Everything the card renders, read from rows that already exist."""
    window = _window(audit, session.session_date)
    decisions = audit.query(
        "SELECT count(*) AS total, "
        "sum(CASE WHEN accepted THEN 1 ELSE 0 END) AS accepted, "
        "avg(latency_ms) AS avg_latency_ms, max(latency_ms) AS max_latency_ms "
        "FROM orders WHERE ts >= ? AND ts < ?",
        window,
    )
    venues = audit.query(
        "SELECT venue, count(*) AS fills, sum(COALESCE(notional, 0)) AS notional, "
        "avg(slippage_bps) AS avg_slippage_bps, "
        "sum(CASE WHEN slippage_bps IS NULL THEN 1 ELSE 0 END) AS unpriced "
        "FROM orders WHERE accepted AND fill_qty IS NOT NULL AND venue IS NOT NULL "
        "AND ts >= ? AND ts < ? GROUP BY venue ORDER BY notional DESC",
        window,
    )
    strategies = audit.query(
        "SELECT strategy, count(*) AS decisions FROM orders "
        "WHERE strategy IS NOT NULL AND ts >= ? AND ts < ? "
        "GROUP BY strategy ORDER BY decisions DESC",
        window,
    )
    # ``limit=1`` on a query that already takes the newest rows and re-sorts
    # them ascending: one row, and it is the closing mark.
    book = audit.equity_history(limit=1, session_date=session.session_date)
    return {
        "session_date": session.session_date,
        "closed_at": session.closed_at.replace(tzinfo=timezone.utc).isoformat(),
        "decisions": dict(decisions[0]) if decisions else {},
        "costs": audit.session_costs(session.session_date),
        "venues": [dict(v) for v in venues],
        "strategies": [dict(s) for s in strategies],
        "book": dict(book[-1]) if book else None,
    }


# --------------------------------------------------------------------------- #
# the card — the exact text that gets embedded
# --------------------------------------------------------------------------- #
def _line(label: str, value: Any) -> str:
    # The same ``label: value`` grammar every other card uses, kept local rather
    # than importing ``research_cards``' private helper across a module edge.
    return f"{label}: {value}"


def _measured(value: Any, unit: str = "", digits: int = 2) -> str:
    """A number, or WHY there is no number. Never a zero standing in for one."""
    if value is None:
        return "not recorded"
    return f"{value:,.{digits}f}{unit}"


def render_execution_summary_card(summary: dict[str, Any]) -> tuple[str, str]:
    """(title, body) for one closed UTC session.

    Shaped like ``render_backtest_card`` on purpose — title first, one
    ``label: value`` per line, same vocabulary — so a sweep and the session its
    strategy was traded in read as two answers to one question rather than two
    kinds of document.
    """
    session_date = summary.get("session_date")
    title = f"Execution summary {session_date}"
    decisions = summary.get("decisions") or {}
    costs = summary.get("costs") or {}
    book = summary.get("book")

    total = decisions.get("total")
    accepted = decisions.get("accepted")
    rejected = None if total is None or accepted is None else total - accepted
    unpriced = costs.get("fills_without_slippage")
    lines = [
        title,
        _line("Session closed at", summary.get("closed_at") or "still open"),
        _line(
            "Decisions",
            f"{total} ({accepted} accepted, {rejected} rejected)" if total
            else "none recorded",
        ),
        _line("Decision latency ms", (
            f"mean {_measured(decisions.get('avg_latency_ms'), digits=3)}, "
            f"max {_measured(decisions.get('max_latency_ms'), digits=3)}"
        )),
        _line("Strategies traded", _strategy_mix(summary.get("strategies") or [])),
        _line("Fills", costs.get("fills") if costs.get("fills") is not None else "not recorded"),
        _line("Filled notional USD", _measured(costs.get("notional"))),
        _line("Fees paid USD", _measured(costs.get("fees"))),
        _line(
            "Realised slippage cost USD",
            _measured(costs.get("slippage_cost"))
            + ("" if not unpriced else f" (a lower bound: {unpriced} fills were never priced)"),
        ),
    ]
    if book is None:
        # Not zeroes. A session the equity loop never sampled is a session whose
        # P&L this desk does not know, and saying so is the whole point.
        lines.append(_line("Book at close", "no equity snapshot recorded"))
    else:
        lines.extend([
            _line("Equity at close", _measured(book.get("equity"))),
            _line("Opening equity", _measured(book.get("start_of_day"))),
            _line("Realised P&L", _measured(book.get("realized_pnl"))),
            _line("Session P&L", _measured(book.get("daily_pnl"))),
            _line("Drawdown at close", _measured(book.get("drawdown_pct"), digits=4)),
            _line("Kill switch at close", "engaged" if book.get("kill_switch") else "disengaged"),
        ])
    lines.append(_line("Venue mix", _venue_mix(summary.get("venues") or [])))
    return title, "\n".join(lines)


def _strategy_mix(strategies: list[dict[str, Any]]) -> str:
    if not strategies:
        return "none tagged"
    return ", ".join(f"{s.get('strategy')} ({s.get('decisions')} decisions)" for s in strategies)


def _venue_mix(venues: list[dict[str, Any]]) -> str:
    """One clause per venue, ordered by notional as the desk's own rollup is.

    A single desk-wide slippage figure cannot say WHERE the cost was paid, which
    is the only actionable form of the question — the argument
    ``execution_quality_by`` already makes for the panel it serves.
    """
    if not venues:
        return "no fills recorded"
    return "; ".join(
        f"{v.get('venue')} {v.get('fills')} fills, {_measured(v.get('notional'))} USD, "
        f"{_measured(v.get('avg_slippage_bps'))} bps average slippage"
        + ("" if not v.get("unpriced") else f" ({v['unpriced']} unpriced)")
        for v in venues
    )


# --------------------------------------------------------------------------- #
# the document
# --------------------------------------------------------------------------- #
def execution_summary_document(summary: dict[str, Any]) -> dict[str, Any]:
    """One corpus document for one closed session, ready for the write path.

    ``strategy`` is set ONLY when the whole session traded one, and that is what
    makes ``research_graph``'s ``promoted_to`` edge real: it links a sweep to the
    session its strategy was traded in, and a session that traded three would
    otherwise be promoted from all three sweeps on the strength of a label that
    describes none of them. A mixed session carries no strategy and the card
    lists the mix instead.

    ``occurred_at`` is the session's CLOSE, taken from the rollover row that
    ended it — the same rule the backfill follows for a sweep, and the reason
    a summary sorts after every decision it summarises.
    """
    title, body = render_execution_summary_card(summary)
    strategies = summary.get("strategies") or []
    costs = summary.get("costs") or {}
    book = summary.get("book") or {}
    return {
        "kind": EXECUTION_SUMMARY,
        "source_ref": f"session:{summary.get('session_date')}",
        "symbol": None,  # a session is not one symbol, and guessing one would filter wrong
        "interval": None,
        "strategy": str(strategies[0]["strategy"]) if len(strategies) == 1 else None,
        "occurred_at": summary.get("closed_at"),
        "title": title,
        "body": body,
        "metrics": {
            "fills": costs.get("fills"),
            "notional": costs.get("notional"),
            "fees": costs.get("fees"),
            "slippage_cost": costs.get("slippage_cost"),
            "fills_without_slippage": costs.get("fills_without_slippage"),
            "daily_pnl": book.get("daily_pnl"),
            "drawdown_pct": book.get("drawdown_pct"),
        },
        "data_hash": None,
    }


def closed_session_documents(audit: Any, limit: int = DEFAULT_SESSION_LIMIT) -> tuple[
    list[dict[str, Any]], SessionScan
]:
    """Every closed session as a document, WITH the scan that found them.

    The scan is returned rather than logged away because "no documents" has two
    meanings here and the caller has to be able to print which one it got.
    """
    scan = scan_closed_sessions(audit, limit=limit)
    return [execution_summary_document(session_figures(audit, s)) for s in scan.sessions], scan
