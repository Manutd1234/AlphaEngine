"""Execution / operations analytics (read-only) — lineage, gates, quality, imbalance."""

from __future__ import annotations

import base64
from typing import Any

from config import settings
from modules.telegram.format import _finite, _money, _number, esc, text_card
from modules.telegram.keyboards import _choice_row, _symbol_row, cb, kb
from modules.telegram_charts import (
    generate_bars_chart_png,
    generate_depth_chart_png,
    generate_gate_ladder_png,
    generate_pipeline_png,
    generate_scatter_png,
)


class AnalyticsMixin:
    # ------------------------------------------------------------------ #
    # Execution / operations analytics (read-only)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _decode_b64png(encoded: Any) -> bytes | None:
        """Decode a base64 chart, or None when it is absent or malformed."""
        if not encoded:
            return None
        try:
            return base64.b64decode(encoded)
        except Exception:
            return None

    async def _cmd_lineage(self, args, chat_id, actor) -> None:
        from modules import metrics, research

        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        connected = sum(1 for feed in feeds if feed.get("connected"))
        books = [book for book in (self.tca.get_books(symbol, depth=5) if self.tca else []) if book.mid]
        synthetic = any(getattr(book, "synthetic", False) for book in books)
        state = self.gateway.state() if self.gateway else None
        decisions = metrics.decision_latency_summary()
        audit_health = self.audit.health() if self.audit else {}
        mirror_on = bool(getattr(settings, "supabase_url", "") or "")

        def feed_status() -> str:
            if not feeds:
                return "unknown"
            if connected == len(feeds):
                return "ok"
            return "degraded" if connected else "down"

        def gate_status() -> str:
            if state is None:
                return "unknown"
            if state.kill_switch_active:
                return "down"
            return "degraded" if getattr(state, "reduce_only", False) else "ok"

        stages = [
            ("OpenBB", "ok" if openbb.get("ok") else "down", "research feed"),
            ("Feeds", feed_status(), f"{connected}/{len(feeds)} live"),
            ("Book", ("down" if not books else "degraded" if synthetic else "ok"), f"{len(books)} venue(s)"),
            ("Gates", gate_status(), "17 pre-trade"),
            ("Decisions", "ok" if decisions.get("samples") else "unknown", f"{int(decisions.get('samples') or 0)} timed"),
            ("Audit", "ok" if audit_health.get("available") else "down", str(audit_health.get("backend") or "—")),
            ("Mirror", "ok" if mirror_on else "unknown", "supabase" if mirror_on else "local only"),
        ]
        lines = [
            f"<code>{esc(label):<10}</code> <code>{esc(status.upper())}</code> · {esc(detail)}"
            for label, status, detail in stages
        ]
        lines.append("<i>The path a signal takes from provider to durable record. A degraded or down stage marks where it would stall.</i>")
        chart = generate_pipeline_png(f"Signal path · {symbol}", stages)
        await self.send_media_group(chat_id, [("lineage", chart)] if chart else [], caption=text_card(
            f"🧬 Lineage · {esc(symbol)}", "TOPOLOGY", lines,
            source="TCA + gateway + metrics + audit", next_commands=f"/latency · /gates {symbol} · /status"),
            reply_markup=kb([_symbol_row("lineage", symbol)]))

    async def _cmd_gates(self, args, chat_id, actor) -> None:
        """A read-only preview of the 17 pre-trade gates. Submits nothing.

        Every number here is read from current state — limits, the live mark,
        gross exposure, projected notionals, the drawdown, a route estimate. No
        token is consumed, no counter moves, no audit row is written: it is the
        headroom the next order WOULD meet, not an order.
        """
        symbol = self._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else float(settings.default_probe_notional)
        if notional is None or notional <= 0:
            notional = float(settings.default_probe_notional)
        side = args[2].upper() if len(args) > 2 else "BUY"
        if side not in {"BUY", "SELL"}:
            side = "BUY"
        notional_arg = str(int(notional))

        state = self.gateway.state() if self.gateway else None
        mark = self.gateway.mark(symbol) if self.gateway else None
        if mark is None and self.tca:
            mark = self.tca.consolidated_mid(symbol)
        limits = state.limits if state else {}

        numeric: list[tuple[str, float | None, float | None, bool]] = []
        bool_lines: list[str] = []
        if state is not None:
            bool_lines.append(f"kill_switch      {'❌' if state.kill_switch_active else '✅'} <code>{'engaged' if state.kill_switch_active else 'disengaged'}</code>")
            halted = symbol in (state.halted_symbols or [])
            bool_lines.append(f"symbol_halt      {'❌' if halted else '✅'} <code>{esc(symbol)}</code>")
        bool_lines.append(f"price_available  {'✅' if mark else '❌'} <code>{('mark ' + _number(mark)) if mark else 'no live mark'}</code>")

        order_cap = _finite(limits.get("max_order_notional_usd"))
        if order_cap:
            numeric.append(("max_order_notional", notional, order_cap, notional <= order_cap))
        qty = (notional / mark) if mark else None
        if qty is not None and self.gateway:
            signed_qty = qty * (1 if side == "BUY" else -1)
            projected_sym = self.gateway.projected_symbol_notional(symbol, signed_qty, mark)
            sym_cap = _finite(limits.get("max_symbol_notional_usd"))
            if sym_cap:
                numeric.append(("symbol_concentration", projected_sym, sym_cap, projected_sym <= sym_cap))
            gross_cap = _finite(limits.get("max_gross_exposure_usd"))
            if gross_cap:
                projected_gross = self.gateway.gross_exposure() - self.gateway.symbol_notional(symbol) + projected_sym
                numeric.append(("gross_exposure", projected_gross, gross_cap, projected_gross <= gross_cap))
        if state is not None:
            dd = self.gateway.daily_drawdown_pct()
            dd_cap = _finite(limits.get("max_daily_drawdown_pct"))
            if dd_cap:
                numeric.append(("daily_drawdown", dd, dd_cap, dd < dd_cap))
            rate_cap = _finite(limits.get("max_orders_per_sec"))
            if rate_cap:
                numeric.append(("rate_limit", state.orders_last_second, rate_cap, state.orders_last_second < rate_cap))
            working_cap = _finite(getattr(settings, "max_working_orders", None))
            if working_cap:
                numeric.append(("working_book", float(state.working_orders), working_cap, state.working_orders < working_cap))

        est = self.tca.route_estimate(symbol, side, notional) if self.tca else None
        slip_cap = _finite(limits.get("max_est_slippage_bps"))
        if est is None:
            bool_lines.append("est_slippage     ❌ <code>no routable liquidity</code>")
        elif not est.fillable:
            bool_lines.append(f"est_slippage     ❌ <code>only {_money(est.filled_notional)} routable</code>")
        elif est.slippage_bps is not None and slip_cap:
            numeric.append(("est_slippage", est.slippage_bps, slip_cap, est.slippage_bps <= slip_cap))
        if self.gateway and self.gateway.reduce_only_active():
            bool_lines.append("reduce_only      ⚠️ <code>only risk-reducing orders accepted</code>")

        lines = [
            f"Probe   <code>{side} {_money(notional)} {esc(symbol)}</code>",
            "<code>dry-run · nothing submitted · reads current state</code>",
            "",
        ]
        lines += [
            f"<code>{esc(name):<20}</code> {'✅' if ok else '❌'} <code>{_number(obs)}</code> / <code>{_number(lim)}</code>"
            for name, obs, lim, ok in numeric
        ]
        if bool_lines:
            lines.append("")
            lines.extend(bool_lines)
        lines.append("<i>A preview of the 17 pre-trade gates from current state — nothing is submitted and no counter, token or audit row moves.</i>")
        chart = generate_gate_ladder_png(f"Pre-trade headroom · {side} {symbol}", numeric)
        footer = kb([
            _symbol_row("gates", symbol, notional_arg, side),
            _choice_row("gates", [("25k", "25000"), ("100k", "100000"), ("250k", "250000"), ("1m", "1000000")], notional_arg, prefix_args=(symbol,), suffix_args=(side,)),
            [("BUY", cb("gates", symbol, notional_arg, "BUY")), ("SELL", cb("gates", symbol, notional_arg, "SELL"))],
            [("Headroom", cb("headroom")), ("TCA", cb("tca", symbol, notional_arg, side))],
        ])
        await self.send_media_group(chat_id, [("gates", chart)] if chart else [], caption=text_card(
            f"🚦 Pre-trade gates · {esc(symbol)}", "DRY-RUN", lines,
            source="Gateway read-only state", next_commands=f"/tca {symbol} {notional_arg} {side} · /headroom · /limits"), reply_markup=footer)

    async def _cmd_quality(self, args, chat_id, actor) -> None:
        dimension = args[0].lower() if args and args[0].lower() in {"venue", "strategy"} else "venue"
        footer = kb([[("By venue", cb("quality", "venue")), ("By strategy", cb("quality", "strategy"))]])
        rows = self.audit.execution_quality_by(dimension) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card(
                "🎯 Fill quality", "NO FILLS",
                [f"No fills recorded to group by {esc(dimension)}."],
                source="DuckDB audit log", next_commands="/orders · /blotter"), reply_markup=footer)
            return
        lines = [f"<b>{dimension.upper():<10} FILLS  SLIP(bps)  NOTIONAL</b>"]
        for row in rows[:8]:
            lines.append(
                f"{esc(str(row.get('bucket'))):<10} <code>{row.get('filled') or 0}</code>"
                f" · <code>{_number(row.get('avg_slippage_bps'), signed=True)}</code>"
                f" · <code>{_money(row.get('notional'))}</code>"
            )
        bars = generate_bars_chart_png(
            f"Average slippage by {dimension} (bps)",
            [str(row.get("bucket")) for row in rows[:8]],
            [_finite(row.get("avg_slippage_bps")) for row in rows[:8]],
            "Slippage (bps)", horizontal=True, value_fmt="{:+.2f}",
        )
        orders = [
            order for order in (self.audit.recent_orders(200) if self.audit else [])
            if order.get("accepted") and _finite(order.get("slippage_bps")) is not None
            and _finite(order.get("notional")) is not None
        ]
        scatter = generate_scatter_png(
            "Slippage vs order notional (accepted fills)",
            [_finite(order.get("notional")) for order in orders],
            [_finite(order.get("slippage_bps")) for order in orders],
            "Notional (USD)", "Slippage (bps)",
            groups=[str(order.get("venue") or "?") for order in orders], fit_line=True,
        )
        if not scatter:
            lines.append("<i>Fewer than five accepted fills carry both a slippage and a notional, so no scatter.</i>")
        charts = [(name, blob) for name, blob in (("quality-bars", bars), ("quality-scatter", scatter)) if blob]
        await self.send_media_group(chat_id, charts, caption=text_card(
            "🎯 Fill quality", f"BY {dimension.upper()}", lines,
            source="DuckDB audit log", next_commands="/orders · /slippage · /blotter"), reply_markup=footer)

    async def _cmd_imbalance(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        footer = kb([_symbol_row("imbalance", symbol)])
        books = [book for book in (self.tca.get_books(symbol, depth=20) if self.tca else []) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(
                f"⚖️ {esc(symbol)} imbalance", "NO LIVE BOOK",
                ["No venue currently has a fresh book for this symbol."],
                source="TCA engine", next_commands="/feedstatus"), reply_markup=footer)
            return
        lines = ["<b>VENUE        IMBALANCE   BID/ASK DEPTH</b>"]
        bids: list[tuple[float, float]] = []
        asks: list[tuple[float, float]] = []
        for book in books:
            value = _finite(book.imbalance)
            lean = "→ bid" if (value or 0) > 0.05 else "→ ask" if (value or 0) < -0.05 else "· flat"
            lines.append(
                f"<code>{esc(str(book.venue)):<10}</code> <code>{_number(book.imbalance, signed=True)}</code> {lean}"
                f" · <code>{_money(book.depth_usd_bid)}</code>/<code>{_money(book.depth_usd_ask)}</code>"
            )
            bids.extend((level.price, level.size) for level in book.bids)
            asks.extend((level.price, level.size) for level in book.asks)
        lines.append("<i>Imbalance is (bid − ask) depth over their sum: positive is a resting-bid lean, a buy-side pressure.</i>")
        chart = generate_depth_chart_png(symbol, bids, asks)
        await self.send_media_group(chat_id, [("depth", chart)] if chart else [], caption=text_card(
            f"⚖️ {esc(symbol)} imbalance", "SYNTHETIC" if any(book.synthetic for book in books) else "LIVE", lines,
            source="Cross-venue TCA engine", next_commands=f"/depth {symbol} · /book {symbol}"), reply_markup=footer)
