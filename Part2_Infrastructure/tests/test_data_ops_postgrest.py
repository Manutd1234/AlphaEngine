"""The PostgREST data-ops store, against a mock transport and (if configured) live.

CI is deliberately network-free, so the substance is tested against
`httpx.MockTransport`: it asserts the REQUEST this store builds, which is where
the SQLite-to-PostgREST translation actually lives. A test that only checked
the parsed response would pass with the `Prefer` header missing entirely.

The live pass is opt-in and **skips with a stated reason** rather than passing
silently. A green suite that never reached Postgres, reported as a green
Postgres suite, is the failure this file is written to avoid.
"""

from __future__ import annotations

import json
import os

import httpx
import pytest

from modules.data_ops_postgrest import PostgrestError, PostgrestStore

SEEN: list[httpx.Request] = []


def _store(handler) -> PostgrestStore:
    store = PostgrestStore("https://example.supabase.co", "service-key", desk_id="desk-1")
    store._client = httpx.Client(
        base_url="https://example.supabase.co/rest/v1",
        headers=dict(store._client.headers),
        transport=httpx.MockTransport(handler),
    )
    return store


def _ok(body, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        SEEN.append(request)
        return httpx.Response(status, json=body)
    return handler


@pytest.fixture(autouse=True)
def _clear():
    SEEN.clear()
    yield


class TestTheRequestItBuilds:
    def test_every_read_is_desk_scoped_without_the_caller_saying_so(self):
        store = _store(_ok([]))
        store.fetch("data_work_items", filters={"status": "intake"})
        params = SEEN[0].url.params
        assert params["desk_id"] == "eq.desk-1", (
            "a store that can be asked for another desk's rows by forgetting a "
            "filter is the tenancy bug this scoping exists to make impossible"
        )
        assert params["status"] == "eq.intake"

    def test_insert_stamps_the_desk_and_asks_for_nothing_back_by_default(self):
        store = _store(_ok([], status=201))
        store.add("data_schedule_runs", {"schedule_id": "s1"})
        body = json.loads(SEEN[0].content)
        assert body[0]["desk_id"] == "desk-1"
        assert SEEN[0].headers["Prefer"] == "return=minimal"

    def test_returning_asks_for_the_representation(self):
        store = _store(_ok([{"id": 7}], status=201))
        rows = store.add("data_quality_findings", {"seq": 1}, returning=True)
        assert SEEN[0].headers["Prefer"] == "return=representation"
        assert rows == [{"id": 7}], "this is the lastrowid equivalent and must carry the row"

    def test_upsert_sends_the_resolution_postgrest_needs(self):
        store = _store(_ok([], status=201))
        store.add(
            "data_schedule_runs", {"schedule_id": "s1"},
            on_conflict="schedule_id", resolution="merge-duplicates",
        )
        assert "resolution=merge-duplicates" in SEEN[0].headers["Prefer"]
        assert SEEN[0].url.params["on_conflict"] == "desk_id,schedule_id"

    def test_a_versioned_update_is_a_compare_and_swap(self):
        """The version goes in the filter, so a stale writer changes nothing."""
        store = _store(_ok([]))
        changed = store.patch(
            "data_work_items", filters={"id": "BUG-095", "version": 3},
            patch={"status": "resolved", "version": 4},
        )
        assert SEEN[0].url.params["version"] == "eq.3"
        assert changed == [], (
            "no rows came back, which is exactly how the caller learns its "
            "version no longer held — SQLite read the same fact off rowcount "
            "under a lock this does not need"
        )

    def test_a_filter_may_carry_its_own_operator(self):
        store = _store(_ok([]))
        store.fetch("data_quality_escalations", filters={"resolved_at": "is.null"})
        assert SEEN[0].url.params["resolved_at"] == "is.null"


class TestItRefusesQuietly:
    def test_a_4xx_raises_rather_than_reading_as_no_rows(self):
        store = _store(_ok({"message": "bad"}, status=400))
        with pytest.raises(PostgrestError):
            store.fetch("data_work_items")

    def test_the_error_never_carries_the_key_or_the_url(self):
        def boom(_request):
            raise httpx.ConnectError("failed to connect to db.example.supabase.co")

        store = _store(boom)
        with pytest.raises(PostgrestError) as caught:
            store.fetch("data_work_items")
        assert "service-key" not in str(caught.value)
        assert "supabase.co" not in str(caught.value)

    def test_a_non_json_2xx_raises_rather_than_returning_nothing(self):
        def html(request):
            SEEN.append(request)
            return httpx.Response(200, text="<html>proxy error</html>")

        store = _store(html)
        with pytest.raises(PostgrestError):
            store.fetch("data_work_items")

    def test_migrate_does_not_issue_ddl(self):
        store = _store(_ok([]))
        store.migrate(["CREATE TABLE x (id int)"])
        assert SEEN == [], "the schema is owned by supabase/migrations, not by this process"


@pytest.mark.skipif(
    not (os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
    reason=(
        "no SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in the environment, so the "
        "Postgres backend was NOT exercised. This skip is the honest report: a "
        "silent pass here would say the Postgres path works when nothing ran."
    ),
)
class TestAgainstTheRealProject:
    def test_the_four_tables_are_reachable(self):
        store = PostgrestStore(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        for table in (
            "data_quality_findings", "data_quality_escalations",
            "data_schedule_runs", "data_work_items",
        ):
            store.fetch(table, limit=1)
        store.close()
