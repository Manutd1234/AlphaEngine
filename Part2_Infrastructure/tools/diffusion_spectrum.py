#!/usr/bin/env python3
"""Score each statement's information spectrum, and test it against the speed.

    venv/bin/python tools/diffusion_spectrum.py --latent-dim 10 --out spectrum.json

This is the experiment the module was built for, and it is the one that failed.
The question: an announcement's headline and its body are both public at the
same instant, so the resolution at which the first explains the second is
knowable before any price moves. Does that resolution say how long the price
will take to finish absorbing the news?

Measured over 62 FOMC statements against absorption half-lives from BTC and ETH
at one minute: no. Every pre-registered moment of the spectrum comes back
inside its own shuffled-pairing null. The pre-registered criterion was |t| < 2
on both primary moments, so the torch extra was never written; the result is
recorded in docs/planning/PLAN.md rather than left as an absence.

The tool stays because a negative result nobody can re-run is an opinion. It
reports every moment, every t, and a shuffled null beside each one, and it says
how many events survived the signal gate — which is the honest limit on all of
it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from modules.coherence.diffusion.embed import TextEncoder  # noqa: E402
from modules.coherence.diffusion.policy import rate_path  # noqa: E402
from modules.coherence.diffusion.runs import AbsorptionRunStore  # noqa: E402
from modules.coherence.diffusion.spectrum import (  # noqa: E402
    FitRefusal,
    centroid_spread,
    fit_spectrum,
    score_event,
    summarise,
)
from modules.coherence.diffusion.text import headline_of  # noqa: E402
from modules.coherence.diffusion.texts import DiffusionTextStore  # noqa: E402

MOMENTS = (
    ("alpha_centroid", lambda s: s.alpha_centroid),
    ("total_nats", lambda s: s.total_nats),
    ("fine_fraction", lambda s: s.fine_fraction),
    ("iqr_spread", lambda s: None if s.q75 is None or s.q25 is None else s.q75 - s.q25),
)


def load_documents(encoder: TextEncoder, *, limit: int, conditioning: str
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
        opening = headline_of(body, sentences=2)
        embedded = encoder.embed(body)
        if embedded.state != "ok":
            previous = None
            continue
        if conditioning == "prior":
            other = previous
        elif conditioning == "remainder":
            residual = encoder.embed(body[len(opening):].strip() or body)
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
    import json as _json

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
        for cell in _json.loads(row.get("points_json") or "[]"):
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


def run(args: argparse.Namespace) -> dict[str, object]:
    encoder = TextEncoder()
    body, headline, refs, policy = load_documents(encoder, limit=args.limit,
                                                  conditioning=args.conditioning)
    if not refs:
        return {"state": "unavailable",
                "reason": "no statement has been fetched; run tools/diffusion_text.py --persist",
                "encoder_reason": encoder.reason}

    fit = fit_spectrum(body, headline, latent_dim=args.latent_dim, points=args.points,
                       draws=args.draws, shuffles=args.shuffles, seed=args.seed,
                       whiten=not args.no_whiten)
    if isinstance(fit, FitRefusal):
        return {"state": "refused", "reason": fit.reason, "events": len(refs)}

    scored = {ref: score_event(fit, ref, body[index], headline[index], draws=args.score_draws,
                               seed=args.seed)
              for index, ref in enumerate(refs)}
    speeds = half_lives()
    responses = standardised_responses()
    spread = centroid_spread([s.alpha_centroid for s in scored.values()], fit)

    regressions: dict[str, dict[str, object]] = {}
    for stage in ("release", "call"):
        for name, extract in MOMENTS:
            xs, ys = [], []
            for ref, spectrum in scored.items():
                if spectrum.state != "ok":
                    continue
                value = extract(spectrum)
                speed = speeds.get((ref, stage))
                if value is None or speed is None or speed <= 0:
                    continue
                xs.append(float(value))
                ys.append(float(np.log(speed)))
            regressions[f"{stage}:{name}"] = regress(xs, ys, draws=args.null_draws, seed=args.seed)

    # The positive control. An absorption pipeline that cannot detect
    # "a bigger policy move produces a bigger response" is measuring noise, and
    # every null it reports is unfalsifiable. This is what makes the nulls
    # above mean something.
    for stage in ("release", "call"):
        pairs = [(abs(float(policy[ref]["move_bp"])), value)
                 for (ref, other), value in responses.items()
                 if other == stage and policy.get(ref, {}).get("move_bp") is not None]
        regressions[f"{stage}:policy_move_bp->response"] = regress(
            [pair[0] for pair in pairs], [pair[1] for pair in pairs],
            draws=args.null_draws, seed=args.seed)

    named = [(key, row) for key, row in regressions.items()
             if row.get("state") == "ok" and row.get("t") and "policy_move" not in key]
    strongest_key, strongest = max(named, key=lambda pair: abs(float(pair[1]["t"])),
                                   default=(None, None))
    stability = None
    if strongest is not None and abs(float(strongest["t"])) >= 2.0:
        stage, moment = strongest_key.split(":", 1)
        stability = check_stability(body, headline, refs, speeds, moment, stage, args=args)
    return {
        "state": "ok",
        "fit": {**summarise(fit), "conditioning": args.conditioning},
        "centroid_spread": spread,
        "events_scored": sum(1 for s in scored.values() if s.state == "ok"),
        "events_refused": sum(1 for s in scored.values() if s.state != "ok"),
        "regressions": regressions,
        "verdict": _verdict(strongest, stability),
        "strongest_moment": strongest_key,
        "spectra": {ref: {"state": s.state, "total_nats": s.total_nats,
                          "alpha_centroid": s.alpha_centroid, "fine_fraction": s.fine_fraction}
                    for ref, s in scored.items()},
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


def summarise_report(report: dict[str, object]) -> str:
    if report.get("state") != "ok":
        return f"{report.get('state')}: {report.get('reason')}"
    lines = [
        f"fit: {report['fit']['events_fitted']} statements against the "
        f"{report['fit']['conditioning']}, latent dim {report['fit']['latent_dim']}"
        f"{' whitened' if report['fit']['whitened'] else ' UNWHITENED'}",
        f"     effective rank {report['fit']['effective_rank']:.2f} = "
        f"{report['fit']['effective_rank_index']:.2f}/10"
        + (f"   centroid spread {report['centroid_spread']['span']:.3f} = "
           f"{report['centroid_spread']['index']:.2f}/10"
           if report["centroid_spread"]["index"] is not None else ""),
        f"     log-SNR centre {report['fit']['logsnr_loc']:.3f}, scale "
        f"{report['fit']['logsnr_scale']:.3f}, clip {report['fit']['logsnr_clip']:g}",
        f"     panel information {report['fit']['panel_information_nats']:.3f} nats, "
        f"shuffled floor {report['fit']['floor_nats']:.3f}",
        f"scored {report['events_scored']}, refused {report['events_refused']}",
        "",
        f"{'moment':>28}  {'n':>3} {'t':>7} {'r':>7} {'shuffle p':>10}",
    ]
    for name, row in report["regressions"].items():
        if row.get("state") != "ok":
            lines.append(f"{name:>28}  {row['n']:>3} {'—':>7} {'—':>7} {'—':>10}")
            continue
        lines.append(f"{name:>28}  {row['n']:>3} {float(row['t']):+7.2f} "
                     f"{float(row['r']):+7.3f} {float(row['shuffled_p']):>10.3f}")
    verdict = report["verdict"]
    lines += ["", f"verdict: {verdict['outcome']} — {verdict['reason']}"]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--latent-dim", dest="latent_dim", type=int, default=12)
    parser.add_argument("--conditioning", choices=("prior", "headline", "remainder"),
                        default="prior",
                        help="what the statement is measured against")
    parser.add_argument("--no-whiten", dest="no_whiten", action="store_true",
                        help="fit an unwhitened latent (measured to be worse)")
    parser.add_argument("--points", type=int, default=60)
    parser.add_argument("--draws", type=int, default=4)
    parser.add_argument("--score-draws", dest="score_draws", type=int, default=10)
    parser.add_argument("--shuffles", type=int, default=20)
    parser.add_argument("--null-draws", dest="null_draws", type=int, default=2_000)
    parser.add_argument("--limit", type=int, default=400)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--out", default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = run(args)
    print(summarise_report(report))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=float))
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
