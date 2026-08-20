"""Bootstrap of the terminal book P&L over a horizon.

Split out of ``var.py`` when the two halves stopped fitting in one file. The
seam is the one the file already drew with its own banner comment: the
historical figure replays *one* bad bar out of history, and this resamples
the whole path to a horizon. They share the series they read and nothing
else.

``var.py`` re-exports every public name here — and ``_loss_band``, which
``tests/test_mc_resampler.py`` imports from ``modules.quant_risk.var`` by
that path — so no caller has to know the split happened.
"""

from __future__ import annotations

import math
import random
import zlib
from dataclasses import dataclass
from typing import Sequence

from modules.quant_risk._common import (
    _mean,
)

# --------------------------------------------------------------------------- #
# Monte Carlo — bootstrap of the terminal book P&L over a horizon
#
# A single-horizon VaR answers "how bad is one bad bar". A desk closing a
# position over several bars wants the *distribution of where the book lands*,
# and the honest way to get it without assuming a shape is to resample the days
# the book actually lived through. This is an i.i.d. bootstrap: draw ``horizon``
# daily P&L figures with replacement, sum them into a path, repeat. Its one
# stated limit is that it forgets the ordering — a real drawdown clusters, and a
# resample that treats each day as independent understates a losing streak. That
# is why the number is reported beside the historical figure rather than instead
# of it.
# --------------------------------------------------------------------------- #

#: The two resamplers, named. ``web/lib/mc-distribution.ts`` uses these exact
#: strings for its own ``McResampler`` so a run cannot be called one thing in
#: the chat card and another on the workspace card.
RESAMPLERS = ("iid", "stationary")


@dataclass
class LossBand:
    """One loss quantile of the terminal distribution, positive-as-loss.

    The mirror of ``lossBands`` in ``web/lib/mc-distribution.ts``: the
    confidence asked for, the loss not exceeded at it, and the mean of the tail
    beyond it — the number VaR alone never gives.
    """

    confidence: float
    loss: float
    conditional_loss: float


@dataclass
class MonteCarlo:
    horizon: int
    paths: int
    seed: int
    observations: int
    #: Sorted-ascending terminal cumulative P&L across every simulated path.
    terminal_pnl: tuple[float, ...]
    #: Positive-as-loss, read off the terminal distribution's 5th percentile.
    var95: float
    cvar95: float
    #: Per-step cumulative-P&L percentile bands, each length ``horizon``. The
    #: fan a cone chart draws; p50 is the median path, the outer pair the 5/95.
    p5: tuple[float, ...]
    p25: tuple[float, ...]
    p50: tuple[float, ...]
    p75: tuple[float, ...]
    p95: tuple[float, ...]
    #: Mean block length of the stationary bootstrap, in bars. 1 is an i.i.d.
    #: draw — what this function did exclusively until blocks were added, and
    #: what it still does by default so the figure a desk has been reading does
    #: not change under it. Defaulted, so it sits last.
    mean_block_length: int = 1
    #: Losses at the confidences the caller asked for, in the order asked.
    #: Empty when nobody asked for anything but the default 95, so
    #: ``var95``/``cvar95`` are never a figure wearing a confidence it was not
    #: computed at. Same convention as ``lossBands`` in the TypeScript.
    loss_bands: tuple[LossBand, ...] = ()

    @property
    def resampler(self) -> str:
        """Which resampler drew these paths, derived rather than remembered.

        A block of 1 bar is the i.i.d. draw and anything longer is the
        stationary bootstrap. ``mcResamplerOf`` in
        ``web/lib/mc-distribution.ts`` derives its answer from the identical
        rule over the identical field, so the two stacks cannot name one run
        two different things — the table both are held to is
        ``web/tests/fixtures/mc-resampler-parity.json``.
        """
        return "iid" if self.mean_block_length <= 1 else "stationary"

    def loss_at(self, confidence: float) -> LossBand:
        """The loss not exceeded at ``confidence``, off the drawn distribution.

        :attr:`loss_bands` answers this for the confidences the caller thought
        to ask for *before* the paths were drawn. Afterwards there was no way
        to ask at all short of re-running the simulation, even though the
        terminal distribution is right here and the rule is a pure read of it.

        Same rule, same function, as the bands the run was built with — so a 99
        asked for here and a 99 asked for up front cannot disagree.
        """
        return _loss_band(self.terminal_pnl, confidence)


def _nearest_rank(sorted_values: Sequence[float], q: float) -> float:
    """The value some observation actually took — the same nearest-rank rule
    ``metrics._quantile`` and both TypeScript stacks use, so no two percentiles
    in this repo are computed two different ways."""
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, max(0, math.ceil(q * len(sorted_values)) - 1))
    return sorted_values[index]


def derived_block_length(observations: int) -> int:
    """The √N block-length heuristic, clamped to 5..100 bars.

    The same rule as the workspace's equity band and its terminal-distribution
    card, spelled ``floor(x + 0.5)`` rather than :func:`round` because Python
    rounds halves to even and ECMAScript rounds them up — a difference no
    integer square root can actually reach, written out so the two stacks stay
    provably one rule rather than two that happen to agree.
    """
    return min(100, max(5, math.floor(math.sqrt(max(0, observations)) + 0.5)))


def _loss_band(sorted_terminal: Sequence[float], confidence: float) -> LossBand:
    """The loss not exceeded at ``confidence``, and the mean of the tail past it.

    Nearest-rank on the (100 − C)th percentile, negated — the identical rule to
    ``loss`` in ``web/lib/mc-distribution.ts``, so a confidence changed on one
    side moves the same number the same way on the other.
    """
    clamped = min(99.99, max(0.01, float(confidence)))
    # ``(100 - C) / 100``, not ``1 - C / 100``: at C = 95 the first is the
    # double 0.05 that this function's tail index has always been computed
    # from, and the second is 0.05000000000000004, which is a different
    # ``ceil`` for some path counts. The TypeScript takes the same route.
    k = max(1, math.ceil((100.0 - clamped) / 100.0 * len(sorted_terminal)))
    tail = sorted_terminal[:k]
    return LossBand(
        confidence=clamped,
        loss=-sorted_terminal[k - 1],
        conditional_loss=-_mean(tail),
    )


def _resolve_resampler(
    mean_block_length: int | None,
    resampler: str | None,
) -> tuple[str, int | None]:
    """Settle the resampler and the block length asked for, or refuse.

    They are one decision made through two arguments, so they are read
    together: an unspecified resampler is inferred from the block length, and a
    pair that contradicts each other raises instead of one silently winning —
    a run that quietly used the other resampler is the one thing no card could
    report afterwards. Returns the resampler and the block length asked for,
    ``None`` meaning "derive it".
    """
    if resampler is not None and resampler not in RESAMPLERS:
        raise ValueError(f"resampler must be one of {RESAMPLERS}, not {resampler!r}")
    asked = None if mean_block_length is None else int(mean_block_length)
    # Unspecified on both sides is the i.i.d. draw this function has always
    # made. Unspecified on one side takes its answer from the other: a block
    # length says which resampler, and a resampler says how to fill in the
    # block length.
    chosen = resampler or ("stationary" if asked is not None and asked != 1 else "iid")
    if chosen == "iid" and asked is not None and asked != 1:
        raise ValueError(
            "an i.i.d. bootstrap draws no blocks, so a mean block of "
            f"{asked} bars cannot be honoured — ask for the stationary "
            "bootstrap, or leave the block length out"
        )
    if chosen == "stationary" and asked == 1:
        raise ValueError(
            "a mean block of 1 bar is the i.i.d. draw, not a stationary "
            "bootstrap — ask for the i.i.d. resampler, or a block above 1 bar"
        )
    return chosen, asked


def bootstrap_terminal_distribution(
    book_returns_usd: Sequence[float],
    horizon: int,
    *,
    paths: int = 2000,
    seed: int | None = None,
    mean_block_length: int | None = None,
    resampler: str | None = None,
    loss_confidences: Sequence[float] | None = None,
) -> MonteCarlo | None:
    """I.i.d. bootstrap of the book's cumulative P&L ``horizon`` bars out.

    ``book_returns_usd`` is the book's realised per-bar P&L in dollars — the
    same series ``historical_var`` replays, so the Monte Carlo and the
    historical VaR are resampling one distribution rather than two. Each of
    ``paths`` simulations draws ``horizon`` of those figures with replacement
    and accumulates them; the terminal values become the P&L distribution and
    the per-step percentiles become the cone.

    Returns ``None`` below 60 observations: a bootstrap cannot manufacture tail
    shape a short sample never showed, and a cone drawn from a dozen days would
    give false confidence to noise.

    ``resampler`` selects the draw: ``"iid"`` or ``"stationary"``. Left unsaid
    it is inferred from ``mean_block_length`` — a block of 1 is the i.i.d.
    draw, anything longer the stationary bootstrap — so every call written
    before this argument existed still means what it meant. The result says
    which one ran through :attr:`MonteCarlo.resampler`, derived from the block
    length it actually used rather than echoed back from the request.

    ``web/lib/mc-distribution.ts`` takes the same argument, with the same two
    names and the same refusals. Its *unstated* default is the other one — the
    derived block, because that is the draw the workspace card has always shown
    as this one is the draw the chat card has always shown — so a caller who
    cares which resampler ran names it, and naming it gives the same resampler
    on both sides.

    ``mean_block_length`` left unsaid takes its answer from the resampler:
    i.i.d. is a block of one bar, and the stationary bootstrap derives the √N
    heuristic — :func:`derived_block_length`, the same value the workspace card
    defaults to. Say neither and the draw is the i.i.d. one this function did
    exclusively until blocks were added, so the figure a desk has been reading
    does not change under it.

    Above 1 the draw is the stationary bootstrap (Politis & Romano 1994):
    blocks of geometric length with the given expected size, which is the same
    resampler the workspace's equity band uses. That matters because the two
    sides otherwise answer the same question with different methods and neither
    says so.

    A contradiction between the two arguments — i.i.d. with a block longer than
    one bar, or a stationary bootstrap with a block of exactly one — raises
    rather than picking a winner silently, because a run that quietly used the
    other resampler is the one thing neither card could report afterwards.

    ``loss_confidences`` reports extra loss quantiles in :attr:`loss_bands`,
    e.g. ``(90, 99, 99.9)``. ``var95``/``cvar95`` are always the 95 figure and
    keep their names; ask for 95 and the band is that same number.

    The method's limit, stated plainly, and it is the reason blocks exist:
    an i.i.d. draw has **no volatility clustering**. It assumes each future bar
    is an independent draw from the past, which understates a sustained
    drawdown where losses arrive in runs. Report either beside the historical
    figure, never as a replacement.

    ``seed`` defaults to ``zlib.crc32`` of the input series, so a refresh with
    the same book redraws the same cone — reproducible without a stored state.
    """
    chosen, asked_block = _resolve_resampler(mean_block_length, resampler)

    usable = [float(value) for value in book_returns_usd if value is not None and value == value]
    if len(usable) < 60 or horizon < 1:
        return None
    horizon = int(min(horizon, 60))
    paths = int(max(200, min(paths, 20_000)))

    if seed is None:
        payload = ",".join(f"{value:.6g}" for value in usable).encode("utf-8")
        seed = zlib.crc32(payload)
    rng = random.Random(seed)

    # Column t across every path, so a percentile can be read per step. Bounded
    # memory: horizon <= 60 and paths <= 20k.
    steps: list[list[float]] = [[] for _ in range(horizon)]
    terminal: list[float] = []
    n = len(usable)
    # The block length the run will report: 1 for the i.i.d. draw, the asked-for
    # length when there is one, otherwise the √N heuristic. Clamped to the
    # sample, because a block longer than the history is a block that cannot be
    # drawn.
    wanted = 1 if chosen == "iid" else (asked_block if asked_block is not None else derived_block_length(n))
    block = max(1, min(wanted, max(1, n)))

    if block == 1:
        # The i.i.d. draw, UNCHANGED, and separated on purpose.
        #
        # The block loop below consumes two rng values per step (a uniform to
        # decide whether to start a block, then an index) where this consumes
        # one. Routing block == 1 through it would therefore produce a
        # different sequence for the same seed — every existing Monte Carlo
        # figure would move, silently, with no code that looks like it changed
        # a number. The default must stay bit-for-bit what it was.
        for _ in range(paths):
            running = 0.0
            for t in range(horizon):
                running += usable[rng.randrange(n)]
                steps[t].append(running)
            terminal.append(running)
    else:
        # Stationary bootstrap: with probability 1/block start a new block at a
        # uniform position, otherwise continue sequentially and wrap, so
        # end-of-sample bars are not under-drawn. The same convention — and the
        # same two-draws-per-step order — as lib/montecarlo.ts.
        p_new = 1.0 / block
        for _ in range(paths):
            running = 0.0
            cursor = rng.randrange(n)
            for t in range(horizon):
                if t > 0:
                    cursor = rng.randrange(n) if rng.random() < p_new else (cursor + 1) % n
                running += usable[cursor]
                steps[t].append(running)
            terminal.append(running)

    terminal.sort()
    # The 95 figure keeps its own name and its own field; the requested
    # confidences, if any, are read through the same rule so a 99 loss and the
    # 95 loss cannot be computed two different ways.
    at95 = _loss_band(terminal, 95.0)
    bands = tuple(_loss_band(terminal, c) for c in (loss_confidences or ()))

    def band(q: float) -> tuple[float, ...]:
        return tuple(_nearest_rank(sorted(column), q) for column in steps)

    return MonteCarlo(
        horizon=horizon,
        paths=paths,
        seed=int(seed),
        observations=n,
        mean_block_length=block,
        loss_bands=bands,
        terminal_pnl=tuple(terminal),
        var95=at95.loss,
        cvar95=at95.conditional_loss,
        p5=band(0.05),
        p25=band(0.25),
        p50=band(0.50),
        p75=band(0.75),
        p95=band(0.95),
    )
