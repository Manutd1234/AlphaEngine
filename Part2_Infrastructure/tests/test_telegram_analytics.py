"""T2/T3 additions: fold-detail reads, the read-only gate preview, and switchers.

These lean on the shared fixtures in `conftest.py`: `bot` (real engines, one
TEST venue book, empty audit and queue), `completed_backtest` (a succeeded
backtest injected into the queue), and `fake_market_data` (deterministic OpenBB).
"""

from __future__ import annotations

import pytest
from test_telegram import update


@pytest.mark.asyncio
class TestFoldDetailCommands:
    async def test_walkforward_without_a_run_says_not_in_this_process(self, bot):
        await bot.handle_update(update("/walkforward BTCUSDT", update_id=6000))
        assert "not in this process" in bot.last.lower()
        assert all(not album for album in bot.albums), "no result, no chart"

    async def test_walkforward_with_a_run_draws_the_folds(self, bot, completed_backtest):
        await bot.handle_update(update("/walkforward BTCUSDT", update_id=6001))
        assert "IN-PROCESS RESULT" in bot.last
        assert bot.albums and bot.albums[-1], "the fold chart should be sent"

    async def test_walkforward_matches_the_requested_strategy_only(self, bot, completed_backtest):
        # The fixture is ma_cross; a different strategy has no in-process run.
        await bot.handle_update(update("/walkforward BTCUSDT donchian", update_id=6002))
        assert "not in this process" in bot.last.lower()

    async def test_overfit_reports_the_dsr_family(self, bot, completed_backtest):
        await bot.handle_update(update("/overfit BTCUSDT", update_id=6003))
        assert "PBO" in bot.last and "DSR" in bot.last

    async def test_stability_decodes_the_runs_own_heatmap(self, bot, completed_backtest):
        await bot.handle_update(update("/stability BTCUSDT", update_id=6004))
        assert bot.albums and bot.albums[-1], "the recorded heatmap should be sent"

    async def test_decision_renders_promotion_gates(self, bot, completed_backtest):
        await bot.handle_update(update("/decision BTCUSDT", update_id=6005))
        assert "PROMOTE" in bot.last or "HOLD" in bot.last
        assert "/size" in bot.last, "Kelly payoff is delegated to /size"


@pytest.mark.asyncio
class TestGatesPreviewIsInert:
    async def test_gates_reads_state_without_mutating_anything(self, bot):
        from modules import metrics

        gateway = bot.gateway
        before = (
            gateway.orders_accepted,
            gateway.orders_rejected,
            len(bot.audit.recent_orders(500)),
            metrics.decision_latency_summary()["samples"],
            getattr(gateway.bucket, "tokens", None),
        )

        await bot.handle_update(update("/gates BTCUSDT 100000 BUY", update_id=6100))

        after = (
            gateway.orders_accepted,
            gateway.orders_rejected,
            len(bot.audit.recent_orders(500)),
            metrics.decision_latency_summary()["samples"],
            getattr(gateway.bucket, "tokens", None),
        )
        assert before == after, "the preview must not consume a token, count, audit or sample"
        assert "DRY-RUN" in bot.last
        assert "nothing submitted" in bot.last

    async def test_gates_answers_on_the_test_book(self, bot):
        await bot.handle_update(update("/gates BTCUSDT", update_id=6101))
        # The TEST venue book gives a mark, so the notional gates are drawable.
        assert "max_order_notional" in bot.last


@pytest.mark.asyncio
class TestReadOnlyAnalyticsAnswerHonestly:
    async def test_spreadhistory_reports_an_empty_table(self, bot):
        await bot.handle_update(update("/spreadhistory BTCUSDT", update_id=6200))
        assert "NO SNAPSHOTS" in bot.last

    async def test_spreadhistory_reads_recorded_snapshots(self, bot):
        for _ in range(4):
            bot.audit.record_tca_snapshot({
                "symbol": "BTCUSDT", "venue": "BINANCE", "best_bid": 100.0, "best_ask": 100.1,
                "mid": 100.05, "spread_bps": 10.0, "depth_usd_bid": 50_000.0, "depth_usd_ask": 48_000.0,
                "probe_notional": 100_000.0, "buy_slip_bps": 2.0, "sell_slip_bps": 2.5, "synthetic": False,
            })
        await bot.handle_update(update("/spreadhistory BTCUSDT", update_id=6201))
        assert "PERSISTED" in bot.last
        assert bot.albums and bot.albums[-1], "a multi-series line should be drawn"

    async def test_latency_states_it_is_in_process(self, bot):
        await bot.handle_update(update("/latency", update_id=6202))
        assert "in-process" in bot.last.lower()

    async def test_costs_reports_no_fills(self, bot):
        await bot.handle_update(update("/costs", update_id=6203))
        assert "NO FILLS" in bot.last

    async def test_quality_reports_no_fills(self, bot):
        await bot.handle_update(update("/quality", update_id=6204))
        assert "NO FILLS" in bot.last

    async def test_imbalance_reads_the_test_book(self, bot):
        await bot.handle_update(update("/imbalance BTCUSDT", update_id=6205))
        assert "imbalance" in bot.last.lower()

    async def test_lineage_draws_the_signal_path(self, bot, fake_market_data):
        await bot.handle_update(update("/lineage", update_id=6206))
        assert "TOPOLOGY" in bot.last
        assert bot.albums and bot.albums[-1], "the pipeline should be drawn"


@pytest.mark.asyncio
class TestSwitchersAndTabs:
    async def test_portfolio_and_risk_are_tab_commands(self):
        from modules.telegram import COMMAND_SPECS

        tabs = {spec.name for spec in COMMAND_SPECS if spec.category == "Tabs"}
        assert {"portfolio", "risk"} <= tabs
        # Eleven web tabs now have canonical companion entries. Telegram's
        # menu caps at 100, so redundant utility reads move to `/commands`
        # rather than hiding a workspace destination. The saved /coherence
        # spelling is an alias of /proofs, not a twelfth tab.
        assert len(tabs) == 11
        assert all(spec.in_menu for spec in COMMAND_SPECS if spec.category == "Tabs")
        proofs = next(spec for spec in COMMAND_SPECS if spec.name == "proofs")
        assert "coherence" in proofs.aliases

    async def test_bars_now_carries_a_chart_and_switch_rows(self, bot, fake_market_data):
        await bot.handle_update(update("/bars BTCUSDT 1d 5", update_id=6300))
        # A switch keyboard was attached to the answer.
        assert any(keyboard is not None for keyboard in bot.keyboards)

    async def test_strategies_enumerates_the_whole_catalogue(self, bot):
        from typing import get_args

        from modules.schemas import BacktestRequest

        count = len(get_args(BacktestRequest.model_fields["strategy"].annotation))
        await bot.handle_update(update("/strategies", update_id=6301))
        assert f"{count} STRATEGIES" in bot.last

    async def test_strategies_detail_shows_a_grid_size(self, bot):
        await bot.handle_update(update("/strategies ma_cross", update_id=6302))
        assert "Grid" in bot.last and "combinations" in bot.last
