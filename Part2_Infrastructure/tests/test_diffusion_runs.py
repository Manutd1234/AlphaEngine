"""The absorption ledger keeps its refusals, and the route reports them.

The temptation with a signal gate is to store only what passed. Most FOMC
decisions move neither stage two pre-event sigmas, so a ledger of survivors
would describe a quarter of the sample as though it were the whole of it —
and the reader would have no way to know. Every stage is filed, including the
ones that were refused, and the summary counts both.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

import pytest

from modules.api import diffusion as diffusion_api
from modules.coherence.diffusion.runs import AbsorptionRun, AbsorptionRunStore
from modules.data_ops_store import SqliteStore

NOW = 1_700_000_000_000.0


@pytest.fixture()
def ledger():
    path = Path(tempfile.mkdtemp()) / "runs.sqlite"
    made = AbsorptionRunStore(SqliteStore(str(path)))
    try:
        yield made
    finally:
        made.close()


def _run(source_ref: str, stage: str, *, state: str = "ok", half_life: float | None = 120.0,
         absorbed: dict[str, float] | None = None, symbol: str = "BTCUSDT") -> AbsorptionRun:
    cells = [
        {"horizon": horizon, "state": "ok", "absorbed": value, "abnormal_return": 0.01,
         "bars": 5, "reason": None}
        for horizon, value in (absorbed or {"1m": 0.4, "30m": 1.0}).items()
    ]
    return AbsorptionRun(
        run_id=f"{source_ref}|{symbol}|{stage}", source_ref=source_ref, symbol=symbol,
        stage=stage, interval="1m", signal_state=state,
        signal_reason=None if state == "ok" else "the terminal move is 0.4 pre-event sigmas",
        terminal_return=0.012, half_life_s=half_life, half_life_state="ok",
        half_life_vol=None if half_life is None else half_life * 1e-8,
        control_percentile=0.0 if state == "ok" else None, controls_used=5,
        measured_horizons=len(cells), of_horizons=8, data_hash="abc123",
        params_version="v1", t0_ms=NOW, points=cells,
    )


class TestTheLedgerKeepsWhatWasRefused:
    def test_a_refused_stage_is_filed_with_its_reason(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release", state="no_signal", half_life=None),
                      computed_at=NOW)
        rows, _ = ledger.list_runs()
        assert len(rows) == 1
        assert rows[0]["signal_state"] == "no_signal"
        assert rows[0]["half_life_s"] is None
        assert "sigmas" in rows[0]["signal_reason"]

    def test_recording_the_same_stage_twice_replaces_rather_than_duplicates(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release", half_life=100.0), computed_at=NOW)
        ledger.record(_run("fed:2024-01-31", "release", half_life=250.0), computed_at=NOW + 1)
        rows, _ = ledger.list_runs()
        assert len(rows) == 1 and rows[0]["half_life_s"] == 250.0

    def test_a_page_cut_short_says_so(self, ledger):
        for index in range(5):
            ledger.record(_run(f"fed:2024-01-{index + 10}", "release"), computed_at=NOW)
        rows, truncated = ledger.list_runs(limit=2)
        assert len(rows) == 2 and truncated is True


class TestTheRouteSummarisesWithoutHidingTheAttrition:
    @staticmethod
    def _call(store):
        original = diffusion_api._runs
        diffusion_api._runs = lambda: store
        try:
            return asyncio.run(diffusion_api.diffusion_absorption(limit=200, source_ref=None,
                                                                  _actor="test"))
        finally:
            diffusion_api._runs = original

    def test_both_measured_and_refused_reach_the_summary(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release"), computed_at=NOW)
        ledger.record(_run("fed:2024-03-20", "release", state="no_signal", half_life=None),
                      computed_at=NOW)
        ledger.record(_run("fed:2024-01-31", "call", half_life=600.0), computed_at=NOW)
        body = self._call(ledger)
        assert body.state == "ok"
        release = next(stage for stage in body.stages if stage.stage == "release")
        assert release.measured == 1 and release.no_signal == 1
        assert release.median_half_life_s == 120.0

    def test_a_stage_nobody_measured_reports_a_reason_not_a_zero(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release"), computed_at=NOW)
        body = self._call(ledger)
        call = next(stage for stage in body.stages if stage.stage == "call")
        assert call.measured == 0
        assert call.median_half_life_s is None
        assert call.reason == "no stage of this kind cleared the signal floor"

    def test_the_curve_averages_only_the_stages_that_measured_a_horizon(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release", absorbed={"1m": 0.2, "30m": 1.0}),
                      computed_at=NOW)
        ledger.record(_run("fed:2024-03-20", "release", absorbed={"1m": 0.6, "30m": 1.0}),
                      computed_at=NOW)
        body = self._call(ledger)
        index = body.horizons.index("1m")
        assert body.release_curve[index] == pytest.approx(0.4)

    def test_a_horizon_nobody_measured_is_none_rather_than_zero(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release", absorbed={"1m": 0.2}), computed_at=NOW)
        ledger.record(_run("fed:2024-03-20", "call", absorbed={"30m": 1.0}), computed_at=NOW)
        body = self._call(ledger)
        release_at_30m = body.release_curve[body.horizons.index("30m")]
        assert release_at_30m is None, "an unmeasured horizon must not read as zero absorbed"

    def test_a_refused_stage_contributes_nothing_to_the_curve(self, ledger):
        ledger.record(_run("fed:2024-01-31", "release", absorbed={"1m": 0.2}), computed_at=NOW)
        ledger.record(_run("fed:2024-03-20", "release", state="no_signal", half_life=None,
                           absorbed={"1m": 0.9}), computed_at=NOW)
        body = self._call(ledger)
        assert body.release_curve[body.horizons.index("1m")] == pytest.approx(0.2)


class TestTheWireCarriesTheJudgedSigma:
    """`terminal_sigmas` on the wire is the number the refusal sentence quotes.

    The ledger's own first refusal: terminal_return −0.0018434 on a per-bar
    sigma of 0.00047305, 1m bars, a 30m terminal → 30 bars → the move is 0.71
    pre-event sigmas, which is what `_judge` wrote into `signal_reason`. The
    API must land on the same two decimals from the same row, or the desk is
    placing a stage somewhere the floor never judged it.
    """

    def test_the_api_reproduces_the_sentence_from_the_row(self):
        from modules.api.diffusion import _run

        row = {
            "run_id": "fed:2024-01-31|BTCUSDT|release", "source_ref": "fed:2024-01-31",
            "symbol": "BTCUSDT", "stage": "release", "interval": "1m", "signal_state": "no_signal",
            "signal_reason": "the terminal move is 0.71 pre-event sigmas, below the floor of 2",
            "t0_ms": NOW, "terminal_return": -0.0018433557169003387,
            "sigma_pre_per_bar": 0.00047305343208206785, "params_version": "v1",
            "points_json": json.dumps([{"horizon": "1m", "state": "ok"}, {"horizon": "30m", "state": "ok"}]),
        }
        run = _run(row)
        assert run.sigma_pre_per_bar == row["sigma_pre_per_bar"]
        assert run.terminal_sigmas is not None
        assert f"{run.terminal_sigmas:.2f}" == "0.71", run.terminal_sigmas

    def test_no_scale_means_no_position(self):
        from modules.api.diffusion import _run

        row = {
            "run_id": "x", "source_ref": "fed:2024-01-31", "symbol": "BTCUSDT", "stage": "release",
            "interval": "1m", "signal_state": "no_signal", "signal_reason": "3 pre-event returns is below the floor of 20, so there is no scale",
            "t0_ms": NOW, "terminal_return": 0.01, "sigma_pre_per_bar": None, "params_version": "v1",
            "points_json": json.dumps([{"horizon": "30m", "state": "ok"}]),
        }
        assert _run(row).terminal_sigmas is None
