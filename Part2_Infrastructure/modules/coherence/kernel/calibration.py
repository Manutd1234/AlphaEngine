"""Were the prices right? Scoring a corpus of settled markets against outcomes.

Coherence is an internal property: a price vector can be perfectly coherent and
perfectly wrong, because nothing in a Dutch-book test compares a price to the
world. This module makes the other comparison. Given forecasts that have since
settled, it asks whether contracts priced at 30 cents happened about 30 % of the
time, and decomposes the answer.

**The Brier score and Murphy's decomposition.** The mean squared error of a
probability forecast splits into three terms that are worth separating because
they fail for different reasons and are fixed by different things:

    Brier = Reliability - Resolution + Uncertainty + Binning

*Reliability* is the average squared gap between what a bin was priced at and
how often it happened. Zero is perfect; it is the only term a recalibration can
repair, and ``isotonic_map`` below is that repair.

*Resolution* is how far the bins' outcome rates spread away from the base rate —
how much the forecasts actually discriminated. It enters with a minus sign, so
it is the term you want large. A forecaster who quotes the base rate on every
market is perfectly reliable and useless, and only this term notices.

*Uncertainty* is ``o(1-o)``, a property of the question, not the forecaster.
Coin-flip markets score worse than near-certain ones no matter who prices them,
which is why raw Brier scores are not comparable across corpora and are not
reported here without their decomposition.

*Binning* is the term textbooks leave out, and it is reported because leaving it
out would make the identity above false. Murphy's three-way split is exact only
for a forecaster who quotes a small set of fixed probabilities. A market quotes
a continuum, so grouping prices into ten bands and using each band's mean throws
away the variation inside the band, and the three terms no longer add to the
Brier score. Rather than quietly report a decomposition that does not
reconstruct its own total, the residual is computed and shown: it is the price
of the binning, it shrinks as the bands get finer, and if it is large next to
reliability then the bands are too wide to conclude anything from.

**Favourite–longshot bias** is the oldest empirical finding in this literature:
longshots trade above their frequency and favourites below. It shows up as a
regression of outcome rate on price with a slope below one, and the slope is
reported with its bin counts because on a thin corpus it is mostly noise.

**Selection is the hard part, and this module cannot solve it — only report it.**
A corpus of settled markets is not a sample of forecasts. It over-weights
whatever the exchange lists most, which on Kalshi is thousands of auto-generated
short-horizon crypto and sports markets; it omits everything settled before the
API's historical cutoff; and if the forecast is read at settlement it is not a
forecast at all, it is the answer. So every report carries its composition —
which series, how many, at what horizon — and a report built from final trades
says so in its engine name rather than quietly scoring itself well.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Sequence

from modules.coherence.kernel.money import DOLLAR

#: Ten equal-width bins. Equal width rather than equal count because the
#: question "do 30-cent contracts happen 30 % of the time" is asked about the
#: price axis, and quantile bins move the axis around with the sample.
DEFAULT_BINS: int = 10

#: Below this many settled markets the decomposition is reported but every
#: term is labelled thin, because reliability on a handful of markets is a
#: statement about those markets and not about the exchange.
THIN_CORPUS: int = 50

Engine = Literal["tape", "final_trade", "unavailable"]


@dataclass(frozen=True, slots=True)
class Forecast:
    """One priced claim whose answer is now known."""

    ticker: str
    series_ticker: str
    probability: Decimal
    outcome: bool
    #: Seconds between the quote and the market's close. Zero means the price
    #: was read at settlement, which makes the score meaningless and is why the
    #: horizon travels with the forecast rather than being assumed.
    horizon_s: int

    @property
    def realised(self) -> Decimal:
        return DOLLAR if self.outcome else Decimal(0)


@dataclass(frozen=True, slots=True)
class Bin:
    """One price band, and what happened inside it."""

    low: Decimal
    high: Decimal
    count: int
    mean_forecast: Decimal | None
    outcome_rate: Decimal | None

    @property
    def label(self) -> str:
        return f"{self.low} to {self.high}"

    @property
    def deviation(self) -> Decimal | None:
        """Outcome rate minus price. Negative means the band was overpriced."""
        if self.mean_forecast is None or self.outcome_rate is None:
            return None
        return self.outcome_rate - self.mean_forecast


@dataclass(frozen=True, slots=True)
class MapPoint:
    """The recalibration curve: what a quoted price should have been."""

    quoted: Decimal
    calibrated: Decimal
    weight: int


@dataclass(frozen=True, slots=True)
class Report:
    """The full scoring of one corpus, or the reason there is not one."""

    engine: Engine
    count: int
    base_rate: Decimal | None
    brier: Decimal | None
    reliability: Decimal | None
    resolution: Decimal | None
    uncertainty: Decimal | None
    binning: Decimal | None
    bins: tuple[Bin, ...]
    isotonic_map: tuple[MapPoint, ...]
    bias_slope: Decimal | None
    composition: tuple[tuple[str, int], ...]
    median_horizon_s: int | None
    thin: bool
    detail: str

    @property
    def skill(self) -> Decimal | None:
        """Brier skill against always quoting the base rate.

        The base-rate forecaster scores exactly ``Uncertainty``, so this is the
        fraction of that score the prices actually removed. Negative means the
        prices were worse than knowing nothing but the base rate.
        """
        if self.brier is None or self.uncertainty is None or self.uncertainty <= 0:
            return None
        return (self.uncertainty - self.brier) / self.uncertainty


def _mean(values: Sequence[Decimal]) -> Decimal:
    return sum(values, Decimal(0)) / Decimal(len(values))


def _bin_index(probability: Decimal, bins: int) -> int:
    raw = int(probability * bins)
    return min(max(raw, 0), bins - 1)


def _build_bins(forecasts: Sequence[Forecast], bins: int) -> list[Bin]:
    buckets: list[list[Forecast]] = [[] for _ in range(bins)]
    for forecast in forecasts:
        buckets[_bin_index(forecast.probability, bins)].append(forecast)
    width = DOLLAR / Decimal(bins)
    built: list[Bin] = []
    for index, bucket in enumerate(buckets):
        low = width * index
        high = width * (index + 1)
        if not bucket:
            # An empty band is not a band where nothing happened; it is a band
            # nobody quoted. Reported as None so the chart leaves a gap.
            built.append(Bin(low=low, high=high, count=0, mean_forecast=None, outcome_rate=None))
            continue
        built.append(
            Bin(
                low=low,
                high=high,
                count=len(bucket),
                mean_forecast=_mean([item.probability for item in bucket]),
                outcome_rate=_mean([item.realised for item in bucket]),
            )
        )
    return built


def _murphy(
    forecasts: Sequence[Forecast], bins: Sequence[Bin]
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal]:
    """Brier, its three Murphy terms, and the residual the binning leaves.

    The Brier score is computed from the individual forecasts; reliability and
    resolution are computed from bin means, because that is what they mean. The
    two do not reconcile on their own — a bin holding prices from 0.20 to 0.30
    is summarised by one number and the spread inside it goes somewhere. The
    residual is returned rather than absorbed, so the four terms reconstruct
    the score exactly and the cost of the binning is visible.
    """
    total = Decimal(len(forecasts))
    base = _mean([item.realised for item in forecasts])
    brier = sum(((item.probability - item.realised) ** 2 for item in forecasts), Decimal(0)) / total

    reliability = Decimal(0)
    resolution = Decimal(0)
    for band in bins:
        if band.count == 0 or band.mean_forecast is None or band.outcome_rate is None:
            continue
        weight = Decimal(band.count) / total
        reliability += weight * (band.mean_forecast - band.outcome_rate) ** 2
        resolution += weight * (band.outcome_rate - base) ** 2
    uncertainty = base * (DOLLAR - base)
    binning = brier - (reliability - resolution + uncertainty)
    return brier, reliability, resolution, uncertainty, binning


def _pav(points: list[tuple[Decimal, Decimal, int]]) -> list[MapPoint]:
    """Isotonic regression by pool adjacent violators, weighted, squared loss.

    The recalibration map has to be non-decreasing — a higher price must not map
    to a lower probability, or the "corrected" prices would themselves be
    incoherent, and this engine would be shipping the fault it exists to find.
    PAV is the exact solution: walk left to right, and whenever a block's value
    dips below the one before it, merge them into their weighted mean and
    re-check backwards.
    """
    blocks: list[tuple[Decimal, Decimal, int]] = []
    for quoted, value, weight in points:
        blocks.append((quoted, value, weight))
        while len(blocks) > 1 and blocks[-2][1] > blocks[-1][1]:
            left_q, left_v, left_w = blocks[-2]
            right_q, right_v, right_w = blocks[-1]
            merged_w = left_w + right_w
            merged_v = (left_v * left_w + right_v * right_w) / Decimal(merged_w)
            blocks[-2:] = [(left_q, merged_v, merged_w)]
    return [MapPoint(quoted=quoted, calibrated=value, weight=weight) for quoted, value, weight in blocks]


def _slope(bins: Sequence[Bin]) -> Decimal | None:
    """Weighted least-squares slope of outcome rate on price.

    One is perfect calibration in the aggregate. *Above* one is the classic
    favourite–longshot shape, and the direction is worth deriving rather than
    remembering: longshots are overbet, so a 5-cent contract happens less than
    5 % of the time and its point sits below the diagonal; favourites are
    underbet, so a 95-cent contract happens more than 95 % of the time and sits
    above it. A line through a point pulled down at the left and up at the right
    is steeper than the diagonal, not shallower.
    """
    usable = [band for band in bins if band.count and band.mean_forecast is not None and band.outcome_rate is not None]
    if len(usable) < 3:
        return None
    weight = sum((Decimal(band.count) for band in usable), Decimal(0))
    mean_x = sum((Decimal(band.count) * (band.mean_forecast or Decimal(0)) for band in usable), Decimal(0)) / weight
    mean_y = sum((Decimal(band.count) * (band.outcome_rate or Decimal(0)) for band in usable), Decimal(0)) / weight
    numerator = Decimal(0)
    denominator = Decimal(0)
    for band in usable:
        dx = (band.mean_forecast or Decimal(0)) - mean_x
        numerator += Decimal(band.count) * dx * ((band.outcome_rate or Decimal(0)) - mean_y)
        denominator += Decimal(band.count) * dx * dx
    if denominator <= 0:
        return None
    return numerator / denominator


def _median_horizon(forecasts: Sequence[Forecast]) -> int:
    horizons = sorted(item.horizon_s for item in forecasts)
    middle = len(horizons) // 2
    if len(horizons) % 2:
        return horizons[middle]
    return (horizons[middle - 1] + horizons[middle]) // 2


def _unavailable(detail: str) -> Report:
    return Report(
        engine="unavailable",
        count=0,
        base_rate=None,
        brier=None,
        reliability=None,
        resolution=None,
        uncertainty=None,
        binning=None,
        bins=(),
        isotonic_map=(),
        bias_slope=None,
        composition=(),
        median_horizon_s=None,
        thin=True,
        detail=detail,
    )


def score(forecasts: Sequence[Forecast], engine: Engine, bins: int = DEFAULT_BINS) -> Report:
    """Score a settled corpus. ``engine`` names where the forecasts came from."""
    rows = list(forecasts)
    if not rows:
        return _unavailable("no settled market in this corpus has a recorded forecast to score")

    outcomes = {item.outcome for item in rows}
    bands = _build_bins(rows, bins)
    brier, reliability, resolution, uncertainty, binning = _murphy(rows, bands)
    base = _mean([item.realised for item in rows])

    points = [
        (band.mean_forecast, band.outcome_rate, band.count)
        for band in bands
        if band.count and band.mean_forecast is not None and band.outcome_rate is not None
    ]
    isotonic = _pav([(q, v, w) for q, v, w in points]) if points else []

    counts: dict[str, int] = {}
    for item in rows:
        counts[item.series_ticker] = counts.get(item.series_ticker, 0) + 1
    composition = tuple(sorted(counts.items(), key=lambda pair: (-pair[1], pair[0])))

    median_horizon = _median_horizon(rows)
    notes = [f"{len(rows)} settled market(s) across {len(composition)} series"]
    if engine == "final_trade":
        notes.append(
            "these are last traded prices, which are quoted moments before settlement and are "
            "close to the answer; this scores the exchange's convergence, not its foresight"
        )
    if median_horizon == 0:
        notes.append("the median forecast was read at settlement, so the score is not a forecast test")
    if len(outcomes) < 2:
        notes.append(
            "every market in this corpus settled the same way, so resolution and the bias slope "
            "cannot separate skill from the base rate"
        )
    if composition and composition[0][1] * 2 > len(rows):
        notes.append(f"over half the corpus is one series, {composition[0][0]}, so this is mostly a score of that series")

    return Report(
        engine=engine,
        count=len(rows),
        base_rate=base,
        brier=brier,
        reliability=reliability,
        resolution=resolution,
        uncertainty=uncertainty,
        binning=binning,
        bins=tuple(bands),
        isotonic_map=tuple(isotonic),
        bias_slope=_slope(bands),
        composition=composition,
        median_horizon_s=median_horizon,
        thin=len(rows) < THIN_CORPUS,
        detail="; ".join(notes),
    )
