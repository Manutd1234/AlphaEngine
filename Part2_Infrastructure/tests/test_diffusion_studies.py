"""The study ledger has to be able to record a failure as clearly as a success.

The reason this table exists is that a null result which lives only in a
console gets rediscovered, and rediscovery drifts towards whichever seed
finally produces a t of two. So the tests here are mostly about the unhappy
paths: a refused run still files a row, a run whose representation failed the
gate is marked as such rather than left blank, and re-running the same
configuration replaces its row instead of quietly adding a second opinion.
"""

from __future__ import annotations

import pytest

from modules.coherence.diffusion.studies import DiffusionStudyStore, Study, as_study
from modules.data_ops_store import SqliteStore


@pytest.fixture()
def store(tmp_path):
    backing = SqliteStore(str(tmp_path / "studies.sqlite"))
    ledger = DiffusionStudyStore(backing, desk_id="test")
    yield ledger
    ledger.close()


def _study(**overrides) -> Study:
    base = dict(study_id="prior:decision:d10:s7", conditioning="prior", segment="decision",
                latent_dim=10, events=61, state="ok", verdict="does_not_predict",
                gate_state="passed", gate_r_squared=0.71, gate_floor=0.2,
                gate_fact="the policy move in basis points", gate_samples=61)
    return Study(**{**base, **overrides})


def test_a_null_result_is_kept(store: DiffusionStudyStore) -> None:
    store.record(_study(), ran_at=1.0)
    latest = store.latest()
    assert latest is not None
    assert latest["verdict"] == "does_not_predict"
    assert latest["events"] == 61


def test_a_refusal_is_a_row_not_an_absence(store: DiffusionStudyStore) -> None:
    """"The encoder was missing" and "it ran and found nothing" must differ."""
    store.record(_study(study_id="refused", state="refused", verdict=None, events=0,
                        verdict_reason="no statement has been fetched"), ran_at=2.0)
    rows, _ = store.list_studies()
    assert [row["state"] for row in rows] == ["refused"]
    assert rows[0]["verdict"] is None
    assert "no statement" in rows[0]["verdict_reason"]


def test_rerunning_the_same_question_replaces_its_row(store: DiffusionStudyStore) -> None:
    store.record(_study(gate_r_squared=0.10, gate_state="failed"), ran_at=1.0)
    store.record(_study(gate_r_squared=0.71, gate_state="passed"), ran_at=2.0)
    rows, _ = store.list_studies()
    assert len(rows) == 1
    assert rows[0]["gate_state"] == "passed"


def test_a_different_configuration_is_a_different_row(store: DiffusionStudyStore) -> None:
    store.record(_study(), ran_at=1.0)
    store.record(_study(study_id="prior:whole:d10:s7", segment=None, gate_state="failed",
                        gate_r_squared=-0.60), ran_at=2.0)
    rows, _ = store.list_studies()
    assert len(rows) == 2
    assert store.latest()["gate_state"] == "failed", "newest first"


def test_best_prefers_a_complete_out_of_sample_score(store: DiffusionStudyStore) -> None:
    store.record(_study(
        study_id="prior:decision:d6:s7", latent_dim=6,
        gate_r_squared=0.74, effective_rank=9.99, centroid_spread=0.92,
    ), ran_at=2.0)
    store.record(_study(
        study_id="prior:guidance:d10:s7", segment="guidance",
        gate_r_squared=0.58, effective_rank=9.98, centroid_spread=1.14,
        skill_meetings=57, skill_baseline_r2=0.144, skill_gain=-0.343,
        skill_shuffled_p=0.875, skill_stage_minutes=30.0,
    ), ran_at=1.0)
    selected = store.best()
    assert selected is not None
    assert selected["study_id"] == "prior:guidance:d10:s7"
    assert selected["skill_meetings"] == 57


def test_the_newest_run_wins_regardless_of_insert_order(store: DiffusionStudyStore) -> None:
    store.record(_study(study_id="late"), ran_at=99.0)
    store.record(_study(study_id="early", verdict="inadmissible"), ran_at=1.0)
    assert store.latest()["study_id"] == "late"


def test_listing_reports_when_it_truncated(store: DiffusionStudyStore) -> None:
    for index in range(4):
        store.record(_study(study_id=f"run-{index}"), ran_at=float(index))
    rows, truncated = store.list_studies(limit=2)
    assert len(rows) == 2 and truncated is True
    rows, truncated = store.list_studies(limit=10)
    assert len(rows) == 4 and truncated is False


def test_a_report_without_a_fit_still_becomes_a_row() -> None:
    """A refusal has no `fit` block; the mapper must not invent one."""
    study = as_study({"state": "unavailable", "reason": "the encoder is not configured"},
                     study_id="probe", latent_dim=10)
    assert study.state == "unavailable"
    assert study.events == 0
    assert study.gate_state == "not_assessable"
    assert study.gate_r_squared is None
    assert study.verdict is None
    assert "encoder" in (study.verdict_reason or "")


def test_the_mapper_carries_the_gate_and_the_regressions() -> None:
    study = as_study({
        "state": "ok",
        "gate": {"state": "failed", "r_squared": -0.6, "floor": 0.2, "samples": 61,
                 "reason": "below the floor"},
        "fit": {"conditioning": "prior", "segment": None, "latent_dim": 10,
                "events_fitted": 61, "effective_rank_index": 9.94},
        "centroid_spread": {"span_over_scale": 1.08},
        "regressions": {"release:alpha_centroid": {"state": "ok", "n": 26, "t": -0.21}},
        "verdict": {"outcome": "inadmissible", "reason": "the gate was not cleared"},
    }, study_id="probe", latent_dim=10)
    assert study.gate_state == "failed" and study.gate_r_squared == -0.6
    assert study.effective_rank == 9.94 and study.centroid_spread == 1.08
    assert study.regressions == [{"key": "release:alpha_centroid", "state": "ok",
                                  "n": 26, "t": -0.21}]
    assert study.verdict == "inadmissible"
