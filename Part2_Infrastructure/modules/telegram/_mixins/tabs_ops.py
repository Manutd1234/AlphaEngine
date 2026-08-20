"""8 Desk Role Tabs, continued — data, reliability and developer."""

from __future__ import annotations

from config import settings
from modules.telegram.format import _finite, _number, esc, text_card
from modules.telegram.introspect import _VERIFY_GATES, _committed_route_counts
from modules.telegram.keyboards import _tab_footer, cb
from modules.telegram_charts import generate_bars_chart_png


class TabsOpsMixin:
    async def _cmd_tab_data(self, args, chat_id, actor) -> None:
        from modules import research

        feed_health = self.tca.health() if self.tca else {}
        feeds = feed_health.get("feeds", [])
        openbb = await research.openbb_status_async()
        lines = [
            f"OpenBB service <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>",
            f"Market feeds   <code>{sum(1 for f in feeds if f.get('connected'))}/{len(feeds)} connected</code>",
        ]
        if feed_health.get("synthetic_active"):
            lines.append("Book source    <code>SYNTHETIC — generated, not a venue</code>")
        for feed in feeds:
            lines.append(
                f"<code>{esc(str(feed.get('venue') or feed.get('name') or '?')):<9}</code>"
                f" <code>{'connected' if feed.get('connected') else 'down'}</code>"
                f" · <code>{_number(feed.get('update_rate_hz'), 2)} Hz</code>"
            )

        chart = generate_bars_chart_png(
            "Feed update rate by venue (Hz, observed)",
            [str(feed.get("venue") or feed.get("name") or "?") for feed in feeds],
            [_finite(feed.get("update_rate_hz")) or 0.0 for feed in feeds],
            "Updates per second",
            colours=['#00e676' if feed.get("connected") else '#ff5252' for feed in feeds],
            value_fmt="{:.2f}",
        )
        if not chart:
            lines.append("<i>No feed is reporting an update rate, so no chart.</i>")

        await self.send_media_group(chat_id, [("feeds", chart)] if chart else [], caption=text_card(
            "📊 Data operations", "READY" if openbb.get("ok") else "DEGRADED", lines,
            source="TCA engine + OpenBB", next_commands="/openbb · /feedstatus",
        ), reply_markup=_tab_footer(
            "data",
            [
                ("Feeds", cb("feedstatus")),
                ("OpenBB", cb("openbb")),
                ("Incidents", cb("incidents")),
                ("Events", cb("events")),
            ],
            refresh=cb("data"),
        ))

    async def _cmd_tab_reliability(self, args, chat_id, actor) -> None:
        rows = self._latency_rows()
        feed_health = self.tca.health() if self.tca else {}
        uptime = feed_health.get("uptime_s") or 0.0
        lines = [f"Engine uptime  <code>{uptime:.0f}s</code>"]
        if rows:
            for route, p50, p95, p99, samples in rows:
                lines.append(
                    f"<code>{esc(route)[:22]:<22}</code> p50 <code>{p50:.0f}</code>"
                    f" · p95 <code>{p95:.0f}</code> · p99 <code>{p99:.0f}</code> ms"
                    f" · n=<code>{samples}</code>"
                )
        else:
            lines.append("<i>No request has been timed in the current window, so there is nothing to plot.</i>")

        charts: list[tuple[str, bytes]] = []
        p99_chart = generate_bars_chart_png(
            "Route latency p99 (ms, observed)",
            [route[:18] for route, *_ in rows],
            [p99 for _, _, _, p99, _ in rows],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        if p99_chart:
            charts.append(("p99", p99_chart))
        sample_chart = generate_bars_chart_png(
            "Requests timed per route (window)",
            [route[:18] for route, *_ in rows],
            [float(samples) for *_, samples in rows],
            "Samples", horizontal=True, value_fmt="{:,.0f}",
        )
        if sample_chart:
            charts.append(("samples", sample_chart))

        await self.send_media_group(chat_id, charts, caption=text_card(
            "🛡️ Reliability", "MEASURED" if rows else "NO SAMPLES", lines,
            source="Gateway request middleware", next_commands="/status · /incidents",
        ), reply_markup=_tab_footer(
            "reliability",
            [
                ("Ops", cb("ops")),
                ("Venues", cb("venues")),
                ("Incidents", cb("incidents")),
                ("Status", cb("status")),
            ],
            refresh=cb("reliability"),
        ))

    async def _cmd_tab_developer(self, args, chat_id, actor) -> None:
        from modules import research

        routes = _committed_route_counts()
        openbb = await research.openbb_status_async()
        audit_health = self.audit.health() if self.audit else {}
        queue_stats = self.queue.stats() if self.queue else {}
        lines = [
            f"Build          <code>{esc(settings.version)}</code> · <code>{esc(settings.environment)}</code>",
            "",
            "<b>Deployment units</b>",
            "Risk gateway   <code>FastAPI · this process, port 8000</code>",
            "Web desk       <code>Next.js · separate origin</code>",
            f"OpenBB service <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code> · stateless",
            "",
            "<b>Backends</b>",
            f"Audit          <code>{esc(audit_health.get('backend') or '—')}</code> · "
            f"<code>{'available' if audit_health.get('available') else 'unavailable'}</code>",
            f"Job queue      <code>{esc(queue_stats.get('backend') or '—')}</code> · "
            f"<code>{queue_stats.get('total', 0)} jobs</code>",
            "",
            f"Verify gates   <code>{len(_VERIFY_GATES)}</code> must pass before a deploy ships",
        ]
        lines.extend(f"<code>{esc(gate)}</code>" for gate in _VERIFY_GATES)
        if routes:
            lines.append(
                f"API surface    <code>{int(sum(n for _, n in routes))}</code> operations "
                f"across <code>{len(routes)}</code> modules"
            )
        else:
            lines.append("API surface    <code>snapshot not in this image</code>")
        lines.append(
            "<i>These are the gates committed in this repository, not the conclusion "
            "of the last run — GitHub Actions remains the authority for that.</i>"
        )
        chart = generate_bars_chart_png(
            "API surface by module (committed OpenAPI snapshot)",
            [tag for tag, _ in routes],
            [count for _, count in routes],
            "Operations", horizontal=True, value_fmt="{:,.0f}",
        ) if routes else None
        await self.send_media_group(chat_id, [("ci", chart)] if chart else [], caption=text_card(
            "💻 Developer topology", "THREE UNITS", lines,
            source="Committed CI configuration + live backends", next_commands="/version · /lineage · /commands",
        ), reply_markup=_tab_footer(
            "developer",
            [
                ("Version", cb("version")),
                ("Lineage", cb("lineage")),
                ("Ops", cb("ops")),
                ("Status", cb("status")),
            ],
            refresh=cb("developer"),
        ))
