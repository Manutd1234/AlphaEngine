"""The study ledger: one row per spectrum run, kept whether or not it found anything.

A run that reports "no moment of the resolution spectrum predicts absorption"
is a result, and a result that exists only in the console scrollback of the
person who ran it is not a result at all. So every run is filed — the
admissibility gate it passed or failed, how well conditioned the latent was,
what it regressed, and what it concluded — and the desk reads the newest one.

Keeping the refusals is the point. The recorded history is what stops the same
question being asked a fourth time with a different seed until it answers, and
it is what lets a reader see that the null was measured through an instrument
that had already proved it could recover a fact written in the same documents.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from modules.data_ops_backend import DataOpsStore, get_data_ops_store

#: Effective rank, out of the latent width, below which a latent is degenerate.
MIN_EFFECTIVE_RANK = 9.0
#: Centroid span as a fraction of the sampler scale. Readings that all sit on
#: top of each other cannot predict anything, and that looks exactly like a
#: true null in a regression.
MIN_CENTROID_SPREAD = 0.9


@dataclass(frozen=True)
class Study:
    """One spectrum run, with the evidence for whatever it concluded."""

    study_id: str
    conditioning: str
    segment: str | None
    latent_dim: int
    events: int
    state: str
    verdict: str | None = None
    verdict_reason: str | None = None
    gate_state: str = "not_assessable"
    gate_r_squared: float | None = None
    gate_floor: float = 0.0
    gate_fact: str = ""
    gate_reason: str | None = None
    gate_samples: int = 0
    effective_rank: float | None = None
    centroid_spread: float | None = None
    #: The out-of-sample half of the verdict, from `skill.predictive_skill`.
    #: `skill_baseline_r2` is the one that must be read first: it says whether
    #: the absorption clock is predictable at all, without which `skill_gain`
    #: is a null measured against noise.
    skill_meetings: int = 0
    skill_baseline_r2: float | None = None
    skill_gain: float | None = None
    skill_shuffled_p: float | None = None
    skill_stage_minutes: float | None = None
    regressions: list[dict[str, Any]] = field(default_factory=list)

    def as_row(self, *, desk_id: str, ran_at: float) -> dict[str, Any]:
        return {
            "study_id": self.study_id, "desk_id": desk_id, "ran_at": ran_at,
            "conditioning": self.conditioning, "segment": self.segment,
            "latent_dim": self.latent_dim, "events": self.events, "state": self.state,
            "verdict": self.verdict, "verdict_reason": self.verdict_reason,
            "gate_state": self.gate_state, "gate_r_squared": self.gate_r_squared,
            "gate_floor": self.gate_floor, "gate_fact": self.gate_fact,
            "gate_reason": self.gate_reason, "gate_samples": self.gate_samples,
            "effective_rank": self.effective_rank, "centroid_spread": self.centroid_spread,
            "skill_meetings": self.skill_meetings,
            "skill_baseline_r2": self.skill_baseline_r2, "skill_gain": self.skill_gain,
            "skill_shuffled_p": self.skill_shuffled_p,
            "skill_stage_minutes": self.skill_stage_minutes,
            "regressions_json": json.dumps(self.regressions),
        }


class DiffusionStudyStore:
    """Runs keyed by their own id, newest read first, refusals kept."""

    _DDL = [
        """
        CREATE TABLE IF NOT EXISTS diffusion_studies (
            study_id TEXT PRIMARY KEY,
            desk_id TEXT NOT NULL,
            ran_at REAL NOT NULL,
            conditioning TEXT NOT NULL,
            segment TEXT,
            latent_dim INTEGER NOT NULL,
            events INTEGER NOT NULL DEFAULT 0,
            state TEXT NOT NULL,
            verdict TEXT,
            verdict_reason TEXT,
            gate_state TEXT NOT NULL,
            gate_r_squared REAL,
            gate_floor REAL NOT NULL DEFAULT 0,
            gate_fact TEXT NOT NULL DEFAULT '',
            gate_reason TEXT,
            gate_samples INTEGER NOT NULL DEFAULT 0,
            effective_rank REAL,
            centroid_spread REAL,
            skill_meetings INTEGER NOT NULL DEFAULT 0,
            skill_baseline_r2 REAL,
            skill_gain REAL,
            skill_shuffled_p REAL,
            skill_stage_minutes REAL,
            regressions_json TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS diffusion_studies_by_time ON diffusion_studies (desk_id, ran_at)",
    ]

    #: Added after the table shipped. `CREATE TABLE IF NOT EXISTS` does nothing
    #: to a table that already exists, so a column declared only in the DDL is
    #: present on a fresh database and silently missing on every store that has
    #: been running. Same shape as `texts.py:70-86`.
    _COLUMNS = (
        ("skill_meetings", "INTEGER NOT NULL DEFAULT 0"),
        ("skill_baseline_r2", "REAL"),
        ("skill_gain", "REAL"),
        ("skill_shuffled_p", "REAL"),
        ("skill_stage_minutes", "REAL"),
    )

    def __init__(self, store: DataOpsStore | None = None, *, desk_id: str = "default") -> None:
        self._store = store if store is not None else get_data_ops_store()
        self._desk_id = desk_id
        self._store.migrate(self._DDL)
        self._add_late_columns()

    def _add_late_columns(self) -> None:
        """One ALTER per absent column, on backends that own their own schema."""
        query = getattr(self._store, "query", None)
        execute = getattr(self._store, "execute", None)
        if query is None or execute is None:
            return  # a backend that manages its own schema, e.g. PostgREST
        existing = {str(row["name"]).lower()
                    for row in query("PRAGMA table_info(diffusion_studies)")}
        for column, sql_type in self._COLUMNS:
            if column.lower() not in existing:
                execute(f"ALTER TABLE diffusion_studies ADD COLUMN {column} {sql_type}")

    @property
    def backend(self) -> str:
        return self._store.backend

    def record(self, study: Study, *, ran_at: float) -> None:
        row = study.as_row(desk_id=self._desk_id, ran_at=ran_at)
        if self._store.fetch_one("diffusion_studies", filters={"study_id": study.study_id}) is None:
            self._store.add("diffusion_studies", row)
            return
        self._store.patch("diffusion_studies", filters={"study_id": study.study_id}, patch=row)

    def list_studies(self, *, limit: int = 20) -> tuple[list[dict[str, Any]], bool]:
        rows = self._store.fetch("diffusion_studies", filters={"desk_id": self._desk_id},
                                 order="ran_at.desc", limit=max(1, int(limit)) + 1)
        return rows[:limit], len(rows) > limit

    def best(self) -> dict[str, Any] | None:
        """The best-conditioned admissible run — the one the desk reports.

        NOT the newest. "Whoever ran last sets the headline" is a selection
        rule that rewards re-running until a number moves, which is exactly the
        failure this ledger exists to prevent. The rule here is fixed, stated,
        and blind to the outcome: among runs whose representation cleared the
        gate and whose latent is well conditioned, take the one that recovers
        the known fact best. Every quantity in it — the gate, the effective
        rank, the spread of the readings across the resolution axis — is
        measured without reference to absorption speed, so choosing on them
        cannot manufacture a relationship with absorption speed.

        A run that clears the gate but is poorly conditioned still beats no run
        at all, so the thresholds relax before the gate does; nothing that
        failed the gate is ever returned.
        """
        rows, _ = self.list_studies(limit=50)
        passed = [row for row in rows if row.get("gate_state") == "passed"
                  and row.get("gate_r_squared") is not None]
        if not passed:
            return None
        conditioned = [row for row in passed
                       if (row.get("effective_rank") or 0) >= MIN_EFFECTIVE_RANK
                       and (row.get("centroid_spread") or 0) >= MIN_CENTROID_SPREAD]
        return max(conditioned or passed, key=lambda row: float(row["gate_r_squared"]))

    def latest(self, *, admissible: bool = False) -> dict[str, Any] | None:
        """The newest run, whatever it concluded — including a refusal.

        With `admissible`, the newest run whose representation cleared the gate.
        The desk asks for that one, because a null measured through a latent
        that cannot recover a fact written in the documents is not a null about
        the documents, and displaying it beside real results would let a
        broken representation masquerade as an absence of signal. When nothing
        has cleared the gate the caller gets None and shows the failure instead
        of borrowing an older run's findings to fill the space.
        """
        rows, _ = self.list_studies(limit=50)
        if admissible:
            rows = [row for row in rows if row.get("gate_state") == "passed"]
        return rows[0] if rows else None

    def close(self) -> None:
        self._store.close()


def as_study(report: dict[str, Any], *, study_id: str, latent_dim: int) -> Study:
    """Turn a spectrum report into the ledger row that outlives the console.

    A refusal becomes a row too. "The encoder was not configured" and "the
    instrument ran and found nothing" are different facts, and a ledger that
    only holds successes cannot tell a reader which one it is looking at.
    """
    fit = report.get("fit") if isinstance(report.get("fit"), dict) else {}
    gate = report.get("gate") if isinstance(report.get("gate"), dict) else {}
    verdict = report.get("verdict") if isinstance(report.get("verdict"), dict) else {}
    regressions = report.get("regressions") if isinstance(report.get("regressions"), dict) else {}
    skill = report.get("skill") if isinstance(report.get("skill"), dict) else {}
    return Study(
        study_id=study_id,
        conditioning=str(fit.get("conditioning") or report.get("conditioning") or "unknown"),
        segment=fit.get("segment"),
        latent_dim=int(fit.get("latent_dim") or latent_dim),
        events=int(fit.get("events_fitted") or report.get("events") or 0),
        state=str(report.get("state") or "unavailable"),
        verdict=verdict.get("outcome"),
        verdict_reason=verdict.get("reason") or report.get("reason"),
        gate_state=str(gate.get("state") or "not_assessable"),
        gate_r_squared=gate.get("r_squared"),
        gate_floor=float(gate.get("floor") or 0.0),
        gate_fact="the policy move in basis points",
        gate_reason=gate.get("reason"),
        gate_samples=int(gate.get("samples") or 0),
        effective_rank=fit.get("effective_rank_index"),
        centroid_spread=(report.get("centroid_spread") or {}).get("span_over_scale")
        if isinstance(report.get("centroid_spread"), dict) else None,
        skill_meetings=int(skill.get("meetings") or 0),
        skill_baseline_r2=skill.get("baseline_r2"),
        skill_gain=skill.get("gain"),
        skill_shuffled_p=skill.get("shuffled_p"),
        skill_stage_minutes=skill.get("stage_minutes"),
        regressions=[{"key": key, **row} for key, row in regressions.items()
                     if isinstance(row, dict)],
    )
