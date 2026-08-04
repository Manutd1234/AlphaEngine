"""Portfolio view — the portfolio-manager surface.

A list of positions is not a portfolio view. These tests pin the three things a
PM needs that a trader's view does not provide: concentration, headroom against
every limit, and which limit binds first.
"""

from __future__ import annotations

import pytest
from conftest import deep_book, stub_feed

from config import settings
from modules.audit import AuditLog
from modules.portfolio import (
    build_equity_history,
    build_portfolio,
    format_for_telegram,
    realized_pnl_by_strategy,
)
from modules.risk_proxy import RiskGateway, TokenBucket
from modules.schemas import OrderRequest
from modules.tca_engine import TCAEngine


@pytest.fixture
def gateway(tmp_path):
    tca = TCAEngine(symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT"], venues=[])
    tca.feeds = {
        "TEST": stub_feed("TEST", deep_book("BTCUSDT", mid=100.0)),
        "T2": stub_feed("T2", deep_book("ETHUSDT", mid=50.0)),
        "T3": stub_feed("T3", deep_book("SOLUSDT", mid=10.0)),
    }
    # stub_feed holds one symbol each; merge them so every symbol resolves.
    merged = {}
    for feed in tca.feeds.values():
        merged.update(feed.books)
    for feed in tca.feeds.values():
        feed.books = merged

    gw = RiskGateway(tca_engine=tca, audit=AuditLog(tmp_path / "p.duckdb"))
    gw.bucket = TokenBucket(1e6, 1_000_000)
    return gw


async def fill(gw, symbol: str, notional: float, side: str = "BUY", strategy: str = "manual"):
    d = await gw.submit(OrderRequest(symbol=symbol, side=side, notional=notional,
                                     order_type="MARKET", strategy=strategy,
                                     client_order_id=f"{symbol}-{notional}-{side}-{strategy}"))
    assert d.accepted, d.reason
    return d


@pytest.mark.asyncio
class TestPortfolioView:
    async def test_flat_book_is_reported_as_flat(self, gateway):
        p = build_portfolio(gateway, gateway.audit)
        assert p["exposure"]["positions"] == []
        assert p["exposure"]["gross"] == 0
        assert p["concentration"]["positions"] == 0
        assert "flat" in format_for_telegram(p).lower()

    async def test_exposure_shares_sum_to_one(self, gateway):
        await fill(gateway, "BTCUSDT", 30_000)
        await fill(gateway, "ETHUSDT", 20_000)
        p = build_portfolio(gateway, gateway.audit)
        shares = [pos["share_of_gross"] for pos in p["exposure"]["positions"]]
        assert sum(shares) == pytest.approx(1.0, abs=1e-3)
        # Largest first — a PM reads the top of the list, so it must be the big one.
        assert shares == sorted(shares, reverse=True)

    async def test_concentration_distinguishes_one_big_bet_from_a_spread_book(self, gateway):
        await fill(gateway, "BTCUSDT", 40_000)
        one_bet = build_portfolio(gateway, gateway.audit)["concentration"]
        assert one_bet["hhi"] == pytest.approx(1.0, abs=1e-3)
        assert one_bet["effective_positions"] == pytest.approx(1.0, abs=0.05)

        await fill(gateway, "ETHUSDT", 40_000)
        await fill(gateway, "SOLUSDT", 40_000)
        spread = build_portfolio(gateway, gateway.audit)["concentration"]
        assert spread["hhi"] < one_bet["hhi"], "HHI must fall as the book spreads"
        assert spread["effective_positions"] > 2.5
        assert spread["largest_share"] < one_bet["largest_share"]

    async def test_net_and_gross_differ_on_a_hedged_book(self, gateway):
        await fill(gateway, "BTCUSDT", 30_000, side="BUY")
        await fill(gateway, "ETHUSDT", 30_000, side="SELL")
        ex = build_portfolio(gateway, gateway.audit)["exposure"]
        assert ex["gross"] > 55_000, "gross counts both legs"
        assert abs(ex["net"]) < 5_000, "net nets them off"

    async def test_headroom_counts_down_from_every_limit(self, gateway):
        await fill(gateway, "BTCUSDT", 40_000)
        rb = build_portfolio(gateway, gateway.audit)["risk_budget"]
        g = rb["gross_exposure"]
        assert g["used"] + g["remaining"] == pytest.approx(g["limit"], abs=1)
        assert 0 < g["utilisation"] < 1
        dd = rb["daily_drawdown"]
        assert dd["equity_at_halt"] < gateway.start_of_day_equity
        assert dd["cushion_usd"] > 0

    async def test_binding_constraint_names_the_limit_that_stops_trading_first(self, gateway):
        # One symbol taken close to its per-symbol cap: that cap must bind before
        # the far-larger gross-exposure cap.
        for i in range(3):
            await fill(gateway, "BTCUSDT", settings.max_order_notional_usd, strategy=f"s{i}")
        rb = build_portfolio(gateway, gateway.audit)["risk_budget"]
        name, utilisation = rb["binding_constraint"]
        assert name == "symbol:BTCUSDT", f"expected the per-symbol cap to bind, got {name}"
        assert utilisation > rb["gross_exposure"]["utilisation"]

    async def test_attribution_splits_flow_by_strategy(self, gateway):
        await fill(gateway, "BTCUSDT", 20_000, strategy="momentum")
        await fill(gateway, "ETHUSDT", 10_000, strategy="mean-reversion")
        strat = {s["strategy"]: s for s in
                 build_portfolio(gateway, gateway.audit)["attribution"]["by_strategy"]}
        assert {"momentum", "mean-reversion"} <= set(strat)
        assert strat["momentum"]["notional"] > strat["mean-reversion"]["notional"]
        assert strat["momentum"]["filled"] == 1

    async def test_rejected_orders_show_up_in_symbol_attribution(self, gateway):
        await fill(gateway, "BTCUSDT", 20_000)
        # Blow the fat-finger cap so it is rejected, not filled.
        await gateway.submit(OrderRequest(symbol="BTCUSDT", side="BUY",
                                          notional=settings.max_order_notional_usd * 20,
                                          order_type="MARKET"))
        by_symbol = {s["symbol"]: s for s in
                     build_portfolio(gateway, gateway.audit)["attribution"]["by_symbol"]}
        assert by_symbol["BTCUSDT"]["rejected"] >= 1
        assert by_symbol["BTCUSDT"]["filled"] >= 1

    async def test_halt_is_surfaced_at_the_top(self, gateway):
        await fill(gateway, "BTCUSDT", 10_000)
        await gateway.trigger_kill("test", "pytest")
        p = build_portfolio(gateway, gateway.audit)
        assert p["trading_halted"] is True
        assert "HALTED" in format_for_telegram(p)

    async def test_telegram_summary_stays_inside_the_message_limit(self, gateway):
        for sym, n in [("BTCUSDT", 40_000), ("ETHUSDT", 30_000), ("SOLUSDT", 20_000)]:
            await fill(gateway, sym, n, strategy=f"strat-{sym}")
        text = format_for_telegram(build_portfolio(gateway, gateway.audit))
        assert len(text) < 4000, "would be truncated by Telegram"
        for token in ["Portfolio", "Equity", "Gross expo", "Risk budget", "Binding limit"]:
            assert token in text


@pytest.mark.asyncio
class TestSleeveAttribution:
    """Flow tells you a sleeve traded; P&L tells you whether it should have."""

    async def test_a_round_trip_is_scored_against_its_own_strategy(self, gateway):
        await fill(gateway, "BTCUSDT", 20_000, side="BUY", strategy="momentum")
        await fill(gateway, "BTCUSDT", 20_000, side="SELL", strategy="momentum")

        sleeve = realized_pnl_by_strategy(gateway.audit)["momentum"]
        assert sleeve["fills"] == 2
        assert sleeve["closes"] == 1, "the closing fill is the only scored event"
        # Both legs cross the same synthetic ladder, so the round trip loses
        # exactly the fees and the spread it paid.
        assert sleeve["realized_pnl"] < 0
        assert sleeve["fees"] > 0
        assert sleeve["win_rate"] == 0.0

    async def test_open_inventory_is_flagged_rather_than_scored(self, gateway):
        await fill(gateway, "ETHUSDT", 15_000, strategy="carry")
        sleeve = realized_pnl_by_strategy(gateway.audit)["carry"]
        assert sleeve["has_open_inventory"] is True
        assert sleeve["closes"] == 0
        assert sleeve["win_rate"] is None, "a sleeve with no closed trade has no win rate"

    async def test_sleeves_do_not_bleed_into_each_other(self, gateway):
        await fill(gateway, "BTCUSDT", 20_000, side="BUY", strategy="alpha")
        await fill(gateway, "BTCUSDT", 20_000, side="BUY", strategy="beta")
        # Only alpha closes; beta must keep its inventory and its zero P&L.
        await fill(gateway, "BTCUSDT", 20_000, side="SELL", strategy="alpha")

        sleeves = realized_pnl_by_strategy(gateway.audit)
        assert sleeves["alpha"]["closes"] == 1
        assert sleeves["beta"]["closes"] == 0
        assert sleeves["beta"]["realized_pnl"] == pytest.approx(-sleeves["beta"]["fees"], abs=0.01)

    async def test_attribution_table_carries_pnl_next_to_flow(self, gateway):
        await fill(gateway, "BTCUSDT", 20_000, side="BUY", strategy="momentum")
        await fill(gateway, "BTCUSDT", 20_000, side="SELL", strategy="momentum")

        row = next(s for s in build_portfolio(gateway, gateway.audit)["attribution"]["by_strategy"]
                   if s["strategy"] == "momentum")
        assert row["notional"] > 0, "flow is still reported"
        assert row["realized_pnl"] is not None, "and now so is the result of it"
        assert row["closed_trades"] == 1

    async def test_execution_quality_splits_by_venue_and_strategy(self, gateway):
        await fill(gateway, "BTCUSDT", 20_000, strategy="momentum")
        await fill(gateway, "ETHUSDT", 10_000, strategy="carry")

        by_strategy = {r["bucket"]: r for r in gateway.audit.execution_quality_by("strategy")}
        assert {"momentum", "carry"} <= set(by_strategy)
        assert by_strategy["momentum"]["notional"] > by_strategy["carry"]["notional"]
        assert by_strategy["momentum"]["avg_latency_ms"] is not None

        by_venue = gateway.audit.execution_quality_by("venue")
        assert by_venue and all(r["filled"] >= 1 for r in by_venue)

        with pytest.raises(ValueError):
            gateway.audit.execution_quality_by("symbol; DROP TABLE orders")

    async def test_tail_latency_is_reported_not_just_the_mean(self, gateway):
        await fill(gateway, "BTCUSDT", 10_000)
        stats = gateway.audit.execution_stats()
        assert stats["avg_latency_ms"] is not None
        # DuckDB is the default backend; the percentile block is skipped on the
        # SQLite fallback, which has no quantile function.
        if gateway.audit.backend == "duckdb":
            assert stats["p99_latency_ms"] >= stats["p50_latency_ms"]


@pytest.mark.asyncio
class TestEquityHistory:
    """Persisted equity: the difference between a chart and a record.

    Before this, the curve lived only in whichever browser tab happened to be
    open, so "what did the book do while the drawdown built" had no answer.
    """

    async def test_empty_history_is_empty_not_an_error(self, gateway):
        history = build_equity_history(gateway.audit)
        assert history["points"] == []
        assert history["periods"] == {}
        assert history["sample_count"] == 0

    async def test_snapshots_persist_and_track_the_book(self, gateway):
        gateway.snapshot_equity()
        await fill(gateway, "BTCUSDT", 30_000)
        gateway.snapshot_equity()

        history = build_equity_history(gateway.audit)
        assert history["sample_count"] == 2
        assert history["points"][0]["open_positions"] == 0
        assert history["points"][1]["open_positions"] == 1
        assert history["points"][1]["gross_exposure"] == pytest.approx(30_000, rel=0.05)

    async def test_period_returns_are_derived_from_the_stored_curve(self, gateway):
        gateway.snapshot_equity()
        # Fees make this a small, certain loss — enough to prove the period
        # figures come from the curve rather than being hard-coded to zero.
        await fill(gateway, "BTCUSDT", 30_000)
        gateway.snapshot_equity()

        periods = build_equity_history(gateway.audit)["periods"]
        assert periods["current_equity"] == pytest.approx(gateway.equity(), abs=1)
        assert periods["day"]["pnl"] < 0, "paper fees are a real cost"
        assert periods["day"]["opening_equity"] == pytest.approx(settings.starting_equity_usd, abs=1)
        assert periods["since_first_snapshot"]["pnl"] == pytest.approx(periods["day"]["pnl"], abs=0.01)
        assert periods["month_to_date"]["return"] is not None

    async def test_history_survives_a_halt(self, gateway):
        await fill(gateway, "BTCUSDT", 10_000)
        await gateway.trigger_kill("test", "pytest")
        gateway.snapshot_equity()

        latest = build_equity_history(gateway.audit)["points"][-1]
        assert latest["kill_switch"] is True, "the curve must keep recording after a halt"

    async def test_session_filter_selects_one_day(self, gateway):
        gateway.snapshot_equity()
        assert build_equity_history(gateway.audit, session_date=gateway.session_date)["sample_count"] == 1
        assert build_equity_history(gateway.audit, session_date="1999-01-01")["sample_count"] == 0
