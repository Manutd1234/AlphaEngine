"""Charts, made retrievable by what they show rather than by their pixels.

A chart on this desk is not decoration — the equity curve, the drawdown
envelope, the fold table and the gate ladder each carry a claim. None of them
is reachable from the corpus today, because the corpus indexes text and a chart
is a PNG.

The obvious answer is a shared image/text embedder: CLIP, SigLIP, ColPali. It
is also the wrong first answer here. Every figure those models would have to
learn to read off the pixels is a number this desk COMPUTED in order to draw
the chart. Describing the chart from those numbers is exact where a vision
model would be approximate, costs nothing, needs no new dependency, and works
with the `embed-research` edge function already deployed.

So this module renders a chart's meaning as a sentence, and that sentence is
what gets embedded and retrieved. "The equity curve ends at 1.03x after a 26.1%
maximum drawdown, with 30 trades and 45% time in market" is a better retrieval
key than the image it describes, and it is one the desk can produce with
certainty.

On the vision model that is not here
------------------------------------

The plan for this slice allowed a second edge function embedding the images
themselves, gated on the Supabase Edge runtime actually offering a vision
model. It does not: `Supabase.ai.Session` exposes `gte-small` for embeddings,
and nothing in the runtime's inference API takes an image. Rather than ship a
stub against an API that does not exist, this file says so — and the honest
consequence is that image retrieval on this desk is retrieval over descriptions
until that changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _pct(value: Any) -> str | None:
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return None


def _num(value: Any, places: int = 2) -> str | None:
    try:
        return f"{float(value):.{places}f}"
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True, slots=True)
class ChartDoc:
    """One chart, as the corpus will hold it."""

    chart: str
    title: str
    body: str

    def as_card(self) -> str:
        return f"{self.title}\n{self.body}"


def describe_equity_curve(metrics: dict[str, Any]) -> ChartDoc | None:
    """The equity chart: where it ended and what it cost to get there.

    Returns None when the run carries no terminal value. A chart described
    without its own figures would retrieve for queries it cannot answer, which
    is worse than not being indexed at all.
    """
    ending = _num(metrics.get("total_return_x") or metrics.get("ending_equity_x"))
    if ending is None:
        return None

    parts = [f"The equity curve ends at {ending}x"]
    drawdown = _pct(metrics.get("max_drawdown"))
    if drawdown:
        parts.append(f"after a {drawdown} maximum drawdown")
    sharpe = _num(metrics.get("sharpe"))
    if sharpe:
        parts.append(f"at Sharpe {sharpe}")

    tail = []
    trades = metrics.get("trades")
    if trades is not None:
        tail.append(f"{int(trades)} trades")
    exposure = _pct(metrics.get("time_in_market"))
    if exposure:
        tail.append(f"{exposure} time in market")
    benchmark = _num(metrics.get("benchmark_return_x"))
    if benchmark:
        tail.append(f"buy and hold ended at {benchmark}x")

    # Clauses, not a comma list: "ends at 1.03x, after a drawdown, at Sharpe"
    # reads as three items rather than one sentence.
    body = " ".join(parts) + ("; " + ", ".join(tail) if tail else "") + "."
    return ChartDoc("equity_curve", "Equity curve", body)


def describe_drawdown(metrics: dict[str, Any]) -> ChartDoc | None:
    """The drawdown envelope: how deep, how long, and whether it recovered."""
    depth = _pct(metrics.get("max_drawdown"))
    if depth is None:
        return None
    parts = [f"The drawdown envelope reaches {depth}"]
    bars = metrics.get("max_drawdown_bars")
    if bars is not None:
        parts.append(f"over {int(bars)} bars")
    recovered = metrics.get("recovered")
    if recovered is not None:
        parts.append("and recovers" if recovered else "and does not recover within the window")
    return ChartDoc("drawdown", "Drawdown envelope", " ".join(parts) + ".")


def describe_walk_forward(folds: list[dict[str, Any]]) -> ChartDoc | None:
    """The fold table: how many folds, how many held up, and the spread.

    The count of POSITIVE folds is the figure a reader is looking for and the
    one a picture of a fold table makes them count by eye.
    """
    if not folds:
        return None
    sharpes = [f.get("oos_sharpe") for f in folds if f.get("oos_sharpe") is not None]
    if not sharpes:
        return None
    positive = sum(1 for s in sharpes if float(s) > 0)
    lo, hi = min(float(s) for s in sharpes), max(float(s) for s in sharpes)
    body = (
        f"Walk-forward over {len(folds)} folds: {positive} of {len(sharpes)} "
        f"out-of-sample Sharpes are positive, ranging {lo:.2f} to {hi:.2f}."
    )
    return ChartDoc("walk_forward", "Walk-forward folds", body)


def describe_gate_ladder(gates: list[dict[str, Any]]) -> ChartDoc | None:
    """The pre-trade ladder: which gate refused, or that none did.

    Naming the refusing gate is the point. "Rejected" is a state anybody can
    see; WHICH check refused is the answer, and on a picture it is a red bar
    somebody has to hover.
    """
    if not gates:
        return None
    failed = [str(g.get("name")) for g in gates if g.get("passed") is False]
    if failed:
        body = (
            f"The pre-trade ladder refused at {', '.join(failed)}; "
            f"{len(gates) - len(failed)} of {len(gates)} checks passed."
        )
    else:
        body = f"The pre-trade ladder passed all {len(gates)} checks."
    return ChartDoc("gate_ladder", "Pre-trade gate ladder", body)


def describe_run(payload: dict[str, Any]) -> list[ChartDoc]:
    """Every chart a completed run produced, as retrievable text.

    Absent inputs produce no document rather than an empty one — the same rule
    the rest of the corpus follows, and the reason a query for a drawdown does
    not surface a run that never reported one.
    """
    metrics = payload.get("metrics") or {}
    docs = [
        describe_equity_curve(metrics),
        describe_drawdown(metrics),
        describe_walk_forward(payload.get("folds") or []),
        describe_gate_ladder(payload.get("gates") or []),
    ]
    return [d for d in docs if d is not None]
