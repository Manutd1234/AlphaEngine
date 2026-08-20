"""Quant developer — readiness, CI gates, the API surface and the repo."""

from __future__ import annotations

from config import settings
from modules.telegram.format import esc, text_card
from modules.telegram.introspect import (
    _VERIFY_GATES,
    _codebase_line_counts,
    _committed_route_counts,
    _openapi_operations_by_tag,
)
from modules.telegram.keyboards import _CALLBACK_ARG_RE, cb, kb
from modules.telegram_charts import generate_bars_chart_png, generate_status_grid_png


class DeveloperMixin:
    # ------------------------------------------------------------------ #
    # Quant developer — readiness, CI gates, the API surface and the repo
    # ------------------------------------------------------------------ #
    async def _cmd_readiness(self, args, chat_id, actor) -> None:
        """Launch readiness across the runtime, the contract and the backends."""
        from modules.decision_core import ENGINE as decision_engine

        routes = _committed_route_counts()
        op_count = int(sum(count for _, count in routes)) if routes else 0
        audit_health = self.audit.health() if self.audit else {}
        try:
            import matplotlib  # noqa: F401
            mpl_ok = True
        except Exception:
            mpl_ok = False
        engine = str(decision_engine)
        rows = [
            ("Runtime", "Version", "ok", f"{settings.version}/{settings.environment}"),
            ("Runtime", "Charts", "ok" if mpl_ok else "down", "matplotlib" if mpl_ok else "missing"),
            ("Runtime", "Decision core", "ok" if engine == "native" else "degraded", engine),
            ("Contract", "OpenAPI", "ok" if op_count else "unknown", f"{op_count} ops" if op_count else "no snapshot"),
            ("Backends", "Audit", "ok" if audit_health.get("available") else "down", str(audit_health.get("backend") or "—")),
            ("Backends", "Telegram", "ok" if self.mode != "disabled" else "degraded", str(self.mode)),
        ]
        lines = [
            f"<code>{esc(plane):<9}</code> <code>{esc(component):<13}</code> <code>{esc(status.upper())}</code> · {esc(detail)}"
            for plane, component, status, detail in rows
        ]
        lines.append("<i>Launch readiness across the runtime, the committed contract and the live backends — a green board is necessary, not sufficient; CI remains the authority.</i>")
        chart = generate_status_grid_png("Launch readiness", rows)
        await self.send_media_group(chat_id, [("readiness", chart)] if chart else [], caption=text_card(
            "🚀 Readiness", "MEASURED", lines,
            source="settings + OpenAPI snapshot + backends", next_commands="/cicd · /apis · /codebase"))

    async def _cmd_cicd(self, args, chat_id, actor) -> None:
        """The verify gates a deploy must pass — named, never counted."""
        lines = [f"<b>{len(_VERIFY_GATES)} verify gates</b> a deploy must pass before it ships:", ""]
        for gate in _VERIFY_GATES:
            lines.append(f"✓ <code>{esc(gate)}</code>")
        lines += ["", "<i>These are the gates committed in <code>.github/workflows/deploy.yml</code>, "
                       "named rather than counted — not the verdict of the last run, which GitHub Actions remains the authority for.</i>"]
        await self.send_message(chat_id, text_card(
            "⚙️ CI/CD gates", f"{len(_VERIFY_GATES)} GATES", lines,
            source="committed CI configuration", next_commands="/readiness · /developer · /apis"))

    async def _cmd_apis(self, args, chat_id, actor) -> None:
        """The committed OpenAPI surface by tag, or one tag's operations."""
        by_tag = _openapi_operations_by_tag()
        if not by_tag:
            await self.send_message(chat_id, text_card(
                "🧭 API surface", "NO SNAPSHOT",
                ["The committed <code>tools/openapi.json</code> is not in this image, or it lists no operations."],
                source="OpenAPI snapshot", next_commands="/readiness · /developer"))
            return

        requested = args[0] if args else None
        resolved = next((tag for tag in by_tag if tag.lower() == str(requested).lower()), None) if requested else None
        if resolved:
            operations = sorted(by_tag[resolved])
            lines = [f"<b>{esc(resolved)}</b> · <code>{len(operations)}</code> operations"]
            for method, path, summary in operations[:20]:
                lines.append(f"<code>{esc(method):<6}</code> <code>{esc(path)}</code>" + (f" — {esc(summary)}" if summary else ""))
            await self.send_message(chat_id, text_card(
                f"🧭 API · {esc(resolved)}", f"{len(operations)} OPS", lines,
                source="committed OpenAPI snapshot", next_commands="/apis · /readiness"),
                reply_markup=kb([[("All tags", cb("apis"))]]))
            return

        counts = sorted(((tag, len(ops)) for tag, ops in by_tag.items()), key=lambda row: -row[1])
        lines = [f"<b>{sum(n for _, n in counts)}</b> operations across <b>{len(counts)}</b> tags", ""]
        for tag, total in counts:
            lines.append(f"<code>{esc(tag):<18}</code> <code>{total}</code>")
        buttons = [(tag[:20], cb("apis", tag)) for tag, _ in counts if _CALLBACK_ARG_RE.fullmatch(tag)]
        rows = [buttons[index:index + 3] for index in range(0, len(buttons), 3)]
        chart = generate_bars_chart_png(
            "API operations by tag", [tag for tag, _ in counts], [float(total) for _, total in counts],
            "Operations", horizontal=True, value_fmt="{:.0f}",
        )
        await self.send_media_group(chat_id, [("apis", chart)] if chart else [], caption=text_card(
            "🧭 API surface", f"{len(counts)} TAGS", lines,
            source="committed OpenAPI snapshot", next_commands="/readiness · /cicd"),
            reply_markup=kb(rows) if rows else None)

    async def _cmd_codebase(self, args, chat_id, actor) -> None:
        """Python file and line counts by area, walked from the source tree."""
        counts = _codebase_line_counts()
        lines = ["<b>AREA        FILES   LINES</b>"]
        for area, files, total_lines in counts:
            lines.append(f"<code>{esc(f'{area:<10}')}</code> <code>{files:>5}</code>  <code>{total_lines:>6,}</code>")
        lines += ["", "The container image ships only <code>main.py config.py celery_tasks.py worker.py "
                      "modules/ templates/ tools/</code> plus the compiled <code>_decision_core.so</code>, "
                      "and carries no git history."]
        chart = generate_bars_chart_png(
            "Lines of Python by area", [area for area, _, _ in counts],
            [float(total_lines) for _, _, total_lines in counts],
            "Lines", horizontal=True, value_fmt="{:,.0f}",
        )
        await self.send_media_group(chat_id, [("codebase", chart)] if chart else [], caption=text_card(
            "📦 Codebase", "STATIC SCAN", lines,
            source="os.walk over the source tree", next_commands="/apis · /readiness · /developer"))
