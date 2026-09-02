"""The production FOMC restore is narrow, reproducible, and insert-only."""

from __future__ import annotations

import json

import httpx
import pytest

from modules.coherence.diffusion.bootstrap import (
    ARTIFACT,
    DiffusionBootstrapError,
    load_artifact,
    restore_verified_fomc,
)
from modules.data_ops_postgrest import PostgrestStore
from modules.data_ops_store import SqliteStore


def test_committed_artifact_is_complete_and_self_verifying():
    artifact = load_artifact()
    assert artifact["manifest"]["counts"] == {
        "diffusion_events": 62,
        "diffusion_texts": 62,
        "diffusion_runs": 248,
        "diffusion_studies": 4,
    }
    tables = artifact["tables"]
    assert set(tables) == {
        "diffusion_events", "diffusion_texts", "diffusion_runs", "diffusion_studies",
    }
    assert all(row["release_at_source"] == "issuer" for row in tables["diffusion_events"])
    assert all(row["call_at_source"] == "estimated_offset" for row in tables["diffusion_events"])
    assert all(len(row["sha256"]) == 64 for row in tables["diffusion_texts"])
    assert all(len(row["data_hash"]) == 64 for row in tables["diffusion_runs"])
    assert sum(int(row["skill_meetings"] or 0) > 0 for row in tables["diffusion_studies"]) == 1
    provenance = artifact["manifest"]["provenance"]
    assert "estimated_offset" in provenance["call"]
    assert "discarded event row" in provenance["event_first_seen"]


def test_restore_creates_only_the_four_allowlisted_tables_and_is_idempotent():
    store = SqliteStore(":memory:")
    try:
        first = restore_verified_fomc(store)
        assert {name: item.restored for name, item in first.tables.items()} == {
            "diffusion_events": 62,
            "diffusion_texts": 62,
            "diffusion_runs": 248,
            "diffusion_studies": 4,
        }
        tables = {
            row["name"] for row in store.query(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        }
        assert tables == {
            "diffusion_events", "diffusion_texts", "diffusion_runs", "diffusion_studies",
        }

        second = restore_verified_fomc(store)
        assert all(item.restored == 0 for item in second.tables.values())
        assert all(item.already_present == item.expected for item in second.tables.values())
        assert store.count("diffusion_events") == 62
        assert store.count("diffusion_texts") == 62
        assert store.count("diffusion_runs") == 248
        assert store.count("diffusion_studies") == 4
    finally:
        store.close()


def test_gateway_readiness_restores_evidence_before_serving(monkeypatch):
    from modules import application_lifecycle, data_ops_backend
    from modules.coherence.fs import store as coherence_store

    target = SqliteStore(":memory:")

    class _Tape:
        @staticmethod
        def health():
            return {"state": "ok"}

    monkeypatch.setattr(data_ops_backend, "get_data_ops_store", lambda: target)
    monkeypatch.setattr(coherence_store, "get_store", lambda: _Tape())
    try:
        ready = application_lifecycle._prepare_backend_read_models()
        assert ready["diffusion_bootstrap"]["tables"]["diffusion_events"] == {
            "expected": 62,
            "already_present": 0,
            "restored": 62,
            "final_present": 62,
        }
        assert target.count("diffusion_runs") == 248
        assert target.count("diffusion_studies") == 4
    finally:
        target.close()


def test_gateway_readiness_stays_live_when_recorder_capacity_is_guarded(
    tmp_path, monkeypatch,
):
    from modules import application_lifecycle, data_ops_backend
    from modules.coherence import tunables
    from modules.coherence.fs import store as coherence_store
    from modules.coherence.fs.store import CoherenceStore

    target = SqliteStore(":memory:")
    tape = CoherenceStore(tmp_path / "coherence.duckdb")
    free = tape.storage_status()["disk_free_bytes"]
    monkeypatch.setattr(tunables, "MIN_FREE_BYTES", int(free) + 1)
    monkeypatch.setattr(tunables, "MAX_TAPE_BYTES", 0)
    monkeypatch.setattr(tunables, "RETENTION_DAYS", 0)
    monkeypatch.setattr(data_ops_backend, "get_data_ops_store", lambda: target)
    monkeypatch.setattr(coherence_store, "get_store", lambda: tape)
    try:
        ready = application_lifecycle._prepare_backend_read_models()
        health = tape.health()
        assert ready["coherence_tape"] == "ok"
        assert health["state"] == "ok"
        assert health["storage"]["state"] == "guarded"
    finally:
        tape.close()
        target.close()


def test_restored_rows_reach_every_diagram_api_read_model(monkeypatch):
    from modules.api import diffusion as diffusion_api
    from modules.coherence.diffusion.events import DiffusionEventStore
    from modules.coherence.diffusion.findings import collect as collect_findings
    from modules.coherence.diffusion.runs import AbsorptionRunStore
    from modules.coherence.diffusion.studies import DiffusionStudyStore
    from modules.coherence.diffusion.texts import DiffusionTextStore

    target = SqliteStore(":memory:")
    try:
        restore_verified_fomc(target)
        events = DiffusionEventStore(target)
        runs = AbsorptionRunStore(target)
        texts = DiffusionTextStore(target)
        studies = DiffusionStudyStore(target)
        monkeypatch.setattr(diffusion_api, "_store", lambda: events)
        monkeypatch.setattr(diffusion_api, "_runs", lambda: runs)

        calendar = diffusion_api._read_events("fomc", None, 200)
        absorption = diffusion_api._read_absorption(600, None)
        assert calendar.state == "ok" and len(calendar.events) == 62
        assert absorption.state == "ok" and len(absorption.runs) == 248
        assert absorption.horizons
        by_stage = {stage.stage: stage for stage in absorption.stages}
        assert by_stage["release"].measured == 42
        assert by_stage["call"].measured == 47
        assert sum(stage.no_signal for stage in absorption.stages) == 159
        findings = collect_findings(
            runs_store=runs, text_store=texts, study_store=studies,
        )
        assert findings["study"]["study_id"] == "prior:guidance:d10:s7"
        assert findings["study"]["skill_meetings"] == 57
        assert findings["gate"]["state"] == "passed"
        assert len(findings["findings"]) == 14
    finally:
        target.close()


def test_postgrest_restore_is_tenant_stamped_and_resumable():
    rows: dict[str, dict[str, dict]] = {
        "diffusion_events": {}, "diffusion_texts": {}, "diffusion_runs": {},
        "diffusion_studies": {},
    }
    posts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        table = request.url.path.rsplit("/", 1)[-1]
        assert table in rows, "the bootstrap must never touch an operational table"
        key = {
            "diffusion_events": "source_ref",
            "diffusion_texts": "text_id",
            "diffusion_runs": "run_id",
            "diffusion_studies": "study_id",
        }[table]
        if request.method == "GET":
            selected = request.url.params["select"].split(",")
            candidates = list(rows[table].values())
            if request.url.params.get(key):
                wanted = request.url.params[key].removeprefix("eq.")
                candidates = [row for row in candidates if str(row[key]) == wanted]
            body = [
                row if selected == ["*"] else {field: row[field] for field in selected}
                for row in candidates[:int(request.url.params.get("limit", len(candidates)))]
            ]
            return httpx.Response(200, json=body)
        posts.append(request)
        for row in json.loads(request.content):
            assert row["desk_id"] == "production-desk"
            rows[table].setdefault(str(row[key]), row)
        return httpx.Response(201, json=[])

    target = PostgrestStore(
        "https://example.supabase.co", "service-role", desk_id="production-desk",
    )
    target._client.close()  # noqa: SLF001 - replace the transport under test
    target._client = httpx.Client(  # noqa: SLF001 - the adapter seam under test
        base_url="https://example.supabase.co/rest/v1",
        headers={"apikey": "service-role", "Authorization": "Bearer service-role"},
        transport=httpx.MockTransport(handler),
    )
    try:
        first = restore_verified_fomc(target)
        assert [item.restored for item in first.tables.values()] == [62, 62, 248, 4]
        assert len(posts) == 4
        assert all("resolution=ignore-duplicates" in request.headers["Prefer"] for request in posts)
        assert all(request.url.params["on_conflict"].startswith("desk_id,") for request in posts)
        second = restore_verified_fomc(target)
        assert all(item.restored == 0 for item in second.tables.values())
        assert len(posts) == 4, "a complete retry must perform no writes"
    finally:
        target.close()


def test_partial_restore_resumes_without_overwriting_newer_live_evidence():
    store = SqliteStore(":memory:")
    try:
        restore_verified_fomc(store)
        event_key = "fed:2019-01-30"
        text_key = f"{event_key}|release|statement"
        run_key = f"{event_key}|BTCUSDT|release"
        store.patch(
            "diffusion_events", filters={"source_ref": event_key},
            patch={
                "call_at": 1548877500000.0,
                "call_at_source": "recorded",
                "call_offset_min": 45.0,
            },
        )
        store.patch(
            "diffusion_texts", filters={"text_id": text_key},
            patch={"fetched_at": 9_999_999_999_999.0},
        )
        store.patch(
            "diffusion_runs", filters={"run_id": run_key},
            patch={"signal_reason": "newer live recomputation"},
        )
        for table, key, value in (
            ("diffusion_events", "source_ref", "fed:2026-07-29"),
            ("diffusion_texts", "text_id", "fed:2026-07-29|release|statement"),
            ("diffusion_runs", "run_id", "fed:2026-07-29|ETHUSDT|call"),
        ):
            assert store.remove(table, filters={key: value}) == 1

        resumed = restore_verified_fomc(store)
        assert {name: item.restored for name, item in resumed.tables.items()} == {
            "diffusion_events": 1,
            "diffusion_texts": 1,
            "diffusion_runs": 1,
            "diffusion_studies": 0,
        }
        event = store.fetch_one("diffusion_events", filters={"source_ref": event_key})
        text = store.fetch_one("diffusion_texts", filters={"text_id": text_key})
        run = store.fetch_one("diffusion_runs", filters={"run_id": run_key})
        assert event and event["call_at_source"] == "recorded" and event["call_offset_min"] == 45.0
        assert text and text["fetched_at"] == 9_999_999_999_999.0
        assert run and run["signal_reason"] == "newer live recomputation"
    finally:
        store.close()


def test_restore_backfills_only_the_missing_score_on_matching_legacy_study():
    store = SqliteStore(":memory:")
    try:
        restore_verified_fomc(store)
        study_id = "prior:guidance:d10:s7"
        store.patch(
            "diffusion_studies",
            filters={"study_id": study_id},
            patch={
                "skill_meetings": 0,
                "skill_baseline_r2": None,
                "skill_gain": None,
                "skill_shuffled_p": None,
                "skill_stage_minutes": None,
            },
        )

        resumed = restore_verified_fomc(store)
        assert resumed.tables["diffusion_studies"].restored == 0
        study = store.fetch_one("diffusion_studies", filters={"study_id": study_id})
        assert study and study["skill_meetings"] == 57
        assert study["skill_baseline_r2"] is not None
        assert study["skill_gain"] is not None
        assert study["skill_shuffled_p"] is not None
        assert study["skill_stage_minutes"] is not None
    finally:
        store.close()


def test_a_true_existing_identity_conflict_fails_closed_without_overwrite():
    store = SqliteStore(":memory:")
    try:
        restore_verified_fomc(store)
        key = "fed:2019-01-30"
        original = store.fetch_one("diffusion_events", filters={"source_ref": key})
        assert original is not None
        conflicting = float(original["release_at"]) + 60_000.0
        store.patch(
            "diffusion_events", filters={"source_ref": key}, patch={"release_at": conflicting},
        )
        with pytest.raises(DiffusionBootstrapError, match="identity conflict"):
            restore_verified_fomc(store)
        after = store.fetch_one("diffusion_events", filters={"source_ref": key})
        assert after and after["release_at"] == conflicting
    finally:
        store.close()


def test_payload_tampering_is_refused_before_a_store_is_touched(tmp_path):
    artifact = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    artifact["tables"]["diffusion_texts"][0]["body"] += "tampered"
    tampered = tmp_path / "tampered.json"
    tampered.write_text(json.dumps(artifact), encoding="utf-8")
    with pytest.raises(DiffusionBootstrapError, match="checksum"):
        restore_verified_fomc(SqliteStore(":memory:"), artifact_path=tampered)
