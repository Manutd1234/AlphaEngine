"""The pushed risk rules, their thresholds, and the edge-triggered alert."""

from __future__ import annotations

import time

from config import settings
from modules.telegram._common import log
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card


class AlertsMixin:
    #: The pushed risk rules. Each is (key, label, unit, how to read the
    #: observation off the desk). The threshold for each lives in settings, and
    #: a threshold of zero means the rule is off — not "fires at zero".
    RISK_RULE_LABELS: dict[str, str] = {
        "daily_drawdown": "Daily drawdown",
        "var95": "VaR 95, 1 day",
        "gross_exposure": "Gross exposure",
        "concentration": "Book concentration",
    }

    def _risk_thresholds(self) -> dict[str, float]:
        return {
            "daily_drawdown": settings.alert_drawdown_pct,
            "var95": settings.alert_var95_pct,
            "gross_exposure": settings.alert_gross_exposure_pct,
            "concentration": settings.alert_concentration_pct,
        }

    def _risk_observations(self) -> dict[str, float | None]:
        """What the three in-memory rules currently read.

        Arithmetic over state the gateway already holds — no fetch, no await —
        which is what lets this run at the alert interval. VaR is absent here
        on purpose and is evaluated on its own slower cadence in ``_risk_tick``.

        A rule whose inputs are missing reads ``None`` and is skipped, never
        coerced to zero: "we cannot measure the book" and "the book is flat"
        are different states and only one of them is safe to not alert on.
        """
        if not self.gateway:
            return {}
        state = self.gateway.state()
        equity = _finite(state.equity)
        observations: dict[str, float | None] = {
            "daily_drawdown": _finite(state.daily_drawdown_pct),
        }
        gross = _finite(state.gross_exposure)
        observations["gross_exposure"] = (
            gross / equity if gross is not None and equity else None
        )
        notionals = [
            abs(_finite(getattr(p, "notional", None)) or 0.0) for p in (state.positions or [])
        ]
        total = sum(notionals)
        observations["concentration"] = (max(notionals) / total) if notionals and total else None
        return observations

    async def _risk_var95(self) -> float | None:
        """1-day 95 % historical VaR over equity, or None when unmeasurable."""
        from modules.quant_risk import historical_var

        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = _finite(report["equity"]["current"])
        if not positions or not equity:
            return None
        hv = historical_var(positions, returns, equity)
        if hv is None:
            return None
        loss = _finite(getattr(hv, "var95", None))
        return (loss / equity) if loss is not None and equity else None

    async def _risk_tick(self) -> None:
        thresholds = self._risk_thresholds()
        observations = self._risk_observations()

        # VaR costs a bar fetch per held symbol, so it runs on its own clock
        # rather than the alert interval — and only when its rule is enabled.
        if thresholds.get("var95", 0.0) > 0:
            now = time.monotonic()
            if now >= self._risk_var_due:
                self._risk_var_due = now + max(60.0, settings.alert_risk_interval_s * 15)
                try:
                    observations["var95"] = await self._risk_var95()
                except Exception as exc:  # a provider outage is not an alert
                    log.info("risk alert: VaR unmeasurable (%s)", type(exc).__name__)

        for key, threshold in thresholds.items():
            if threshold <= 0:
                continue
            observed = observations.get(key)
            if observed is None:
                continue
            breached = observed >= threshold
            if breached == self._risk_state.get(key, False):
                continue
            self._risk_state[key] = breached
            await self._push_risk_alert(key, observed, threshold, breached)

    async def _cmd_probe(self, args, chat_id, actor) -> None:
        """The palette's probe presets, as a command that needs no arguments.

        /tca already does this and already defaults every argument — that is
        what the usage strings were corrected to say. This is the same walk
        under the name a reader reaches for, so "what would this cost" does not
        require knowing that the answer lives under a three-letter acronym.
        """
        symbol, notional, side = self._trade_args(args)
        if self.tca is None:
            raise ValueError("no execution engine is attached on this deployment")
        report = self.tca.tca_report(symbol, side, notional)
        if not report.per_venue:
            await self.send_message(chat_id, text_card(
                f"🎯 {symbol} probe", "NO LIVE BOOK",
                ["No venue is streaming this instrument, so there is nothing to walk."],
                source="TCA engine", next_commands="/feedstatus · /venues"))
            return
        best = min(report.per_venue, key=lambda e: e.slippage_bps if e.slippage_bps is not None else 1e9)
        lines = [
            f"Probe   <code>{side} · {_money(notional)}</code>",
            f"Mid     <code>{_number(report.consolidated_mid)}</code>",
            f"Best    <code>{esc(best.venue)}</code> at <code>{_number(best.slippage_bps, signed=True)} bps</code>",
        ]
        if report.smart_route:
            lines.append(
                f"Routed  <code>{_number(report.smart_route_slippage_bps, signed=True)} bps</code>"
                f" across <code>{len(report.smart_route)}</code>"
            )
        await self.send_message(chat_id, text_card(
            f"🎯 {symbol} probe", "SYNTHETIC" if report.synthetic else "LIVE", lines,
            source="Cross-venue TCA engine",
            next_commands=f"/tca {symbol} {notional:g} {side} · /liquidity {symbol}"))

    async def _cmd_engine(self, args, chat_id, actor) -> None:
        """Which decision engine is running, and what it measured itself at.

        The desk publishes this on /health and on the Developer tab. It is a
        question worth being able to ask from a phone, because the answer
        "python" on a deployment that expected "native" is a silent
        degradation — the gateway starts fine either way.
        """
        from modules.decision_core import snapshot as decision_core_snapshot

        core_ns = getattr(self.gateway, "last_decision_core_ns", None) if self.gateway else None
        status = self.gateway.decision_core_status() if self.gateway else decision_core_snapshot()
        lines = [
            f"Engine    <code>{esc(status['effective'])}</code> "
            f"(configured <code>{esc(status['configured'])}</code>, "
            f"selected <code>{esc(status['selected'])}</code>)",
            f"Core      <code>{f'{core_ns} ns' if core_ns else 'not yet measured'}</code>"
            " — the compiled battery only, not the whole decision",
        ]
        if status["fallback_reason"] is not None:
            lines.append(
                f"Fallback  <code>{esc(status['fallback_reason'])}</code> · "
                f"<code>{status['fallback_total']}</code> order(s)"
            )
        if status["build_id"] is not None:
            lines.append(
                f"Build     <code>{esc(status['build_id'])}</code> · ABI "
                f"<code>{status['abi_version']}</code> · <code>{status['decide_argument_count']}</code> args"
            )
        await self.send_message(chat_id, text_card(
            "⚙️ Decision engine", str(status["effective"]).upper(), lines,
            source="modules.decision_core + gateway self-measure",
            next_commands="/status · /ops"))

    async def _cmd_refresh(self, args, chat_id, actor) -> None:
        """Re-read the desk now rather than waiting for the next poll."""
        if not self.gateway:
            raise ValueError("no risk gateway is attached on this deployment")
        state = self.gateway.state()
        observations = self._risk_observations()
        lines = [
            f"Equity    <code>{_money(_finite(state.equity))}</code>",
            f"Day P&L   <code>{_money(_finite(state.daily_pnl))}</code>",
            f"Drawdown  <code>{_percent(observations.get('daily_drawdown'))}</code>",
            f"Positions <code>{len(state.positions)}</code>"
            f" · halted <code>{'YES' if state.kill_switch_active else 'no'}</code>",
        ]
        await self.send_message(chat_id, text_card(
            "🔄 Desk snapshot", "HALTED" if state.kill_switch_active else "READ NOW", lines,
            source="Gateway risk state, read on demand",
            next_commands="/portfolio · /risk · /live on"))

    async def _cmd_thresholds(self, args, chat_id, actor) -> None:
        """The rules, their limits, and what each reads right now."""
        thresholds = self._risk_thresholds()
        observations = self._risk_observations()
        lines: list[str] = []
        for key, threshold in thresholds.items():
            label = self.RISK_RULE_LABELS.get(key, key)
            if threshold <= 0:
                # Off is a state worth printing. A rule silently absent from
                # this list reads as a rule that is passing.
                lines.append(f"{esc(label)} <code>off</code>")
                continue
            observed = observations.get(key)
            if key == "var95" and observed is None:
                reading = "on its own slower clock"
            elif observed is None:
                reading = "unmeasurable"
            else:
                reading = f"{_percent(observed)} now"
            breached = self._risk_state.get(key, False)
            mark = "▲" if breached else "●"
            lines.append(
                f"{mark} {esc(label)} <code>{_percent(threshold)}</code> — {esc(reading)}"
            )
        lines.append(f"Evaluated every <code>{settings.alert_risk_interval_s:g}s</code>")
        await self.send_message(chat_id, text_card(
            "📏 Risk alert thresholds",
            "ARMED" if any(t > 0 for t in thresholds.values()) else "ALL OFF",
            lines,
            source="Deployment settings + gateway risk state",
            next_commands="/risk · /limits · /role"))

    def _risk_line(self, key: str, observed: float, threshold: float) -> list[str]:
        label = self.RISK_RULE_LABELS.get(key, key)
        return [
            f"{esc(label)} <code>{_percent(observed)}</code> against <code>{_percent(threshold)}</code>",
            f"Rule <code>{esc(key)}</code> · interval <code>{settings.alert_risk_interval_s:g}s</code>",
        ]

    #: Which desk roles a risk breach is addressed to. A chat with no role set
    #: is NOT excluded — see _risk_alert_targets.
    RISK_ALERT_ROLES: frozenset[str] = frozenset({"pm", "risk"})

    def _risk_alert_targets(self) -> list[str]:
        """Chats a risk breach should reach.

        Two rules, in this order.

        A deployment that configures TELEGRAM_ALERT_CHAT_IDS has named its
        escalation path explicitly, and a per-chat preference must not quietly
        narrow it. That list wins, unfiltered, exactly as it does for every
        other pushed alert.

        Otherwise the breach goes to the roles whose job it is — pm and risk —
        plus every chat that has not set a role at all. That last clause is the
        important one: a role is opt-in, and a chat subscribed before roles
        existed keeps receiving what it received yesterday. The alternative is
        a schema migration that silently stops paging someone, which nobody
        discovers until the day it matters.
        """
        if settings.telegram_alert_chat_ids:
            return self._alert_targets()
        return [
            subscriber["chat_id"]
            for subscriber in self._subscribers()
            if not (subscriber.get("role") or "") or subscriber.get("role") in self.RISK_ALERT_ROLES
        ]

    async def _push_risk_alert(self, key: str, observed: float, threshold: float, breached: bool) -> None:
        label = self.RISK_RULE_LABELS.get(key, key)
        lines = self._risk_line(key, observed, threshold)
        message = text_card(
            f"⚠️ {label} over limit" if breached else f"✅ {label} back within limit",
            "THRESHOLD BREACH" if breached else "RECOVERED",
            lines,
            source="Gateway risk state",
            next_commands="/risk · /limits · /thresholds",
        )
        for chat_id in self._risk_alert_targets():
            # Re-checked immediately before the network call, like the
            # liquidity watch: an allow-list revocation must not race a tick.
            if not self._delivery_allowed(chat_id):
                continue
            await self.send_message(chat_id, message)
            self.alerts_sent += 1
