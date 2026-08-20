"""Beyond web — a normalised multi-symbol overlay, plus the event tape."""

from __future__ import annotations

from typing import Any

from modules.telegram.format import _number, esc, text_card
from modules.telegram.keyboards import _INTERVALS, cb, kb
from modules.telegram_charts import generate_multi_series_png


class CompareMixin:
    # ------------------------------------------------------------------ #
    # Beyond web — a normalised multi-symbol overlay
    # ------------------------------------------------------------------ #
    async def _cmd_compare(self, args, chat_id, actor) -> None:
        """A normalised price overlay across several instruments."""
        interval = next((token for token in args if token in _INTERVALS), "1d")
        symbols = self._symbols([token for token in args if token not in _INTERVALS], limit=4)
        symbol_args = tuple(symbols)
        try:
            interval_row = [
                (f"• {value}" if value == interval else value, cb("compare", *symbol_args, value))
                for value in _INTERVALS
            ]
            footer = kb([interval_row])
        except ValueError:
            footer = None

        series: dict[str, list[float]] = {}
        for symbol in symbols:
            asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
            closes = await self._closes_for(symbol, asset, interval, 90)
            if len(closes) >= 2:
                series[symbol] = closes
        if not series:
            await self.send_message(chat_id, text_card(
                "🔭 Compare", "NO SERIES",
                ["No instrument returned enough bars to overlay.",
                 f"Symbols: <code>{esc(', '.join(symbols))}</code> · interval <code>{esc(interval)}</code>"],
                source="OpenBB", next_commands="/bars · /trend"), reply_markup=footer)
            return
        lines = [f"Interval <code>{esc(interval)}</code> · <code>{len(series)}</code> series, indexed to 100 at the first bar"]
        for symbol, closes in series.items():
            move = (closes[-1] / closes[0] - 1) * 100 if closes[0] else 0.0
            lines.append(f"<code>{esc(symbol):<10}</code> {_number(move, 2, signed=True)}% over <code>{len(closes)}</code> bars")
        lines.append("<i>Rebased to a common 100 so instruments of very different price share one axis — the shapes are comparable, the levels are not.</i>")
        chart = generate_multi_series_png(f"Normalised overlay · {interval}", series, "Price", normalise=True, xlabel="Bar")
        await self.send_media_group(chat_id, [("compare", chart)] if chart else [], caption=text_card(
            "🔭 Compare", "NORMALISED", lines,
            source="OpenBB / yfinance", next_commands="/trend · /bars · /range"), reply_markup=footer)

    def _event_rows(self, args: list[str], incidents_only: bool = False) -> list[dict[str, Any]]:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_events(max(count * 3, count)) if self.audit else []
        if incidents_only:
            rows = [row for row in rows if str(row.get("severity") or "").lower() in {"warning", "critical", "error"}]
        return rows[:count]

    async def _render_events(self, chat_id: str, title: str, rows: list[dict[str, Any]], status: str) -> None:
        if not rows:
            await self.send_message(chat_id, text_card(title, "NO RECORDS", ["No matching events."], source="DuckDB audit log", next_commands="/status"))
            return
        icon = {"critical": "🛑", "error": "🔴", "warning": "⚠️", "info": "ℹ️"}
        lines = []
        for row in rows:
            severity = str(row.get("severity") or "info").lower()
            lines.append(f"{icon.get(severity, '•')} <code>{esc(str(row.get('ts') or '')[11:19])}</code> {esc(row.get('event'))} · {esc(row.get('symbol') or 'ALL')}\n   <code>{esc(str(row.get('detail') or '')[:150])}</code>")
        await self.send_message(chat_id, text_card(title, status, lines, source="DuckDB audit log", next_commands="/risk · /orders · /status"))

    async def _cmd_events(self, args, chat_id, actor) -> None:
        await self._render_events(chat_id, "📚 Risk and audit events", self._event_rows(args), "AUDIT LOG")

    async def _cmd_incidents(self, args, chat_id, actor) -> None:
        await self._render_events(chat_id, "🚨 Operational incidents", self._event_rows(args, True), "WARNING + CRITICAL")
