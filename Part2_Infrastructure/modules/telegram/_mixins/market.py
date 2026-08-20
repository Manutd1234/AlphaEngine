"""OpenBB / market data — quotes, bars, trend, range, volume, news, fundamentals."""

from __future__ import annotations

import asyncio
from typing import Any

from config import settings
from modules.telegram.format import _finite, _median, _money, _number, _percent, _stdev, esc, text_card
from modules.telegram.keyboards import _interval_row, _symbol_row, kb
from modules.telegram_charts import generate_series_chart_png


class MarketMixin:
    # ------------------------------------------------------------------ #
    # OpenBB / market data
    # ------------------------------------------------------------------ #
    async def _cmd_openbb(self, args, chat_id, actor) -> None:
        from modules import research

        status = await research.openbb_status_async()
        lines = [
            f"Provider <code>{esc(status.get('provider') or '—')}</code>",
            f"Quote     <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"Bars      <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"News      <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"Fundamentals <code>{'available' if status.get('ok') else 'unavailable'}</code>",
        ]
        if status.get("detail"):
            lines.append(f"Detail <code>{esc(str(status['detail'])[:240])}</code>")
        await self.send_message(chat_id, text_card("🔌 OpenBB", "READY" if status.get("ok") else "UNAVAILABLE", lines, source="OpenBB provider extension", next_commands="/quote AAPL · /snapshot AAPL · /status"))

    async def _quote_payload(self, symbol: str, asset: str) -> dict[str, Any]:
        from modules import research

        return await research.quote(symbol, asset)

    async def _quote_line(self, symbol: str, asset: str) -> tuple[str | None, dict[str, Any]]:
        """One symbol's quote row for a multi-symbol card, plus its raw payload."""
        payload = await self._quote_payload(symbol, asset)
        if not payload.get("ok"):
            return None, payload
        data = payload["data"]
        row = (
            f"<code>{esc(symbol):<10}</code> "
            f"<code>{_number(data.get('price'))}</code> "
            f"· <code>{_number(data.get('change_percent'), signed=True)}%</code> "
            f"· H <code>{_number(data.get('high'))}</code> "
            f"· L <code>{_number(data.get('low'))}</code>"
        )
        return row, payload

    async def _symbol_chart(self, symbol: str, asset: str) -> bytes | None:
        """A close-series chart for one symbol, or nothing if the bars are not there."""
        try:
            payload = await self._bars_payload(symbol, "1d", 30, asset)
        except Exception:
            return None
        if not payload.get("ok"):
            return None
        closes = [
            value for value in (_finite(row.get("close")) for row in (payload.get("data") or []))
            if value is not None
        ]
        if len(closes) < 2:
            return None
        return generate_series_chart_png(symbol, closes, "1d", "OpenBB / yfinance")

    async def _cmd_quote(self, args, chat_id, actor) -> None:
        """
        Quote one symbol or several.

        "/quote BTCUSDT ETHUSDT SOLUSDT" now answers about all three in one
        message: a row per symbol in the card, and a chart per symbol in a
        single album, rather than one symbol's picture standing in for a watch
        list. A symbol whose bars are unavailable keeps its quote row and simply
        contributes no chart — a missing series is not worth suppressing the
        numbers over.
        """
        symbols = self._symbols(args)
        asset_index = len(symbols) if len(symbols) > 1 else 1
        rows: list[str] = []
        charts: list[tuple[str, bytes]] = []
        failures: list[str] = []
        delayed = False

        for symbol in symbols:
            asset = self._asset(symbol, args, index=asset_index)
            row, payload = await self._quote_line(symbol, asset)
            if row is None:
                failures.append(symbol)
                if len(symbols) == 1:
                    await self.send_message(chat_id, self._openbb_error("quote", payload))
                    return
                continue
            rows.append(row)
            delayed = delayed or bool(payload["data"].get("delayed"))
            chart = await self._symbol_chart(symbol, asset)
            if chart:
                charts.append((symbol, chart))

        if not rows:
            await self.send_message(chat_id, self._openbb_error("quote", {"error": "no symbol returned a quote"}))
            return

        if failures:
            rows.append(f"<i>No quote for {esc(', '.join(failures))}</i>")
        if len(charts) < len(rows) - (1 if failures else 0):
            rows.append("<i>Symbols without a chart had fewer than two daily bars.</i>")

        title = f"💹 {symbols[0]} quote" if len(symbols) == 1 else f"💹 {len(rows) - (1 if failures else 0)} quotes"
        card = text_card(
            title,
            "DELAYED" if delayed else "LIVE",
            rows,
            source="OpenBB / yfinance",
            next_commands=f"/bars {symbols[0]} 1d 5 · /snapshot {symbols[0]}",
        )
        await self.send_media_group(chat_id, charts, caption=card, reply_markup=kb([_symbol_row("quote", symbols[0])]))

    async def _bars_payload(self, symbol: str, interval: str, count: int, asset: str) -> dict[str, Any]:
        from modules import research

        return await research.bars(symbol, asset, interval, count)

    def _bars_switcher(self, symbol: str, interval: str, count: int) -> dict[str, Any]:
        """Interval and symbol switch rows for the OHLCV chart commands."""
        return kb([
            _interval_row("bars", symbol, interval, str(count)),
            _symbol_row("bars", symbol, interval, str(count)),
        ])

    async def _cmd_bars(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        keyboard = self._bars_switcher(symbol, interval, count)
        payload = await self._bars_payload(symbol, interval, count, asset)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("bars", payload), reply_markup=keyboard)
            return
        rows = payload.get("data") or []
        if not rows:
            await self.send_message(chat_id, self._openbb_error("bars", {"error": "no bars returned"}), reply_markup=keyboard)
            return
        lines = []
        for row in rows[-min(count, 10):]:
            date_label = str(row.get("date") or "")[:16]
            lines.append(f"<code>{esc(date_label):<16}</code> O {_number(row.get('open'))} · H {_number(row.get('high'))} · L {_number(row.get('low'))} · C {_number(row.get('close'))}")
        # This command used to answer entirely in text; it now draws the close
        # series it already fetched, from those closes and nothing else.
        closes = [value for row in rows if (value := _finite(row.get("close"))) is not None]
        chart = generate_series_chart_png(symbol, closes, interval, "OpenBB / yfinance") if len(closes) >= 2 else None
        card = text_card(f"🕯 {symbol} · {interval}", f"{len(rows)} DELAYED BARS", lines, source="OpenBB / yfinance", next_commands=f"/trend {symbol} {interval} {count} · /range {symbol} {interval} {count}")
        await self.send_media_group(chat_id, [("bars", chart)] if chart else [], caption=card, reply_markup=keyboard)

    async def _cmd_trend(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        count = max(2, count)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        if len(rows) < 2:
            await self.send_message(chat_id, self._openbb_error("trend", payload if not payload.get("ok") else {"error": "at least two bars are required"}))
            return
        first = _finite(rows[0].get("close"))
        last = _finite(rows[-1].get("close"))
        change = (last / first - 1) if first and last is not None else None
        direction = "UP" if change is not None and change > 0 else "DOWN" if change is not None and change < 0 else "FLAT"
        closes = [value for row in rows if (value := _finite(row.get("close"))) is not None]
        # Per-bar returns, so the headline move can be read against the noise
        # it happened in rather than in isolation.
        steps = [
            closes[index] / closes[index - 1] - 1
            for index in range(1, len(closes))
            if closes[index - 1]
        ]
        sigma = _stdev(steps) if len(steps) > 1 else None
        drift = (sum(steps) / len(steps)) if steps else None
        lines = [
            f"First close <code>{_number(first)}</code>",
            f"Last close  <code>{_number(last)}</code>",
            f"Return      <code>{_percent(change, signed=True)}</code>",
            f"Direction   <code>{direction}</code>",
            f"Per-bar σ   <code>{_percent(sigma)}</code> · mean <code>{_percent(drift, signed=True)}</code>",
        ]
        if sigma and change is not None:
            # How many bar-sized moves the whole period amounts to. Under one,
            # the move is inside the instrument's ordinary noise.
            ratio = abs(change) / (sigma * max(1, len(steps)) ** 0.5)
            flag = "🟢" if ratio >= 2 else "🟡" if ratio >= 1 else "⚪"
            lines.append(
                f"Signal      {flag} <code>{_number(ratio)}σ</code> of the period's own noise"
            )
            lines.append(
                "<i>Under 1σ the move is ordinary variation for this instrument "
                "over this many bars — a direction, not yet evidence.</i>"
            )
        keyboard = kb([
            _interval_row("trend", symbol, interval, str(count)),
            _symbol_row("trend", symbol, interval, str(count)),
        ])
        chart = generate_series_chart_png(symbol, closes, interval, "OpenBB / yfinance") if len(closes) >= 2 else None
        card = text_card(f"📈 {symbol} trend · {interval}", f"{len(rows)} DELAYED BARS", lines, source="OpenBB / yfinance", next_commands=f"/range {symbol} {interval} {count} · /volume {symbol} {interval} {count}")
        await self.send_media_group(chat_id, [("trend", chart)] if chart else [], caption=card, reply_markup=keyboard)

    async def _cmd_range(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        highs = [value for row in rows if (value := _finite(row.get("high"))) is not None]
        lows = [value for row in rows if (value := _finite(row.get("low"))) is not None]
        if not highs or not lows:
            await self.send_message(chat_id, self._openbb_error("range", payload if not payload.get("ok") else {"error": "no valid high/low values"}))
            return
        high, low = max(highs), min(lows)
        width = (high / low - 1) if low else None
        # Each bar's own high-low span, so today's range can be read against
        # what this instrument's ranges usually look like.
        spans = [
            (h / low_value - 1)
            for row in rows
            if (h := _finite(row.get("high"))) is not None
            and (low_value := _finite(row.get("low")))
        ]
        typical = _median(spans) if spans else None
        widest = max(spans) if spans else None
        lines = [
            f"High        <code>{_number(high)}</code>",
            f"Low         <code>{_number(low)}</code>",
            f"Range width <code>{_percent(width)}</code> across the window",
            f"Typical bar <code>{_percent(typical)}</code> · widest <code>{_percent(widest)}</code>",
            f"Observations <code>{len(rows)}</code>",
        ]
        if typical and spans:
            latest = spans[-1]
            flag = "🔴" if latest >= typical * 2 else "🟡" if latest >= typical * 1.5 else "🟢"
            lines.append(
                f"Latest bar  {flag} <code>{_percent(latest)}</code> · "
                f"<code>{_number(latest / typical)}x</code> the median span"
            )
            lines.append(
                "<i>A bar much wider than the median is where slippage estimates "
                "built on calm conditions stop holding.</i>"
            )
        await self.send_message(chat_id, text_card(f"↕️ {symbol} range · {interval}", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/bars {symbol} {interval} 5"))

    async def _cmd_volume(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        volumes = [value for row in rows if (value := _finite(row.get("volume"))) is not None]
        if not volumes:
            await self.send_message(chat_id, self._openbb_error("volume", payload if not payload.get("ok") else {"error": "no volume values"}))
            return
        average = sum(volumes) / len(volumes)
        ratio = volumes[-1] / average if average else None
        median = _median(volumes)
        quietest, busiest = min(volumes), max(volumes)
        rank = sum(1 for value in volumes if value <= volumes[-1]) / len(volumes)
        lines = [
            f"Latest  <code>{_number(volumes[-1], 0)}</code>",
            f"Average <code>{_number(average, 0)}</code> · median <code>{_number(median, 0)}</code>",
            f"Ratio   <code>{_number(ratio)}x</code> the mean",
            f"Range   <code>{_number(quietest, 0)}</code> … <code>{_number(busiest, 0)}</code>",
            f"Bars    <code>{len(volumes)}</code>",
        ]
        flag = "🟢" if rank >= 0.8 else "🟡" if rank >= 0.5 else "⚪"
        lines.append(
            f"Percentile {flag} <code>{_percent(rank)}</code> of bars in this window "
            "traded less"
        )
        lines.append(
            "<i>The median sits beside the mean because one halt or one auction "
            "print drags an average somewhere no bar actually was.</i>"
        )
        await self.send_message(chat_id, text_card(f"🔊 {symbol} volume · {interval}", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/trend {symbol} {interval} {count}"))

    async def _cmd_news(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        count = self._limit(args, 1, 5, 10)
        payload = await research.news([symbol], count)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("news", payload))
            return
        items = payload.get("data") or []
        if not items:
            await self.send_message(chat_id, self._openbb_error("news", {"error": "no headlines returned"}))
            return
        lines = []
        for index, item in enumerate(items[:count], 1):
            lines.append(f"<b>{index}. {esc(item.get('title') or 'Untitled')}</b>\n   {esc(item.get('source') or 'OpenBB')} · <code>{esc(str(item.get('date') or '')[:19])}</code>")
        await self.send_message(chat_id, text_card(f"📰 {symbol} headlines", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/snapshot {symbol} · /quote {symbol}"))

    async def _cmd_fundamentals(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        payload = await research.fundamentals(symbol)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("fundamentals", payload))
            return
        data = payload["data"]
        lines = [
            f"Name       <code>{esc(data.get('name') or '—')}</code>",
            f"Exchange   <code>{esc(data.get('exchange') or '—')}</code>",
            f"Sector     <code>{esc(data.get('sector') or '—')}</code>",
            f"Industry   <code>{esc(data.get('industry') or '—')}</code>",
            f"Market cap <code>{_money(data.get('market_cap'))}</code>",
            f"P/E        <code>{_number(data.get('pe_ratio'))}</code>",
            f"EPS        <code>{_number(data.get('eps'))}</code>",
            f"Beta       <code>{_number(data.get('beta'))}</code>",
        ]
        description = str(data.get("description") or "").strip()
        if description:
            lines.append(f"\n{esc(description[:420])}{'…' if len(description) > 420 else ''}")
        await self.send_message(chat_id, text_card(f"🏢 {symbol} fundamentals", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/quote {symbol} · /news {symbol} 5"))

    async def _cmd_snapshot(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        asset = self._asset(symbol, args)
        quote, fundamentals, news = await asyncio.gather(
            research.quote(symbol, asset),
            research.fundamentals(symbol) if asset == "equity" else asyncio.sleep(0, result={"ok": False}),
            research.news([symbol], 3),
        )
        if not quote.get("ok") and not fundamentals.get("ok") and not news.get("ok"):
            await self.send_message(chat_id, self._openbb_error("snapshot", quote))
            return
        lines: list[str] = []
        if quote.get("ok"):
            data = quote["data"]
            lines += ["<b>Market</b>", f"Price <code>{_number(data.get('price'))}</code> · Change <code>{_number(data.get('change_percent'), signed=True)}%</code>"]
        if fundamentals.get("ok"):
            data = fundamentals["data"]
            lines += ["\n<b>Company</b>", f"{esc(data.get('name') or symbol)} · {esc(data.get('sector') or 'sector n/a')}", f"Market cap <code>{_money(data.get('market_cap'))}</code> · P/E <code>{_number(data.get('pe_ratio'))}</code>"]
        if news.get("ok"):
            lines.append("\n<b>Headlines</b>")
            for item in (news.get("data") or [])[:3]:
                lines.append(f"• {esc(item.get('title') or 'Untitled')}")
        await self.send_message(chat_id, text_card(f"🔎 {symbol} research snapshot", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/quote {symbol} · /bars {symbol} 1d 5 · /news {symbol} 5"))

    async def _cmd_symbols(self, args, chat_id, actor) -> None:
        lines = [f"Tracked crypto <code>{', '.join(settings.symbols)}</code>", "Equity examples <code>AAPL, MSFT, NVDA, SPY</code>", "Assets <code>equity · crypto</code>", "Intervals <code>15m · 1h · 4h · 1d</code>"]
        await self.send_message(chat_id, text_card("🔤 Instruments", "REFERENCE", lines, source="AlphaEngine configuration", next_commands="/quote AAPL · /book BTCUSDT · /intervals"))
