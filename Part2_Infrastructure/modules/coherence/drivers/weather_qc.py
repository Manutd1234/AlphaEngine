"""The settlement index's own formation process, one station at a time.

``GET /live_data/weather/{city}?detailed=true`` returns, for every minute, each
member station's raw reading and the quality-control disposition it was given
before incorporation. The design spec calls this the standout of the whole
settlement-data layer, and it is right for a reason worth stating plainly:

**The trailing minutes have readings but no index.** Points still inside the
receipt deadline come back with ``status: "incomplete"``, no ``v``, and every
station marked ``pending``. Their temperatures are already there. So the value
the exchange is about to publish can be computed from data it has already
handed over — not forecast, computed — for as long as the deadline lasts. That
is the edge: not a better model of the weather, but arithmetic on a settlement
source that is published in two stages.

**The formation rule is checked, never assumed.** On the Miami index the
published minute equals the mean of its ``ok`` stations exactly — 91.04 against
(91.4, 91.4, 89.6, 91.4, 91.4). That is a hypothesis this module tests against
every completed minute it is given and reports the agreement for, because a
provisional value computed under a rule that has quietly changed is worse than
no provisional value at all. ``Formation.agreed`` is the evidence; a caller that
sees it short of ``checked`` should not trade the provisional number.

Quality control is the other half. A station can be ``ok``, ``pending``, or
dispositioned out, and the exchange says which. Minutes where the quorum failed
are omitted entirely, so a gap in the series is a real gap — the index did not
merely go unreported, it was not computed — and gaps are counted rather than
smoothed over.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

#: A station whose reading has cleared quality control and is in the index.
CODE_OK = "ok"
#: A raw reading inside the receipt deadline, not yet dispositioned.
CODE_PENDING = "pending"
#: The venue publishes this index once a minute.
MINUTE_MS = 60_000


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


@dataclass(frozen=True, slots=True)
class Station:
    """One member station's reading, and what QC did with it."""

    station_id: str
    source: str
    temp: Decimal | None
    code: str
    received_at_ms: int | None

    @property
    def counted(self) -> bool:
        return self.code == CODE_OK

    @property
    def pending(self) -> bool:
        return self.code == CODE_PENDING


@dataclass(frozen=True, slots=True)
class Minute:
    """One minute of the index, published or not yet."""

    ts_ms: int
    published: Decimal | None
    status: str
    stations: tuple[Station, ...]

    @property
    def incomplete(self) -> bool:
        """Readings are in, the index is not. This is the window that matters."""
        return self.published is None

    @property
    def counted(self) -> tuple[Station, ...]:
        return tuple(s for s in self.stations if s.counted and s.temp is not None)

    @property
    def usable(self) -> tuple[Station, ...]:
        """Everything QC has not thrown out — ``ok`` now, or ``pending`` still.

        A pending reading is not a rejected one. Treating the two alike would
        make every incomplete minute look like a feed failure, which is the
        opposite of what it is.
        """
        return tuple(s for s in self.stations if s.temp is not None and s.code != "")

    @property
    def spread(self) -> Decimal | None:
        """How far apart the stations are this minute.

        The quantity QC is arbitrating. A wide spread on an incomplete minute
        is the honest warning that the provisional value below is a mean of
        readings that disagree.
        """
        temps = [s.temp for s in self.usable if s.temp is not None]
        if len(temps) < 2:
            return None
        return max(temps) - min(temps)

    def provisional(self) -> Decimal | None:
        """What the index will read if every present station is incorporated.

        The mean of the readings that are in hand, under the rule
        ``formation_check`` tests. ``None`` where nothing has arrived — never
        zero, which on a temperature index would be a reading in its own right.
        """
        temps = [s.temp for s in self.usable if s.temp is not None]
        if not temps:
            return None
        return sum(temps, Decimal(0)) / Decimal(len(temps))


@dataclass(frozen=True, slots=True)
class Formation:
    """Evidence that the published index is the mean of its ``ok`` stations."""

    checked: int
    agreed: int
    worst_gap: Decimal | None

    @property
    def holds(self) -> bool:
        return self.checked > 0 and self.agreed == self.checked

    @property
    def detail(self) -> str:
        if not self.checked:
            return "no completed minute carried stations, so the formation rule is untested here"
        if self.holds:
            return (
                f"the published index is the mean of its ok stations on all {self.checked} completed "
                "minute(s) checked, so a provisional value under that rule rests on evidence"
            )
        return (
            f"the mean of the ok stations reproduces the published index on {self.agreed} of "
            f"{self.checked} minute(s), off by up to {self.worst_gap} — the rule has changed or is "
            "not the whole story, and a provisional value computed from it should not be traded"
        )


def parse_detailed(payload: dict[str, Any]) -> list[Minute]:
    """Every minute the detailed feed carries, published or incomplete.

    Incomplete minutes are KEPT. A parser that requires a published value drops
    exactly the rows this module exists to read.
    """
    rows = payload.get("timeseries")
    if not isinstance(rows, list):
        return []
    minutes: list[Minute] = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("t"), int):
            continue
        raw = row.get("stations")
        stations = tuple(
            Station(
                station_id=str(item.get("station_id") or ""),
                source=str(item.get("source") or ""),
                temp=_decimal(item.get("temp_f")),
                code=str(item.get("code") or ""),
                received_at_ms=item.get("received_at_ms")
                if isinstance(item.get("received_at_ms"), int)
                else None,
            )
            for item in (raw if isinstance(raw, list) else [])
            if isinstance(item, dict)
        )
        minutes.append(
            Minute(
                ts_ms=row["t"],
                published=_decimal(row.get("v")),
                status=str(row.get("status") or ""),
                stations=stations,
            )
        )
    return sorted(minutes, key=lambda minute: minute.ts_ms)


def formation_check(minutes: Sequence[Minute], tolerance: Decimal = Decimal("0.005")) -> Formation:
    """Does the mean of the ``ok`` stations reproduce the published index?"""
    checked = 0
    agreed = 0
    worst: Decimal | None = None
    for minute in minutes:
        counted = minute.counted
        if minute.published is None or not counted:
            continue
        checked += 1
        mean = sum((s.temp for s in counted if s.temp is not None), Decimal(0)) / Decimal(len(counted))
        gap = abs(mean - minute.published)
        if gap <= tolerance:
            agreed += 1
        elif worst is None or gap > worst:
            worst = gap
    return Formation(checked=checked, agreed=agreed, worst_gap=worst)


def quorum_gaps(minutes: Sequence[Minute]) -> int:
    """Minutes the venue omitted, which are minutes the index was not computed.

    The feed drops a minute where the quorum failed rather than publishing a
    null, so a hole in the timestamps is a fact about the index rather than
    about the request. Counted so a reader can see whether the series they are
    averaging is actually continuous.
    """
    missing = 0
    for earlier, later in zip(minutes, minutes[1:], strict=False):
        step = later.ts_ms - earlier.ts_ms
        if step > MINUTE_MS:
            missing += (step // MINUTE_MS) - 1
    return missing


def pending_minutes(minutes: Sequence[Minute]) -> list[Minute]:
    """The trailing minutes that have readings and no index yet."""
    return [minute for minute in minutes if minute.incomplete and minute.usable]
