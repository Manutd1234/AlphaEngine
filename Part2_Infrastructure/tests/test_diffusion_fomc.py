"""The test-only FOMC fixture remains structurally useful and clearly isolated.

Production reads its event ledger and contains no authored meeting list. What
can still be tested without a network is the fixture's clock shape: emergency
hours and daylight shifts must survive the runner's calculations.
"""

from __future__ import annotations

from datetime import datetime, timezone
from importlib.util import find_spec

from helpers import diffusion_fomc_fixture as fixture


def test_production_package_has_no_authored_fomc_calendar_module():
    assert find_spec("modules.coherence.diffusion.fomc") is None


class TestTheCalendarShapeHolds:
    def test_every_scheduled_decision_is_a_wednesday_or_a_documented_exception(self):
        stray = [
            meeting.date for meeting in fixture.FOMC_FIXTURE
            if meeting.scheduled
            and fixture.weekday_of(meeting) != 2
            and meeting.date not in fixture.NON_WEDNESDAY_SCHEDULED
        ]
        assert stray == [], f"undocumented non-Wednesday decision days: {stray}"

    def test_both_documented_exceptions_are_election_weeks(self):
        assert set(fixture.NON_WEDNESDAY_SCHEDULED) == {"2020-11-05", "2024-11-07"}
        for reason in fixture.NON_WEDNESDAY_SCHEDULED.values():
            assert "election" in reason

    def test_dates_are_unique_and_ordered_by_the_seed_row_builder(self):
        dates = [meeting.date for meeting in fixture.FOMC_FIXTURE]
        assert len(set(dates)) == len(dates)
        rows = fixture.fixture_rows()
        stamps = [row["release_at"] for row in rows]
        assert stamps == sorted(stamps)

    def test_the_two_emergency_meetings_keep_their_own_hours(self):
        by_date = {meeting.date: meeting for meeting in fixture.FOMC_FIXTURE}
        march_three = by_date["2020-03-03"]
        march_fifteen = by_date["2020-03-15"]
        assert (march_three.statement_et, march_three.presser_et) == ("10:00", "11:00")
        assert (march_fifteen.statement_et, march_fifteen.presser_et) == ("17:00", "18:00")
        assert not march_three.scheduled and not march_fifteen.scheduled
        assert fixture.weekday_of(march_fifteen) == 6, "15 March 2020 was a Sunday"


class TestTheClockIsNewYorkNotUtc:
    @staticmethod
    def _utc_hour(source_ref: str) -> int:
        row = next(row for row in fixture.fixture_rows() if row["source_ref"] == source_ref)
        return datetime.fromtimestamp(row["release_at"] / 1000, timezone.utc).hour

    def test_a_winter_meeting_is_five_hours_behind_utc(self):
        assert self._utc_hour("fed:2019-01-30") == 19

    def test_a_summer_meeting_is_four(self):
        assert self._utc_hour("fed:2019-03-20") == 18, (
            "a fixed offset would put every summer statement an hour early"
        )


class TestTheRowsRefuseToClaimVerification:
    def test_no_row_is_marked_verified(self):
        assert all(row["verified_at"] is None for row in fixture.fixture_rows())

    def test_every_row_carries_the_url_that_would_falsify_it(self):
        for row in fixture.fixture_rows():
            url = row["statement_url"]
            assert url.startswith("https://www.federalreserve.gov/")
            assert row["source_ref"].removeprefix("fed:").replace("-", "") in url

    def test_the_scheduled_gap_is_thirty_minutes_and_is_recorded_per_row(self):
        rows = {row["source_ref"]: row for row in fixture.fixture_rows()}
        assert rows["fed:2019-01-30"]["call_offset_min"] == 30.0
        assert rows["fed:2020-03-03"]["call_offset_min"] == 60.0

    def test_the_future_is_not_seeded(self):
        cutoff = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
        rows = fixture.fixture_rows(now_ms=cutoff)
        assert rows and all(row["release_at"] <= cutoff for row in rows)
        assert len(rows) == 8, "2019 held eight scheduled meetings"
