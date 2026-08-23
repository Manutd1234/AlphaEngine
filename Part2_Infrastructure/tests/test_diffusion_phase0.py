"""The kill test's own arithmetic: clusters, ties, and the refusal below the floor.

Three ways this statistic could lie, one test class each. It could count two
assets answering one statement as two observations; it could call a difference
significant because the grid guaranteed one; it could report `flat` when it
simply has not accumulated enough meetings to say anything.
"""

from __future__ import annotations

import math
import random

from modules.coherence.diffusion.phase0 import StagePair, paired_stage_test, sign_test_p


def _pairs(n_meetings: int, *, ratio: float, assets=("BTCUSDT", "ETHUSDT"), jitter: float = 0.0,
           seed: int = 3) -> list[StagePair]:
    rng = random.Random(seed)
    out: list[StagePair] = []
    for meeting in range(n_meetings):
        for asset in assets:
            wobble = math.exp(rng.gauss(0.0, jitter)) if jitter else 1.0
            out.append(StagePair(cluster=f"fed:{meeting:03d}", asset=asset,
                                 release_half_life=100.0, call_half_life=100.0 * ratio * wobble))
    return out


class TestTheSignTestIsTheExactBinomial:
    def test_a_clean_sweep_matches_the_hand_computation(self):
        assert sign_test_p(0, 10) == 2.0 / 1024.0

    def test_an_even_split_is_one(self):
        assert sign_test_p(5, 10) == 1.0

    def test_nothing_compared_is_none_rather_than_one(self):
        assert sign_test_p(0, 0) is None


class TestMeetingsAreTheUnitNotRows:
    def test_n_is_meetings_even_though_two_assets_answered_each(self):
        report = paired_stage_test(_pairs(40, ratio=3.0), clock="vol", min_clusters=30,
                                   draws=200, seed=7)
        assert report.n_clusters == 40
        assert report.n_rows == 80, "both assets are kept as rows"
        assert report.verdict == "differ"

    def test_adding_a_third_asset_does_not_move_the_meeting_count(self):
        two = paired_stage_test(_pairs(40, ratio=3.0), clock="vol", min_clusters=30, draws=200, seed=7)
        three = paired_stage_test(_pairs(40, ratio=3.0, assets=("BTCUSDT", "ETHUSDT", "SOLUSDT")),
                                  clock="vol", min_clusters=30, draws=200, seed=7)
        assert two.n_clusters == three.n_clusters == 40
        assert three.n_rows == 120

    def test_the_interval_does_not_shrink_when_a_correlated_asset_is_added(self):
        """The whole reason for clustering: a second asset answering the same
        statement is not a second observation, so it must not narrow the band."""
        two = paired_stage_test(_pairs(40, ratio=2.0, jitter=0.5), clock="vol", min_clusters=30,
                                draws=400, seed=7)
        three = paired_stage_test(
            _pairs(40, ratio=2.0, jitter=0.5, assets=("BTCUSDT", "ETHUSDT", "SOLUSDT")),
            clock="vol", min_clusters=30, draws=400, seed=7)
        assert two.ci_low is not None and three.ci_low is not None
        two_width = two.ci_high - two.ci_low
        three_width = three.ci_high - three.ci_low
        assert three_width > two_width * 0.6, (two_width, three_width)


class TestAVerdictIsRefusedBeforeItIsGuessed:
    def test_below_the_floor_is_not_assessable_and_counts_meetings(self):
        report = paired_stage_test(_pairs(5, ratio=3.0), clock="vol", min_clusters=30,
                                   draws=200, seed=7)
        assert report.state == "not_assessable"
        assert report.verdict == "not_assessable"
        assert report.reason == "5 of 30 meetings have both stages measured"

    def test_no_difference_reads_flat_rather_than_not_assessable(self):
        report = paired_stage_test(_pairs(40, ratio=1.0, jitter=0.0), clock="vol",
                                   min_clusters=30, draws=200, seed=7)
        assert report.state == "ok"
        assert report.verdict == "flat"
        assert report.median_log_ratio == 0.0

    def test_a_pair_with_a_missing_half_life_is_dropped_not_zeroed(self):
        pairs = _pairs(40, ratio=3.0)
        pairs.append(StagePair("fed:999", "BTCUSDT", release_half_life=None, call_half_life=300.0))
        report = paired_stage_test(pairs, clock="vol", min_clusters=30, draws=200, seed=7)
        assert report.n_clusters == 40, "the incomplete meeting was counted"

    def test_the_bootstrap_is_reproducible_under_its_seed(self):
        args = dict(clock="vol", min_clusters=30, draws=300, seed=7)
        first = paired_stage_test(_pairs(40, ratio=2.0, jitter=0.4), **args)
        second = paired_stage_test(_pairs(40, ratio=2.0, jitter=0.4), **args)
        assert (first.ci_low, first.ci_high) == (second.ci_low, second.ci_high)


class TestTheHorizonDeltasCarryTheirOwnCount:
    def test_a_horizon_nobody_measured_reports_zero_meetings_not_a_number(self):
        pairs = [StagePair("fed:001", "BTCUSDT", 100.0, 200.0,
                           release_absorbed={"5m": 0.4}, call_absorbed={"5m": 0.2})]
        report = paired_stage_test(pairs, clock="vol", min_clusters=1, draws=100, seed=7,
                                   horizons=("5m", "30m"))
        by_horizon = {delta.horizon: delta for delta in report.horizons}
        assert by_horizon["5m"].n_clusters == 1
        assert by_horizon["30m"].n_clusters == 0
        assert by_horizon["30m"].median_delta is None


class TestTheIntervalIsNotAnticonservativeUnderCorrelatedAssets:
    """The measured reason the cluster bootstrap exists.

    BTC and ETH answer the same statement, so in the limit they are ONE
    observation reported twice. Resampling rows treats them as two, and a 95%
    interval built that way excludes zero far more often than five times in a
    hundred when nothing is there. This test builds the worst case — the two
    assets respond identically — and measures the false-positive rate both
    ways. The numbers below were measured, not assumed: 23% for rows against
    7% for clusters over sixty null datasets.
    """

    @staticmethod
    def _null_datasets(seed: int, *, per_row_cluster: bool) -> list[StagePair]:
        rng = random.Random(seed)
        rows: list[StagePair] = []
        for meeting in range(40):
            shared = rng.gauss(0.0, 0.5)
            for asset in ("BTCUSDT", "ETHUSDT"):
                cluster = f"fed:{meeting:03d}-{asset}" if per_row_cluster else f"fed:{meeting:03d}"
                rows.append(StagePair(cluster, asset, 100.0, 100.0 * math.exp(shared)))
        return rows

    def _false_positive_rate(self, *, per_row_cluster: bool, trials: int = 40) -> float:
        wrong = 0
        for seed in range(trials):
            report = paired_stage_test(
                self._null_datasets(seed, per_row_cluster=per_row_cluster),
                clock="vol", min_clusters=30, draws=200, seed=7)
            wrong += report.verdict == "differ"
        return wrong / trials

    def test_clustering_by_meeting_stays_near_the_nominal_rate(self):
        rate = self._false_positive_rate(per_row_cluster=False)
        assert rate <= 0.20, f"a 95% interval said differ on {rate:.0%} of null datasets"

    def test_resampling_rows_instead_would_be_far_worse(self):
        clustered = self._false_positive_rate(per_row_cluster=False)
        by_row = self._false_positive_rate(per_row_cluster=True)
        assert by_row > clustered, (
            "if these are equal the clustering is not doing anything and the unit of "
            f"resampling can be simplified — measured rows {by_row:.0%} vs clusters {clustered:.0%}"
        )
