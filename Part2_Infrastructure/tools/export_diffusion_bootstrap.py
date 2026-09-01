#!/usr/bin/env python3
"""Export the verified FOMC evidence subset, never the whole data-ops file.

The source SQLite file is an operator artefact and is deliberately ignored by
Git.  Production needs the 62 issuer documents and 248 already-computed stage
measurements inside it, but it must not receive work items, quality findings,
schedule state, or any other row merely because those tables share a file.

This exporter therefore names every selected table and every selected column.
It also derives the minimum event index from two independent pieces of stored
evidence: the issuer statement's own ``For release at`` clock and the measured
run anchors.  The release clock is labelled ``issuer``; the later call anchor
is deliberately labelled ``estimated_offset`` because the statement does not
verify when a press conference began.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data/data_ops.sqlite"
DEFAULT_OUTPUT = (
    ROOT / "modules/coherence/diffusion/bootstrap_data/fomc_issuer_evidence_v1.json"
)
SCHEMA = "alphaengine.diffusion.fomc-bootstrap.v1"
_ET = ZoneInfo("America/New_York")
_REF = re.compile(r"^fed:(\d{4}-\d{2}-\d{2})$")
_ISSUER_URL = re.compile(
    r"^https://www\.federalreserve\.gov/newsevents/pressreleases/"
    r"monetary(\d{8})a\.htm$"
)
_CLOCK = re.compile(r"^(\d{2}):(\d{2}) (EST|EDT)$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_HEX16 = re.compile(r"^[0-9a-f]{16}$")

TEXT_COLUMNS = (
    "text_id", "source_ref", "stage", "source", "url", "state", "reason",
    "body", "sha256", "characters", "verified_release_time", "body_isolated",
    "vote_line", "first_seen_at", "fetched_at",
)
RUN_COLUMNS = (
    "run_id", "source_ref", "symbol", "stage", "interval", "signal_state",
    "signal_reason", "terminal_return", "sigma_pre_per_bar", "pre_bars",
    "half_life_s", "half_life_state", "half_life_vol", "control_percentile",
    "controls_used", "measured_horizons", "of_horizons", "market_adjusted",
    "data_hash", "params_version", "t0_ms", "points_json", "computed_at",
)


def _rows(connection: sqlite3.Connection, table: str, columns: tuple[str, ...]) -> list[dict[str, Any]]:
    """Read an allowlisted projection; callers cannot pass arbitrary SQL."""
    allowed = {"diffusion_texts": TEXT_COLUMNS, "diffusion_runs": RUN_COLUMNS}
    if allowed.get(table) != columns:
        raise ValueError(f"unsupported bootstrap projection: {table}")
    cursor = connection.execute(
        f"SELECT {','.join(columns)} FROM {table} ORDER BY {columns[0]}"  # noqa: S608
    )
    return [dict(row) for row in cursor.fetchall()]


def _release_ms(source_ref: str, issuer_clock: str, url: str) -> float:
    ref = _REF.fullmatch(source_ref)
    clock = _CLOCK.fullmatch(issuer_clock)
    issuer = _ISSUER_URL.fullmatch(url)
    if not ref or not clock or not issuer:
        raise ValueError(f"{source_ref}: malformed issuer identity or release clock")
    date = ref.group(1)
    if issuer.group(1) != date.replace("-", ""):
        raise ValueError(f"{source_ref}: issuer URL date does not match its source ref")
    year, month, day = (int(part) for part in date.split("-"))
    local = datetime(
        year, month, day, int(clock.group(1)), int(clock.group(2)), tzinfo=_ET,
    )
    if local.tzname() != clock.group(3):
        raise ValueError(
            f"{source_ref}: issuer says {clock.group(3)} but New York was {local.tzname()}"
        )
    return local.astimezone(timezone.utc).timestamp() * 1000.0


def _validate_text(row: dict[str, Any]) -> None:
    source_ref = str(row["source_ref"])
    if row["text_id"] != f"{source_ref}|release|statement":
        raise ValueError(f"{source_ref}: text id does not name its evidence channel")
    if (row["stage"], row["source"], row["state"]) != ("release", "statement", "ok"):
        raise ValueError(f"{source_ref}: only successful issuer release statements may ship")
    body = row.get("body")
    if not isinstance(body, str) or len(body) != int(row["characters"]):
        raise ValueError(f"{source_ref}: statement character count does not match its body")
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    if digest != row.get("sha256") or not _HEX64.fullmatch(digest):
        raise ValueError(f"{source_ref}: statement digest does not match its body")
    _release_ms(source_ref, str(row["verified_release_time"]), str(row["url"]))


def _validate_run(row: dict[str, Any]) -> None:
    source_ref = str(row["source_ref"])
    expected_id = f"{source_ref}|{row['symbol']}|{row['stage']}"
    if row["run_id"] != expected_id:
        raise ValueError(f"{source_ref}: run id does not name its asset and stage")
    if row["symbol"] not in {"BTCUSDT", "ETHUSDT"}:
        raise ValueError(f"{source_ref}: unexpected asset {row['symbol']!r}")
    if row["stage"] not in {"release", "call"} or row["interval"] != "1m":
        raise ValueError(f"{source_ref}: unexpected stage or interval")
    if not _HEX64.fullmatch(str(row.get("data_hash") or "")):
        raise ValueError(f"{source_ref}: run has no reproducible data hash")
    if not _HEX16.fullmatch(str(row.get("params_version") or "")):
        raise ValueError(f"{source_ref}: run has no parameter digest")
    points = json.loads(str(row.pop("points_json")))
    if not isinstance(points, list) or len(points) != int(row["of_horizons"]):
        raise ValueError(f"{source_ref}: horizon evidence does not match its count")
    row["points"] = points


def _event_rows(texts: list[dict[str, Any]], runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        by_ref.setdefault(str(run["source_ref"]), []).append(run)
    events: list[dict[str, Any]] = []
    for text in texts:
        source_ref = str(text["source_ref"])
        release_at = _release_ms(
            source_ref, str(text["verified_release_time"]), str(text["url"]),
        )
        stages = by_ref.get(source_ref, [])
        release_anchors = {float(row["t0_ms"]) for row in stages if row["stage"] == "release"}
        call_anchors = {float(row["t0_ms"]) for row in stages if row["stage"] == "call"}
        symbols = {str(row["symbol"]) for row in stages}
        if release_anchors != {release_at} or len(call_anchors) != 1:
            raise ValueError(f"{source_ref}: issuer clock and measured stage anchors disagree")
        if symbols != {"BTCUSDT", "ETHUSDT"} or len(stages) != 4:
            raise ValueError(f"{source_ref}: expected exactly two assets by two stages")
        call_at = call_anchors.pop()
        offset = (call_at - release_at) / 60_000.0
        if offset not in {30.0, 60.0}:
            raise ValueError(f"{source_ref}: unsupported estimated call offset {offset}")
        # The issuer evidence proves the release instant.  It does not prove a
        # press-conference instant, so that clock remains an estimated offset.
        # Non-standard decision hours are the two inter-meeting decisions in
        # this evidence set; the derivation is stated in the artifact rather
        # than disguised as another issuer fact.
        scheduled = str(text["verified_release_time"]).startswith("14:00 ")
        observed_at = float(text["fetched_at"])
        # The erased calendar's earlier first-seen value cannot be recovered.
        # The text clock is a conservative upper bound: diffusion_text.py could
        # only fetch this document after it had read that event from the ledger.
        events.append({
            "source_ref": source_ref,
            "kind": "fomc",
            "symbol": None,
            "title": f"FOMC statement {source_ref.removeprefix('fed:')}",
            "release_at": release_at,
            "release_at_source": "issuer",
            "release_timing": "exact",
            "call_at": call_at,
            "call_at_source": "estimated_offset",
            "call_offset_min": offset,
            "eps_estimate": None,
            "eps_actual": None,
            "surprise_pct": None,
            "scheduled": 1 if scheduled else 0,
            "statement_url": text["url"],
            "first_seen_at": float(text["first_seen_at"]),
            "last_seen_at": observed_at,
            "revised_count": 0,
            "verified_at": observed_at,
        })
    return events


def payload_digest(tables: dict[str, list[dict[str, Any]]]) -> str:
    encoded = json.dumps(
        tables, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_artifact(source: Path) -> dict[str, Any]:
    connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        texts = _rows(connection, "diffusion_texts", TEXT_COLUMNS)
        runs = _rows(connection, "diffusion_runs", RUN_COLUMNS)
    finally:
        connection.close()
    for row in texts:
        _validate_text(row)
    for row in runs:
        _validate_run(row)
    events = _event_rows(texts, runs)
    if (len(events), len(texts), len(runs)) != (62, 62, 248):
        raise ValueError(
            f"refusing incomplete evidence: events={len(events)}, texts={len(texts)}, "
            f"runs={len(runs)}"
        )
    tables = {"diffusion_events": events, "diffusion_texts": texts, "diffusion_runs": runs}
    refs = sorted(row["source_ref"] for row in events)
    return {
        "manifest": {
            "schema": SCHEMA,
            "dataset_id": "fomc-issuer-evidence-2019-01-30--2026-07-29-v1",
            "first_source_ref": refs[0],
            "last_source_ref": refs[-1],
            "counts": {name: len(rows) for name, rows in tables.items()},
            "payload_sha256": payload_digest(tables),
            "provenance": {
                "release": (
                    "Federal Reserve statement URL plus the statement's own "
                    "'For release at' EST/EDT line"
                ),
                "call": (
                    "Measured stage anchor retained as estimated_offset; the issuer "
                    "statement does not verify a press-conference start"
                ),
                "scheduled": (
                    "14:00 New York issuer releases classified scheduled; the two "
                    "non-standard issuer release hours classified inter-meeting"
                ),
                "event_first_seen": (
                    "Conservative document first_seen clock; the discarded event row's "
                    "earlier observation clock is unavailable"
                ),
                "runs": (
                    "Previously computed Binance 1m BTCUSDT/ETHUSDT measurements; "
                    "each row carries data_hash and params_version"
                ),
            },
            "excluded_tables": [
                "data_quality_findings", "data_quality_escalations", "data_schedule_runs",
                "data_work_items", "data_work_item_ids", "diffusion_studies",
            ],
        },
        "tables": tables,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="refuse if --out differs")
    args = parser.parse_args(argv)
    artifact = build_artifact(args.source)
    rendered = json.dumps(artifact, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.check:
        if not args.out.exists() or args.out.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"{args.out} is not the reproducible export of {args.source}")
        print(f"verified {args.out}: {artifact['manifest']['payload_sha256']}")
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    print(
        f"wrote {args.out}: 62 issuer events, 62 texts, 248 runs; "
        f"sha256={artifact['manifest']['payload_sha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
