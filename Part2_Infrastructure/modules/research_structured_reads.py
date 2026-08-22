"""The SELECTs behind ``structured_runs``, and the shape of what they return.

Split from ``research_structured`` on length alone — that module reads the
QUESTION (what was asked, over what scope) and this one reads the TABLE. The
line between them is worth keeping anyway: everything here takes a scope it did
not build and a metric name it did not choose, so a wrong answer in this file is
arithmetic and a wrong answer in that one is comprehension.

One rule runs through all three computations: **the denominator travels with the
number.** ``avg`` and ``ORDER BY`` both ignore NULLs in DuckDB and in SQLite,
which is correct and is exactly why a mean over 6 of 40 runs must never be
printed as a mean over the sweep. Every answer states how many rows were in
scope, how many carried the measurement, and how many did not.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: The table this tool reads and the only one it reads.
TABLE = "backtest_runs"
SOURCE_REF = f"audit_log:{TABLE}"

#: column -> (what to call it in prose, whether a larger number is better).
#: ``max_drawdown`` is stored as ``min(equity / peak - 1)`` — a NEGATIVE
#: fraction — so the larger number really is the better one, and "worst
#: drawdown" is the most negative row. Getting that backwards would report the
#: shallowest drawdown as the worst, which reads perfectly plausibly and is the
#: kind of error nothing downstream can catch. ``pbo`` is the one metric here
#: where smaller is better.
COLUMNS: dict[str, tuple[str, bool]] = {
    "sharpe": ("Sharpe ratio", True),
    "oos_sharpe": ("out-of-sample Sharpe ratio", True),
    "total_return": ("total return", True),
    "max_drawdown": ("maximum drawdown", True),
    "dsr": ("deflated Sharpe ratio", True),
    "pbo": ("probability of backtest overfitting", False),
}


@dataclass(frozen=True, slots=True)
class StructuredAnswer:
    """A computed answer, or a named reason there is none.

    ``state`` uses the router's own vocabulary so the caller does not translate:
    ``ok`` (computed), ``empty`` (the store answered and holds nothing in
    scope), ``unavailable`` (the store could not be read), ``skipped`` (this
    question is not one this tool computes).
    """

    state: str
    rows: tuple[dict[str, Any], ...]
    detail: str
    #: What was actually asked of the store, for the ledger. The row records the
    #: statement the SQL made, not the English the user typed.
    text: str | None = None


@dataclass(frozen=True, slots=True)
class Scope:
    """A WHERE clause, its bound parameters, and the same filter in words."""

    where: str
    params: tuple[Any, ...]
    described: str
    symbol: str | None


def count_runs(reader: Any, scope: Scope, recorded: int) -> StructuredAnswer:
    """How many runs match. Zero is a MEASUREMENT here, not an absence.

    The store answered and the table is not empty — the caller establishes that
    before calling — so "none of them match" is a true and useful count and is
    returned as one, with the denominator beside it. "0 of 412" and "0 of 0" are
    different facts and only the first is about the question that was asked.
    """
    sql = f"SELECT count(*) AS n FROM {TABLE}{scope.where}"  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    matched = scalar(reader, sql, scope.params, "n") or 0
    latest = scalar(reader, f"SELECT max(ts) AS ts FROM {TABLE}{scope.where}", scope.params, "ts")  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    title = f"{matched} of {recorded} recorded backtest runs match: {scope.described}"
    body = (
        f"Counted directly from the audit log's {TABLE} table, which holds {recorded} runs in "
        f"total. Scope: {scope.described}. This is a count of RUNS, not of documents about runs."
    )
    return StructuredAnswer(
        "ok",
        (row("count", title, body, scope, occurred_at=latest,
             metrics={"matched": matched, "recorded": recorded}),),
        title,
        text=sql_text(sql, scope.params),
    )


def extremum(reader: Any, scope: Scope, metric: str, want_best: bool) -> StructuredAnswer:
    """The best or worst run by one metric, over the rows that record it."""
    label, higher_is_better = COLUMNS[metric]
    order = "DESC" if (higher_is_better if want_best else not higher_is_better) else "ASC"
    measured_where = and_clause(scope, f"{metric} IS NOT NULL")
    # ``metric`` is a key of ``COLUMNS`` and can be nothing else — the intent
    # reader returns one of those names or nothing — so the interpolation below
    # cannot carry caller text. Everything that can is a bound parameter.
    columns = "ts, job_id, symbol, interval, strategy, data_hash, label"
    sql = f"SELECT {columns}, {metric} AS value FROM {TABLE}{measured_where} ORDER BY {metric} {order} LIMIT 1"  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    rows = list(reader(sql, scope.params))
    matched = scalar(reader, f"SELECT count(*) AS n FROM {TABLE}{scope.where}", scope.params, "n") or 0  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    measured = scalar(reader, f"SELECT count(*) AS n FROM {TABLE}{measured_where}", scope.params, "n") or 0  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    superlative = "best" if want_best else "worst"
    if not rows:
        return StructuredAnswer(
            "empty", (),
            f"{matched} runs match ({scope.described}) and none of them records a {label}, so "
            f"there is no {superlative} one — an unmeasured metric is not a zero and is not "
            "compared as one",
            text=sql_text(sql, scope.params),
        )
    best = rows[0]
    unmeasured = matched - measured
    title = (
        f"The {superlative} {label} among {measured} measured runs is {best.get('value')} "
        f"({best.get('symbol')} {best.get('strategy')}, job {best.get('job_id')})"
    )
    body = (
        f"Taken from the audit log's {TABLE} table. Scope: {scope.described}. {measured} of "
        f"{matched} runs in scope record a {label}"
        + (f"; the other {unmeasured} do not and are not in this comparison."
           if unmeasured else " — every run in scope is in this comparison.")
    )
    return StructuredAnswer(
        "ok",
        (row(f"{superlative}_{metric}", title, body, scope, occurred_at=best.get("ts"),
             symbol=best.get("symbol"), strategy=best.get("strategy"),
             metrics={metric: best.get("value"), "matched": matched, "measured": measured,
                      "unmeasured": unmeasured, "job_id": best.get("job_id"),
                      "data_hash": best.get("data_hash")}),),
        title,
        text=sql_text(sql, scope.params),
    )


def average(reader: Any, scope: Scope, metric: str) -> StructuredAnswer:
    """The mean of one metric over the runs that HAVE it, denominator included."""
    label, _ = COLUMNS[metric]
    measured_where = and_clause(scope, f"{metric} IS NOT NULL")
    sql = f"SELECT avg({metric}) AS value, count(*) AS n FROM {TABLE}{measured_where}"  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    rows = list(reader(sql, scope.params))
    measured = int(rows[0].get("n") or 0) if rows else 0
    value = rows[0].get("value") if rows else None
    matched = scalar(reader, f"SELECT count(*) AS n FROM {TABLE}{scope.where}", scope.params, "n") or 0  # noqa: S608 — TABLE and the metric are module constants; every VALUE is a bound parameter
    if not measured or value is None:
        return StructuredAnswer(
            "empty", (),
            f"{matched} runs match ({scope.described}) and none records a {label}, so no mean "
            "exists — a mean of nothing is not zero",
            text=sql_text(sql, scope.params),
        )
    title = f"Mean {label} over {measured} measured runs is {value}"
    body = (
        f"Taken from the audit log's {TABLE} table. Scope: {scope.described}. The mean covers the "
        f"{measured} of {matched} runs in scope that record a {label}; the rest are absent from "
        "it, not counted as zero."
    )
    return StructuredAnswer(
        "ok",
        (row(f"mean_{metric}", title, body, scope, occurred_at=None,
             metrics={metric: value, "matched": matched, "measured": measured,
                      "unmeasured": matched - measured}),),
        title,
        text=sql_text(sql, scope.params),
    )


# -- shapes and small helpers ----------------------------------------------- #
def row(
    intent: str, title: str, body: str, scope: Scope, *, occurred_at: Any,
    metrics: dict[str, Any], symbol: str | None = None, strategy: str | None = None,
) -> dict[str, Any]:
    """A retrieval-shaped row for a computed answer — with no ``similarity``.

    The key is ABSENT rather than null or zero. There was no similarity: this
    row was not retrieved, it was calculated. A 0.0 there would rank the one
    exact answer below every vague document the corpus returned, and a null
    would be coerced to that 0.0 by the first caller that reads it with ``or``.
    ``Execution.structured`` keeps these rows apart from the retrieved ones for
    exactly that reason.
    """
    return {
        "id": f"structured_runs:{intent}:{scope.described}",
        "kind": "structured_runs",
        "source_ref": SOURCE_REF,
        "symbol": symbol or scope.symbol,
        "strategy": strategy,
        "occurred_at": occurred_at,
        "title": title,
        "body": body,
        "metrics": metrics,
    }


def and_clause(scope: Scope, clause: str) -> str:
    return f"{scope.where} AND {clause}" if scope.where else f" WHERE {clause}"


def scalar(reader: Any, sql: str, params: tuple[Any, ...], column: str) -> Any:
    rows = list(reader(sql, params))
    return rows[0].get(column) if rows else None


def sql_text(sql: str, params: tuple[Any, ...]) -> str:
    """The statement and its bound values, for the ledger.

    Written out because "structured_runs ran" is not replayable and "this SELECT
    with these parameters ran" is. The parameters are appended as a comment
    rather than interpolated into the statement, so the recorded row cannot be
    mistaken for something to execute.
    """
    return f"{sql} -- params {list(params)}"
