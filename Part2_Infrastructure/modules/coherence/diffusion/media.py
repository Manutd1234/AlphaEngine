"""Headlines as a cascade, and the resolution that claim is allowed to have.

The third channel, and the one the tab is named after. An announcement lands
and two things spread from it: the price moves, and the story gets retold. If
those two have related half-lives then attention and absorption are one
process; if they do not, they are two, and knowing which is worth the arithmetic.

The cascade target is CasFlow's — the log growth in participants between an
observation window and a prediction window — because it is the quantity that
literature actually reports, and reusing it means a number here can be compared
with a published one instead of being unfalsifiable.

WHAT THIS CANNOT CLAIM, AND SAYS SO IN THE OUTPUT. Two things bound the
resolution of every number here and neither is fixable from this file:

* A poller sees arrivals at its own cadence, so a half-life measured from
  `first_seen_at` cannot be finer than the polling interval. `resolution_s`
  carries that, and a caller comparing a media half-life of ninety seconds
  against a price half-life of ninety seconds should be told they are not the
  same kind of ninety.
* The vendors substitute the fetch clock for an unparseable publication stamp,
  which is why both half-lives are reported: one by `published_at` and one by
  `first_seen_at`. Their difference is the vendor's own latency, and hiding it
  behind a single number would be inventing precision.

An empty window is a state. `log1p(0) - log1p(0)` is 0.0 and is
indistinguishable from a cascade that genuinely did not grow, so a `Cascade`
with no arrivals carries `no_headlines` and nulls rather than zeros.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

CascadeState = Literal["ok", "no_headlines", "insufficient"]

#: Below this an arrival list is a coincidence rather than a cascade.
MIN_ARRIVALS = 5


@dataclass(frozen=True)
class Cascade:
    """One event's attention, with the reason it cannot be described."""

    state: CascadeState
    arrivals: int = 0
    size_at_observation: int = 0
    size_at_prediction: int = 0
    log_growth: float | None = None
    half_life_published_s: float | None = None
    half_life_first_seen_s: float | None = None
    vendor_latency_s: float | None = None
    resolution_s: float | None = None
    reason: str | None = None


def _half_life(offsets: np.ndarray) -> float | None:
    """When half the window's arrivals had arrived.

    Interpolated between the bracketing arrivals rather than snapped to the
    later one, for the same reason the price half-life is: snapping quantises
    every answer onto the sample and draws a picture of the sampler.
    """
    if offsets.size == 0:
        return None
    ordered = np.sort(offsets)
    target = (ordered.size - 1) / 2.0
    lower = int(np.floor(target))
    upper = int(np.ceil(target))
    if lower == upper:
        return float(ordered[lower])
    weight = target - lower
    return float(ordered[lower] + weight * (ordered[upper] - ordered[lower]))


def cascade(
    headlines: list[dict[str, Any]],
    t0_ms: float,
    *,
    observation_s: float = 3_600.0,
    prediction_s: float = 86_400.0,
    resolution_s: float | None = None,
    min_arrivals: int = MIN_ARRIVALS,
) -> Cascade:
    """One event's headline arrivals, as a cascade with its own resolution."""
    published: list[float] = []
    first_seen: list[float] = []
    for item in headlines:
        seen = _offset(item.get("first_seen_at"), t0_ms)
        if seen is None or seen < 0 or seen > prediction_s:
            continue
        first_seen.append(seen)
        stamped = _offset(item.get("published_at"), t0_ms)
        if stamped is not None and 0 <= stamped <= prediction_s:
            published.append(stamped)

    if not first_seen:
        return Cascade("no_headlines", reason="no headline arrived inside the prediction window")

    seen_array = np.asarray(first_seen, dtype=np.float64)
    at_observation = int(np.count_nonzero(seen_array <= observation_s))
    at_prediction = int(seen_array.size)
    if at_prediction < min_arrivals:
        return Cascade("insufficient", arrivals=at_prediction,
                       size_at_observation=at_observation, size_at_prediction=at_prediction,
                       reason=f"{at_prediction} arrivals is below the floor of {min_arrivals}; "
                              "a half-life over that many points is a coincidence")

    seen_half = _half_life(seen_array)
    published_half = _half_life(np.asarray(published, dtype=np.float64)) if published else None
    latency = (seen_half - published_half) if (seen_half is not None
                                               and published_half is not None) else None
    return Cascade(
        "ok", arrivals=at_prediction, size_at_observation=at_observation,
        size_at_prediction=at_prediction,
        log_growth=float(np.log1p(at_prediction) - np.log1p(at_observation)),
        half_life_published_s=published_half, half_life_first_seen_s=seen_half,
        vendor_latency_s=latency, resolution_s=resolution_s,
    )


def _offset(value: Any, t0_ms: float) -> float | None:
    try:
        return (float(value) - float(t0_ms)) / 1000.0
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class Coherence:
    """How the two channels' speeds relate across events, and over how many."""

    state: Literal["ok", "insufficient"]
    n: int
    rho: float | None = None
    shuffled_rho: float | None = None
    reason: str | None = None


def coherence(price_half_lives: dict[str, float], media_half_lives: dict[str, float], *,
              min_events: int = 12, draws: int = 2_000, seed: int = 7) -> Coherence:
    """Rank correlation between the two half-lives, with a shuffled null.

    Spearman rather than Pearson: both quantities are heavy-tailed and a single
    slow event would otherwise set the answer. The shuffled figure is the same
    statistic over a pairing that carries nothing, and it is reported beside
    the real one rather than as a p-value, because a reader can compare two
    numbers on the same scale without being told what to conclude.
    """
    shared = sorted(set(price_half_lives) & set(media_half_lives))
    if len(shared) < min_events:
        return Coherence("insufficient", len(shared),
                         reason=f"{len(shared)} of {min_events} events have both half-lives")
    price = _ranks(np.asarray([price_half_lives[ref] for ref in shared], dtype=np.float64))
    media = _ranks(np.asarray([media_half_lives[ref] for ref in shared], dtype=np.float64))
    rho = float(np.corrcoef(price, media)[0, 1])
    rng = np.random.default_rng(seed)
    null = [float(np.corrcoef(price, media[rng.permutation(media.size)])[0, 1])
            for _ in range(min(draws, 400))]
    return Coherence("ok", len(shared), rho=rho,
                     shuffled_rho=float(np.median(np.abs(null))) if null else None)


def _ranks(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values)
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(values.size, dtype=np.float64)
    return ranks
