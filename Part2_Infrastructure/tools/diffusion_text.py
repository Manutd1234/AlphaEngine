#!/usr/bin/env python3
"""Fetch each statement from the issuer, and retire the unverified disclaimer.

    venv/bin/python tools/diffusion_text.py --limit 5
    venv/bin/python tools/diffusion_text.py --persist

The calendar in `modules/coherence/diffusion/fomc.py` was written from
knowledge rather than fetched, so every row ships `verified_at: None` and the
Phase 0 report says `calendar_verified: false`. This is what changes that, and
it does two jobs with one request: the statement text is the input to the
information estimator, and the page it came from is the evidence that the
calendar row is right.

Both halves of a row are checked. A 200 from the date's own URL confirms the
DATE. The page's own "For release at 2:00 p.m. EDT" line confirms the HOUR,
which is the half a written calendar is most likely to get wrong and the half
the two-stage comparison rests on — 15 March 2020 was announced at 17:00 on a
Sunday, and a row that passed a date check while assuming 14:00 would anchor
the measurement three hours before anything happened.

Nothing is retried silently and nothing is assumed. A mismatch is printed with
both times; a 404 says the row is wrong.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.coherence.diffusion import fomc  # noqa: E402
from modules.coherence.diffusion.text import fetch_statement, headline_of  # noqa: E402
from modules.coherence.diffusion.texts import DiffusionTextStore, verify_calendar  # noqa: E402


def run(args: argparse.Namespace, *, client=None, sleep=time.sleep) -> dict[str, object]:
    now_ms = datetime.now(timezone.utc).timestamp() * 1000.0
    rows = fomc.seed_rows(now_ms=now_ms)
    if args.limit:
        rows = rows[-args.limit:]
    store = DiffusionTextStore() if args.persist else None

    verified: list[str] = []
    mismatched: list[tuple[str, str]] = []
    unavailable: list[tuple[str, str]] = []
    for index, row in enumerate(rows):
        fetched = fetch_statement(str(row["source_ref"]), str(row["statement_url"]), client=client)
        expected = _expected_time(str(row["source_ref"]))
        agreed, reason = verify_calendar(fetched, expected)
        if agreed:
            verified.append(str(row["source_ref"]))
        elif fetched.state == "ok":
            mismatched.append((str(row["source_ref"]), reason or ""))
        else:
            unavailable.append((str(row["source_ref"]), reason or fetched.state))
        if store is not None:
            store.record(fetched, stage="release", source="statement", now_ms=now_ms)
        if args.delay and index + 1 < len(rows):
            sleep(args.delay)

    if store is not None:
        store.close()
    return {
        "checked": len(rows), "verified": verified, "mismatched": mismatched,
        "unavailable": unavailable, "persisted": bool(args.persist),
    }


def _expected_time(source_ref: str) -> str:
    date = source_ref.removeprefix("fed:")
    for meeting in fomc.FOMC_SEED:
        if meeting.date == date:
            return meeting.statement_et
    return "14:00"


def summarise(report: dict[str, object]) -> str:
    lines = [
        f"checked {report['checked']} meetings against the issuer's own pages",
        f"  verified   {len(report['verified'])}  (date and hour both confirmed)",
        f"  mismatched {len(report['mismatched'])}",
        f"  unreadable {len(report['unavailable'])}",
    ]
    for source_ref, reason in list(report["mismatched"])[:10]:
        lines.append(f"    ✕ {source_ref}: {reason}")
    for source_ref, reason in list(report["unavailable"])[:10]:
        lines.append(f"    ◌ {source_ref}: {reason}")
    if not report["mismatched"] and not report["unavailable"]:
        lines.append("  the calendar seed is confirmed end to end; verified_at may be written")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=0, help="most recent N meetings only")
    parser.add_argument("--delay", type=float, default=0.35, help="seconds between requests")
    parser.add_argument("--persist", action="store_true", help="store the text and its digest")
    parser.add_argument("--show", type=int, default=0, help="print the first N headlines")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = run(args)
    print(summarise(report))
    if args.show:
        store = DiffusionTextStore()
        rows, _ = store.list_texts(limit=args.show)
        for row in rows:
            if row.get("body"):
                print(f"\n{row['source_ref']}: {headline_of(str(row['body']))[:200]}")
        store.close()
    return 0 if not report["mismatched"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
