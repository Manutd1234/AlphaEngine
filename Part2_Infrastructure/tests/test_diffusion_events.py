"""The event ledger keeps two clocks apart, and its reads say what they are.

Every assertion here is about a distinction the table exists to preserve: the
vendor's timestamp against the desk's, an empty ledger against an unreachable
one, and a page that was cut short against one that reached the end.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from helpers.diffusion_fomc_fixture import fixture_rows

from modules.coherence.diffusion.events import DiffusionEventStore, EventUpsert
from modules.data_ops_store import SqliteStore

NOW = 1_700_000_000_000.0


@pytest.fixture()
def store():
    path = Path(tempfile.mkdtemp()) / "diffusion.sqlite"
    made = DiffusionEventStore(SqliteStore(str(path)))
    try:
        yield made
    finally:
        made.close()


def _seed(store: DiffusionEventStore, count: int = 5, *, now: float = NOW) -> list[dict]:
    rows = fixture_rows()[:count]
    for row in rows:
        store.upsert(EventUpsert(
            kind="fomc", source_ref=row["source_ref"], title=row["title"],
            release_at=row["release_at"], release_at_source="issuer", release_timing="exact",
            call_at=row["call_at"], call_at_source="issuer",
            call_offset_min=row["call_offset_min"], scheduled=row["scheduled"],
            statement_url=row["statement_url"],
        ), now_ms=now)
    return rows


class TestFirstSeenSurvivesEverything:
    def test_a_revised_vendor_stamp_moves_the_stamp_and_counts_the_revision(self, store):
        _seed(store, 1)
        before = store.get("fed:2019-01-30")
        store.upsert(EventUpsert(kind="fomc", source_ref="fed:2019-01-30", title="FOMC statement",
                                 release_at=before["release_at"] + 120_000,
                                 release_at_source="issuer"), now_ms=NOW + 5_000)
        after = store.get("fed:2019-01-30")
        assert after["first_seen_at"] == before["first_seen_at"], "the point-in-time clock moved"
        assert after["release_at"] == before["release_at"] + 120_000
        assert after["revised_count"] == 1
        assert after["last_seen_at"] > before["last_seen_at"]

    def test_a_repeat_of_the_same_row_is_not_a_revision(self, store):
        rows = _seed(store, 1)
        store.upsert(EventUpsert(kind="fomc", source_ref=rows[0]["source_ref"], title=rows[0]["title"],
                                 release_at=rows[0]["release_at"], release_at_source="issuer"),
                     now_ms=NOW + 5_000)
        assert store.get(rows[0]["source_ref"])["revised_count"] == 0

    def test_a_later_row_fills_a_field_the_first_one_lacked(self, store):
        store.upsert(EventUpsert(kind="earnings", source_ref="yf:AAPL:2026-10-29", title="Apple",
                                 release_at=NOW, release_at_source="vendor"), now_ms=NOW)
        store.upsert(EventUpsert(kind="earnings", source_ref="yf:AAPL:2026-10-29", title="Apple",
                                 release_at=NOW, release_at_source="vendor",
                                 release_timing="AMC", eps_estimate=1.23), now_ms=NOW + 1)
        row = store.get("yf:AAPL:2026-10-29")
        assert row["release_timing"] == "AMC" and row["eps_estimate"] == 1.23


class TestTheSecondStageKnowsWhereItCameFrom:
    def test_recording_a_call_start_replaces_the_assumption_and_says_so(self, store):
        _seed(store, 1)
        observed = store.get("fed:2019-01-30")["release_at"] + 45 * 60_000
        row = store.record_stage("fed:2019-01-30", at_ms=observed, now_ms=NOW + 10)
        assert row["call_at"] == observed
        assert row["call_at_source"] == "recorded"
        assert row["call_offset_min"] == pytest.approx(45.0)

    def test_recording_against_a_row_that_is_not_there_is_none_not_a_new_row(self, store):
        assert store.record_stage("fed:1970-01-01", at_ms=NOW, now_ms=NOW) is None
        assert store.count() == 0

    def test_recording_rejects_the_retired_authored_source(self, store):
        _seed(store, 1)
        with pytest.raises(ValueError, match="unsupported recorded stage source"):
            store.record_stage(
                "fed:2019-01-30",
                at_ms=NOW,
                source="fed_seed",  # type: ignore[arg-type]
                now_ms=NOW,
            )


class TestAListSaysWhetherItWasCutShort:
    def test_a_full_page_is_not_marked_truncated(self, store):
        _seed(store, 3)
        rows, truncated = store.list_events(limit=10)
        assert len(rows) == 3 and truncated is False

    def test_a_clipped_page_says_so(self, store):
        _seed(store, 5)
        rows, truncated = store.list_events(limit=2)
        assert len(rows) == 2
        assert truncated is True, "a page cut short and silent reads as a complete answer"

    def test_rows_come_back_oldest_first(self, store):
        _seed(store, 5)
        rows, _ = store.list_events(limit=10)
        assert [row["release_at"] for row in rows] == sorted(row["release_at"] for row in rows)

    def test_a_kind_filter_narrows_without_hiding_the_count(self, store):
        _seed(store, 3)
        store.upsert(EventUpsert(kind="earnings", source_ref="yf:AAPL:1", title="Apple",
                                 release_at=NOW, release_at_source="vendor"), now_ms=NOW)
        fomc_rows, _ = store.list_events(kind="fomc", limit=10)
        earnings_rows, _ = store.list_events(kind="earnings", limit=10)
        assert len(fomc_rows) == 3 and len(earnings_rows) == 1


class TestObservedRowsDoNotClaimVerificationWithoutEvidence:
    def test_fixture_rows_remain_unverified(self, store):
        _seed(store, 5)
        rows, _ = store.list_events(limit=10)
        assert all(row["verified_at"] is None for row in rows)

    def test_the_timing_word_is_kept_verbatim(self, store):
        _seed(store, 1)
        assert store.get("fed:2019-01-30")["release_timing"] == "exact"


class TestAuthoredRuntimeRowsAreRefused:
    def test_new_rows_reject_the_retired_seed_source(self):
        with pytest.raises(ValueError, match="unsupported release stage source"):
            EventUpsert(
                kind="fomc",
                source_ref="fed:fixture",
                title="authored row",
                release_at=NOW,
                release_at_source="fed_seed",  # type: ignore[arg-type]
            )

    def test_legacy_rows_in_a_durable_store_are_hidden(self, store):
        _seed(store, 1)
        store._store.patch(  # noqa: SLF001 - simulate a pre-migration durable row
            "diffusion_events",
            filters={"source_ref": "fed:2019-01-30"},
            patch={"release_at_source": "fed_seed"},
        )
        rows, truncated = store.list_events(limit=10)
        assert rows == [] and truncated is False
        assert store.get("fed:2019-01-30") is None
        assert store.count() == 0

    def test_a_legacy_call_is_withheld_from_an_otherwise_observed_row(self, store):
        _seed(store, 1)
        store._store.patch(  # noqa: SLF001 - simulate a partially migrated row
            "diffusion_events",
            filters={"source_ref": "fed:2019-01-30"},
            patch={"call_at_source": "fed_seed"},
        )
        row = store.get("fed:2019-01-30")
        assert row is not None
        assert (row["call_at"], row["call_at_source"], row["call_offset_min"]) == (None, None, None)

    def test_an_ordinary_upsert_repairs_a_legacy_call_before_patching(self, store):
        _seed(store, 1)
        store._store.patch(  # noqa: SLF001 - simulate a partially migrated row
            "diffusion_events",
            filters={"source_ref": "fed:2019-01-30"},
            patch={"call_at_source": "fed_seed"},
        )

        row = store.upsert(
            EventUpsert(
                kind="fomc", source_ref="fed:2019-01-30", title="Observed event",
                release_at=store.get("fed:2019-01-30")["release_at"],
                release_at_source="issuer",
            ),
            now_ms=NOW + 1,
        )

        assert (row["call_at"], row["call_at_source"], row["call_offset_min"]) == (None, None, None)

    def test_an_issuer_observation_replaces_a_legacy_row_wholesale(self, store):
        _seed(store, 1)
        old = store._store.fetch_one(  # noqa: SLF001 - inspect the simulated legacy row
            "diffusion_events", filters={"source_ref": "fed:2019-01-30"},
        )
        store._store.patch(  # noqa: SLF001
            "diffusion_events",
            filters={"source_ref": "fed:2019-01-30"},
            patch={"release_at_source": "fed_seed", "call_at_source": "fed_seed"},
        )
        replacement = EventUpsert(
            kind="fomc", source_ref="fed:2019-01-30", title="Observed issuer event",
            release_at=old["release_at"], release_at_source="issuer",
        )
        row = store.upsert(replacement, now_ms=NOW + 5_000)
        assert row["first_seen_at"] == NOW + 5_000
        assert row["call_at"] is None and row["statement_url"] is None
        assert store.get("fed:2019-01-30")["release_at_source"] == "issuer"
