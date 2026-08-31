"""The settlement index's formation process, and the minutes it has not published.

The design spec calls the per-station feed the standout of the settlement layer,
and the reason is narrow and checkable: the index arrives in two stages. Station
readings land first, quality control disposes of them, and only then is a value
published. Inside that window the next value is arithmetic on data the exchange
has already handed over.

Everything below is about not overclaiming that. The formation rule is evidence,
not an assumption; a pending reading is not a rejected one; and a missing minute
is a minute the index was not computed rather than one that went unreported.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.drivers.weather_qc import (
    MINUTE_MS,
    formation_check,
    parse_detailed,
    pending_minutes,
    quorum_gaps,
)


def station(station_id: str, temp: float | None, code: str = "ok") -> dict:
    return {"station_id": station_id, "source": "hf_asos", "temp_f": temp, "code": code,
            "received_at_ms": 1_787_502_240_000}


def minute(ts: int, value: float | None, codes: list[tuple[str, float, str]]) -> dict:
    row: dict = {"t": ts, "status": "normal" if value is not None else "incomplete",
                 "stations": [station(sid, temp, code) for sid, temp, code in codes]}
    if value is not None:
        row["v"] = value
        row["contributors"] = sum(1 for _, _, code in codes if code == "ok")
    return row


BASE = 1_787_502_240_000


class TestTheIncompleteMinutesAreTheWholePoint:
    def test_a_minute_with_no_published_value_is_kept_rather_than_dropped(self):
        """A parser that requires ``v`` discards exactly the rows that matter.

        The trailing minutes carry readings and no index. Dropping them leaves
        the feed looking like a plain history when it is a two-stage
        publication with a computable gap at the end.
        """
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.04, [("A", 91.4, "ok"), ("B", 90.68, "ok")]),
            minute(BASE + MINUTE_MS, None, [("A", 91.4, "pending"), ("B", 90.68, "pending")]),
        ]})
        assert len(minutes) == 2
        assert minutes[1].incomplete
        assert minutes[1].published is None

    def test_the_provisional_value_is_the_mean_of_the_readings_in_hand(self):
        minutes = parse_detailed({"timeseries": [
            minute(BASE, None, [("A", 91.4, "pending"), ("B", 90.6, "pending")]),
        ]})
        assert minutes[0].provisional() == Decimal("91.0")
        assert minutes[0].spread == Decimal("0.8")

    def test_a_rejected_reading_cannot_move_the_provisional_value_or_spread(self):
        minutes = parse_detailed({"timeseries": [
            minute(BASE, None, [
                ("A", 91.4, "pending"), ("B", 90.6, "pending"), ("C", 50.0, "rejected"),
            ]),
        ]})
        assert minutes[0].provisional() == Decimal("91.0")
        assert minutes[0].spread == Decimal("0.8")

    def test_a_minute_with_nothing_in_hand_has_no_provisional_rather_than_zero(self):
        """Zero on a temperature index is a reading, not an absence."""
        minutes = parse_detailed({"timeseries": [minute(BASE, None, [])]})
        assert minutes[0].provisional() is None
        assert minutes[0].spread is None

    def test_only_the_unpublished_minutes_are_offered_as_pending(self):
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.04, [("A", 91.4, "ok")]),
            minute(BASE + MINUTE_MS, None, [("A", 91.4, "pending")]),
        ]})
        assert [m.ts_ms for m in pending_minutes(minutes)] == [BASE + MINUTE_MS]


class TestTheFormationRuleIsEvidenceRatherThanAnAssumption:
    def test_a_rule_that_reproduces_every_published_minute_reports_that_it_holds(self):
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.0, [("A", 91.4, "ok"), ("B", 90.6, "ok")]),
            minute(BASE + MINUTE_MS, 90.0, [("A", 90.0, "ok"), ("B", 90.0, "ok")]),
        ]})
        found = formation_check(minutes)
        assert found.checked == 2
        assert found.agreed == 2
        assert found.holds
        assert "rests on evidence" in found.detail

    def test_a_rule_that_stops_reproducing_the_index_refuses_to_hold(self):
        """If the venue changes how it forms the index, a provisional value
        computed under the old rule is worse than none, so this must go loud."""
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.0, [("A", 91.4, "ok"), ("B", 90.6, "ok")]),
            minute(BASE + MINUTE_MS, 85.0, [("A", 90.0, "ok"), ("B", 90.0, "ok")]),
        ]})
        found = formation_check(minutes)
        assert found.checked == 2
        assert found.agreed == 1
        assert not found.holds
        assert found.worst_gap == Decimal("5.0")
        assert "should not be traded" in found.detail

    def test_stations_that_did_not_clear_quality_control_are_not_in_the_rule(self):
        """The published value is the mean of the OK stations; a dispositioned
        reading is excluded from the check exactly as it is from the index."""
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.4, [("A", 91.4, "ok"), ("B", 50.0, "rejected")]),
        ]})
        assert formation_check(minutes).holds


class TestAMissingMinuteIsAMinuteTheIndexWasNotComputed:
    def test_a_hole_in_the_timestamps_is_counted_rather_than_smoothed(self):
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.0, [("A", 91.0, "ok")]),
            minute(BASE + 3 * MINUTE_MS, 91.0, [("A", 91.0, "ok")]),
        ]})
        assert quorum_gaps(minutes) == 2

    def test_a_continuous_series_reports_no_gaps(self):
        minutes = parse_detailed({"timeseries": [
            minute(BASE, 91.0, [("A", 91.0, "ok")]),
            minute(BASE + MINUTE_MS, 91.0, [("A", 91.0, "ok")]),
        ]})
        assert quorum_gaps(minutes) == 0
