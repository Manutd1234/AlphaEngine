"""Execution / operations analytics, continued — costs, latency, blotter, spread history."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from modules.telegram.format import _finite, _money, _number, esc, text_card
from modules.telegram.keyboards import _choice_row, _symbol_row, cb, kb
from modules.telegram_charts import generate_bars_chart_png, generate_latency_cdf_png, generate_multi_series_png


class CostsMixin:
    async def _cmd_costs(self, args, chat_id, actor) -> None:
        today = datetime.now(timezone.utc).date()
        requested = args[0] if args else today.isoformat()
        try:
            datetime.strptime(requested, "%Y-%m-%d")
        except ValueError:
            requested = today.isoformat()
        yesterday = (today - timedelta(days=1)).isoformat()
        footer = kb([[("Today", cb("costs", today.isoformat())), ("Yesterday", cb("costs", yesterday))]])
        costs = self.audit.session_costs(requested) if self.audit else {}
        fills = costs.get("fills") or 0
        if not costs or not fills:
            await self.send_message(chat_id, text_card(
                f"💸 Session costs · {esc(requested)}", "NO FILLS",
                ["No fills recorded for this session date."],
                source="DuckDB audit log", next_commands="/quality · /orders"), reply_markup=footer)
            return
        fees = _finite(costs.get("fees")) or 0.0
        slip = _finite(costs.get("slippage_cost")) or 0.0
        lines = [
            f"Session   <code>{esc(requested)}</code>",
            f"Fills     <code>{fills}</code> · notional <code>{_money(costs.get('notional'))}</code>",
            f"Fees      <code>{_money(fees)}</code>",
            f"Slippage  <code>{_money(slip)}</code>",
            f"Total     <code>{_money(fees + slip)}</code>",
        ]
        if costs.get("fills_without_slippage"):
            lines.append(f"<i>{costs.get('fills_without_slippage')} fills carry no slippage measure — excluded from the slippage total.</i>")
        bars = generate_bars_chart_png(
            f"Fees vs slippage · {requested}", ["Fees", "Slippage"], [fees, slip],
            "USD", colours=["#f59e0b", "#ff5252"], value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("costs", bars)] if bars else [], caption=text_card(
            f"💸 Session costs · {esc(requested)}", "AUDIT AGGREGATE", lines,
            source="DuckDB audit log", next_commands="/quality · /attribution"), reply_markup=footer)

    async def _cmd_latency(self, args, chat_id, actor) -> None:
        from modules import metrics

        summary = metrics.decision_latency_summary()
        buckets = metrics.decision_latency_buckets()
        footer = kb([[("Reliability", cb("reliability")), ("SLIs", cb("ops"))]])
        samples = int(summary.get("samples") or 0)
        lines = ["<b>Decision latency (in-process µs)</b>"]
        # Every key present, so a future core_ns quantile shows up here on its own.
        for key, value in summary.items():
            printed = str(int(value)) if key == "samples" else _number(value, 0)
            lines.append(f"<code>{esc(key):<8}</code> <code>{printed}</code>")
        if not samples:
            lines.append("<i>No decision has been timed yet — an empty record, not zero latency.</i>")
        markers = [(label, _finite(summary.get(label))) for label in ("p50", "p99")]
        cdf = generate_latency_cdf_png("Decision-latency CDF (µs)", buckets, [(label, value) for label, value in markers if value])
        route_summary = metrics.request_latency_summary()
        routes = sorted(route_summary.items(), key=lambda item: item[1].get("p99", 0.0), reverse=True)[:6]
        route_bars = generate_bars_chart_png(
            "Route latency p99 (ms, observed)",
            [route[:18] for route, _ in routes],
            [_finite(stats.get("p99")) for _, stats in routes],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        lines.append("<i>Decision latency is measured inside this process in microseconds; the network path to Telegram or a venue is separate and not counted here.</i>")
        charts = [(name, blob) for name, blob in (("latency-cdf", cdf), ("route-p99", route_bars)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            "⏱ Decision latency", f"{samples} TIMED" if samples else "NO SAMPLES", lines,
            source="metrics · in-process µs", next_commands="/reliability · /ops · /status"), reply_markup=footer)

    async def _cmd_blotter(self, args, chat_id, actor) -> None:
        view = args[0].lower() if args and args[0].lower() in {"all", "fills", "rejects", "working"} else "all"
        count = self._limit(args, 1, 12, 30) if len(args) > 1 else 12
        footer = kb([[
            ("All", cb("blotter", "all")), ("Fills", cb("blotter", "fills")),
            ("Rejects", cb("blotter", "rejects")), ("Working", cb("blotter", "working")),
        ]])
        orders = self.audit.recent_orders(max(count * 3, count)) if self.audit else []
        working = self.gateway.list_working(None) if self.gateway else []
        accepted = [order for order in orders if order.get("accepted")]
        rejected = [order for order in orders if not order.get("accepted")]

        lines: list[str] = []
        chart: bytes | None = None
        if view == "working":
            title, status = "📋 Blotter · working", f"{len(working)} RESTING"
            if not working:
                lines.append("Nothing is resting on the book.")
            for order in working[:count]:
                request = getattr(order, "request", None)
                lines.append(
                    f"<code>{esc(str(order.symbol)):<8}</code> {esc(str(getattr(request, 'side', '—')))}"
                    f" <code>{_money(getattr(request, 'notional', None))}</code> @ <code>{_number(order.limit_price)}</code>"
                )
        else:
            if view == "fills":
                rows, title, status = accepted[:count], "📋 Blotter · fills", f"{len(accepted)} ACCEPTED"
            elif view == "rejects":
                rows, title, status = rejected[:count], "📋 Blotter · rejects", f"{len(rejected)} REJECTED"
            else:
                rows, title, status = orders[:count], "📋 Blotter · all", f"{len(orders)} DECISIONS"
            if not rows:
                lines.append("No matching audit rows.")
            for order in rows:
                icon = "✅" if order.get("accepted") else "❌"
                stamp = str(order.get("ts") or "")[11:19]
                lines.append(
                    f"{icon} <code>{esc(stamp)}</code> {esc(order.get('symbol'))} {esc(order.get('side'))}"
                    f" <code>{_money(order.get('notional'))}</code>"
                )
                if not order.get("accepted"):
                    lines.append(f"   ↳ <code>{esc(str(order.get('rejected_by') or order.get('reason') or 'rejected')[:80])}</code>")
            lines.append(f"<i>{len(working)} orders still resting — /working for the live set.</i>")
            if view in {"all", "rejects"} and rejected:
                from collections import Counter

                counter = Counter(str(order.get("rejected_by") or "unknown") for order in rejected)
                chart = generate_bars_chart_png(
                    "Rejections by gate", list(counter.keys()), [float(v) for v in counter.values()],
                    "Count", horizontal=True, value_fmt="{:.0f}",
                )
        await self.send_media_group(chat_id, [("rejections", chart)] if chart else [], caption=text_card(
            title, status, lines,
            source="DuckDB audit log + gateway", next_commands="/orders · /working · /quality"), reply_markup=footer)

    async def _cmd_spreadhistory(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        venue: str | None = None
        metric = "spread"
        for token in args[1:]:
            low = token.lower()
            if low in {"spread", "slip", "slippage", "depth"}:
                metric = "slip" if low in {"slip", "slippage"} else low
            else:
                venue = token.upper()
        footer = kb([
            _symbol_row("spreadhistory", symbol),
            _choice_row("spreadhistory", [("Spread", "spread"), ("Slippage", "slip"), ("Depth", "depth")], metric, prefix_args=(symbol,)),
        ])
        rows = self.audit.tca_history(symbol, venue) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card(
                f"📈 {esc(symbol)} TCA history", "NO SNAPSHOTS",
                ["The gateway records TCA snapshots on a timer; none for this symbol yet.",
                 "<i>An empty record, not a zero spread.</i>"],
                source="audit · tca_snapshots", next_commands=f"/spread {symbol}"), reply_markup=footer)
            return
        series: dict[str, list[float]] = {}
        for row in rows:
            key = str(row.get("venue") or "?")
            if metric == "spread":
                value = _finite(row.get("spread_bps"))
            elif metric == "slip":
                buy, sell = _finite(row.get("buy_slip_bps")), _finite(row.get("sell_slip_bps"))
                value = ((buy or 0.0) + (sell or 0.0)) / 2 if (buy is not None or sell is not None) else None
            else:
                bid, ask = _finite(row.get("depth_usd_bid")), _finite(row.get("depth_usd_ask"))
                value = ((bid or 0.0) + (ask or 0.0)) if (bid is not None or ask is not None) else None
            if value is not None:
                series.setdefault(key, []).append(value)
        ylabel = {"spread": "Spread (bps)", "slip": "Slippage (bps)", "depth": "Depth (USD)"}[metric]
        lines = [
            f"Symbol   <code>{esc(symbol)}</code>{(' · ' + esc(venue)) if venue else ''}",
            f"Metric   <code>{esc(metric)}</code>",
            f"Rows     <code>{len(rows)}</code> across <code>{len(series)}</code> venue(s)",
        ]
        for key, vals in series.items():
            lines.append(f"<code>{esc(key):<10}</code> latest <code>{_number(vals[-1])}</code> · n=<code>{len(vals)}</code>")
        chart = generate_multi_series_png(f"{symbol} {metric} history", series, ylabel)
        await self.send_media_group(chat_id, [("tcahistory", chart)] if chart else [], caption=text_card(
            f"📈 {esc(symbol)} TCA history", "PERSISTED", lines,
            source="audit · tca_snapshots", next_commands=f"/spread {symbol} · /depth {symbol}"), reply_markup=footer)
