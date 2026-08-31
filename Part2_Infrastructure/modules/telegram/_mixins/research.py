"""Research / audit monitoring — jobs, backtests, RAG and the strategy catalogue."""

from __future__ import annotations

from typing import Any

from modules.telegram.format import _finite, _number, esc, text_card
from modules.telegram_charts import generate_bars_chart_png


class ResearchMixin:
    # ------------------------------------------------------------------ #
    # Research / audit monitoring
    # ------------------------------------------------------------------ #
    async def _cmd_research_status(self, args, chat_id, actor) -> None:
        from modules import research

        openbb = await research.openbb_status_async()
        queue = self.queue.stats() if self.queue else {}
        lines = [f"OpenBB <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>", f"Provider <code>{esc(openbb.get('provider') or '—')}</code>", f"Queue backend <code>{esc(queue.get('backend') or '—')}</code>", f"Workers <code>{queue.get('workers') or 0}</code>", f"Jobs <code>{queue.get('total') or 0}</code>"]
        await self.send_message(chat_id, text_card("🧪 Research systems", "MONITORING ONLY", lines, source="OpenBB + job queue", next_commands="/jobs · /backtests · /snapshot AAPL"))

    async def _cmd_jobs(self, args, chat_id, actor) -> None:
        count = self._limit(args, 0, 10, 25)
        jobs = self.queue.list(count) if self.queue else []
        if not jobs:
            await self.send_message(chat_id, text_card("🗂 Research jobs", "EMPTY", ["No research jobs recorded."], source="Job queue", next_commands="/researchstatus"))
            return
        icons = {"queued": "⏳", "running": "⚙️", "succeeded": "✅", "failed": "❌", "cancelled": "⛔"}
        lines = [f"{icons.get(job.status, '•')} <code>{job.job_id}</code> {esc(job.kind)} · <code>{esc(job.status)}</code> · <code>{job.progress:.0%}</code>" for job in jobs]
        await self.send_message(chat_id, text_card("🗂 Research jobs", "READ-ONLY MONITOR", lines, source=f"{self.queue.backend} job queue", next_commands="/job JOB_ID · /backtests"))

    async def _cmd_job(self, args, chat_id, actor) -> None:
        if not args:
            raise ValueError("usage: /job JOB_ID")
        job = self.queue.get(args[0]) if self.queue else None
        if not job:
            await self.send_message(chat_id, text_card("🗂 Research job", "NOT FOUND", [f"Unknown job <code>{esc(args[0])}</code>."], source="Job queue", next_commands="/jobs"))
            return
        lines = [f"ID       <code>{esc(job.job_id)}</code>", f"Kind     <code>{esc(job.kind)}</code>", f"Status   <code>{esc(job.status)}</code>", f"Progress <code>{job.progress:.0%}</code>", f"Backend  <code>{esc(job.backend)}</code>"]
        if job.message:
            lines.append(f"Message <code>{esc(job.message)}</code>")
        if job.error:
            lines.append(f"Error <code>{esc(str(job.error)[:220])}</code>")
        await self.send_message(chat_id, text_card("🗂 Research job", job.status.upper(), lines, source="Job queue", next_commands="/jobs · /backtests"))

    async def _cmd_backtest(self, args, chat_id, actor) -> None:
        """Queue a sweep on the same jobs engine the API and the web use.

        The boundary this crosses is research, not execution: it submits work
        to `queue`, never an order to `gateway`. `/flatten` remains the only
        command that can move the book, and it still goes through every
        pre-trade gate to do it.
        """
        from modules.backtester import run_backtest
        from modules.schemas import BacktestRequest

        symbol = self._symbol(args)
        rest = [token.lower() for token in args[1:]] if len(args) > 1 else []
        interval = next((token for token in rest if token in {"15m", "1h", "4h", "1d"}), "1h")
        strategy = next((token for token in rest if token not in {"15m", "1h", "4h", "1d"}), None)

        try:
            request = BacktestRequest(
                symbol=symbol,
                interval=interval,
                **({"strategy": strategy} if strategy else {}),
                notify_chat_id=str(chat_id),
            )
        except Exception as exc:  # pydantic states the allowed values itself
            await self.send_message(chat_id, text_card(
                "🧪 Backtest", "REJECTED",
                [f"<code>{esc(str(exc)[:300])}</code>",
                 "<i>/strategies lists every strategy this engine accepts.</i>"],
                source="schemas.BacktestRequest", next_commands="/strategies · /intervals",
            ))
            return

        record = self.queue.submit(
            "backtest", run_backtest, request.model_dump(),
            meta={"chat_id": str(chat_id), "symbol": request.symbol, "actor": actor},
        )

        subscribed = any(
            str(sub.get("chat_id")) == str(chat_id) for sub in self._subscribers()
        )
        lines = [
            f"Job         <code>{esc(record.job_id)}</code>",
            f"Symbol      <code>{esc(request.symbol)}</code> · <code>{esc(request.interval)}</code>",
            f"Strategy    <code>{esc(request.strategy)}</code>",
            f"Backend     <code>{esc(record.backend)}</code>",
            "",
            "<i>The result pushes to this chat when it lands.</i>" if subscribed else
            "<i>This chat is not subscribed, so nothing will be pushed — "
            "run /subscribe, or poll with /job.</i>",
        ]
        await self.send_message(chat_id, text_card(
            "🧪 Backtest queued", "ACCEPTED", lines,
            source="jobs engine", next_commands=f"/job {record.job_id} · /backtests",
        ))

    async def _cmd_rag(self, args, chat_id, actor) -> None:
        """Corpus search, desk-scoped when the shared rollout flag is enabled."""
        from modules.research_quota_gate import scope_for
        from modules.research_rag import get_rag

        query = " ".join(args).strip()
        if not query:
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "NEEDS A QUERY",
                ["Describe what you are looking for, e.g. "
                 "<code>/rag momentum drawdown</code>."],
                source="research corpus", next_commands="/backtests · /incidents",
            ))
            return

        rag = get_rag()
        _desk, bound, scope = scope_for((rag.search,))
        if bound is not None:
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "SCOPE UNAVAILABLE",
                [esc(bound.reason), "<i>No corpus search was run.</i>"],
                source="research tenant gate", next_commands="/researchstatus",
            ))
            return

        result = await rag.search(query, match_count=3, **scope)
        state = result.get("state")
        if state == "unavailable":
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "INDEX UNAVAILABLE",
                ["The corpus is not configured or cannot be reached.",
                 "<i>Unavailable is a state, not an empty result — this is not "
                 "the same as finding nothing.</i>"],
                source="research corpus", next_commands="/researchstatus",
            ))
            return
        if state == "embed_failed":
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "EMBEDDING FAILED",
                ["The query could not be embedded, so nothing was searched.",
                 "<i>Reported rather than returned as no matches.</i>"],
                source="research corpus", next_commands="/researchstatus",
            ))
            return

        matches = result.get("matches") or []
        if not matches:
            await self.send_message(chat_id, text_card(
                "🧠 Desk recall", "NOTHING SIMILAR",
                [f"Nothing in the corpus resembles <code>{esc(query)}</code>.",
                 "<i>The index answered; it holds no comparable run or incident.</i>"],
                source="research corpus", next_commands="/backtests",
            ))
            return

        lines: list[str] = []
        for match in matches:
            similarity = _finite(match.get("similarity"))
            lines.append(
                f"<b>{esc(str(match.get('title') or match.get('kind') or 'record'))}</b>"
                + (f" · <code>{similarity * 100:.0f}%</code>" if similarity is not None else "")
            )
            occurred = match.get("occurred_at")
            detail = str(match.get("summary") or match.get("detail") or "").strip()
            if detail:
                lines.append(esc(detail[:220]))
            if occurred:
                lines.append(f"<i>{esc(str(occurred)[:19])}</i>")
            lines.append("")
        lines.append("<i>Similarity is over this account's own backtests, execution "
                     "summaries and incidents — never the open web.</i>")
        await self.send_message(chat_id, text_card(
            f"🧠 Desk recall · {esc(query[:40])}", f"{len(matches)} MATCHES", lines,
            source="research corpus · pgvector", next_commands="/backtests · /incidents",
        ))

    def _newest_backtest_result(self) -> dict[str, Any] | None:
        """The newest succeeded backtest completed in THIS process, any symbol."""
        jobs = getattr(self.queue, "_jobs", None)
        if not jobs:
            return None
        best: dict[str, Any] | None = None
        best_at = None
        for job in jobs.values():
            if getattr(job, "kind", None) != "backtest" or getattr(job, "status", None) != "succeeded":
                continue
            result = getattr(job, "result", None)
            if not isinstance(result, dict):
                continue
            finished = getattr(job, "finished_at", None) or getattr(job, "submitted_at", None)
            if best_at is None or (finished is not None and finished > best_at):
                best, best_at = result, finished
        return best

    @staticmethod
    def _dsr_colour(dsr: Any) -> str:
        """Green when the deflated Sharpe clears promotion, amber near it, red below."""
        value = _finite(dsr)
        if value is None:
            return "#94a3b8"
        if value >= 0.95:
            return "#00e676"
        if value >= 0.8:
            return "#f59e0b"
        return "#ff5252"

    async def _cmd_backtests(self, args, chat_id, actor) -> None:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_backtests(count) if self.audit else []
        newest = self._newest_backtest_result()
        if not rows and not newest:
            await self.send_message(chat_id, text_card("🧪 Backtest history", "EMPTY", ["No completed backtests in the audit log, and none queued in this process."], source="DuckDB audit log", next_commands="/researchstatus"))
            return

        lines = []
        for row in rows:
            lines.append(f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('symbol'))} {esc(row.get('strategy'))} · Sharpe <code>{_number(row.get('sharpe'))}</code> · DSR <code>{_number(row.get('dsr'), 3)}</code> · OOS <code>{_number(row.get('oos_sharpe'))}</code>")
        if not rows:
            request = newest.get("request") or {}
            lines.append(
                f"No run is in the audit log yet, but one completed in this process: "
                f"<code>{esc(request.get('symbol'))} · {esc(request.get('strategy'))}</code>. "
                "Its equity curve is below."
            )

        # Sharpe by run, coloured by the DSR verdict — a run that overfits and one
        # that generalises are the same height until the colour separates them.
        bars = generate_bars_chart_png(
            "Sharpe by run · colour = DSR (green≥0.95, amber≥0.8, red below)",
            [f"{row.get('symbol')} {row.get('strategy')}"[:18] for row in rows],
            [_finite(row.get("sharpe")) for row in rows],
            "Sharpe",
            colours=[self._dsr_colour(row.get("dsr")) for row in rows],
            horizontal=True, value_fmt="{:.2f}",
        )

        # The newest in-process run carries its own rendered equity curve; the
        # audit history does not, so this hero photo only appears for a run this
        # process actually completed.
        hero = self._decode_b64png(newest.get("equity_curve_png")) if newest else None

        charts: list[tuple[str, bytes]] = []
        if hero:
            charts.append(("equity-curve", hero))
        if bars:
            charts.append(("sharpe", bars))

        await self.send_media_group(chat_id, charts, caption=text_card(
            "🧪 Backtest history", "READ-ONLY AUDIT", lines,
            source="DuckDB audit log", next_commands="/strategies · /walkforward BTCUSDT · /jobs",
        ))

    async def _cmd_strategies(self, args, chat_id, actor) -> None:
        from typing import get_args

        from modules.schemas import BacktestRequest

        strategies = [str(value) for value in get_args(BacktestRequest.model_fields["strategy"].annotation)]

        if args:
            # One strategy: its grid size and the runs of it the desk has recorded.
            requested = args[0].lower()
            if requested not in strategies:
                await self.send_message(chat_id, text_card(
                    "🧠 Strategy", "UNKNOWN",
                    [f"<code>{esc(requested)}</code> is not one of the {len(strategies)} the schema accepts.",
                     "Send <code>/strategies</code> for the full catalogue."],
                    source="Backtest request schema", next_commands="/strategies"))
                return
            request = BacktestRequest(strategy=requested)
            fast_n = len(range(request.fast_min, request.fast_max + 1, request.fast_step))
            slow_n = len(range(request.slow_min, request.slow_max + 1, request.slow_step))
            runs = [
                row for row in (self.audit.recent_backtests(50) if self.audit else [])
                if str(row.get("strategy") or "").lower() == requested
            ]
            lines = [
                f"Strategy    <code>{esc(requested)}</code>",
                f"Grid        <code>{fast_n * slow_n}</code> combinations "
                f"(<code>{fast_n}×{slow_n}</code> fast×slow at default steps)",
                f"Recent runs <code>{len(runs)}</code> in the audit log",
            ]
            for row in runs[:8]:
                lines.append(
                    f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('symbol'))}"
                    f" · Sharpe <code>{_number(row.get('sharpe'))}</code> · DSR <code>{_number(row.get('dsr'), 3)}</code>"
                )
            if not runs:
                lines.append("<i>No run of this strategy is in the audit log yet — queue one below.</i>")
            await self.send_message(chat_id, text_card(
                f"🧠 {requested}", "STRATEGY", lines,
                source="Backtest request schema + audit",
                next_commands=f"/backtest BTCUSDT 1h {requested} · /strategies"))
            return

        # The whole catalogue, grouped by the suffix family it belongs to, read
        # straight from the schema Literal rather than a hand-kept list of three.
        families: dict[str, list[str]] = {}
        for name in strategies:
            family = name.rsplit("_", 1)[-1] if "_" in name else name
            families.setdefault(family, []).append(name)
        lines = [f"<b>{len(strategies)} strategies</b>, grouped by family:", ""]
        for family in sorted(families):
            lines.append(f"<b>{esc(family)}</b> · <code>{esc(', '.join(families[family]))}</code>")
        lines += [
            "",
            "Queue one with <code>/backtest SYMBOL INTERVAL STRATEGY</code>, or send "
            "<code>/strategies NAME</code> for its grid size and recent runs.",
        ]
        await self.send_message(chat_id, text_card(
            "🧠 Strategy catalogue", f"{len(strategies)} STRATEGIES", lines,
            source="Backtest request schema", next_commands="/backtests · /backtest BTCUSDT 1h ma_cross"))

    async def _cmd_intervals(self, args, chat_id, actor) -> None:
        lines = ["OpenBB market data <code>15m · 1h · 4h · 1d</code>", "Backtests <code>1m · 5m · 15m · 1h · 4h · 1d</code>", "", "Intraday history availability depends on the upstream provider window."]
        await self.send_message(chat_id, text_card("⏱ Supported intervals", "REFERENCE", lines, source="OpenBB + backtest schemas", next_commands="/bars AAPL 1d 5 · /trend AAPL 1d 20"))
