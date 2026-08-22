"""``structured_runs``: counts and extrema, computed from the desk's own rows.

The planner has been routing "how many", "best", "worst", "since" and "average"
questions to a tool with no executor. The router recorded ``unsupported`` and
leaned on the plan's hybrid call to answer instead — and hybrid search cannot
answer a count. It retrieves documents that TALK about runs; the question asked
for the number of them. Worse, the bound could truncate that hybrid call away
entirely (see `research_router_calls.bound_calls`), which left "how many runs
since 3f8a9c21" retrieving on one working arm and reporting no failure at all.

WHICH STORE, AND WHY THIS ONE
-----------------------------
Two stores hold structured runs on this desk.

* ``modules/ml/store.py`` (``MLRunStore``) is the ml_* tables over PostgREST.
  It is async, it needs Supabase credentials, it reports ``unconfigured`` on a
  normal deployment, and reaching it from here would put a network call on the
  research read path and in the test suite. Rejected for all four reasons.
* The audit log's ``backtest_runs`` table is written by
  ``modules/audit/writers.py`` on every completed sweep, lives in the same
  in-process DuckDB (or SQLite) file the router is ALREADY writing its ledger
  rows to, and is read with a plain SELECT. No new handle, no new setting, no
  network. That is the honest read path, so it is the one used.

So the executor answers from ``backtest_runs`` and says so in every row it
returns: a caller who thinks it is being told about ML runs, or about the
research corpus, is being told about backtest sweeps, and the row names its
source.

WHAT IT WILL NOT DO
-------------------
No strategy-name filter. A count that silently narrows itself on a token that
happened to look like a strategy is worse than one that did not narrow at all,
because both come back as a number and only one of them is the answer. Symbol
filtering requires the quote suffix (``BTCUSDT``, ``ETHUSD``, ``BTCPERP``) for
the same reason — the router's looser ticker pattern reads "BEST" or "DSR" as a
symbol and would quietly count nothing.

No guessing which metric "the best run" meant. An extremum reported against a
number the asker did not choose is wrong in a way that reads as right.

The SELECTs themselves and the shape of an answer live in
``research_structured_reads``; this module decides what was asked and over what.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from modules.research_structured_reads import (
    COLUMNS,
    TABLE,
    Scope,
    StructuredAnswer,
    average,
    count_runs,
    extremum,
    scalar,
)

log = logging.getLogger("alphaengine.research.structured")

_ASK_COUNT = re.compile(r"\b(how many|how much|number of|count|total)\b", re.I)
_ASK_BEST = re.compile(r"\b(best|highest|top|most|strongest)\b", re.I)
_ASK_WORST = re.compile(r"\b(worst|lowest|least|weakest)\b", re.I)
_ASK_AVERAGE = re.compile(r"\baverage\b", re.I)
#: "moving average" and its family are STRATEGY names, not a request for a mean.
#: The same guard the planner carries, restated here because this module can be
#: reached by a planner that does not carry it.
_AVERAGE_IN_A_STRATEGY_NAME = re.compile(
    r"\b(moving|exponential|weighted|simple|triple|double|rolling)\s+average\b", re.I
)

_SINCE_HASH = re.compile(r"\bsince\s+(?:the\s+)?(?:run\s+)?([0-9a-f]{8})\b", re.I)
_SINCE_DATE = re.compile(r"\bsince\s+(\d{4}-\d{2}-\d{2})\b", re.I)
_DATA_HASH = re.compile(r"\b[0-9a-f]{8}\b")
_SYMBOL = re.compile(r"\b[A-Z]{2,10}(?:USDT|USD|PERP)\b")

#: Longest name first: "oos sharpe" must not be read as "sharpe".
_METRIC_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(oos|out[- ]of[- ]sample)\s*sharpe\b", re.I), "oos_sharpe"),
    (re.compile(r"\bsharpe\b", re.I), "sharpe"),
    (re.compile(r"\b(max )?draw[- ]?down\b|\bmdd\b", re.I), "max_drawdown"),
    (re.compile(r"\breturns?\b", re.I), "total_return"),
    (re.compile(r"\b(dsr|deflated)\b", re.I), "dsr"),
    (re.compile(r"\b(pbo|overfitting)\b", re.I), "pbo"),
)


def answer_structured(question: str, store: Any) -> StructuredAnswer:
    """Answer a count / extremum / mean question from ``backtest_runs``.

    Never raises. Every way this can fail to produce a number is a named state
    with a sentence attached, because the caller writes that sentence into the
    ledger and a reader six weeks later has nothing else to go on.
    """
    reader = getattr(store, "query", None)
    if store is None or not callable(reader):
        return StructuredAnswer(
            "unavailable", (),
            "no readable audit store was given to the router, so nothing could be counted",
        )

    intent, metric = _intent(question)
    if intent is None:
        return StructuredAnswer(
            "skipped", (),
            f"this question asks for no count, extremum or mean that {TABLE} can compute",
        )
    if intent != "count" and metric is None:
        return StructuredAnswer(
            "skipped", (),
            f"the question asks for the {intent} run but names no metric {TABLE} records "
            f"({', '.join(label for label, _ in COLUMNS.values())}), and guessing which number "
            "was meant is not an answer",
        )

    try:
        recorded = scalar(reader, f"SELECT count(*) AS n FROM {TABLE}", (), "n")  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    except Exception as exc:  # noqa: BLE001 — an unreadable store is a state, not an outage
        # The two failures that reach here are a table this database predates
        # and a ledger that is down. Both are "could not count", which is the
        # thing this must never render as "counted nothing".
        log.warning("structured_runs could not read %s (%s)", TABLE, type(exc).__name__)
        return StructuredAnswer(
            "unavailable", (),
            f"the audit store could not be read ({type(exc).__name__}), so no count was taken",
        )
    if not recorded:
        return StructuredAnswer(
            "empty", (),
            f"the audit log holds no {TABLE} rows at all, so there was nothing to count",
        )

    try:
        scope, refusal = _scope(question, reader)
        if refusal is not None:
            return refusal
        if intent == "count":
            return count_runs(reader, scope, recorded)
        if intent == "average":
            return average(reader, scope, metric)
        return extremum(reader, scope, metric, intent == "best")
    except Exception as exc:  # noqa: BLE001 — same contract as the count above
        log.warning("structured_runs failed on %s (%s)", intent, type(exc).__name__)
        return StructuredAnswer(
            "unavailable", (),
            f"the audit store could not answer this ({type(exc).__name__}); no number is "
            "reported rather than a wrong one",
        )


def _intent(question: str) -> tuple[str | None, str | None]:
    """The kind of question, and the metric it names. Either may be None.

    Order matters: a question naming a metric AND a superlative is an extremum,
    a question naming "average" is a mean, and "how many" is a count whatever
    else it mentions. "how many runs had the best Sharpe" is deliberately read
    as a count — it asks for a number of runs, not for a run.
    """
    metric = next((col for pattern, col in _METRIC_PATTERNS if pattern.search(question)), None)
    if _ASK_COUNT.search(question):
        return "count", metric
    if _ASK_AVERAGE.search(question) and not _AVERAGE_IN_A_STRATEGY_NAME.search(question):
        return "average", metric
    if _ASK_BEST.search(question):
        return "best", metric
    if _ASK_WORST.search(question):
        return "worst", metric
    return None, None


def _scope(question: str, reader: Any) -> tuple[Scope, StructuredAnswer | None]:
    """The WHERE clause, in words as well as in SQL.

    ``since <data hash>`` is resolved to the timestamp of the newest run
    carrying that hash, which is what the phrase means on this desk: "since we
    ran those bars". A hash no run carries returns an EMPTY answer naming the
    hash, never a count over the whole table — silently widening "since X" to
    "ever" hands back a large, true-looking number to a question nobody
    answered, and that is the single most dangerous thing a counting tool can do.
    """
    clauses: list[str] = []
    params: list[Any] = []
    words: list[str] = []

    symbol_match = _SYMBOL.search(question)
    symbol = symbol_match.group(0) if symbol_match else None
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
        words.append(f"symbol {symbol}")

    since_hash = _SINCE_HASH.search(question)
    since_date = _SINCE_DATE.search(question)
    if since_hash:
        digest = since_hash.group(1)
        anchor = scalar(
            reader, f"SELECT max(ts) AS ts FROM {TABLE} WHERE data_hash = ?", (digest,), "ts"  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
        )
        if anchor is None:
            return Scope("", (), "", symbol), StructuredAnswer(
                "empty", (),
                f"no {TABLE} row carries data hash {digest}, so 'since {digest}' has no anchor "
                "and nothing was counted",
                text=f"SELECT max(ts) FROM {TABLE} WHERE data_hash = ? -- params ['{digest}']",  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
            )
        clauses.append("ts > ?")
        params.append(anchor)
        words.append(f"after the newest run on data hash {digest} ({anchor})")
    elif since_date:
        clauses.append("ts >= ?")
        params.append(since_date.group(1))
        words.append(f"on or after {since_date.group(1)}")
    else:
        digest_match = _DATA_HASH.search(question)
        if digest_match:
            clauses.append("data_hash = ?")
            params.append(digest_match.group(0))
            words.append(f"data hash {digest_match.group(0)}")

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    described = ", ".join(words) if words else "every recorded run"
    return Scope(where, tuple(params), described, symbol), None
