"""The Monte Carlo's parameters, and the half of them the browser also has.

``bootstrap_terminal_distribution`` and ``web/lib/mc-distribution.ts`` run the
same simulation for two runtimes that cannot call each other, and both now take
the resampler, the block length, the seed and the loss confidences as
arguments. Two implementations of one parameter set is two chances to disagree
about what a card is showing, and the disagreement a reader could never spot is
the resampler: an i.i.d. draw and a blocked draw are different distributions
wearing the same axis labels.

So ``web/tests/fixtures/mc-resampler-parity.json`` is the table, this asserts
the Python side of it, and ``web/tests/mc-distribution.test.ts`` asserts the
TypeScript side of the same rows.

The other half of the file is the promise that none of this moved an existing
number: the default call is still the i.i.d. draw it always was, and the 95
figure is still read at the index the old literal gave.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from modules.quant_risk import (
    RESAMPLERS,
    bootstrap_terminal_distribution,
    derived_block_length,
)

# Reaching for the private helper on purpose: the quantile rule is the thing
# under test, and the public result exposes it only through figures that would
# also move if the draw moved. A rule tested through two changing inputs is not
# tested.
from modules.quant_risk.var import _loss_band

FIXTURE = json.loads(
    (Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "mc-resampler-parity.json").read_text()
)


def _series(n: int = 200) -> list[float]:
    """Deterministic, varied, and long enough to clear the 60-observation floor."""
    return [((-1) ** i) * (i % 7) - 1.0 for i in range(n)]


class TestTheCommittedTable:
    """Both stacks answer these rows, or one of them is lying to a reader."""

    def test_the_fixture_is_present_and_shaped(self) -> None:
        assert FIXTURE["version"] == 1
        assert len(FIXTURE["resamplerByBlock"]) >= 4
        assert len(FIXTURE["contradictions"]) == 2

    @pytest.mark.parametrize("row", FIXTURE["resamplerByBlock"], ids=lambda r: f"block{r['meanBlockLength']}")
    def test_the_result_names_the_resampler_the_table_names(self, row: dict) -> None:
        block = row["meanBlockLength"]
        mc = bootstrap_terminal_distribution(
            _series(), 5, paths=200, seed=4, mean_block_length=block, resampler=row["resampler"],
        )
        assert mc.mean_block_length == block
        assert mc.resampler == row["resampler"]
        assert mc.resampler in RESAMPLERS

    @pytest.mark.parametrize("row", FIXTURE["derivedBlockLength"], ids=lambda r: f"n{r['observations']}")
    def test_the_derived_block_length_is_the_same_heuristic(self, row: dict) -> None:
        assert derived_block_length(row["observations"]) == row["meanBlockLength"]

    @pytest.mark.parametrize("row", FIXTURE["contradictions"], ids=lambda r: r["resampler"])
    def test_a_contradictory_pair_raises_rather_than_choosing(self, row: dict) -> None:
        # Silently dropping one of the two would produce a real distribution
        # under a resampler nobody asked for, and every figure drawn from it
        # would look exactly as trustworthy as one that was asked for.
        with pytest.raises(ValueError, match="i.i.d."):
            bootstrap_terminal_distribution(
                _series(), 5, paths=200, seed=4,
                mean_block_length=row["meanBlockLength"], resampler=row["resampler"],
            )

    @pytest.mark.parametrize("band", FIXTURE["lossQuantiles"]["bands"], ids=lambda b: f"p{b['confidence']}")
    def test_a_confidence_maps_to_the_quantile_the_table_names(self, band: dict) -> None:
        result = _loss_band(FIXTURE["lossQuantiles"]["sortedTerminalPnl"], band["confidence"])
        assert result.loss == band["loss"]
        assert result.confidence == band["confidence"]


class TestNothingThatExistedMoved:
    """New arguments, same numbers for every call that does not use them."""

    def test_the_default_call_is_still_the_iid_draw(self) -> None:
        series = _series()
        default = bootstrap_terminal_distribution(series, 5, paths=300, seed=99)
        explicit = bootstrap_terminal_distribution(series, 5, paths=300, seed=99, mean_block_length=1)
        named = bootstrap_terminal_distribution(series, 5, paths=300, seed=99, resampler="iid")
        assert default.terminal_pnl == explicit.terminal_pnl == named.terminal_pnl
        assert default.resampler == "iid"
        assert default.loss_bands == ()

    def test_the_95_figure_is_read_at_the_index_the_old_literal_gave(self) -> None:
        # var95 was `-terminal[ceil(0.05 * paths) - 1]` written out; it is now
        # one call of a rule that takes any confidence. `(100 - C) / 100` is
        # that same double at 95 and `1 - C / 100` is not, which would have
        # shifted the index by one for a fifth of all path counts.
        mc = bootstrap_terminal_distribution(_series(), 6, paths=1_000, seed=17, mean_block_length=8)
        k = max(1, math.ceil(0.05 * len(mc.terminal_pnl)))
        assert mc.var95 == -mc.terminal_pnl[k - 1]
        assert mc.cvar95 == -sum(mc.terminal_pnl[:k]) / k

    def test_a_seeded_run_is_still_reproducible_and_reports_its_seed(self) -> None:
        first = bootstrap_terminal_distribution(_series(), 6, paths=250, seed=7, mean_block_length=8)
        second = bootstrap_terminal_distribution(_series(), 6, paths=250, seed=7, mean_block_length=8)
        assert first.terminal_pnl == second.terminal_pnl
        assert first.seed == 7


class TestTheNewArguments:
    """Each one is honoured, reported, or refused by name."""

    def test_an_unspecified_block_takes_its_answer_from_the_resampler(self) -> None:
        # ``None`` is "not specified" — never zero, and never a block of zero
        # bars. With no resampler named it stays the i.i.d. draw this function
        # has always made; name the stationary bootstrap and the sample fills
        # it in.
        silent = bootstrap_terminal_distribution(_series(180), 5, paths=200, seed=2, mean_block_length=None)
        assert silent.mean_block_length == 1
        assert silent.resampler == "iid"
        blocked = bootstrap_terminal_distribution(
            _series(180), 5, paths=200, seed=2, mean_block_length=None, resampler="stationary",
        )
        assert blocked.mean_block_length == derived_block_length(180) == 13

    def test_stationary_without_a_block_length_derives_one(self) -> None:
        derived = bootstrap_terminal_distribution(_series(180), 5, paths=200, seed=2, resampler="stationary")
        asked = bootstrap_terminal_distribution(_series(180), 5, paths=200, seed=2, mean_block_length=13)
        assert derived.mean_block_length == 13
        assert derived.terminal_pnl == asked.terminal_pnl

    def test_an_unknown_resampler_is_refused_by_name(self) -> None:
        with pytest.raises(ValueError, match="resampler must be one of"):
            bootstrap_terminal_distribution(_series(), 5, paths=200, seed=2, resampler="bootstrap")

    def test_loss_confidences_are_reported_at_the_confidence_asked_for(self) -> None:
        mc = bootstrap_terminal_distribution(
            _series(), 5, paths=400, seed=3, mean_block_length=8, loss_confidences=(90, 95, 99.9),
        )
        assert [band.confidence for band in mc.loss_bands] == [90, 95, 99.9]
        # The band asked for at 95 is the same figure the named field carries —
        # one rule, not two that agree today.
        assert mc.loss_bands[1].loss == mc.var95
        assert mc.loss_bands[1].conditional_loss == mc.cvar95
        # Deeper into the tail is at least as bad, never better.
        assert mc.loss_bands[2].loss >= mc.loss_bands[1].loss >= mc.loss_bands[0].loss

    def test_a_block_longer_than_the_sample_is_still_clamped_not_refused(self) -> None:
        mc = bootstrap_terminal_distribution(
            _series(80), 5, paths=100, seed=3, mean_block_length=5_000, resampler="stationary",
        )
        assert mc.mean_block_length == 80
        assert mc.resampler == "stationary"
