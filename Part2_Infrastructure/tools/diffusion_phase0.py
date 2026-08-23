#!/usr/bin/env python3
"""Run the Phase 0 kill test and write what it found, whatever that is.

    venv/bin/python tools/diffusion_phase0.py --arm fomc-crypto \
        --symbols BTCUSDT,ETHUSDT --interval 1m --from 2024-01-01 \
        --cache-dir /tmp/diffusion-cache --out report.json

The question: an FOMC decision arrives in two stages thirty minutes apart —
the statement, which is a number a machine can read, and the press conference,
which is a person answering questions. Do prices finish absorbing the two at
the same speed? If they do not differ at all, the premise the whole module
rests on is wrong and the estimator is not worth building.

Why this arm first. It needs no vendor, no key, no forward capture and no
torch: the stage timestamps are public to the minute and Binance serves minute
bars back to 2017 for nothing. It can therefore run today and can return
`flat`, which is the outcome the plan commits to publishing.

The report is JSON and prints its own summary. Every number in it carries the
count behind it, the clock it was measured on, and the placebo run beside it;
`verdict: "flat"` is a result, not a failure, and `not_assessable` is neither.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from modules.coherence.diffusion import fomc, tunables  # noqa: E402
from modules.coherence.diffusion.absorption import (  # noqa: E402
    STAGE_HORIZONS,
    PathReport,
    abnormal_path,
)
from modules.coherence.diffusion.bars import (  # noqa: E402
    BarSeries,
    fetch_binance_window,
    series_from_klines,
)
from modules.coherence.diffusion.clock import (  # noqa: E402
    matched_controls,
    percentile_of,
    volatility_clock,
)
from modules.coherence.diffusion.decay import HalfLife, half_life  # noqa: E402
from modules.coherence.diffusion.phase0 import (  # noqa: E402
    StagePair,
    paired_stage_test,
    unpaired_stage_test,
)
from modules.coherence.diffusion.report import (  # noqa: E402
    _params_version,
    _placebo_summary,
    _verdict_json,
    persist,
    summarise,
)

_DAY_MS = 86_400_000
_HORIZON_SECONDS = tuple(h.seconds for h in STAGE_HORIZONS)
_HORIZON_LABELS = tuple(h.label for h in STAGE_HORIZONS)


def _iso_ms(text: str) -> int:
    return int(datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp() * 1000)


def _cache_path(cache_dir: Path | None, symbol: str, interval: str, start: int, end: int) -> Path | None:
    if cache_dir is None:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{symbol}-{interval}-{start}-{end}.json"


def load_window(symbol: str, interval: str, start: int, end: int, *, cache_dir: Path | None,
                client: Any | None) -> BarSeries:
    """One fetch per (meeting, asset), cached, so a re-run costs nothing."""
    path = _cache_path(cache_dir, symbol, interval, start, end)
    if path is not None and path.exists():
        return series_from_klines(symbol, interval, json.loads(path.read_text()))
    series = fetch_binance_window(symbol, interval, start, end, client=client)
    if path is not None and len(series):
        rows = [[int(t), float(o), float(h), float(low), float(c), float(v)] for t, o, h, low, c, v
                in zip(series.ts, series.open, series.high, series.low, series.close, series.volume, strict=True)]
        path.write_text(json.dumps(rows))
    return series


def _half_lives(report: PathReport, clock_axis: np.ndarray) -> tuple[HalfLife, HalfLife]:
    absorbed = np.asarray(
        [np.nan if point.absorbed is None else point.absorbed for point in report.points],
        dtype=np.float64,
    )
    wall = half_life(np.asarray(_HORIZON_SECONDS, dtype=np.float64), absorbed)
    vol = half_life(clock_axis, absorbed)
    return wall, vol


def _point_rows(report: PathReport) -> list[dict[str, Any]]:
    return [
        {
            "horizon": point.horizon, "state": point.state, "reason": point.reason,
            "abnormal_return": point.abnormal_return, "absorbed": point.absorbed,
            "bars": point.bars,
        }
        for point in report.points
    ]


def measure_stage(series: BarSeries, t0_ms: int, stage: str, *, pre_days: int, controls: int,
                  now_ms: int) -> dict[str, Any]:
    """One stage of one meeting on one asset, on both clocks, with its placebo."""
    report = abnormal_path(series, t0_ms, stage=stage, now_ms=now_ms,
                           pre_sessions=pre_days, horizons=STAGE_HORIZONS)
    windows = matched_controls(series, t0_ms, k=controls,
                               pre_min_bars=tunables.DIFFUSION_PRE_MIN_BARS,
                               lookback_ms=_DAY_MS)
    clock = volatility_clock(series, windows, _HORIZON_SECONDS)
    wall, vol = _half_lives(report, clock.axis())

    placebo: list[float] = []
    for window in windows:
        control_report = abnormal_path(series, window.t0_ms, stage=f"{stage}-placebo",
                                       now_ms=now_ms, pre_sessions=pre_days,
                                       horizons=STAGE_HORIZONS)
        if control_report.signal_state != "ok":
            continue
        _, control_vol = _half_lives(control_report, clock.axis())
        if control_vol.state == "ok" and control_vol.value is not None:
            placebo.append(control_vol.value)

    return {
        "stage": stage, "t0_ms": t0_ms, "signal_state": report.signal_state,
        "signal_reason": report.signal_reason, "terminal_return": report.terminal_return,
        "sigma_pre_per_bar": report.sigma_pre_per_bar, "pre_bars": report.pre_bars,
        "market_adjusted": report.market_adjusted, "data_hash": report.data_hash,
        "measured_horizons": report.measured_horizons(), "of_horizons": len(report.points),
        "half_life_s": wall.value, "half_life_state": wall.state, "half_life_reason": wall.reason,
        "half_life_vol": vol.value, "half_life_vol_state": vol.state,
        "clock_state": clock.state, "clock_reason": clock.reason,
        "controls_used": len(windows),
        "placebo_half_life_vol": placebo,
        "control_percentile": percentile_of(vol.value, placebo),
        "absorbed": {point.horizon: point.absorbed for point in report.points},
        "points": _point_rows(report),
    }


def run(args: argparse.Namespace, *, client: Any | None = None) -> dict[str, Any]:
    now_ms = args.now_ms if args.now_ms is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
    from_ms = _iso_ms(args.from_date)
    meetings = [row for row in fomc.seed_rows(now_ms=now_ms) if row["release_at"] >= from_ms]
    if args.limit:
        meetings = meetings[-args.limit:]
    cache_dir = Path(args.cache_dir) if args.cache_dir else None
    symbols = tuple(part.strip().upper() for part in args.symbols.split(",") if part.strip())

    rows: list[dict[str, Any]] = []
    pairs: list[StagePair] = []
    for meeting in meetings:
        release_at = int(meeting["release_at"])
        call_at = meeting["call_at"]
        start = release_at - (args.pre_days + args.controls + 1) * _DAY_MS
        end = release_at + int(_HORIZON_SECONDS[-1] * 1000) + 2 * _DAY_MS
        for symbol in symbols:
            series = load_window(symbol, args.interval, start, end, cache_dir=cache_dir, client=client)
            if len(series) == 0:
                rows.append({"source_ref": meeting["source_ref"], "asset": symbol,
                             "state": "unavailable", "reason": series.reason})
                continue
            release = measure_stage(series, release_at, "release", pre_days=args.pre_days,
                                    controls=args.controls, now_ms=now_ms)
            call = (measure_stage(series, int(call_at), "call", pre_days=args.pre_days,
                                  controls=args.controls, now_ms=now_ms)
                    if call_at is not None else None)
            rows.append({"source_ref": meeting["source_ref"], "asset": symbol,
                         "scheduled": meeting["scheduled"], "verified_at": meeting["verified_at"],
                         "release": release, "call": call})
            if call is not None:
                pairs.append(StagePair(
                    cluster=str(meeting["source_ref"]), asset=symbol,
                    release_half_life=release["half_life_vol"], call_half_life=call["half_life_vol"],
                    release_absorbed=release["absorbed"], call_absorbed=call["absorbed"],
                ))

    verdict = paired_stage_test(
        pairs, clock="vol", min_clusters=args.min_events,
        draws=tunables.DIFFUSION_BOOTSTRAP_DRAWS, seed=tunables.DIFFUSION_SEED,
        horizons=_HORIZON_LABELS,
    )
    wall_pairs = [StagePair(pair.cluster, pair.asset,
                            _stage_of(rows, pair, "release"), _stage_of(rows, pair, "call"))
                  for pair in pairs]
    wall_verdict = paired_stage_test(
        wall_pairs, clock="wall", min_clusters=args.min_events,
        draws=tunables.DIFFUSION_BOOTSTRAP_DRAWS, seed=tunables.DIFFUSION_SEED,
    )
    by_stage: dict[str, dict[str, list[float]]] = {"release": {}, "call": {}}
    attrition: dict[str, dict[str, int]] = {"release": {}, "call": {}}
    for row in rows:
        for stage in ("release", "call"):
            block = row.get(stage)
            if not block:
                continue
            attrition[stage][block["signal_state"]] = attrition[stage].get(block["signal_state"], 0) + 1
            value = block.get("half_life_vol")
            if block["signal_state"] == "ok" and value:
                by_stage[stage].setdefault(str(row["source_ref"]), []).append(float(value))
    placebo = _placebo_summary(rows)
    unpaired = unpaired_stage_test(
        by_stage["release"], by_stage["call"], clock="vol", min_clusters=args.min_events,
        draws=tunables.DIFFUSION_BOOTSTRAP_DRAWS, seed=tunables.DIFFUSION_SEED,
    )
    return {
        "arm": args.arm,
        "generated_at_ms": now_ms,
        "params_version": _params_version(args),
        "calendar_verified": False,
        "calendar_note": ("the FOMC seed has not been checked against federalreserve.gov; "
                          "no number here may be cited until it has"),
        "interval": args.interval,
        "symbols": list(symbols),
        "meetings_considered": len(meetings),
        "stage_terminal_min": tunables.DIFFUSION_STAGE_TERMINAL_MIN,
        "horizons": list(_HORIZON_LABELS),
        "signal_attrition": attrition,
        "placebo": placebo,
        "verdict_unpaired_vol_clock": {
            "state": unpaired.state, "clock": unpaired.clock, "verdict": unpaired.verdict,
            "n_meetings": unpaired.n_clusters, "n_release": unpaired.n_release,
            "n_call": unpaired.n_call, "median_release": unpaired.median_release,
            "median_call": unpaired.median_call, "median_log_ratio": unpaired.median_log_ratio,
            "ci_low": unpaired.ci_low, "ci_high": unpaired.ci_high, "reason": unpaired.reason,
        },
        "verdict_vol_clock": _verdict_json(verdict),
        "verdict_wall_clock": _verdict_json(wall_verdict),
        "rows": rows,
    }


def _stage_of(rows: list[dict[str, Any]], pair: StagePair, stage: str) -> float | None:
    for row in rows:
        if row.get("source_ref") == pair.cluster and row.get("asset") == pair.asset:
            block = row.get(stage)
            return None if block is None else block.get("half_life_s")
    return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--arm", default="fomc-crypto", choices=("fomc-crypto",))
    parser.add_argument("--symbols", default=",".join(tunables.DIFFUSION_MACRO_ASSETS))
    parser.add_argument("--interval", default="1m")
    parser.add_argument("--from", dest="from_date", default="2019-01-01")
    parser.add_argument("--limit", type=int, default=0, help="most recent N meetings only")
    parser.add_argument("--pre-days", dest="pre_days", type=int, default=2)
    parser.add_argument("--controls", type=int, default=tunables.DIFFUSION_CONTROLS_PER_EVENT)
    parser.add_argument("--min-events", dest="min_events", type=int,
                        default=tunables.DIFFUSION_PHASE0_MIN_EVENTS)
    parser.add_argument("--cache-dir", dest="cache_dir", default=None)
    parser.add_argument("--now-ms", dest="now_ms", type=int, default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--persist", action="store_true",
                        help="write the measured runs into the desk's absorption ledger")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = run(args)
    print(summarise(report))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=float))
        print(f"wrote {args.out}")
    if args.persist:
        print(f"filed {persist(report)} stage runs into the absorption ledger")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
