"""Seven series whose SHAPE is an instruction, not a judgement.

``web/lib/retrieval-eval.ts`` refuses to commit an answer key for the live
corpus, and it is right to: "a fabricated answer key produces a figure that
looks like evidence and is not". That refusal is about labels invented over
documents somebody else wrote. Here the arrow runs the other way. This module
CONSTRUCTS the series, so "that is the chart with the deep drawdown" is not an
opinion about a picture — it is the instruction the picture was drawn from. The
answer key sits UPSTREAM of the corpus, which is the one arrangement in which a
synthetic evaluation is evidence rather than decoration.

Every builder below returns ``(returns, position)``: the per-bar strategy return
and the in-market mask that produced it. Both, because
``backtester.engines._stats_from_returns`` wants both — exposure and the trade
count are properties of the POSITION, and a bench that passed a made-up
exposure would put a fabricated number in a description the description arm is
then scored on.

``tools/bench_image_retrieval_corpus.py`` turns these into documents;
``tests/test_research_image_eval.py`` asserts that each series really has the
property its answer key claims, so the key is verified rather than asserted.

A NOTE ON THE SHARPE FIGURES, WHICH ARE NOT PLAUSIBLE DESK NUMBERS
--------------------------------------------------------------------

A path that is monotone by construction has almost no return variance, and an
annualised Sharpe is mean over standard deviation. So the monotonic riser
reports a Sharpe no desk has ever seen. That is not a bug to be tuned away: it
is what "monotone" MEANS once you take its Sharpe, and hiding it would mean
adding losing bars to a series whose ground truth is that it has none. Every
figure here is an exact property of the series drawn; none is a forecast.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

#: Bars per series. ``BacktestRequest``'s own default, so the charts are the
#: width the desk actually draws rather than a width chosen to render fast.
BARS = 1500

#: The parameter grid every sweep reports. ``BacktestRequest``'s defaults again:
#: 8 fast values by 10 slow values, 80 combinations, which is the number the
#: deflated Sharpe is deflated BY.
GRID_FAST = tuple(float(v) for v in range(5, 41, 5))
GRID_SLOW = tuple(float(v) for v in range(20, 201, 20))

#: One seed per series, fixed. Reproducibility is the whole point of a bench —
#: a corpus that redrew itself on every run would move every number in the
#: table and nobody could tell a real change from the weather.
SEED = 20260822


def blocks(episodes: int) -> np.ndarray:
    """A position series: in market for 85% of each of ``episodes`` blocks.

    Real equity curves have flat stretches because the strategy is in cash, and
    a corpus of curves that are never flat would be a corpus of a shape this
    desk does not draw. The pattern is deterministic rather than random so the
    trade count and the exposure on every card are reproducible.
    """
    position = np.zeros(BARS)
    span = BARS // episodes
    for start in range(0, BARS, span):
        position[start:start + int(span * 0.85)] = 1.0
    return position


def riser(rng: Any) -> tuple[np.ndarray, np.ndarray]:
    """Monotone by construction: every in-market bar return is strictly positive.

    Not "mostly rising". The uniform draw's lower bound is above zero, so there
    is no bar on which this curve falls and no drawdown for it to recover from.
    That is what makes "the one that rises steadily" an instruction rather than
    an impression — and what makes its Sharpe absurd, see the module docstring.
    """
    position = blocks(6)
    return (0.00060 + rng.uniform(0.0, 0.00045, BARS)) * position, position


def spike_plateau(rng: Any) -> tuple[np.ndarray, np.ndarray]:
    """The case ``research_image.py`` names: same terminal multiple, other shape.

    Its docstring argues the arm's whole reason for existing with this pair —
    "one steady climb versus the same terminal multiple reached by a spike and a
    long flat plateau, which describe identically and answer different
    questions". So the pair is built and both are put in the corpus. The plateau
    is EXACTLY flat because the strategy is out of the market for it, which is
    why the position mask here is explicit rather than a block pattern.
    """
    position = np.zeros(BARS)
    position[:100] = 1.0
    return (0.0100 + rng.uniform(0.0, 0.0012, BARS)) * position, position


def deep_drawdown(rng: Any) -> tuple[np.ndarray, np.ndarray]:
    """Up to ~1.85x, down to ~0.7x, back to ~1.15x. Three log-linear segments.

    Log-linear rather than a random walk that happened to crash: a drawdown of a
    designed depth is a drawdown a query can be written against. The noise is
    added on top so the curve reads as a price series rather than three straight
    lines, and it is small enough that the depth survives it — which
    ``tests/test_research_image_eval.py`` asserts rather than assumes.
    """
    position = blocks(12)
    drift = np.zeros(BARS)
    drift[:500] = math.log(1.85) / (500 * 0.85)
    drift[500:900] = math.log(0.70 / 1.85) / (400 * 0.85)
    drift[900:] = math.log(1.15 / 0.70) / (600 * 0.85)
    return (np.expm1(drift) + rng.normal(0.0, 0.0060, BARS)) * position, position


def volatile(rng: Any) -> tuple[np.ndarray, np.ndarray]:
    """Large regular swings around a flat terminal value.

    A slow sine dominates the noise, so the swings are VISIBLE at chart scale
    rather than being the jitter every series has. The distinction the answer
    key relies on is between a curve that swings and one that trends, and a
    volatility that only shows up in the standard deviation would not draw.
    """
    position = blocks(20)
    # Amplitude chosen so the SWING is the story: a half cycle of 110 bars at
    # this amplitude is a ~20% excursion, which draws as a wave. The first
    # version used 0.0125 and produced a 62% drawdown — indistinguishable in
    # both the picture and the description from the deep-drawdown case, which
    # would have made two answer-key entries answer each other's questions.
    swing = 0.0030 * np.sin(2.0 * np.pi * np.arange(BARS) / 220.0)
    return (swing + rng.normal(0.0, 0.0040, BARS)) * position, position


def flat_line(rng: Any) -> tuple[np.ndarray, np.ndarray]:
    """A line that goes nowhere: in market throughout, doing nothing.

    The noise is not zero, and that is deliberate. A series of exact zeros has
    no return variance, and ``_annualised_sharpe`` answers 0.0 to that — a
    number that reads as measured when it is undefined. Keeping the series
    faintly alive keeps every figure on this card a real quotient.
    """
    position = np.ones(BARS)
    return rng.normal(0.0, 0.00004, BARS), position


def moderate(rng: Any) -> tuple[np.ndarray, np.ndarray]:
    """An unremarkable winning run. The two sweep cards' own numbers.

    Those two documents are in the corpus for their HEATMAPS; their text is the
    run card. Giving them a distinctive equity shape as well would put a second
    ground-truth property on a document whose picture cannot show it.
    """
    position = blocks(9)
    return (0.00022 + rng.normal(0.0, 0.0040, BARS)) * position, position


def surface(kind: str, peak: float) -> np.ndarray:
    """The annualised Sharpe of every grid cell, as a designed shape.

    Two shapes, and they are the two the heatmap's own title argues about: "A
    smooth plateau is a robust parameter region; an isolated peak is an
    overfit." Those are the only claims a Sharpe surface makes that a SENTENCE
    on this desk does not, because ``research_chartdoc`` has no renderer for a
    surface — ``research_image_ingest`` records that gap as owed work. So these
    two documents are the image arm's best case in the whole corpus, by
    construction, and the per-query table is where that shows.

    Both surfaces are scaled so their maximum is the run's own Sharpe, which
    keeps the picture and the card telling one story: the best cell of the grid
    IS the run being described.
    """
    fast = np.array(GRID_FAST)[:, None]
    slow = np.array(GRID_SLOW)[None, :]
    # A deterministic ripple rather than a random one, for the reason the seed
    # exists: a surface that redrew itself would move the DSR on every card.
    ripple = np.sin(fast / 3.0) * np.cos(slow / 37.0)
    if kind == "plateau":
        # Negative corners on purpose: the colourmap is diverging around a
        # meaningful zero, and an all-positive surface would render as one hue
        # and lose the property the reader is being asked to see.
        z = 1.3 * np.exp(-((fast - 20.0) ** 2 / 420.0 + (slow - 120.0) ** 2 / 14000.0)) - 0.3
        z = z + 0.05 * ripple
    else:
        z = 0.25 * ripple
        z[GRID_FAST.index(15.0), GRID_SLOW.index(140.0)] = 1.0
    return z / z.max() * peak
