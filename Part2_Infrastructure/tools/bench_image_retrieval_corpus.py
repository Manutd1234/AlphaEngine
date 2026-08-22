"""Seven sweeps, seven documents, and the answer key they were built for.

``tools/bench_image_retrieval_series.py`` designs the series; this file turns
each one into the document the corpus would actually hold, and states which
document answers which question.

EVERY DOCUMENT IS RENDERED BY THE SHIPPED CODE
-----------------------------------------------

Nothing here writes a description. ``research_cards.render_backtest_documents``
produces the documents, ``research_chartdoc`` writes their sentences from
``_chart_metrics``, ``backtester.engines._stats_from_returns`` computes the
figures those sentences quote, ``backtester.plots`` draws the PNGs and
``backtester.statistics.deflated_sharpe_ratio`` deflates the Sharpe printed on
them — called the way ``backtester/run.py`` calls it, per-observation Sharpes
and all. A bench that hand-wrote its own descriptions would be measuring a
corpus this desk does not have, and would flatter or punish the description arm
according to how well the author wrote that morning.

WHY EVERY DOCUMENT CARRIES AN IMAGE
------------------------------------

A completed sweep produces four documents and at most two of them get a PNG:
``research_image_ingest`` maps the ``equity_curve`` document to
``equity_curve_png`` and the RUN CARD to ``heatmap_png``, and says at length why
the drawdown and walk-forward documents get nothing. A corpus holding those
text-only documents would measure the image arm's COVERAGE — it cannot rank
what it has no vector for — when the question under test is its QUALITY. So the
corpus keeps only documents with a picture, and coverage is left where it
belongs: in ``research_image_arm``, whose fusion adds candidates and can never
remove one, so a text-only document is never displaced by this arm in
production.

ONE DOCUMENT PER SWEEP, AND THAT IS DELIBERATE
-----------------------------------------------

A run card and its own equity-curve description quote the SAME Sharpe, return
and drawdown in two formats. Indexing both would put a near-duplicate in a
seven-document corpus, and the description arm would spend a top slot on it —
a confound that says nothing about vision and would make the headline
comparison unreadable. So each sweep contributes the one document whose picture
was drawn.

THE ATTACHMENT IS DONE HERE RATHER THAN THROUGH ``attach_chart_pngs``
----------------------------------------------------------------------

That function is correctly gated on ``research_image.configured()`` — it MUST be
a no-op on a deployment that never asked for image search, or the writer sends
three columns a pre-migration schema does not have and dead-letters the whole
corpus. But this builder has to work with NO MODEL CONFIGURED, because
``tests/test_research_image_eval.py`` verifies the answer key and may not
download 0.6 GB of weights to do it. So the mapping CONSTANTS are imported from
``research_image_ingest`` rather than restated — one place still decides which
document gets which figure — and only the gate is bypassed.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from modules.backtester._common import bars_per_year
from modules.backtester.engines import _stats_from_returns
from modules.backtester.plots import plot_equity_curve, plot_heatmap
from modules.backtester.statistics import deflated_sharpe_ratio
from modules.research_cards import render_backtest_documents
from modules.research_image_ingest import CHART_PNG_FIELDS, IMAGE_PNG_FIELD, RUN_PNG_FIELD
from modules.schemas_backtest import BacktestRequest, ParamResult
from tools.bench_image_retrieval_series import (
    BARS,
    GRID_FAST,
    GRID_SLOW,
    SEED,
    deep_drawdown,
    flat_line,
    moderate,
    riser,
    spike_plateau,
    surface,
    volatile,
)


@dataclass(frozen=True, slots=True)
class ChartCase:
    """One document as the corpus holds it: a body, a picture, and its id."""

    id: str
    kind: str
    title: str
    body: str
    png_b64: str
    #: The ground-truth property, in the words the answer key is built from.
    shape: str


#: Where each designed surface has its maximum — imported into the run card as
#: the winning parameter pair, so ``best_fast``/``best_slow`` and the brightest
#: cell of the heatmap are the same cell rather than two independent claims.
PEAK_CELL = {"plateau": (20.0, 120.0), "peak": (15.0, 140.0)}


@dataclass(frozen=True, slots=True)
class _Sweep:
    """One synthetic run. Every field here is an instruction to the renderers.

    ``slug`` is the BENCH's name for the sweep and the answer key's; ``job_id``
    below is the DESK's, and they are deliberately different strings. See
    ``_job_id``.
    """

    slug: str
    symbol: str
    interval: str
    strategy: str
    build: Any
    surface: str
    figure: str
    shape: str


#: The corpus, as instructions. Symbols and strategies differ across sweeps
#: because a real corpus does: seven documents whose titles were identical would
#: hand the lexical half of any text retriever nothing to work with, and would
#: make the description arm look worse for a reason that is the bench's fault.
SWEEPS = (
    _Sweep("deep_drawdown", "BTCUSDT", "1h", "ma_cross", deep_drawdown, "plateau",
           "equity", "an equity curve that loses most of its value and part-recovers"),
    _Sweep("steady_riser", "ETHUSDT", "4h", "ema_cross", riser, "plateau",
           "equity", "an equity curve that rises on every single bar"),
    _Sweep("spike_plateau", "SOLUSDT", "1h", "donchian", spike_plateau, "plateau",
           "equity", "an equity curve that doubles in one early burst then is exactly flat"),
    _Sweep("flat_line", "XRPUSDT", "1d", "rsi_reversion", flat_line, "plateau",
           "equity", "an equity curve that never moves"),
    _Sweep("volatile", "DOGEUSDT", "15m", "bollinger_breakout", volatile, "plateau",
           "equity", "an equity curve of large regular swings around a flat finish"),
    _Sweep("broad_plateau", "ADAUSDT", "1h", "macd_cross", moderate, "plateau",
           "heatmap", "a Sharpe surface that is one broad smooth plateau"),
    _Sweep("isolated_peak", "LINKUSDT", "4h", "momentum", moderate, "peak",
           "heatmap", "a Sharpe surface that is one isolated cell surrounded by noise"),
)

#: The answer key. Nine questions, each naming the documents that ANSWER it.
#:
#: Queries 6 and 7 are the image arm's best case in the corpus and are here
#: because of that, not in spite of it: no ``ChartDoc`` describes a Sharpe
#: SURFACE — ``research_image_ingest`` records that gap as owed work — so the
#: description arm cannot answer them from anything but the run card's numbers,
#: and only a look at the picture can tell a plateau from a spike. If the image
#: arm wins nowhere else, it should win here, and a table in which it does not
#: is a much stronger result than one in which it never had the chance.
#:
#: Query 9 is the mirror image: a question purely about a COMPUTED number,
#: where the description is exact and pixels can only estimate.
QUERIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("an equity curve with a deep drawdown that loses most of its value before recovering",
     ("deep_drawdown:equity_curve",)),
    ("an equity curve that rises steadily and smoothly the whole way with no setback",
     ("steady_riser:equity_curve",)),
    ("an equity curve that jumps early and then sits flat on a long plateau",
     ("spike_plateau:equity_curve",)),
    ("a flat equity curve that goes nowhere and barely moves at all",
     ("flat_line:equity_curve",)),
    ("a violently volatile equity curve with large swings up and down",
     ("volatile:equity_curve",)),
    ("a parameter sweep whose sharpe surface is a broad smooth plateau of stable cells",
     ("broad_plateau",)),
    ("a parameter sweep whose sharpe surface is one isolated peak surrounded by poor cells",
     ("isolated_peak",)),
    ("a heatmap of annualised sharpe across fast and slow parameter combinations",
     ("broad_plateau", "isolated_peak")),
    ("an equity curve that more than doubled, ending above twice its starting value",
     ("steady_riser:equity_curve", "spike_plateau:equity_curve")),
)


@dataclass(slots=True)
class _Result:
    """What ``render_backtest_documents`` reads. Duck-typed on purpose.

    A real ``BacktestResult`` carries forty fields this bench has no honest way
    to fill, and filling them would put invented numbers one attribute away from
    the description arm's input. This object carries exactly what the renderers
    READ and nothing else, so anything they start reading tomorrow fails loudly
    here instead of quietly defaulting.
    """

    request: BacktestRequest
    best: ParamResult
    engine: str
    combos_tested: int
    deflated_sharpe_ratio: float
    walk_forward_oos_sharpe: float | None
    pbo: float | None
    data_hash: str
    job_id: str
    benchmark_buy_hold: dict[str, float]
    walk_forward: tuple[Any, ...]
    equity_curve_png: str | None
    heatmap_png: str | None


def _job_id(slug: str) -> str:
    """An OPAQUE job id, and this is a correction rather than a decoration.

    The first version of this corpus used the answer key's own slug as the job
    id, and ``render_backtest_card`` prints ``Job:`` and ``Data hash:`` into the
    body it embeds. So the two run cards carried the literal strings
    "broad_plateau" and "isolated_peak" — the exact words of the two queries
    that exist BECAUSE no sentence on this desk describes a Sharpe surface. The
    description arm scored 1st on both, and it was reading the answer off the
    document. The measured table said the image arm added nothing on precisely
    the two questions it was built for.

    A real ``job_id`` is a UUID and a real ``data_hash`` is a digest, so the
    honest fix is to make these opaque the way production's are. Derived from
    the slug rather than random so the corpus is still reproducible.
    """
    return hashlib.sha256(slug.encode()).hexdigest()[:16]


def _market(rng: Any) -> pd.DataFrame:
    """The buy-and-hold line every equity chart is drawn against.

    A real price series rather than a constant, because ``plot_equity_curve``
    draws it and the y-axis is scaled to hold both lines: against a flat
    benchmark a flat strategy would autoscale until its own noise filled the
    panel, and the one chart whose ground truth is "this line does not move"
    would be the most dramatic picture in the corpus.
    """
    returns = rng.normal(0.00025, 0.0075, BARS)
    close = 20000.0 * np.cumprod(1.0 + returns)
    index = pd.date_range("2024-01-01", periods=BARS, freq="h", tz="UTC")
    return pd.DataFrame({"close": close}, index=index)


def _param_result(stats: dict[str, float], fast: float, slow: float) -> ParamResult:
    return ParamResult(fast=fast, slow=slow, **stats)


def _grid(sweep: _Sweep, peak: float) -> list[ParamResult]:
    """The 80 cells of the sweep, as the heatmap and the DSR read them.

    A CELL HERE IS A SHARPE AND NOTHING ELSE, and the zeros in the other fields
    are structural rather than measured. The surface is designed, so a cell has
    no equity path and therefore no return, drawdown or trade count to report.
    ``ParamResult`` requires those fields; ``plot_heatmap`` reads ``fast``,
    ``slow`` and ``sharpe`` and nothing else, and no value from this object
    reaches any description, any card or any number this bench prints. The
    rejected alternative was generating 80 synthetic equity paths per sweep so
    every field is real: it would multiply the corpus build by eighty and change
    no pixel of the heatmap, which is drawn from the Sharpe surface alone.
    """
    values = surface(sweep.surface, peak)
    return [
        ParamResult(
            fast=fast, slow=slow, sharpe=float(values[i][j]),
            total_return=0.0, cagr=0.0, sortino=0.0, max_drawdown=0.0, calmar=0.0,
            win_rate=0.0, trades=0, exposure=0.0, turnover=0.0, fees_paid=0.0,
        )
        for i, fast in enumerate(GRID_FAST)
        for j, slow in enumerate(GRID_SLOW)
    ]


def _build(sweep: _Sweep, rng: Any) -> tuple[_Result, np.ndarray, list[ParamResult], Any]:
    """One sweep: its series, its statistics, its grid and its deflated Sharpe.

    ``_stats_from_returns`` and ``deflated_sharpe_ratio`` are the desk's own,
    called the way ``backtester/run.py`` calls them — including the
    de-annualisation of the candidate Sharpes, which is the step an
    implementation of this by hand would get wrong and never notice.
    """
    returns, position = sweep.build(rng)
    ann = bars_per_year(sweep.interval)
    equity = np.cumprod(1.0 + returns)
    # One in-market episode is one trade, and a winning one is one whose
    # episode ended above where it started. Counted off the position mask rather
    # than assumed, because `win_rate` on the card is a quotient of these two.
    entries = np.flatnonzero(np.diff(np.r_[0.0, position]) > 0)
    exits = np.flatnonzero(np.diff(np.r_[position, 0.0]) < 0)
    wins = sum(1 for a, b in zip(entries, exits, strict=True) if equity[b] > equity[max(a - 1, 0)])
    stats = _stats_from_returns(
        returns, position, float(len(entries)), 0.0, ann, len(entries), wins,
    )
    # The best cell IS the peak of this sweep's surface, so the card and the
    # picture tell one story: "best 20/120" names the cell the heatmap's
    # plateau is centred on rather than an unrelated pair of numbers.
    best = _param_result(stats, *(PEAK_CELL[sweep.surface]))

    grid = _grid(sweep, best.sharpe)
    sr = float(returns.mean() / returns.std(ddof=1)) if returns.std(ddof=1) > 0 else 0.0
    candidates = np.array([r.sharpe / math.sqrt(ann) for r in grid])
    series = pd.Series(returns)
    dsr, _psr, _expected = deflated_sharpe_ratio(
        candidates, sr, len(returns), float(series.skew() or 0.0),
        float((series.kurtosis() or 0.0) + 3.0),
    )
    market = _market(rng)
    request = BacktestRequest(
        symbol=sweep.symbol, interval=sweep.interval, strategy=sweep.strategy,
        # Frictionless BY CONSTRUCTION, which is why `fees_paid` above is exactly
        # 0.0 rather than a missing number written as one. A synthetic series has
        # no turnover to charge against.
        fee_bps=0.0, slippage_bps=0.0, walk_forward=False,
    )
    benchmark = float(market["close"].iloc[-1] / market["close"].iloc[0] - 1.0)
    result = _Result(
        request=request, best=best, engine="numpy", combos_tested=len(grid),
        deflated_sharpe_ratio=dsr,
        # None, not 0.0: walk-forward was not run on these series, and the run
        # card prints "not computed" for exactly this reason.
        walk_forward_oos_sharpe=None, pbo=None,
        data_hash=f"sha256:{_job_id(sweep.slug)}", job_id=_job_id(sweep.slug),
        benchmark_buy_hold={"total_return": benchmark}, walk_forward=(),
        equity_curve_png=None, heatmap_png=None,
    )
    return result, equity, grid, market


def build_corpus(seed: int = SEED) -> tuple[list[ChartCase] | None, str | None]:
    """Every document in the corpus, or ``(None, reason)``. Never raises.

    ``seed`` moves the NOISE and nothing else: every designed property — the
    monotone riser's positive bars, the drawdown's depth, the plateau's
    flatness, the surface shapes — is structural and survives any seed. That is
    what makes ``--corpus-seed`` a robustness check rather than a knob. Nine
    queries over seven documents is a small enough sample that one rank
    position moves the headline by 0.03, so a conclusion that only holds on one
    draw is not a conclusion, and this is how a reader tests that.

    The reason is the product on the failure path, the way it is everywhere else
    in this package. ``plot_equity_curve`` answers ``None`` when matplotlib is
    absent — it catches the ImportError itself and logs it — so an absent
    plotting stack arrives here as a missing PNG, and a bench that treated that
    as an empty corpus would report "the image arm scores 0.000" for a machine
    that simply has no matplotlib. Named instead, and exit 0 above.
    """
    rng = np.random.default_rng(seed)
    cases: list[ChartCase] = []
    for sweep in SWEEPS:
        result, equity, grid, market = _build(sweep, rng)
        if sweep.figure == "equity":
            result.equity_curve_png = plot_equity_curve(
                market, equity, result.best, result.request, None, result.deflated_sharpe_ratio,
            )
            png = result.equity_curve_png
        else:
            result.heatmap_png = plot_heatmap(grid, result.request)
            png = result.heatmap_png
        if not png:
            return None, (
                f"the {sweep.figure} figure for {sweep.slug} did not render; matplotlib is "
                "probably not installed, so there are no chart images to embed"
            )
        for document in render_backtest_documents(result, occurred_at="2026-08-22T00:00:00+00:00"):
            field = (
                RUN_PNG_FIELD if document["kind"] == "backtest_run"
                else CHART_PNG_FIELDS.get(str((document.get("metrics") or {}).get("chart") or ""))
            )
            attached = getattr(result, field, None) if field else None
            if not attached:
                continue
            document[IMAGE_PNG_FIELD] = attached
            chart = str((document.get("metrics") or {}).get("chart") or "")
            cases.append(ChartCase(
                # The bench's own id, NOT ``source_ref`` — see ``_job_id``. The
                # answer key must be able to name a document without that name
                # being a token inside it.
                id=f"{sweep.slug}:{chart}" if chart else sweep.slug,
                kind=document["kind"], title=document["title"],
                body=document["body"], png_b64=attached, shape=sweep.shape,
            ))
    if not cases:
        return None, "no document in the corpus carries an image, so there is nothing to compare"
    return cases, None
