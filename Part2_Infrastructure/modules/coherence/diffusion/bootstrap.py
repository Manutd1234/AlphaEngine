"""Restore the committed, issuer-verified FOMC evidence into the live ledger.

This is deliberately an INSERT-ONLY bootstrap, not a database copy.  The
artifact contains exactly four allowlisted projections and no tenant id:
events reconstructed from issuer evidence, issuer statement texts, measured
absorption runs, and the four pre-registered spectrum studies built from those
inputs.  The configured backend owns the tenant stamp.

Existing observations are never patched.  That matters because a later
operator may replace an estimated call clock with a recorded one, refetch a
revised issuer page, or recompute a run under new parameters.  The sole narrow
exception fills a missing out-of-sample score on the matching legacy study row;
it refuses if that row's gate evidence differs.  A partial prior import resumes
by inserting only missing natural keys; a key whose identity points at a
different event/source/stage fails readiness instead of being overwritten.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from modules.coherence.diffusion.bootstrap_studies import (
    STUDY_FIELDS,
    backfill_legacy_scores,
    validate_studies,
)
from modules.coherence.diffusion.events import DiffusionEventStore
from modules.coherence.diffusion.runs import AbsorptionRunStore
from modules.coherence.diffusion.studies import DiffusionStudyStore
from modules.coherence.diffusion.texts import DiffusionTextStore
from modules.data_ops_backend import DataOpsStore, get_data_ops_store

log = logging.getLogger("alphaengine.diffusion.bootstrap")

SCHEMA = "alphaengine.diffusion.fomc-bootstrap.v1"
ARTIFACT = Path(__file__).resolve().parent / "bootstrap_data/fomc_issuer_evidence_v1.json"
ARTIFACT_FILE_SHA256 = "1dfa9fa2d20b7d5fe797c142346077da0f532b21209b3627495490122ae11629"
EXPECTED_COUNTS = {
    "diffusion_events": 62,
    "diffusion_texts": 62,
    "diffusion_runs": 248,
    "diffusion_studies": 4,
}
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_HEX16 = re.compile(r"^[0-9a-f]{16}$")
_FED_REF = re.compile(r"^fed:\d{4}-\d{2}-\d{2}$")
_FED_URL = re.compile(
    r"^https://www\.federalreserve\.gov/newsevents/pressreleases/monetary\d{8}a\.htm$"
)

_EVENT_FIELDS = (
    "source_ref", "kind", "symbol", "title", "release_at", "release_at_source",
    "release_timing", "call_at", "call_at_source", "call_offset_min", "eps_estimate",
    "eps_actual", "surprise_pct", "scheduled", "statement_url", "first_seen_at",
    "last_seen_at", "revised_count", "verified_at",
)
_TEXT_FIELDS = (
    "text_id", "source_ref", "stage", "source", "url", "state", "reason", "body",
    "sha256", "characters", "verified_release_time", "body_isolated", "vote_line",
    "first_seen_at", "fetched_at",
)
_RUN_ARTIFACT_FIELDS = (
    "run_id", "source_ref", "symbol", "stage", "interval", "signal_state",
    "signal_reason", "terminal_return", "sigma_pre_per_bar", "pre_bars", "half_life_s",
    "half_life_state", "half_life_vol", "control_percentile", "controls_used",
    "measured_horizons", "of_horizons", "market_adjusted", "data_hash",
    "params_version", "t0_ms", "points", "computed_at",
)
_KEYS = {
    "diffusion_events": "source_ref",
    "diffusion_texts": "text_id",
    "diffusion_runs": "run_id",
    "diffusion_studies": "study_id",
}
_IDENTITY = {
    # Fields that define what a key *is*. Mutable evidence/results are excluded
    # so a later recorded clock, issuer revision, or recomputation survives.
    "diffusion_events": ("source_ref", "kind", "release_at", "statement_url"),
    "diffusion_texts": ("text_id", "source_ref", "stage", "source", "url"),
    "diffusion_runs": ("run_id", "source_ref", "symbol", "stage", "interval", "t0_ms"),
    "diffusion_studies": ("study_id", "conditioning", "segment", "latent_dim"),
}


class DiffusionBootstrapError(RuntimeError):
    """The artifact or target ledger is unsafe to restore."""


@dataclass(frozen=True)
class BootstrapTableResult:
    expected: int
    already_present: int
    restored: int
    final_present: int


@dataclass(frozen=True)
class BootstrapResult:
    dataset_id: str
    payload_sha256: str
    backend: str
    tables: dict[str, BootstrapTableResult]

    def as_dict(self) -> dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "payload_sha256": self.payload_sha256,
            "backend": self.backend,
            "tables": {name: asdict(result) for name, result in self.tables.items()},
        }


def _payload_digest(tables: dict[str, list[dict[str, Any]]]) -> str:
    encoded = json.dumps(
        tables, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_exact_fields(row: dict[str, Any], expected: tuple[str, ...], *, label: str) -> None:
    got = set(row)
    wanted = set(expected)
    if got != wanted:
        raise DiffusionBootstrapError(
            f"{label}: unexpected row projection (missing={sorted(wanted - got)}, "
            f"extra={sorted(got - wanted)})"
        )


def _validate_text(row: dict[str, Any]) -> None:
    _require_exact_fields(row, _TEXT_FIELDS, label=str(row.get("text_id") or "text"))
    source_ref = str(row["source_ref"])
    if not _FED_REF.fullmatch(source_ref):
        raise DiffusionBootstrapError(f"{source_ref}: invalid FOMC source ref")
    if row["text_id"] != f"{source_ref}|release|statement":
        raise DiffusionBootstrapError(f"{source_ref}: text key does not match its identity")
    if (row["stage"], row["source"], row["state"]) != ("release", "statement", "ok"):
        raise DiffusionBootstrapError(f"{source_ref}: artifact contains a non-issuer text row")
    if not _FED_URL.fullmatch(str(row["url"])):
        raise DiffusionBootstrapError(f"{source_ref}: text URL is not an issuer statement URL")
    body = row.get("body")
    if not isinstance(body, str) or len(body) != int(row["characters"]):
        raise DiffusionBootstrapError(f"{source_ref}: body length does not match characters")
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    if digest != row.get("sha256") or not _HEX64.fullmatch(digest):
        raise DiffusionBootstrapError(f"{source_ref}: body digest does not match the text")
    if not re.fullmatch(r"\d{2}:\d{2} E[SD]T", str(row["verified_release_time"])):
        raise DiffusionBootstrapError(f"{source_ref}: issuer release clock is absent")


def _validate_event(row: dict[str, Any]) -> None:
    _require_exact_fields(row, _EVENT_FIELDS, label=str(row.get("source_ref") or "event"))
    source_ref = str(row["source_ref"])
    if not _FED_REF.fullmatch(source_ref) or row["kind"] != "fomc":
        raise DiffusionBootstrapError(f"{source_ref}: artifact contains a non-FOMC event")
    if row["release_at_source"] != "issuer" or row["release_timing"] != "exact":
        raise DiffusionBootstrapError(f"{source_ref}: release clock is not issuer-derived")
    if row["call_at_source"] != "estimated_offset":
        raise DiffusionBootstrapError(f"{source_ref}: call clock overclaims its provenance")
    if float(row["call_at"]) <= float(row["release_at"]):
        raise DiffusionBootstrapError(f"{source_ref}: call anchor is not after release")
    if float(row["call_offset_min"]) not in {30.0, 60.0}:
        raise DiffusionBootstrapError(f"{source_ref}: unsupported estimated call offset")
    if not _FED_URL.fullmatch(str(row["statement_url"])):
        raise DiffusionBootstrapError(f"{source_ref}: event URL is not an issuer statement URL")
    if row["verified_at"] is None:
        raise DiffusionBootstrapError(f"{source_ref}: event has no verification clock")


def _validate_run(row: dict[str, Any]) -> None:
    _require_exact_fields(row, _RUN_ARTIFACT_FIELDS, label=str(row.get("run_id") or "run"))
    source_ref = str(row["source_ref"])
    if row["run_id"] != f"{source_ref}|{row['symbol']}|{row['stage']}":
        raise DiffusionBootstrapError(f"{source_ref}: run key does not match its identity")
    if row["symbol"] not in {"BTCUSDT", "ETHUSDT"}:
        raise DiffusionBootstrapError(f"{source_ref}: unsupported bootstrap asset")
    if row["stage"] not in {"release", "call"} or row["interval"] != "1m":
        raise DiffusionBootstrapError(f"{source_ref}: unsupported bootstrap stage")
    if not _HEX64.fullmatch(str(row.get("data_hash") or "")):
        raise DiffusionBootstrapError(f"{source_ref}: run data hash is absent")
    if not _HEX16.fullmatch(str(row.get("params_version") or "")):
        raise DiffusionBootstrapError(f"{source_ref}: run parameter digest is absent")
    points = row.get("points")
    if not isinstance(points, list) or len(points) != int(row["of_horizons"]):
        raise DiffusionBootstrapError(f"{source_ref}: run horizon evidence is incomplete")


def _validate_shape_and_counts(artifact: Any) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    if not isinstance(artifact, dict) or set(artifact) != {"manifest", "tables"}:
        raise DiffusionBootstrapError("diffusion bootstrap root has an unexpected shape")
    manifest, tables = artifact["manifest"], artifact["tables"]
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise DiffusionBootstrapError("diffusion bootstrap schema is unsupported")
    if not isinstance(tables, dict) or set(tables) != set(EXPECTED_COUNTS):
        raise DiffusionBootstrapError("diffusion bootstrap contains an unexpected table")
    if manifest.get("counts") != EXPECTED_COUNTS:
        raise DiffusionBootstrapError("diffusion bootstrap manifest counts are wrong")
    for table, expected in EXPECTED_COUNTS.items():
        rows = tables.get(table)
        if not isinstance(rows, list) or len(rows) != expected:
            raise DiffusionBootstrapError(f"{table}: expected {expected} rows")
        key = _KEYS[table]
        keys = [str(row.get(key)) for row in rows if isinstance(row, dict)]
        if len(keys) != len(rows) or len(keys) != len(set(keys)):
            raise DiffusionBootstrapError(f"{table}: natural keys are missing or duplicated")
    return manifest, tables


def load_artifact(path: Path = ARTIFACT) -> dict[str, Any]:
    """Load and completely validate the immutable evidence artifact."""
    try:
        encoded = path.read_bytes()
        if path.resolve() == ARTIFACT.resolve():
            file_digest = hashlib.sha256(encoded).hexdigest()
            if file_digest != ARTIFACT_FILE_SHA256:
                raise DiffusionBootstrapError("committed diffusion artifact checksum does not match")
        artifact = json.loads(encoded)
    except (OSError, ValueError) as exc:
        kind = type(exc).__name__
        raise DiffusionBootstrapError(f"cannot read diffusion bootstrap artifact: {kind}") from exc
    manifest, tables = _validate_shape_and_counts(artifact)
    digest = _payload_digest(tables)
    if manifest.get("payload_sha256") != digest or not _HEX64.fullmatch(digest):
        raise DiffusionBootstrapError("diffusion bootstrap payload checksum does not match")
    for row in tables["diffusion_events"]:
        _validate_event(row)
    for row in tables["diffusion_texts"]:
        _validate_text(row)
    for row in tables["diffusion_runs"]:
        _validate_run(row)
    validate_studies(tables["diffusion_studies"], error=DiffusionBootstrapError)
    _validate_links(tables)
    return artifact


def _validate_links(tables: dict[str, list[dict[str, Any]]]) -> None:
    events = {row["source_ref"]: row for row in tables["diffusion_events"]}
    texts = {row["source_ref"]: row for row in tables["diffusion_texts"]}
    runs: dict[str, list[dict[str, Any]]] = {}
    for row in tables["diffusion_runs"]:
        runs.setdefault(row["source_ref"], []).append(row)
    if set(events) != set(texts) or set(events) != set(runs):
        raise DiffusionBootstrapError("event, text, and run source refs do not agree")
    for source_ref, event in events.items():
        text = texts[source_ref]
        if event["statement_url"] != text["url"]:
            raise DiffusionBootstrapError(f"{source_ref}: event and text issuer URLs disagree")
        stages = runs[source_ref]
        identities = {(row["symbol"], row["stage"]) for row in stages}
        expected = {
            ("BTCUSDT", "release"), ("ETHUSDT", "release"),
            ("BTCUSDT", "call"), ("ETHUSDT", "call"),
        }
        if identities != expected or len(stages) != 4:
            raise DiffusionBootstrapError(f"{source_ref}: expected two assets by two stages")
        for run in stages:
            anchor = event["release_at"] if run["stage"] == "release" else event["call_at"]
            if not _equal(run["t0_ms"], anchor):
                raise DiffusionBootstrapError(f"{source_ref}: run and event stage clocks disagree")


def _equal(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(float(left), float(right), rel_tol=0.0, abs_tol=0.001)
    return left == right


def _db_rows(table: str, rows: list[dict[str, Any]], *, desk_id: str) -> list[dict[str, Any]]:
    expected = {
        "diffusion_events": _EVENT_FIELDS,
        "diffusion_texts": _TEXT_FIELDS,
        "diffusion_runs": _RUN_ARTIFACT_FIELDS,
        "diffusion_studies": STUDY_FIELDS,
    }[table]
    converted: list[dict[str, Any]] = []
    for source in rows:
        _require_exact_fields(source, expected, label=f"{table} row")
        row = dict(source)
        if table == "diffusion_runs":
            row["points_json"] = json.dumps(
                row.pop("points"), ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            )
        row["desk_id"] = desk_id
        converted.append(row)
    return converted


def _existing(store: DataOpsStore, table: str) -> dict[str, dict[str, Any]]:
    key = _KEYS[table]
    columns = ",".join(_IDENTITY[table])
    rows = store.fetch(table, columns=columns, limit=10_000)
    return {str(row[key]): row for row in rows}


def _identity_conflicts(
    table: str, expected: list[dict[str, Any]], present: dict[str, dict[str, Any]],
) -> list[str]:
    key = _KEYS[table]
    conflicts: list[str] = []
    for row in expected:
        natural_key = str(row[key])
        existing = present.get(natural_key)
        if existing is None:
            continue
        if any(not _equal(existing.get(field), row.get(field)) for field in _IDENTITY[table]):
            conflicts.append(natural_key)
    return conflicts


def restore_verified_fomc(
    store: DataOpsStore | None = None, *, artifact_path: Path = ARTIFACT,
) -> BootstrapResult:
    """Insert missing evidence rows and prove the final identities are intact."""
    artifact = load_artifact(artifact_path)
    target = store if store is not None else get_data_ops_store()
    # Own schema creation stays in the domain stores on SQLite. PostgREST's
    # migrate methods are intentional no-ops because migrations own DDL there.
    DiffusionEventStore(target)
    DiffusionTextStore(target)
    AbsorptionRunStore(target)
    DiffusionStudyStore(target)
    desk_id = str(getattr(target, "desk_id", None) or "default")
    tables = {
        name: _db_rows(name, artifact["tables"][name], desk_id=desk_id)
        for name in EXPECTED_COUNTS
    }
    before = {name: _existing(target, name) for name in EXPECTED_COUNTS}
    conflicts = {
        name: _identity_conflicts(name, tables[name], before[name])
        for name in EXPECTED_COUNTS
    }
    conflicts = {name: keys for name, keys in conflicts.items() if keys}
    if conflicts:
        summary = "; ".join(f"{name}={keys[:3]}" for name, keys in conflicts.items())
        raise DiffusionBootstrapError(f"existing diffusion identity conflict: {summary}")

    # Parent before child, and insert-only. `ignore-duplicates` makes a retry
    # after a partial write or a concurrent identical bootstrap harmless.
    for name in ("diffusion_events", "diffusion_texts", "diffusion_runs", "diffusion_studies"):
        key = _KEYS[name]
        missing = [row for row in tables[name] if str(row[key]) not in before[name]]
        if missing:
            target.add(
                name, missing, on_conflict=key, resolution="ignore-duplicates",
            )
    # Fill only a missing score on the exact same legacy gate evidence; never
    # replace a later or different study with the committed artifact.
    backfill_legacy_scores(
        target, tables["diffusion_studies"], error=DiffusionBootstrapError,
    )

    after = {name: _existing(target, name) for name in EXPECTED_COUNTS}
    final_conflicts = {
        name: _identity_conflicts(name, tables[name], after[name])
        for name in EXPECTED_COUNTS
    }
    absent = {
        name: sorted(set(row[_KEYS[name]] for row in tables[name]) - set(after[name]))
        for name in EXPECTED_COUNTS
    }
    problems = {
        name: {"conflicts": final_conflicts[name], "absent": absent[name]}
        for name in EXPECTED_COUNTS
        if final_conflicts[name] or absent[name]
    }
    if problems:
        raise DiffusionBootstrapError(f"diffusion bootstrap did not converge: {problems}")

    results = {
        name: BootstrapTableResult(
            expected=len(tables[name]),
            already_present=sum(1 for row in tables[name] if str(row[_KEYS[name]]) in before[name]),
            restored=sum(1 for row in tables[name] if str(row[_KEYS[name]]) not in before[name]),
            final_present=sum(1 for row in tables[name] if str(row[_KEYS[name]]) in after[name]),
        )
        for name in EXPECTED_COUNTS
    }
    result = BootstrapResult(
        dataset_id=str(artifact["manifest"]["dataset_id"]),
        payload_sha256=str(artifact["manifest"]["payload_sha256"]),
        backend=target.backend,
        tables=results,
    )
    log.info(
        "verified FOMC bootstrap ready: backend=%s events=%d texts=%d runs=%d studies=%d",
        target.backend,
        results["diffusion_events"].final_present,
        results["diffusion_texts"].final_present,
        results["diffusion_runs"].final_present,
        results["diffusion_studies"].final_present,
    )
    return result
