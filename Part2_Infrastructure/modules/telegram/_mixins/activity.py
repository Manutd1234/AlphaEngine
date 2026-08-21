"""Execution ▸ Activity — the order record, the decision tape and the alert feed."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from modules.telegram.format import _finite, _money, _number, esc, text_card
from modules.telegram.keyboards import _choice_row, cb, kb
from modules.telegram_charts import generate_bars_chart_png

# The web section is one seg of two panes — Blotter (the record) and Tape &
# alerts (the stream) — with the blotter split three ways inside the first. The
# six views below are those panes flattened, and `/activity` opens on the record
# for the reason ACTIVITY_PANES gives for opening on the blotter: the record is
# the half that can be counted on.
_VIEWS = [("Record", "record"), ("Fills", "fills"), ("Unfilled", "unfilled"), ("Active", "active"), ("Tape", "tape"), ("Alerts", "alerts")]
_VIEW_NAMES = {value for _, value in _VIEWS}

# AlertFeed's ranking, unchanged: severity decides whether a row is read now or
# later, and "critical" and "error" are one urgency under two names.
_SEVERITY_RANK = {"critical": 3, "error": 3, "warning": 2, "warn": 2, "info": 1}
_SEVERITY_ICON = {3: "🛑", 2: "⚠️", 1: "ℹ️"}

_SOURCE = "DuckDB audit log · gateway"
_NEXT = "/blotter · /working · /events"

# The sentence the split exists to make readable, carried on the views that show
# both halves — a chat client has no layout to imply it with.
_SPLIT_NOTE = "<i>The record is the append-only store, read on demand and complete. The tape is a stream and drops silently while it reconnects, so it is watched, never counted on.</i>"


def _stamp(value: Any) -> datetime | None:
    """One audit timestamp, aware and in UTC; None when it will not parse — never "now", which would date an unreadable row to this instant and drag the reported window with it."""
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _span(seconds: float) -> str:
    """A duration in the largest unit that keeps it readable."""
    if seconds < 90:
        return f"{seconds:.0f}s"
    if seconds < 5400:
        return f"{seconds / 60:.0f}m"
    if seconds < 172800:
        return f"{seconds / 3600:.1f}h"
    return f"{seconds / 86400:.1f}d"


def _status_of(row: dict[str, Any]) -> str:
    """WORKING / FILLED / CANCELLED / EXPIRED / REJECTED for one audit row.

    The fallback mirrors ``toBlotterRow``: rows predating the order lifecycle carry no status, and back then an accepted order *was* a filled order — exact for legacy rows rather than a guess.
    """
    recorded = str(row.get("status") or "").strip().upper()
    return recorded or ("FILLED" if row.get("accepted") else "REJECTED")


def _gates_of(row: dict[str, Any]) -> list[str]:
    """Every gate that refused this order. The gateway stores them comma-joined."""
    return [gate.strip() for gate in str(row.get("rejected_by") or "").split(",") if gate.strip()]


def _window_lines(rows: list[dict[str, Any]]) -> list[str]:
    """The window the figures cover — stated, never left to be assumed "recent"."""
    stamps = sorted(stamp for stamp in (_stamp(row.get("ts")) for row in rows) if stamp is not None)
    if not stamps:
        return ["Window    <code>—</code>", "<i>No row in hand carries a readable timestamp, so the window these figures cover is unknown — not zero-length.</i>"]
    first, last = stamps[0], stamps[-1]
    age = max(0.0, (datetime.now(timezone.utc) - last).total_seconds())
    lines = [
        f"Window    <code>{first.strftime('%d %b %H:%M:%S')} → {last.strftime('%H:%M:%S')} UTC</code> · span <code>{_span((last - first).total_seconds())}</code>",
        f"Newest    <code>{_span(age)} ago</code> · <code>{len(stamps)}</code> of <code>{len(rows)}</code> rows are stamped",
    ]
    if len(stamps) < len(rows):
        lines.append(f"<i>{len(rows) - len(stamps)} row(s) carry no readable stamp and sit outside the window above.</i>")
    return lines


def _economics_lines(filled: list[dict[str, Any]]) -> list[str]:
    """What the fills cost, and how much of that cost was never measured."""
    notionals = [value for value in (_finite(row.get("notional")) for row in filled) if value is not None]
    fees = [value for value in (_finite(row.get("fee_usd")) for row in filled) if value is not None]
    slips = [value for value in (_finite(row.get("slippage_bps")) for row in filled) if value is not None]
    lines = [
        f"Notional  <code>{_money(sum(notionals)) if notionals else '—'}</code> · sized on <code>{len(notionals)}</code> of <code>{len(filled)}</code> fills",
        f"Fees      <code>{_money(sum(fees)) if fees else '—'}</code> · measured on <code>{len(fees)}</code>",
        f"Slippage  <code>{_number(sum(slips) / len(slips), 2, signed=True) if slips else '—'} bps</code> mean · measured on <code>{len(slips)}</code>",
    ]
    missing = len(filled) - len(slips)
    if missing:
        lines.append(f"<i>{missing} fill(s) carry no slippage measure, so the cost above is a lower bound — an unmeasured execution, not a free one.</i>")
    return lines


def _latency_lines(rows: list[dict[str, Any]]) -> list[str]:
    """Decision latency over the window, or the reason there is none."""
    timed = [value for value in (_finite(row.get("latency_ms")) for row in rows) if value is not None]
    if not timed:
        return ["Latency   <code>—</code>", "<i>No decision in this window was timed — an empty record, not zero latency.</i>"]
    return [f"Latency   mean <code>{_number(sum(timed) / len(timed))} ms</code> · max <code>{_number(max(timed))} ms</code> · timed on <code>{len(timed)}</code> of <code>{len(rows)}</code>"]


def _gate_counts(rejected: list[dict[str, Any]]) -> list[tuple[str, int]]:
    """Distinct gate codes with counts, derived from the rows in hand — never a hardcoded list, so a live gateway's own gate names appear unchanged."""
    counts = Counter(gate for row in rejected for gate in _gates_of(row))
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def _gate_lines(rejected: list[dict[str, Any]]) -> list[str]:
    """Which gate refused, counted — the answer this half of the view exists for."""
    counts = _gate_counts(rejected)
    if not counts:
        if not rejected:
            return ["Gates     <code>—</code> · <i>nothing was refused in this window.</i>"]
        return [f"<i>{len(rejected)} refusal(s) name no gate: the outcome is on record, the check vector is not.</i>"]
    lines = ["<b>Refused by</b>"]
    lines += [f"<code>{esc(gate[:24]):<24}</code> <code>{hits}</code>" for gate, hits in counts[:8]]
    lines.append("<i>Every gate that refused, not only the first: one order can trip several, and naming one would imply the others passed.</i>")
    return lines


def _gate_chart(rejected: list[dict[str, Any]]) -> bytes | None:
    counts = _gate_counts(rejected)[:8]
    return generate_bars_chart_png(
        "Refusals by gate", [gate[:18] for gate, _ in counts], [float(hits) for _, hits in counts],
        "Refusals", colours=["#ff5252"] * len(counts), horizontal=True, value_fmt="{:.0f}",
    )


def _tag_line(rows: list[dict[str, Any]]) -> str:
    """Strategy tags with counts, plus the untagged remainder under its sentinel."""
    counts = Counter(str(row.get("strategy")) for row in rows if row.get("strategy"))
    untagged = sum(1 for row in rows if not row.get("strategy"))
    parts = [f"{esc(tag)} <code>{hits}</code>" for tag, hits in sorted(counts.items())[:4]]
    if untagged:
        parts.append(f"∅ untagged <code>{untagged}</code>")
    return "Tags      " + (" · ".join(parts) if parts else "<code>—</code>")


def _stream_lines(health: dict[str, Any]) -> list[str]:
    """The tape's own state, in the vocabulary ``describeTape`` uses."""
    if not health.get("configured"):
        return ["Tape      <code>UNCONFIGURED</code>", "<i>Realtime is not configured in this deployment, so nothing is being streamed. That is not a fault, and it says nothing about the record, which is read from the store either way.</i>"]
    lines = [f"Tape      <code>{'DRAINING' if health.get('running') else 'IDLE'}</code> · mirrored <code>{health.get('written')}</code> · queued <code>{health.get('queued')}</code>"]
    lost = (health.get("failed") or 0) + (health.get("dropped") or 0)
    if lost:
        kind = health.get("last_error_kind")
        lines.append(f"Lost      <code>{health.get('failed')}</code> failed · <code>{health.get('dropped')}</code> dropped{(' · ' + esc(str(kind))) if kind else ''}")
        lines.append(f"<i>{lost} decision(s) never reached the mirror, so a browser tape watching it missed them. All of them are in the record — which is why the record is the record.</i>")
    return lines


class ActivityMixin:
    """Execution ▸ Activity: the record, the stream, and the alerts beside them."""

    def _activity_footer(self, view: str) -> dict[str, Any]:
        rows = [_choice_row("activity", _VIEWS[:3], view), _choice_row("activity", _VIEWS[3:], view)]
        return kb([*rows, [("↻ Refresh", cb("activity", view)), ("⌂ Menu", cb("menu"))]])

    def _activity_orders(self, count: int) -> list[dict[str, Any]]:
        """Recent decisions, over-fetched: the counts describe more than one page."""
        return self.audit.recent_orders(max(count * 4, 40)) if self.audit else []

    def _audit_reachable(self) -> bool:
        return bool(self.audit) and bool((self.audit.health() or {}).get("available"))

    async def _activity_empty(self, chat_id: str, title: str, subject: str, footer: dict[str, Any]) -> None:
        """The two empty states the web panel is careful to keep apart."""
        if not self._audit_reachable():
            await self.send_message(chat_id, text_card(
                title, "NO SOURCE",
                ["No audit log is reachable here, so there is nothing to list.",
                 "<i>An unreachable store is not a quiet desk. No count printed under this line would be true, so none is printed.</i>"],
                source=_SOURCE, next_commands="/status · /ops"), reply_markup=footer)
            return
        await self.send_message(chat_id, text_card(
            title, "EMPTY RECORD",
            [f"No {subject} on record for this gateway.",
             "<i>An empty record, not zero activity — the store is readable and holds nothing.</i>"],
            source=_SOURCE, next_commands=_NEXT), reply_markup=footer)

    async def _cmd_activity(self, args, chat_id, actor) -> None:
        """Execution ▸ Activity — six views behind one command: the section's two panes, and the blotter's three views inside the first of them."""
        view = args[0].lower() if args and args[0].lower() in _VIEW_NAMES else "record"
        footer = self._activity_footer(view)
        try:
            count = self._limit(args, 1, 8, 25) if len(args) > 1 else 8
        except ValueError as exc:
            await self.send_message(chat_id, text_card(
                "🎞 Execution · Activity", "BAD ARGUMENT",
                [esc(str(exc)), "Use <code>/activity fills 10</code> — a view name and a count of 1 to 25."],
                source=_SOURCE, next_commands="/activity · /blotter"), reply_markup=footer)
            return
        renderers = {
            "record": self._activity_record, "fills": self._activity_fills,
            "unfilled": self._activity_unfilled, "active": self._activity_active,
            "tape": self._activity_tape, "alerts": self._activity_alerts,
        }
        await renderers[view](chat_id, count, footer)

    async def _activity_record(self, chat_id: str, count: int, footer: dict[str, Any]) -> None:
        """The whole section in one card: window, outcomes, cost, gates, tape, alerts."""
        from modules.supabase_mirror import get_mirror

        rows = self._activity_orders(count)
        if not rows:
            await self._activity_empty(chat_id, "🎞 Activity · record", "decisions", footer)
            return
        outcomes = Counter(_status_of(row) for row in rows)
        filled = [row for row in rows if _status_of(row) == "FILLED"]
        unfilled = [row for row in rows if _status_of(row) != "FILLED"]
        rejected = [row for row in unfilled if not row.get("accepted")]
        working = self.gateway.list_working(None) if self.gateway else []
        events = self.audit.recent_events(40) if self.audit else []
        severe = sum(1 for row in events if _SEVERITY_RANK.get(str(row.get("severity") or "info").lower(), 1) >= 2)
        outcome_pairs = outcomes.most_common()

        lines = _window_lines(rows) + [
            f"Decisions <code>{len(rows)}</code> newest on record · " + " · ".join(f"{esc(name.title())} <code>{hits}</code>" for name, hits in outcome_pairs),
            f"Unfilled  <code>{len(unfilled)}</code> · refused <code>{len(rejected)}</code> · accepted then never filled <code>{len(unfilled) - len(rejected)}</code>",
            "<i>Unfilled is status ≠ FILLED, the exact complement of a fill. A cancelled or expired order passed the gates, so counting it as a refusal would blame a gate that let it through.</i>",
            "",
            *_economics_lines(filled),
            *_latency_lines(rows),
            _tag_line(rows),
            "",
            *_gate_lines(rejected),
            "",
            f"Resting   <code>{len(working)}</code> on the book now — /activity active",
            f"Alerts    <code>{len(events)}</code> on record · <code>{severe}</code> at warning or above",
            _stream_lines(get_mirror().health())[0] + " — /activity tape",
            _SPLIT_NOTE,
        ]
        charts = [("outcomes", generate_bars_chart_png("Decisions by outcome", [name.title() for name, _ in outcome_pairs], [float(hits) for _, hits in outcome_pairs], "Orders", value_fmt="{:.0f}")), ("gates", _gate_chart(rejected))]
        await self.send_media_group(chat_id, [pair for pair in charts if pair[1]], caption=text_card(
            "🎞 Execution · Activity", f"{len(rows)} DECISIONS", lines,
            source=_SOURCE, next_commands="/activity fills · /activity tape · /blotter"), reply_markup=footer)

    async def _activity_fills(self, chat_id: str, count: int, footer: dict[str, Any]) -> None:
        """Executed, with the economics of the trade — price, size, venue, fee, slip."""
        rows = self._activity_orders(count)
        filled = [row for row in rows if _status_of(row) == "FILLED"]
        if not filled:
            if not rows:
                await self._activity_empty(chat_id, "✅ Activity · fills", "decisions", footer)
                return
            await self.send_message(chat_id, text_card(
                "✅ Activity · fills", "NO FILLS",
                [*_window_lines(rows), f"None of the <code>{len(rows)}</code> decisions in this window filled.",
                 "<i>Every one of them is in /activity unfilled with the gate or the status that explains it — an empty fills view is a finding, not a gap.</i>"],
                source=_SOURCE, next_commands="/activity unfilled · /working"), reply_markup=footer)
            return
        lines = [*_window_lines(rows), f"Showing   <code>{min(count, len(filled))}</code> of <code>{len(filled)}</code> fills in <code>{len(rows)}</code> decisions", ""]
        for row in filled[:count]:
            lines.append(f"✅ <code>{esc(str(row.get('ts') or '')[11:19])}</code> {esc(row.get('symbol'))} {esc(row.get('side'))} <code>{_money(row.get('notional'))}</code> · qty <code>{_number(row.get('quantity'), 4)}</code>")
            lines.append(f"   <code>{esc(row.get('venue') or '—')}</code> @ <code>{_number(row.get('fill_price'), 2)}</code> · fee <code>{_money(row.get('fee_usd'))}</code> · slip <code>{_number(row.get('slippage_bps'), 1, signed=True)} bps</code> · <code>{esc(row.get('strategy') or '∅ untagged')}</code>")
        lines += ["", *_economics_lines(filled), *_latency_lines(filled)]
        await self.send_message(chat_id, text_card(
            "✅ Activity · fills", f"{len(filled)} FILLED", lines,
            source=_SOURCE, next_commands="/activity unfilled · /slippage · /fees"), reply_markup=footer)

    async def _activity_unfilled(self, chat_id: str, count: int, footer: dict[str, Any]) -> None:
        """Why there was no trade — the gate that refused it, or the status that ended it."""
        rows = self._activity_orders(count)
        unfilled = [row for row in rows if _status_of(row) != "FILLED"]
        if not unfilled:
            if not rows:
                await self._activity_empty(chat_id, "🚫 Activity · unfilled", "decisions", footer)
                return
            await self.send_message(chat_id, text_card(
                "🚫 Activity · unfilled", "ALL FILLED",
                [*_window_lines(rows), f"Every one of the <code>{len(rows)}</code> decisions in this window filled.",
                 "<i>No gate refused anything, and nothing was cancelled or expired.</i>"],
                source=_SOURCE, next_commands="/activity fills"), reply_markup=footer)
            return
        rejected = [row for row in unfilled if not row.get("accepted")]
        lines = [*_window_lines(rows), f"Showing   <code>{min(count, len(unfilled))}</code> of <code>{len(unfilled)}</code> unfilled in <code>{len(rows)}</code> decisions", ""]
        for row in unfilled[:count]:
            gates = _gates_of(row)
            lines.append(f"{'❌' if not row.get('accepted') else '⏹'} <code>{esc(str(row.get('ts') or '')[11:19])}</code> {esc(row.get('symbol'))} {esc(row.get('side'))} <code>{_money(row.get('notional'))}</code> · <code>{esc(_status_of(row).lower())}</code>")
            lines.append(f"   gate <code>{esc(', '.join(gates)) if gates else '—'}</code> · {esc(str(row.get('reason') or 'no reason recorded')[:110])}")
            if not gates and not row.get("accepted"):
                lines.append("   <i>refused with no gate named — the outcome is on record, the check vector is not.</i>")
        lines += ["", *_gate_lines(rejected), "<i>A cancelled or expired order is here too: it was accepted and never filled, which is the same question with a different answer.</i>"]
        chart = _gate_chart(rejected)
        await self.send_media_group(chat_id, [("gates", chart)] if chart else [], caption=text_card(
            "🚫 Activity · unfilled", f"{len(unfilled)} UNFILLED", lines,
            source=_SOURCE, next_commands="/activity fills · /timeline · /rejections"), reply_markup=footer)

    async def _activity_active(self, chat_id: str, count: int, footer: dict[str, Any]) -> None:
        """The resting book — a different source and a different shape from a decision."""
        if not self.gateway:
            await self.send_message(chat_id, text_card(
                "📋 Activity · active", "NO SOURCE",
                ["No gateway in this deployment, so there is no resting book to read."],
                source="Risk gateway", next_commands="/status"), reply_markup=footer)
            return
        orders = self.gateway.list_working(None)
        if not orders:
            await self.send_message(chat_id, text_card(
                "📋 Activity · active", "NONE RESTING",
                ["Nothing is resting. Every accepted order so far filled at once.",
                 "<i>A resting order has no verdict, no fill and no latency — which is why it is read from the gateway and not from the audit record, where those columns would be dashes.</i>"],
                source="Risk gateway", next_commands="/activity fills · /working"), reply_markup=footer)
            return
        lines = [f"Resting   <code>{len(orders)}</code> · showing <code>{min(count, len(orders))}</code>", ""]
        for order in orders[:count]:
            distance = _finite(getattr(order, "distance_bps", None))
            age = _finite(getattr(order, "age_seconds", None))
            printed = (_number(distance, 1, signed=True) + " bps") if distance is not None else "— no mark"
            lines.append(f"<code>{esc(order.symbol)}</code> {esc(order.side)} <code>{esc(order.order_type)}</code> · qty <code>{_number(order.quantity, 4)}</code> @ <code>{_number(order.limit_price, 2)}</code>")
            lines.append(f"   committed <code>{_money(order.notional)}</code> · from mark <code>{printed}</code> · <code>{(_span(age) + ' old') if age is not None else '— age unrecorded'}</code> · <code>{esc(order.time_in_force)}</code>")
        lines += [
            "<i>Committed capital is quantity × limit price: a resting order is not free exposure. A null distance means nobody is quoting the instrument, which is the opposite claim to sitting at the touch.</i>",
            "<i>Cancelling or amending stays in the web blotter — a chat client should not reach into a live order queue.</i>",
        ]
        await self.send_message(chat_id, text_card(
            "📋 Activity · active", f"{len(orders)} RESTING", lines,
            source="Risk gateway", next_commands="/working · /activity record"), reply_markup=footer)

    async def _activity_tape(self, chat_id: str, count: int, footer: dict[str, Any]) -> None:
        """The stream pane — its state, its losses, and what it is not."""
        from modules.supabase_mirror import GATE_TO_VERDICT, get_mirror

        rows = self._activity_orders(count)
        lines = [
            *_stream_lines(get_mirror().health()),
            "<i>The browser tape is a Postgres subscription owned by the page, so the count of decisions seen this session is a figure of that browser session. This companion holds no channel and invents no number for it.</i>",
            "",
        ]
        if not rows:
            lines += ["No decision is on record to replay in tape order.", "<i>An empty record, not a dropped stream — the two are different claims.</i>"]
            await self.send_message(chat_id, text_card(
                "📡 Activity · tape", "NO DECISIONS", lines,
                source=_SOURCE, next_commands="/activity record · /status"), reply_markup=footer)
            return
        unmapped: set[str] = set()
        lines += [*_window_lines(rows), ""]
        for row in rows[:count]:
            gates = _gates_of(row)
            if row.get("accepted"):
                verdict = "accepted"
            elif gates:
                verdict = GATE_TO_VERDICT.get(gates[0], "unmapped_gate")
                unmapped.update(gate for gate in gates if gate not in GATE_TO_VERDICT)
            else:
                verdict = "rejected"
            lines.append(f"<code>{esc(str(row.get('ts') or '')[11:19])}</code> {esc(row.get('side'))} {esc(row.get('symbol'))} <code>{_money(row.get('notional'))}</code> · <code>{esc(verdict)}</code> · <code>{_number(row.get('latency_ms'))} ms</code>")
        if unmapped:
            lines.append(f"<i>{esc(', '.join(sorted(unmapped)))} carries no verdict label in the mirror's map, so a browser tape would show it as unmapped_gate. The record above names it properly.</i>")
        lines += ["", _SPLIT_NOTE, "<i>Replayed from the record in tape order, newest first — so it is complete, which the live tape it imitates cannot promise.</i>"]
        await self.send_message(chat_id, text_card(
            "📡 Activity · tape", f"{min(count, len(rows))} REPLAYED", lines,
            source=_SOURCE, next_commands="/activity alerts · /activity record"), reply_markup=footer)

    async def _activity_alerts(self, chat_id: str, count: int, footer: dict[str, Any]) -> None:
        """What the gateway decided unasked, severity first, actor always named."""
        events = self.audit.recent_events(max(count * 3, 30)) if self.audit else []
        if not events:
            if not self._audit_reachable():
                await self.send_message(chat_id, text_card(
                    "🔔 Activity · alerts", "NO SOURCE",
                    ["The event stream has no source in this deployment.",
                     "<i>Silence from an absent feed is not a quiet desk.</i>"],
                    source=_SOURCE, next_commands="/status · /ops"), reply_markup=footer)
                return
            await self.send_message(chat_id, text_card(
                "🔔 Activity · alerts", "QUIET",
                ["No risk events recorded yet — a quiet desk is the good case.",
                 "<i>The store is readable and holds nothing, which is a measurement rather than a silence.</i>"],
                source=_SOURCE, next_commands=_NEXT), reply_markup=footer)
            return
        ranked = [(_SEVERITY_RANK.get(str(row.get("severity") or "info").lower(), 1), row) for row in events]
        severe = sum(1 for rank, _ in ranked if rank >= 2)
        critical = sum(1 for rank, _ in ranked if rank >= 3)
        lines = [
            f"Events    <code>{len(events)}</code> on record · warning and above <code>{severe}</code> · critical <code>{critical}</code>",
            f"Showing   <code>{min(count, len(events))}</code>, newest first",
            "",
        ]
        for rank, row in ranked[:count]:
            lines.append(f"{_SEVERITY_ICON.get(rank, '•')} <code>{esc(str(row.get('ts') or '')[11:19])}</code> <b>{esc(str(row.get('event') or 'event').replace('_', ' '))}</b> · {esc(row.get('symbol') or 'ALL')} · by <code>{esc(row.get('actor') or 'system')}</code>")
            detail = str(row.get("detail") or "").strip()
            if detail:
                lines.append(f"   <code>{esc(detail[:140])}</code>")
        lines.append("<i>The actor is always shown: who halted this has a different answer for a human and for the circuit breaker, and the two demand different responses.</i>")
        await self.send_message(chat_id, text_card(
            "🔔 Activity · alerts", f"{severe} AT WARNING OR ABOVE" if severe else "ALL INFORMATIONAL",
            lines, source=_SOURCE, next_commands="/incidents · /activity record"), reply_markup=footer)
