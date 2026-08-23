"""The FOMC decision calendar, as a seed that says it has not been checked.

Why a seed at all. This arm exists because an FOMC decision is the one event
whose two stages are exogenously separated by a known interval and stamped to
the minute in public: the statement at 14:00 ET and the press conference at
14:30 ET, every scheduled meeting since January 2019 (Powell moved to a
conference after every meeting that month, which is why the window starts
there and not earlier). No vendor is needed and no forward capture: pair those
timestamps with Binance minute bars and the kill test can run today.

WHAT IS NOT TRUE OF THIS FILE. The dates below were written from knowledge,
not fetched, so `verified_at` is `None` on every row and `seed_rows` refuses to
pretend otherwise. Nothing may cite a meeting whose row has not been confirmed
against the Federal Reserve's own calendar. The confirmation is mechanical and
is owed by the text slice: each statement lives at

    https://www.federalreserve.gov/newsevents/pressreleases/monetary{YYYYMMDD}a.htm

so a 404 falsifies a row and a 200 confirms the date. Until that runs, a report
built on these rows carries `verified: false` and says so in its own output.

The two unscheduled 2020 meetings are the reason `statement_et` and
`presser_et` are per-row rather than constants: 3 March 2020 announced at 10:00
with the conference at 11:00, and 15 March 2020 was a Sunday evening, 17:00
with the conference at 18:00. A seed that assumed 14:00/14:30 would place both
of the largest monetary surprises of the period in the wrong hour, and the
absorption path would be measured from a moment when nothing had happened yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

FED_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
FED_STATEMENT_URL = "https://www.federalreserve.gov/newsevents/pressreleases/monetary{stamp}a.htm"

#: Every timestamp below is New York wall-clock; the zone carries the daylight
#: shift so a March meeting and a November meeting are both right.
_ET = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class FomcMeeting:
    """One decision day: when the statement landed, and when Powell spoke."""

    date: str
    statement_et: str = "14:00"
    presser_et: str | None = "14:30"
    scheduled: bool = True

    def stamp(self) -> str:
        """The `YYYYMMDD` the Fed's own statement URL is keyed by."""
        return self.date.replace("-", "")

    def statement_url(self) -> str:
        return FED_STATEMENT_URL.format(stamp=self.stamp())


def _utc_ms(date: str, hhmm: str) -> int:
    hour, minute = (int(part) for part in hhmm.split(":", 1))
    year, month, day = (int(part) for part in date.split("-"))
    local = datetime(year, month, day, tzinfo=_ET).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    return int(local.astimezone(timezone.utc).timestamp() * 1000)


def _wednesdays(year: int, days: tuple[tuple[int, int], ...]) -> tuple[FomcMeeting, ...]:
    return tuple(FomcMeeting(date=f"{year:04d}-{month:02d}-{day:02d}") for month, day in days)


#: Decision days, newest last. A two-day meeting is filed under its SECOND day,
#: which is the day the statement is released.
FOMC_SEED: tuple[FomcMeeting, ...] = (
    *_wednesdays(2019, ((1, 30), (3, 20), (5, 1), (6, 19), (7, 31), (9, 18), (10, 30), (12, 11))),
    FomcMeeting("2020-01-29"),
    # The two emergency cuts. Neither is 14:00, and neither is a Wednesday.
    FomcMeeting("2020-03-03", statement_et="10:00", presser_et="11:00", scheduled=False),
    FomcMeeting("2020-03-15", statement_et="17:00", presser_et="18:00", scheduled=False),
    *_wednesdays(2020, ((4, 29), (6, 10), (7, 29), (9, 16))),
    # Election week 2020, same shape as 2024: the meeting ran Wed–Thu.
    FomcMeeting("2020-11-05"),
    FomcMeeting("2020-12-16"),
    *_wednesdays(2021, ((1, 27), (3, 17), (4, 28), (6, 16), (7, 28), (9, 22), (11, 3), (12, 15))),
    *_wednesdays(2022, ((1, 26), (3, 16), (5, 4), (6, 15), (7, 27), (9, 21), (11, 2), (12, 14))),
    *_wednesdays(2023, ((2, 1), (3, 22), (5, 3), (6, 14), (7, 26), (9, 20), (11, 1), (12, 13))),
    *_wednesdays(2024, ((1, 31), (3, 20), (5, 1), (6, 12), (7, 31), (9, 18))),
    # Election week 2024, the second of the two.
    FomcMeeting("2024-11-07"),
    FomcMeeting("2024-12-18"),
    *_wednesdays(2025, ((1, 29), (3, 19), (5, 7), (6, 18), (7, 30), (9, 17), (10, 29), (12, 10))),
    *_wednesdays(2026, ((1, 28), (3, 18), (4, 29), (6, 17), (7, 29))),
)

#: The scheduled rows whose decision day is not a Wednesday, and why. A test
#: reads this rather than allowing any weekday, so a future typo cannot hide
#: behind a blanket exemption. Both are election weeks, which is the only
#: reason the Fed has moved a decision off Wednesday in this window.
NON_WEDNESDAY_SCHEDULED = {
    "2020-11-05": "the meeting ran Wed–Thu across the 2020 election",
    "2024-11-07": "the meeting ran Wed–Thu across the 2024 election",
}


def seed_rows(*, now_ms: int | None = None) -> list[dict[str, object]]:
    """The seed as event rows, oldest first, ending at `now_ms`.

    Every row is `verified_at: None`. A caller that reports a number built on
    these must say the calendar is unverified; there is deliberately no flag
    here that says otherwise, because the only thing that can set it is a
    fetch this module does not perform.
    """
    rows: list[dict[str, object]] = []
    for meeting in FOMC_SEED:
        release_at = _utc_ms(meeting.date, meeting.statement_et)
        if now_ms is not None and release_at > now_ms:
            continue
        call_at = _utc_ms(meeting.date, meeting.presser_et) if meeting.presser_et else None
        rows.append(
            {
                "kind": "fomc",
                "symbol": None,
                "source_ref": f"fed:{meeting.date}",
                "title": f"FOMC statement {meeting.date}",
                "release_at": release_at,
                "release_at_source": "fed_seed",
                "release_timing": "exact",
                "call_at": call_at,
                "call_at_source": "fed_seed" if call_at is not None else None,
                "call_offset_min": None if call_at is None else (call_at - release_at) / 60_000,
                "scheduled": meeting.scheduled,
                "verified_at": None,
                "statement_url": meeting.statement_url(),
            }
        )
    rows.sort(key=lambda row: row["release_at"])
    return rows


def weekday_of(meeting: FomcMeeting) -> int:
    """Monday is 0. Read off the ET calendar date, never off a UTC instant."""
    year, month, day = (int(part) for part in meeting.date.split("-"))
    return datetime(year, month, day, tzinfo=_ET).weekday()


__all__ = [
    "FED_CALENDAR_URL",
    "FED_STATEMENT_URL",
    "FOMC_SEED",
    "NON_WEDNESDAY_SCHEDULED",
    "FomcMeeting",
    "seed_rows",
    "weekday_of",
]
