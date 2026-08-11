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
    generate_equity_chart_png,
    generate_heatmap_png,
    generate_histogram_png,
    generate_series_chart_png,
)

PNG = b"\x89PNG"


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
