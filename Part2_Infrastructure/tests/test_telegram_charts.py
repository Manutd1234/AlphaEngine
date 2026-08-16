"""Every generator plots what it was handed, or returns None.

The module these came from once shipped a chart that drew a sine wave under
the caption "Real-Time Market Quote". The AST scan in `test_telegram.py`
forbids that shape; these tests hold the other half — that real inputs produce
different pictures, and that thin inputs produce no picture rather than a
confident-looking one.
"""

import pytest

from modules.telegram_charts import (
    generate_bars_chart_png,
    generate_cone_png,
    generate_equity_chart_png,
    generate_gate_ladder_png,
    generate_heatmap_png,
    generate_histogram_png,
    generate_latency_cdf_png,
    generate_multi_series_png,
    generate_paired_bars_png,
    generate_pipeline_png,
    generate_scatter_png,
    generate_series_chart_png,
    generate_status_grid_png,
    generate_var_breach_png,
)

PNG = b"\x89PNG"


class TestCone:
    def _bands(self, n=10):
        p5 = [-2.0 * i for i in range(1, n + 1)]
        p25 = [-1.0 * i for i in range(1, n + 1)]
        p50 = [0.0] * n
        p75 = [1.0 * i for i in range(1, n + 1)]
        p95 = [2.0 * i for i in range(1, n + 1)]
        return p5, p25, p50, p75, p95

    def test_draws_a_fan_of_five_bands(self):
        assert generate_cone_png("MC cone", *self._bands())[:4] == PNG

    def test_refuses_ragged_or_short_bands(self):
        p5, p25, p50, p75, p95 = self._bands()
        # One leg a step shorter than the rest: the fill would join percentiles
        # measured at different horizons.
        assert generate_cone_png("t", p5[:-1], p25, p50, p75, p95) is None
        # A single step is not a horizon to open over.
        assert generate_cone_png("t", [1.0], [1.0], [1.0], [1.0], [1.0]) is None

    def test_refuses_a_non_finite_band(self):
        p5, p25, p50, p75, p95 = self._bands()
        p50 = [float("nan")] + p50[1:]
        assert generate_cone_png("t", p5, p25, p50, p75, p95) is None

    def test_a_wider_cone_is_a_different_picture(self):
        narrow = generate_cone_png("t", *self._bands())
        p5, p25, p50, p75, p95 = self._bands()
        wide = generate_cone_png("t", [v * 3 for v in p5], p25, p50, p75, [v * 3 for v in p95])
        assert narrow != wide


class TestStatusGrid:
    def _rows(self):
        return [
            ("Provider", "OpenBB", "ok", "ready"),
            ("Provider", "Feeds", "degraded", "1/2"),
            ("Platform", "Gateway", "ok", "8000"),
            ("Evidence", "Audit", "down", "—"),
        ]

    def test_draws_tiles_grouped_by_plane(self):
        assert generate_status_grid_png("Planes", self._rows())[:4] == PNG

    def test_refuses_zero_rows(self):
        assert generate_status_grid_png("t", []) is None

    def test_status_changes_the_picture(self):
        healthy = generate_status_grid_png("t", [("A", "x", "ok", ""), ("A", "y", "ok", "")])
        broken = generate_status_grid_png("t", [("A", "x", "ok", ""), ("A", "y", "down", "")])
        assert healthy != broken


class TestHistogram:
    def test_draws_a_distribution_with_its_markers(self):
        values = [float((index * 7) % 23) - 11 for index in range(80)]
        png = generate_histogram_png(
            "Replayed daily P&L", values, "USD",
            [("VaR 95", -8.0, "#e8ab3d"), ("CVaR 95", -10.0, "#f0737c")],
        )
        assert png[:4] == PNG

    def test_refuses_below_the_empirical_floor(self):
        # 20 observations is the same floor `historical_var` applies before it
        # will quote an empirical quantile. Fewer would give shape to noise.
        assert generate_histogram_png("t", [1.0] * 19, "USD") is None
        assert generate_histogram_png("t", [], "USD") is None

    def test_different_distributions_are_different_pictures(self):
        tight = generate_histogram_png("t", [0.0] * 30 + [0.1] * 30, "USD")
        wide = generate_histogram_png("t", [float(i) for i in range(60)], "USD")
        assert tight != wide

    def test_a_missing_marker_is_skipped_rather_than_drawn_at_zero(self):
        values = [float(index % 11) for index in range(40)]
        with_marker = generate_histogram_png("t", values, "USD", [("VaR", 5.0, "#fff")])
        without = generate_histogram_png("t", values, "USD", [("VaR", None, "#fff")])  # type: ignore[list-item]
        assert with_marker != without, "a None marker must not render as a line at 0"


class TestHeatmap:
    def test_draws_a_correlation_grid(self):
        png = generate_heatmap_png(
            "Correlation", ["BTC", "ETH", "SOL"],
            [[1.0, 0.4, 0.2], [0.4, 1.0, 0.7], [0.2, 0.7, 1.0]],
        )
        assert png[:4] == PNG

    def test_refuses_a_single_asset(self):
        # One symbol is a number, not a matrix; a 1x1 grid implies structure.
        assert generate_heatmap_png("t", ["BTC"], [[1.0]]) is None

    def test_correlation_values_change_the_picture(self):
        low = generate_heatmap_png("t", ["A", "B"], [[1.0, 0.1], [0.1, 1.0]])
        high = generate_heatmap_png("t", ["A", "B"], [[1.0, 0.95], [0.95, 1.0]])
        assert low != high


class TestEquityCurve:
    def test_draws_the_persisted_curve(self):
        points = [{"equity": 100_000 + index * 25} for index in range(40)]
        assert generate_equity_chart_png(points, 100_000)[:4] == PNG

    def test_needs_two_points_to_be_a_curve(self):
        assert generate_equity_chart_png([{"equity": 100.0}], 100.0) is None
        assert generate_equity_chart_png([], None) is None

    def test_a_halted_sample_is_marked(self):
        plain = [{"equity": 100.0 + i} for i in range(20)]
        halted = [{"equity": 100.0 + i, "kill_switch": i > 15} for i in range(20)]
        assert generate_equity_chart_png(plain, 100.0) != generate_equity_chart_png(halted, 100.0)

    def test_direction_changes_the_picture(self):
        rising = [{"equity": 100.0 + i} for i in range(20)]
        falling = [{"equity": 120.0 - i} for i in range(20)]
        assert generate_equity_chart_png(rising, 100.0) != generate_equity_chart_png(falling, 120.0)


class TestExistingGeneratorsStillHonourTheirContracts:
    def test_series_chart_follows_its_closes(self):
        up = generate_series_chart_png("BTCUSDT", [100.0, 104.0, 112.0], "1d", "OpenBB")
        down = generate_series_chart_png("BTCUSDT", [112.0, 104.0, 100.0], "1d", "OpenBB")
        assert up[:4] == PNG and down[:4] == PNG and up != down

    def test_bars_chart_returns_none_when_nothing_was_measured(self):
        assert generate_bars_chart_png("t", [], [], "x") is None
        assert generate_bars_chart_png("t", ["A"], [None], "x") is None  # type: ignore[list-item]


class TestPairedBars:
    def test_draws_two_bars_per_label(self):
        png = generate_paired_bars_png(
            "IS vs OOS", ["F1", "F2", "F3"], [1.4, 1.1, 0.9], [1.0, 0.6, 0.3],
            "In-sample", "Out-of-sample", "Sharpe",
        )
        assert png[:4] == PNG

    def test_drops_pairs_with_a_missing_leg_and_refuses_empty(self):
        assert generate_paired_bars_png("t", [], [], [], "a", "b", "y") is None
        # A single pair whose second leg is None leaves nothing drawable.
        assert generate_paired_bars_png("t", ["F1"], [1.0], [None], "a", "b", "y") is None

    def test_different_folds_are_different_pictures(self):
        wide = generate_paired_bars_png("t", ["F1"], [2.0], [0.1], "a", "b", "y")
        narrow = generate_paired_bars_png("t", ["F1"], [1.0], [0.9], "a", "b", "y")
        assert wide != narrow


class TestGateLadder:
    def test_draws_utilisation_bars(self):
        png = generate_gate_ladder_png("Headroom", [
            ("gross_exposure", 100_000.0, 500_000.0, True),
            ("daily_drawdown", 0.02, 0.05, True),
        ])
        assert png[:4] == PNG

    def test_returns_none_when_no_gate_has_numbers(self):
        assert generate_gate_ladder_png("t", []) is None
        assert generate_gate_ladder_png("t", [("kill_switch", None, None, True)]) is None

    def test_utilisation_changes_the_picture(self):
        low = generate_gate_ladder_png("t", [("g", 100.0, 1000.0, True)])
        high = generate_gate_ladder_png("t", [("g", 900.0, 1000.0, True)])
        assert low != high


class TestLatencyCdf:
    def test_draws_a_cdf_above_the_floor(self):
        buckets = [(float(2 ** power), 3) for power in range(10)] + [(float("inf"), 1)]
        png = generate_latency_cdf_png("Latency", buckets, [("p50", 8.0), ("p99", 256.0)])
        assert png[:4] == PNG

    def test_refuses_below_twenty_observations(self):
        assert generate_latency_cdf_png("t", [(1.0, 5), (float("inf"), 2)], []) is None

    def test_a_wider_tail_is_a_different_picture(self):
        tight = [(float(2 ** p), 5) for p in range(6)] + [(float("inf"), 0)]
        wide = [(float(2 ** p), 1) for p in range(6)] + [(float("inf"), 40)]
        assert generate_latency_cdf_png("t", tight, []) != generate_latency_cdf_png("t", wide, [])


class TestScatter:
    def test_draws_grouped_points_with_a_fit_line(self):
        png = generate_scatter_png(
            "Slippage", [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], [2.0, 4.0, 1.0, 3.0, 5.0, 2.0],
            "Notional", "Slippage", groups=["A", "B", "A", "B", "A", "B"], fit_line=True,
        )
        assert png[:4] == PNG

    def test_refuses_below_five_points(self):
        assert generate_scatter_png("t", [1, 2], [1, 2], "x", "y") is None

    def test_different_clouds_are_different_pictures(self):
        one = generate_scatter_png("t", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], "x", "y")
        two = generate_scatter_png("t", [1, 2, 3, 4, 5], [5, 4, 3, 2, 1], "x", "y")
        assert one != two


class TestMultiSeries:
    def test_draws_one_line_per_key(self):
        png = generate_multi_series_png(
            "Spread", {"BINANCE": [10.0, 11.0, 9.0], "BYBIT": [12.0, 10.0, 11.0]}, "bps",
        )
        assert png[:4] == PNG

    def test_refuses_when_no_series_has_two_points(self):
        assert generate_multi_series_png("t", {}, "y") is None
        assert generate_multi_series_png("t", {"A": [1.0]}, "y") is None

    def test_normalise_rebases_and_changes_the_picture(self):
        plain = generate_multi_series_png("t", {"A": [100.0, 200.0]}, "y")
        indexed = generate_multi_series_png("t", {"A": [100.0, 200.0]}, "y", normalise=True)
        assert plain != indexed


class TestVarBreach:
    def test_draws_pnl_against_the_var_line(self):
        pnl = [float((index * 7) % 13 - 6) for index in range(40)]
        var = [5.0] * 40
        breaches = [pnl[index] < -5 for index in range(40)]
        assert generate_var_breach_png("VaR backtest", pnl, var, breaches)[:4] == PNG

    def test_refuses_short_or_ragged_series(self):
        assert generate_var_breach_png("t", [1.0] * 10, [1.0] * 10, [False] * 10) is None
        assert generate_var_breach_png("t", [1.0] * 20, [1.0] * 19, [False] * 20) is None

    def test_breaches_change_the_picture(self):
        pnl = [-6.0] * 20 + [1.0] * 20
        var = [5.0] * 40
        none_breach = generate_var_breach_png("t", pnl, var, [False] * 40)
        some_breach = generate_var_breach_png("t", pnl, var, [True] * 20 + [False] * 20)
        assert none_breach != some_breach


class TestPipeline:
    def test_draws_the_stages(self):
        png = generate_pipeline_png("Signal path", [
            ("OpenBB", "ok", "ready"), ("Feeds", "degraded", "1/2"),
            ("Book", "down", "stale"), ("Audit", "unknown", ""),
        ])
        assert png[:4] == PNG

    def test_refuses_a_single_stage(self):
        assert generate_pipeline_png("t", [("only", "ok", "")]) is None

    def test_status_changes_the_picture(self):
        healthy = generate_pipeline_png("t", [("A", "ok", ""), ("B", "ok", "")])
        broken = generate_pipeline_png("t", [("A", "ok", ""), ("B", "down", "")])
        assert healthy != broken


@pytest.mark.asyncio
class TestCommandsThatAnswerWithPictures:
    async def test_equity_reports_an_empty_record_as_empty(self, bot):
        from tests.test_telegram import update

        await bot.handle_update(update("/equity", update_id=4100))
        assert "NO SNAPSHOTS" in bot.last
        # An empty record must not be dressed as a flat book.
        assert "empty record" in bot.last
        assert bot.albums == [], "nothing to chart, so nothing was sent"

    async def test_var_on_a_flat_book_says_so_without_a_chart(self, bot):
        from tests.test_telegram import update

        await bot.handle_update(update("/var", update_id=4101))
        assert "NOT MEASURABLE" in bot.last
        assert all(not album for album in bot.albums), "no sample, no distribution"
