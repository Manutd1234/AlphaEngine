"""The exact text that gets embedded, for each kind of research document.

Lifted out of `research_rag.py`, which owns the write path, the queue and
retrieval and had these renderers sitting in the middle of it. They are pure —
a row in, a (title, body) pair out — and share nothing with the transport.

**`body` is the embedded text, verbatim.** A change to a renderer here changes
what a stored vector MEANS, and there is no way to detect that from the vector
itself; the corpus keeps `body` precisely so the two can be compared. Editing
one of these is a re-index, not a cosmetic change.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from config import settings

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
# the index
# --------------------------------------------------------------------------- #
