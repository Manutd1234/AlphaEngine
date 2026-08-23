"""The kill test: do the two stages of one announcement absorb at the same speed?

One statistic, computed two ways that must agree, over meetings rather than
rows.

**Meetings, not rows.** BTC and ETH answer the same FOMC statement, and their
responses are close to the same observation twice. Counting forty meetings
across two assets as eighty independent draws shrinks the standard error by
about root two and manufactures significance out of the asset list. Every
resample here draws MEETINGS with replacement and takes whatever rows that
meeting has, which is the cluster bootstrap; `n` is reported as meetings
everywhere, including in the floor that decides whether a verdict is offered
at all.

**Two ways.** The paired log-ratio of half-lives answers "is one stage faster",
and the per-horizon difference in absorbed fraction answers "where". They can
disagree — a stage can reach half its move sooner and still be behind at ten
minutes — and when they do, that is a finding rather than a problem to
average away.

**A verdict is refused below the floor.** `not_assessable` with `"n of N"` is
the honest state for a study that has not accumulated yet, and it is different
from `flat`, which is a measured absence. Collapsing the two is how a project
convinces itself it has failed before it has looked.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

Verdict = Literal["differ", "flat", "not_assessable"]


@dataclass(frozen=True)
class StagePair:
    """One (meeting, asset) row: the same event measured at both stages."""

    cluster: str
    asset: str
    release_half_life: float | None
    call_half_life: float | None
    release_absorbed: dict[str, float | None] = field(default_factory=dict)
    call_absorbed: dict[str, float | None] = field(default_factory=dict)

    @property
    def log_ratio(self) -> float | None:
        if not self.release_half_life or not self.call_half_life:
            return None
        if self.release_half_life <= 0 or self.call_half_life <= 0:
            return None
        return math.log(self.call_half_life) - math.log(self.release_half_life)


@dataclass(frozen=True)
class UnpairedReport:
    """The same question asked of every measured stage, not only matched ones.

    The paired test drops a meeting when EITHER stage failed the signal gate,
    and on this arm that is most of them: an FOMC decision the market had
    already priced moves neither stage two sigmas. Pairing is the stronger
    design and stays primary, but throwing away a measured release because its
    press conference was quiet discards a real observation about releases.

    So this compares the two stage populations directly, still clustering by
    meeting so a meeting that contributed a release and a call is not counted
    as two independent draws. It has more n and a weaker claim, and the report
    prints both with their own counts so a reader can see which is which.
    """

    state: Literal["ok", "not_assessable"]
    clock: str
    verdict: Verdict
    n_clusters: int
    n_release: int
    n_call: int
    median_release: float | None = None
    median_call: float | None = None
    median_log_ratio: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    reason: str | None = None


@dataclass(frozen=True)
class HorizonDelta:
    horizon: str
    n_clusters: int
    median_delta: float | None
    ci_low: float | None
    ci_high: float | None


@dataclass(frozen=True)
class Phase0Report:
    state: Literal["ok", "not_assessable"]
    clock: str
    n_clusters: int
    n_rows: int
    min_clusters: int
    verdict: Verdict
    reason: str | None = None
    median_log_ratio: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    sign_test_p: float | None = None
    n_call_slower: int = 0
    n_release_slower: int = 0
    n_ties: int = 0
    horizons: tuple[HorizonDelta, ...] = ()


def sign_test_p(successes: int, trials: int) -> float | None:
    """Two-sided exact binomial p at one half. None when nothing was compared.

    Ties are excluded by the caller and counted separately, which is the
    conventional handling and the only one that does not invent a direction
    for a pair that showed none.
    """
    if trials <= 0:
        return None
    tail = sum(math.comb(trials, k) for k in range(min(successes, trials - successes) + 1))
    return min(1.0, 2.0 * tail / (2.0**trials))


def _cluster_bootstrap(values_by_cluster: dict[str, list[float]], *, draws: int,
                       seed: int) -> tuple[float | None, float | None, float | None]:
    clusters = sorted(values_by_cluster)
    if not clusters:
        return None, None, None
    pooled = [value for cluster in clusters for value in values_by_cluster[cluster]]
    if not pooled:
        return None, None, None
    point = float(np.median(pooled))
    rng = np.random.default_rng(seed)
    index = np.arange(len(clusters))
    medians = np.empty(draws, dtype=np.float64)
    for draw in range(draws):
        picked = rng.choice(index, size=len(clusters), replace=True)
        sample: list[float] = []
        for position in picked:
            sample.extend(values_by_cluster[clusters[position]])
        medians[draw] = np.median(sample) if sample else np.nan
    finite = medians[np.isfinite(medians)]
    if finite.size == 0:
        return point, None, None
    return point, float(np.percentile(finite, 2.5)), float(np.percentile(finite, 97.5))


def _horizon_deltas(pairs: list[StagePair], horizons: tuple[str, ...], *, draws: int,
                    seed: int) -> tuple[HorizonDelta, ...]:
    out: list[HorizonDelta] = []
    for offset, horizon in enumerate(horizons):
        by_cluster: dict[str, list[float]] = {}
        for pair in pairs:
            release = pair.release_absorbed.get(horizon)
            call = pair.call_absorbed.get(horizon)
            if release is None or call is None:
                continue
            by_cluster.setdefault(pair.cluster, []).append(call - release)
        median, low, high = _cluster_bootstrap(by_cluster, draws=draws, seed=seed + 101 + offset)
        out.append(HorizonDelta(horizon, len(by_cluster), median, low, high))
    return tuple(out)


def paired_stage_test(
    pairs: list[StagePair],
    *,
    clock: str,
    min_clusters: int,
    draws: int,
    seed: int,
    horizons: tuple[str, ...] = (),
) -> Phase0Report:
    """The paired comparison, refused when too few meetings have accumulated."""
    usable = [pair for pair in pairs if pair.log_ratio is not None]
    by_cluster: dict[str, list[float]] = {}
    for pair in usable:
        ratio = pair.log_ratio
        if ratio is not None:
            by_cluster.setdefault(pair.cluster, []).append(ratio)
    n_clusters = len(by_cluster)

    if n_clusters < min_clusters:
        return Phase0Report(
            state="not_assessable", clock=clock, n_clusters=n_clusters, n_rows=len(usable),
            min_clusters=min_clusters, verdict="not_assessable",
            reason=f"{n_clusters} of {min_clusters} meetings have both stages measured",
            horizons=_horizon_deltas(pairs, horizons, draws=draws, seed=seed) if horizons else (),
        )

    cluster_medians = [float(np.median(values)) for values in by_cluster.values()]
    slower = sum(1 for value in cluster_medians if value > 0)
    faster = sum(1 for value in cluster_medians if value < 0)
    ties = sum(1 for value in cluster_medians if value == 0)
    median, low, high = _cluster_bootstrap(by_cluster, draws=draws, seed=seed)
    p_value = sign_test_p(min(slower, faster), slower + faster)
    excludes_zero = low is not None and high is not None and (low > 0 or high < 0)
    return Phase0Report(
        state="ok", clock=clock, n_clusters=n_clusters, n_rows=len(usable),
        min_clusters=min_clusters, verdict="differ" if excludes_zero else "flat",
        median_log_ratio=median, ci_low=low, ci_high=high, sign_test_p=p_value,
        n_call_slower=slower, n_release_slower=faster, n_ties=ties,
        horizons=_horizon_deltas(pairs, horizons, draws=draws, seed=seed) if horizons else (),
    )


def unpaired_stage_test(
    release: dict[str, list[float]],
    call: dict[str, list[float]],
    *,
    clock: str,
    min_clusters: int,
    draws: int,
    seed: int,
) -> UnpairedReport:
    """Compare the two stage populations, resampling meetings rather than rows.

    `release` and `call` map a meeting to the half-lives measured for it at
    that stage; a meeting may appear in one and not the other, which is the
    whole reason this exists. The statistic is the log ratio of the two
    medians, and its interval comes from resampling the union of the meetings
    so that a meeting present in both moves both sides together.
    """
    clusters = sorted(set(release) | set(call))
    n_release = sum(len(values) for values in release.values())
    n_call = sum(len(values) for values in call.values())
    if len(clusters) < min_clusters or not n_release or not n_call:
        return UnpairedReport(
            state="not_assessable", clock=clock, verdict="not_assessable",
            n_clusters=len(clusters), n_release=n_release, n_call=n_call,
            reason=(f"{len(clusters)} of {min_clusters} meetings measured at least one stage "
                    f"({n_release} release, {n_call} call)"),
        )

    def _ratio(picked: list[str]) -> float | None:
        left = [value for name in picked for value in release.get(name, ())]
        right = [value for name in picked for value in call.get(name, ())]
        if not left or not right:
            return None
        left_median, right_median = float(np.median(left)), float(np.median(right))
        if left_median <= 0 or right_median <= 0:
            return None
        return math.log(right_median) - math.log(left_median)

    point = _ratio(clusters)
    rng = np.random.default_rng(seed)
    index = np.arange(len(clusters))
    samples: list[float] = []
    for _ in range(draws):
        picked = [clusters[position] for position in rng.choice(index, size=len(clusters), replace=True)]
        value = _ratio(picked)
        if value is not None:
            samples.append(value)
    low = float(np.percentile(samples, 2.5)) if samples else None
    high = float(np.percentile(samples, 97.5)) if samples else None
    excludes_zero = low is not None and high is not None and (low > 0 or high < 0)
    return UnpairedReport(
        state="ok", clock=clock, verdict="differ" if excludes_zero else "flat",
        n_clusters=len(clusters), n_release=n_release, n_call=n_call,
        median_release=float(np.median([v for values in release.values() for v in values])),
        median_call=float(np.median([v for values in call.values() for v in values])),
        median_log_ratio=point, ci_low=low, ci_high=high,
    )
