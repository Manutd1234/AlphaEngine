"""Were the prices right? The decomposition, and the identity it has to close.

Murphy's three-way split is exact only for a forecaster who quotes a small set
of fixed probabilities. A market quotes a continuum, so grouping into bands
throws away the variation inside each one and the three terms stop adding up.
The residual is reported rather than absorbed, which makes the identity

    reliability − resolution + uncertainty + binning == brier

true to the last place instead of true to a rounding. That is the first thing
tested here, at several bin counts, as Decimals — a decomposition that does not
reconstruct its own total is a chart, not a measurement.

The second is a direction rather than a value. Favourite–longshot bias is the
oldest finding in this literature and the sign is easy to get backwards, so the
corpus below is built with the shape and the fitted line is asserted STEEPER
than the diagonal, not shallower.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence.kernel.calibration import THIN_CORPUS, Forecast, score

SERIES = "KXHIGHNY"

#: Longshots happen less than they are priced, favourites more. The classic
#: shape, in five bands of a hundred settled markets each.
BIASED = [("0.05", 2), ("0.25", 20), ("0.50", 50), ("0.75", 80), ("0.95", 98)]


def corpus(bands: list[tuple[str, int]], size: int = 100, horizon_s: int = 3600,
           series: str = SERIES) -> list[Forecast]:
    """``(price, how many of ``size`` settled YES)`` to a list of forecasts."""
    rows: list[Forecast] = []
    for price, hits in bands:
        for index in range(size):
            rows.append(
                Forecast(
                    ticker=f"{series}-{price}-{index}",
                    series_ticker=series,
                    probability=Decimal(price),
                    outcome=index < hits,
                    horizon_s=horizon_s,
                )
            )
    return rows


class TestTheIdentityCloses:
    """Four terms, one score, no residual left over."""

    @pytest.mark.parametrize("bins", [2, 4, 5, 8, 10, 20, 50])
    def test_the_four_terms_reconstruct_the_brier_score_exactly(self, bins):
        report = score(corpus(BIASED), "tape", bins=bins)
        rebuilt = report.reliability - report.resolution + report.uncertainty + report.binning
        assert rebuilt == report.brier

    def test_the_brier_score_itself_does_not_move_with_the_bin_count(self):
        """It is computed from the individual forecasts. Only the split into
        terms depends on the bands, which is why the residual exists."""
        scores = {score(corpus(BIASED), "tape", bins=bins).brier for bins in (2, 10, 50)}
        assert len(scores) == 1

    def test_finer_bands_leave_a_smaller_residual(self):
        """The binning term is the price of the grouping, so it shrinks as the
        grouping gets finer. If it is ever large next to reliability, the bands
        are too wide to conclude anything from. Signed, so the comparison is of
        size rather than of direction."""
        coarse = score(corpus(BIASED), "tape", bins=2).binning
        fine = score(corpus(BIASED), "tape", bins=50).binning
        assert abs(fine) < abs(coarse)
        assert fine == 0, "five prices in fifty bands leave no variation inside a band"

    def test_uncertainty_is_a_property_of_the_question_rather_than_the_prices(self):
        """``o(1−o)``. Two corpora with the same base rate and wildly different
        skill score the same on this term, which is why a bare Brier score is
        not comparable across corpora."""
        base_rate_half = score(corpus(BIASED), "tape").uncertainty
        coin_flips = score(corpus([("0.50", 500)], size=1000), "tape").uncertainty
        assert base_rate_half == coin_flips == Decimal("0.25")

    def test_skill_measures_what_the_prices_removed_from_that(self):
        report = score(corpus(BIASED), "tape")
        assert report.skill == (report.uncertainty - report.brier) / report.uncertainty
        assert report.skill > 0, "these prices are worth more than knowing the base rate"


class TestTheFavouriteLongshotShape:
    @pytest.fixture
    def report(self):
        return score(corpus(BIASED), "tape")

    def test_the_fitted_line_is_steeper_than_the_diagonal(self, report):
        """Pulled down at the left and up at the right. A slope BELOW one would
        be the opposite finding and the easy sign error to ship."""
        assert report.bias_slope is not None
        assert report.bias_slope > 1

    def test_the_cheap_band_happened_less_often_than_it_was_priced(self, report):
        cheapest = next(band for band in report.bins if band.count and band.low == 0)
        assert cheapest.deviation is not None and cheapest.deviation < 0

    def test_the_dear_band_happened_more_often_than_it_was_priced(self, report):
        dearest = [band for band in report.bins if band.count][-1]
        assert dearest.deviation is not None and dearest.deviation > 0

    def test_the_reverse_corpus_fits_a_shallower_line(self):
        """Built the other way round, so the assertion above is about this
        corpus's shape rather than about anything the fit does by default."""
        report = score(corpus([("0.05", 10), ("0.50", 50), ("0.95", 90)]), "tape")
        assert report.bias_slope is not None and report.bias_slope < 1

    def test_two_bands_are_not_a_line_and_are_refused_rather_than_fitted(self):
        """Any two points lie on some line. Reporting its slope as a finding
        would put a number where there is no evidence."""
        assert score(corpus(BIASED), "tape", bins=2).bias_slope is None


class TestTheRecalibrationMapIsMonotone:
    """PAV, always: a higher price must never map to a lower probability."""

    def test_a_well_behaved_corpus_passes_through_unpooled(self):
        report = score(corpus(BIASED), "tape")
        assert [point.calibrated for point in report.isotonic_map] == [
            Decimal("0.02"), Decimal("0.2"), Decimal("0.5"), Decimal("0.8"), Decimal("0.98")
        ]

    def test_an_inverted_pair_is_pooled_into_its_weighted_mean(self):
        """0.60 then 0.30 cannot both stand. They become 0.45 across both bands,
        carrying the weight of the two together."""
        report = score(corpus([("0.15", 10), ("0.35", 60), ("0.45", 30), ("0.85", 90)]), "tape")
        pooled = [(point.quoted, point.calibrated, point.weight) for point in report.isotonic_map]
        assert pooled[1] == (Decimal("0.35"), Decimal("0.45"), 200)
        assert len(pooled) == 3, "the two violating bands merged into one block"

    @pytest.mark.parametrize(
        "bands",
        [
            BIASED,
            [("0.15", 10), ("0.35", 60), ("0.45", 30), ("0.85", 90)],
            [("0.05", 90), ("0.25", 70), ("0.55", 40), ("0.75", 20), ("0.95", 5)],
            [("0.10", 50), ("0.30", 50), ("0.50", 50), ("0.70", 50), ("0.90", 50)],
        ],
    )
    def test_the_map_never_steps_downwards(self, bands):
        """If it could, the corrected prices would themselves be incoherent and
        this engine would ship the fault it exists to find."""
        values = [point.calibrated for point in score(corpus(bands), "tape").isotonic_map]
        assert values == sorted(values)


class TestSayingWhatTheCorpusIs:
    def test_a_final_trade_corpus_says_it_scores_convergence_not_foresight(self):
        report = score(corpus(BIASED, horizon_s=0), "final_trade")
        assert report.engine == "final_trade"
        assert "quoted moments before settlement" in report.detail
        assert "not its foresight" in report.detail

    def test_a_zero_median_horizon_says_the_price_was_read_at_settlement(self):
        report = score(corpus(BIASED, horizon_s=0), "final_trade")
        assert report.median_horizon_s == 0
        assert "the score is not a forecast test" in report.detail

    def test_a_tape_corpus_read_an_hour_early_carries_neither_warning(self):
        report = score(corpus(BIASED), "tape")
        assert report.median_horizon_s == 3600
        assert "not a forecast test" not in report.detail
        assert "convergence" not in report.detail

    def test_a_corpus_that_settled_one_way_cannot_separate_skill_from_the_base_rate(self):
        report = score(corpus([("0.90", 100)]), "tape")
        assert "every market in this corpus settled the same way" in report.detail

    def test_the_composition_is_reported_biggest_series_first(self):
        rows = corpus([("0.50", 50)], size=100) + corpus([("0.50", 10)], size=20, series="KXBTCD")
        report = score(rows, "tape")
        assert report.composition == ((SERIES, 100), ("KXBTCD", 20))
        assert f"over half the corpus is one series, {SERIES}" in report.detail

    def test_a_handful_of_markets_is_flagged_thin(self):
        assert score(corpus([("0.50", 5)], size=10), "tape").thin is True
        assert score(corpus([("0.50", 30)], size=THIN_CORPUS), "tape").thin is False

    def test_an_empty_corpus_is_unavailable_rather_than_a_perfect_score(self):
        report = score([], "tape")
        assert report.engine == "unavailable"
        assert report.brier is None and report.count == 0
        assert "no settled market" in report.detail


class TestAnEmptyBandIsNotAnEmptyOutcome:
    @pytest.fixture
    def report(self):
        """Five quoted bands out of ten, so half the chart has nothing in it."""
        return score(corpus(BIASED), "tape")

    def test_every_band_is_present_so_the_chart_leaves_a_gap(self, report):
        assert len(report.bins) == 10

    def test_an_unquoted_band_reports_no_forecast_rather_than_zero(self, report):
        empty = [band for band in report.bins if band.count == 0]
        assert empty, "this corpus quotes only five of the ten bands"
        assert all(band.mean_forecast is None for band in empty)
        assert all(band.outcome_rate is None for band in empty)

    def test_and_no_deviation_either(self, report):
        """A deviation of zero would read as a perfectly calibrated band that
        nobody quoted — the most flattering possible lie on this chart."""
        assert all(band.deviation is None for band in report.bins if band.count == 0)

    def test_an_empty_band_contributes_nothing_to_the_decomposition(self, report):
        """Which is what makes the identity above hold with gaps in the chart."""
        rebuilt = report.reliability - report.resolution + report.uncertainty + report.binning
        assert rebuilt == report.brier

    def test_the_band_labels_still_tile_the_price_axis(self, report):
        assert report.bins[0].low == 0
        assert report.bins[-1].high == 1
        assert all(left.high == right.low for left, right in zip(report.bins, report.bins[1:], strict=False))


class TestOneSlopeOverAMixedCorpusHidesTwo:
    """§9.3 asks for the bias by category, and this is why it asks.

    A favourite–longshot slope is a statement about how a set of markets is
    priced. Averaging a fifteen-minute crypto strike with a daily temperature
    bucket produces a number that describes neither: they are priced by
    different people against different information, and their biases can point
    opposite ways and cancel.
    """

    @staticmethod
    def _corpus(series: str, exponent: float, seed: int) -> list[Forecast]:
        import random

        rng = random.Random(seed)
        rows: list[Forecast] = []
        for index in range(400):
            price = Decimal(rng.randint(5, 95)) / 100
            rows.append(
                Forecast(
                    ticker=f"{series}-{index}",
                    series_ticker=series,
                    probability=price,
                    outcome=rng.random() < float(price) ** exponent,
                    horizon_s=3600,
                )
            )
        return rows

    def test_two_series_pulling_opposite_ways_are_reported_separately(self):
        steep = self._corpus("KXSTEEP", 1.4, seed=3)
        flat = self._corpus("KXFLAT", 0.7, seed=4)
        report = score(steep + flat, engine="tape")

        by_series = dict(report.bias_by_series)
        assert set(by_series) == {"KXSTEEP", "KXFLAT"}
        # The classic favourite–longshot shape is a slope above one; the other
        # corpus is built to sit below it. The aggregate lands between them.
        assert by_series["KXSTEEP"] > Decimal(1)
        assert by_series["KXFLAT"] < Decimal(1)
        assert report.bias_slope is not None
        assert by_series["KXFLAT"] < report.bias_slope < by_series["KXSTEEP"]

    def test_a_series_too_thin_for_a_line_is_absent_rather_than_defaulted(self):
        """Three populated price bands or no slope. Not the corpus figure."""
        thin = [
            Forecast("T1", "KXTHIN", Decimal("0.50"), True, 3600),
            Forecast("T2", "KXTHIN", Decimal("0.50"), False, 3600),
        ]
        report = score(self._corpus("KXWIDE", 1.4, seed=5) + thin, engine="tape")
        assert "KXTHIN" not in dict(report.bias_by_series)
        assert "KXWIDE" in dict(report.bias_by_series)
