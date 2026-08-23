"""The experiment: score each statement, and test it against what happened.

Lifted out of `tools/diffusion_spectrum.py` when that file crossed the length
ceiling, and it belongs here regardless — the CLI's job is arguments and a
loop, and what counts as evidence is the package's.

Three guards live here and each was added because it caught something:

* `load_documents` embeds a SEGMENT rather than a whole statement. A
  whole-statement latent cannot recover the policy move written in it.
* `_verdict` requires stability across latent widths, not just a threshold. One
  moment reached t = -3.58 on both stages with a shuffled p of 0.002 and was an
  artefact of a width nobody can justify to the decimal.
* `standardised_responses` applies no signal gate. Gating on the size of a move
  and then dividing by it is selection on the denominator, and it cost the
  first version more than half its events.
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from modules.coherence.diffusion.embed import TextEncoder
from modules.coherence.diffusion.policy import rate_path
from modules.coherence.diffusion.runs import AbsorptionRunStore
from modules.coherence.diffusion.segments import extract as extract_segments
from modules.coherence.diffusion.spectrum import FitRefusal, fit_spectrum, score_event
from modules.coherence.diffusion.text import headline_of
from modules.coherence.diffusion.texts import DiffusionTextStore

MOMENTS = (
    ("alpha_centroid", lambda s: s.alpha_centroid),
    ("total_nats", lambda s: s.total_nats),
    ("fine_fraction", lambda s: s.fine_fraction),
    ("iqr_spread", lambda s: None if s.q75 is None or s.q25 is None else s.q75 - s.q25),
)


def load_documents(encoder: TextEncoder, *, limit: int, conditioning: str,
                   segment: str = "decision"
                   ) -> tuple[np.ndarray, np.ndarray, list[str], dict[str, dict]]:
    """The target channel, its conditioning channel, and the policy path.

    `conditioning` picks what the statement is measured AGAINST, and the choice
    is the experiment:

    * `prior` — the statement before it. Consecutive FOMC statements are 0.978
      cosine apart, which is the point: they are near-identical and the
      information is in the small differences. This is the Lazy Prices question
      asked as a spectrum, and it is the one a desk would ask.
    * `headline` — the opening sentences. Note the overlap: the headline is a
      SUBSET of the body, so the measured information is partly tautological.
      Kept because it was the original design and the comparison is honest.
    * `remainder` — the body with its opening sentences removed. The
      non-overlapping version of the headline question: what does the part a
      scraper does not read add over the part it does?
    """
    store = DiffusionTextStore()
    try:
        rows, _ = store.list_texts(limit=limit)
    finally:
        store.close()
    rows = [row for row in rows if row.get("state") == "ok" and row.get("body")]
    rows.sort(key=lambda row: str(row["source_ref"]))
    policy = rate_path([(str(row["source_ref"]), str(row["body"])) for row in rows])

    targets, conditions, refs = [], [], []
    previous = None
    for row in rows:
        body = str(row["body"])
        if segment != "whole":
            piece = extract_segments(body).channel(segment)
            if not piece:
                previous = None
                continue
            body_for_embedding = piece
        else:
            body_for_embedding = body
        opening = headline_of(body_for_embedding, sentences=2)
        embedded = encoder.embed(body_for_embedding)
        if embedded.state != "ok":
            previous = None
            continue
        if conditioning == "prior":
            other = previous
        elif conditioning == "remainder":
            residual = encoder.embed(body_for_embedding[len(opening):].strip()
                                     or body_for_embedding)
            other = residual.vector if residual.state == "ok" else None
        else:
            opened = encoder.embed(opening)
            other = opened.vector if opened.state == "ok" else None
        if other is not None:
            targets.append(embedded.vector)
            conditions.append(other)
            refs.append(str(row["source_ref"]))
        previous = embedded.vector
    if not refs:
        return np.empty((0, 0)), np.empty((0, 0)), [], policy
    return np.asarray(targets), np.asarray(conditions), refs, policy


def half_lives() -> dict[tuple[str, str], float]:
    """Mean half-life per (event, stage), over the assets that measured it."""
    store = AbsorptionRunStore()
    try:
        rows, _ = store.list_runs(limit=2_000)
    finally:
        store.close()
    grouped: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        if row.get("signal_state") != "ok" or not row.get("half_life_s"):
            continue
        grouped.setdefault((str(row["source_ref"]), str(row["stage"])), []).append(
            float(row["half_life_s"]))
    return {key: float(np.mean(values)) for key, values in grouped.items()}


def standardised_responses() -> dict[tuple[str, str], float]:
    """|abnormal return| at the terminal horizon, in pre-event sigmas.

    No signal gate. Gating on the size of the move and then dividing by it is
    selection on the denominator, and it cost this study more than half its
    events — 62 meetings became 26. A standardised response is defined for
    every event whether it moved or not, which is what the positive control
    needs to have any power.
    """
    store = AbsorptionRunStore()
    try:
        rows, _ = store.list_runs(limit=2_000)
    finally:
        store.close()
    grouped: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        sigma = row.get("sigma_pre_per_bar")
        if not sigma:
            continue
        for cell in json.loads(row.get("points_json") or "[]"):
            if cell.get("state") != "ok" or cell.get("abnormal_return") is None:
                continue
            if cell.get("horizon") != "30m":
                continue
            grouped.setdefault((str(row["source_ref"]), str(row["stage"])), []).append(
                abs(float(cell["abnormal_return"])) / float(sigma))
    return {key: float(np.mean(values)) for key, values in grouped.items()}


def regress(x: list[float], y: list[float], *, draws: int, seed: int) -> dict[str, object]:
    """Slope, t, and how often a shuffled pairing does as well."""
    xs, ys = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    if xs.size < 8:
        return {"n": int(xs.size), "state": "too_few",
                "reason": f"{xs.size} events is not enough to fit a slope"}
    centred = xs - xs.mean()
    slope = float((centred * (ys - ys.mean())).sum() / (centred**2).sum())
    residual = ys - (ys.mean() + slope * centred)
    stderr = float(np.sqrt((residual**2).sum() / (xs.size - 2) / (centred**2).sum()))
    rng = np.random.default_rng(seed)
    exceeded = 0
    for _ in range(draws):
        shuffled = xs[rng.permutation(xs.size)]
        shuffled_centred = shuffled - shuffled.mean()
        null_slope = float((shuffled_centred * (ys - ys.mean())).sum() / (shuffled_centred**2).sum())
        exceeded += abs(null_slope) >= abs(slope)
    return {
        "n": int(xs.size), "state": "ok", "slope": slope,
        "t": slope / stderr if stderr else None,
        "r": float(np.corrcoef(xs, ys)[0, 1]),
        "shuffled_p": exceeded / draws,
    }



def _verdict(strongest: dict[str, object] | None,
             stability: dict[str, object] | None = None) -> dict[str, object]:
    """A threshold alone is not a verdict, and this function learned that.

    An earlier version said `predicts` as soon as any moment cleared |t| = 2,
    and it duly said so: the spread moment reached t = -3.58 with a shuffled p
    of 0.002 on both stages, agreeing in sign, surviving a control for the
    policy move. It was still an artefact. Re-fitting at neighbouring latent
    widths moved one stage's coefficient from +0.27 to -2.86, and splitting the
    sample in half put the whole effect in the second half.

    So a moment has to clear the threshold AND keep its sign across widths the
    experimenter did not choose. A verdict function that can be fooled by a
    hyperparameter is a bug, not a finding.
    """
    if strongest is None:
        return {"outcome": "not_assessable",
                "reason": "no moment had enough events to fit a slope"}
    largest = abs(float(strongest["t"]))
    if largest < 2.0:
        return {"outcome": "does_not_predict", "largest_abs_t": largest, "threshold": 2.0,
                "reason": ("the pre-registered criterion was |t| >= 2 on a primary moment; "
                           f"the largest measured is {largest:.2f}")}
    if stability is None:
        return {"outcome": "unstable_or_unchecked", "largest_abs_t": largest, "threshold": 2.0,
                "reason": (f"|t| = {largest:.2f} clears the threshold but was not re-fitted at "
                           "other latent widths, so it may be a hyperparameter artefact")}
    if not stability.get("stable"):
        return {"outcome": "does_not_predict", "largest_abs_t": largest, "threshold": 2.0,
                "stability": stability,
                "reason": (f"|t| = {largest:.2f} clears the threshold and does NOT survive "
                           f"re-fitting: {stability.get('reason')}")}
    return {"outcome": "predicts", "largest_abs_t": largest, "threshold": 2.0,
            "stability": stability,
            "reason": (f"|t| = {largest:.2f} clears the threshold and holds its sign across "
                       "latent widths")}


def check_stability(body: np.ndarray, condition: np.ndarray, refs: list[str], speeds: dict,
                    moment: str, stage: str, *, args: argparse.Namespace) -> dict[str, object]:
    """Re-fit at neighbouring latent widths and see whether the sign holds.

    The width is a choice nobody can justify to the third decimal, so a result
    that depends on it is a result about the choice.
    """
    widths = [w for w in (args.latent_dim - 4, args.latent_dim - 2,
                          args.latent_dim + 2) if w >= 4]
    signs: list[float] = []
    for width in widths:
        refit = fit_spectrum(body, condition, latent_dim=width, points=args.points,
                             draws=args.draws, shuffles=8, seed=args.seed,
                             whiten=not args.no_whiten)
        if isinstance(refit, FitRefusal):
            continue
        xs, ys = [], []
        for index, ref in enumerate(refs):
            scored = score_event(refit, ref, body[index], condition[index],
                                 draws=args.score_draws, seed=args.seed)
            value = dict(MOMENTS).get(moment, lambda _s: None)(scored)
            speed = speeds.get((ref, stage))
            if scored.state != "ok" or value is None or not speed:
                continue
            xs.append(float(value))
            ys.append(float(np.log(speed)))
        row = regress(xs, ys, draws=200, seed=args.seed)
        if row.get("state") == "ok" and row.get("t") is not None:
            signs.append(float(row["t"]))
    if len(signs) < 2:
        return {"stable": False, "widths": widths, "t_values": signs,
                "reason": "too few widths could be re-fitted to judge stability"}
    same_sign = all(value > 0 for value in signs) or all(value < 0 for value in signs)
    strong = sum(1 for value in signs if abs(value) >= 1.5)
    stable = same_sign and strong >= max(1, len(signs) - 1)
    return {
        "stable": bool(stable), "widths": widths,
        "t_values": [round(value, 2) for value in signs],
        "reason": ("the sign holds and the effect persists at other widths" if stable else
                   f"re-fitting gives t values {[round(v, 2) for v in signs]}, which "
                   + ("change sign" if not same_sign else "mostly fall below 1.5")),
    }
