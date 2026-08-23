"""The gateway reads the key the workspace actually returns, and drops a bar
rather than inventing a zero.

Two defects, one function. `_web_rows` read `body["data"]` while
`web/app/api/ohlcv/route.ts` returns the series under `bars` on both of its
branches, so every equity backfill fetched zero rows and filed itself as
`outcome: "empty"` — a state that reads exactly like a symbol nobody quotes.
The suite did not catch it because `tests/test_data_jobs.py` faked the
response the gateway wanted rather than the one the route sends: a mocked
collaborator that cannot fail a contract, which `docs/testing/TESTING.md`
records as this plane's own scar.

So the first test here reads the ROUTE SOURCE, not a fixture of it. The
second pins the honesty rule: `bar.get("o", 0)` turned a bar the vendor sent
without an open into a bar that opened at zero, and the contract check
downstream counted it as a bar that arrived.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from config import settings
from modules import data_jobs

ROUTE = Path(__file__).resolve().parent.parent / "web" / "app" / "api" / "ohlcv" / "route.ts"


@pytest.fixture()
def setting():
    """Settings is a frozen dataclass; override a field for one test and put it back."""
    originals: list[tuple[str, object]] = []

    def _set(name: str, value: object) -> None:
        originals.append((name, getattr(settings, name)))
        object.__setattr__(settings, name, value)

    yield _set
    for name, value in reversed(originals):
        object.__setattr__(settings, name, value)


class TestTheEnvelopeKeyIsTheRoutesOwn:
    def test_the_route_returns_its_series_under_bars(self):
        source = ROUTE.read_text()
        returns = re.findall(r"NextResponse\.json\(\{(.+?)\}\)", source, re.S)
        assert returns, f"no NextResponse.json object literal in {ROUTE}"
        series = [block for block in returns if "interval" in block]
        assert series, "neither return carries a bar series"
        for block in series:
            assert re.search(r"\bbars:", block), f"the route stopped returning `bars`:\n{block}"

    def test_the_gateway_reads_that_key_and_not_the_old_one(self):
        source = Path(data_jobs.__file__).read_text()
        web_rows = source.split("def _web_rows", 1)[1].split("\ndef ", 1)[0]
        assert 'body.get("bars")' in web_rows
        assert 'body.get("data")' not in web_rows, "the pre-2026-08-23 key is back; every equity backfill is empty again"


class TestABarWithAMissingFieldIsDroppedNotZeroed:
    @staticmethod
    def _run(setting, bars):
        setting("web_workspace_url", "https://desk.test")
        start = 1_700_000_000_000
        hour = 3_600_000

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"bars": bars, "provenance": {"provider": "massive"}})

        params = {
            "symbol": "AAPL",
            "interval": "1h",
            "from_at": datetime.fromtimestamp(start / 1000, tz=timezone.utc).isoformat(),
            "to_at": datetime.fromtimestamp((start + 5 * hour) / 1000, tz=timezone.utc).isoformat(),
        }
        client = httpx.Client(transport=httpx.MockTransport(handler))
        try:
            return data_jobs.run_backfill(params, client=client)
        finally:
            client.close()

    def test_a_complete_series_arrives_whole(self, setting):
        start, hour = 1_700_000_000_000, 3_600_000
        bars = [{"t": start + i * hour, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(6)]
        out = self._run(setting, bars)
        assert out["rows_fetched"] == 6
        assert out["rows_dropped"] == 0
        assert out["outcome"] != "empty"

    def test_a_bar_with_no_open_is_dropped_and_counted(self, setting):
        start, hour = 1_700_000_000_000, 3_600_000
        bars = [{"t": start + i * hour, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(6)]
        del bars[2]["o"]
        out = self._run(setting, bars)
        assert out["rows_fetched"] == 5, "the incomplete bar was kept"
        assert out["rows_dropped"] == 1, "the drop was not reported, so the loss is invisible"
        assert all(row[1] != 0 for row in out["rows"]), "a missing open was read as a price of zero"

    def test_a_bar_that_is_not_an_object_is_counted_too(self, setting):
        start, hour = 1_700_000_000_000, 3_600_000
        bars = [{"t": start + i * hour, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(6)]
        bars[3] = "not a bar"
        out = self._run(setting, bars)
        assert out["rows_fetched"] == 5
        assert out["rows_dropped"] == 1

    def test_bars_outside_the_range_are_trimmed_and_are_not_drops(self, setting):
        start, hour = 1_700_000_000_000, 3_600_000
        bars = [{"t": start + i * hour, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(-2, 8)]
        out = self._run(setting, bars)
        assert out["rows_dropped"] == 0, "a bar outside the window is trimmed by design, not lost to a defect"
        assert out["rows_fetched"] == 6
