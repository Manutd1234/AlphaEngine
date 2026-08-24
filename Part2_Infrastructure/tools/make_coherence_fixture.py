#!/usr/bin/env python3
"""Record what the desk should receive for a universe read, from recorded input.

    python tools/make_coherence_fixture.py            # write the fixture
    python tools/make_coherence_fixture.py --check    # fail if it is stale

WHY THIS FILE EXISTS
--------------------------------------------------------------------------
The gateway and the browser are two separately deployed units that cannot call
each other, and the desk reads fields this module's own code puts on the wire.
Until now nothing held the two halves to one answer: a field renamed in
``views.py`` and a field renamed in ``lib/coherence/types.ts`` were two green
suites and one blank panel.

This is the same mechanism ``tools/make_gate_fixture.py`` already uses for the
risk battery, pointed at the coherence universe. It records the payload the
REAL ``event_view`` builds, from the REAL ``parse_event`` / ``parse_market``,
over payloads captured from the live exchange — then:

  * ``tests/test_coherence_universe_parity.py`` asserts the gateway still
    reproduces it, so a change to the shaping is caught in Python;
  * ``web/tests/coherence-universe-parity.test.ts`` reads the SAME file and
    asserts the desk's guards accept it and its metrics compute off it, so a
    change to the reading is caught in TypeScript.

One committed JSON, two languages held to it, neither able to drift quietly.

WHAT IS REAL HERE AND WHAT IS ASSEMBLED
--------------------------------------------------------------------------
Every market, every price and every size below is Kalshi's, read out of
``tests/fixtures/coherence/``. Nothing is invented; there is no generator and
no seed. Two things are assembled rather than captured, and both are stated
because a reader has to be able to tell them apart from the record:

1. **The books are each market's own top of book**, not a bulk orderbook read.
   That is a real production path rather than a shortcut — ``observe_event``
   falls back to exactly this when the orderbook route refuses an
   unauthenticated read, and marks the observation ``top_of_book`` so no depth
   question is answered from data that cannot answer it. This does the same.

2. **Only ``event_mee`` carries the exchange's own mutual-exclusivity flag.**
   A ``/markets`` response does not state it, so the two families built from
   market lists are recorded as NOT mutually exclusive. That is the honest
   reading of a payload that is silent — deriving the flag from floor/cap
   arithmetic would invent a claim the venue never made, which is the thing
   ``basket_totals`` exists to refuse. It also happens to be the live desk's
   own shape: of the three watched families, two carry no basket total.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coherence_fixtures import body, markets  # noqa: E402

from modules.coherence.drivers.kalshi_parse import (  # noqa: E402
    Event,
    parse_event,
    parse_market,
)
from modules.coherence.syscalls.observe import MarketObservation, Observation  # noqa: E402
from modules.coherence.views import event_view  # noqa: E402
from modules.schemas_coherence import CoherenceUniverse  # noqa: E402

OUT = ROOT / "web" / "tests" / "fixtures" / "coherence-universe-parity.json"

# The one note `observe_event` attaches when it takes the top-of-book path, so
# the recorded read says how it was taken in the gateway's own words.
TOP_OF_BOOK_NOTE = (
    "orderbook route refused an unauthenticated read (401); using the market "
    "object's top of book, which cannot answer a depth question"
)


def _observe(event: Event) -> Observation:
    """One family, booked from its markets' own top of book."""
    tradable = [market for market in event.markets if market.is_open]
    return Observation(
        # A fixed clock. `ts_ns` is not read by any view, and a real one would
        # make every regeneration a diff.
        ts_ns=0,
        event=event,
        markets=[MarketObservation(market=market, book=market.top) for market in tradable],
        notes=[TOP_OF_BOOK_NOTE],
        depth="top_of_book",
    )


def _family_from_market_list(fixture: str) -> Event:
    """An event assembled from a `/markets` page, which states no event flag."""
    parsed = [parse_market(payload) for payload in markets(fixture)]
    first = parsed[0]
    return Event(
        event_ticker=first.event_ticker,
        series_ticker=first.series_ticker,
        title="",
        # NOT mutually exclusive: see this module's docstring. The venue did not
        # say, so neither does this.
        mutually_exclusive=False,
        exchange_index=first.exchange_index,
        settlement_sources=(),
        markets=tuple(parsed),
    )


def _recorded_category(fixture: str) -> dict[str, str]:
    """One series' published category, keyed by its ticker.

    The category is nested under ``series`` in the capture, and reading it off
    the top level silently yields nothing. This raises instead of defaulting:
    an empty category string is falsy on the desk, so it renders as
    "uncategorised" — which would have made a capture that HAS the category
    look exactly like one that does not, and quietly emptied the one slice of
    the composition ring this corpus exists to fill.
    """
    series = body(fixture).get("series") or {}
    ticker, category = series.get("ticker"), series.get("category")
    if not ticker or not category:
        raise SystemExit(
            f"{fixture} carries no series ticker/category — re-read the capture "
            "rather than recording an empty label"
        )
    return {str(ticker): str(category)}


def build() -> dict[str, Any]:
    events = [
        parse_event(body("event_mee")),
        _family_from_market_list("markets_ladder"),
        _family_from_market_list("markets_crypto"),
    ]
    observations = [_observe(event) for event in events]
    universe = CoherenceUniverse(
        state="ok",
        events=[event_view(observation) for observation in observations],
        watchlist=sorted({event.series_ticker for event in events}),
        # Kalshi's own category, from the recorded series read. Only KXHIGHNY
        # was captured, so the others are absent — which is the uncategorised
        # path the desk has to render, exercised rather than filled in.
        categories=_recorded_category("series_ladder"),
        notes=list(dict.fromkeys(note for observation in observations for note in observation.notes)),
    )
    return {
        "version": 1,
        "generated_by": "tools/make_coherence_fixture.py",
        "built_from": ["event_mee", "markets_ladder", "markets_crypto", "series_ladder"],
        "universe": universe.model_dump(mode="json"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed fixture is stale")
    args = parser.parse_args()

    text = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUT.exists():
            print(f"missing {OUT.relative_to(ROOT)}; run tools/make_coherence_fixture.py", file=sys.stderr)
            return 1
        if OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT.relative_to(ROOT)} is stale; run tools/make_coherence_fixture.py", file=sys.stderr)
            return 1
        print(f"{OUT.relative_to(ROOT)} is current")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
