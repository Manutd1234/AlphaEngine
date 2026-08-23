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

from modules.coherence.diffusion import gate  # noqa: E402
from modules.coherence.diffusion.embed import TextEncoder  # noqa: E402
from modules.coherence.diffusion.experiment import (  # noqa: E402
    MOMENTS,
    _verdict,
    check_stability,
    half_lives,
    load_documents,
    regress,
    standardised_responses,
)
from modules.coherence.diffusion.latent import fit_pca  # noqa: E402
from modules.coherence.diffusion.spectrum import (  # noqa: E402
    FitRefusal,
    centroid_spread,
    fit_spectrum,
    score_event,
    summarise,
)


def run(args: argparse.Namespace) -> dict[str, object]:
    encoder = TextEncoder()
    body, headline, refs, policy = load_documents(encoder, limit=args.limit,
                                                  conditioning=args.conditioning,
                                                  segment=args.segment)
    if not refs:
        return {"state": "unavailable",
                "reason": "no statement has been fetched; run tools/diffusion_text.py --persist",
                "encoder_reason": encoder.reason}

    # THE ADMISSIBILITY GATE. A latent that cannot recover a fact written in the
    # documents has no standing to report that the documents say nothing, and
    # the whole-statement latent cannot: it recovers the policy move at
    # out-of-fold R^2 = -0.60 while the decision sentence alone reaches +0.70.
    known = np.array([policy.get(ref, {}).get("move_bp")
                      if policy.get(ref, {}).get("move_bp") is not None else np.nan
                      for ref in refs], dtype=float)
    probe = fit_pca(body, args.latent_dim, whiten=True)
    admissibility = gate.check(probe.project(body), known,
                               floor=args.gate_floor,
                               fact="the policy move in basis points")

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
        "gate": {"state": admissibility.state, "r_squared": admissibility.r_squared,
                 "floor": admissibility.floor, "samples": admissibility.samples,
                 "reason": admissibility.reason},
        "fit": {**summarise(fit), "conditioning": args.conditioning,
                "segment": args.segment},
        "centroid_spread": spread,
        "events_scored": sum(1 for s in scored.values() if s.state == "ok"),
        "events_refused": sum(1 for s in scored.values() if s.state != "ok"),
        "regressions": regressions,
        "verdict": (_verdict(strongest, stability) if admissibility.admissible else {
            "outcome": "inadmissible",
            "reason": ("the representation did not clear the gate, so nothing measured "
                       f"through it is evidence about the text: {admissibility.reason}"),
        }),
        "strongest_moment": strongest_key,
        "spectra": {ref: {"state": s.state, "total_nats": s.total_nats,
                          "alpha_centroid": s.alpha_centroid, "fine_fraction": s.fine_fraction}
                    for ref, s in scored.items()},
    }


def summarise_report(report: dict[str, object]) -> str:
    if report.get("state") != "ok":
        return f"{report.get('state')}: {report.get('reason')}"
    lines = [
        f"gate: {report['gate']['state']} — the latent recovers the policy move at "
        f"out-of-fold R2 {report['gate']['r_squared']:+.3f} "
        f"(floor {report['gate']['floor']:+.2f}, n={report['gate']['samples']})",
        f"fit: {report['fit']['events_fitted']} {report['fit']['segment']} segments against the "
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
    parser.add_argument("--segment", choices=("decision", "guidance", "whole"),
                        default="decision",
                        help="which part of the statement is embedded")
    parser.add_argument("--gate-floor", dest="gate_floor", type=float, default=0.20,
                        help="out-of-fold R^2 the latent must reach on a known fact")
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
