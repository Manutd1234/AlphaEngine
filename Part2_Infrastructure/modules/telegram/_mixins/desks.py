"""Overview ▸ Desks — the seven quant-desk roles, their question and today's answer."""

from __future__ import annotations

from typing import Any

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.introspect import _VERIFY_GATES, _committed_route_counts
from modules.telegram.keyboards import _symbol_row, cb, kb
from modules.telegram_charts import generate_status_grid_png

# The workspace's role grid (web/components/overview/RoleCards.tsx), carried
# across in its own order: "an idea is researched, executed, held, and
# constrained — then the three roles that keep that possible". Each entry is
# (monogram, role, the role's question, the surface that answers it, the plane
# it sits on). The questions are the ones the coverage table in README §2 sets
# out per role; the launcher's own status strings are quoted in the readers
# below, beside the live figure they caveat.
_ROLES: tuple[tuple[str, str, str, str, str], ...] = (
    ("QR", "Quant Researcher", "Does this actually work?", "/research", "Decision loop"),
    ("EX", "Quant Trader", "Can I send this, and what will it cost?", "/execution", "Decision loop"),
    ("PM", "Portfolio Manager", "Where am I exposed, and what should I own?", "/portfolio", "Decision loop"),
    ("RM", "Risk Manager", "Is the model right, and will the limits hold?", "/risk", "Decision loop"),
    ("DE", "Data Engineer", "Can I trust this data?", "/data", "Platform"),
    ("SRE", "DevOps / SRE", "Is it healthy, and what do I do at 3am?", "/reliability", "Platform"),
    ("API", "Quant Developer", "Can I change this safely?", "/developer", "Platform"),
)

# The workspace withholds its p99 under twenty polls ("fewer than 20 polls
# measured") rather than printing a percentile drawn from a handful of samples.
# The companion answers the same question, so it holds the same floor.
_LATENCY_SAMPLE_FLOOR = 20


class DesksMixin:
    # ------------------------------------------------------------------ #
    # Overview ▸ Desks — the cross-role dashboard, in text
    # ------------------------------------------------------------------ #
    # One reader per role. Each returns (status, headline, note, tile) — the
    # status and the short tile are what the grid chart draws, the headline is
    # the figure answering the role's question, and the note is the caveat the
    # web card carries beside it. A reader that cannot measure its figure says
    # so and why, and returns "unknown"; none of them substitutes a zero.

    async def _desk_researcher(self, symbol: str) -> tuple[str, str, str, str]:
        """QR — the candidate on the desk, and whether it survived validation."""
        result = await self._latest_backtest_result(symbol)
        if result:
            request = result.get("request") or {}
            best = result.get("best") or {}
            oos = _finite(result.get("walk_forward_oos_sharpe"))
            verdict = esc(str(result.get("dsr_verdict") or "unscored").upper())
            headline = (
                f"<code>{esc(request.get('strategy') or '—')} {esc(best.get('fast'))}/{esc(best.get('slow'))}</code>"
                f" on <code>{esc(request.get('symbol') or symbol)}</code>"
                f" · Sharpe <code>{_number(best.get('sharpe'))}</code>"
                f" · DSR <code>{_number(result.get('deflated_sharpe_ratio'), 3)}</code>"
            )
            if oos is None:
                note = (
                    f"{verdict} in sample. Out-of-sample Sharpe is not available — this run recorded no walk-forward "
                    "fold, so nothing was scored on bars it had not seen. Unvalidated, which is not the same as failed."
                )
                return "unknown", headline, note, "no OOS fold"
            note = (
                f"{verdict}, out-of-sample Sharpe <code>{_number(oos)}</code> on unseen folds"
                f" · PBO <code>{_percent(result.get('overfitting_probability'))}</code>"
                f" · min track record <code>{_number(result.get('min_track_record_bars'), 0)}</code> bars"
            )
            return ("ok" if oos > 0 else "degraded"), headline, note, f"OOS {_number(oos)}"

        rows = [
            row for row in (self.audit.recent_backtests(50) if self.audit else [])
            if str(row.get("symbol") or "").upper() == symbol.upper()
        ]
        if rows:
            row = rows[0]
            headline = (
                f"<code>{esc(row.get('strategy'))} {esc(row.get('best_fast'))}/{esc(row.get('best_slow'))}</code>"
                f" on <code>{esc(symbol)}</code> · Sharpe <code>{_number(row.get('sharpe'))}</code>"
                f" · DSR <code>{_number(row.get('dsr'), 3)}</code>"
            )
            note = (
                f"Audit history only — out-of-sample Sharpe <code>{_number(row.get('oos_sharpe'))}</code>. Fold detail "
                "is kept for runs completed in this process, so a dash is a figure never written to the log, not a zero."
            )
            return "unknown", headline, note, "audit history"
        headline = f"No completed run for <code>{esc(symbol)}</code>"
        note = (
            "Awaiting validation — this desk has scored nothing on this instrument, in process or in the audit log. "
            f"Queue one with <code>/backtest {esc(symbol)} 1h ma_cross</code>."
        )
        return "unknown", headline, note, "no completed run"

    def _desk_trader(self, symbol: str) -> tuple[str, str, str, str]:
        """EX — the standing probe, and what the live book says it would cost."""
        notional = settings.default_probe_notional
        cap = settings.max_est_slippage_bps
        headline = f"<code>BUY {esc(symbol)}</code> · <code>{_money(notional)}</code> probe"
        refusal = ""
        try:
            report = self.tca.tca_report(symbol, "BUY", notional) if self.tca else None
        except Exception as exc:
            # The engine's refusal is the answer to "what will it cost", so it
            # is named rather than folded into a generic silence.
            report = None
            refusal = f" The engine refused the walk (<code>{esc(type(exc).__name__)}</code>)."
        if report is None or not report.per_venue:
            reason = (
                "No execution engine is attached on this deployment" if self.tca is None
                else "No venue is streaming this instrument"
            )
            note = (
                f"{reason}, so that order's cost is not modelled — the pre-trade gate would still refuse anything over "
                f"<code>{_number(cap, 0)}</code> bps. An unpriced order is not a free one.{refusal}"
            )
            return "unknown", headline, note, "no live book"
        routed = _finite(report.smart_route_slippage_bps)
        best = min(report.per_venue, key=lambda entry: entry.slippage_bps if entry.slippage_bps is not None else 1e9)
        headline += f" · routed <code>{_number(routed, 2, signed=True)}</code> bps"
        note = (
            f"Best single venue <code>{esc(best.venue)}</code> at <code>{_number(best.slippage_bps, 2, signed=True)}</code> bps"
            f" · walked over live depth at <code>{len(report.per_venue)}</code>"
            f" venue{'' if len(report.per_venue) == 1 else 's'} against a"
            f" <code>{_number(cap, 0)}</code> bps modelled cost budget."
        )
        if report.synthetic:
            note += " The book is SYNTHETIC — generated because the venues are dark, never trade on it."
            return "degraded", headline, note, "synthetic book"
        if routed is None:
            note += " The smart route returned no cost, so the routed figure is withheld rather than assumed."
            return "unknown", headline, note, "route unpriced"
        return ("degraded" if routed > cap else "ok"), headline, note, f"{_number(routed, 1)} bps"

    def _desk_portfolio(self, report: dict[str, Any]) -> tuple[str, str, str, str]:
        """PM — exposure, concentration and how much of it is attributed."""
        exposure = report["exposure"]
        concentration = report["concentration"]
        sleeves = report["attribution"]["by_strategy"] or []
        if not exposure.get("positions"):
            headline = "The book is flat — nothing is held."
            note = (
                "Exposure, concentration and sleeve attribution have nothing to measure on a flat book. That is an "
                "empty book, not a book carrying zero risk."
            )
            return "unknown", headline, note, "flat book"
        headline = (
            f"Gross <code>{_money(exposure.get('gross'))}</code> · net <code>{_money(exposure.get('net'))}</code>"
            f" · <code>{_number(exposure.get('leverage'))}×</code> leverage"
        )
        note = (
            f"<code>{concentration.get('positions')}</code> held, largest <code>{esc(concentration.get('largest_symbol'))}</code>"
            f" at <code>{_percent(concentration.get('largest_share'))}</code> of gross"
            f" · <code>{_number(concentration.get('effective_positions'), 1)}</code> effective bets"
            f" (HHI <code>{_number(concentration.get('hhi'), 3)}</code>)"
            f" · <code>{len(sleeves)}</code> sleeve{'' if len(sleeves) == 1 else 's'} attributed"
        )
        if not sleeves:
            note += " — no audited fill yet, so the attribution is empty rather than zero."
        return "ok", headline, note, f"{concentration.get('positions')} held"

    def _desk_risk(self, report: dict[str, Any], cov: Any) -> tuple[str, str, str, str]:
        """RM — the binding limit, the halt, and the tail beyond the quantile."""
        from modules.quant_risk import portfolio_risk

        state = self.gateway.state() if self.gateway else None
        constraint, utilisation = report["risk_budget"]["binding_constraint"]
        halted = bool(state and state.kill_switch_active)
        # `reduce_only_active` on the gateway is a method, and a bound method is
        # always truthy — the graduated regime is read off the published state.
        reduce_only = bool(getattr(state, "reduce_only", False))
        regime = f" · reduce-only ENGAGED ({esc(getattr(state, 'reduce_only_source', 'unknown'))})" if reduce_only else ""
        headline = (
            f"Binding limit <code>{esc(constraint)}</code> at <code>{_percent(utilisation)}</code>"
            f" · kill switch <code>{'ACTIVE' if halted else 'inactive'}</code>{regime}"
        )
        equity = _finite(report["equity"]["current"])
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov and equity else None
        if risk is None:
            note = (
                "VaR is withheld: a flat book, or too little shared price history to build a covariance — quant_risk "
                "wants at least 30 aligned 1d bars for every held symbol. An unmeasured tail is reported as unmeasured."
            )
            return ("down" if halted else "unknown"), headline, note, "VaR not measurable"
        note = (
            f"VaR 95 1d <code>{_money(risk.var95)}</code>, CVaR <code>{_money(risk.cvar95)}</code> beyond it"
            f" · book vol <code>{_percent(risk.annualised_volatility)}</code> annualised over"
            f" <code>{risk.observations}</code> 1d bars · advisory budget <code>{_percent(settings.var_budget_pct)}</code> of equity."
        )
        used = _finite(utilisation)
        status = "down" if halted else "degraded" if used is not None and used >= 0.8 else "ok"
        return status, headline, note, f"VaR {_money(risk.var95)}"

    async def _desk_data(self) -> tuple[str, str, str, str]:
        """DE — provider readiness, feed connectivity and book freshness."""
        from modules import research

        openbb = await research.openbb_status_async()
        health = self.tca.health() if self.tca else {}
        feeds = health.get("feeds", [])
        connected = sum(1 for feed in feeds if feed.get("connected"))
        synthetic = bool(health.get("synthetic_active"))
        ages: list[float] = []
        for feed in feeds:
            for symbol_state in (feed.get("symbols") or {}).values():
                age = _finite(symbol_state.get("age_s"))
                if age is not None:
                    ages.append(age)
        headline = (
            f"OpenBB <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>"
            f" · venue feeds <code>{connected}/{len(feeds)}</code> connected"
        )
        freshness = (
            f"worst book age <code>{_number(max(ages), 1)}</code>s"
            if ages else "no venue has published a book age, so freshness is unmeasured rather than fresh"
        )
        note = (
            f"{freshness} · provider <code>{esc(openbb.get('provider') or '—')}</code>."
            " Source agreement and payload lineage are per instrument: <code>/payload SYMBOL</code>."
        )
        if synthetic:
            note += " The book source is SYNTHETIC — generated, not a venue."
        if not feeds:
            return ("degraded" if openbb.get("ok") else "down"), headline, note, "no feed attached"
        if synthetic or connected < len(feeds) or not openbb.get("ok"):
            return "degraded", headline, note, f"{connected}/{len(feeds)} feeds"
        return "ok", headline, note, f"{connected}/{len(feeds)} feeds"

    def _desk_reliability(self) -> tuple[str, str, str, str]:
        """SRE — the observed request tail, its sample floor, and the decision clock."""
        from modules import metrics

        requests = metrics.request_latency_summary()
        decision = metrics.decision_latency_summary()
        uptime = _finite((self.tca.health() if self.tca else {}).get("uptime_s"))
        # "—s" would read as a broken clock; an absent engine is said in words.
        uptime_text = f"engine uptime <code>{_number(uptime, 0)}</code>s" if uptime is not None else "engine uptime unreported — no execution engine is attached here"
        samples = sum(int(stats.get("samples") or 0) for stats in requests.values())
        errors = sum(int(stats.get("errors") or 0) for stats in requests.values())
        worst = max(requests.items(), key=lambda item: _finite(item[1].get("p99")) or 0.0, default=None)
        if int(decision.get("samples") or 0):
            clock = (
                f"decision path <code>{_number(decision.get('p50'), 0)}</code>/"
                f"<code>{_number(decision.get('p99'), 0)}</code> µs p50/p99"
            )
        else:
            clock = "no decision timed yet — an empty record, not zero latency"
        if worst is None or samples < _LATENCY_SAMPLE_FLOOR:
            headline = f"<code>{len(requests)}</code> routes timed · {uptime_text}"
            note = (
                f"The p99 is withheld: <code>{samples}</code> requests timed in this window, under the "
                f"<code>{_LATENCY_SAMPLE_FLOOR}</code>-sample floor. A tail drawn from a handful of samples is noise, "
                f"not a measurement. {clock}."
            )
            return "unknown", headline, note, f"{samples} samples"
        route, stats = worst
        headline = (
            f"Worst route <code>{esc(route)[:26]}</code> p99 <code>{_number(stats.get('p99'), 0)}</code>ms"
            f" · <code>{errors}</code> errors across <code>{len(requests)}</code> routes"
        )
        note = (
            f"p50 <code>{_number(stats.get('p50'), 0)}</code>ms over <code>{samples}</code> timed requests"
            f" · {uptime_text} · {clock}."
        )
        return ("degraded" if errors else "ok"), headline, note, f"p99 {_number(stats.get('p99'), 0)}ms"

    def _desk_developer(self) -> tuple[str, str, str, str]:
        """API — the committed contract surface, the verify gates and the build."""
        from modules.decision_core import ENGINE

        routes = _committed_route_counts()
        gates = len(_VERIFY_GATES)
        build = (
            f"Build <code>{esc(settings.version)}</code> · <code>{esc(settings.environment)}</code>,"
            f" decision core <code>{esc(ENGINE)}</code>."
        )
        if not routes:
            headline = f"<code>{gates}</code> verify gates · contract surface not countable in this image"
            note = (
                f"{build} The committed <code>tools/openapi.json</code> is not shipped here, so the API surface is "
                "reported as absent rather than as zero operations."
            )
            return "unknown", headline, note, "no snapshot"
        operations = int(sum(count for _, count in routes))
        headline = (
            f"<code>{operations}</code> committed API operations across <code>{len(routes)}</code> modules"
            f" · <code>{gates}</code> verify gates"
        )
        note = (
            f"{build} The gates are the ones committed in this repository, not the verdict of the last run — "
            "GitHub Actions remains the authority for that."
        )
        return ("ok" if str(ENGINE) == "native" else "degraded"), headline, note, f"{operations} ops"

    async def _cmd_desks(self, args, chat_id, actor) -> None:
        """The seven desk roles, the question each asks, and the figure answering it now."""
        try:
            symbol = self._symbol(args) if args else settings.symbols[0].upper()
        except ValueError as exc:
            await self.send_message(chat_id, text_card(
                "🏛 Desk roles", "BAD ARGUMENT",
                [esc(exc), "Usage <code>/desks [SYMBOL]</code> — the instrument the researcher and trader rows read."],
                source="Overview · desk roles", next_commands="/desks · /symbols"))
            return

        report, cov, _ = await self._risk_inputs("1d")
        readings = [
            await self._desk_researcher(symbol),
            self._desk_trader(symbol),
            self._desk_portfolio(report),
            self._desk_risk(report, cov),
            await self._desk_data(),
            self._desk_reliability(),
            self._desk_developer(),
        ]
        lines = [
            f"One <code>{esc(symbol)}</code> context across the loop, and one record they all reconcile to.",
            "",
        ]
        rows: list[tuple[str, str, str, str]] = []
        for (code, role, question, command, plane), (status, headline, note, tile) in zip(_ROLES, readings, strict=True):
            lines += [
                f"<b>{code} · {role}</b> → <code>{command}</code>",
                f"<i>{question}</i>",
                f"   {headline}",
                f"   <i>{note}</i>",
                "",
            ]
            rows.append((plane, code, status, tile))
        measured = sum(1 for status, *_ in readings if status != "unknown")
        withheld = len(readings) - measured
        if withheld:
            tally = (
                f"{withheld} of {len(readings)} figures {'is' if withheld == 1 else 'are'} unmeasured right now — "
                "each row above says which, and why."
            )
        else:
            tally = "Every figure above is measured — nothing is withheld on this read."
        lines.append(
            "<i>Ordered the way work moves — an idea is researched, executed, held, and constrained — then the three "
            f"roles that keep that possible. {tally}</i>"
        )
        footer = kb([
            [("🔬 Research", cb("research", symbol)), ("⚡ Execution", cb("execution", symbol)),
             ("📁 Portfolio", cb("portfolio")), ("🛡 Risk", cb("risk"))],
            [("📊 Data", cb("data")), ("🛡️ Reliability", cb("reliability")), ("💻 Developer", cb("developer"))],
            _symbol_row("desks", symbol),
            [("↻ Refresh", cb("desks", symbol)), ("⌂ Menu", cb("menu"))],
        ])
        chart = generate_status_grid_png("Desk roles · one surface per role", rows)
        await self.send_media_group(chat_id, [("desks", chart)] if chart else [], caption=text_card(
            f"🏛 Desk roles · {esc(symbol)}", f"{measured}/{len(readings)} MEASURED", lines,
            source="Gateway + quant_risk + TCA + metrics + OpenAPI snapshot",
            next_commands="/research · /execution · /portfolio · /risk · /data · /reliability · /developer",
        ), reply_markup=footer)
