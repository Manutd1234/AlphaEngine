"""Turning measured stages into a report a reader can argue with.

Lifted out of `tools/diffusion_phase0.py` when that file crossed the length
ceiling, and it belongs here anyway: the CLI's job is arguments and a loop, and
what a number means is the package's.

Everything here is about not overclaiming. The placebo summary runs the whole
pipeline on windows with no announcement in them, because a ratio between two
stage times that also appears on an ordinary afternoon is a property of the
hour and not of the news. The attrition is printed rather than implied. The
parameter digest exists so that two reports can be compared or refused.
"""

from __future__ import annotations

import argparse
import json
from hashlib import sha256
from typing import Any

import numpy as np

from modules.coherence.diffusion import tunables
from modules.coherence.diffusion.absorption import STAGE_HORIZONS

_HORIZON_LABELS = tuple(horizon.label for horizon in STAGE_HORIZONS)


def calendar_verification(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """How many of the meetings in this report have been checked, and against what.

    A report that says `calendar_verified: false` while the verification has in
    fact been run is as wrong as one that claims verification it never did. The
    text store holds one row per statement fetched from the issuer's own page,
    with the release time the page stated; this reads it and reports the count.
    Missing store, missing rows and disagreeing rows are three different
    answers.
    """
    try:
        from modules.coherence.diffusion.texts import DiffusionTextStore

        store = DiffusionTextStore()
    except Exception as exc:  # noqa: BLE001 - the reason is the answer
        return {"state": "unavailable", "reason": str(exc), "verified": 0, "of": len(rows)}
    try:
        confirmed = 0
        for row in rows:
            found = store.get(str(row["source_ref"]))
            if found and found.get("state") == "ok" and found.get("verified_release_time"):
                confirmed += 1
    finally:
        store.close()
    return {
        "state": "ok" if confirmed == len(rows) else "partial",
        "verified": confirmed,
        "of": len(rows),
        "how": ("each meeting's statement was fetched from the issuer's own URL and its "
                "'For release at' line compared with the calendar's hour"),
    }


def persist(report: dict[str, Any], *, store: Any = None) -> int:
    """Write the measured runs into the ledger the desk reads.

    The tool is the production caller for the modules under it, and this is
    what makes the numbers reachable from the workspace rather than living in
    a JSON file on somebody's laptop.
    """
    from modules.coherence.diffusion.runs import AbsorptionRun, AbsorptionRunStore

    ledger = AbsorptionRunStore(store) if store is not None else AbsorptionRunStore()
    written = 0
    for row in report["rows"]:
        for stage in ("release", "call"):
            block = row.get(stage)
            if not block:
                continue
            ledger.record(AbsorptionRun(
                run_id=f"{row['source_ref']}|{row['asset']}|{stage}",
                source_ref=str(row["source_ref"]), symbol=str(row["asset"]), stage=stage,
                interval=report["interval"], signal_state=block["signal_state"],
                signal_reason=block.get("signal_reason"),
                terminal_return=block.get("terminal_return"),
                sigma_pre_per_bar=block.get("sigma_pre_per_bar"),
                pre_bars=int(block.get("pre_bars") or 0),
                half_life_s=block.get("half_life_s"), half_life_state=block.get("half_life_state"),
                half_life_vol=block.get("half_life_vol"),
                control_percentile=block.get("control_percentile"),
                controls_used=int(block.get("controls_used") or 0),
                measured_horizons=int(block.get("measured_horizons") or 0),
                of_horizons=int(block.get("of_horizons") or 0),
                market_adjusted=bool(block.get("market_adjusted")),
                data_hash=block.get("data_hash"), params_version=report["params_version"],
                t0_ms=float(block["t0_ms"]), points=block.get("points") or [],
            ), computed_at=float(report["generated_at_ms"]))
            written += 1
    return written



def _params_version(args: argparse.Namespace) -> str:
    """A digest of everything that would make two runs incomparable."""
    payload = json.dumps({
        "interval": args.interval, "pre_days": args.pre_days, "controls": args.controls,
        "terminal_min": tunables.DIFFUSION_STAGE_TERMINAL_MIN,
        "floor_sigma": tunables.DIFFUSION_SIGNAL_FLOOR_SIGMA,
        "pre_min_bars": tunables.DIFFUSION_PRE_MIN_BARS,
        "horizons": list(_HORIZON_LABELS), "seed": tunables.DIFFUSION_SEED,
    }, sort_keys=True)
    return sha256(payload.encode()).hexdigest()[:16]



def _placebo_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The same measurement on windows with no announcement in them.

    The identification check. If a non-event window at the same clock time on a
    prior day yields the same ratio between the two stage times, the ratio is a
    property of the hour rather than of the news, and the finding is an
    artefact. Reported beside the result rather than in a footnote, because it
    is the thing that decides whether the result means anything.
    """
    out: dict[str, Any] = {}
    for stage in ("release", "call"):
        events: list[float] = []
        controls: list[float] = []
        percentiles: list[float] = []
        for row in rows:
            block = row.get(stage)
            if not block or block.get("signal_state") != "ok":
                continue
            if block.get("half_life_vol"):
                events.append(float(block["half_life_vol"]))
            controls.extend(float(value) for value in block.get("placebo_half_life_vol") or [])
            if block.get("control_percentile") is not None:
                percentiles.append(float(block["control_percentile"]))
        out[stage] = {
            "event_median": float(np.median(events)) if events else None,
            "event_n": len(events),
            "placebo_median": float(np.median(controls)) if controls else None,
            "placebo_n": len(controls),
            "control_percentile_median": float(np.median(percentiles)) if percentiles else None,
        }
    both = out.get("release", {}), out.get("call", {})
    for name, key in (("event_ratio_call_over_release", "event_median"),
                      ("placebo_ratio_call_over_release", "placebo_median")):
        left, right = both[0].get(key), both[1].get(key)
        out[name] = (right / left) if left and right else None
    return out



def _verdict_json(report: Any) -> dict[str, Any]:
    return {
        "state": report.state, "clock": report.clock, "verdict": report.verdict,
        "n_meetings": report.n_clusters, "n_rows": report.n_rows,
        "min_meetings": report.min_clusters, "reason": report.reason,
        "median_log_ratio": report.median_log_ratio,
        "ci_low": report.ci_low, "ci_high": report.ci_high,
        "sign_test_p": report.sign_test_p,
        "n_call_slower": report.n_call_slower, "n_release_slower": report.n_release_slower,
        "n_ties": report.n_ties,
        "horizons": [
            {"horizon": delta.horizon, "n_meetings": delta.n_clusters,
             "median_delta_absorbed": delta.median_delta,
             "ci_low": delta.ci_low, "ci_high": delta.ci_high}
            for delta in report.horizons
        ],
    }



def summarise(report: dict[str, Any]) -> str:
    lines = [
        f"arm={report['arm']} interval={report['interval']} symbols={','.join(report['symbols'])}",
        f"meetings considered: {report['meetings_considered']}  "
        f"terminal: {report['stage_terminal_min']:g} min",
        f"calendar: {report['calendar']['verified']} of {report['calendar']['of']} meetings "
        f"confirmed against the issuer's own pages",
    ]
    gate = report.get("signal_attrition", {})
    for stage in ("release", "call"):
        counts = gate.get(stage, {})
        if counts:
            lines.append(f"{stage:>7} stages: " + ", ".join(
                f"{state} {count}" for state, count in sorted(counts.items())))
    placebo = report.get("placebo") or {}
    if placebo.get("event_ratio_call_over_release") and placebo.get("placebo_ratio_call_over_release"):
        lines.append(
            f"identification: event call/release ratio "
            f"{placebo['event_ratio_call_over_release']:.2f}x against a placebo ratio of "
            f"{placebo['placebo_ratio_call_over_release']:.2f}x on non-event windows "
            f"(n={placebo['release']['placebo_n']} / {placebo['call']['placebo_n']})")
    for stage in ("release", "call"):
        block = placebo.get(stage) or {}
        if block.get("control_percentile_median") is not None:
            lines.append(
                f"{stage:>7} sits at control percentile "
                f"{block['control_percentile_median']:.2f} "
                f"(0.5 would be indistinguishable from a window with no announcement)")
    unpaired = report.get("verdict_unpaired_vol_clock")
    if unpaired and unpaired["state"] == "ok":
        lines.append(
            f"unpaired vol clock: {unpaired['verdict']}  release median "
            f"{unpaired['median_release']:.3g} vs call {unpaired['median_call']:.3g}  "
            f"log-ratio {unpaired['median_log_ratio']:+.3f} "
            f"[{unpaired['ci_low']:+.3f}, {unpaired['ci_high']:+.3f}]  "
            f"n={unpaired['n_meetings']} meetings ({unpaired['n_release']} release, "
            f"{unpaired['n_call']} call)")
    elif unpaired:
        lines.append(f"unpaired vol clock: {unpaired['verdict']} — {unpaired['reason']}")
    for key in ("verdict_vol_clock", "verdict_wall_clock"):
        block = report[key]
        if block["state"] != "ok":
            lines.append(f"{block['clock']:>5} clock: {block['verdict']} — {block['reason']}")
            continue
        lines.append(
            f"{block['clock']:>5} clock: {block['verdict']}  n={block['n_meetings']} meetings "
            f"({block['n_rows']} rows)  median log-ratio "
            f"{block['median_log_ratio']:.3f} [{block['ci_low']:.3f}, {block['ci_high']:.3f}]  "
            f"sign p={block['sign_test_p']:.4g}  call slower on {block['n_call_slower']}, "
            f"release slower on {block['n_release_slower']}"
        )
    return "\n".join(lines)
