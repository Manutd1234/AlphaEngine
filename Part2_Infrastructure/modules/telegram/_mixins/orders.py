"""The order tape — timeline, working orders, ops, fills, rejections, slippage, fees."""

from __future__ import annotations

from typing import Any

from modules.telegram.format import _money, _number, esc, text_card


class OrdersMixin:
    def _recent_orders(self, args: list[str], accepted: bool | None = None) -> list[dict[str, Any]]:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_orders(max(count * 3, count)) if self.audit else []
        if accepted is not None:
            rows = [row for row in rows if bool(row.get("accepted")) is accepted]
        return rows[:count]

    async def _render_orders(self, chat_id: str, title: str, rows: list[dict[str, Any]], state: str) -> None:
        if not rows:
            await self.send_message(chat_id, text_card(title, "NO RECORDS", ["No matching audit rows."], source="DuckDB audit log", next_commands="/orders"))
            return
        lines = []
        for row in rows:
            icon = "✅" if row.get("accepted") else "❌"
            timestamp = str(row.get("ts") or "")[11:19]
            lines.append(f"{icon} <code>{esc(timestamp)}</code> {esc(row.get('symbol'))} {esc(row.get('side'))} <code>{_money(row.get('notional'))}</code> · <code>{_number(row.get('latency_ms'))} ms</code>")
            if not row.get("accepted"):
                lines.append(f"   ↳ <code>{esc(str(row.get('rejected_by') or row.get('reason') or 'rejected')[:120])}</code>")
        await self.send_message(chat_id, text_card(title, state, lines, source="DuckDB audit log", next_commands="/slippage · /fees · /events"))

    async def _cmd_timeline(self, args, chat_id, actor) -> None:
        """Every transition one order made, from the audit trail.

        Named /timeline rather than /order deliberately: there is no command
        that opens a position, and a name suggesting otherwise would erode a
        boundary the whole design rests on.
        """
        if not args:
            await self.send_message(chat_id, text_card(
                "🧾 Order timeline", "NEEDS AN ORDER ID",
                ["Use <code>/timeline ORDER_ID</code> — /orders lists recent ids."],
                source="audit · order_events", next_commands="/orders · /working",
            ))
            return

        order_id = args[0]
        rows = self.audit.order_timeline(order_id) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card(
                f"🧾 Order {esc(order_id)}", "NOT FOUND",
                ["No order with that id has been recorded on this gateway.",
                 "<i>The audit trail is the record; an unknown id means it never "
                 "reached the gates, not that it was rejected.</i>"],
                source="audit · order_events", next_commands="/orders",
            ))
            return

        lines = ["<b>WHEN      EVENT        STATUS</b>"]
        for row in rows[:20]:
            stamp = str(row.get("ts"))[11:19] or "—"
            lines.append(
                f"<code>{esc(stamp):<9}</code> <code>{esc(str(row.get('event'))[:12]):<12}</code> "
                f"<code>{esc(str(row.get('status') or '—')[:10])}</code>"
            )
        head = rows[0]
        tail = rows[-1]
        lines.append("")
        lines.append(f"Symbol      <code>{esc(head.get('symbol'))}</code> · <code>{esc(head.get('side'))}</code>")
        lines.append(f"Notional    <code>{_money(head.get('notional'))}</code>")
        if tail.get("fill_price"):
            lines.append(f"Filled at   <code>{_number(tail.get('fill_price'), 2)}</code> · fee <code>{_money(tail.get('fee_usd'))}</code>")
        lines.append(f"Actor       <code>{esc(head.get('actor') or 'unknown')}</code>")
        if len(rows) > 20:
            lines.append(f"<i>Showing the first 20 of {len(rows)} events.</i>")

        await self.send_message(chat_id, text_card(
            f"🧾 Order {esc(order_id)}", f"{len(rows)} EVENTS", lines,
            source="audit · order_events", next_commands="/orders · /slippage",
        ))

    async def _cmd_working(self, args, chat_id, actor) -> None:
        """What is still resting on the book — the set a desk can still act on."""
        symbol = args[0].upper() if args else None
        orders = self.gateway.list_working(symbol)
        if not orders:
            await self.send_message(chat_id, text_card(
                "📋 Working orders", "NONE RESTING",
                [f"Nothing open{f' for {esc(symbol)}' if symbol else ''}.",
                 "<i>Terminal decisions live in /orders; this is only what is "
                 "still live.</i>"],
                source="Risk gateway", next_commands="/orders · /positions",
            ))
            return

        lines = ["<b>SYMBOL   SIDE  NOTIONAL     LIMIT</b>"]
        for order in orders[:20]:
            request = getattr(order, "request", None)
            side = getattr(request, "side", "—")
            lines.append(
                f"<code>{esc(str(order.symbol)[:8]):<8}</code> <code>{esc(str(side)):<5}</code>"
                f"<code>{_money(getattr(request, 'notional', None)):>11}</code>  "
                f"<code>{_number(order.limit_price, 2)}</code>"
            )
        lines.append(f"<i>{len(orders)} resting. Cancelling or replacing stays in the "
                     "web blotter — a chat client should not be able to reach into a "
                     "live order queue.</i>")
        await self.send_message(chat_id, text_card(
            "📋 Working orders", f"{len(orders)} RESTING", lines,
            source="Risk gateway", next_commands="/orders · /timeline",
        ))

    async def _cmd_ops(self, args, chat_id, actor) -> None:
        """One internally consistent reliability snapshot, as the web reads it."""
        from modules.operations import build_operations_snapshot

        try:
            snapshot = build_operations_snapshot(
                tca=self.tca, gateway=self.gateway, queue=self.queue,
                audit=self.audit, bot=self,
            )
        except Exception as exc:  # noqa: BLE001 — reported, never guessed at
            await self.send_message(chat_id, text_card(
                "🩺 Operations", "SNAPSHOT FAILED", [esc(str(exc)[:200])],
                source="operations", next_commands="/status",
            ))
            return

        flag = {"ok": "🟢", "degraded": "🟡", "critical": "🔴"}
        risk = snapshot.risk
        queue_state = snapshot.queue
        lines = [
            f"Platform    {flag.get(str(snapshot.status), '⚪')} <code>{esc(str(snapshot.status).upper())}</code>",
            f"Build       <code>{esc(snapshot.version)}</code> · <code>{esc(snapshot.environment)}</code>",
            "",
            f"Risk        <code>{esc(str(risk.status).upper())}</code> · kill switch "
            f"<code>{'ACTIVE' if risk.kill_switch_active else 'INACTIVE'}</code>"
            + (" · <code>REDUCE-ONLY</code>" if risk.reduce_only else ""),
            f"Orders      <code>{risk.orders_accepted_total}</code> accepted · "
            f"<code>{risk.orders_rejected_total}</code> rejected",
            f"Queue       <code>{esc(queue_state.backend)}</code> · "
            f"<code>{queue_state.workers}</code> workers · <code>{queue_state.total}</code> jobs",
            f"Market data <code>{esc(str(snapshot.market_data.status).upper())}</code>",
            f"Audit       <code>{esc(snapshot.audit.backend)}</code> · "
            f"<code>{'AVAILABLE' if snapshot.audit.available else 'UNAVAILABLE'}</code>",
        ]
        if risk.halted_symbols:
            lines.append(f"Halted      <code>{esc(', '.join(risk.halted_symbols))}</code>")
        lines.append(
            "<i>One process-local snapshot: this gateway's own view, not a fleet "
            "aggregate. Every panel above was read in the same instant.</i>"
        )
        await self.send_message(chat_id, text_card(
            "🩺 Operations", "MEASURED", lines,
            source="operations snapshot", next_commands="/status · /reliability · /incidents",
        ))

    async def _cmd_orders(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "🧾 Gateway decisions", self._recent_orders(args), "AUDIT LOG")

    async def _cmd_fills(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "✅ Accepted fills", self._recent_orders(args, True), "AUDIT LOG")

    async def _cmd_rejections(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "❌ Rejected orders", self._recent_orders(args, False), "AUDIT LOG")

    async def _cmd_slippage(self, args, chat_id, actor) -> None:
        stats = self.audit.execution_stats() if self.audit else {}
        lines = [f"Accepted orders <code>{stats.get('accepted') or 0}</code>", f"Average slip   <code>{_number(stats.get('avg_slippage_bps'), signed=True)} bps</code>", f"Average latency <code>{_number(stats.get('avg_latency_ms'))} ms</code>", f"Max latency     <code>{_number(stats.get('max_latency_ms'))} ms</code>"]
        await self.send_message(chat_id, text_card("📉 Execution slippage", "AUDIT AGGREGATE", lines, source="DuckDB audit log", next_commands="/tca BTCUSDT 100000 BUY · /orders"))

    async def _cmd_fees(self, args, chat_id, actor) -> None:
        stats = self.audit.execution_stats() if self.audit else {}
        lines = [f"Total fees <code>{_money(stats.get('total_fees'))}</code>", f"Orders     <code>{stats.get('total') or 0}</code>", f"Accepted   <code>{stats.get('accepted') or 0}</code>"]
        await self.send_message(chat_id, text_card("💸 Execution fees", "AUDIT AGGREGATE", lines, source="DuckDB audit log", next_commands="/attribution · /fills"))
