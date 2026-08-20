"""Data engineer — trust, provenance, providers and the work queues."""

from __future__ import annotations

import asyncio

from modules.telegram.format import _finite, _number, esc, text_card
from modules.telegram.keyboards import _symbol_row, kb
from modules.telegram_charts import generate_bars_chart_png


class DataOpsMixin:
    # ------------------------------------------------------------------ #
    # Data engineer — trust, provenance, providers and the work queues
    # ------------------------------------------------------------------ #
    async def _cmd_trust(self, args, chat_id, actor) -> None:
        """A single feed-trust verdict, plus per-venue book freshness."""
        from modules import research

        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        openbb = await research.openbb_status_async()
        audit_health = self.audit.health() if self.audit else {}
        synthetic = bool(health.get("synthetic_active"))
        connected = sum(1 for feed in feeds if feed.get("connected"))

        ages: list[tuple[str, float | None, bool]] = []
        for feed in feeds:
            venue = str(feed.get("venue") or feed.get("name") or "?")
            symbol_states = list((feed.get("symbols") or {}).values())
            venue_ages = [state.get("age_s") for state in symbol_states if state.get("age_s") is not None]
            stale = any(state.get("stale") for state in symbol_states)
            ages.append((venue, max(venue_ages) if venue_ages else None, stale))

        if not feeds:
            verdict = "UNAVAILABLE"
        elif synthetic:
            verdict = "SYNTHETIC"
        elif connected < len(feeds) or any(stale for _, _, stale in ages):
            verdict = "DEGRADED"
        else:
            verdict = "TRUSTED"

        lines = [
            f"Verdict     <code>{verdict}</code>",
            f"Venues      <code>{connected}/{len(feeds)} connected</code>",
            f"OpenBB      <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>",
            f"Audit       <code>{esc(audit_health.get('backend') or '—')}</code> · "
            f"<code>{'available' if audit_health.get('available') else 'unavailable'}</code>",
            f"Synthetic   <code>{'ACTIVE — generated book, not a venue' if synthetic else 'off'}</code>",
        ]
        for venue, age, stale in ages:
            age_txt = _number(age, 1) if age is not None else "—"
            lines.append(f"<code>{esc(venue):<10}</code> age <code>{age_txt}</code>s{' ⚠ stale' if stale else ''}")
        lines.append("<i>A verdict of SYNTHETIC means the book is generated because every venue is dark — never trade on it.</i>")
        chart = generate_bars_chart_png(
            "Book age by venue (s, lower is fresher)",
            [venue for venue, _, _ in ages],
            [_finite(age) for _, age, _ in ages],
            "Age (s)", colours=["#ff5252" if stale else "#00e676" for _, _, stale in ages],
            horizontal=True, value_fmt="{:.1f}s",
        )
        await self.send_media_group(chat_id, [("trust", chart)] if chart else [], caption=text_card(
            "🔎 Data trust", verdict, lines,
            source="TCA feeds + OpenBB + audit", next_commands="/dataquality · /payload BTCUSDT · /feedstatus"))

    async def _cmd_ack(self, args, chat_id, actor) -> None:
        """Take an escalation, from the one surface where a real person exists.

        The gateway's HTTP identity resolves to `web:token` or `web:anonymous`
        — a capability, not a person — so a web acknowledgement can only ever
        record the token that made it. Telegram carries a user id, which is why
        the acknowledgement lands here first and why this handler refuses an
        actor it cannot name.
        """
        from modules.data_quality import get_data_quality

        raw = (args[0] if args else "").strip()
        if not raw.isdigit():
            await self.send_message(chat_id, text_card(
                "Acknowledge an escalation", "USAGE",
                ["<code>/ack &lt;ID&gt;</code> — the id shown beside an open escalation in /trust."],
                source="Data quality ledger", next_commands="/trust · /dataquality",
            ))
            return

        try:
            user_id = self._user_id_from_actor(actor)
        except PermissionError:
            await self.send_message(chat_id, text_card(
                "Acknowledge an escalation", "REFUSED",
                ["This chat is not bound to a desk identity, so an acknowledgement here "
                 "would have no name against it."],
                source="Data quality ledger", next_commands="/start · /whoami",
            ))
            return

        taken = await asyncio.to_thread(
            get_data_quality().acknowledge, int(raw), f"telegram:{user_id}",
        )
        if taken:
            body = [f"Escalation <b>{esc(raw)}</b> is acknowledged by <code>telegram:{esc(str(user_id))}</code>."]
            state = "ACKNOWLEDGED"
        else:
            # Not an error. "Already resolved" and "no such escalation" are both
            # "there is nothing to take", and neither is a failure to report.
            body = [f"Nothing open with id <b>{esc(raw)}</b> — it has resolved, or there is no such escalation."]
            state = "NOTHING TO TAKE"
        await self.send_message(chat_id, text_card(
            "Acknowledge an escalation", state, body,
            source="Data quality ledger", next_commands="/trust · /dataquality",
        ))

    async def _cmd_dataquality(self, args, chat_id, actor) -> None:
        """Feed degrade/recover transitions from the audit log, and reconnects."""
        count = self._limit(args, 0, 10, 25)
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        events = [
            event for event in (self.audit.recent_events(max(count * 4, count)) if self.audit else [])
            if str(event.get("event") or "") in {"feed_degraded", "feed_recovered"}
        ][:count]
        lines = [f"<b>Feed transitions</b> · last <code>{len(events)}</code>"]
        if events:
            icon = {"feed_recovered": "✅", "feed_degraded": "⚠️"}
            for event in events:
                stamp = str(event.get("ts") or "")[11:19]
                lines.append(
                    f"{icon.get(str(event.get('event')), '•')} <code>{esc(stamp)}</code> {esc(event.get('event'))}\n"
                    f"   <code>{esc(str(event.get('detail') or '')[:120])}</code>"
                )
        else:
            lines.append("<i>No feed degrade or recover events recorded — an empty record, not a promise of perfect feeds.</i>")
        lines += ["", "<b>Reconnects by venue</b>"]
        reconnects = [(str(feed.get("venue") or feed.get("name") or "?"), int(feed.get("reconnects") or 0)) for feed in feeds]
        for venue, total in reconnects:
            lines.append(f"<code>{esc(venue):<10}</code> <code>{total}</code>")
        chart = generate_bars_chart_png(
            "WebSocket reconnects by venue",
            [venue for venue, _ in reconnects], [float(total) for _, total in reconnects],
            "Reconnects", horizontal=True, value_fmt="{:.0f}",
        )
        await self.send_media_group(chat_id, [("reconnects", chart)] if chart else [], caption=text_card(
            "🩹 Data quality", f"{len(events)} TRANSITIONS", lines,
            source="audit feed-watchdog + TCA", next_commands="/trust · /feedstatus · /incidents"))

    async def _cmd_payload(self, args, chat_id, actor) -> None:
        """Per-venue provenance for one symbol, plus the OpenBB quote's own."""
        from modules import research

        symbol = self._symbol(args)
        footer = kb([_symbol_row("payload", symbol)])
        books = self.tca.get_books(symbol, depth=5) if self.tca else []
        lines = [f"<b>Venue books · {esc(symbol)}</b>"]
        if books:
            for book in books:
                last = book.last_update.strftime("%H:%M:%S") if getattr(book, "last_update", None) else "—"
                latency = _number(book.latency_ms, 1) if book.latency_ms is not None else "—"
                lines.append(
                    f"<code>{esc(str(book.venue)):<9}</code> upd <code>{last}</code>"
                    f" · lat <code>{latency}</code>ms"
                    f" · <code>{'SYNTH' if book.synthetic else 'live'}</code>"
                    f"{' · ⚠ stale' if book.stale else ''}"
                )
        else:
            lines.append("<i>No venue currently holds a book for this symbol — a missing feed, not a zero price.</i>")
        asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        quote = await research.quote(symbol, asset)
        lines += ["", "<b>OpenBB quote provenance</b>"]
        if quote.get("ok"):
            data = quote.get("data") or {}
            lines.append(
                f"Price <code>{_number(data.get('price'))}</code> · "
                f"delayed <code>{'yes' if data.get('delayed') else 'no'}</code> · "
                f"ccy <code>{esc(data.get('currency') or '—')}</code>"
            )
        else:
            lines.append(f"<code>{esc(str(quote.get('error') or 'unavailable'))[:100]}</code>")
        lines.append("<i>Every field is read straight from the last update; a missing measurement renders as —, never as 0.</i>")
        await self.send_message(chat_id, text_card(
            f"🧾 Provenance · {esc(symbol)}", "PER-VENUE", lines,
            source="TCA books + OpenBB", next_commands=f"/trust · /lineage {symbol}"), reply_markup=footer)

    async def _cmd_providers(self, args, chat_id, actor) -> None:
        """OpenBB, the venue feeds, and the web-ops ledger the browser POSTs here."""
        from modules import research
        from modules.web_telemetry import get_web_ops

        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        view = get_web_ops().view()
        lines = [
            f"OpenBB      <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code> · "
            f"provider <code>{esc(openbb.get('provider') or '—')}</code>",
            "",
            "<b>Venue feeds</b>",
        ]
        for feed in feeds:
            venue = str(feed.get("venue") or feed.get("name") or "?")
            lines.append(
                f"<code>{esc(venue):<10}</code> <code>{'connected' if feed.get('connected') else 'down'}</code>"
                f" · reconnects <code>{int(feed.get('reconnects') or 0)}</code>"
            )
        lines += ["", "<b>Web-ops ledger</b> (what the browser POSTs here)",
                  f"Instances <code>{len(view.instances)}</code> · keys <code>{len(view.latency)}</code>"
                  f" · outages <code>{len(view.outages)}</code> · quota rows <code>{len(view.quota)}</code>"]
        for outage in view.outages[:4]:
            lines.append(f"⚠️ outage <code>{esc(outage.provider)}</code> · {esc(outage.note)[:60]}")
        for entry in view.quota[:4]:
            lines.append(f"quota <code>{esc(entry.provider)}</code>/{esc(entry.window)} spent <code>{entry.spent}</code>")
        if not view.instances:
            lines.append("<i>No web instance has synced telemetry into this gateway yet — the browser fills it within a few polls.</i>")
        await self.send_message(chat_id, text_card(
            "🔌 Providers", "READY" if openbb.get("ok") else "DEGRADED", lines,
            source="OpenBB + TCA + web-ops", next_commands="/webops · /trust · /openbb"))

    async def _cmd_tasks(self, args, chat_id, actor) -> None:
        """The Data work queue is the gateway's now; the Developer queue is still the browser's."""
        from modules.work_items import get_work_items

        lines: list[str] = []
        try:
            items = get_work_items().list()
        except Exception as exc:  # pragma: no cover - the store is best-effort from chat
            items = []
            lines.append(f"<i>The work-item store could not be read ({esc(type(exc).__name__)}).</i>")
        open_items = [item for item in items if item.status != "resolved"]
        by_work_status: dict[str, int] = {}
        for item in items:
            by_work_status[item.status] = by_work_status.get(item.status, 0) + 1
        seeded = sum(1 for item in items if item.created_by == "seed")
        lines += [
            f"<b>Data work queue</b> — persisted on this gateway (SQLite): "
            f"<code>{len(items)}</code> items, <code>{len(open_items)}</code> open, "
            f"<code>{seeded}</code> seeded samples.",
        ]
        for status in ("intake", "ready", "progress", "resolved"):
            lines.append(f"<code>{status:<10}</code> <code>{by_work_status.get(status, 0)}</code>")
        urgent = [item for item in open_items if item.priority in ("P0", "P1")]
        if urgent:
            lines.append("")
            lines.append("<b>P0 / P1 open</b>")
            for item in sorted(urgent, key=lambda i: (i.priority, i.opened_at))[:5]:
                lines.append(f"<code>{esc(item.id)}</code> {esc(item.priority)} · {esc(item.title)}")
        lines.append("")
        lines.append("The Developer work queue in the web workspace is still browser storage — no server list to read.")
        stats = self.queue.stats() if self.queue else {}
        by_status = stats.get("by_status") or {}
        lines += [
            "",
            f"<b>Research jobs engine</b> (<code>{esc(stats.get('backend') or '—')}</code>): "
            f"<code>{stats.get('total') or 0}</code> jobs · <code>{stats.get('workers') or 0}</code> workers.",
        ]
        if by_status:
            for status, total in sorted(by_status.items()):
                lines.append(f"<code>{esc(status):<10}</code> <code>{total}</code>")
        else:
            lines.append("<i>No research job has been submitted in this process.</i>")
        chart = generate_bars_chart_png(
            "Data work queue by status",
            list(by_work_status.keys()), [float(value) for value in by_work_status.values()],
            "Items", horizontal=True, value_fmt="{:.0f}",
        )
        await self.send_media_group(chat_id, [("tasks", chart)] if chart else [], caption=text_card(
            "🗂 Work queues", "DATA QUEUE + JOBS", lines,
            source="work_items store · jobs engine", next_commands="/jobs · /researchstatus · /backtests"))
