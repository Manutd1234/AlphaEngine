"""The exact text that gets embedded, for each kind of research document.

Lifted out of `research_rag.py`, which owns the write path, the queue and
retrieval and had these renderers sitting in the middle of it. They are pure —
a row in, a (title, body) pair out — and share nothing with the transport.

**`body` is the embedded text, verbatim.** A change to a renderer here changes
what a stored vector MEANS, and there is no way to detect that from the vector
itself; the corpus keeps `body` precisely so the two can be compared. Editing
one of these is a re-index, not a cosmetic change.

One kind's text is deliberately NOT here: ``execution_summary`` is rendered by
``modules/research_ingest_session.py``, beside the audit reads that gather its
figures. This file would have crossed the 400-line ceiling to hold it, and a
card split from the queries that feed it is a card that drifts from them.

`render_backtest_documents` is the one function here that assembles whole
documents rather than text: one sweep yields the run card AND one document per
chart it drew, described from the figures the run already computed. Adding
documents is not a re-index; adding lines to an existing card would be, which
is exactly why the chart text is not appended to the run card.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from config import settings
from modules.research_chartdoc import ChartDoc, describe_run
from modules.research_image_store import CHART_PNG_FIELD, CHART_PNG_FIELDS

if TYPE_CHECKING:
    from modules.schemas import OrderRequest, RiskDecision

#: Gates whose rejection is worth a corpus document rather than a log line.
ANOMALY_GATES = {"est_slippage", "daily_drawdown"}


# --------------------------------------------------------------------------- #
# cards — the exact text that gets embedded
# --------------------------------------------------------------------------- #
def _line(label: str, value: Any) -> str:
    return f"{label}: {value}"


def render_backtest_card(row: dict[str, Any]) -> tuple[str, str]:
    """(title, body) for one ``backtest_runs`` row (audit-log column names)."""
    title = (
        f"Backtest {row.get('symbol')} {row.get('interval')} "
        f"{row.get('strategy')} {row.get('best_fast')}/{row.get('best_slow')}"
    )
    dsr = row.get("dsr")
    oos = row.get("oos_sharpe")
    body = "\n".join([
        title,
        _line("Engine", row.get("engine")),
        _line("Combinations tested", row.get("combos_tested")),
        _line("Best Sharpe", row.get("sharpe")),
        _line("Total return", row.get("total_return")),
        _line("Max drawdown", row.get("max_drawdown")),
        _line("Deflated Sharpe (DSR)", "not computed" if dsr is None else dsr),
        _line("Walk-forward OOS Sharpe", "not computed" if oos is None else oos),
        _line("Overfit probability (PBO)", row.get("pbo") if row.get("pbo") is not None else "not computed"),
        _line("Data hash", row.get("data_hash") or "unrecorded"),
        _line("Job", row.get("job_id")),
    ])
    return title, body


def render_ml_card(run: dict[str, Any]) -> tuple[str, str]:
    """(title, body) for one supervised run.

    Deliberately shaped like ``render_backtest_card`` — same vocabulary, same
    order, so an ML run and a sweep retrieved by the same query read as two
    answers to one question rather than two kinds of document.

    Three lines exist here that a sweep has no equivalent for, and each is the
    reason this is its own kind. The ENGINE says whether the hand-rolled models
    or the optional scikit-learn ran, because a run that fell back is a
    different run. The FEATURES line carries the spec hash, which is what makes
    two runs comparable at all. And the PURGE is stated per fold, because an
    out-of-sample Sharpe from an unpurged fold is not an out-of-sample Sharpe.
    """
    title = (
        f"ML run {run.get('symbol')} {run.get('interval')} "
        f"{run.get('model')} seed {run.get('seed')}"
    )
    folds = run.get("folds") or []
    features = run.get("features") or {}
    purges = {int(f.get("purge_bars", 0)) for f in folds}
    purge = (
        "no folds recorded" if not folds
        else f"{purges.pop()} bars" if len(purges) == 1
        else f"{min(purges)}–{max(purges)} bars"
    )
    positive = sum(1 for f in folds if (f.get("oos_sharpe") or 0) > 0)
    body = "\n".join([
        title,
        _line("Engine", run.get("engine") or "unrecorded"),
        _line("Status", run.get("status")),
        _line("Out-of-sample Sharpe", run.get("oos_sharpe") if run.get("oos_sharpe") is not None else "not computed"),
        _line("Deflated Sharpe (DSR)", run.get("deflated_sharpe") if run.get("deflated_sharpe") is not None else "not computed"),
        _line("Overfit probability (PBO)", run.get("pbo") if run.get("pbo") is not None else "not computed"),
        _line("Folds", f"{positive} of {len(folds)} positive out-of-sample" if folds else "none recorded"),
        _line("Purge per fold", purge),
        _line(
            "Features",
            f"{features.get('feature_count')} predicting {features.get('label')} "
            f"over {features.get('label_horizon_bars')} bars, spec {features.get('spec_hash', '')[:8]}"
            if features else "unrecorded",
        ),
        _line("Data hash", run.get("data_hash") or "unrecorded"),
        _line("Build", run.get("git_sha")[:8] if run.get("git_sha") else "unrecorded"),
    ])
    return title, body


def render_incident_card(
    kind: str, decision: RiskDecision, request: OrderRequest, detail: str
) -> tuple[str, str]:
    """(title, body) for an execution anomaly / risk incident."""
    title = f"{kind}: {decision.symbol} {decision.side} order {decision.order_id}"
    fill = decision.fill
    body = "\n".join([
        title,
        _line("Detail", detail),
        _line("Accepted", decision.accepted),
        _line("Rejected by", ", ".join(decision.rejected_by) or "—"),
        _line("Notional", decision.notional),
        _line("Realised slippage bps", fill.slippage_bps if fill else "no fill"),
        _line("Venue", fill.venue if fill else "—"),
        _line("Decision latency ms", decision.latency_ms),
        _line("Strategy", request.strategy or "untagged"),
        _line("At", decision.timestamp.isoformat()),
    ])
    return title, body


def classify_anomaly(decision: RiskDecision) -> str | None:
    """The precise trigger definition; None means no anomaly."""
    fill = decision.fill
    if (
        decision.accepted
        and fill is not None
        and fill.slippage_bps is not None
        and fill.slippage_bps > settings.max_est_slippage_bps
    ):
        return (
            f"realised slippage {fill.slippage_bps:.2f} bps exceeded the "
            f"{settings.max_est_slippage_bps:.0f} bps pre-trade ceiling"
        )
    if not decision.accepted and ANOMALY_GATES.intersection(decision.rejected_by):
        gates = ", ".join(sorted(ANOMALY_GATES.intersection(decision.rejected_by)))
        return f"rejected by {gates}"
    return None


# --------------------------------------------------------------------------- #
# documents — one sweep, one run card, and the charts it already computed
# --------------------------------------------------------------------------- #
def _chart_metrics(result: Any) -> dict[str, Any]:
    """The tear sheet's own figures, named the way the describer reads them.

    Every number here was computed in order to DRAW something: the equity
    curve's terminal value, the drawdown it survived, the trade count and the
    exposure printed under it, the buy-and-hold line beside it. Nothing is
    recomputed and nothing is estimated — a figure the run does not carry is
    passed as ``None`` and the describer omits that clause rather than guessing.

    The drawdown keeps the sign the engine produced it with. Making it read
    positive would be a nicer sentence about a number this desk never computed.
    """
    best = result.best
    benchmark = result.benchmark_buy_hold or {}
    buy_hold = benchmark.get("total_return")
    return {
        "total_return_x": 1.0 + best.total_return,
        "max_drawdown": best.max_drawdown,
        "sharpe": best.sharpe,
        "trades": best.trades,
        "time_in_market": best.exposure,
        "benchmark_return_x": None if buy_hold is None else 1.0 + buy_hold,
    }


def render_backtest_documents(
    result: Any, *, occurred_at: str | None = None
) -> list[dict[str, Any]]:
    """Every document one completed sweep produces, ready for the write queue.

    ``occurred_at`` is THE JOB'S FINISH TIME, passed in by the caller that has
    it. It used to be ``datetime.now()`` taken here, which is not a lie by much
    on a healthy desk and is a lie by hours on a queue that has backed up or a
    sweep that finished during a Supabase outage and was replayed afterwards —
    and the corpus orders and filters on this column, so "the run before the
    incident" quietly became "the run indexed before the incident". The backfill
    tool has always used the audit row's own timestamp; this is the live path
    catching up with it.

    The run card first, then ONE DOCUMENT PER CHART. A chart on this desk is a
    PNG and the corpus indexes text, so the equity curve, the drawdown envelope
    and the fold table were unreachable — not because their meaning was
    unavailable, but because it was only ever rendered into pixels. Every figure
    a vision model would have to learn to read back off those pixels is a number
    this desk computed in order to draw them, and ``research_chartdoc`` turns
    those numbers into the sentence the chart is making.

    Separate documents rather than more lines on the run card, for two reasons.
    A query about a drawdown should retrieve THE DRAWDOWN, titled as such, not a
    sweep card that mentions one. And appending to the run card would change the
    text that every stored ``backtest_run`` vector was built from — a re-index,
    silently, for a feature that does not need one. This adds documents; it
    changes none.

    The chart documents share the run's ``kind``, symbol, interval, strategy and
    ``data_hash`` — so they carry the same provenance, filter with the run and
    link to it through the graph — and are told apart by a ``source_ref`` of
    ``<job id>:<chart>``, which the corpus's unique key already keys on.

    Never raises. A sweep that finished is indexed as a sweep that finished even
    if its charts cannot be described; returning nothing at all is reserved for
    a result whose own fields are unreadable, which is the pre-existing rule.
    """
    try:
        row = {
            "symbol": result.request.symbol,
            "interval": result.request.interval,
            "strategy": result.request.strategy,
            "engine": result.engine,
            "combos_tested": result.combos_tested,
            "best_fast": result.best.fast,
            "best_slow": result.best.slow,
            "sharpe": result.best.sharpe,
            "total_return": result.best.total_return,
            "max_drawdown": result.best.max_drawdown,
            "dsr": result.deflated_sharpe_ratio,
            "oos_sharpe": result.walk_forward_oos_sharpe,
            "pbo": getattr(result, "pbo", None),
            "data_hash": result.data_hash,
            "job_id": result.job_id,
        }
    except AttributeError:
        return []

    title, body = render_backtest_card(row)
    run = {
        "kind": "backtest_run",
        "source_ref": str(row["job_id"]),
        "symbol": row["symbol"],
        "interval": row["interval"],
        "strategy": row["strategy"],
        # A caller with no finish time to give still has to produce a row —
        # ``occurred_at`` is NOT NULL in the corpus and a sweep that ran is worth
        # indexing late rather than not at all. The ingest instant is the honest
        # answer to "when did the desk learn this", and the caller logs that it
        # had to be used, so the substitution is never silent.
        "occurred_at": occurred_at or datetime.now(timezone.utc).isoformat(),
        "title": title,
        "body": body,
        "metrics": {
            k: row[k] for k in ("sharpe", "dsr", "oos_sharpe", "pbo", "combos_tested")
        },
        "data_hash": row["data_hash"],
    }

    documents = [run]
    for chart in _describe_charts(result):
        # The chart's own title carries the identifiers, because "Equity curve"
        # is not an answer in a corpus that holds hundreds of them — and because
        # the lexical half of the hybrid index needs the symbol token present.
        chart_title = (
            f"{chart.title}: {row['symbol']} {row['interval']} {row['strategy']}"
        )
        document = {
            **run,
            # Its own kind, not `backtest_run`. Filed as a run, four documents
            # per sweep made `corpus_size` report four runs and made
            # `filter_kind='backtest_run'` return three chart descriptions for
            # every run it was asked for. The text was honest either way; it
            # was the FILTER that stopped meaning what it says.
            "kind": "chart",
            "source_ref": f"{row['job_id']}:{chart.chart}",
            "title": chart_title,
            "body": f"{chart_title}\n{chart.body}",
            "metrics": {"chart": chart.chart},
        }
        _attach_png(document, result, chart)
        documents.append(document)
    return documents


def _attach_png(document: dict[str, Any], result: Any, chart: ChartDoc) -> None:
    """Ride the rendered PNG along with the document that describes it.

    UNDER A PRIVATE KEY, never a column. `research_rag.writer` pops it before
    the row is inserted, exactly as it pops `_retrieve_after` and `_image_png`;
    a key that reached PostgREST would be a 400 that dead-lettered the document.

    Why it is attached HERE rather than fetched later: this is the one moment
    the pixels and the document that describes them are in the same hand. The
    result object holds `equity_curve_png` and this function is deciding what
    `source_ref` that chart gets, so pairing them costs a `getattr`. Everything
    downstream — the durable store, the answer that shows a model the chart —
    is a consequence of the pair existing at all, and the alternative was
    re-deriving it from a job id in a process that may not hold the job.

    Only the charts `CHART_PNG_FIELDS` names, which today is the equity curve.
    The drawdown is a subplot inside that same figure and the fold table is
    text, so pointing either at the equity PNG would file a picture under a
    document that is not a picture of it — the confident wrong answer this
    plane is built to refuse. The rendered Sharpe heatmap goes the other way:
    it exists and no chart document describes it, so there is nothing to cite
    an answer against and it is deliberately not carried here.

    Never raises. `result` is a `BacktestResult` on the live path and could be
    anything on a replay, so the read is a `getattr` with a default: a missing
    PNG is a document without a picture, which is already a named state on the
    read side, and never a sweep that failed to index.
    """
    field = CHART_PNG_FIELDS.get(chart.chart)
    png = getattr(result, field, None) if field else None
    if isinstance(png, str) and png:
        document[CHART_PNG_FIELD] = png


def _describe_charts(result: Any) -> list[ChartDoc]:
    """The charts this run can honestly describe, or none of them.

    Indexing must never be able to fail the thing it indexes: a sweep that
    finished is filed as a sweep that finished even when its own figures are
    unreadable, and a chart the desk cannot describe is simply not indexed.
    """
    try:
        return describe_run({
            "metrics": _chart_metrics(result),
            "folds": [{"oos_sharpe": f.oos_sharpe} for f in result.walk_forward],
        })
    except (AttributeError, TypeError, ValueError):
        return []
