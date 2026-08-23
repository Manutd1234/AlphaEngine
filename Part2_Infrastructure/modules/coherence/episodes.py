"""How long a coherence violation survives, and what that says about trading it.

Every violation has a lifetime. It opens when the prices first admit a Dutch
book and closes when they stop. The distribution of those lifetimes is the
measurement that decides whether any of this is a trading system or a
screenshot: if the median is shorter than the round trip, the opportunity was
never available and the race was lost before it was entered.

That makes this module the honest gate on the whole engine. It is also the
engine's second product. Each episode is an information-arrival event with an
absorption time attached — the market was inconsistent, then it was not — which
is the same shape as "how fast does a price absorb an earnings surprise", and it
is what the diffusion work consumes.

**Half-lives are reported with their sample size or not at all.** A median over
three episodes is not a median, and a survival curve drawn from a handful of
points is a shape the eye will read as evidence. The floor is named and enforced
rather than assumed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Sequence

# Below this an estimate is not published. Chosen for the same reason the
# desk's other sample floors are: a number the reader cannot act on is worse
# than a dash, because a dash cannot be mistaken for a measurement.
MIN_EPISODES_FOR_HALF_LIFE = 8

# Two consecutive coherent polls close an episode, not one. A single poll can
# miss a violation because one leg's book was momentarily unreadable, and
# closing on that would cut long episodes into strings of short ones — biasing
# the median down, which is the direction that makes the exchange look faster
# than it is.
POLLS_TO_CLOSE = 2


@dataclass(slots=True)
class Episode:
    """One violation, from the poll it appeared on to the poll it stopped."""

    component_id: str
    series_ticker: str
    event_ticker: str
    family: str
    exchange_index: int
    opened_ts_ns: int
    closed_ts_ns: int | None = None
    peak_ci: Decimal | None = None
    peak_net_edge: Decimal | None = None
    samples: list[tuple[int, Decimal | None]] = field(default_factory=list)
    _coherent_polls: int = 0

    @property
    def open(self) -> bool:
        return self.closed_ts_ns is None

    @property
    def lifetime_s(self) -> Decimal | None:
        """None while it is still open — an open episode has no lifetime yet.

        Reporting the age of an open episode as its lifetime would truncate
        every long one at the moment of asking, which is the censoring bias a
        survival curve exists to avoid.
        """
        if self.closed_ts_ns is None:
            return None
        return (Decimal(self.closed_ts_ns - self.opened_ts_ns) / Decimal(1_000_000_000)).quantize(Decimal("0.001"))

    def to_dict(self) -> dict[str, Any]:
        return {
            "component_id": self.component_id,
            "series_ticker": self.series_ticker,
            "event_ticker": self.event_ticker,
            "family": self.family,
            "exchange_index": self.exchange_index,
            "opened_ts_ns": self.opened_ts_ns,
            "closed_ts_ns": self.closed_ts_ns,
            "lifetime_s": None if self.lifetime_s is None else str(self.lifetime_s),
            "peak_ci": None if self.peak_ci is None else str(self.peak_ci),
            "peak_net_edge_dollars": None if self.peak_net_edge is None else str(self.peak_net_edge),
            "samples": [{"ts_ns": ts, "ci": None if ci is None else str(ci)} for ts, ci in self.samples],
        }


class EpisodeTracker:
    """Opens and closes episodes as polls arrive.

    Stateful across polls by necessity: an episode is defined by what happened
    between observations, so nothing about it can be computed from one.
    """

    def __init__(self) -> None:
        self._open: dict[str, Episode] = {}
        self.closed: list[Episode] = []

    def observe(
        self,
        component_id: str,
        series_ticker: str,
        event_ticker: str,
        exchange_index: int,
        ts_ns: int,
        violated: bool,
        family: str = "",
        ci: Decimal | None = None,
        net_edge: Decimal | None = None,
    ) -> Episode | None:
        """Record one poll. Returns the episode that just closed, if any."""
        episode = self._open.get(component_id)

        if violated:
            if episode is None:
                episode = Episode(
                    component_id=component_id,
                    series_ticker=series_ticker,
                    event_ticker=event_ticker,
                    family=family,
                    exchange_index=exchange_index,
                    opened_ts_ns=ts_ns,
                )
                self._open[component_id] = episode
            episode._coherent_polls = 0
            episode.samples.append((ts_ns, ci))
            if ci is not None and (episode.peak_ci is None or ci > episode.peak_ci):
                episode.peak_ci = ci
            if net_edge is not None and (episode.peak_net_edge is None or net_edge > episode.peak_net_edge):
                episode.peak_net_edge = net_edge
            return None

        if episode is None:
            return None

        episode.samples.append((ts_ns, ci))
        episode._coherent_polls += 1
        if episode._coherent_polls < POLLS_TO_CLOSE:
            return None

        episode.closed_ts_ns = ts_ns
        self._open.pop(component_id, None)
        self.closed.append(episode)
        return episode

    @property
    def open_episodes(self) -> list[Episode]:
        return list(self._open.values())


@dataclass(frozen=True, slots=True)
class SurvivalCurve:
    """How many violations were still open after t seconds.

    ``median_s`` is None below the sample floor, with ``reason`` saying so. A
    curve is still drawn — the points are real — but the summary statistic a
    reader would quote is withheld until it means something.
    """

    points: tuple[tuple[Decimal, Decimal], ...]
    episodes: int
    median_s: Decimal | None
    reason: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "points": [{"t_s": str(t), "surviving": str(fraction)} for t, fraction in self.points],
            "episodes": self.episodes,
            "median_s": None if self.median_s is None else str(self.median_s),
            "reason": self.reason,
        }


def survival(episodes: Sequence[Episode]) -> SurvivalCurve:
    """The empirical survival curve of closed episodes.

    Open episodes are excluded rather than counted at their current age: an
    episode still running is a lower bound on a lifetime, and mixing bounds
    with measurements pulls the curve down by exactly the long tail it exists
    to show.
    """
    lifetimes = sorted(
        (episode.lifetime_s for episode in episodes if episode.lifetime_s is not None),
        key=lambda value: value,
    )
    if not lifetimes:
        return SurvivalCurve((), 0, None, "no violation has opened and closed yet")

    total = Decimal(len(lifetimes))
    points: list[tuple[Decimal, Decimal]] = []
    for index, lifetime in enumerate(lifetimes):
        surviving = (total - Decimal(index)) / total
        points.append((lifetime, surviving.quantize(Decimal("0.0001"))))

    if len(lifetimes) < MIN_EPISODES_FOR_HALF_LIFE:
        return SurvivalCurve(
            tuple(points),
            len(lifetimes),
            None,
            f"{len(lifetimes)} closed episode(s); a median needs at least {MIN_EPISODES_FOR_HALF_LIFE}",
        )

    middle = len(lifetimes) // 2
    median = (
        lifetimes[middle]
        if len(lifetimes) % 2
        else ((lifetimes[middle - 1] + lifetimes[middle]) / 2).quantize(Decimal("0.001"))
    )
    return SurvivalCurve(tuple(points), len(lifetimes), median, None)


def verdict_for(curve: SurvivalCurve, round_trip_s: Decimal) -> str:
    """What the curve says about trading this series, in one sentence."""
    if curve.median_s is None:
        return curve.reason or "not enough episodes to say anything yet"
    if curve.median_s < round_trip_s:
        return (
            f"the median violation lasts {curve.median_s}s against a {round_trip_s}s round trip: "
            "this is not an opportunity, it is a data artefact, and the race is already lost"
        )
    if curve.median_s < round_trip_s * 3:
        return (
            f"the median violation lasts {curve.median_s}s against a {round_trip_s}s round trip: "
            "marginal, and worth flagging rather than firing"
        )
    return (
        f"the median violation lasts {curve.median_s}s against a {round_trip_s}s round trip: "
        "slow enough to reach"
    )
