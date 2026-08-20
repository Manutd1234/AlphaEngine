"""8 Desk Role Tabs — the shared real-telemetry readers, and the first three tabs.

The banner comment below is the one that matters: these read the sources the
rest of the bot already uses, and a card drops its chart rather than inventing
a plausible shape.
"""

from __future__ import annotations

import math
from typing import Any

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.keyboards import _symbol_row, _tab_footer, cb
from modules.telegram_charts import (
    generate_bars_chart_png,
    generate_depth_chart_png,
    generate_drawdown_chart_png,
    generate_series_chart_png,
)


class TabsMixin:
    # ------------------------------------------------------------------ #
    # 8 Desk Role Tabs (Explicit Vercel UI Tab mapping & Visual Charts)
    # ------------------------------------------------------------------ #
    # Shared real-telemetry readers for the desk-role cards. Every one of these
    # cards previously shipped a fixed script — "Sharpe Ratio 2.14", "Uptime
    # 99.99%", "Quota 84% Remaining", "Binance 58% / Bybit 42%" — under a
    # <b>LIVE</b> header, beside a chart drawn from `sin(i * 0.3)`. None of it
    # was measured. The web workspace refuses to substitute a number it did not
    # observe; the companion answering the same questions with invented ones is
    # the same lie in a channel where it is harder to check.
    #
    # These read the sources the rest of the bot already uses. Where a source is
    # unavailable the card says so and drops the chart, rather than falling back
    # to a plausible shape.

    def _subsystem_lines(self) -> tuple[list[str], str]:
        """Trading state, feeds and services — the real ones."""
        feed_health = self.tca.health() if self.tca else {}
        state = self.gateway.state() if self.gateway else None
        feeds = feed_health.get("feeds", [])
        live_feeds = sum(1 for feed in feeds if feed.get("connected"))
        lines: list[str] = []
        if state:
            lines.append(f"Trading state  <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code>")
            lines.append(f"Equity         <code>{_money(state.equity)}</code>")
            lines.append(f"Daily P&amp;L      <code>{_money(state.daily_pnl)}</code>")
        else:
            lines.append("Trading state  <code>gateway unavailable</code>")
        lines.append(f"Market feeds   <code>{live_feeds}/{len(feeds)} connected</code>")
        if feed_health.get("synthetic_active"):
            lines.append("Book source    <code>SYNTHETIC — generated, not a venue</code>")
        uptime = feed_health.get("uptime_s")
        if uptime:
            lines.append(f"Engine uptime  <code>{uptime:.0f}s</code>")
        status = "DEGRADED" if (not state or live_feeds < len(feeds)) else "LIVE"
        return lines, status

    def _latency_rows(self) -> list[tuple[str, float, float, float, int]]:
        """Per-route p50/p95/p99 actually observed by the gateway middleware."""
        from modules import metrics

        rows = []
        for route, stats in metrics.request_latency_summary().items():
            rows.append((route, stats["p50"], stats["p95"], stats["p99"], int(stats["samples"])))
        rows.sort(key=lambda row: row[3], reverse=True)
        return rows[:6]

    async def _closes_for(self, symbol: str, asset: str, interval: str = "1d", count: int = 60) -> list[float]:
        try:
            payload = await self._bars_payload(symbol, interval, count, asset)
        except Exception:
            return []
        if not payload.get("ok"):
            return []
        return [
            value for value in (_finite(row.get("close")) for row in (payload.get("data") or []))
            if value is not None
        ]

    async def _cmd_tab_overview(self, args, chat_id, actor) -> None:
        lines, status = self._subsystem_lines()
        positions: list[dict[str, Any]] = []
        if self.gateway:
            try:
                positions = self._portfolio_report().get("exposure", {}).get("positions", []) or []
            except Exception:
                lines.append("<i>The book could not be read, so there is no exposure chart.</i>")
        charts: list[tuple[str, bytes]] = []

        exposure = generate_bars_chart_png(
            "Gross exposure by symbol (USD)",
            [str(position.get("symbol")) for position in positions[:8]],
            [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
            "Notional (USD)",
            horizontal=True,
            value_fmt="{:,.0f}",
        )
        if exposure:
            charts.append(("exposure", exposure))

        latency = self._latency_rows()
        latency_chart = generate_bars_chart_png(
            "Gateway route latency p99 (ms, observed)",
            [route for route, *_ in latency],
            [p99 for _, _, _, p99, _ in latency],
            "p99 (ms)",
            horizontal=True,
            value_fmt="{:.0f}ms",
        )
        if latency_chart:
            charts.append(("latency", latency_chart))
        else:
            lines.append("<i>No gateway request has been timed yet, so no latency chart.</i>")

        if not positions:
            lines.append("<i>The book holds no position, so there is no exposure chart.</i>")

        text = text_card(
            "🌐 Desk overview",
            status,
            lines,
            source="Gateway + TCA engine + request middleware",
            next_commands="/research · /execution · /portfolio · /risk · /data · /reliability · /developer",
        )
        await self.send_media_group(chat_id, charts, caption=text, reply_markup=_tab_footer(
            "overview",
            [
                ("Portfolio", cb("portfolio")),
                ("Risk", cb("risk")),
                ("Orders", cb("orders")),
                ("Ops", cb("ops")),
            ],
            refresh=cb("overview"),
        ))

    async def _cmd_tab_research(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        asset = self._asset(symbol, args)
        footer = _tab_footer(
            "research",
            [
                ("Backtests", cb("backtests")),
                ("Strategies", cb("strategies")),
                ("Regime", cb("regime", symbol)),
                ("Quote", cb("quote", symbol)),
            ],
            refresh=cb("research", symbol),
            extra_rows=[_symbol_row("research", symbol)],
        )
        closes = await self._closes_for(symbol, asset)
        if len(closes) < 2:
            await self.send_message(chat_id, text_card(
                f"🔬 Research · {esc(symbol)}", "NO BARS",
                ["No daily bars were returned, so nothing can be measured for this symbol."],
                source="OpenBB / yfinance", next_commands="/quote " + symbol,
            ), reply_markup=footer)
            return

        returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
        mean = sum(returns) / len(returns) if returns else 0.0
        variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1) if len(returns) > 1 else 0.0
        vol = math.sqrt(variance) * math.sqrt(365)
        total = closes[-1] / closes[0] - 1 if closes[0] else 0.0
        peak, worst = closes[0], 0.0
        for close in closes:
            peak = max(peak, close)
            worst = min(worst, close / peak - 1 if peak else 0.0)

        lines = [
            f"Window      <code>{len(closes)} daily closes</code>",
            f"Return      <code>{_percent(total, signed=True)}</code>",
            f"Volatility  <code>{_percent(vol)}</code> annualised",
            f"Max drawdown <code>{_percent(worst)}</code>",
            "<i>Descriptive statistics of the price series only — this is not a "
            "backtest and carries no verdict. /backtests lists scored candidates the desk has already run.</i>",
        ]
        charts = [(f"{symbol}-price", generate_series_chart_png(symbol, closes, "1d", "OpenBB / yfinance"))]
        drawdown = generate_drawdown_chart_png(symbol, closes)
        if drawdown:
            charts.append((f"{symbol}-drawdown", drawdown))

        await self.send_media_group(chat_id, charts, caption=text_card(
            f"🔬 Research · {esc(symbol)}", "MEASURED", lines,
            source="OpenBB / yfinance", next_commands=f"/backtests · /quote {symbol}",
        ), reply_markup=footer)

    async def _cmd_tab_execution(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        footer = _tab_footer(
            "execution",
            [
                ("Book", cb("book", symbol)),
                ("TCA", cb("tca", symbol, "100000", "BUY")),
                ("Working", cb("working")),
                ("Orders", cb("orders")),
            ],
            refresh=cb("execution", symbol),
            extra_rows=[_symbol_row("execution", symbol)],
        )
        books = [book for book in self.tca.get_books(symbol, depth=20) if book.mid] if self.tca else []
        if not books:
            await self.send_message(chat_id, text_card(
                f"⚡ Execution · {esc(symbol)}", "NO LIVE BOOK",
                ["No venue currently has a fresh book for this symbol, so there is nothing to route against."],
                source="TCA engine", next_commands="/feedstatus",
            ), reply_markup=footer)
            return

        bids: list[tuple[float, float]] = []
        asks: list[tuple[float, float]] = []
        lines: list[str] = []
        synthetic = False
        for book in books:
            # `get_books` hands back the VenueBook schema, not the raw BookState:
            # the ladders are lists of BookLevel and the depth totals are already
            # computed fields. Reaching for `.items()` and `depth_money()` here is
            # reaching for the internal type.
            synthetic = synthetic or bool(getattr(book, "synthetic", False))
            bids.extend((level.price, level.size) for level in book.bids)
            asks.extend((level.price, level.size) for level in book.asks)
            lines.append(
                f"<code>{esc(book.venue):<9}</code> mid <code>{_number(book.mid)}</code>"
                f" · spread <code>{_number(book.spread_bps, 2)}</code> bps"
                f" · depth <code>{_money(book.depth_usd_bid)}</code> / <code>{_money(book.depth_usd_ask)}</code>"
            )
        if synthetic:
            lines.append("<i>At least one venue is serving a synthetic book — generated, not a venue.</i>")

        chart = generate_depth_chart_png(symbol, bids, asks)
        charts = [(f"{symbol}-depth", chart)] if chart else []
        await self.send_media_group(chat_id, charts, caption=text_card(
            f"⚡ Execution · {esc(symbol)}", "SYNTHETIC BOOK" if synthetic else "LIVE BOOK", lines,
            source="TCA engine", next_commands=f"/book {symbol} · /tca {symbol} 100000 BUY",
        ), reply_markup=footer)
