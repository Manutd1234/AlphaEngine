"""A labelled chart corpus whose ground truth is GENERATED, not judged.

``web/lib/retrieval-eval.ts`` records why no answer key is committed for the
desk's real corpus: "labels are a judgement about this desk's own corpus, and
none is committed, because a fabricated answer key produces a figure that looks
like evidence and is not". That objection is fatal to hand-labelling and it does
NOT apply here, because this file does not label charts — it MANUFACTURES them
from a series it chose. A curve built to fall 45% and claw half of it back is
relevant to "an equity curve with a large drawdown" by construction; no reader
was asked for an opinion, so no opinion can be wrong.

SIX FAMILIES, CHOSEN TO BE VISUALLY SEPARABLE AND NUMERICALLY CONFUSABLE
------------------------------------------------------------------------

The families are the shapes a desk actually asks for by eye — a deep drawdown, a
monotone climb, a flat line, a violent oscillation, a grinding decline, and the
parameter heatmap that is not a line chart at all. They are deliberately chosen
so that the two arms are tested where they DIFFER rather than where they agree:

* ``flat`` and ``volatile`` both end near 1.0x. Their sentences from
  ``research_chartdoc`` are therefore nearly the same sentence, differing in a
  drawdown figure; their PICTURES could not look less alike. If the image arm
  is worth anything on this domain, this is the pair where it shows.
* ``deep_drawdown`` and ``monotonic`` can be made to end at the same multiple.
  The description says "ends at 1.9x" for both; only the drawing says how.
* ``heatmap`` is a different KIND of image, and a vision encoder that cannot
  separate a grid of coloured squares from a line chart is not separating
  anything.

THE PLOTS ARE THE DESK'S OWN, NOT A LOOKALIKE
---------------------------------------------

``modules.backtester.plots.plot_equity_curve`` and ``plot_heatmap`` render every
PNG here — the same functions whose base64 output ``research_image_ingest``
attaches to a document as ``equity_curve_png`` and ``heatmap_png``. The rejected
alternative was a small local matplotlib figure, which would have been a third
of the code and would have measured a chart this desk never indexes: the real
figure carries a dark ground, a drawdown sub-panel, a legend, a monospace stats
block and a title full of numbers, and every one of those is pixels CLIP has to
look past. Benching a clean line on white would have flattered the image arm
with a corpus that does not exist.

WHAT THE DESCRIPTIONS ARE
-------------------------

``research_chartdoc.describe_equity_curve`` applied to the metrics THIS FILE
computed off the generated equity curve — which is exactly the production path,
where the desk computes the metrics in order to draw the figure and then
describes the figure from them. The heatmap has no ``describe_*`` because in
production the sweep's PNG rides on the RUN CARD rather than on a chart
document; its sentence here is built in that card's shape and says so.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

#: Bars per generated series. 1500 is ``BacktestRequest.bars``'s default, so the
#: line density in the PNG matches what the desk renders rather than a sparse
#: curve that would be easier for any encoder to read.
BARS = 1500

#: Annualisation for hourly bars, the interval ``BacktestRequest`` defaults to.
_ANNUAL = math.sqrt(24 * 365)


@dataclass(frozen=True, slots=True)
class BenchDoc:
    """One corpus document: a picture, a sentence, and the family that owns it.

    ``family`` IS the ground truth. It is not stored beside the document as a
    label somebody attached — it is the generator that produced the series, so a
    document cannot disagree with its own answer key.
    """

    id: str
    family: str
    title: str
    description: str
    png_b64: str


@dataclass(frozen=True, slots=True)
class BenchQuery:
    """One question, and the family whose documents answer it.

    Two queries per family, one blunt and one descriptive, because "an equity
    curve with a large drawdown" and "a chart that collapses and then claws its
    way back" are the same question asked by a portfolio manager and by a
    researcher, and an arm that serves one and not the other is a finding rather
    than an average.
    """

    text: str
    family: str


QUERIES: tuple[BenchQuery, ...] = (
    BenchQuery("an equity curve with a large drawdown", "deep_drawdown"),
    BenchQuery("a chart that collapses and then claws its way back", "deep_drawdown"),
    BenchQuery("a strategy that only goes up", "monotonic"),
    BenchQuery("a smooth equity curve rising steadily with almost no dips", "monotonic"),
    BenchQuery("a flat equity curve that goes nowhere", "flat"),
    BenchQuery("a strategy that never made or lost anything", "flat"),
    BenchQuery("a wildly volatile equity curve with violent swings", "volatile"),
    BenchQuery("a jagged chart that lurches up and down", "volatile"),
    BenchQuery("an equity curve that grinds downwards to a loss", "decline"),
    BenchQuery("a strategy that steadily loses money", "decline"),
    BenchQuery("a heatmap grid of parameter combinations", "heatmap"),
    BenchQuery("a coloured grid of squares showing a Sharpe surface", "heatmap"),
)

#: Families in the order the tables print them. Named here rather than derived
#: from ``QUERIES`` so a family with no query is still an obvious gap.
FAMILIES: tuple[str, ...] = (
    "deep_drawdown", "monotonic", "flat", "volatile", "decline", "heatmap",
)


def _series(np, family: str, seed: int):
    """The equity curve for one family and one variant seed.

    Every family is a random walk with a family-specific drift, volatility and
    shock schedule, so variants within a family differ in detail and agree in
    SHAPE — which is what makes "four relevant documents" a meaningful answer
    key rather than four copies of one picture.

    Percentage returns compounded, not a line drawn directly: an equity curve
    the desk draws is a cumulative product, and its visual texture — the way
    volatility widens the band as the level rises — comes from that. Drawing a
    shape and calling it equity would have produced a picture with the wrong
    statistics behind it.
    """
    rng = np.random.default_rng(seed)
    n = BARS
    if family == "deep_drawdown":
        # Up, then a sustained crash over a fifth of the window, then a partial
        # recovery. The drawdown is placed at a seed-dependent point so the four
        # variants do not share one silhouette. Tuned until the printed metrics
        # read like a desk's own bad quarter — around a 40% peak-to-trough and a
        # terminal multiple still above 1 — rather than a wipeout, because a
        # curve that ends at 0.1x is a DIFFERENT shape and would have quietly
        # made this family separable on its terminal number alone.
        drift = np.full(n, 0.0011)
        start = 400 + (seed % 5) * 90
        drift[start:start + 300] = -0.0025
        noise = rng.normal(0, 0.009, n)
    elif family == "monotonic":
        # Positive drift with volatility well under it, so drawdowns exist (a
        # real curve has them) and are never visible at this scale.
        # sigma tuned DOWN to 0.0035 after measuring: at 0.0060 the family's
        # maximum drawdown came out at 11-14%, which is not a curve that "only
        # goes up" and would have made the answer key a lie. The consequence is
        # an annualised Sharpe near 15, which no desk ever sees — and that is
        # accepted rather than fixed, because the SHAPE is the ground truth here
        # and the Sharpe is not part of any query's answer key.
        drift = np.full(n, 0.0006)
        noise = rng.normal(0, 0.0035, n)
    elif family == "flat":
        drift = np.zeros(n)
        noise = rng.normal(0, 0.0010, n)
    elif family == "volatile":
        # NOT a random walk, and this is the one deliberate departure in the
        # file. A high-sigma walk was tried first and MEASURED: at sigma 0.022 a
        # 1500-bar walk has a terminal spread of e^±0.85, so two of the four
        # variants ended near 0.2x and the family stopped being "volatile" and
        # became a second "decline" — with an answer key that then said two
        # visually identical charts belonged to different families, which would
        # have punished BOTH arms for the corpus's mistake rather than measuring
        # either. So volatility here is an OSCILLATION: three seeded sine waves
        # in log space plus noise, which swings hard, reverts, and ends near
        # where it started. That is the shape the query names.
        phases = rng.uniform(0, 2 * math.pi, 3)
        periods = np.array([n / 3.5, n / 7.0, n / 13.0]) * (1.0 + 0.1 * (seed % 4))
        bars = np.arange(n)
        swing = sum(
            amplitude * np.sin(2 * math.pi * bars / period + phase)
            for amplitude, period, phase in zip([0.34, 0.20, 0.12], periods, phases)
        )
        return np.exp(swing - swing[0] + np.cumsum(rng.normal(0, 0.004, n)))
    elif family == "decline":
        drift = np.full(n, -0.0005)
        noise = rng.normal(0, 0.008, n)
    else:
        raise ValueError(f"no series generator for family {family!r}")
    return np.cumprod(1.0 + drift + noise)


def _metrics(np, equity) -> dict[str, float | int]:
    """The figures the desk would have computed in order to draw this chart.

    Computed from the generated series rather than invented, because the
    description arm's whole claim is that these numbers are EXACT — handing it
    approximate ones would have rigged the comparison in the image arm's favour.

    ``max_drawdown`` is a POSITIVE fraction, matching ``ParamResult`` and what
    ``research_chartdoc._pct`` renders as "26.1%".
    """
    returns = np.diff(equity) / equity[:-1]
    peak = np.maximum.accumulate(equity)
    drawdown = float(np.min(equity / peak - 1.0))
    sd = float(np.std(returns))
    sharpe = float(np.mean(returns) / sd * _ANNUAL) if sd > 0 else 0.0
    # A trade is a sign flip in the local slope, smoothed over a day of bars.
    # Not the backtester's own trade count — no signal was run here — and the
    # figure exists only to give the description sentence the field it prints.
    smoothed = np.convolve(returns, np.ones(24) / 24, mode="valid")
    flips = int(np.count_nonzero(np.diff(np.sign(smoothed)) != 0))
    # Exposure is the share of bars a long-only strategy would have been holding
    # — the smoothed slope being positive. The first version counted non-zero
    # returns and printed "100.0% time in market" for all twenty-four documents,
    # which is a field with no information in it pretending to be evidence.
    exposure = float(np.mean(smoothed > 0)) if smoothed.size else 0.0
    return {
        "total_return_x": float(equity[-1] / equity[0]),
        "max_drawdown": abs(drawdown),
        "sharpe": sharpe,
        "trades": max(flips, 1),
        "time_in_market": exposure,
        "cagr": float(equity[-1] / equity[0]) ** (1.0 / (BARS / (24 * 365))) - 1.0,
    }


def _param_result(metrics: dict, fast: int, slow: int):
    from modules.schemas import ParamResult

    return ParamResult(
        fast=float(fast), slow=float(slow),
        total_return=metrics["total_return_x"] - 1.0,
        cagr=metrics["cagr"], sharpe=metrics["sharpe"],
        sortino=metrics["sharpe"] * 1.3, max_drawdown=metrics["max_drawdown"],
        calmar=metrics["sharpe"] * 0.8, win_rate=0.52, trades=int(metrics["trades"]),
        exposure=metrics["time_in_market"], turnover=4.0, fees_paid=120.0,
    )


def _equity_png(np, pd, equity, metrics: dict, seed: int) -> str | None:
    """The desk's real equity figure for this series, base64, or None.

    The benchmark line is its own random walk rather than a copy of the equity
    curve: the figure draws "strategy versus buy and hold", and two identical
    lines would remove a visual element every real chart carries.
    """
    from modules.backtester.plots import plot_equity_curve
    from modules.schemas import BacktestRequest

    rng = np.random.default_rng(seed + 9_000)
    close = 30_000.0 * np.cumprod(1.0 + rng.normal(0.0002, 0.012, len(equity)))
    index = pd.date_range("2024-01-01", periods=len(equity), freq="h")
    frame = pd.DataFrame({"close": close}, index=index)
    best = _param_result(metrics, 10 + seed % 20, 60 + seed % 40)
    return plot_equity_curve(
        frame, equity, best, BacktestRequest(), oos_sharpe=metrics["sharpe"] * 0.7, dsr=0.62,
    )


def _heatmap_png(np, seed: int) -> tuple[str | None, dict]:
    """The parameter Sharpe surface, plus the numbers its run card would state.

    A seed-dependent plateau or isolated peak, so the four heatmap variants are
    four different surfaces rather than four renderings of one grid.
    """
    from modules.backtester.plots import plot_heatmap
    from modules.schemas import BacktestRequest

    rng = np.random.default_rng(seed + 4_000)
    fasts, slows = range(5, 45, 5), range(20, 220, 20)
    peak_f, peak_s = 3 + seed % 3, 4 + seed % 4
    results, sharpes = [], []
    for i, fast in enumerate(fasts):
        for j, slow in enumerate(slows):
            distance = ((i - peak_f) ** 2 + (j - peak_s) ** 2) ** 0.5
            sharpe = 1.9 * math.exp(-distance / (1.4 + seed % 3)) - 0.4 + rng.normal(0, 0.12)
            sharpes.append(sharpe)
            results.append(_param_result(
                {"total_return_x": 1.0 + sharpe / 3, "max_drawdown": 0.18,
                 "sharpe": sharpe, "trades": 40, "time_in_market": 0.55,
                 "cagr": sharpe / 8},
                fast, slow,
            ))
    png = plot_heatmap(results, BacktestRequest())
    numbers = {
        "combinations": len(results),
        "best_sharpe": max(sharpes),
        "worst_sharpe": min(sharpes),
        "positive": sum(1 for s in sharpes if s > 0),
    }
    return png, numbers


def _heatmap_body(numbers: dict) -> str:
    """The run card's sentence for a sweep, in ``research_chartdoc``'s register.

    Not a ``describe_*`` function in that module, and deliberately not added to
    it: in production the heatmap PNG rides on the RUN CARD, not on a chart
    document (``research_image_ingest.RUN_PNG_FIELD``), and inventing a
    ``describe_heatmap`` for a bench would have put a function in the shipped
    module that no ingest path calls.
    """
    return (
        f"Parameter sweep over {numbers['combinations']} fast/slow combinations: "
        f"{numbers['positive']} produce a positive annualised Sharpe, ranging "
        f"{numbers['worst_sharpe']:.2f} to {numbers['best_sharpe']:.2f}."
    )


def build_corpus(variants: int = 4) -> tuple[list[BenchDoc], str | None]:
    """``(documents, reason)`` — the corpus, or why it could not be drawn.

    A named reason and an EMPTY LIST rather than an exception, because a missing
    matplotlib is the same class of event as a missing model: the bench has
    nothing to measure and says so, and the caller decides whether that is a
    failure. Absence is reported here exactly as ``research_image`` reports it.
    """
    try:
        import numpy as np
        import pandas as pd
    except ImportError as exc:
        return [], f"{exc.name} is not installed, so no chart series could be generated"
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return [], (
            "matplotlib is not installed, so the desk's own plotting code cannot "
            "render a chart to embed (pip install matplotlib)"
        )

    from modules.research_chartdoc import describe_equity_curve

    documents: list[BenchDoc] = []
    for family in FAMILIES:
        for variant in range(variants):
            # The family's INDEX, never ``hash(family)``: str hashing is
            # salted per process, so a hash-derived seed would draw a
            # different corpus on every run and make two of this bench's
            # own numbers incomparable for a reason nobody would find.
            seed = FAMILIES.index(family) * 1000 + variant * 17
            doc_id = f"{family}-{variant}"
            if family == "heatmap":
                png, numbers = _heatmap_png(np, seed)
                title, body = "Sharpe surface", _heatmap_body(numbers)
            else:
                equity = _series(np, family, seed)
                metrics = _metrics(np, equity)
                chart_doc = describe_equity_curve(metrics)
                if chart_doc is None:
                    # Unreachable with a generated series that always has a
                    # terminal value — but the module is allowed to refuse, and
                    # a bench that assumed otherwise would crash on the day it
                    # started refusing for a reason worth knowing.
                    return [], f"research_chartdoc declined to describe {doc_id}"
                title, body = chart_doc.title, chart_doc.body
                png = _equity_png(np, pd, equity, metrics, seed)
            if not png:
                return [], (
                    f"the desk's plotting code returned no PNG for {doc_id}; "
                    "matplotlib is present but the figure did not render"
                )
            documents.append(BenchDoc(doc_id, family, title, body, png))
    return documents, None


def relevant_ids(documents: list[BenchDoc], family: str) -> set[str]:
    """The answer key for one family: every document that family generated."""
    return {d.id for d in documents if d.family == family}
