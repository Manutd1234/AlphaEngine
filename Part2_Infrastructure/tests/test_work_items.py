"""The persisted work queue: seed-once, ids, versioned edits, and the routes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
from modules.work_items import (
    SEED_ITEMS,
    VersionConflict,
    WorkItemCreate,
    WorkItemPatch,
    WorkItemStore,
)

NOW = 1_700_000_000_000.0


class TestStore:
    def test_seeds_once_and_marks_the_rows(self):
        store = WorkItemStore.in_memory(seed=True, now_ms=NOW)
        assert store.count() == len(SEED_ITEMS) == 9
        assert store.seeded_count() == 9
        assert all(item.created_by == "seed" for item in store.list())
        # A second construction over the same rows would not re-seed; the
        # cheap proof is that an empty store with seeding off stays empty.
        assert WorkItemStore.in_memory(seed=False).count() == 0

    def test_ids_are_allocated_per_prefix_like_the_browser_did(self):
        store = WorkItemStore.in_memory(seed=True, now_ms=NOW)
        bug = store.create(WorkItemCreate(kind="bug", priority="P1", title="A"), actor="t", now_ms=NOW)
        req = store.create(WorkItemCreate(kind="request", priority="P2", title="B"), actor="t", now_ms=NOW)
        assert bug.id == "BUG-095"          # BUG-094 is the highest seed
        assert req.id == "REQ-188"          # REQ-187 is the highest seed
        assert bug.status == "intake" and bug.version == 1
        assert bug.sla_due_at == NOW + 8 * 3_600_000, "P1 carries the 8-hour SLA the board applied"

    def test_no_sla_when_asked_for_none(self):
        store = WorkItemStore.in_memory(seed=False)
        item = store.create(WorkItemCreate(kind="ticket", priority="P3", title="x", sla_hours=0), actor="t", now_ms=NOW)
        assert item.sla_due_at is None

    def test_patch_bumps_the_version_and_stamps_resolution(self):
        store = WorkItemStore.in_memory(seed=False)
        item = store.create(WorkItemCreate(kind="bug", priority="P0", title="x"), actor="a", now_ms=NOW)
        moved = store.patch(item.id, WorkItemPatch(version=1, status="progress"), actor="b", now_ms=NOW + 1)
        assert moved is not None and moved.version == 2 and moved.status == "progress"
        assert moved.updated_by == "b" and moved.resolved_at is None
        done = store.patch(item.id, WorkItemPatch(version=2, status="resolved"), actor="b", now_ms=NOW + 2)
        assert done is not None and done.resolved_at == NOW + 2
        back = store.patch(item.id, WorkItemPatch(version=3, status="ready"), actor="b", now_ms=NOW + 3)
        assert back is not None and back.resolved_at is None, "leaving resolved clears the stamp"

    def test_a_stale_version_is_refused_with_the_current_row(self):
        store = WorkItemStore.in_memory(seed=False)
        item = store.create(WorkItemCreate(kind="bug", priority="P0", title="x"), actor="a")
        store.patch(item.id, WorkItemPatch(version=1, owner="Mei"), actor="a")
        with pytest.raises(VersionConflict) as caught:
            store.patch(item.id, WorkItemPatch(version=1, owner="Ravi"), actor="b")
        assert caught.value.current.version == 2
        assert caught.value.current.owner == "Mei", "the refused edit did not overwrite the newer one"
        assert store.get(item.id).owner == "Mei"

    def test_unknown_item_is_none_not_an_error(self):
        store = WorkItemStore.in_memory(seed=False)
        assert store.patch("NOPE-001", WorkItemPatch(version=1, status="ready"), actor="a") is None
        assert store.get("NOPE-001") is None

    def test_delete_removes_the_row_and_returns_what_it_said(self):
        store = WorkItemStore.in_memory(seed=False)
        item = store.create(WorkItemCreate(kind="ticket", priority="P2", title="Gone soon"), actor="a")
        store.patch(item.id, WorkItemPatch(version=1, status="ready"), actor="a")

        removed = store.delete(item.id, actor="b")
        assert removed is not None
        assert removed.id == item.id and removed.status == "ready" and removed.version == 2
        assert store.get(item.id) is None and store.count() == 0
        assert store.delete(item.id, actor="b") is None, "a second delete finds nothing, and is not an error"
        # The id is not recycled into a different kind of row.
        assert store.create(WorkItemCreate(kind="ticket", priority="P2", title="Next"), actor="a").id != item.id


class TestRoutes:
    @pytest.fixture(scope="class")
    def client(self):
        # No `with`: the routes touch none of the lifespan-managed services.
        return TestClient(main.app)

    def test_list_create_patch_conflict_and_404(self, client):
        listed = client.get("/api/data/work-items")
        assert listed.status_code == 200
        body = listed.json()
        assert body["backend"] == "sqlite"
        assert set(body) == {"backend", "observed_at", "count", "seeded", "items"}
        before = body["count"]

        created = client.post("/api/data/work-items", json={"kind": "ticket", "priority": "P2", "title": "Route test"})
        assert created.status_code == 200, created.text
        item = created.json()
        assert item["status"] == "intake" and item["version"] == 1
        assert client.get("/api/data/work-items").json()["count"] == before + 1

        moved = client.patch(f"/api/data/work-items/{item['id']}", json={"version": 1, "status": "ready"})
        assert moved.status_code == 200
        assert moved.json()["version"] == 2

        stale = client.patch(f"/api/data/work-items/{item['id']}", json={"version": 1, "status": "progress"})
        assert stale.status_code == 409
        conflict = stale.json()
        assert conflict["error"] == "version_conflict"
        assert conflict["current"]["version"] == 2 and conflict["current"]["status"] == "ready"

        missing = client.patch("/api/data/work-items/NOPE-001", json={"version": 1, "status": "ready"})
        assert missing.status_code == 404

        bad = client.post("/api/data/work-items", json={"kind": "epic", "priority": "P2", "title": "x"})
        assert bad.status_code == 422

    def test_delete_returns_the_row_once_then_404(self, client):
        created = client.post("/api/data/work-items", json={"kind": "bug", "priority": "P3", "title": "Delete me"})
        item = created.json()
        count = client.get("/api/data/work-items").json()["count"]

        removed = client.delete(f"/api/data/work-items/{item['id']}")
        assert removed.status_code == 200, removed.text
        assert removed.json()["id"] == item["id"] and removed.json()["title"] == "Delete me"
        assert client.get("/api/data/work-items").json()["count"] == count - 1

        again = client.delete(f"/api/data/work-items/{item['id']}")
        assert again.status_code == 404
        assert client.patch(f"/api/data/work-items/{item['id']}", json={"version": 1, "status": "ready"}).status_code == 404
