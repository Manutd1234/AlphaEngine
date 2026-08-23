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
from modules.coherence.diffusion.runs import AbsorptionRunStore  # noqa: E402
from modules.coherence.diffusion.spectrum import (  # noqa: E402
    FitRefusal,
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


def load_documents(encoder: TextEncoder, *, limit: int) -> tuple[np.ndarray, np.ndarray, list[str]]:
    store = DiffusionTextStore()
    try:
        rows, _ = store.list_texts(limit=limit)
    finally:
        store.close()
    bodies, headlines, refs = [], [], []
    for row in rows:
        if row.get("state") != "ok" or not row.get("body"):
            continue
        body = str(row["body"])
        embedded_body = encoder.embed(body)
        embedded_head = encoder.embed(headline_of(body, sentences=2))
        if embedded_body.state == "ok" and embedded_head.state == "ok":
            bodies.append(embedded_body.vector)
            headlines.append(embedded_head.vector)
            refs.append(str(row["source_ref"]))
    if not refs:
        return np.empty((0, 0)), np.empty((0, 0)), []
    return np.asarray(bodies), np.asarray(headlines), refs


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
    body, headline, refs = load_documents(encoder, limit=args.limit)
    if not refs:
        return {"state": "unavailable",
                "reason": "no statement has been fetched; run tools/diffusion_text.py --persist",
                "encoder_reason": encoder.reason}

    fit = fit_spectrum(body, headline, latent_dim=args.latent_dim, points=args.points,
                       draws=args.draws, shuffles=args.shuffles, seed=args.seed)
    if isinstance(fit, FitRefusal):
        return {"state": "refused", "reason": fit.reason, "events": len(refs)}

    scored = {ref: score_event(fit, ref, body[index], headline[index], draws=args.score_draws,
                               seed=args.seed)
              for index, ref in enumerate(refs)}
    speeds = half_lives()

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

    strongest = max(
        (row for row in regressions.values() if row.get("state") == "ok" and row.get("t")),
        key=lambda row: abs(float(row["t"])), default=None)
    return {
        "state": "ok",
        "fit": summarise(fit),
        "events_scored": sum(1 for s in scored.values() if s.state == "ok"),
        "events_refused": sum(1 for s in scored.values() if s.state != "ok"),
        "regressions": regressions,
        "verdict": _verdict(strongest),
        "spectra": {ref: {"state": s.state, "total_nats": s.total_nats,
                          "alpha_centroid": s.alpha_centroid, "fine_fraction": s.fine_fraction}
                    for ref, s in scored.items()},
    }


def _verdict(strongest: dict[str, object] | None) -> dict[str, object]:
    if strongest is None:
        return {"outcome": "not_assessable",
                "reason": "no moment had enough events to fit a slope"}
    largest = abs(float(strongest["t"]))
    return {
        "outcome": "predicts" if largest >= 2.0 else "does_not_predict",
        "largest_abs_t": largest,
        "threshold": 2.0,
        "reason": ("the pre-registered criterion was |t| >= 2 on a primary moment; "
                   f"the largest measured is {largest:.2f}"),
    }


def summarise_report(report: dict[str, object]) -> str:
    if report.get("state") != "ok":
        return f"{report.get('state')}: {report.get('reason')}"
    lines = [
        f"fit: {report['fit']['events_fitted']} statements, latent dim "
        f"{report['fit']['latent_dim']}, effective rank "
        f"{report['fit']['effective_rank']:.2f}",
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
    parser.add_argument("--latent-dim", dest="latent_dim", type=int, default=10)
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
