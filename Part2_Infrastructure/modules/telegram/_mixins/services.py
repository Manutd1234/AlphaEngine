"""Reliability ▸ Services — gateway components and per-provider circuit posture."""

from __future__ import annotations

import time
from typing import Any

from modules.telegram.format import _number, _percent, esc, text_card
from modules.telegram.keyboards import cb, kb
from modules.telegram_charts import generate_bars_chart_png, generate_status_grid_png

_GLYPH = {"ok": "🟢", "degraded": "🟡", "down": "🔴", "unknown": "⚪"}
_PLATFORM_GRID = {"nominal": "ok", "degraded": "degraded", "critical": "down", "halted": "down"}

# ``modules.web_telemetry.RETENTION_MS`` is fifteen minutes and matches the web
# console's own read window, so both sides describe the same "now".
_WINDOW = "the last 15 minutes"
# The rate above which the web's provider digest calls a vendor degraded. It is
# a presentation policy in the browser tier and is not published to this
# gateway, so it is named here rather than pretended to have been measured.
_DEGRADED_ERROR_RATE = 0.05


# --------------------------------------------------------------------------- #
# One row per gateway component: (plane, component, state, headline, detail)
# --------------------------------------------------------------------------- #
def _market_data_row(market_data: Any) -> tuple[str, str, str, str, str]:
    real = [feed for feed in market_data.feeds if not feed.synthetic]
    connected = sum(1 for feed in real if feed.connected)
    books = [book for feed in real for book in feed.symbols]
    stale = sum(1 for book in books if book.stale)
    detail = (
        f"{connected} of {len(real)} venue feeds connected, {stale} of {len(books)} books stale"
        if real else "No live venue feeds observed"
    )
    if market_data.synthetic_active:
        detail += "; synthetic fallback active"
    if not market_data.enabled:
        detail += "; the venue feed engine is switched off in this deployment, so these books are unobserved rather than failing"
    grid = {"nominal": "ok", "degraded": "degraded", "critical": "down", "disabled": "unknown"}
    status = str(market_data.status)
    return ("Gateway", "Market data", grid.get(status, "unknown"), status.replace("_", " "), detail)


def _risk_row(risk: Any) -> tuple[str, str, str, str, str]:
    grid = {"nominal": "ok", "reduce_only": "degraded", "halted": "down"}
    status = str(risk.status)
    detail = (
        f"{risk.working_orders} working orders, "
        f"{_percent(risk.drawdown_budget_used_pct, 0)} of the drawdown budget used"
    )
    if risk.halted_symbols:
        detail += f"; halted: {', '.join(risk.halted_symbols)}"
    return ("Gateway", "Pre-trade risk", grid.get(status, "unknown"), status.replace("_", " "), detail)


def _queue_row(queue: Any) -> tuple[str, str, str, str, str]:
    active = int(queue.by_status.get("queued", 0)) + int(queue.by_status.get("running", 0))
    lagging = bool(queue.broker_configured) and str(queue.backend) != "celery"
    slots = "slot" if queue.workers == 1 else "slots"
    detail = f"{active} queued or running; {queue.workers} configured worker {slots}"
    if lagging:
        detail += "; a broker is configured but this process is not running the celery backend"
    return ("Gateway", "Research queue", "degraded" if lagging else "ok", str(queue.backend), detail)


def _audit_row(audit: Any) -> tuple[str, str, str, str, str]:
    return (
        "Evidence", "Audit store", "ok" if audit.available else "down",
        "available" if audit.available else "unavailable",
        f"{audit.backend}; append-only decision evidence",
    )


def _mirror_row(mirror: Any) -> tuple[str, str, str, str, str]:
    """Three states, deliberately not collapsed — only the last is a fault."""
    if mirror is None:
        return ("Evidence", "Postgres mirror", "unknown", "not published",
                "This gateway build does not publish mirror counters — an absent reading, not a failing mirror.")
    if not mirror.configured:
        return ("Evidence", "Postgres mirror", "unknown", "not configured",
                "DuckDB stays authoritative; the mirror is optional durability.")
    parts = [f"{mirror.written} mirrored", f"{mirror.queued} queued"]
    if mirror.dropped:
        parts.append(f"{mirror.dropped} DROPPED — the bounded queue drops rather than blocking the order path, "
                     "so the Postgres blotter is silently incomplete")
    if mirror.failed:
        parts.append(f"{mirror.failed} failed")
    if mirror.last_error_kind:
        parts.append(f"last error: {mirror.last_error_kind}")
    faulty = bool(mirror.dropped) or bool(mirror.last_error_kind)
    headline = "lossy" if mirror.dropped else ("streaming" if mirror.running else "idle")
    return ("Evidence", "Postgres mirror", "degraded" if faulty else "ok", headline, "; ".join(parts))


def _timing_lines(snapshot: Any) -> list[str]:
    """Gateway build and decision timing. Quantiles of nothing are not zeros."""
    lines = [f"Build       <code>v{esc(snapshot.version)}</code> · <code>{esc(snapshot.environment)}</code>"]
    decision = snapshot.decision_latency
    if decision is None:
        lines.append("<i>Decision timing is not published by this gateway build — a missing reading, not zero latency.</i>")
        return lines
    if decision.samples > 0 and decision.p99_us is not None:
        tail = f"{_number(decision.p999_us, 1)} µs" if decision.samples >= 1000 else "— (needs 1,000 samples)"
        lines += [
            f"Decision    p99 <code>{_number(decision.p99_us, 1)} µs</code>"
            f" · p50 <code>{_number(decision.p50_us, 1)} µs</code>",
            f"            p99.9 <code>{tail}</code> · max <code>{_number(decision.max_us, 1)} µs</code>"
            f" · n=<code>{decision.samples:,}</code> since start",
        ]
    else:
        lines += [
            "Decision    p99 <code>—</code>",
            "<i>No order has been timed yet — an empty record, not zero latency.</i>",
        ]
    if decision.core_p99_ns is not None:
        lines.append(
            f"Core        p99 <code>{_number(decision.core_p99_ns, 0)} ns</code>"
            f" · p50 <code>{_number(decision.core_p50_ns, 0)} ns</code>"
            f" · max <code>{_number(decision.core_max_ns, 0)} ns</code>"
            f" · engine <code>{esc(decision.engine)}</code>"
        )
        if decision.core_self_test_samples:
            lines.append(f"<i>{decision.core_self_test_samples:,} core samples are the startup self-measure on a "
                         "synthetic two-venue book; the decision µs figure never includes them.</i>")
    elif str(decision.engine) == "python":
        lines.append("Core        <code>—</code> · <i>Python engine, no native core. A different span from the "
                     "microsecond one; it never borrows those numbers.</i>")
    else:
        lines.append("Core        <code>—</code> · <i>No native-core histogram yet — nothing measured, not zero.</i>")
    return lines


def _component_block(snapshot: Any) -> tuple[list[str], list[tuple[str, str, str, str]]]:
    rows = [
        _market_data_row(snapshot.market_data),
        _risk_row(snapshot.risk),
        _queue_row(snapshot.queue),
        _audit_row(snapshot.audit),
        _mirror_row(snapshot.supabase),
    ]
    platform = str(snapshot.status)
    lines = [
        f"Platform    {_GLYPH[_PLATFORM_GRID.get(platform, 'unknown')]} <code>{esc(platform.upper())}</code>",
        f"Observed    <code>{esc(snapshot.observed_at.strftime('%H:%M:%S'))} UTC</code>"
        f" · stale after <code>{_number(snapshot.stale_after_seconds, 0)}s</code>",
        *_timing_lines(snapshot),
        "<i>Assembled in this process at read time, so it cannot be stale: the console's fresh/stale/"
        "unreachable states describe its HTTP hop to this gateway, not this read.</i>",
        "",
        "<b>Quant infrastructure components</b>",
    ]
    for _, component, state, headline, detail in rows:
        lines.append(f"{_GLYPH.get(state, '⚪')} <code>{esc(component):<15}</code> <code>{esc(headline.upper())}</code>")
        lines.append(f"    <i>{esc(detail)}</i>")
    lines.append("<i>Queue workers are configured slots, not heartbeats. This is one gateway-process snapshot; "
                 "fleet aggregation and order-to-ack timing belong in external telemetry.</i>")
    lines.append("<i>A notification-transport fault is deliberately not folded in above: the bot is not on the "
                 "order path, so it reports on its own plane (/planes) and never degrades this verdict.</i>")
    return lines, [(plane, component, state, headline) for plane, component, state, headline, _ in rows]


# --------------------------------------------------------------------------- #
# Circuit posture — the web-ops ledger, and what it deliberately cannot say
# --------------------------------------------------------------------------- #
def _provider_signal(total: int, failures: int) -> tuple[str, str, str]:
    """Mirrors the console's provider digest: only calls that actually failed
    count against a vendor, so a trace on the wrong asset class cannot mark a
    healthy provider as degraded."""
    plural = "call" if total == 1 else "calls"
    if failures >= total:
        return "down", "FAILING", f"All {total} {plural} failed in {_WINDOW}."
    if failures / total > _DEGRADED_ERROR_RATE:
        return "degraded", "DEGRADED", f"{failures} of {total} calls failed in {_WINDOW}."
    return "ok", "HEALTHY", f"{total - failures} of {total} {plural} succeeded in {_WINDOW}."


def _ledger_providers(view: Any) -> list[tuple[str, int, int]]:
    """(key, calls, failures) per provider id the web's dispatch layer recorded.

    ``plane:*`` keys are the console's own transport probes, not vendors, and
    are excluded so a gateway round trip cannot be read as a provider call.
    """
    rows: list[tuple[str, int, int]] = []
    for key_view in view.latency:
        if str(key_view.key).startswith("plane:"):
            continue
        total = len(key_view.samples)
        if not total:
            continue
        rows.append((str(key_view.key), total, sum(1 for sample in key_view.samples if not sample.ok)))
    return sorted(rows, key=lambda row: (-row[2], -row[1], row[0]))


def _circuit_block(view: Any, openbb: dict[str, Any], rows: list[tuple[str, int, int]]) -> list[str]:
    lines = [
        "",
        "<b>Circuit posture · per provider</b>",
        f"OpenBB probe <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>"
        f" · provider <code>{esc(openbb.get('provider') or '—')}</code>",
        "<i>OpenBB is the one vendor probed automatically; probing every paid API on each refresh would "
        "spend quota, so the rest are only visible once they have been called.</i>",
    ]
    if rows:
        for key, total, failures in rows[:8]:
            state, word, detail = _provider_signal(total, failures)
            lines.append(f"{_GLYPH[state]} <code>{esc(key)[:16]:<16}</code> <code>{word}</code> · {esc(detail)}")
    else:
        lines.append("<i>No provider call has been synced into this gateway's ledger, so no vendor can be "
                     "classified — not observed, which is neither idle nor healthy.</i>")
    now_ms = time.time() * 1000.0
    forced = [outage for outage in view.outages if outage.expires_at > now_ms]
    if forced:
        lines.append("")
        lines.append("<b>Circuits held open by an operator</b>")
        for outage in forced[:5]:
            remaining = max(0.0, (outage.expires_at - now_ms) / 1000.0)
            lines.append(f"🔴 <code>{esc(outage.provider)[:16]:<16}</code> clears in "
                         f"<code>{_number(remaining, 0)}s</code> · {esc(outage.note)[:60]}")
    if view.quota:
        lines.append("")
        lines.append("<b>Quota spent this window</b>")
        for entry in view.quota[:5]:
            lines.append(f"<code>{esc(entry.provider)[:16]:<16}</code> <code>{entry.spent}</code>"
                         f" in <code>{esc(entry.window)}</code>")
        lines.append("<i>Spend only. The per-provider limit and reserve live in the browser tier and are not "
                     "synced here, so no remaining-quota figure is quoted rather than guessed.</i>")
    lines.append("<i>Transport healthy, payload suspect? A closed circuit and a fast call say nothing about "
                 "whether the bytes were right — that question belongs to the data-quality ledger (/dataquality).</i>")
    lines.append(f"<i>Ledger merged from {len(view.instances)} web instance(s) over a "
                 f"{_number(view.window_seconds, 0)}s window. A vendor is called degraded above a "
                 f"{_percent(_DEGRADED_ERROR_RATE, 0)} failure rate — the console's own policy, restated here.</i>")
    return lines


def _breaker_notes() -> list[str]:
    return [
        "",
        "<b>How a provider circuit recovers</b>",
        "<code>CLOSED</code> calls flow → consecutive failures → <code>OPEN</code> provider skipped → "
        "cooldown ends → <code>HALF-OPEN</code> next call probes → probe succeeds → <code>CLOSED</code>.",
        "An operator's “Close all circuits” jumps straight back to <code>CLOSED</code>.",
        "<i>There is no half-open → open edge: a failed probe restarts the count from one — slower to "
        "re-open, but it cannot get stuck open.</i>",
        "<i>Half-open is a moment, not a resting state: dispatch retires an elapsed cooldown on the next "
        "call that touches the provider, so a permanent zero there is correct.</i>",
        "<i>A closure is not a fix — one successful probe closes a circuit that may re-open three "
        "failures later.</i>",
        "<i>The failure count, the trip threshold and the cooldown remaining live in the browser tier's "
        "per-instance provider runtime and reset on redeploy. None is synced to this gateway, so no "
        "closed/open/half-open tally and no threshold are quoted here — a missing reading, not a "
        "healthy desk.</i>",
    ]


class ServicesMixin:
    async def _cmd_services(self, args, chat_id, actor) -> None:
        """Reliability ▸ Services — the gateway's own components and the circuit posture per provider.

        Two sources, reported side by side so each degrades on its own: the
        process-local operations snapshot, and the merged web-ops ledger. A
        missing snapshot is a missing measurement, never a set of failures.
        """
        from modules import research
        from modules.operations import build_operations_snapshot
        from modules.supabase_mirror import get_mirror
        from modules.web_telemetry import get_web_ops

        footer = kb([
            [("↻ Refresh", cb("services")), ("⌂ Menu", cb("menu"))],
            [("Planes", cb("planes")), ("Providers", cb("providers")), ("Risk breakers", cb("circuits"))],
        ])
        absent = [label for label, collaborator in (
            ("market-data engine", self.tca), ("risk gateway", self.gateway),
            ("job queue", self.queue), ("audit log", self.audit),
        ) if collaborator is None]
        snapshot = None
        reason = f"not attached in this process: {', '.join(absent)}" if absent else ""
        if not absent:
            try:
                snapshot = build_operations_snapshot(
                    tca=self.tca, gateway=self.gateway, queue=self.queue,
                    audit=self.audit, bot=self, mirror=get_mirror(),
                )
            except Exception as exc:  # noqa: BLE001 — reported, never guessed at
                reason = f"the snapshot build raised {type(exc).__name__}"

        grid_rows: list[tuple[str, str, str, str]] = []
        if snapshot is None:
            lines = [
                "<b>Quant infrastructure components</b>",
                "<i>No gateway ops snapshot is arriving, so its market-data, risk, audit and queue "
                "components cannot be observed from here. That is a missing measurement, not a set "
                "of failures.</i>",
                f"<i>Why: {esc(reason)}.</i>",
            ]
        else:
            lines, grid_rows = _component_block(snapshot)

        view = get_web_ops().view()
        openbb = await research.openbb_status_async()
        ledger = _ledger_providers(view)
        lines += _circuit_block(view, openbb, ledger)
        lines += _breaker_notes()
        for key, total, failures in ledger[:4]:
            grid_rows.append(("Providers", key[:12], _provider_signal(total, failures)[0], f"{total} calls"))

        charts = [
            ("services", generate_status_grid_png("Services & circuits", grid_rows)),
            ("provider-calls", generate_bars_chart_png(
                "Provider calls · last 15 min", [key[:14] for key, _, _ in ledger[:8]],
                [float(total) for _, total, _ in ledger[:8]], "Calls",
                horizontal=True, value_fmt="{:.0f}")),
        ]
        status = str(snapshot.status).upper() if snapshot is not None else "COMPONENTS NOT OBSERVED"
        await self.send_media_group(
            chat_id, [(name, blob) for name, blob in charts if blob],
            caption=text_card(
                "🧩 Services &amp; circuits", status, lines,
                source="operations snapshot + web-ops ledger + OpenBB probe",
                next_commands="/planes · /providers · /circuits · /webops"),
            reply_markup=footer)
