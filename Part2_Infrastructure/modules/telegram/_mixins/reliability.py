"""DevOps / SRE — SLIs, dependency planes, breakers, traces and the runbook."""

from __future__ import annotations

import math

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.registry import COMMAND_SPECS
from modules.telegram_charts import generate_bars_chart_png, generate_gate_ladder_png, generate_status_grid_png


class ReliabilityMixin:
    # ------------------------------------------------------------------ #
    # DevOps / SRE — SLIs, planes, breakers, traces and the runbook
    # ------------------------------------------------------------------ #
    async def _cmd_sli(self, args, chat_id, actor) -> None:
        """Service-level indicators, including the native core's nanosecond clock."""
        from modules import metrics

        requests = metrics.request_latency_summary()
        decision = metrics.decision_latency_summary()
        core = metrics.core_latency_summary()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        uptime = _finite(health.get("uptime_s")) or 0.0
        state = self.gateway.state() if self.gateway else None
        connected = sum(1 for feed in feeds if feed.get("connected"))
        lines = [
            f"Engine uptime  <code>{uptime:.0f}s</code>",
            f"Kill switch    <code>{'ACTIVE' if state and state.kill_switch_active else 'inactive'}</code>",
            f"Feeds          <code>{connected}/{len(feeds)} connected</code>",
            "",
            "<b>Request latency (ms, windowed)</b>",
        ]
        routes = sorted(requests.items(), key=lambda item: item[1].get("p99", 0.0), reverse=True)[:6]
        if routes:
            for route, stats in routes:
                lines.append(
                    f"<code>{esc(route)[:20]:<20}</code> p50 <code>{_number(stats.get('p50'), 0)}</code>"
                    f" · p95 <code>{_number(stats.get('p95'), 0)}</code>"
                    f" · p99 <code>{_number(stats.get('p99'), 0)}</code>"
                    f" · err <code>{int(stats.get('errors') or 0)}</code>"
                )
        else:
            lines.append("<i>No request timed in the current window.</i>")
        lines += ["", "<b>Decision latency</b>"]
        if int(decision.get("samples") or 0):
            lines.append(
                f"in-process <code>{_number(decision.get('p50'), 0)}</code>/"
                f"<code>{_number(decision.get('p99'), 0)}</code> µs p50/p99 · "
                f"<code>{int(decision.get('samples'))}</code> timed"
            )
        else:
            lines.append("<i>No decision timed yet — an empty record, not zero latency.</i>")
        if int(core.get("samples") or 0):
            lines.append(
                f"native core <code>{_number(core.get('p50'), 0)}</code>/"
                f"<code>{_number(core.get('p99'), 0)}</code> ns p50/p99 · "
                f"<code>{int(core.get('samples'))}</code> timed"
            )
        else:
            lines.append("<i>Native core idle here — its nanosecond clock records only while the compiled engine runs.</i>")
        charts: list[tuple[str, bytes]] = []
        p99_chart = generate_bars_chart_png(
            "Route p99 (ms)", [route[:18] for route, _ in routes],
            [_finite(stats.get("p99")) for _, stats in routes],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        if p99_chart:
            charts.append(("sli-p99", p99_chart))
        error_chart = generate_bars_chart_png(
            "Route errors (window)", [route[:18] for route, _ in routes],
            [float(stats.get("errors") or 0) for _, stats in routes],
            "Errors", colours=["#ff5252"] * len(routes), horizontal=True, value_fmt="{:.0f}",
        )
        if error_chart:
            charts.append(("sli-errors", error_chart))
        await self.send_media_group(chat_id, charts, caption=text_card(
            "📟 Service levels", "MEASURED" if routes else "NO SAMPLES", lines,
            source="metrics + TCA + gateway", next_commands="/latency · /reliability · /circuits"))

    async def _cmd_planes(self, args, chat_id, actor) -> None:
        """Provider, platform and evidence dependency planes as a status grid."""
        from modules import research

        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        connected = sum(1 for feed in feeds if feed.get("connected"))
        state = self.gateway.state() if self.gateway else None
        audit_health = self.audit.health() if self.audit else {}
        queue_stats = self.queue.stats() if self.queue else {}
        mirror_on = bool(getattr(settings, "supabase_url", "") or "")

        def feed_status() -> str:
            if not feeds:
                return "unknown"
            if connected == len(feeds):
                return "ok"
            return "degraded" if connected else "down"

        rows = [
            ("Provider", "OpenBB", "ok" if openbb.get("ok") else "down", str(openbb.get("provider") or "—")),
            ("Provider", "Feeds", feed_status(), f"{connected}/{len(feeds)} live"),
            ("Platform", "Gateway", "ok" if state is not None else "unknown", "risk engine"),
            ("Platform", "Kill switch", "down" if state and state.kill_switch_active else "ok",
             "engaged" if state and state.kill_switch_active else "clear"),
            ("Platform", "Queue", "ok" if queue_stats.get("backend") else "unknown", str(queue_stats.get("backend") or "—")),
            ("Evidence", "Audit", "ok" if audit_health.get("available") else "down", str(audit_health.get("backend") or "—")),
            ("Evidence", "Mirror", "ok" if mirror_on else "unknown", "supabase" if mirror_on else "local only"),
        ]
        lines = [
            f"<code>{esc(plane):<9}</code> <code>{esc(component):<12}</code> <code>{esc(status.upper())}</code> · {esc(detail)}"
            for plane, component, status, detail in rows
        ]
        lines.append("<i>Three planes: who feeds the desk, what runs it, and what records it. A degraded or down tile is where an incident would surface.</i>")
        chart = generate_status_grid_png("Dependency planes", rows)
        await self.send_media_group(chat_id, [("planes", chart)] if chart else [], caption=text_card(
            "🧯 Dependency planes", "TOPOLOGY", lines,
            source="OpenBB + TCA + gateway + audit", next_commands="/sli · /circuits · /status"))

    async def _cmd_circuits(self, args, chat_id, actor) -> None:
        """The risk breakers as a headroom ladder. Reads state, moves nothing."""
        state = self.gateway.state() if self.gateway else None
        if state is None:
            await self.send_message(chat_id, text_card(
                "🧨 Circuit breakers", "NO GATEWAY",
                ["The risk gateway is not attached in this process."],
                source="gateway", next_commands="/status"))
            return
        limits = state.limits
        ladder: list[tuple[str, float | None, float | None, bool]] = []
        dd = _finite(state.daily_drawdown_pct)
        dd_cap = _finite(limits.get("max_daily_drawdown_pct"))
        if dd is not None and dd_cap:
            ladder.append(("daily_drawdown", dd, dd_cap, dd < dd_cap))
        rate_cap = _finite(limits.get("max_orders_per_sec"))
        if rate_cap:
            ladder.append(("rate_limit", _finite(state.orders_last_second) or 0.0, rate_cap, (state.orders_last_second or 0) < rate_cap))
        working_cap = _finite(getattr(settings, "max_working_orders", None))
        if working_cap:
            ladder.append(("working_book", float(state.working_orders), working_cap, state.working_orders < working_cap))
        gross_cap = _finite(limits.get("max_gross_exposure_usd"))
        if gross_cap:
            ladder.append(("gross_exposure", _finite(state.gross_exposure) or 0.0, gross_cap, (state.gross_exposure or 0) <= gross_cap))

        lines = [
            f"Kill switch  {'❌' if state.kill_switch_active else '✅'} <code>{'ENGAGED' if state.kill_switch_active else 'clear'}</code>",
            f"Reduce-only  {'⚠️' if state.reduce_only else '✅'} <code>{esc(state.reduce_only_source)}</code>",
            f"Drawdown     <code>{_percent(state.daily_drawdown_pct)}</code> of <code>{_percent(dd_cap)}</code>"
            f" · budget used <code>{_percent(state.drawdown_budget_used_pct)}</code>",
            f"Order rate   <code>{_number(state.orders_last_second)}</code>/s of <code>{_number(rate_cap, 0)}</code>",
            f"Working book <code>{state.working_orders}</code> of <code>{_number(working_cap, 0)}</code>",
            f"Gross        <code>{_money(state.gross_exposure)}</code> of <code>{_money(gross_cap)}</code>",
            "Watchdog     <code>5s monitor loop</code> · re-checks drawdown and feed health",
            "",
            "<i>The drawdown breaker is automatic; the kill switch and reduce-only are latched by an operator or the monitor loop. This reads their headroom and moves nothing.</i>",
        ]
        chart = generate_gate_ladder_png("Breaker headroom (% of limit)", ladder)
        status = "ENGAGED" if state.kill_switch_active else ("REDUCE-ONLY" if state.reduce_only else "CLEAR")
        await self.send_media_group(chat_id, [("circuits", chart)] if chart else [], caption=text_card(
            "🧨 Circuit breakers", status, lines,
            source="gateway risk state", next_commands="/risk · /gates · /remediation"))

    async def _cmd_traces(self, args, chat_id, actor) -> None:
        """Recent audit events merged with web outages, each tagged by origin."""
        from modules.web_telemetry import get_web_ops

        count = self._limit(args, 0, 12, 30)
        events = self.audit.recent_events(count) if self.audit else []
        view = get_web_ops().view()
        merged: list[tuple[str, str, str]] = []
        for event in events:
            merged.append(("audit", str(event.get("ts") or "")[11:19],
                           f"{event.get('event')} · {str(event.get('detail') or '')[:80]}"))
        for outage in view.outages:
            merged.append(("web", "", f"outage {outage.provider} · {outage.note[:60]}"))
        if not merged:
            await self.send_message(chat_id, text_card(
                "🧵 Traces", "NO RECORDS",
                ["No audit events and no web outages to merge — an empty trace, not a silent one."],
                source="audit + web-ops", next_commands="/incidents · /events · /providers"))
            return
        icon = {"audit": "🗄", "web": "🌐"}
        lines = [
            f"{icon.get(origin, '•')} <code>{esc(origin):<5}</code> <code>{esc(when or '—')}</code> {esc(text)}"
            for origin, when, text in merged[:count]
        ]
        lines.append("<i>Two origins in one stream: gateway audit rows and web-reported outages, each tagged so a reader never mistakes one for the other.</i>")
        await self.send_message(chat_id, text_card(
            "🧵 Traces", f"{len(merged)} ENTRIES", lines,
            source="audit + web-ops ledger", next_commands="/incidents · /events · /providers"))

    async def _cmd_remediation(self, args, chat_id, actor) -> None:
        """The five typed controls, their scope, and the current risk state.

        No control buttons on purpose: a control is typed and confirmed, never
        tapped, so this card carries only reads and refuses to offer a shortcut
        the challenge flow deliberately withholds.
        """
        state = self.gateway.state() if self.gateway else None
        controls = [spec for spec in COMMAND_SPECS if spec.category == "Controls"]
        scope = {
            "halt": "book-wide or per-symbol kill switch",
            "resume": "release the kill switch",
            "flatten": "close every open position through the gates",
            "reduceonly": "accept only risk-reducing orders",
            "resetbook": "reset the paper book and session accounting",
        }
        lines = [
            "<b>The five typed controls</b>",
            "Each needs the separate <code>TELEGRAM_CONTROL_USER_IDS</code> allow-list and a single-use code. "
            "They are typed, never tapped — this card carries no buttons on purpose.",
        ]
        for spec in controls:
            purpose = scope.get(spec.name, spec.description.split("·", 1)[-1].strip())
            lines.append(f"<code>/{esc(spec.name)}</code> — {esc(purpose)}")
        lines += ["", "<b>Live state</b>"]
        if state is not None:
            halted = f" · {esc(', '.join(state.halted_symbols))}" if state.halted_symbols else ""
            lines.append(f"Kill switch <code>{'ENGAGED' if state.kill_switch_active else 'clear'}</code>{halted}")
            lines.append(f"Reduce-only <code>{esc(state.reduce_only_source)}</code>")
        else:
            lines.append("<i>Gateway not attached.</i>")
        await self.send_message(chat_id, text_card(
            "🛠 Remediation", "TYPED CONTROLS", lines,
            source="command registry + gateway state", next_commands="/circuits · /risk · /status"))

    async def _cmd_webops(self, args, chat_id, actor) -> None:
        """The web telemetry ledger the /providers card only summarises."""
        from modules.web_telemetry import get_web_ops

        view = get_web_ops().view()
        lines = [
            f"Instances <code>{len(view.instances)}</code> · window <code>{view.window_seconds:.0f}s</code>",
            "",
            "<b>Per-key latency</b>",
        ]
        p99_labels: list[str] = []
        p99_values: list[float | None] = []
        if view.latency:
            for key_view in view.latency:
                ordered = sorted(sample.ms for sample in key_view.samples)
                total = len(ordered)
                errors = sum(1 for sample in key_view.samples if not sample.ok)
                p50 = ordered[min(total - 1, max(0, math.ceil(0.50 * total) - 1))] if total else None
                p99 = ordered[min(total - 1, max(0, math.ceil(0.99 * total) - 1))] if total else None
                rate = errors / total if total else 0.0
                lines.append(
                    f"<code>{esc(key_view.key)[:18]:<18}</code> p50 <code>{_number(p50, 0)}</code>"
                    f" · p99 <code>{_number(p99, 0)}</code> · err <code>{_percent(rate, 0)}</code>"
                    f" · n=<code>{total}</code>"
                )
                p99_labels.append(key_view.key[:18])
                p99_values.append(p99)
        else:
            lines.append("<i>No web instance has synced latency into this gateway — the browser fills it within a few polls.</i>")
        if view.outages:
            lines += ["", "<b>Outages</b>"]
            for outage in view.outages[:6]:
                lines.append(f"⚠️ <code>{esc(outage.provider)}</code> · {esc(outage.note)[:60]}")
        if view.quota:
            lines += ["", "<b>Quota</b>"]
            for entry in view.quota[:6]:
                lines.append(f"<code>{esc(entry.provider)}</code>/{esc(entry.window)} spent <code>{entry.spent}</code>")
        chart = generate_bars_chart_png(
            "Web key p99 (ms)", p99_labels, [_finite(value) for value in p99_values],
            "p99 (ms)", horizontal=True, value_fmt="{:.0f}ms",
        )
        await self.send_media_group(chat_id, [("webops", chart)] if chart else [], caption=text_card(
            "🌐 Web telemetry", f"{len(view.instances)} INSTANCES", lines,
            source="web-ops ledger · get_web_ops().view()", next_commands="/providers · /reliability · /sli"))
