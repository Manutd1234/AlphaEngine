"""Delivery — the broadcast fan-out and the finished-backtest push."""

from __future__ import annotations

from config import settings
from modules.telegram._common import _HTML_TAG_RE, log
from modules.telegram.format import _number, _percent, esc, text_card


class DeliveryMixin:
    async def broadcast(
        self, severity: str, message: str, roles: frozenset[str] | None = None,
    ) -> None:
        """Risk hook: normalize every pushed update into the textual card UI.

        ``roles`` addresses the message to the desk roles it is for. ``None``
        keeps the historical behaviour — every alert subscriber — and is what
        every existing caller gets.

        Role routing already existed and this path skipped it:
        `_risk_alert_targets` honours `subscribers.role`, and `broadcast` called
        `_alert_targets`, which never reads it. So a data-quality escalation
        went to every chat while a risk breach went to the two roles that own
        it. A chat with no role still receives everything, exactly as
        `_risk_alert_targets` decided.
        """
        if not self.enabled:
            log.info("[alert:%s] %s", severity, _HTML_TAG_RE.sub("", message).replace("\n", " ")[:200])
            return
        targets = self._alert_targets() if roles is None else self._role_targets(roles)
        if not targets:
            log.warning("Telegram alert dropped; no configured subscribers")
            return
        severity_key = severity.lower()
        icon = {"critical": "🛑", "error": "🔴", "warning": "⚠️", "info": "ℹ️"}.get(severity_key, "ℹ️")
        rendered = text_card(f"{icon} AlphaEngine operational alert", severity_key.upper(), [message], source="Risk gateway event hook", next_commands="/risk · /portfolio · /events")
        for chat_id in targets:
            central = str(chat_id) in settings.telegram_alert_chat_ids
            if not self._delivery_allowed(chat_id, require_alerts=not central):
                continue
            await self.send_message(chat_id, rendered)
            self.alerts_sent += 1

    async def push_backtest_result(self, record) -> None:
        """Completion update for jobs submitted outside Telegram — now with charts.

        The job result already carries a rendered ``equity_curve_png`` and
        ``heatmap_png``; this used to throw them away and send "TEXT RESULT".
        Both are decoded (skipping either that is None) and delivered as an
        album with the same text riding as the caption.
        """
        if not self.enabled or record.kind != "backtest":
            return
        chat_id = record.meta.get("chat_id")
        if not chat_id:
            return
        central = str(chat_id) in settings.telegram_alert_chat_ids
        if not self._delivery_allowed(chat_id, require_alerts=not central):
            log.warning("Telegram backtest update dropped; recipient is not currently authorised")
            return
        if record.status != "succeeded":
            await self.send_message(chat_id, text_card("❌ Backtest update", "FAILED", [f"Job <code>{esc(record.job_id)}</code>", f"Error <code>{esc(str(record.error)[:240])}</code>"], source="Research job queue", next_commands="/job " + str(record.job_id)))
            return
        result = record.result or {}
        best = result.get("best") or {}
        request = result.get("request") or {}
        symbol = (str(request.get("symbol") or record.meta.get("symbol") or "").upper()) or "BTCUSDT"
        lines = [
            f"Job <code>{esc(record.job_id)}</code>",
            f"Study <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Best params <code>{best.get('fast')}/{best.get('slow')}</code> from <code>{result.get('combos_tested')}</code> combinations",
            f"Sharpe <code>{_number(best.get('sharpe'))}</code> · Return <code>{_percent(best.get('total_return'), signed=True)}</code> · MaxDD <code>{_percent(best.get('max_drawdown'))}</code>",
            f"DSR <code>{_number(result.get('deflated_sharpe_ratio'), 3)}</code> · OOS Sharpe <code>{_number(result.get('walk_forward_oos_sharpe'))}</code>",
            f"Verdict <code>{esc(result.get('dsr_verdict') or '—')}</code>",
        ]
        charts: list[tuple[str, bytes]] = []
        for name, key in (("equity-curve", "equity_curve_png"), ("heatmap", "heatmap_png")):
            blob = self._decode_b64png(result.get(key))
            if blob:
                charts.append((name, blob))
        await self.send_media_group(chat_id, charts, caption=text_card(
            "🧪 Backtest completed", "RESULT", lines,
            source="Research job queue",
            next_commands=f"/walkforward {symbol} · /stability {symbol} · /overfit {symbol}",
        ))
