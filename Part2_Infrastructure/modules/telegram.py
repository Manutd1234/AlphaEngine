"""AlphaEngine Telegram companion — independent, text-only operational updates.

The Telegram bot is deliberately separate from every web interface. It does
not open a Mini App, authenticate the website, submit orders, alter the kill
switch, or enqueue research. It reads the same authoritative gateway state and
OpenBB provider layer, then renders compact phone-friendly text cards.

Only notification preferences mutate through this module. Operational data is
fail-closed behind ``TELEGRAM_ALLOWED_USER_IDS``; when no allow-list exists,
the bot exposes only bootstrap commands such as ``/whoami`` so an operator can
obtain their Telegram user ID safely.
"""

from __future__ import annotations

import asyncio
import contextlib
import html
import io
import json
import logging
import math
import re
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from config import settings

log = logging.getLogger("alphaengine.telegram")

_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,20}$")
_HTML_TAG_RE = re.compile(r"</?(?:b|i|code|pre|u|s)(?:\s[^>]*)?>", re.IGNORECASE)
_TELEGRAM_ACTOR_RE = re.compile(r"^tg:([1-9][0-9]*):")
_TELEGRAM_MESSAGE_LIMIT = 3900
_BOOTSTRAP_COMMANDS = {"/start", "/help", "/commands", "/about", "/whoami", "/version"}


def esc(value: Any) -> str:
    """Escape user/provider text for Telegram's HTML parse mode."""
    return html.escape(str(value), quote=False)


def utc_now_label() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _money(value: Any, signed: bool = False) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    return f"${number:+,.0f}" if signed else f"${number:,.0f}"


def _number(value: Any, decimals: int = 2, signed: bool = False) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    sign = "+" if signed else ""
    return f"{number:{sign},.{decimals}f}"


def _percent(value: Any, decimals: int = 2, signed: bool = False) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    sign = "+" if signed else ""
    return f"{number:{sign}.{decimals}%}"


def text_card(
    title: str,
    status: str,
    lines: list[str],
    *,
    source: str,
    next_commands: str | None = None,
) -> str:
    """Consistent textual UI: title, freshness/state, metrics, provenance."""
    body = [f"<b>{title}</b>", f"<code>{esc(status)}</code>", "", *lines]
    body += ["", f"<i>{esc(source)} · {utc_now_label()}</i>"]
    if next_commands:
        body.append(f"<i>Next: {esc(next_commands)}</i>")
    return "\n".join(body)


def _style_axes(fig, ax) -> None:
    """The shared dark canvas every bot chart is drawn on."""
    fig.patch.set_facecolor('#0f172a')
    ax.set_facecolor('#1e293b')
    ax.tick_params(colors='#94a3b8', labelsize=8)
    for spine in ax.spines.values():
        spine.set_color('#334155')


def _finish(fig) -> bytes:
    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    return buf.getvalue()


def generate_series_chart_png(symbol: str, closes: list[float], interval: str, source: str) -> bytes:
    """
    One symbol's close series, drawn from the bars the caller actually fetched.

    This replaced a generator that titled itself "Real-Time Market Quote" and
    plotted `64200 + sin(i * 0.3) * 450` — a decorative curve under a factual
    caption, which on a desk tool is worse than no chart because a reader
    cannot tell it apart from a real one. That generator has since been
    deleted. Everything below is plotted from `closes` or not plotted at all.
    """
    fig, ax = plt.subplots(figsize=(6, 3.2), dpi=120)
    _style_axes(fig, ax)

    xs = list(range(len(closes)))
    first, last = closes[0], closes[-1]
    rising = last >= first
    colour = '#00e676' if rising else '#ff5252'
    ax.plot(xs, closes, color=colour, linewidth=2)
    ax.fill_between(xs, closes, min(closes), color=colour, alpha=0.15)
    ax.axhline(first, color='#64748b', linewidth=1, linestyle='--', alpha=0.7)

    move = ((last / first) - 1) * 100 if first else 0.0
    ax.set_title(
        f"{symbol} · {interval} · {move:+.2f}% over {len(closes)} bars",
        color='#f8fafc', fontsize=10, fontweight='bold',
    )
    ax.set_ylabel("Close", color='#94a3b8', fontsize=8)
    ax.set_xlabel(f"{source} · dashed line is the first close", color='#94a3b8', fontsize=8)
    return _finish(fig)


"""The gates the deploy workflow actually runs before it will ship a build.

This replaced three hardcoded assertion counts (342/680/13) that drifted the
moment anyone added a test — including the tests added to cover this very
module. A number nobody updates is worse than no number, because it keeps
looking authoritative. These are names, not counts: they are checkable against
`.github/workflows/deploy.yml` by reading it.
"""
_VERIFY_GATES: tuple[str, ...] = (
    "ruff check .",
    "python -m pytest",
    "tools/export_openapi.py --check",
    "tools/synthetic_probe.py",
)


def _committed_route_counts() -> list[tuple[str, float]]:
    """Routes per tag, parsed from the committed OpenAPI snapshot.

    Real committed data that updates itself when a route lands, rather than a
    figure maintained by hand. Returns an empty list when the snapshot is not
    in the image, so the caller can say so rather than draw a lie.
    """
    snapshot = Path(__file__).resolve().parent.parent / "tools" / "openapi.json"
    try:
        document = json.loads(snapshot.read_text())
    except (OSError, ValueError):
        return []
    counts: dict[str, int] = {}
    for operations in document.get("paths", {}).values():
        for operation in operations.values():
            if not isinstance(operation, dict):
                continue
            for tag in operation.get("tags", ["untagged"]):
                counts[str(tag)] = counts.get(str(tag), 0) + 1
    return sorted(((tag, float(n)) for tag, n in counts.items()), key=lambda row: -row[1])


def generate_bars_chart_png(
    title: str,
    labels: list[str],
    values: list[float],
    ylabel: str,
    colours: list[str] | None = None,
    horizontal: bool = False,
    value_fmt: str = "{:.0f}",
) -> bytes | None:
    """A bar chart of whatever the caller measured. None when nothing was."""
    pairs = [(label, value) for label, value in zip(labels, values, strict=False) if value is not None]
    if not pairs:
        return None
    labels = [label for label, _ in pairs]
    values = [float(value) for _, value in pairs]

    fig, ax = plt.subplots(figsize=(6, 3.2), dpi=120)
    _style_axes(fig, ax)
    palette = colours or ['#38bdf8'] * len(values)
    if horizontal:
        ax.barh(labels, values, color=palette, height=0.5)
        ax.set_xlabel(ylabel, color='#94a3b8', fontsize=8)
        ax.invert_yaxis()
        for index, value in enumerate(values):
            ax.text(value, index, " " + value_fmt.format(value), color='#f8fafc', fontsize=8, va='center')
    else:
        ax.bar(labels, values, color=palette, width=0.5)
        ax.set_ylabel(ylabel, color='#94a3b8', fontsize=8)
        for index, value in enumerate(values):
            ax.text(index, value, value_fmt.format(value), color='#f8fafc', fontsize=8, ha='center', va='bottom')
    ax.set_title(title, color='#f8fafc', fontsize=10, fontweight='bold')
    return _finish(fig)


def generate_depth_chart_png(symbol: str, bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> bytes | None:
    """
    The real consolidated ladder as cumulative depth either side of the mid.

    The generator this replaced drew a fixed shape that never touched a venue.
    This one draws the rungs it was handed and returns None when there are
    none, because "no live book" is a fact the caption should carry rather than
    something a picture papers over.
    """
    if len(bids) < 2 or len(asks) < 2:
        return None

    fig, ax = plt.subplots(figsize=(6, 3.2), dpi=120)
    _style_axes(fig, ax)

    bid_prices, bid_cum = [], []
    running = 0.0
    for price, size in sorted(bids, key=lambda r: -r[0]):
        running += price * size
        bid_prices.append(price)
        bid_cum.append(running)

    ask_prices, ask_cum = [], []
    running = 0.0
    for price, size in sorted(asks, key=lambda r: r[0]):
        running += price * size
        ask_prices.append(price)
        ask_cum.append(running)

    ax.step(bid_prices, bid_cum, where='post', color='#00e676', linewidth=2, label='Bids')
    ax.fill_between(bid_prices, bid_cum, step='post', color='#00e676', alpha=0.15)
    ax.step(ask_prices, ask_cum, where='post', color='#ff5252', linewidth=2, label='Asks')
    ax.fill_between(ask_prices, ask_cum, step='post', color='#ff5252', alpha=0.15)

    mid = (bid_prices[0] + ask_prices[0]) / 2
    ax.axvline(mid, color='#64748b', linewidth=1, linestyle='--', alpha=0.8)
    ax.set_title(f"{symbol} consolidated depth · mid {mid:,.2f}", color='#f8fafc', fontsize=10, fontweight='bold')
    ax.set_ylabel("Cumulative notional (USD)", color='#94a3b8', fontsize=8)
    ax.set_xlabel("Price", color='#94a3b8', fontsize=8)
    ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#f8fafc', fontsize=8)
    return _finish(fig)


def generate_drawdown_chart_png(symbol: str, closes: list[float]) -> bytes | None:
    """Peak-to-trough drawdown of the same closes the price chart drew."""
    if len(closes) < 2:
        return None
    peak = closes[0]
    drawdown = []
    for close in closes:
        peak = max(peak, close)
        drawdown.append((close / peak - 1) * 100 if peak else 0.0)

    fig, ax = plt.subplots(figsize=(6, 2.6), dpi=120)
    _style_axes(fig, ax)
    xs = list(range(len(drawdown)))
    ax.plot(xs, drawdown, color='#ff5252', linewidth=1.6)
    ax.fill_between(xs, drawdown, 0, color='#ff5252', alpha=0.18)
    ax.axhline(0, color='#64748b', linewidth=1)
    ax.set_title(f"{symbol} drawdown from running peak · worst {min(drawdown):.2f}%", color='#f8fafc', fontsize=10, fontweight='bold')
    ax.set_ylabel("Drawdown (%)", color='#94a3b8', fontsize=8)
    return _finish(fig)


def split_telegram_html(text: str, limit: int = _TELEGRAM_MESSAGE_LIMIT) -> list[str]:
    """Split on complete lines so a message never cuts an HTML tag/entity.

    Generated cards keep every HTML tag on one line. If an upstream value ever
    creates an oversized line, that one line is converted to escaped plain text
    before being split; Telegram then receives valid HTML for every chunk.
    """
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        if current:
            chunks.append("\n".join(current))
            current = []
            current_len = 0

    for line in text.splitlines():
        if len(line) > limit:
            flush()
            plain = esc(html.unescape(_HTML_TAG_RE.sub("", line)))
            for start in range(0, len(plain), limit):
                chunks.append(plain[start:start + limit])
            continue

        extra = len(line) + (1 if current else 0)
        if current and current_len + extra > limit:
            flush()
        current.append(line)
        current_len += len(line) + (1 if len(current) > 1 else 0)
    flush()
    return chunks or [""]


@dataclass(frozen=True)
class CommandSpec:
    name: str
    description: str
    category: str
    usage: str
    example: str
    handler: str
    aliases: tuple[str, ...] = ()


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    # 8 Desk Role Tabs (Explicit Vercel UI Tab mapping with Visual Charts)
    CommandSpec("overview", "Overview (All Roles) · System signal & cross-role dashboard + chart", "Tabs", "/overview", "/overview", "_cmd_tab_overview", ("tab_overview", "dashboard")),
    CommandSpec("research", "Research (Quant Researcher) · Strategy sweep & tearsheet + chart", "Tabs", "/research [SYMBOL]", "/research BTCUSDT", "_cmd_tab_research", ("tab_research", "lab")),
    CommandSpec("execution", "Execution (Quant Trader) · Live L2 book & routing + chart", "Tabs", "/execution [SYMBOL]", "/execution BTCUSDT", "_cmd_tab_execution", ("tab_execution", "trade")),
    CommandSpec("data", "Data (Data Engineer) · Quality, freshness & failover + chart", "Tabs", "/data", "/data", "_cmd_tab_data", ("tab_data", "dataeng")),
    CommandSpec("reliability", "Reliability (DevOps/SRE) · Telemetry & latency + chart", "Tabs", "/reliability", "/reliability", "_cmd_tab_reliability", ("tab_reliability", "sre")),
    CommandSpec("developer", "Developer (Quant Developer) · CI/CD, OpenAPI & repo posture + chart", "Tabs", "/developer", "/developer", "_cmd_tab_developer", ("tab_developer", "dev")),

    # Essentials
    CommandSpec("start", "Essentials · Open the text command centre", "Essentials", "/start", "/start", "_cmd_start"),
    CommandSpec("help", "Essentials · Help by category or command", "Essentials", "/help [CATEGORY|COMMAND]", "/help markets", "_cmd_help"),
    CommandSpec("commands", "Essentials · List the complete command catalogue", "Essentials", "/commands", "/commands", "_cmd_commands"),
    CommandSpec("status", "Essentials · Gateway, feeds, queue and OpenBB", "Essentials", "/status", "/status", "_cmd_status", ("health",)),
    CommandSpec("about", "Essentials · What this independent bot does", "Essentials", "/about", "/about", "_cmd_about"),
    CommandSpec("whoami", "Essentials · Show Telegram user and chat IDs", "Essentials", "/whoami", "/whoami", "_cmd_whoami"),
    CommandSpec("version", "Essentials · Runtime version and bot mode", "Essentials", "/version", "/version", "_cmd_version"),
    CommandSpec("ping", "Essentials · Check command-path responsiveness", "Essentials", "/ping", "/ping", "_cmd_ping"),

    # Portfolio manager
    CommandSpec("portfolio", "Portfolio · Whole-book PM summary", "Portfolio", "/portfolio", "/portfolio", "_cmd_portfolio", ("bookstate",)),
    CommandSpec("positions", "Portfolio · Open positions and marks", "Portfolio", "/positions [SYMBOL]", "/positions BTCUSDT", "_cmd_positions", ("toppositions", "position")),
    CommandSpec("pnl", "Portfolio · Realised and unrealised P&L", "Portfolio", "/pnl", "/pnl", "_cmd_pnl"),
    CommandSpec("exposure", "Portfolio · Gross, net and leverage", "Portfolio", "/exposure", "/exposure", "_cmd_exposure"),
    CommandSpec("concentration", "Portfolio · Largest weights and effective bets", "Portfolio", "/concentration", "/concentration", "_cmd_concentration"),
    CommandSpec("headroom", "Portfolio · Remaining capacity before limits", "Portfolio", "/headroom", "/headroom", "_cmd_headroom"),
    CommandSpec("risk", "Portfolio · Drawdown and gateway budget", "Portfolio", "/risk", "/risk", "_cmd_risk"),
    CommandSpec("limits", "Portfolio · Deployed hard risk limits", "Portfolio", "/limits", "/limits", "_cmd_limits"),
    CommandSpec("attribution", "Portfolio · Flow and costs by strategy", "Portfolio", "/attribution", "/attribution", "_cmd_attribution"),

    # Market data / OpenBB
    CommandSpec("openbb", "Markets · OpenBB provider readiness", "Markets", "/openbb", "/openbb", "_cmd_openbb", ("providers",)),
    CommandSpec("quote", "Markets · OpenBB quote", "Markets", "/quote SYMBOL [equity|crypto]", "/quote AAPL", "_cmd_quote", ("market",)),
    CommandSpec("bars", "Markets · Recent OpenBB OHLCV rows", "Markets", "/bars SYMBOL [15m|1h|4h|1d] [COUNT]", "/bars AAPL 1d 5", "_cmd_bars"),
    CommandSpec("trend", "Markets · Return and direction over recent bars", "Markets", "/trend SYMBOL [INTERVAL] [COUNT]", "/trend NVDA 1d 20", "_cmd_trend"),
    CommandSpec("range", "Markets · High/low range over recent bars", "Markets", "/range SYMBOL [INTERVAL] [COUNT]", "/range BTCUSDT 4h 12", "_cmd_range"),
    CommandSpec("volume", "Markets · Latest and average volume", "Markets", "/volume SYMBOL [INTERVAL] [COUNT]", "/volume MSFT 1d 20", "_cmd_volume"),
    CommandSpec("news", "Markets · Latest company headlines", "Markets", "/news SYMBOL [COUNT]", "/news AAPL 5", "_cmd_news"),
    CommandSpec("fundamentals", "Markets · Company profile and key metrics", "Markets", "/fundamentals SYMBOL", "/fundamentals NVDA", "_cmd_fundamentals", ("profile", "valuation")),
    CommandSpec("snapshot", "Markets · Quote, fundamentals and headlines", "Markets", "/snapshot SYMBOL [equity|crypto]", "/snapshot AAPL", "_cmd_snapshot", ("research",)),
    CommandSpec("symbols", "Markets · Tracked instruments and examples", "Markets", "/symbols", "/symbols", "_cmd_symbols"),

    # Execution analytics (read-only)
    CommandSpec("book", "Execution · Top of book across venues", "Execution", "/book SYMBOL", "/book BTCUSDT", "_cmd_book"),
    CommandSpec("spread", "Execution · Venue and consolidated spreads", "Execution", "/spread SYMBOL", "/spread BTCUSDT", "_cmd_spread"),
    CommandSpec("depth", "Execution · Bid/ask depth by venue", "Execution", "/depth SYMBOL", "/depth ETHUSDT", "_cmd_depth"),
    CommandSpec("tca", "Execution · VWAP, slippage and smart route", "Execution", "/tca SYMBOL NOTIONAL [BUY|SELL]", "/tca BTCUSDT 100000 BUY", "_cmd_tca", ("cost",)),
    CommandSpec("route", "Execution · Smart-route allocation only", "Execution", "/route SYMBOL NOTIONAL [BUY|SELL]", "/route BTCUSDT 50000 SELL", "_cmd_route"),
    CommandSpec("liquidity", "Execution · Fillability and route capacity", "Execution", "/liquidity SYMBOL [NOTIONAL]", "/liquidity BTCUSDT 250000", "_cmd_liquidity"),
    CommandSpec("venues", "Execution · Venue connectivity overview", "Execution", "/venues", "/venues", "_cmd_venues"),
    CommandSpec("feedstatus", "Execution · Detailed market-feed health", "Execution", "/feedstatus", "/feedstatus", "_cmd_feedstatus"),
    CommandSpec("orders", "Execution · Recent gateway decisions", "Execution", "/orders [COUNT]", "/orders 10", "_cmd_orders"),
    CommandSpec("fills", "Execution · Recent accepted fills", "Execution", "/fills [COUNT]", "/fills 10", "_cmd_fills"),
    CommandSpec("rejections", "Execution · Recent rejected orders", "Execution", "/rejections [COUNT]", "/rejections 10", "_cmd_rejections"),
    CommandSpec("slippage", "Execution · Aggregate execution slippage", "Execution", "/slippage", "/slippage", "_cmd_slippage"),
    CommandSpec("fees", "Execution · Aggregate execution fees", "Execution", "/fees", "/fees", "_cmd_fees"),

    # Research and audit monitoring (no job submission)
    CommandSpec("researchstatus", "Research · OpenBB and job-system status", "Research", "/researchstatus", "/researchstatus", "_cmd_research_status"),
    CommandSpec("jobs", "Research · Recent research jobs", "Research", "/jobs [COUNT]", "/jobs 10", "_cmd_jobs"),
    CommandSpec("job", "Research · Inspect one job", "Research", "/job JOB_ID", "/job abcd1234", "_cmd_job"),
    CommandSpec("backtests", "Research · Completed backtest history", "Research", "/backtests [COUNT]", "/backtests 10", "_cmd_backtests"),
    CommandSpec("strategies", "Research · Supported strategy catalogue", "Research", "/strategies", "/strategies", "_cmd_strategies"),
    CommandSpec("intervals", "Research · Supported market horizons", "Research", "/intervals", "/intervals", "_cmd_intervals"),
    CommandSpec("events", "Research · Recent risk/audit events", "Research", "/events [COUNT]", "/events 10", "_cmd_events"),
    CommandSpec("incidents", "Research · Warning and critical events", "Research", "/incidents [COUNT]", "/incidents 10", "_cmd_incidents"),

    # Notification preferences
    CommandSpec("subscribe", "Alerts · Receive operational notifications", "Alerts", "/subscribe", "/subscribe", "_cmd_subscribe", ("unmute",)),
    CommandSpec("unsubscribe", "Alerts · Stop optional notifications", "Alerts", "/unsubscribe", "/unsubscribe", "_cmd_unsubscribe", ("mute",)),
    CommandSpec("subscriptions", "Alerts · Show notification state", "Alerts", "/subscriptions", "/subscriptions", "_cmd_subscriptions", ("alerts",)),
    CommandSpec("watch", "Alerts · Watch execution-cost deterioration", "Alerts", "/watch SYMBOL [NOTIONAL] [MAX_BPS]", "/watch BTCUSDT 100000 25", "_cmd_watch"),
    CommandSpec("unwatch", "Alerts · Remove one or all liquidity watches", "Alerts", "/unwatch [SYMBOL]", "/unwatch BTCUSDT", "_cmd_unwatch"),
    CommandSpec("watches", "Alerts · Show active liquidity watches", "Alerts", "/watches", "/watches", "_cmd_watches"),
    CommandSpec("digest", "Alerts · On-demand portfolio and systems digest", "Alerts", "/digest", "/digest", "_cmd_digest"),

    # Quant risk — read-only, computed by modules/quant_risk.py against the
    # gateway's own book so a number quoted here matches the web tab's.
    CommandSpec("var", "Risk · Portfolio VaR and expected shortfall", "Risk", "/var [1d|4h|1h]", "/var", "_cmd_var", ("cvar",)),
    CommandSpec("riskcontrib", "Risk · Which position carries the risk", "Risk", "/riskcontrib [INTERVAL]", "/riskcontrib", "_cmd_riskcontrib", ("contrib",)),
    CommandSpec("correlation", "Risk · Cross-position correlation matrix", "Risk", "/correlation [INTERVAL]", "/correlation", "_cmd_correlation", ("corr",)),
    CommandSpec("stress", "Risk · Scenario loss on the current book", "Risk", "/stress [SCENARIO]", "/stress", "_cmd_stress", ("scenario",)),
    CommandSpec("varbacktest", "Risk · Has the VaR model been right?", "Risk", "/varbacktest [INTERVAL]", "/varbacktest", "_cmd_varbacktest", ("kupiec",)),
    CommandSpec("rebalance", "Risk · Target weights and the trades to reach them", "Risk", "/rebalance [ew|iv|erc|mv]", "/rebalance", "_cmd_rebalance", ("targets",)),
    CommandSpec("regime", "Risk · Volatility regime for an instrument", "Risk", "/regime SYMBOL [INTERVAL]", "/regime BTCUSDT", "_cmd_regime"),
    CommandSpec("size", "Risk · Kelly position sizing from a win rate", "Risk", "/size WIN_RATE PAYOFF [EQUITY]", "/size 0.55 1.8", "_cmd_size", ("kelly",)),
    CommandSpec("dislocation", "Risk · Cross-venue crossed-book check", "Risk", "/dislocation SYMBOL", "/dislocation BTCUSDT", "_cmd_dislocation", ("arb",)),

    # Controls — gated by TELEGRAM_CONTROL_USER_IDS and a typed challenge.
    CommandSpec("halt", "Controls · Engage the kill switch", "Controls", "/halt [SYMBOL] | /halt CODE", "/halt", "_cmd_halt"),
    CommandSpec("resume", "Controls · Release the kill switch", "Controls", "/resume [SYMBOL] | /resume CODE", "/resume", "_cmd_resume"),
    CommandSpec("flatten", "Controls · Close every open position", "Controls", "/flatten [SYMBOL] | /flatten CODE", "/flatten", "_cmd_flatten"),
)

_COMMAND_BY_NAME: dict[str, CommandSpec] = {}
for _spec in COMMAND_SPECS:
    _COMMAND_BY_NAME[f"/{_spec.name}"] = _spec
    for _alias in _spec.aliases:
        _COMMAND_BY_NAME[f"/{_alias}"] = _spec

BOT_COMMANDS = [(spec.name, spec.description) for spec in COMMAND_SPECS]
BOT_SHORT_DESCRIPTION = "Independent text alerts, portfolio and risk reads, and three gated emergency controls."
BOT_DESCRIPTION = (
    "AlphaEngine Companion is separate from the web workspace. It provides text-only portfolio, "
    "OpenBB market data, execution analytics, research status and operational alerts. It cannot "
    "open a position: there is no /order and no /backtest. Three controls (/halt, /resume, "
    "/flatten) need a separate operator allow-list and a single-use code; /flatten closes "
    "positions through the same pre-trade gates as any order. "
    "Send /commands for the full catalogue."
)


def _category_names() -> list[str]:
    return list(dict.fromkeys(spec.category for spec in COMMAND_SPECS))


def command_catalogue() -> str:
    lines = ["<b>⌨️ AlphaEngine command catalogue</b>",
             "<code>TEXT ONLY · READ EXCEPT GATED CONTROLS</code>", ""]
    for category in _category_names():
        specs = [spec for spec in COMMAND_SPECS if spec.category == category]
        lines.append(f"<b>{esc(category)}</b>")
        lines.append(" · ".join(f"/{spec.name}" for spec in specs))
        lines.append("")
    lines += [
        "Use <code>/help markets</code> for one category or <code>/help quote</code> for exact syntax.",
        "<i>No command opens or controls the web UI.</i>",
    ]
    return "\n".join(lines)


def help_text(query: str | None = None) -> str:
    if not query:
        categories = " · ".join(_category_names())
        return text_card(
            "ℹ️ AlphaEngine Companion",
            "TEXT ONLY · INDEPENDENT FROM WEB UI",
            [
                "Read portfolio state, OpenBB market data, execution quality and system health.",
                "Order submission is intentionally unavailable. The three emergency controls "
                "(/halt, /resume, /flatten) need the operator allow-list and a confirmation code.",
                "",
                f"<b>Categories</b>\n{esc(categories)}",
                "",
                "Try <code>/portfolio</code>, <code>/snapshot AAPL</code>, "
                "<code>/tca BTCUSDT 100000 BUY</code> or <code>/digest</code>.",
            ],
            source="AlphaEngine command registry",
            next_commands="/commands · /help portfolio · /help quote",
        )

    needle = query.strip().lstrip("/").lower()
    for category in _category_names():
        if needle == category.lower():
            specs = [spec for spec in COMMAND_SPECS if spec.category == category]
            lines = [f"<code>{esc(spec.usage)}</code> — {esc(spec.description.split('·', 1)[-1].strip())}" for spec in specs]
            return text_card(
                f"ℹ️ Help · {category}",
                f"{len(specs)} COMMANDS",
                lines,
                source="AlphaEngine command registry",
                next_commands=f"/help {specs[0].name} · /commands",
            )

    spec = _COMMAND_BY_NAME.get(f"/{needle}")
    if spec:
        aliases = f"\nAliases: {', '.join('/' + alias for alias in spec.aliases)}" if spec.aliases else ""
        return text_card(
            f"ℹ️ Help · /{spec.name}",
            spec.category.upper(),
            [
                esc(spec.description.split("·", 1)[-1].strip()),
                f"Usage   <code>{esc(spec.usage)}</code>",
                f"Example <code>{esc(spec.example)}</code>{esc(aliases)}",
            ],
            source="AlphaEngine command registry",
            next_commands=f"/help {spec.category.lower()} · /commands",
        )
    return text_card(
        "⚠️ Help topic not found",
        "UNKNOWN TOPIC",
        [f"No category or command matches <code>{esc(query)}</code>."],
        source="AlphaEngine command registry",
        next_commands="/commands",
    )


HELP_TEXT = help_text()


class TelegramBot:
    def __init__(self, gateway=None, tca=None, queue=None, audit=None) -> None:
        self.gateway = gateway
        self.tca = tca
        self.queue = queue
        self.audit = audit
        self.token = settings.telegram_bot_token
        self.base = f"{settings.telegram_api_base}/bot{self.token}"
        self.mode = settings.resolved_telegram_mode
        self._client: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._watch_task: asyncio.Task | None = None
        self._offset = 0
        self._seen_updates: set[int] = set()
        self._seen_update_order: deque[int] = deque(maxlen=2048)
        self._rate_windows: dict[str, deque[float]] = {}
        # Pending control confirmations, keyed by user. Single-use and
        # time-boxed — see `_issue_challenge`. In-process on purpose: a restart
        # invalidating every pending kill-switch confirmation is the safe
        # direction to fail.
        self._challenges: dict[str, dict[str, Any]] = {}
        self.me: dict[str, Any] | None = None
        self.started_at: float | None = None
        self.updates_handled = 0
        self.last_error: str | None = None
        self._watch_state: dict[tuple[str, str], bool] = {}
        self.alerts_sent = 0

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    @property
    def allowed_user_ids(self) -> list[str]:
        return list(settings.telegram_allowed_user_ids)

    @property
    def control_user_ids(self) -> list[str]:
        return list(settings.telegram_control_user_ids)

    def _may_control(self, user_id: str) -> bool:
        """
        Reading the book must not imply being able to stop the desk.

        Fails closed on an empty list, like the read allow-list — an
        unconfigured deployment has a reporting bot, not a dormant kill switch
        waiting for someone to guess a command.
        """
        return bool(self.control_user_ids) and user_id in self.control_user_ids

    async def api(self, method: str, **params) -> dict[str, Any]:
        if not self._client:
            self._client = httpx.AsyncClient(timeout=40.0)
        try:
            response = await self._client.post(f"{self.base}/{method}", json=params)
            data = response.json()
            if not data.get("ok"):
                description = str(data.get("description") or "Telegram API refused the request")[:180]
                self.last_error = f"{method}: {description}"
                log.warning("telegram %s failed: %s", method, description)
            return data
        except Exception as exc:  # never include the token-bearing request URL
            error_kind = type(exc).__name__
            self.last_error = f"{method}: transport {error_kind}"
            log.error("telegram %s transport error (%s)", method, error_kind)
            return {"ok": False, "description": f"transport {error_kind}"}

    async def send_message(self, chat_id: str | int, text: str) -> dict[str, Any]:
        result: dict[str, Any] = {"ok": True}
        for chunk in split_telegram_html(text):
            result = await self.api(
                "sendMessage",
                chat_id=chat_id,
                text=chunk,
                parse_mode="HTML",
                disable_web_page_preview=True,
            )
        return result

    async def send_photo(self, chat_id: str | int, photo_bytes: bytes, caption: str = "") -> dict[str, Any]:
        """Dispatch visual chart photo to Telegram chat, falling back to text message if photo upload fails."""
        if not self._client:
            self._client = httpx.AsyncClient(timeout=40.0)

        if photo_bytes:
            try:
                files = {"photo": ("chart.png", photo_bytes, "image/png")}
                data: dict[str, str] = {"chat_id": str(chat_id)}
                if caption:
                    data["caption"] = caption[:1000]
                    data["parse_mode"] = "HTML"

                response = await self._client.post(f"{self.base}/sendPhoto", data=data, files=files)
                res = response.json()
                if res.get("ok"):
                    return res
                log.warning("sendPhoto API call failed (%s), falling back to text message", res.get("description"))
            except Exception as exc:
                log.warning("sendPhoto upload exception (%s), falling back to text message", exc)

        return await self.send_message(chat_id, caption)

    async def send_media_group(
        self,
        chat_id: str | int,
        photos: list[tuple[str, bytes]],
        caption: str = "",
    ) -> dict[str, Any]:
        """
        Send several charts as one album.

        `sendPhoto` carries exactly one image, so a command covering three
        symbols could only ever answer about one of them, or spam three
        notifications. `sendMediaGroup` delivers up to ten as a single message.

        The caption rides on the first item — Telegram shows it under the album
        — and every item keeps its own filename so a saved chart is still
        identifiable. Degrades twice: to sequential photos if the album call
        fails, and to the text card if the photos themselves fail, because the
        numbers matter more than the pictures.
        """
        usable = [(name, blob) for name, blob in photos if blob]
        if not usable:
            return await self.send_message(chat_id, caption)
        if len(usable) == 1:
            return await self.send_photo(chat_id, usable[0][1], caption=caption)

        if not self._client:
            self._client = httpx.AsyncClient(timeout=60.0)

        # Telegram caps an album at ten.
        usable = usable[:10]
        try:
            media: list[dict[str, Any]] = []
            files: dict[str, tuple[str, bytes, str]] = {}
            for index, (name, blob) in enumerate(usable):
                key = f"photo{index}"
                item: dict[str, Any] = {"type": "photo", "media": f"attach://{key}"}
                if index == 0 and caption:
                    item["caption"] = caption[:1024]
                    item["parse_mode"] = "HTML"
                media.append(item)
                files[key] = (f"{name}.png", blob, "image/png")

            response = await self._client.post(
                f"{self.base}/sendMediaGroup",
                data={"chat_id": str(chat_id), "media": json.dumps(media)},
                files=files,
            )
            res = response.json()
            if res.get("ok"):
                return res
            log.warning("sendMediaGroup failed (%s), falling back to sequential photos", res.get("description"))
        except Exception as exc:
            log.warning("sendMediaGroup exception (%s), falling back to sequential photos", exc)

        result: dict[str, Any] = {}
        for index, (_, blob) in enumerate(usable):
            result = await self.send_photo(chat_id, blob, caption=caption if index == 0 else "")
        return result

    async def start(self) -> None:
        if not self.enabled:
            log.info("Telegram disabled (no TELEGRAM_BOT_TOKEN); gateway and web remain independent")
            return

        self.started_at = time.time()
        me = await self.api("getMe")
        self.me = me.get("result")
        if self.me:
            log.info("Telegram companion @%s online in %s mode", self.me.get("username"), self.mode)

        if not self.allowed_user_ids:
            log.warning("TELEGRAM_ALLOWED_USER_IDS is empty; bootstrap commands only")

        await self._register_profile()

        if self.mode == "webhook":
            secret = settings.telegram_webhook_secret
            if not settings.public_url.startswith("https://"):
                raise RuntimeError("Telegram webhook mode requires an https PUBLIC_URL")
            if len(secret) < 32 or secret.lower().startswith(("change-me", "alphaengine-dev")):
                raise RuntimeError("Telegram webhook mode requires a unique 32+ character secret")
            webhook_url = f"{settings.public_url}{settings.webhook_path}"
            result = await self.api(
                "setWebhook",
                url=webhook_url,
                secret_token=secret,
                allowed_updates=["message"],
                drop_pending_updates=False,
            )
            log.info("Telegram webhook registration: %s", bool(result.get("ok")))
        else:
            await self.api("deleteWebhook", drop_pending_updates=False)
            self._poll_task = asyncio.create_task(self._poll_loop(), name="telegram-poll")

        self._watch_task = asyncio.create_task(self._watch_loop(), name="telegram-watch")
        log.info("Telegram alert subscribers restored: %d", len(self._subscribers()))

    async def _register_profile(self) -> None:
        await self.api(
            "setMyCommands",
            commands=[{"command": command, "description": description} for command, description in BOT_COMMANDS],
        )
        await self.api("setMyShortDescription", short_description=BOT_SHORT_DESCRIPTION)
        await self.api("setMyDescription", description=BOT_DESCRIPTION)

    async def stop(self) -> None:
        for task in (self._poll_task, self._watch_task):
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if self._client:
            await self._client.aclose()

    async def _poll_loop(self) -> None:
        log.info("Telegram long-polling started")
        backoff = 1.0
        while True:
            try:
                data = await self.api(
                    "getUpdates",
                    offset=self._offset,
                    timeout=25,
                    allowed_updates=["message"],
                )
                if data.get("ok"):
                    backoff = 1.0
                    for update in data.get("result", []):
                        self._offset = update["update_id"] + 1
                        asyncio.create_task(self.handle_update(update))
                else:
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Telegram poll loop error (%s)", type(exc).__name__)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def _remember_update(self, update_id: Any) -> bool:
        if not isinstance(update_id, int):
            return True
        if update_id in self._seen_updates:
            return False
        if len(self._seen_update_order) == self._seen_update_order.maxlen:
            oldest = self._seen_update_order.popleft()
            self._seen_updates.discard(oldest)
        self._seen_update_order.append(update_id)
        self._seen_updates.add(update_id)
        return True

    def _authorised(self, user_id: str) -> bool:
        return bool(self.allowed_user_ids) and user_id in self.allowed_user_ids

    def _rate_allowed(self, user_id: str) -> bool:
        now = time.monotonic()
        window = self._rate_windows.setdefault(user_id, deque())
        while window and now - window[0] > 10.0:
            window.popleft()
        if len(window) >= 15:
            return False
        window.append(now)
        return True

    async def handle_update(self, update: dict[str, Any]) -> None:
        if not self._remember_update(update.get("update_id")):
            return
        self.updates_handled += 1
        chat_id: str | None = None
        command = ""
        try:
            message = update.get("message") or update.get("edited_message")
            if not message:
                return
            chat_id = str(message.get("chat", {}).get("id", ""))
            user = message.get("from") or {}
            user_id = str(user.get("id", ""))
            text = (message.get("text") or "").strip()
            if not chat_id or not user_id or not text.startswith("/"):
                return

            parts = text.split()
            command = parts[0].split("@")[0].lower()
            args = parts[1:]
            authorised = self._authorised(user_id)
            if not authorised and command not in _BOOTSTRAP_COMMANDS:
                await self.send_message(
                    chat_id,
                    text_card(
                        "⛔ Not authorised",
                        "BOOTSTRAP ONLY",
                        [
                            f"User ID <code>{esc(user_id)}</code>",
                            f"Chat ID <code>{esc(chat_id)}</code>",
                            "Ask the operator to add your user ID to <code>TELEGRAM_ALLOWED_USER_IDS</code>.",
                        ],
                        source="AlphaEngine access control",
                        next_commands="/whoami · /help",
                    ),
                )
                return
            if not self._rate_allowed(user_id):
                await self.send_message(
                    chat_id,
                    text_card(
                        "⚠️ Command rate limited",
                        "TRY AGAIN SHORTLY",
                        ["The bot accepts up to 15 commands per user in 10 seconds."],
                        source="AlphaEngine bot guard",
                        next_commands="/help",
                    ),
                )
                return

            actor = f"tg:{user_id}:{user.get('username') or 'user'}"
            log.info("Telegram command %s from user %s", command, user_id)
            await self._dispatch(command, args, chat_id, actor)
        except Exception as exc:
            reference = f"tg-{update.get('update_id', int(time.time()))}"
            log.exception("Telegram command failed (%s, %s)", reference, type(exc).__name__)
            if chat_id:
                with contextlib.suppress(Exception):
                    await self.send_message(
                        chat_id,
                        text_card(
                            "⚠️ Command failed",
                            f"REFERENCE {reference}",
                            ["The request was contained and no trading state was changed."],
                            source="AlphaEngine command handler",
                            next_commands=f"/help {command.lstrip('/')} · /status",
                        ),
                    )

    async def _dispatch(self, command: str, args: list[str], chat_id: str, actor: str) -> None:
        spec = _COMMAND_BY_NAME.get(command)
        if not spec:
            await self.send_message(
                chat_id,
                text_card(
                    "⚠️ Unknown command",
                    "NOT DISPATCHED",
                    [f"No command matches <code>{esc(command)}</code>."],
                    source="AlphaEngine command registry",
                    next_commands="/commands · /help",
                ),
            )
            return
        handler = getattr(self, spec.handler)
        await handler(args, chat_id, actor)

    # ------------------------------------------------------------------ #
    # Parsing / data helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _symbol(args: list[str], index: int = 0) -> str:
        symbol = (args[index] if len(args) > index else settings.symbols[0]).strip().upper()
        if not _SYMBOL_RE.fullmatch(symbol):
            raise ValueError("symbol must contain only letters, numbers, dot or hyphen")
        return symbol

    @staticmethod
    def _symbols(args: list[str], limit: int = 6) -> list[str]:
        """
        Every leading argument that is a symbol, de-duplicated, order kept.

        `_symbol` reads one and `_asset` reads the next positional as the asset
        class, so "/quote BTCUSDT ETHUSDT" used to reject ETHUSDT as an invalid
        asset. Symbol-shaped leading tokens are collected here instead, and
        parsing stops at the first token that is not one — which is where the
        asset keyword lives, so the existing single-symbol form is untouched.
        """
        found: list[str] = []
        for raw in args:
            candidate = raw.strip().upper()
            if candidate.lower() in {"equity", "crypto"}:
                break
            if not _SYMBOL_RE.fullmatch(candidate):
                break
            if candidate not in found:
                found.append(candidate)
            if len(found) >= limit:
                break
        return found or [settings.symbols[0].upper()]

    @staticmethod
    def _asset(symbol: str, args: list[str], index: int = 1) -> str:
        default = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        asset = (args[index].lower() if len(args) > index else default)
        if asset not in {"equity", "crypto"}:
            raise ValueError("asset must be equity or crypto")
        return asset

    @staticmethod
    def _limit(args: list[str], index: int, default: int, maximum: int = 20) -> int:
        try:
            value = int(args[index]) if len(args) > index else default
        except ValueError as exc:
            raise ValueError("count must be an integer") from exc
        if not 1 <= value <= maximum:
            raise ValueError(f"count must be between 1 and {maximum}")
        return value

    @staticmethod
    def _bar_args(args: list[str]) -> tuple[str, str, int, str]:
        symbol = TelegramBot._symbol(args)
        interval = args[1].lower() if len(args) > 1 else "1d"
        if interval not in {"15m", "1h", "4h", "1d"}:
            raise ValueError("interval must be 15m, 1h, 4h or 1d")
        count = TelegramBot._limit(args, 2, 5, 50)
        asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        return symbol, interval, count, asset

    @staticmethod
    def _trade_args(args: list[str]) -> tuple[str, float, str]:
        symbol = TelegramBot._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        side = args[2].upper() if len(args) > 2 else "BUY"
        if notional is None or notional <= 0 or notional > 1_000_000_000:
            raise ValueError("notional must be a positive finite number up to $1bn")
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL")
        return symbol, notional, side

    @staticmethod
    def _openbb_error(capability: str, payload: dict[str, Any]) -> str:
        detail = str(payload.get("error") or payload.get("detail") or "provider returned no data")[:260]
        return text_card(
            f"⚠️ OpenBB · {capability}",
            "UNAVAILABLE",
            [esc(detail)],
            source="OpenBB / yfinance",
            next_commands="/openbb · /status",
        )

    def _portfolio_report(self) -> dict[str, Any]:
        from modules.portfolio import build_portfolio

        return build_portfolio(self.gateway, self.audit)

    # ------------------------------------------------------------------ #
    # Essentials
    # ------------------------------------------------------------------ #
    async def _cmd_start(self, args, chat_id, actor) -> None:
        await self.send_message(chat_id, HELP_TEXT)

    async def _cmd_help(self, args, chat_id, actor) -> None:
        await self.send_message(chat_id, help_text(args[0] if args else None))

    async def _cmd_commands(self, args, chat_id, actor) -> None:
        await self.send_message(chat_id, command_catalogue())

    async def _cmd_about(self, args, chat_id, actor) -> None:
        await self.send_message(
            chat_id,
            text_card(
                "ℹ️ AlphaEngine Companion",
                "INDEPENDENT · TEXT ONLY · READ EXCEPT THREE CONTROLS",
                [
                    "A separate operational channel for portfolio, market, research and execution updates.",
                    "It shares authoritative data services with AlphaEngine but never opens or controls the web UI.",
                    # This card used to say READ-ONLY and that order entry was absent.
                    # `/flatten` submits real orders through `gateway.submit`, so both
                    # were false — and a security note the product itself contradicts is
                    # worse than no note at all.
                    "Sixty-four of its commands only read. The three that do not — /halt, /resume, /flatten "
                    "— need the separate control allow-list and a single-use confirmation code.",
                    "/flatten enters closing orders, and they face the same pre-trade gates as any other order "
                    "rather than going around them. There is no /order and no /backtest.",
                ],
                source="AlphaEngine Telegram service",
                next_commands="/commands · /status · /digest",
            ),
        )

    async def _cmd_whoami(self, args, chat_id, actor) -> None:
        user_id = actor.split(":", 2)[1] if actor.startswith("tg:") else "unknown"
        authorised = self._authorised(user_id)
        await self.send_message(
            chat_id,
            text_card(
                "🪪 Telegram identity",
                "AUTHORISED" if authorised else "NOT YET AUTHORISED",
                [f"User ID <code>{esc(user_id)}</code>", f"Chat ID <code>{esc(chat_id)}</code>"],
                source="Telegram update envelope",
                next_commands="/help" if authorised else "Ask operator to update TELEGRAM_ALLOWED_USER_IDS",
            ),
        )

    async def _cmd_version(self, args, chat_id, actor) -> None:
        await self.send_message(
            chat_id,
            text_card(
                "🏷 AlphaEngine runtime",
                settings.environment.upper(),
                [
                    f"Version <code>{esc(settings.version)}</code>",
                    f"Bot mode <code>{esc(self.mode)}</code>",
                    f"Text commands <code>{len(COMMAND_SPECS)}</code>",
                ],
                source="AlphaEngine configuration",
                next_commands="/status · /commands",
            ),
        )

    async def _cmd_ping(self, args, chat_id, actor) -> None:
        started = time.perf_counter()
        elapsed_ms = (time.perf_counter() - started) * 1000
        await self.send_message(
            chat_id,
            text_card(
                "🏓 Command path",
                "RESPONSIVE",
                [f"Dispatch overhead <code>{elapsed_ms:.2f} ms</code>"],
                source="AlphaEngine Telegram process",
                next_commands="/status",
            ),
        )

    async def _cmd_status(self, args, chat_id, actor) -> None:
        from modules import research

        feed_health = self.tca.health() if self.tca else {}
        state = self.gateway.state() if self.gateway else None
        openbb = await research.openbb_status_async()
        lines: list[str] = []
        if state:
            lines.append(f"Trading state  <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code>")
            lines.append(f"Equity         <code>{_money(state.equity)}</code>")
        feeds = feed_health.get("feeds", [])
        live_feeds = sum(1 for feed in feeds if feed.get("connected"))
        lines.append(f"Market feeds   <code>{live_feeds}/{len(feeds)} connected</code>")
        lines.append(f"Synthetic book <code>{'ACTIVE' if feed_health.get('synthetic_active') else 'off'}</code>")
        lines.append(f"OpenBB         <code>{'READY' if openbb.get('ok') else 'UNAVAILABLE'}</code>")
        if self.queue:
            queue = self.queue.stats()
            lines.append(f"Research queue <code>{queue['backend']} · {queue['total']} jobs</code>")
        status = "DEGRADED" if (not openbb.get("ok") or live_feeds < len(feeds)) else "HEALTHY"
        await self.send_message(
            chat_id,
            text_card(
                "⚙️ AlphaEngine systems",
                status,
                lines,
                source="Gateway + TCA engine + OpenBB",
                next_commands="/feedstatus · /openbb · /risk",
            ),
        )

    # ------------------------------------------------------------------ #
    # 8 Desk Role Tabs (Explicit Vercel UI Tab mapping & Visual Charts)
    # ------------------------------------------------------------------ #
    # Shared real-telemetry readers for the desk-role cards. Every one of these
    # cards previously shipped a fixed script — "Sharpe Ratio 2.14", "Uptime
    # 99.99%", "Quota 84% Remaining", "Binance 58% / Bybit 42%" — under a
    # <b>LIVE</b> header, beside a chart drawn from `sin(i * 0.3)`. None of it
    # was measured. The web workspace refuses to substitute a number it did not
    # observe; the companion answering the same questions with invented ones is
    # the same lie in a channel where it is harder to check.
    #
    # These read the sources the rest of the bot already uses. Where a source is
    # unavailable the card says so and drops the chart, rather than falling back
    # to a plausible shape.

    def _subsystem_lines(self) -> tuple[list[str], str]:
        """Trading state, feeds and services — the real ones."""
        feed_health = self.tca.health() if self.tca else {}
        state = self.gateway.state() if self.gateway else None
        feeds = feed_health.get("feeds", [])
        live_feeds = sum(1 for feed in feeds if feed.get("connected"))
        lines: list[str] = []
        if state:
            lines.append(f"Trading state  <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code>")
            lines.append(f"Equity         <code>{_money(state.equity)}</code>")
            lines.append(f"Daily P&amp;L      <code>{_money(state.daily_pnl)}</code>")
        else:
            lines.append("Trading state  <code>gateway unavailable</code>")
        lines.append(f"Market feeds   <code>{live_feeds}/{len(feeds)} connected</code>")
        if feed_health.get("synthetic_active"):
            lines.append("Book source    <code>SYNTHETIC — generated, not a venue</code>")
        uptime = feed_health.get("uptime_s")
        if uptime:
            lines.append(f"Engine uptime  <code>{uptime:.0f}s</code>")
        status = "DEGRADED" if (not state or live_feeds < len(feeds)) else "LIVE"
        return lines, status

    def _latency_rows(self) -> list[tuple[str, float, float, float, int]]:
        """Per-route p50/p95/p99 actually observed by the gateway middleware."""
        from modules import metrics

        rows = []
        for route, stats in metrics.request_latency_summary().items():
            rows.append((route, stats["p50"], stats["p95"], stats["p99"], int(stats["samples"])))
        rows.sort(key=lambda row: row[3], reverse=True)
        return rows[:6]

    async def _closes_for(self, symbol: str, asset: str, interval: str = "1d", count: int = 60) -> list[float]:
        try:
            payload = await self._bars_payload(symbol, interval, count, asset)
        except Exception:
            return []
        if not payload.get("ok"):
            return []
        return [
            value for value in (_finite(row.get("close")) for row in (payload.get("data") or []))
            if value is not None
        ]

    async def _cmd_tab_overview(self, args, chat_id, actor) -> None:
        lines, status = self._subsystem_lines()
        positions: list[dict[str, Any]] = []
        if self.gateway:
            try:
                positions = self._portfolio_report().get("exposure", {}).get("positions", []) or []
            except Exception:
                lines.append("<i>The book could not be read, so there is no exposure chart.</i>")
        charts: list[tuple[str, bytes]] = []

        exposure = generate_bars_chart_png(
            "Gross exposure by symbol (USD)",
            [str(position.get("symbol")) for position in positions[:8]],
            [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
            "Notional (USD)",
            horizontal=True,
            value_fmt="{:,.0f}",
        )
        if exposure:
            charts.append(("exposure", exposure))

        latency = self._latency_rows()
        latency_chart = generate_bars_chart_png(
            "Gateway route latency p99 (ms, observed)",
            [route for route, *_ in latency],
            [p99 for _, _, _, p99, _ in latency],
            "p99 (ms)",
            horizontal=True,
            value_fmt="{:.0f}ms",
        )
        if latency_chart:
            charts.append(("latency", latency_chart))
        else:
            lines.append("<i>No gateway request has been timed yet, so no latency chart.</i>")

        if not positions:
            lines.append("<i>The book holds no position, so there is no exposure chart.</i>")

        text = text_card(
            "🌐 Desk overview",
            status,
            lines,
            source="Gateway + TCA engine + request middleware",
            next_commands="/research · /execution · /portfolio · /risk · /data · /reliability · /developer",
        )
        await self.send_media_group(chat_id, charts, caption=text)

    async def _cmd_tab_research(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        asset = self._asset(symbol, args)
        closes = await self._closes_for(symbol, asset)
        if len(closes) < 2:
            await self.send_message(chat_id, text_card(
                f"🔬 Research · {esc(symbol)}", "NO BARS",
                ["No daily bars were returned, so nothing can be measured for this symbol."],
                source="OpenBB / yfinance", next_commands="/quote " + symbol,
            ))
            return

        returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
        mean = sum(returns) / len(returns) if returns else 0.0
        variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1) if len(returns) > 1 else 0.0
        vol = math.sqrt(variance) * math.sqrt(365)
        total = closes[-1] / closes[0] - 1 if closes[0] else 0.0
        peak, worst = closes[0], 0.0
        for close in closes:
            peak = max(peak, close)
            worst = min(worst, close / peak - 1 if peak else 0.0)

        lines = [
            f"Window      <code>{len(closes)} daily closes</code>",
            f"Return      <code>{_percent(total, signed=True)}</code>",
            f"Volatility  <code>{_percent(vol)}</code> annualised",
            f"Max drawdown <code>{_percent(worst)}</code>",
            "<i>Descriptive statistics of the price series only — this is not a "
            "backtest and carries no verdict. /backtests lists scored candidates the desk has already run.</i>",
        ]
        charts = [(f"{symbol}-price", generate_series_chart_png(symbol, closes, "1d", "OpenBB / yfinance"))]
        drawdown = generate_drawdown_chart_png(symbol, closes)
        if drawdown:
            charts.append((f"{symbol}-drawdown", drawdown))

        await self.send_media_group(chat_id, charts, caption=text_card(
            f"🔬 Research · {esc(symbol)}", "MEASURED", lines,
            source="OpenBB / yfinance", next_commands=f"/backtests · /quote {symbol}",
        ))

    async def _cmd_tab_execution(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else settings.symbols[0].upper()
        books = [book for book in self.tca.get_books(symbol, depth=20) if book.mid] if self.tca else []
        if not books:
            await self.send_message(chat_id, text_card(
                f"⚡ Execution · {esc(symbol)}", "NO LIVE BOOK",
                ["No venue currently has a fresh book for this symbol, so there is nothing to route against."],
                source="TCA engine", next_commands="/feedstatus",
            ))
            return

        bids: list[tuple[float, float]] = []
        asks: list[tuple[float, float]] = []
        lines: list[str] = []
        synthetic = False
        for book in books:
            # `get_books` hands back the VenueBook schema, not the raw BookState:
            # the ladders are lists of BookLevel and the depth totals are already
            # computed fields. Reaching for `.items()` and `depth_usd()` here is
            # reaching for the internal type.
            synthetic = synthetic or bool(getattr(book, "synthetic", False))
            bids.extend((level.price, level.size) for level in book.bids)
            asks.extend((level.price, level.size) for level in book.asks)
            lines.append(
                f"<code>{esc(book.venue):<9}</code> mid <code>{_number(book.mid)}</code>"
                f" · spread <code>{_number(book.spread_bps, 2)}</code> bps"
                f" · depth <code>{_money(book.depth_usd_bid)}</code> / <code>{_money(book.depth_usd_ask)}</code>"
            )
        if synthetic:
            lines.append("<i>At least one venue is serving a synthetic book — generated, not a venue.</i>")

        chart = generate_depth_chart_png(symbol, bids, asks)
        charts = [(f"{symbol}-depth", chart)] if chart else []
        await self.send_media_group(chat_id, charts, caption=text_card(
            f"⚡ Execution · {esc(symbol)}", "SYNTHETIC BOOK" if synthetic else "LIVE BOOK", lines,
            source="TCA engine", next_commands=f"/book {symbol} · /tca {symbol} 100000 BUY",
        ))

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
        ))

    async def _cmd_tab_developer(self, args, chat_id, actor) -> None:
        routes = _committed_route_counts()
        lines = [
            f"Build          <code>{esc(settings.version)}</code> · <code>{esc(settings.environment)}</code>",
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
            "💻 Developer", "CONFIGURED", lines,
            source="Committed CI configuration", next_commands="/version · /commands",
        ))

    # ------------------------------------------------------------------ #
    # Portfolio manager
    # ------------------------------------------------------------------ #
    async def _cmd_portfolio(self, args, chat_id, actor) -> None:
        from modules.portfolio import format_for_telegram

        report = self._portfolio_report()
        text = format_for_telegram(report)
        positions = report.get("exposure", {}).get("positions", []) or []

        # This replaced a fixed three-slice pie that never read the book it was
        # captioning. These are the book's own notionals and its own daily P&L
        # per symbol.
        charts: list[tuple[str, bytes]] = []
        allocation = generate_bars_chart_png(
            "Allocation by symbol (USD notional)",
            [str(position.get("symbol")) for position in positions[:8]],
            [_finite(position.get("notional")) or 0.0 for position in positions[:8]],
            "Notional (USD)", horizontal=True, value_fmt="{:,.0f}",
        )
        if allocation:
            charts.append(("allocation", allocation))

        pnl_values = [_finite(position.get("unrealized_pnl")) for position in positions[:8]]
        pnl = generate_bars_chart_png(
            "Unrealised P&L by symbol (USD)",
            [str(position.get("symbol")) for position in positions[:8]],
            pnl_values,
            "Unrealised P&L (USD)",
            colours=['#00e676' if (value or 0) >= 0 else '#ff5252' for value in pnl_values],
            horizontal=True, value_fmt="{:,.0f}",
        )
        if pnl:
            charts.append(("pnl", pnl))

        await self.send_media_group(chat_id, charts, caption=text[:1024])

    async def _cmd_positions(self, args, chat_id, actor) -> None:
        state = self.gateway.state()
        symbol = self._symbol(args) if args else None
        positions = [position for position in state.positions if not symbol or position.symbol == symbol]
        if not positions:
            message = f"No open position for <code>{esc(symbol)}</code>." if symbol else "The book is flat."
            await self.send_message(chat_id, text_card("📌 Positions", "FLAT", [message], source="Risk gateway", next_commands="/portfolio"))
            return
        lines = []
        for position in sorted(positions, key=lambda row: -row.notional):
            side = "LONG" if position.quantity > 0 else "SHORT"
            lines += [
                f"<b>{esc(position.symbol)} · {side}</b>",
                f"Qty <code>{position.quantity:+.6f}</code> · Avg <code>{_number(position.avg_price)}</code> · Mark <code>{_number(position.mark_price)}</code>",
                f"Notional <code>{_money(position.notional)}</code> · uPnL <code>{_money(position.unrealized_pnl, signed=True)}</code>",
            ]
        await self.send_message(chat_id, text_card("📌 Open positions", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/exposure · /pnl · /concentration"))

    async def _cmd_pnl(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        equity = report["equity"]
        lines = [
            f"Equity       <code>{_money(equity['current'])}</code>",
            f"Day P&amp;L     <code>{_money(equity['daily_pnl'], signed=True)}</code> · <code>{_percent(equity['daily_return'], signed=True)}</code>",
            f"Realised     <code>{_money(equity['realized_pnl'], signed=True)}</code>",
            f"Unrealised   <code>{_money(equity['unrealized_pnl'], signed=True)}</code>",
        ]
        await self.send_message(chat_id, text_card("💹 Portfolio P&L", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/positions · /attribution"))

    async def _cmd_exposure(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        exposure = report["exposure"]
        lines = [
            f"Gross       <code>{_money(exposure['gross'])}</code>",
            f"Net         <code>{_money(exposure['net'], signed=True)}</code>",
            f"Leverage    <code>{_number(exposure['leverage'])}x</code>",
            f"Positions   <code>{len(exposure['positions'])}</code>",
        ]
        for position in exposure["positions"][:8]:
            lines.append(f"{esc(position['symbol']):<10} <code>{_money(position['notional'])}</code> · <code>{_percent(position['share_of_gross'])}</code>")
        await self.send_message(chat_id, text_card("🧭 Portfolio exposure", "LIVE GATEWAY STATE", lines, source="Risk gateway", next_commands="/concentration · /headroom"))

    async def _cmd_concentration(self, args, chat_id, actor) -> None:
        concentration = self._portfolio_report()["concentration"]
        lines = [
            f"Largest symbol      <code>{esc(concentration['largest_symbol'] or '—')}</code>",
            f"Largest share       <code>{_percent(concentration['largest_share'])}</code>",
            f"Top-two share       <code>{_percent(concentration['top_two_share'])}</code>",
            f"HHI                 <code>{_number(concentration['hhi'], 4)}</code>",
            f"Effective positions <code>{_number(concentration['effective_positions'])}</code>",
        ]
        await self.send_message(chat_id, text_card("🎯 Concentration", "LIVE GATEWAY STATE", lines, source="Portfolio service", next_commands="/positions · /headroom"))

    async def _cmd_headroom(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        budget = report["risk_budget"]
        gross = budget["gross_exposure"]
        drawdown = budget["daily_drawdown"]
        constraint, utilisation = budget["binding_constraint"]
        lines = [
            f"Gross remaining  <code>{_money(gross['remaining'])}</code> · <code>{_percent(gross['utilisation'])}</code> used",
            f"Drawdown cushion <code>{_money(drawdown['cushion_usd'])}</code> · <code>{_percent(drawdown['utilisation'])}</code> used",
            f"Binding limit    <code>{esc(constraint)}</code> · <code>{_percent(utilisation)}</code>",
        ]
        for position in report["exposure"]["positions"][:8]:
            cap = position["symbol_limit"]
            lines.append(f"{esc(position['symbol']):<10} remaining <code>{_money(cap['remaining'])}</code>")
        await self.send_message(chat_id, text_card("🛡 Risk headroom", "AUTHORITATIVE LIMITS", lines, source="Risk gateway", next_commands="/risk · /limits"))

    async def _cmd_risk(self, args, chat_id, actor) -> None:
        state = self.gateway.state()
        used = max(0.0, min(1.0, state.drawdown_budget_used_pct))
        filled = int(used * 12)
        lines = [
            f"Equity      <code>{_money(state.equity)}</code>",
            f"Day P&amp;L    <code>{_money(state.daily_pnl, signed=True)}</code>",
            f"Drawdown   <code>{_percent(state.daily_drawdown_pct)}</code> / <code>{_percent(state.limits['max_daily_drawdown_pct'])}</code>",
            f"Budget     <code>{'█' * filled}{'░' * (12 - filled)}</code> {_percent(used)}",
            f"Gross       <code>{_money(state.gross_exposure)}</code> / <code>{_money(state.limits['max_gross_exposure_usd'])}</code>",
            f"Orders      <code>{state.orders_accepted} accepted · {state.orders_rejected} rejected</code>",
        ]
        status = "HALTED" if state.kill_switch_active else "LIVE"
        if state.kill_switch_active:
            lines.insert(0, f"Reason <code>{esc(state.kill_reason or 'not provided')}</code>")

        # The budget bar was drawn in block characters for the drawdown only.
        # Every hard limit the gateway enforces has a utilisation, and which one
        # binds first is the whole question — so all of them are plotted against
        # the same 100% scale, from the gateway's own numbers.
        gross_limit = state.limits.get("max_gross_exposure_usd") or 0.0
        dd_limit = state.limits.get("max_daily_drawdown_pct") or 0.0
        utilisations = [
            ("Daily drawdown", (state.daily_drawdown_pct / dd_limit * 100) if dd_limit else None),
            ("Gross exposure", (state.gross_exposure / gross_limit * 100) if gross_limit else None),
            ("Drawdown budget", used * 100),
        ]
        chart = generate_bars_chart_png(
            "Risk limit utilisation (% of hard limit)",
            [label for label, value in utilisations if value is not None],
            [value for _, value in utilisations if value is not None],
            "Utilisation (%)",
            colours=[
                '#ff5252' if (value or 0) >= 90 else '#f59e0b' if (value or 0) >= 70 else '#00e676'
                for _, value in utilisations if value is not None
            ],
            horizontal=True, value_fmt="{:.1f}%",
        )
        await self.send_media_group(chat_id, [("limits", chart)] if chart else [], caption=text_card(
            "🛡 Risk gateway", status, lines,
            source="Authoritative risk process", next_commands="/headroom · /positions · /incidents",
        ))

    async def _cmd_limits(self, args, chat_id, actor) -> None:
        limits = self.gateway.state().limits
        lines = [f"<code>{esc(key):<28}</code> {value:,.4g}" for key, value in limits.items()]
        await self.send_message(chat_id, text_card("🧱 Hard risk limits", "DEPLOY-TIME CONFIGURATION", lines, source="Risk gateway settings", next_commands="/headroom · /risk"))

    async def _cmd_attribution(self, args, chat_id, actor) -> None:
        report = self._portfolio_report()
        strategies = report["attribution"]["by_strategy"]
        symbols = report["attribution"]["by_symbol"]
        lines = ["<b>By strategy</b>"]
        if strategies:
            for row in strategies[:8]:
                lines.append(f"{esc(row.get('strategy') or 'unassigned')} · <code>{row.get('filled') or 0} fills</code> · <code>{_money(row.get('notional'))}</code> · <code>{_number(row.get('avg_slippage_bps'), signed=True)} bps</code>")
        else:
            lines.append("No strategy flow recorded.")
        lines.append("\n<b>By symbol</b>")
        for row in symbols[:8]:
            lines.append(f"{esc(row.get('symbol'))} · <code>{row.get('filled') or 0} fills</code> · <code>{row.get('rejected') or 0} rejected</code>")
        await self.send_message(chat_id, text_card("🧾 Portfolio attribution", "AUDIT-RECONSTRUCTED", lines, source="DuckDB audit log", next_commands="/orders · /slippage · /fees"))

    # ------------------------------------------------------------------ #
    # OpenBB / market data
    # ------------------------------------------------------------------ #
    async def _cmd_openbb(self, args, chat_id, actor) -> None:
        from modules import research

        status = await research.openbb_status_async()
        lines = [
            f"Provider <code>{esc(status.get('provider') or '—')}</code>",
            f"Quote     <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"Bars      <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"News      <code>{'available' if status.get('ok') else 'unavailable'}</code>",
            f"Fundamentals <code>{'available' if status.get('ok') else 'unavailable'}</code>",
        ]
        if status.get("detail"):
            lines.append(f"Detail <code>{esc(str(status['detail'])[:240])}</code>")
        await self.send_message(chat_id, text_card("🔌 OpenBB", "READY" if status.get("ok") else "UNAVAILABLE", lines, source="OpenBB provider extension", next_commands="/quote AAPL · /snapshot AAPL · /status"))

    async def _quote_payload(self, symbol: str, asset: str) -> dict[str, Any]:
        from modules import research

        return await research.quote(symbol, asset)

    async def _quote_line(self, symbol: str, asset: str) -> tuple[str | None, dict[str, Any]]:
        """One symbol's quote row for a multi-symbol card, plus its raw payload."""
        payload = await self._quote_payload(symbol, asset)
        if not payload.get("ok"):
            return None, payload
        data = payload["data"]
        row = (
            f"<code>{esc(symbol):<10}</code> "
            f"<code>{_number(data.get('price'))}</code> "
            f"· <code>{_number(data.get('change_percent'), signed=True)}%</code> "
            f"· H <code>{_number(data.get('high'))}</code> "
            f"· L <code>{_number(data.get('low'))}</code>"
        )
        return row, payload

    async def _symbol_chart(self, symbol: str, asset: str) -> bytes | None:
        """A close-series chart for one symbol, or nothing if the bars are not there."""
        try:
            payload = await self._bars_payload(symbol, "1d", 30, asset)
        except Exception:
            return None
        if not payload.get("ok"):
            return None
        closes = [
            value for value in (_finite(row.get("close")) for row in (payload.get("data") or []))
            if value is not None
        ]
        if len(closes) < 2:
            return None
        return generate_series_chart_png(symbol, closes, "1d", "OpenBB / yfinance")

    async def _cmd_quote(self, args, chat_id, actor) -> None:
        """
        Quote one symbol or several.

        "/quote BTCUSDT ETHUSDT SOLUSDT" now answers about all three in one
        message: a row per symbol in the card, and a chart per symbol in a
        single album, rather than one symbol's picture standing in for a watch
        list. A symbol whose bars are unavailable keeps its quote row and simply
        contributes no chart — a missing series is not worth suppressing the
        numbers over.
        """
        symbols = self._symbols(args)
        asset_index = len(symbols) if len(symbols) > 1 else 1
        rows: list[str] = []
        charts: list[tuple[str, bytes]] = []
        failures: list[str] = []
        delayed = False

        for symbol in symbols:
            asset = self._asset(symbol, args, index=asset_index)
            row, payload = await self._quote_line(symbol, asset)
            if row is None:
                failures.append(symbol)
                if len(symbols) == 1:
                    await self.send_message(chat_id, self._openbb_error("quote", payload))
                    return
                continue
            rows.append(row)
            delayed = delayed or bool(payload["data"].get("delayed"))
            chart = await self._symbol_chart(symbol, asset)
            if chart:
                charts.append((symbol, chart))

        if not rows:
            await self.send_message(chat_id, self._openbb_error("quote", {"error": "no symbol returned a quote"}))
            return

        if failures:
            rows.append(f"<i>No quote for {esc(', '.join(failures))}</i>")
        if len(charts) < len(rows) - (1 if failures else 0):
            rows.append("<i>Symbols without a chart had fewer than two daily bars.</i>")

        title = f"💹 {symbols[0]} quote" if len(symbols) == 1 else f"💹 {len(rows) - (1 if failures else 0)} quotes"
        card = text_card(
            title,
            "DELAYED" if delayed else "LIVE",
            rows,
            source="OpenBB / yfinance",
            next_commands=f"/bars {symbols[0]} 1d 5 · /snapshot {symbols[0]}",
        )
        await self.send_media_group(chat_id, charts, caption=card)

    async def _bars_payload(self, symbol: str, interval: str, count: int, asset: str) -> dict[str, Any]:
        from modules import research

        return await research.bars(symbol, asset, interval, count)

    async def _cmd_bars(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("bars", payload))
            return
        rows = payload.get("data") or []
        if not rows:
            await self.send_message(chat_id, self._openbb_error("bars", {"error": "no bars returned"}))
            return
        lines = []
        for row in rows[-min(count, 10):]:
            date_label = str(row.get("date") or "")[:16]
            lines.append(f"<code>{esc(date_label):<16}</code> O {_number(row.get('open'))} · H {_number(row.get('high'))} · L {_number(row.get('low'))} · C {_number(row.get('close'))}")
        await self.send_message(chat_id, text_card(f"🕯 {symbol} · {interval}", f"{len(rows)} DELAYED BARS", lines, source="OpenBB / yfinance", next_commands=f"/trend {symbol} {interval} {count} · /range {symbol} {interval} {count}"))

    async def _cmd_trend(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        count = max(2, count)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        if len(rows) < 2:
            await self.send_message(chat_id, self._openbb_error("trend", payload if not payload.get("ok") else {"error": "at least two bars are required"}))
            return
        first = _finite(rows[0].get("close"))
        last = _finite(rows[-1].get("close"))
        change = (last / first - 1) if first and last is not None else None
        direction = "UP" if change is not None and change > 0 else "DOWN" if change is not None and change < 0 else "FLAT"
        lines = [f"First close <code>{_number(first)}</code>", f"Last close  <code>{_number(last)}</code>", f"Return      <code>{_percent(change, signed=True)}</code>", f"Direction   <code>{direction}</code>"]
        await self.send_message(chat_id, text_card(f"📈 {symbol} trend · {interval}", f"{len(rows)} DELAYED BARS", lines, source="OpenBB / yfinance", next_commands=f"/range {symbol} {interval} {count} · /volume {symbol} {interval} {count}"))

    async def _cmd_range(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        highs = [value for row in rows if (value := _finite(row.get("high"))) is not None]
        lows = [value for row in rows if (value := _finite(row.get("low"))) is not None]
        if not highs or not lows:
            await self.send_message(chat_id, self._openbb_error("range", payload if not payload.get("ok") else {"error": "no valid high/low values"}))
            return
        high, low = max(highs), min(lows)
        width = (high / low - 1) if low else None
        lines = [f"High        <code>{_number(high)}</code>", f"Low         <code>{_number(low)}</code>", f"Range width <code>{_percent(width)}</code>", f"Observations <code>{len(rows)}</code>"]
        await self.send_message(chat_id, text_card(f"↕️ {symbol} range · {interval}", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/bars {symbol} {interval} 5"))

    async def _cmd_volume(self, args, chat_id, actor) -> None:
        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, count, asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        volumes = [value for row in rows if (value := _finite(row.get("volume"))) is not None]
        if not volumes:
            await self.send_message(chat_id, self._openbb_error("volume", payload if not payload.get("ok") else {"error": "no volume values"}))
            return
        average = sum(volumes) / len(volumes)
        ratio = volumes[-1] / average if average else None
        lines = [f"Latest  <code>{_number(volumes[-1], 0)}</code>", f"Average <code>{_number(average, 0)}</code>", f"Ratio   <code>{_number(ratio)}x</code>", f"Bars    <code>{len(volumes)}</code>"]
        await self.send_message(chat_id, text_card(f"🔊 {symbol} volume · {interval}", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/trend {symbol} {interval} {count}"))

    async def _cmd_news(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        count = self._limit(args, 1, 5, 10)
        payload = await research.news([symbol], count)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("news", payload))
            return
        items = payload.get("data") or []
        if not items:
            await self.send_message(chat_id, self._openbb_error("news", {"error": "no headlines returned"}))
            return
        lines = []
        for index, item in enumerate(items[:count], 1):
            lines.append(f"<b>{index}. {esc(item.get('title') or 'Untitled')}</b>\n   {esc(item.get('source') or 'OpenBB')} · <code>{esc(str(item.get('date') or '')[:19])}</code>")
        await self.send_message(chat_id, text_card(f"📰 {symbol} headlines", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/snapshot {symbol} · /quote {symbol}"))

    async def _cmd_fundamentals(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        payload = await research.fundamentals(symbol)
        if not payload.get("ok"):
            await self.send_message(chat_id, self._openbb_error("fundamentals", payload))
            return
        data = payload["data"]
        lines = [
            f"Name       <code>{esc(data.get('name') or '—')}</code>",
            f"Exchange   <code>{esc(data.get('exchange') or '—')}</code>",
            f"Sector     <code>{esc(data.get('sector') or '—')}</code>",
            f"Industry   <code>{esc(data.get('industry') or '—')}</code>",
            f"Market cap <code>{_money(data.get('market_cap'))}</code>",
            f"P/E        <code>{_number(data.get('pe_ratio'))}</code>",
            f"EPS        <code>{_number(data.get('eps'))}</code>",
            f"Beta       <code>{_number(data.get('beta'))}</code>",
        ]
        description = str(data.get("description") or "").strip()
        if description:
            lines.append(f"\n{esc(description[:420])}{'…' if len(description) > 420 else ''}")
        await self.send_message(chat_id, text_card(f"🏢 {symbol} fundamentals", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/quote {symbol} · /news {symbol} 5"))

    async def _cmd_snapshot(self, args, chat_id, actor) -> None:
        from modules import research

        symbol = self._symbol(args)
        asset = self._asset(symbol, args)
        quote, fundamentals, news = await asyncio.gather(
            research.quote(symbol, asset),
            research.fundamentals(symbol) if asset == "equity" else asyncio.sleep(0, result={"ok": False}),
            research.news([symbol], 3),
        )
        if not quote.get("ok") and not fundamentals.get("ok") and not news.get("ok"):
            await self.send_message(chat_id, self._openbb_error("snapshot", quote))
            return
        lines: list[str] = []
        if quote.get("ok"):
            data = quote["data"]
            lines += ["<b>Market</b>", f"Price <code>{_number(data.get('price'))}</code> · Change <code>{_number(data.get('change_percent'), signed=True)}%</code>"]
        if fundamentals.get("ok"):
            data = fundamentals["data"]
            lines += ["\n<b>Company</b>", f"{esc(data.get('name') or symbol)} · {esc(data.get('sector') or 'sector n/a')}", f"Market cap <code>{_money(data.get('market_cap'))}</code> · P/E <code>{_number(data.get('pe_ratio'))}</code>"]
        if news.get("ok"):
            lines.append("\n<b>Headlines</b>")
            for item in (news.get("data") or [])[:3]:
                lines.append(f"• {esc(item.get('title') or 'Untitled')}")
        await self.send_message(chat_id, text_card(f"🔎 {symbol} research snapshot", "DELAYED", lines, source="OpenBB / yfinance", next_commands=f"/quote {symbol} · /bars {symbol} 1d 5 · /news {symbol} 5"))

    async def _cmd_symbols(self, args, chat_id, actor) -> None:
        lines = [f"Tracked crypto <code>{', '.join(settings.symbols)}</code>", "Equity examples <code>AAPL, MSFT, NVDA, SPY</code>", "Assets <code>equity · crypto</code>", "Intervals <code>15m · 1h · 4h · 1d</code>"]
        await self.send_message(chat_id, text_card("🔤 Instruments", "REFERENCE", lines, source="AlphaEngine configuration", next_commands="/quote AAPL · /book BTCUSDT · /intervals"))

    # ------------------------------------------------------------------ #
    # Execution analytics
    # ------------------------------------------------------------------ #
    # ------------------------------------------------------------------ #
    # Controls — the only commands that change risk state
    # ------------------------------------------------------------------ #
    #
    # Three gates, because a chat message is an unusually easy thing to send by
    # accident and an unusually easy thing to forward:
    #
    #   1. TELEGRAM_CONTROL_USER_IDS — separate from the read allow-list, empty
    #      by default. Being able to see the book does not imply being able to
    #      stop the desk.
    #   2. A per-user, single-use challenge code that expires. `/halt` alone
    #      never acts; it returns a code that `/halt <code>` consumes. A copied
    #      or forwarded command cannot fire, because the code is bound to the
    #      user who asked and dies after one use.
    #   3. The gateway's own audit log, which records the actor either way.

    _CHALLENGE_TTL_SECONDS = 90.0

    def _issue_challenge(self, user_id: str, action: str, symbol: str | None) -> str:
        import secrets

        code = f"{secrets.randbelow(9000) + 1000}"
        self._challenges[user_id] = {
            "code": code, "action": action, "symbol": symbol,
            "expires": time.monotonic() + self._CHALLENGE_TTL_SECONDS,
        }
        return code

    def _consume_challenge(self, user_id: str, action: str, code: str) -> tuple[bool, str | None, str]:
        """Returns ``(ok, symbol, reason)``. Single use: the entry is dropped either way."""
        pending = self._challenges.pop(user_id, None)
        if not pending:
            return False, None, "No pending confirmation — run the command without a code first."
        if time.monotonic() > float(pending["expires"]):
            return False, None, "That confirmation expired. Start again."
        if pending["action"] != action:
            return False, None, f"That code was issued for /{pending['action']}, not /{action}."
        if pending["code"] != code:
            return False, None, "Wrong code."
        return True, pending["symbol"], ""

    async def _control(self, action: str, args, chat_id, actor) -> None:
        user_id = str(actor)
        if not self._may_control(user_id):
            await self.send_message(chat_id, text_card(
                f"⛔ /{action} not permitted", "CONTROL ALLOW-LIST",
                [
                    f"User ID <code>{esc(user_id)}</code> may read this book but not change it.",
                    "Control commands need <code>TELEGRAM_CONTROL_USER_IDS</code>, which is separate from the read allow-list and empty by default.",
                ],
                source="Risk gateway", next_commands="/risk · /headroom"))
            return

        code_arg = args[0] if args and args[0].isdigit() and len(args[0]) == 4 else None
        symbol_arg = None
        if args and not code_arg:
            candidate = args[0].upper()
            if re.fullmatch(r"[A-Z0-9.\-]{1,20}", candidate):
                symbol_arg = candidate

        if not code_arg:
            code = self._issue_challenge(user_id, action, symbol_arg)
            scope = f"<code>{esc(symbol_arg)}</code>" if symbol_arg else "the whole book"
            impact = {
                "halt": "Every subsequent pre-trade check rejects until it is released.",
                "resume": "Pre-trade checks start accepting again.",
                "flatten": "A closing MARKET order is submitted for every open position, through the same risk gates as any other order.",
            }[action]
            await self.send_message(chat_id, text_card(
                f"⚠ Confirm /{action}", "ACTION NOT YET TAKEN",
                [
                    f"Scope <b>{scope}</b>",
                    impact,
                    "",
                    f"Reply <code>/{action} {code}</code> within {int(self._CHALLENGE_TTL_SECONDS)}s.",
                    "<i>The code is single-use and tied to your user ID, so a forwarded message cannot fire it.</i>",
                ],
                source="Risk gateway", next_commands="/risk · /positions"))
            return

        ok, symbol, reason = self._consume_challenge(user_id, action, code_arg)
        if not ok:
            await self.send_message(chat_id, text_card(f"✕ /{action} not confirmed", "REJECTED", [esc(reason)], source="Risk gateway", next_commands=f"/{action}"))
            return

        try:
            result = await self._apply_control(action, symbol, user_id)
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
            log.exception("control %s failed", action)
            await self.send_message(chat_id, text_card(f"✕ /{action} failed", "GATEWAY ERROR", [esc(str(exc)[:200])], source="Risk gateway", next_commands="/status"))
            return

        await self.send_message(chat_id, text_card(f"✅ /{action} applied", "RISK STATE CHANGED", result, source="Risk gateway · audited", next_commands="/risk · /positions · /orders"))

    async def _apply_control(self, action: str, symbol: str | None, actor: str) -> list[str]:
        gateway = self.gateway
        if action == "halt":
            kill = await gateway.trigger_kill(reason="manual halt from Telegram", actor=actor, symbol=symbol)
            return [f"Kill switch <code>{'ACTIVE' if kill.active else 'INACTIVE'}</code>", f"Halted symbols <code>{esc(', '.join(sorted(kill.halted_symbols)) or 'ALL')}</code>", f"Actor <code>{esc(actor)}</code>"]
        if action == "resume":
            kill = await gateway.release_kill(actor=actor, symbol=symbol)
            return [f"Kill switch <code>{'ACTIVE' if kill.active else 'INACTIVE'}</code>", f"Halted symbols <code>{esc(', '.join(sorted(kill.halted_symbols)) or 'none')}</code>", f"Actor <code>{esc(actor)}</code>"]

        # flatten — composed from the gateway's own order path, one position at a
        # time so the submissions cannot race its exposure accounting.
        report = self._portfolio_report()
        positions = [
            p for p in report["exposure"]["positions"]
            if p.get("notional") and str(p.get("side")).upper() in {"LONG", "SHORT"}
            and (not symbol or str(p.get("symbol")) == symbol)
        ]
        if not positions:
            return ["Nothing to close — the book is already flat."]

        from modules.schemas import OrderRequest

        lines: list[str] = []
        for position in positions:
            side = "SELL" if str(position["side"]).upper() == "LONG" else "BUY"
            # The same entry point a manual order uses — `gateway.submit`, which
            # returns the full check vector for accepted and rejected orders
            # alike. Routing around it would make flatten a second, unaudited
            # execution path.
            decision = await gateway.submit(
                OrderRequest(
                    symbol=str(position["symbol"]), side=side,
                    notional=abs(float(position["notional"])),
                    order_type="MARKET", strategy="flatten",
                ),
                source=actor,
            )
            mark = "✓" if decision.accepted else "✕"
            blocked = ", ".join(decision.rejected_by) or (decision.reason or "rejected")
            reason = "" if decision.accepted else f" · {esc(str(blocked)[:60])}"
            lines.append(f"{mark} {side} <code>{esc(position['symbol'])}</code> <code>{_money(abs(float(position['notional'])))}</code>{reason}")
        accepted_n = sum(1 for line in lines if line.startswith("✓"))
        lines.append(f"<i>{accepted_n}/{len(lines)} accepted. A rejection is the pre-trade gates firing, not a transport failure.</i>")
        return lines

    async def _cmd_halt(self, args, chat_id, actor) -> None:
        await self._control("halt", args, chat_id, actor)

    async def _cmd_resume(self, args, chat_id, actor) -> None:
        await self._control("resume", args, chat_id, actor)

    async def _cmd_flatten(self, args, chat_id, actor) -> None:
        await self._control("flatten", args, chat_id, actor)

    # ------------------------------------------------------------------ #
    # Quant risk (read-only)
    # ------------------------------------------------------------------ #
    async def _risk_inputs(self, interval: str):
        """
        Bars for every symbol currently held, plus the book they belong to.

        Returns ``(report, covariance, returns_by_symbol)``. The covariance can
        be ``None`` — a flat book has no risk to decompose and too little shared
        history cannot produce one — and callers say which of those happened
        rather than printing zeros. The raw returns come back too, because
        historical VaR and the scenario betas need the series itself, not its
        second moment.
        """
        from modules.quant_risk import build_covariance, returns_from_closes

        report = self._portfolio_report()
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        if not positions:
            return report, None, {}

        returns: dict[str, list[float]] = {}
        held = {str(p["symbol"]) for p in positions[:8]}
        # The scenario reference is fetched even when it is not held: without it
        # every unheld position has no measurable beta and a stress test would
        # report a flat book under a market-wide shock.
        for symbol in sorted(held | {"BTCUSDT"}):
            payload = await self._bars_payload(symbol, interval, 180, "crypto")
            rows = payload.get("data") or [] if payload.get("ok") else []
            closes = [float(r["close"]) for r in rows if _finite(r.get("close")) is not None]
            if len(closes) >= 30:
                returns[symbol] = returns_from_closes(closes)
        held_returns = {s: r for s, r in returns.items() if s in held}
        return report, build_covariance(held_returns, interval), returns

    async def _cmd_var(self, args, chat_id, actor) -> None:
        from modules.quant_risk import historical_var, portfolio_risk

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        report, cov, returns = await self._risk_inputs(interval)
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card("📉 Portfolio VaR", "NOT MEASURABLE", ["A flat book, or too little shared price history to build a covariance.", "VaR needs at least 30 aligned bars per held symbol."], source="quant_risk", next_commands="/exposure · /positions"))
            return
        lines = [
            f"Book vol    <code>{_percent(risk.annualised_volatility)}</code> annualised",
            f"VaR 95 1d   <code>{_money(risk.var95)}</code> · <code>{_percent(risk.var95 / equity if equity else 0)}</code> of equity",
            f"CVaR 95     <code>{_money(risk.cvar95)}</code> average loss beyond it",
            f"Window      <code>{risk.observations}</code> {interval} bars",
        ]

        # The empirical figure beside the parametric one. Where they diverge is
        # the fat tail the normal assumption cannot see, and that gap is the
        # most useful number on this card.
        empirical = historical_var(report["exposure"]["positions"], returns, equity)
        if empirical:
            lines.append(
                f"Historical  <code>{_money(empirical.var95)}</code> VaR · "
                f"<code>{_money(empirical.cvar95)}</code> CVaR"
            )
            if empirical.var95 > risk.var95 * 1.25:
                lines.append("<i>The empirical tail is materially worse than the normal model — size on the historical figure.</i>")

        budget = settings.var_budget_pct
        if budget > 0 and equity > 0:
            used = risk.var95 / (equity * budget)
            flag = "🔴" if used >= 1.0 else "🟡" if used >= 0.8 else "🟢"
            lines.append(
                f"VaR budget  {flag} <code>{_percent(used)}</code> of "
                f"<code>{_percent(budget)}</code> equity tolerance"
            )

        if risk.diversification_ratio:
            lines.append(f"Diversif.   <code>{_number(risk.diversification_ratio)}x</code> vs the weighted parts")
        lines.append("<i>The budget is advisory: VaR needs history, so it is reported and never used to block an order.</i>")
        await self.send_message(chat_id, text_card("📉 Portfolio VaR", "LIVE BOOK", lines, source="quant_risk · parametric", next_commands="/riskcontrib · /correlation · /stress"))

    async def _cmd_riskcontrib(self, args, chat_id, actor) -> None:
        from modules.quant_risk import portfolio_risk

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        report, cov, returns = await self._risk_inputs(interval)
        equity = float(report["equity"]["current"] or 0.0)
        risk = portfolio_risk(report["exposure"]["positions"], cov, equity) if cov else None
        if not risk:
            await self.send_message(chat_id, text_card("🎯 Risk contribution", "NOT MEASURABLE", ["A flat book, or too little shared price history."], source="quant_risk", next_commands="/exposure"))
            return
        lines = ["<b>SYMBOL      NOTIONAL   RISK</b>"]
        for c in risk.contributions:
            tag = " hedge" if c.contribution_share < 0 else ""
            lines.append(f"{esc(c.symbol):<11} <code>{_percent(c.share_of_gross)}</code>  <code>{_percent(c.contribution_share)}</code>{tag}")
        lines.append("<i>Share of notional is not share of risk. A hedge contributes a negative amount.</i>")
        await self.send_message(chat_id, text_card("🎯 Risk contribution", f"{risk.observations} {interval.upper()} BARS", lines, source="quant_risk", next_commands="/var · /correlation"))

    async def _cmd_correlation(self, args, chat_id, actor) -> None:
        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        _, cov, _returns = await self._risk_inputs(interval)
        if not cov or len(cov.symbols) < 2:
            await self.send_message(chat_id, text_card("🔗 Correlation", "NOT MEASURABLE", ["Two or more held symbols with shared history are required."], source="quant_risk", next_commands="/exposure"))
            return
        head = "        " + " ".join(f"{s[:4]:>6}" for s in cov.symbols)
        lines = [f"<code>{esc(head)}</code>"]
        for i, symbol in enumerate(cov.symbols):
            row = " ".join(f"{cov.correlation[i][j]:>6.2f}" for j in range(len(cov.symbols)))
            lines.append(f"<code>{esc(f'{symbol[:6]:<7}')}{esc(row)}</code>")
        worst = max(
            ((cov.correlation[i][j], cov.symbols[i], cov.symbols[j])
             for i in range(len(cov.symbols)) for j in range(i + 1, len(cov.symbols))),
            default=(0.0, "", ""),
        )
        if worst[0] >= 0.8:
            lines.append(f"<i>⚠ {esc(worst[1])} and {esc(worst[2])} at {worst[0]:.2f} — close to one position of their combined size.</i>")
        lines.append(f"<i>Measured over {cov.observations} {interval} bars. Diversification is only real while these stay low.</i>")
        await self.send_message(chat_id, text_card("🔗 Correlation", "LIVE BOOK", lines, source="quant_risk", next_commands="/riskcontrib · /var"))

    async def _cmd_rebalance(self, args, chat_id, actor) -> None:
        """Target weights and the trades that would reach them. Read-only."""
        from modules.quant_risk import propose_allocation, rebalance_trades

        # Aliased rather than matched exactly: a phone keyboard is a bad place to
        # type "min_variance", and an unrecognised word falls back to inverse-vol
        # in the engine, which would silently answer a different question from
        # the one that was asked.
        aliases = {
            "ew": "equal_weight", "equalweight": "equal_weight", "equal_weight": "equal_weight",
            "iv": "inverse_vol", "invvol": "inverse_vol", "inverse_vol": "inverse_vol",
            "erc": "equal_risk", "equalrisk": "equal_risk", "equal_risk": "equal_risk",
            "mv": "min_variance", "minvar": "min_variance", "min_variance": "min_variance",
        }
        method = aliases.get(args[0].lower(), "inverse_vol") if args else "inverse_vol"
        report, cov, _returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        proposal = propose_allocation(
            positions, cov, equity, method=method,
            max_symbol_notional=settings.max_symbol_notional_usd,
            max_gross_notional=settings.max_gross_exposure_usd,
        ) if cov else None

        if not proposal:
            await self.send_message(chat_id, text_card(
                "⚖️ Rebalance", "NOT MEASURABLE",
                ["A flat book, or too little shared price history to measure volatility.",
                 "Allocation needs a covariance, and a covariance needs history."],
                source="quant_risk", next_commands="/positions · /var"))
            return

        lines = [f"<b>Method: {esc(proposal.method.replace('_', ' '))}</b>", "",
                 "<b>SYMBOL     NOW  TARGET   DRIFT</b>"]
        for target in proposal.targets:
            cap = " ⚠" if target.clipped_by else ""
            lines.append(
                f"<code>{esc(f'{target.symbol[:9]:<9}')}</code> "
                f"<code>{target.current_weight:>5.0%}</code> "
                f"<code>{target.target_weight:>6.0%}</code> "
                f"<code>{target.drift:>+6.1%}</code>{cap}"
            )

        trades = rebalance_trades(proposal, positions, drift_band=0.05)
        if trades:
            lines += ["", "<b>Trades outside a 5% band</b>"]
            for trade in trades:
                lines.append(
                    f"  {trade['side']} <code>{_money(trade['notional'])}</code> {esc(trade['symbol'])}"
                )
        else:
            lines += ["", "<i>Everything is inside a 5% drift band — trading it would cost more than the drift.</i>"]

        if proposal.clipped:
            lines.append("<i>⚠ A target was capped by a risk limit, so the weights no longer sum to one.</i>")
        lines.append("<i>Risk-based only: no expected return is forecast. This is a proposal, not an instruction — "
                     "nothing here is sent.</i>")

        await self.send_message(chat_id, text_card(
            "⚖️ Rebalance", "PROPOSAL", lines,
            source="quant_risk · risk-based", next_commands="/exposure · /riskcontrib · /stress"))

    async def _cmd_stress(self, args, chat_id, actor) -> None:
        """Scenario loss on the book as it stands, with distance to the halt."""
        from modules.quant_risk import SCENARIOS, apply_scenario, run_scenarios

        report, _cov, returns = await self._risk_inputs("1d")
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        if not positions:
            await self.send_message(chat_id, text_card(
                "🌩 Stress test", "FLAT BOOK",
                ["Nothing is at risk, so every scenario is a zero."],
                source="quant_risk", next_commands="/positions · /var"))
            return

        requested = args[0].lower() if args else None
        if requested and requested not in SCENARIOS:
            # A percentage is accepted as an ad-hoc shock, because the question
            # is usually "what if BTC drops 12%" rather than a named regime.
            try:
                move = float(requested.rstrip("%")) / 100.0
                results = [apply_scenario(positions, equity, {"BTCUSDT": move}, returns,
                                          scenario_id="custom", label=f"BTC {move:+.0%}")]
            except ValueError:
                await self.send_message(chat_id, text_card(
                    "🌩 Stress test", "UNKNOWN SCENARIO",
                    [f"Choose one of: <code>{esc(', '.join(SCENARIOS))}</code>",
                     "Or give a percentage, e.g. <code>/stress -12</code>."],
                    source="quant_risk", next_commands="/stress"))
                return
        elif requested:
            spec = SCENARIOS[requested]
            results = [apply_scenario(positions, equity, spec["shocks"], returns,
                                      scenario_id=requested, label=str(spec["label"]))]
        else:
            results = run_scenarios(positions, equity, returns)

        # The number that decides whether a scenario matters: how much of the
        # loss the desk could absorb before the breaker halts it.
        cushion = float(report["risk_budget"]["daily_drawdown"].get("cushion_usd") or 0.0)
        lines = ["<b>SCENARIO             P&amp;L      OF EQUITY</b>"]
        for result in results:
            breach = " 🛑" if cushion > 0 and -result.total_pnl >= cushion else ""
            lines.append(
                f"<code>{esc(f'{result.label[:20]:<20}')}</code> "
                f"<code>{_money(result.total_pnl):>10}</code> "
                f"<code>{_percent(result.total_return):>7}</code>{breach}"
            )

        worst = results[0]
        lines.append("")
        lines.append(f"Cushion to halt <code>{_money(cushion)}</code>")
        if cushion > 0 and -worst.total_pnl >= cushion:
            lines.append(f"<i>🛑 {esc(worst.label)} would trip the drawdown breaker.</i>")
        unsupported = [leg.symbol for leg in worst.legs if leg.basis == "unsupported"]
        assumed = [leg.symbol for leg in worst.legs if leg.basis == "wildcard"]
        if unsupported:
            lines.append(
                f"<i>No measurable beta for {esc(', '.join(sorted(set(unsupported))))} — "
                "left flat, so the total above is understated by whatever they would have moved.</i>"
            )
        if assumed:
            lines.append(
                f"<i>{esc(', '.join(sorted(set(assumed))))} moved on the scenario's blanket shock, "
                "not on a measured beta — an assumption, not a measurement.</i>"
            )
        await self.send_message(chat_id, text_card(
            "🌩 Stress test", "LIVE BOOK", lines,
            source="quant_risk · measured betas", next_commands="/var · /riskcontrib · /headroom"))

    async def _cmd_varbacktest(self, args, chat_id, actor) -> None:
        """Has the VaR the desk quotes actually been right?"""
        from modules.quant_risk import rolling_var_backtest

        interval = args[0] if args and args[0] in {"15m", "1h", "4h", "1d"} else "1d"
        report, _cov, returns = await self._risk_inputs(interval)
        positions = [p for p in report["exposure"]["positions"] if p.get("notional")]
        equity = float(report["equity"]["current"] or 0.0)
        result = rolling_var_backtest(positions, returns, equity) if positions else None

        if not result:
            await self.send_message(chat_id, text_card(
                "🧪 VaR backtest", "NOT MEASURABLE",
                ["A flat book, or fewer than 80 aligned bars per held symbol.",
                 "The forecast is re-fitted on a rolling window and scored on the next bar, "
                 "so it needs history on both sides."],
                source="quant_risk · Kupiec POF", next_commands="/var · /positions"))
            return

        flag = {"green": "🟢", "yellow": "🟡", "red": "🔴"}[result.zone]
        lines = [
            f"Zone        {flag} <code>{result.zone.upper()}</code>",
            f"Exceptions  <code>{result.exceptions}</code> of <code>{result.observations}</code> "
            f"(expected <code>{result.expected_exceptions}</code>)",
            f"Rate        <code>{_percent(result.exception_rate)}</code> vs the 5% claim",
            f"Kupiec p    <code>{_number(result.kupiec_p_value)}</code>",
            "",
            f"<i>{esc(result.verdict)}</i>",
        ]
        await self.send_message(chat_id, text_card(
            "🧪 VaR backtest", "MODEL VALIDATION", lines,
            source="quant_risk · Kupiec POF", next_commands="/var · /stress"))

    async def _cmd_regime(self, args, chat_id, actor) -> None:
        from modules.quant_risk import returns_from_closes, volatility_regime

        symbol, interval, count, asset = self._bar_args(args)
        payload = await self._bars_payload(symbol, interval, max(count, 120), asset)
        rows = payload.get("data") or [] if payload.get("ok") else []
        closes = [float(r["close"]) for r in rows if _finite(r.get("close")) is not None]
        regime = volatility_regime(returns_from_closes(closes), interval=interval) if len(closes) > 45 else None
        if not regime:
            await self.send_message(chat_id, self._openbb_error("regime", payload if not payload.get("ok") else {"error": "at least 45 bars are required"}))
            return
        lines = [
            f"Regime      <code>{regime.regime}</code>",
            f"Current vol <code>{_percent(regime.current_vol)}</code> annualised",
            f"Baseline    <code>{_percent(regime.baseline_vol)}</code> · ratio <code>{_number(regime.ratio)}x</code>",
            f"Percentile  <code>{_percent(regime.percentile)}</code> of its own history",
            f"<i>{esc(regime.note)}</i>",
        ]
        await self.send_message(chat_id, text_card(f"🌡 {symbol} volatility regime", f"{regime.observations} WINDOWS · {interval}", lines, source="quant_risk", next_commands=f"/range {symbol} · /var"))

    async def _cmd_size(self, args, chat_id, actor) -> None:
        from modules.quant_risk import kelly_fraction

        if len(args) < 2:
            await self.send_message(chat_id, text_card("📐 Position sizing", "USAGE", ["<code>/size WIN_RATE PAYOFF [EQUITY]</code>", "Example <code>/size 0.55 1.8</code>", "Win rate as a fraction, payoff as avg win ÷ avg loss."], source="quant_risk", next_commands="/backtests"))
            return
        try:
            win_rate = float(args[0])
            payoff = float(args[1])
        except ValueError:
            await self.send_message(chat_id, text_card("📐 Position sizing", "BAD INPUT", ["Win rate and payoff must be numbers."], source="quant_risk", next_commands="/help size"))
            return
        equity = float(args[2]) if len(args) > 2 and args[2].replace(".", "", 1).isdigit() else float(self._portfolio_report()["equity"]["current"] or 0.0)
        sizing = kelly_fraction(win_rate, payoff, equity)
        lines = [
            f"Full Kelly  <code>{_percent(sizing.full_kelly)}</code>",
            f"Recommended <code>{_percent(sizing.recommended_fraction)}</code> · <code>{_money(sizing.recommended_notional)}</code>",
            f"Edge/trade  <code>{_number(sizing.edge_per_trade, 3, signed=True)}</code>",
            f"On equity   <code>{_money(equity)}</code>",
            f"<i>{esc(sizing.note)}</i>",
        ]
        await self.send_message(chat_id, text_card("📐 Kelly sizing", "QUARTER KELLY" if not sizing.capped_by else sizing.capped_by.upper().replace("_", " "), lines, source="quant_risk", next_commands="/headroom · /limits"))

    async def _cmd_dislocation(self, args, chat_id, actor) -> None:
        from modules.quant_risk import find_dislocation

        symbol = self._symbol(args)
        books = [
            {
                "venue": b.venue, "ok": bool(b.mid), "best_bid": b.best_bid, "best_ask": b.best_ask,
                "bids": [[lvl[0], lvl[1]] for lvl in (b.bids or [])[:1]],
                "asks": [[lvl[0], lvl[1]] for lvl in (b.asks or [])[:1]],
            }
            for b in self.tca.get_books(symbol, depth=5)
        ]
        found = find_dislocation(books, symbol)
        if not found:
            await self.send_message(chat_id, text_card(f"⚖ {symbol} dislocation", "NEEDS TWO VENUES", ["Two venues with a live book are required to compare."], source="TCA engine", next_commands="/feedstatus · /venues"))
            return
        if found.crossed:
            lines = [
                f"<b>CROSSED</b> buy <code>{esc(found.buy_venue)}</code> · sell <code>{esc(found.sell_venue)}</code>",
                f"Edge        <code>{_number(found.edge_bps)} bps</code> · <code>{_number(found.edge_usd_per_unit)}</code>/unit",
                f"Executable  <code>{_number(found.executable_size, 4)}</code> units · <code>{_money(found.executable_notional)}</code>",
                f"<i>{esc(found.note)}</i>",
            ]
            state = "CROSSED"
        else:
            lines = [f"Best spread <code>{_number(-found.edge_bps)} bps</code> across venues", f"<i>{esc(found.note)}</i>"]
            state = "NORMAL"
        await self.send_message(chat_id, text_card(f"⚖ {symbol} dislocation", state, lines, source="Cross-venue TCA engine", next_commands=f"/book {symbol} · /tca {symbol} 100000 BUY"))

    async def _cmd_book(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=5) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"📖 {symbol} book", "NO LIVE BOOK", ["No venue currently has a fresh book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = []
        for book in books:
            tag = "SYNTHETIC" if book.synthetic else "LIVE"
            lines += [f"<b>{esc(book.venue)} · {tag}</b>", f"Bid <code>{_number(book.best_bid)}</code> · Ask <code>{_number(book.best_ask)}</code> · Spread <code>{_number(book.spread_bps)} bps</code>", f"Depth5 <code>{_money(book.depth_usd_bid)}</code> / <code>{_money(book.depth_usd_ask)}</code> · Imb <code>{_number(book.imbalance, signed=True)}</code>"]
        await self.send_message(chat_id, text_card(f"📖 {symbol} top of book", "LIVE" if not any(book.synthetic for book in books) else "SYNTHETIC", lines, source="Cross-venue TCA engine", next_commands=f"/spread {symbol} · /depth {symbol} · /tca {symbol} 100000 BUY"))

    async def _cmd_spread(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=5) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"↔️ {symbol} spreads", "NO LIVE BOOK", ["No fresh venue book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"{esc(book.venue):<12} <code>{_number(book.spread_bps)} bps</code>" for book in books]
        best_bid = max(book.best_bid or 0 for book in books)
        best_ask = min(book.best_ask or math.inf for book in books)
        consolidated_mid = (best_bid + best_ask) / 2 if best_ask < math.inf else None
        consolidated = ((best_ask - best_bid) / consolidated_mid * 10_000) if consolidated_mid else None
        lines += ["", f"Best cross-venue bid <code>{_number(best_bid)}</code>", f"Best cross-venue ask <code>{_number(best_ask)}</code>", f"Consolidated spread <code>{_number(consolidated)} bps</code>"]
        await self.send_message(chat_id, text_card(f"↔️ {symbol} spreads", "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/book {symbol} · /route {symbol} 100000 BUY"))

    async def _cmd_depth(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=20) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"🌊 {symbol} depth", "NO LIVE BOOK", ["No fresh venue book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"<b>{esc(book.venue)}</b> · bids <code>{_money(book.depth_usd_bid)}</code> · asks <code>{_money(book.depth_usd_ask)}</code> · imbalance <code>{_number(book.imbalance, signed=True)}</code>" for book in books]
        await self.send_message(chat_id, text_card(f"🌊 {symbol} displayed depth", "LIVE" if not any(book.synthetic for book in books) else "SYNTHETIC", lines, source="Cross-venue TCA engine", next_commands=f"/liquidity {symbol} 100000 · /tca {symbol} 100000 BUY"))

    async def _cmd_tca(self, args, chat_id, actor) -> None:
        symbol, notional, side = self._trade_args(args)
        report = self.tca.tca_report(symbol, side, notional)
        if not report.per_venue:
            await self.send_message(chat_id, text_card(f"📊 {symbol} TCA", "NO LIVE BOOK", ["No execution estimate is available."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"Side / size <code>{side} · {_money(notional)}</code>", f"Mid         <code>{_number(report.consolidated_mid)}</code>", "", "<b>Single venue</b>"]
        for estimate in report.per_venue:
            lines.append(f"{esc(estimate.venue)} · <code>{_number(estimate.slippage_bps, signed=True)} bps</code> · VWAP <code>{_number(estimate.vwap)}</code> · <code>{'fillable' if estimate.fillable else 'partial'}</code>")
        if report.smart_route:
            lines += ["", f"<b>Smart route · {_number(report.smart_route_slippage_bps, signed=True)} bps</b>"]
            for leg in report.smart_route:
                lines.append(f"{esc(leg.venue)} <code>{leg.share_pct:.1f}%</code> · <code>{_money(leg.notional)}</code>")
        await self.send_message(chat_id, text_card(f"📊 {symbol} TCA", "SYNTHETIC" if report.synthetic else "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/route {symbol} {notional:g} {side} · /liquidity {symbol} {notional:g}"))

    async def _cmd_route(self, args, chat_id, actor) -> None:
        symbol, notional, side = self._trade_args(args)
        report = self.tca.tca_report(symbol, side, notional)
        if not report.smart_route:
            await self.send_message(chat_id, text_card(f"🧭 {symbol} route", "NOT FILLABLE", [f"No complete route for <code>{side} {_money(notional)}</code>."], source="TCA engine", next_commands=f"/liquidity {symbol} {notional:g}"))
            return
        lines = [f"Order <code>{side} · {_money(notional)}</code>", f"Blended VWAP <code>{_number(report.smart_route_vwap)}</code>", f"Slippage <code>{_number(report.smart_route_slippage_bps, signed=True)} bps</code>"]
        for leg in report.smart_route:
            lines.append(f"{esc(leg.venue):<12} <code>{leg.share_pct:5.1f}%</code> · <code>{_money(leg.notional)}</code> @ <code>{_number(leg.vwap)}</code>")
        await self.send_message(chat_id, text_card(f"🧭 {symbol} smart route", "SYNTHETIC" if report.synthetic else "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/tca {symbol} {notional:g} {side} · /watch {symbol} {notional:g} 25"))

    async def _cmd_liquidity(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        if notional is None or notional <= 0:
            raise ValueError("notional must be a positive finite number")
        estimate = self.tca.route_estimate(symbol, "BUY", notional)
        if not estimate:
            await self.send_message(chat_id, text_card(f"🌊 {symbol} liquidity", "NO LIVE BOOK", ["No route estimate is available."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"Probe size <code>{_money(notional)}</code>", f"Fillable   <code>{'YES' if estimate.fillable else 'NO'}</code>", f"Routable   <code>{_money(estimate.filled_notional)}</code>", f"Slippage   <code>{_number(estimate.slippage_bps, signed=True)} bps</code>", f"Route      <code>{esc(estimate.venue)}</code>"]
        await self.send_message(chat_id, text_card(f"🌊 {symbol} liquidity", "LIVE" if estimate.fillable else "THIN", lines, source="Cross-venue TCA engine", next_commands=f"/route {symbol} {notional:g} BUY · /watch {symbol} {notional:g} 25"))

    async def _cmd_venues(self, args, chat_id, actor) -> None:
        health = self.tca.health()
        lines = []
        for feed in health.get("feeds", []):
            symbols = feed.get("symbols") or {}
            rate = sum(_finite(value.get("rate_hz")) or 0 for value in symbols.values())
            lines.append(f"{'🟢' if feed.get('connected') else '🔴'} <b>{esc(feed.get('venue'))}</b> · <code>{rate:.0f} upd/s</code> · <code>{feed.get('reconnects', 0)} reconnects</code>")
        await self.send_message(chat_id, text_card("🏛 Execution venues", "SYNTHETIC ACTIVE" if health.get("synthetic_active") else "LIVE FEEDS", lines or ["No feeds configured."], source="TCA engine", next_commands="/feedstatus · /book BTCUSDT"))

    async def _cmd_feedstatus(self, args, chat_id, actor) -> None:
        health = self.tca.health()
        lines = [f"Engine uptime <code>{_number(health.get('uptime_s'), 0)} s</code>", f"Symbols <code>{', '.join(health.get('symbols') or [])}</code>"]
        for feed in health.get("feeds", []):
            lines.append(f"\n<b>{esc(feed.get('venue'))}</b> · <code>{'connected' if feed.get('connected') else 'offline'}</code> · uptime <code>{_number(feed.get('uptime_s'), 0)} s</code>")
            if feed.get("last_error"):
                lines.append(f"Error <code>{esc(str(feed['last_error'])[:180])}</code>")
        await self.send_message(chat_id, text_card("📡 Market-feed health", "SYNTHETIC" if health.get("synthetic_active") else "OBSERVED", lines, source="TCA engine", next_commands="/venues · /status"))

    def _recent_orders(self, args: list[str], accepted: bool | None = None) -> list[dict[str, Any]]:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_orders(max(count * 3, count)) if self.audit else []
        if accepted is not None:
            rows = [row for row in rows if bool(row.get("accepted")) is accepted]
        return rows[:count]

    async def _render_orders(self, chat_id: str, title: str, rows: list[dict[str, Any]], state: str) -> None:
        if not rows:
            await self.send_message(chat_id, text_card(title, "NO RECORDS", ["No matching audit rows."], source="DuckDB audit log", next_commands="/orders"))
            return
        lines = []
        for row in rows:
            icon = "✅" if row.get("accepted") else "❌"
            timestamp = str(row.get("ts") or "")[11:19]
            lines.append(f"{icon} <code>{esc(timestamp)}</code> {esc(row.get('symbol'))} {esc(row.get('side'))} <code>{_money(row.get('notional'))}</code> · <code>{_number(row.get('latency_ms'))} ms</code>")
            if not row.get("accepted"):
                lines.append(f"   ↳ <code>{esc(str(row.get('rejected_by') or row.get('reason') or 'rejected')[:120])}</code>")
        await self.send_message(chat_id, text_card(title, state, lines, source="DuckDB audit log", next_commands="/slippage · /fees · /events"))

    async def _cmd_orders(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "🧾 Gateway decisions", self._recent_orders(args), "AUDIT LOG")

    async def _cmd_fills(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "✅ Accepted fills", self._recent_orders(args, True), "AUDIT LOG")

    async def _cmd_rejections(self, args, chat_id, actor) -> None:
        await self._render_orders(chat_id, "❌ Rejected orders", self._recent_orders(args, False), "AUDIT LOG")

    async def _cmd_slippage(self, args, chat_id, actor) -> None:
        stats = self.audit.execution_stats() if self.audit else {}
        lines = [f"Accepted orders <code>{stats.get('accepted') or 0}</code>", f"Average slip   <code>{_number(stats.get('avg_slippage_bps'), signed=True)} bps</code>", f"Average latency <code>{_number(stats.get('avg_latency_ms'))} ms</code>", f"Max latency     <code>{_number(stats.get('max_latency_ms'))} ms</code>"]
        await self.send_message(chat_id, text_card("📉 Execution slippage", "AUDIT AGGREGATE", lines, source="DuckDB audit log", next_commands="/tca BTCUSDT 100000 BUY · /orders"))

    async def _cmd_fees(self, args, chat_id, actor) -> None:
        stats = self.audit.execution_stats() if self.audit else {}
        lines = [f"Total fees <code>{_money(stats.get('total_fees'))}</code>", f"Orders     <code>{stats.get('total') or 0}</code>", f"Accepted   <code>{stats.get('accepted') or 0}</code>"]
        await self.send_message(chat_id, text_card("💸 Execution fees", "AUDIT AGGREGATE", lines, source="DuckDB audit log", next_commands="/attribution · /fills"))

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

    async def _cmd_backtests(self, args, chat_id, actor) -> None:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_backtests(count) if self.audit else []
        if not rows:
            await self.send_message(chat_id, text_card("🧪 Backtest history", "EMPTY", ["No completed backtests in the audit log."], source="DuckDB audit log", next_commands="/researchstatus"))
            return
        lines = []
        for row in rows:
            lines.append(f"<code>{esc(str(row.get('ts') or '')[:19])}</code> {esc(row.get('symbol'))} {esc(row.get('strategy'))} · Sharpe <code>{_number(row.get('sharpe'))}</code> · DSR <code>{_number(row.get('dsr'), 3)}</code> · OOS <code>{_number(row.get('oos_sharpe'))}</code>")
        await self.send_message(chat_id, text_card("🧪 Backtest history", "READ-ONLY AUDIT", lines, source="DuckDB audit log", next_commands="/strategies · /jobs"))

    async def _cmd_strategies(self, args, chat_id, actor) -> None:
        lines = ["<code>ma_cross</code> — moving-average crossover", "<code>donchian</code> — channel breakout", "<code>rsi_reversion</code> — RSI mean reversion", "", "Research submission stays in the API/web research workflow; Telegram only reports status and results."]
        await self.send_message(chat_id, text_card("🧠 Strategy catalogue", "REFERENCE", lines, source="Backtest request schema", next_commands="/backtests · /researchstatus"))

    async def _cmd_intervals(self, args, chat_id, actor) -> None:
        lines = ["OpenBB market data <code>15m · 1h · 4h · 1d</code>", "Backtests <code>1m · 5m · 15m · 1h · 4h · 1d</code>", "", "Intraday history availability depends on the upstream provider window."]
        await self.send_message(chat_id, text_card("⏱ Supported intervals", "REFERENCE", lines, source="OpenBB + backtest schemas", next_commands="/bars AAPL 1d 5 · /trend AAPL 1d 20"))

    def _event_rows(self, args: list[str], incidents_only: bool = False) -> list[dict[str, Any]]:
        count = self._limit(args, 0, 10, 25)
        rows = self.audit.recent_events(max(count * 3, count)) if self.audit else []
        if incidents_only:
            rows = [row for row in rows if str(row.get("severity") or "").lower() in {"warning", "critical", "error"}]
        return rows[:count]

    async def _render_events(self, chat_id: str, title: str, rows: list[dict[str, Any]], status: str) -> None:
        if not rows:
            await self.send_message(chat_id, text_card(title, "NO RECORDS", ["No matching events."], source="DuckDB audit log", next_commands="/status"))
            return
        icon = {"critical": "🛑", "error": "🔴", "warning": "⚠️", "info": "ℹ️"}
        lines = []
        for row in rows:
            severity = str(row.get("severity") or "info").lower()
            lines.append(f"{icon.get(severity, '•')} <code>{esc(str(row.get('ts') or '')[11:19])}</code> {esc(row.get('event'))} · {esc(row.get('symbol') or 'ALL')}\n   <code>{esc(str(row.get('detail') or '')[:150])}</code>")
        await self.send_message(chat_id, text_card(title, status, lines, source="DuckDB audit log", next_commands="/risk · /orders · /status"))

    async def _cmd_events(self, args, chat_id, actor) -> None:
        await self._render_events(chat_id, "📚 Risk and audit events", self._event_rows(args), "AUDIT LOG")

    async def _cmd_incidents(self, args, chat_id, actor) -> None:
        await self._render_events(chat_id, "🚨 Operational incidents", self._event_rows(args, True), "WARNING + CRITICAL")

    # ------------------------------------------------------------------ #
    # Notification preferences and delivery
    # ------------------------------------------------------------------ #
    def _subscriber_is_authorised(self, subscriber: dict[str, Any] | None) -> bool:
        """Return whether a persisted recipient owner is currently allowed.

        Chat IDs are destinations, not identities.  A legacy row with no
        explicit ``user_id`` therefore never qualifies for delivery, even if
        its old free-form username happens to contain a numeric fragment.
        """
        if not subscriber:
            return False
        user_id = str(subscriber.get("user_id") or "")
        return self._authorised(user_id)

    def _subscribers(self, *, alerts_only: bool = True) -> list[dict[str, Any]]:
        if not self.audit:
            return []
        return [
            subscriber
            for subscriber in self.audit.list_subscribers(alerts_only=alerts_only)
            if self._subscriber_is_authorised(subscriber)
        ]

    def _delivery_allowed(self, chat_id: str | int, *, require_alerts: bool = True) -> bool:
        if not self.audit:
            return False
        subscriber = self.audit.get_subscriber(str(chat_id))
        if not self._subscriber_is_authorised(subscriber):
            return False
        return not require_alerts or bool(subscriber.get("alerts"))

    def _user_id_from_actor(self, actor: str) -> str:
        match = _TELEGRAM_ACTOR_RE.match(actor)
        user_id = match.group(1) if match else ""
        if not self._authorised(user_id):
            raise PermissionError("notification owner is not currently authorised")
        return user_id

    def _subscribe(self, chat_id: str, actor: str, alerts: bool = True) -> None:
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=alerts,
                user_id=self._user_id_from_actor(actor),
            )

    async def _cmd_subscribe(self, args, chat_id, actor) -> None:
        self._subscribe(chat_id, actor, alerts=True)
        await self.send_message(chat_id, text_card("🔔 Notifications enabled", "SUBSCRIBED", ["This chat will receive risk, execution, liquidity and completed-research updates.", "Add a liquidity threshold with <code>/watch BTCUSDT 100000 25</code>."], source="Persistent subscriber registry", next_commands="/subscriptions · /watch BTCUSDT 100000 25"))

    async def _cmd_unsubscribe(self, args, chat_id, actor) -> None:
        if str(chat_id) in settings.telegram_alert_chat_ids:
            await self.send_message(chat_id, text_card("🔔 Centrally managed notifications", "CANNOT MUTE HERE", ["This chat is listed in <code>TELEGRAM_ALERT_CHAT_IDS</code>; an operator must remove it from the deployment configuration."], source="AlphaEngine configuration", next_commands="/subscriptions"))
            return
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=False,
                user_id=self._user_id_from_actor(actor),
            )
        await self.send_message(chat_id, text_card("🔕 Notifications disabled", "UNSUBSCRIBED", ["Commands remain available; optional pushed alerts will stop."], source="Persistent subscriber registry", next_commands="/subscribe · /subscriptions"))

    async def _cmd_subscriptions(self, args, chat_id, actor) -> None:
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        central = str(chat_id) in settings.telegram_alert_chat_ids
        watches = (sub or {}).get("watches", [])
        enabled = self._subscriber_is_authorised(sub) and (central or bool((sub or {}).get("alerts")))
        lines = [f"Notifications <code>{'ON' if enabled else 'OFF'}</code>", f"Managed by <code>{'deployment' if central else 'chat preference'}</code>", f"Liquidity watches <code>{len(watches)}</code>"]
        await self.send_message(chat_id, text_card("🔔 Notification state", "ACTIVE" if enabled else "MUTED", lines, source="Configuration + subscriber registry", next_commands="/subscribe · /unsubscribe · /watches"))

    async def _cmd_watch(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        if symbol not in [tracked.upper() for tracked in settings.symbols]:
            raise ValueError(f"{symbol} is not a tracked execution instrument")
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        threshold = _finite(args[2]) if len(args) > 2 else settings.max_est_slippage_bps / 2
        if notional is None or notional <= 0:
            raise ValueError("watch notional must be positive and finite")
        if threshold is None or threshold <= 0 or threshold > 10_000:
            raise ValueError("watch threshold must be between 0 and 10,000 bps")

        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        watches = [watch for watch in (sub or {}).get("watches", []) if watch["symbol"] != symbol]
        watches.append({"symbol": symbol, "notional": notional, "threshold_bps": threshold})
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=True, watches=watches,
                user_id=self._user_id_from_actor(actor),
            )
        self._watch_state.pop((str(chat_id), symbol), None)
        await self.send_message(chat_id, text_card(f"👁 {symbol} liquidity watch", "ACTIVE", [f"Probe size <code>{_money(notional)}</code>", f"Alert above <code>{threshold:.1f} bps</code>", "Notifications fire once on deterioration and once on recovery."], source="TCA engine + subscriber registry", next_commands="/watches · /unwatch " + symbol))

    async def _cmd_unwatch(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args) if args else None
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        watches = (sub or {}).get("watches", [])
        remaining = [watch for watch in watches if symbol and watch["symbol"] != symbol] if symbol else []
        if self.audit:
            self.audit.upsert_subscriber(
                str(chat_id), actor, alerts=bool((sub or {}).get("alerts")), watches=remaining,
                user_id=self._user_id_from_actor(actor),
            )
        removed = len(watches) - len(remaining)
        await self.send_message(chat_id, text_card("👁 Liquidity watches", "UPDATED", [f"Removed <code>{removed}</code> watch(es)."], source="Persistent subscriber registry", next_commands="/watches · /watch BTCUSDT 100000 25"))

    async def _cmd_watches(self, args, chat_id, actor) -> None:
        sub = self.audit.get_subscriber(str(chat_id)) if self.audit else None
        watches = (sub or {}).get("watches", [])
        if not watches:
            await self.send_message(chat_id, text_card("👁 Liquidity watches", "NONE", ["No active execution-cost watches."], source="Persistent subscriber registry", next_commands="/watch BTCUSDT 100000 25"))
            return
        lines = []
        for watch in watches:
            estimate = self.tca.route_estimate(watch["symbol"], "BUY", watch["notional"]) if self.tca else None
            current = f"{estimate.slippage_bps:+.2f} bps" if estimate and estimate.slippage_bps is not None else "no book"
            breached = self._watch_state.get((str(chat_id), watch["symbol"]), False)
            lines.append(f"{'🔴' if breached else '🟢'} <b>{esc(watch['symbol'])}</b> · <code>{_money(watch['notional'])}</code> · limit <code>{watch['threshold_bps']:.1f} bps</code> · now <code>{current}</code>")
        await self.send_message(chat_id, text_card("👁 Liquidity watches", "ACTIVE", lines, source="TCA engine + subscriber registry", next_commands="/unwatch SYMBOL · /liquidity BTCUSDT 100000"))

    async def _cmd_digest(self, args, chat_id, actor) -> None:
        from modules import research

        report = self._portfolio_report()
        state = self.gateway.state()
        health = self.tca.health()
        openbb = await research.openbb_status_async()
        constraint, utilisation = report["risk_budget"]["binding_constraint"]
        lines = [
            "<b>Portfolio</b>",
            f"Equity <code>{_money(report['equity']['current'])}</code> · Day P&amp;L <code>{_money(report['equity']['daily_pnl'], signed=True)}</code>",
            f"Gross <code>{_money(report['exposure']['gross'])}</code> · Net <code>{_money(report['exposure']['net'], signed=True)}</code> · Leverage <code>{_number(report['exposure']['leverage'])}x</code>",
            f"Binding <code>{esc(constraint)}</code> at <code>{_percent(utilisation)}</code>",
            "\n<b>Systems</b>",
            f"Trading <code>{'HALTED' if state.kill_switch_active else 'LIVE'}</code> · OpenBB <code>{'READY' if openbb.get('ok') else 'DOWN'}</code>",
            f"Feeds <code>{sum(1 for feed in health.get('feeds', []) if feed.get('connected'))}/{len(health.get('feeds', []))}</code> · Synthetic <code>{'ON' if health.get('synthetic_active') else 'off'}</code>",
        ]
        await self.send_message(chat_id, text_card("🗞 AlphaEngine digest", "ON DEMAND", lines, source="Portfolio + risk + TCA + OpenBB", next_commands="/portfolio · /status · /incidents"))

    async def _watch_tick(self) -> None:
        for subscriber in self._subscribers():
            chat_id = subscriber["chat_id"]
            for watch in subscriber.get("watches", []):
                symbol = watch["symbol"]
                notional = watch["notional"]
                threshold = watch["threshold_bps"]
                estimate = self.tca.route_estimate(symbol, "BUY", notional) if self.tca else None
                if estimate is None or estimate.slippage_bps is None:
                    continue
                key = (chat_id, symbol)
                previous = self._watch_state.get(key, False)
                breached = (not estimate.fillable) or estimate.slippage_bps > threshold
                if breached == previous:
                    continue
                self._watch_state[key] = breached
                if breached:
                    lines = [f"Probe <code>{_money(notional)}</code>", f"Cost <code>{estimate.slippage_bps:+.2f} bps</code> vs <code>{threshold:.1f} bps</code> limit", f"Routable <code>{_money(estimate.filled_notional)}</code> · Route <code>{esc(estimate.venue)}</code>"]
                    message = text_card(f"⚠️ {symbol} liquidity deterioration", "THRESHOLD BREACH", lines, source="TCA execution-cost watch", next_commands=f"/liquidity {symbol} {notional:g} · /tca {symbol} {notional:g} BUY")
                else:
                    message = text_card(f"✅ {symbol} liquidity recovered", "BACK WITHIN LIMIT", [f"Probe <code>{_money(notional)}</code>", f"Cost <code>{estimate.slippage_bps:+.2f} bps</code> vs <code>{threshold:.1f} bps</code> limit"], source="TCA execution-cost watch", next_commands="/watches")
                if not self._delivery_allowed(chat_id):
                    # Re-check immediately before the network call so an
                    # allow-list revocation cannot race a long TCA pass.
                    self._watch_state[key] = previous
                    continue
                await self.send_message(chat_id, message)
                self.alerts_sent += 1

    async def _watch_loop(self) -> None:
        while True:
            await asyncio.sleep(20)
            try:
                await self._watch_tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Telegram watch loop error (%s)", type(exc).__name__)

    def _alert_targets(self) -> list[str]:
        if settings.telegram_alert_chat_ids:
            eligible = {
                subscriber["chat_id"]
                for subscriber in self._subscribers(alerts_only=False)
            }
            return [
                chat_id for chat_id in dict.fromkeys(settings.telegram_alert_chat_ids)
                if chat_id in eligible
            ]
        return [subscriber["chat_id"] for subscriber in self._subscribers()]

    async def broadcast(self, severity: str, message: str) -> None:
        """Risk hook: normalize every pushed update into the textual card UI."""
        if not self.enabled:
            log.info("[alert:%s] %s", severity, _HTML_TAG_RE.sub("", message).replace("\n", " ")[:200])
            return
        targets = self._alert_targets()
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
        """Text-only completion update for jobs submitted outside Telegram."""
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
        lines = [
            f"Job <code>{esc(record.job_id)}</code>",
            f"Study <code>{esc(request.get('symbol'))} · {esc(request.get('interval'))} · {esc(request.get('strategy'))}</code>",
            f"Best params <code>{best.get('fast')}/{best.get('slow')}</code> from <code>{result.get('combos_tested')}</code> combinations",
            f"Sharpe <code>{_number(best.get('sharpe'))}</code> · Return <code>{_percent(best.get('total_return'), signed=True)}</code> · MaxDD <code>{_percent(best.get('max_drawdown'))}</code>",
            f"DSR <code>{_number(result.get('deflated_sharpe_ratio'), 3)}</code> · OOS Sharpe <code>{_number(result.get('walk_forward_oos_sharpe'))}</code>",
            f"Verdict <code>{esc(result.get('dsr_verdict') or '—')}</code>",
        ]
        await self.send_message(chat_id, text_card("🧪 Backtest completed", "TEXT RESULT", lines, source="Research job queue", next_commands="/backtests · /researchstatus"))

    def health(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "username": (self.me or {}).get("username"),
            "updates_handled": self.updates_handled,
            "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else 0.0,
            "alert_targets": len(self._alert_targets()),
            "subscribers": len(self._subscribers()),
            "watches": sum(len(subscriber.get("watches", [])) for subscriber in self._subscribers()),
            "alerts_sent": self.alerts_sent,
            "allowlist_configured": bool(self.allowed_user_ids),
            # These two read `True` for a long time after they stopped being
            # true: /halt, /resume and /flatten mutate risk state, and the
            # chart commands send photos. A health endpoint that misreports the
            # blast radius of its own commands is worse than one that omits it,
            # so the shape now describes what the bot can actually do.
            "read_only": False,
            "text_only": False,
            "controls": {
                "commands": 3,
                "gated": True,
                "control_allowlist_configured": bool(self.control_user_ids),
            },
            "charts": "real-data-only",
            "last_error": self.last_error,
        }


_bot: TelegramBot | None = None


def get_bot() -> TelegramBot:
    global _bot
    if _bot is None:
        from modules.audit import get_audit
        from modules.jobs import get_queue
        from modules.risk_proxy import get_gateway
        from modules.tca_engine import get_engine

        _bot = TelegramBot(gateway=get_gateway(), tca=get_engine(), queue=get_queue(), audit=get_audit())
    return _bot


__all__ = [
    "BOT_COMMANDS",
    "BOT_DESCRIPTION",
    "BOT_SHORT_DESCRIPTION",
    "COMMAND_SPECS",
    "HELP_TEXT",
    "TelegramBot",
    "command_catalogue",
    "esc",
    "get_bot",
    "help_text",
    "split_telegram_html",
    "text_card",
]
