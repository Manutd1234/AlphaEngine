"""Authored FOMC rows for deterministic diffusion tests only.

Production deliberately has no embedded meeting calendar.  These dates let
unit tests exercise daylight-saving conversion, emergency timing and paired
stage analysis without reaching the network or a user's event ledger.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

FED_STATEMENT_URL = (
    "https://www.federalreserve.gov/newsevents/pressreleases/monetary{stamp}a.htm"
)
_ET = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class FixtureMeeting:
    date: str
    statement_et: str = "14:00"
    presser_et: str | None = "14:30"
    scheduled: bool = True

    def statement_url(self) -> str:
        return FED_STATEMENT_URL.format(stamp=self.date.replace("-", ""))


def _meetings(year: int, days: tuple[tuple[int, int], ...]) -> tuple[FixtureMeeting, ...]:
    return tuple(
        FixtureMeeting(date=f"{year:04d}-{month:02d}-{day:02d}")
        for month, day in days
    )


FOMC_FIXTURE: tuple[FixtureMeeting, ...] = (
    *_meetings(2019, ((1, 30), (3, 20), (5, 1), (6, 19), (7, 31), (9, 18), (10, 30), (12, 11))),
    FixtureMeeting("2020-01-29"),
    FixtureMeeting("2020-03-03", "10:00", "11:00", False),
    FixtureMeeting("2020-03-15", "17:00", "18:00", False),
    *_meetings(2020, ((4, 29), (6, 10), (7, 29), (9, 16))),
    FixtureMeeting("2020-11-05"),
    FixtureMeeting("2020-12-16"),
    *_meetings(2021, ((1, 27), (3, 17), (4, 28), (6, 16), (7, 28), (9, 22), (11, 3), (12, 15))),
    *_meetings(2022, ((1, 26), (3, 16), (5, 4), (6, 15), (7, 27), (9, 21), (11, 2), (12, 14))),
    *_meetings(2023, ((2, 1), (3, 22), (5, 3), (6, 14), (7, 26), (9, 20), (11, 1), (12, 13))),
    *_meetings(2024, ((1, 31), (3, 20), (5, 1), (6, 12), (7, 31), (9, 18))),
    FixtureMeeting("2024-11-07"),
    FixtureMeeting("2024-12-18"),
    *_meetings(2025, ((1, 29), (3, 19), (5, 7), (6, 18), (7, 30), (9, 17), (10, 29), (12, 10))),
    *_meetings(2026, ((1, 28), (3, 18), (4, 29), (6, 17), (7, 29))),
)

NON_WEDNESDAY_SCHEDULED = {
    "2020-11-05": "the meeting ran Wed–Thu across the 2020 election",
    "2024-11-07": "the meeting ran Wed–Thu across the 2024 election",
}


def _utc_ms(date: str, hhmm: str) -> int:
    hour, minute = (int(part) for part in hhmm.split(":", 1))
    year, month, day = (int(part) for part in date.split("-"))
    local = datetime(year, month, day, hour, minute, tzinfo=_ET)
    return int(local.astimezone(timezone.utc).timestamp() * 1000)


def fixture_rows(*, now_ms: int | None = None) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for meeting in FOMC_FIXTURE:
        release_at = _utc_ms(meeting.date, meeting.statement_et)
        if now_ms is not None and release_at > now_ms:
            continue
        call_at = _utc_ms(meeting.date, meeting.presser_et) if meeting.presser_et else None
        rows.append({
            "kind": "fomc",
            "symbol": None,
            "source_ref": f"fed:{meeting.date}",
            "title": f"FOMC statement {meeting.date}",
            "release_at": release_at,
            "release_at_source": "issuer",
            "release_timing": "exact",
            "call_at": call_at,
            "call_at_source": "issuer" if call_at is not None else None,
            "call_offset_min": None if call_at is None else (call_at - release_at) / 60_000,
            "scheduled": meeting.scheduled,
            "verified_at": None,
            "statement_url": meeting.statement_url(),
        })
    return rows


def weekday_of(meeting: FixtureMeeting) -> int:
    year, month, day = (int(part) for part in meeting.date.split("-"))
    return datetime(year, month, day, tzinfo=_ET).weekday()
