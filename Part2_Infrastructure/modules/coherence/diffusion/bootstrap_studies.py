"""Validation contract for study rows carried by the Diffusion bootstrap."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

STUDY_FIELDS = (
    "study_id", "ran_at", "conditioning", "segment", "latent_dim", "events",
    "state", "verdict", "verdict_reason", "gate_state", "gate_r_squared",
    "gate_floor", "gate_fact", "gate_reason", "gate_samples", "effective_rank",
    "centroid_spread", "regressions_json", "skill_meetings", "skill_baseline_r2",
    "skill_gain", "skill_shuffled_p", "skill_stage_minutes",
)
STUDY_SCORE_FIELDS = (
    "skill_meetings", "skill_baseline_r2", "skill_gain", "skill_shuffled_p",
    "skill_stage_minutes",
)
_SCORE_EVIDENCE_FIELDS = (
    "state", "gate_state", "gate_r_squared", "events", "effective_rank",
    "centroid_spread",
)


def _validate_study(row: dict[str, Any], error: Callable[[str], Exception]) -> None:
    study_id = str(row.get("study_id") or "study")
    got, wanted = set(row), set(STUDY_FIELDS)
    if got != wanted:
        raise error(
            f"{study_id}: unexpected row projection "
            f"(missing={sorted(wanted - got)}, extra={sorted(got - wanted)})"
        )
    if not re.fullmatch(r"prior:(decision|guidance):d(6|10):s7", study_id):
        raise error(f"{study_id}: unexpected study identity")
    expected_id = f"{row['conditioning']}:{row['segment']}:d{row['latent_dim']}:s7"
    if study_id != expected_id:
        raise error(f"{study_id}: study id does not match its configuration")
    if row["state"] != "ok" or row["gate_state"] != "passed":
        raise error(f"{study_id}: study is not completed and admissible")
    if int(row["events"]) < 50 or int(row["gate_samples"]) < 50:
        raise error(f"{study_id}: study sample is incomplete")
    if any(row[field] is None for field in (
        "gate_r_squared", "effective_rank", "centroid_spread",
    )):
        raise error(f"{study_id}: study instrument evidence is incomplete")
    try:
        regressions = json.loads(str(row["regressions_json"]))
    except (TypeError, ValueError) as exc:
        raise error(f"{study_id}: regressions are not JSON") from exc
    if not isinstance(regressions, list) or len(regressions) != 10:
        raise error(f"{study_id}: expected eight findings and two controls")
    if int(row["skill_meetings"] or 0) > 0 and any(
        row[field] is None
        for field in (
            "skill_baseline_r2", "skill_gain", "skill_shuffled_p", "skill_stage_minutes",
        )
    ):
        raise error(f"{study_id}: out-of-sample score is incomplete")


def validate_studies(
    rows: list[dict[str, Any]],
    *,
    error: Callable[[str], Exception],
) -> None:
    """Require complete pre-registered runs and at least one full skill score."""
    for row in rows:
        _validate_study(row, error)
    if not any(int(row["skill_meetings"] or 0) > 0 for row in rows):
        raise error("diffusion studies contain no out-of-sample score")


def legacy_score_patch(
    expected: dict[str, Any],
    current: dict[str, Any],
    *,
    error: Callable[[str], Exception],
) -> dict[str, Any] | None:
    """Backfill only the score absent from a matching legacy study row."""
    if int(expected["skill_meetings"] or 0) <= 0 \
            or int(current.get("skill_meetings") or 0) > 0:
        return None
    if any(current.get(field) != expected[field] for field in _SCORE_EVIDENCE_FIELDS):
        raise error(
            f"{expected['study_id']}: refusing to attach a score to different gate evidence"
        )
    return {field: expected[field] for field in STUDY_SCORE_FIELDS}


def backfill_legacy_scores(
    target: Any,
    rows: list[dict[str, Any]],
    *,
    error: Callable[[str], Exception],
) -> None:
    """Apply the narrow legacy-score repair through the shared row-store API."""
    for expected in rows:
        filters = {"study_id": expected["study_id"]}
        current = target.fetch_one("diffusion_studies", filters=filters)
        if current is None:
            continue
        patch = legacy_score_patch(expected, current, error=error)
        if patch:
            target.patch("diffusion_studies", filters=filters, patch=patch)
