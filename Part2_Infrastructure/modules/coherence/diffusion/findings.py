"""The study's results as rows, so a reader can judge them without running it.

The point of this module is that a finding is not a number. Each row carries
the question it answers, the count behind it, a shuffled-pairing null, and a
verdict — and the null results sit in the same table as the positive one at the
same weight, because a table that shows only what worked is a claim rather than
a result.

The rows are computed from the ledgers rather than transcribed, so they cannot
drift from what the tools measure. They are cheap: the absorption ledger and
the text store are already on disk, and nothing here re-embeds or re-fits.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from modules.coherence.diffusion.policy import rate_path
from modules.coherence.diffusion.runs import AbsorptionRunStore
from modules.coherence.diffusion.segments import count_dissenters
from modules.coherence.diffusion.studies import DiffusionStudyStore
from modules.coherence.diffusion.texts import DiffusionTextStore

#: Below this a slope is not fitted. A t statistic over eight points is theatre.
MIN_EVENTS = 10


def _slope(x: list[float], y: list[float], *, draws: int = 2_000,
           seed: int = 5) -> dict[str, Any]:
    """Slope, t, correlation and how often a shuffled pairing does as well."""
    xs, ys = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    if xs.size < MIN_EVENTS or float(np.std(xs)) == 0.0:
        return {"n": int(xs.size), "t": None, "r": None, "p": None}
    centred = xs - xs.mean()
    slope = float((centred * (ys - ys.mean())).sum() / (centred**2).sum())
    residual = ys - (ys.mean() + slope * centred)
    stderr = float(np.sqrt((residual**2).sum() / (xs.size - 2) / (centred**2).sum()))
    rng = np.random.default_rng(seed)
    exceeded = 0
    for _ in range(draws):
        shuffled = xs[rng.permutation(xs.size)]
        spread = shuffled - shuffled.mean()
        exceeded += abs(float((spread * (ys - ys.mean())).sum() / (spread**2).sum())) >= abs(slope)
    return {"n": int(xs.size), "t": slope / stderr if stderr else None,
            "r": float(np.corrcoef(xs, ys)[0, 1]), "p": exceeded / draws}


def _verdict(measured: dict[str, Any]) -> str:
    if measured["t"] is None:
        return "not_assessable"
    return "holds" if abs(float(measured["t"])) >= 2.0 else "absent"


def _aggregate(rows: list[dict[str, Any]]) -> tuple[dict[tuple[str, str], float], ...]:
    """Mean half-life and mean standardised 30-minute response per event and stage.

    Both are means over the assets measured for that stage, because BTC and ETH
    quoting the same meeting are one observation of that meeting and not two.
    """
    half: dict[tuple[str, str], list[float]] = {}
    response: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        key = (str(row["source_ref"]), str(row["stage"]))
        if row.get("signal_state") == "ok" and row.get("half_life_s"):
            half.setdefault(key, []).append(float(row["half_life_s"]))
        sigma = row.get("sigma_pre_per_bar")
        if not sigma:
            continue
        for cell in json.loads(row.get("points_json") or "[]"):
            if cell.get("state") == "ok" and cell.get("horizon") == "30m" \
                    and cell.get("abnormal_return") is not None:
                response.setdefault(key, []).append(
                    abs(float(cell["abnormal_return"])) / float(sigma))
    return ({key: float(np.mean(values)) for key, values in half.items()},
            {key: float(np.mean(values)) for key, values in response.items()})


#: How a regression key from the study ledger reads in a results table.
_MOMENT_NAMES = {
    "alpha_centroid": ("resolution centroid → absorption speed",
                       "Does the resolution at which a statement explains the last one "
                       "predict how fast it is absorbed?"),
    "total_nats": ("information carried → absorption speed",
                   "Do statements that say more get absorbed more slowly?"),
    "fine_fraction": ("fine detail share → absorption speed",
                      "Is a statement whose news is in the fine detail absorbed more slowly?"),
    "iqr_spread": ("resolution spread → absorption speed",
                   "Is a statement whose information is spread across resolutions slower?"),
}


def _study_rows(study: dict[str, Any]) -> list[dict[str, Any]]:
    """The spectrum regressions from the newest study, as findings rows.

    The control rows are dropped here because they are already measured
    directly off the ledgers above; carrying two copies of the same number,
    computed two ways, invites a reader to treat the agreement as corroboration
    when it is arithmetic.
    """
    rows: list[dict[str, Any]] = []
    for entry in json.loads(study.get("regressions_json") or "[]"):
        key = str(entry.get("key") or "")
        stage, _, moment = key.partition(":")
        if moment not in _MOMENT_NAMES or entry.get("state") != "ok":
            continue
        name, question = _MOMENT_NAMES[moment]
        measured = {"n": int(entry.get("n") or 0), "t": entry.get("t"),
                    "r": entry.get("r"), "p": entry.get("shuffled_p")}
        rows.append({
            "name": name, "question": question, "stage": stage, **measured,
            "verdict": _verdict(measured),
            "note": ("measured through the information spectrum, on a latent that cleared "
                     "the admissibility gate"),
        })
    return rows


def collect(*, runs_store: AbsorptionRunStore | None = None,
            text_store: DiffusionTextStore | None = None,
            study_store: DiffusionStudyStore | None = None) -> dict[str, Any]:
    """Every headline relationship, measured off the ledgers as they stand."""
    runs = runs_store or AbsorptionRunStore()
    texts = text_store or DiffusionTextStore()
    studies = study_store or DiffusionStudyStore()
    try:
        rows, _ = runs.list_runs(limit=4_000)
        documents, _ = texts.list_texts(limit=400)
        study = studies.best() or studies.latest()
    finally:
        if runs_store is None:
            runs.close()
        if text_store is None:
            texts.close()
        if study_store is None:
            studies.close()

    documents = [row for row in documents if row.get("state") == "ok" and row.get("body")]
    documents.sort(key=lambda row: str(row["source_ref"]))
    policy = rate_path([(str(row["source_ref"]), str(row["body"])) for row in documents])
    dissents = {str(row["source_ref"]): count_dissenters(str(row.get("vote_line") or ""))
                for row in documents}
    verified = sum(1 for row in documents if row.get("verified_release_time"))

    half, response = _aggregate(rows)

    findings: list[dict[str, Any]] = []
    for stage in ("release", "call"):
        moves = [(abs(float(policy[ref]["move_bp"])), value)
                 for (ref, other), value in response.items()
                 if other == stage and policy.get(ref, {}).get("move_bp") is not None]
        measured = _slope([pair[0] for pair in moves], [pair[1] for pair in moves])
        findings.append({
            "name": "policy move → response size", "stage": stage,
            "question": "Does a bigger rate change produce a bigger price response?",
            **measured, "verdict": _verdict(measured),
            "note": "the positive control: without it, every null below is unfalsifiable",
        })
    for stage in ("release", "call"):
        speeds = [(abs(float(policy[ref]["move_bp"])), math.log(value))
                  for (ref, other), value in half.items()
                  if other == stage and policy.get(ref, {}).get("move_bp") is not None and value > 0]
        measured = _slope([pair[0] for pair in speeds], [pair[1] for pair in speeds])
        findings.append({
            "name": "policy move → absorption speed", "stage": stage,
            "question": "Does a bigger rate change get absorbed faster or slower?",
            **measured, "verdict": _verdict(measured), "note": None,
        })
    for stage in ("release", "call"):
        votes = [(float(dissents.get(ref, 0)), math.log(value))
                 for (ref, other), value in half.items() if other == stage and value > 0]
        measured = _slope([pair[0] for pair in votes], [pair[1] for pair in votes])
        findings.append({
            "name": "dissents → absorption speed", "stage": stage,
            "question": "Is a divided Committee absorbed more slowly?",
            **measured, "verdict": _verdict(measured), "note": None,
        })

    # Only an admissible study contributes rows. A failed gate still shows —
    # as the gate panel below — because "the instrument was not fit to answer"
    # is the most important thing a reader could be told, but its regressions
    # are not findings and are not displayed as though they were.
    if study and study.get("gate_state") == "passed":
        findings.extend(_study_rows(study))

    return {
        "gate": {
            "state": str(study["gate_state"]), "r_squared": study.get("gate_r_squared"),
            "floor": float(study.get("gate_floor") or 0.0),
            "samples": int(study.get("gate_samples") or 0),
            "fact": str(study.get("gate_fact") or ""),
            "reason": study.get("gate_reason"),
        } if study else None,
        "study": {
            "study_id": str(study["study_id"]), "conditioning": str(study["conditioning"]),
            "segment": study.get("segment"), "latent_dim": int(study["latent_dim"]),
            "events": int(study.get("events") or 0),
            "effective_rank": study.get("effective_rank"),
            "centroid_spread": study.get("centroid_spread"),
            "verdict": study.get("verdict"), "verdict_reason": study.get("verdict_reason"),
        } if study else None,
        "calendar": {
            "verified": verified, "of": len(documents),
            "how": ("each statement was fetched from the issuer's own URL and its "
                    "'For release at' line compared with the calendar's hour"),
            "dissent_meetings": sum(1 for count in dissents.values() if count),
            "dissent_votes": sum(dissents.values()),
        },
        "findings": findings,
        "backend": runs.backend if runs_store is None else runs_store.backend,
    }
