"""The Phase 0 runner end to end, against a vendor that answers from a formula.

The point is not the number — the fake tape has no news in it — but that the
whole chain runs, that a synthetic difference between the two stages comes
back as `differ`, that no difference comes back as `flat`, and that the report
never claims the calendar was checked.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import diffusion_phase0 as runner  # noqa: E402

STEP = 60_000
DAY = 86_400_000


def _fake_binance(*, release_half_life_min: float, call_half_life_min: float, jump: float = 0.02):
    """A tape that is quiet except for a decay after each stage of each meeting."""
    stages: list[tuple[int, float]] = []
    for row in runner.fomc.seed_rows():
        stages.append((int(row["release_at"]), release_half_life_min))
        if row["call_at"] is not None:
            stages.append((int(row["call_at"]), call_half_life_min))

    def price(stamp: int) -> float:
        level = 100.0
        for t0, half in stages:
            if stamp <= t0:
                continue
            minutes = (stamp - t0) / 60_000.0
            level *= 1.0 + jump * (1.0 - 0.5 ** (minutes / half))
        rng = np.random.default_rng(stamp % 100_003)
        return level * float(np.exp(rng.normal(0.0, 0.00005)))

    def handler(request: httpx.Request) -> httpx.Response:
        start = int(request.url.params["startTime"])
        end = int(request.url.params["endTime"])
        limit = int(request.url.params["limit"])
        stamp = start - (start % STEP)
        rows = []
        while stamp <= end and len(rows) < limit:
            value = price(stamp)
            rows.append([stamp, value, value, value, value, 1.0])
            stamp += STEP
        return httpx.Response(200, json=rows)

    return httpx.MockTransport(handler)


def _args(tmp_path: Path, **overrides):
    parser = runner.build_parser()
    argv = [
        "--symbols", "BTCUSDT",
        "--from", str(overrides.pop("from_date", "2026-01-01")),
        "--pre-days", "1",
        "--controls", "2",
        "--min-events", str(overrides.pop("min_events", 3)),
        "--now-ms", str(overrides.pop("now_ms", 1_785_000_000_000)),
        "--cache-dir", str(tmp_path / "cache"),
    ]
    return parser.parse_args(argv)


@pytest.fixture()
def slow_call(tmp_path):
    client = httpx.Client(transport=_fake_binance(release_half_life_min=1.0, call_half_life_min=9.0))
    try:
        yield runner.run(_args(tmp_path), client=client)
    finally:
        client.close()


class TestTheChainRuns:
    def test_it_measures_every_meeting_in_range(self, slow_call):
        assert slow_call["meetings_considered"] >= 3
        assert len(slow_call["rows"]) == slow_call["meetings_considered"]

    def test_both_stages_are_measured_on_each_row(self, slow_call):
        for row in slow_call["rows"]:
            assert row["release"]["signal_state"] == "ok", row["release"]["signal_reason"]
            assert row["call"] is not None and row["call"]["signal_state"] == "ok"

    def test_the_sub_minute_horizons_are_reported_unmeasured(self, slow_call):
        points = {point["horizon"]: point for point in slow_call["rows"][0]["release"]["points"]}
        assert points["1s"]["state"] == "unavailable"
        assert points["30s"]["state"] == "unavailable"

    def test_the_summary_names_both_clocks(self, slow_call):
        text = runner.summarise(slow_call)
        assert "vol clock" in text and "wall clock" in text


class TestTheVerdictFollowsTheTape:
    def test_a_slower_second_stage_is_found(self, slow_call):
        verdict = slow_call["verdict_vol_clock"]
        assert verdict["state"] == "ok"
        assert verdict["verdict"] == "differ"
        assert verdict["median_log_ratio"] > 0, "the slower stage should sit above zero"

    def test_two_identical_stages_read_flat(self, tmp_path):
        client = httpx.Client(transport=_fake_binance(release_half_life_min=4.0, call_half_life_min=4.0))
        try:
            report = runner.run(_args(tmp_path), client=client)
        finally:
            client.close()
        assert report["verdict_vol_clock"]["verdict"] == "flat"

    def test_too_few_meetings_is_refused_with_its_count(self, tmp_path):
        client = httpx.Client(transport=_fake_binance(release_half_life_min=1.0, call_half_life_min=9.0))
        try:
            report = runner.run(_args(tmp_path, min_events=999), client=client)
        finally:
            client.close()
        verdict = report["verdict_vol_clock"]
        assert verdict["state"] == "not_assessable"
        assert "of 999 meetings" in verdict["reason"]


class TestTheReportDoesNotOverclaim:
    def test_it_says_the_calendar_is_unverified(self, slow_call):
        assert slow_call["calendar_verified"] is False
        assert "federalreserve.gov" in slow_call["calendar_note"]

    def test_every_row_carries_the_bars_it_was_computed_over(self, slow_call):
        for row in slow_call["rows"]:
            assert row["release"]["data_hash"]

    def test_it_serialises(self, slow_call, tmp_path):
        out = tmp_path / "report.json"
        out.write_text(json.dumps(slow_call, default=float))
        assert json.loads(out.read_text())["arm"] == "fomc-crypto"


class TestTheCacheIsUsed:
    def test_a_second_run_makes_no_vendor_call(self, tmp_path):
        calls = {"n": 0}

        def counting(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return _fake_binance(release_half_life_min=2.0, call_half_life_min=6.0).handler(request)

        client = httpx.Client(transport=httpx.MockTransport(counting))
        try:
            runner.run(_args(tmp_path), client=client)
            first = calls["n"]
            runner.run(_args(tmp_path), client=client)
        finally:
            client.close()
        assert first > 0
        assert calls["n"] == first, "the cached window was fetched again"
