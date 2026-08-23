"""Does the text predict absorption speed? Asked out of sample, on every event.

This module replaces the question the study used to answer. The old one was
"does any of eight univariate in-sample regressions reach |t| >= 2", and it
has three defects that all push the same way — towards a verdict that is about
the estimator rather than about the market.

WHAT CHANGED, AND WHY EACH CHANGE IS NOT A CHOICE OF ANSWER.

1. THE TARGET NO LONGER NEEDS A SIGNAL. `half_life_s` is fitted only where the
   move cleared two sigma, which is 26 of 62 release meetings and 29 of 62
   call meetings — the study threw away more than half its events to measure
   its own dependent variable. `residence_time` integrates the area above the
   absorption curve instead. For an exponential approach that IS the time
   constant, so it is the same quantity the half-life estimates; but it is a
   path integral rather than a fit, so it is defined for every meeting whose
   path was measured at all. 62 and 62.

2. A HARD GATE BECOMES A WEIGHT. A two-sigma cut is a weight of one on one
   side of a line and zero on the other, and the line is not derivable from
   anything. The signal-to-noise ratio of the terminal move is known per row,
   so an event whose move is barely distinguishable from its own pre-window
   counts in proportion to how well it is measured instead of being deleted.

3. THE STAGES ARE POOLED AND THE MOVE IS CONTROLLED FOR. Release and call were
   fitted separately, halving n twice. One fit with a stage indicator uses both
   and — this is the point — the policy move enters as a CONTROL rather than as
   a rival finding, because it is the one quantity already known to move the
   price at four standard errors. The question is what the text adds to it.

4. THE VERDICT IS OUT OF SAMPLE. An in-sample t on the largest of eight fits is
   the statistic most likely to be an artefact, and `experiment._verdict`
   already carries the scar: a moment reached t = -3.58 with a shuffled p of
   0.002 and was a hyperparameter. Leave-one-MEETING-out prediction cannot be
   inflated that way — both stages of a meeting leave together, so nothing the
   held-out row shares with its own other stage can leak into its prediction.

WHAT THIS IS NOT. It is not a more permissive test. It is a harder one: a
predictor now has to improve prediction on meetings the fit has never seen,
against a baseline that already knows the stage and the size of the rate move.
The specification above was fixed before it was run, and the grid it was run
over is reported entire rather than at its best cell.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

#: Horizons the absorption ledger records, in minutes from t-zero.
HORIZON_MINUTES = {"1s": 1 / 60, "30s": 0.5, "1m": 1.0, "2m": 2.0, "5m": 5.0,
                   "10m": 10.0, "15m": 15.0, "30m": 30.0}

#: The terminal horizon every stage is measured to. `DIFFUSION_STAGE_TERMINAL_MIN`
#: is the tunable; this is the value the recorded ledger was written at, and a
#: path that does not reach it is not a completed absorption curve.
TERMINAL_MINUTES = 30.0

#: Meetings below which no skill is reported. Out-of-sample R^2 over fewer than
#: this is dominated by which meetings happened to land in the fit.
MIN_MEETINGS = 20

#: The out-of-sample gain a predictor must reach. Zero is the honest threshold
#: and the only one that is not a choice: below it the text makes predictions
#: WORSE than not having read the text.
SKILL_FLOOR = 0.0


def residence_time(cells: list[dict[str, Any]]) -> tuple[float, float] | None:
    """Mean residence time of one stage's move, in minutes, and its terminal size.

    ``tau = integral from 0 to 30 of (1 - absorbed(t)) dt``, where ``absorbed``
    is the abnormal return at each measured horizon over the abnormal return at
    the terminal one, joined piecewise-linearly and anchored at absorbed(0) = 0.

    A fast absorption spends little time unabsorbed and returns a small tau; a
    move still arriving at the half hour returns a large one. For an exponential
    approach tau is exactly the time constant, which is what makes this the
    half-life's own quantity — measured without fitting, and therefore without
    needing the move to clear a noise floor first.

    Returns ``None`` where the path never reached the terminal horizon or the
    terminal move is exactly zero, because absorbed is undefined in both cases.
    Never returns a tau outside [0, 30]: the integrand is a fraction of an
    interval, and a noisy path that overshoots is clamped rather than allowed
    to report a residence time longer than the window it was measured in.
    """
    points = sorted(
        (HORIZON_MINUTES[cell["horizon"]], float(cell["abnormal_return"]))
        for cell in cells
        if cell.get("state") == "ok"
        and cell.get("abnormal_return") is not None
        and cell.get("horizon") in HORIZON_MINUTES
    )
    if not points or points[-1][0] != TERMINAL_MINUTES:
        return None
    terminal = points[-1][1]
    if terminal == 0.0:
        return None
    times = [0.0] + [minute for minute, _ in points]
    absorbed = [0.0] + [value / terminal for _, value in points]
    tau = sum(
        (times[k] - times[k - 1]) * (1.0 - 0.5 * (absorbed[k] + absorbed[k - 1]))
        for k in range(1, len(times))
    )
    return float(np.clip(tau, 0.0, TERMINAL_MINUTES)), abs(terminal)


def absorption_clock(rows: list[dict[str, Any]]) -> dict[tuple[str, str], tuple[float, float]]:
    """(meeting, stage) -> (residence time in minutes, precision weight).

    BTC and ETH quoting the same meeting are two readings of one event, so they
    are combined — by precision rather than evenly, because a stage whose move
    barely cleared its own pre-window carries a residence time that is mostly
    noise in the asset that saw it least.

    The weight is the squared signal-to-noise of the terminal move. Its noise
    scale is ``sigma_pre_per_bar * sqrt(30)``, since the terminal abnormal
    return is a thirty-bar cumulative and the recorded sigma is per bar.
    """
    grouped: dict[tuple[str, str], list[tuple[float, float]]] = {}
    for row in rows:
        sigma = row.get("sigma_pre_per_bar")
        if not sigma:
            continue
        measured = residence_time(json.loads(row.get("points_json") or "[]"))
        if measured is None:
            continue
        tau, terminal = measured
        snr = terminal / (float(sigma) * np.sqrt(TERMINAL_MINUTES))
        grouped.setdefault((str(row["source_ref"]), str(row["stage"])), []).append((tau, snr**2))
    clock: dict[tuple[str, str], tuple[float, float]] = {}
    for key, readings in grouped.items():
        taus = np.array([tau for tau, _ in readings])
        weights = np.array([weight for _, weight in readings])
        if weights.sum() <= 0:
            continue
        clock[key] = (float((taus * weights).sum() / weights.sum()), float(weights.sum()))
    return clock


def _weighted_fit(design: np.ndarray, target: np.ndarray, weights: np.ndarray) -> np.ndarray:
    root = np.sqrt(weights)[:, None]
    coefficients, *_ = np.linalg.lstsq(design * root, target * np.sqrt(weights), rcond=None)
    return coefficients


def out_of_sample_r2(design: np.ndarray, target: np.ndarray, weights: np.ndarray,
                     meetings: np.ndarray) -> float:
    """Weighted R^2 over predictions made without the meeting being predicted.

    The fold is the MEETING, never the row. A meeting contributes a release row
    and a call row that share a statement, a rate move and an encoder reading,
    so holding out one row while fitting on its sibling would let the text of
    the held-out meeting into its own prediction — leakage that looks exactly
    like skill.
    """
    predicted = np.empty_like(target)
    for meeting in np.unique(meetings):
        held = meetings == meeting
        coefficients = _weighted_fit(design[~held], target[~held], weights[~held])
        predicted[held] = design[held] @ coefficients
    mean = (target * weights).sum() / weights.sum()
    residual = (weights * (target - predicted) ** 2).sum()
    total = (weights * (target - mean) ** 2).sum()
    return float(1.0 - residual / total) if total > 0 else float("nan")


def predictive_skill(clock: dict[tuple[str, str], tuple[float, float]],
                     moments: dict[str, list[float]],
                     policy: dict[str, dict[str, float | None]],
                     *, draws: int = 400, seed: int = 7) -> dict[str, Any]:
    """What the text adds to a baseline that already knows the stage and the move.

    Reports both halves, always. The baseline's own out-of-sample R^2 says
    whether the absorption clock is predictable AT ALL — without it, a text
    predictor that fails is indistinguishable from a target that is pure noise,
    which is the same "null beside a positive control" rule the findings table
    is built on.
    """
    rows = []
    for (ref, stage), (tau, weight) in sorted(clock.items()):
        move = policy.get(ref, {}).get("move_bp")
        vector = moments.get(ref)
        if vector is None or move is None or any(value is None for value in vector):
            continue
        rows.append((ref, stage, tau, weight, abs(float(move)), [float(v) for v in vector]))

    meetings = {row[0] for row in rows}
    if len(meetings) < MIN_MEETINGS:
        return {"state": "too_few",
                "meetings": len(meetings), "rows": len(rows),
                "reason": (f"{len(meetings)} meetings carry both a scored statement and a "
                           f"measured absorption path; {MIN_MEETINGS} is the floor for an "
                           "out-of-sample estimate")}

    groups = np.array([row[0] for row in rows])
    target = np.array([row[2] for row in rows])
    weights = np.array([row[3] for row in rows])
    # One enormous move must not become the whole regression. The cap is a
    # quantile of the weights themselves, so it moves with the sample rather
    # than being a constant somebody picked.
    weights = np.clip(weights, 0.0, float(np.quantile(weights, 0.95)))
    call = np.array([1.0 if row[1] == "call" else 0.0 for row in rows])
    move = np.array([row[4] for row in rows])
    move = (move - move.mean()) / (move.std() or 1.0)
    text = np.array([row[5] for row in rows])
    text = (text - text.mean(axis=0)) / np.where(text.std(axis=0) > 0, text.std(axis=0), 1.0)

    baseline = np.column_stack([np.ones(len(rows)), call, move])
    full = np.column_stack([baseline, text])
    baseline_r2 = out_of_sample_r2(baseline, target, weights, groups)
    full_r2 = out_of_sample_r2(full, target, weights, groups)
    gain = full_r2 - baseline_r2

    # The null is a re-pairing of statements to meetings, not a reshuffle of
    # rows: it has to break the link between a text and its own absorption
    # while leaving both stages of a meeting attached to one statement.
    rng = np.random.default_rng(seed)
    labels = np.unique(groups)
    lookup = {row[0]: row[5] for row in rows}
    null_gains = []
    for _ in range(draws):
        remap = dict(zip(labels, labels[rng.permutation(len(labels))], strict=True))
        shuffled = np.array([lookup[remap[group]] for group in groups])
        shuffled = (shuffled - shuffled.mean(axis=0)) / np.where(
            shuffled.std(axis=0) > 0, shuffled.std(axis=0), 1.0)
        null_gains.append(
            out_of_sample_r2(np.column_stack([baseline, shuffled]), target, weights, groups)
            - baseline_r2)
    null = np.array(null_gains)

    coefficients = _weighted_fit(full, target, weights)
    return {
        "state": "ok",
        "meetings": len(meetings), "rows": len(rows),
        "baseline_r2": baseline_r2, "full_r2": full_r2, "gain": gain,
        "shuffled_p": float((null >= gain).mean()),
        "null_median_gain": float(np.median(null)),
        "stage_minutes": float(coefficients[1]),
        "predicts": bool(gain > SKILL_FLOOR and float((null >= gain).mean()) < 0.05),
        "floor": SKILL_FLOOR,
    }


def verdict(skill: dict[str, Any]) -> dict[str, Any]:
    """The headline, in the vocabulary the console reports it in.

    Four outcomes, not two. "The text does not predict this" and "nothing
    predicts this, so there was never a question" are different findings, and
    the baseline's own out-of-sample R^2 is what separates them.
    """
    if skill.get("state") != "ok":
        return {"outcome": "not_assessable", "reason": skill.get("reason") or "no skill estimate"}
    gain, baseline = float(skill["gain"]), float(skill["baseline_r2"])
    if baseline <= 0.0:
        return {"outcome": "target_unpredictable", "gain": gain, "baseline_r2": baseline,
                "reason": ("the absorption clock is not predictable even from the stage and the "
                           f"size of the rate move (out-of-sample R² {baseline:+.3f}), so no "
                           "null measured against it is evidence about the text")}
    if skill["predicts"]:
        return {"outcome": "predicts", "gain": gain, "baseline_r2": baseline,
                "reason": (f"the text raises out-of-sample R² by {gain:+.3f} over a baseline of "
                           f"{baseline:+.3f} that already knows the stage and the rate move, and "
                           f"a re-pairing of statements to meetings does as well "
                           f"{skill['shuffled_p']:.1%} of the time")}
    return {"outcome": "does_not_predict", "gain": gain, "baseline_r2": baseline,
            "reason": (f"the absorption clock IS predictable — out-of-sample R² {baseline:+.3f} "
                       f"from the stage and the rate move alone — but adding the text changes "
                       f"that by {gain:+.3f}, so the statement's information spectrum does not "
                       "help predict how fast the price finishes moving")}
