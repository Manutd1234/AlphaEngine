"""The diffusion routes, read off the HTTP body rather than off a report object.

The rule this file follows is the one `tests/test_research_search_route.py`
records: assert on what the client receives. A handler can compute a field
correctly and a response model can drop it, and a test that inspects the
handler's return value sees the first and not the second.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers.diffusion_fomc_fixture import fixture_rows

import main
from modules.api import diffusion as diffusion_api
from modules.coherence.diffusion.events import DiffusionEventStore, EventUpsert
from modules.data_ops_store import SqliteStore

NOW = 1_700_000_000_000.0


@pytest.fixture()
def client(monkeypatch):
    path = Path(tempfile.mkdtemp()) / "routes.sqlite"
    store = DiffusionEventStore(SqliteStore(str(path)))
    monkeypatch.setattr(diffusion_api, "_store", lambda: store)
    with TestClient(main.app) as made:
        yield made, store
    store.close()


def _seed(store: DiffusionEventStore, count: int = 3) -> None:
    for row in fixture_rows()[:count]:
        store.upsert(EventUpsert(
            kind="fomc", source_ref=row["source_ref"], title=row["title"],
            release_at=row["release_at"], release_at_source="issuer", release_timing="exact",
            call_at=row["call_at"], call_at_source="issuer",
            call_offset_min=row["call_offset_min"], statement_url=row["statement_url"],
        ), now_ms=NOW)


class TestAnEmptyLedgerIsNotAnUnavailableOne:
    def test_no_rows_is_ok_with_an_empty_list(self, client):
        made, _store = client
        body = made.get("/api/research/diffusion/events").json()
        assert body["state"] == "ok"
        assert body["events"] == []
        assert body["backend"] == "sqlite"

    def test_a_store_that_cannot_be_opened_is_unavailable_with_a_reason(self, client, monkeypatch):
        made, _store = client

        def boom():
            raise RuntimeError("no data-ops store is configured")

        monkeypatch.setattr(diffusion_api, "_store", boom)
        body = made.get("/api/research/diffusion/events").json()
        assert body["state"] == "unavailable"
        assert "configured" in body["reason"]
        assert body["events"] == []


class TestTheRowsArriveWhole:
    def test_both_stages_and_both_clocks_are_on_the_wire(self, client):
        made, store = client
        _seed(store)
        body = made.get("/api/research/diffusion/events").json()
        assert body["state"] == "ok" and len(body["events"]) == 3
        first = body["events"][0]
        assert first["source_ref"] == "fed:2019-01-30"
        assert first["release_at"].startswith("2019-01-30T19:00")
        assert first["call_at"].startswith("2019-01-30T19:30")
        assert first["release_timing"] == "exact"
        assert first["call_offset_min"] == 30.0
        assert first["first_seen_at"] is not None
        assert first["verified_at"] is None

    def test_the_truncated_flag_reaches_the_client(self, client):
        made, store = client
        _seed(store, 3)
        body = made.get("/api/research/diffusion/events?limit=1").json()
        assert len(body["events"]) == 1
        assert body["truncated"] is True

    def test_a_kind_filter_is_honoured(self, client):
        made, store = client
        _seed(store, 2)
        assert made.get("/api/research/diffusion/events?kind=earnings").json()["events"] == []
        assert len(made.get("/api/research/diffusion/events?kind=fomc").json()["events"]) == 2

    def test_a_bad_kind_is_refused_by_the_pattern(self, client):
        made, _store = client
        assert made.get("/api/research/diffusion/events?kind=nonsense").status_code == 422


class TestRecordingAStage:
    def test_an_observed_call_start_replaces_the_prior_stage_and_names_its_source(self, client):
        made, store = client
        _seed(store, 1)
        response = made.post(
            "/api/research/diffusion/events/fed:2019-01-30/stage",
            json={"at": "2019-01-30T19:45:00Z", "source": "recorded"},
        )
        body = response.json()
        assert body["state"] == "ok"
        assert body["event"]["call_at"].startswith("2019-01-30T19:45")
        assert body["event"]["call_at_source"] == "recorded"
        assert body["event"]["call_offset_min"] == 45.0

    def test_an_unknown_event_is_not_found_rather_than_created(self, client):
        made, store = client
        response = made.post("/api/research/diffusion/events/fed:1970-01-01/stage",
                             json={"at": "1970-01-01T00:30:00Z"})
        assert response.json()["state"] == "not_found"
        assert store.count() == 0
