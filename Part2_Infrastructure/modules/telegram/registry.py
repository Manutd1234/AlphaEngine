"""``COMMAND_SPECS`` — the one registry that drives dispatch, the menu and the docs.

`_build_command_index` raises on a duplicate name or alias: the registry is the
only map from a typed ``/name`` to a method, and a silent collision would drop a
command. README §6 is generated from this tuple by ``tools/telegram_catalogue.py``.
The ``Tabs`` category mirrors all eleven workspace tabs, including the current
Markets, Proofs and Diffusion surfaces.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CommandSpec:
    name: str
    description: str
    category: str
    usage: str
    example: str
    handler: str
    aliases: tuple[str, ...] = ()
    #: Whether the command appears in Telegram's own "/" command menu, which
    #: caps out at 100 entries. Every command dispatches either way; /commands
    #: lists the complete catalogue. Kept False for the niche reference and
    #: duplicate-view commands so the menu stays under the cap as the
    #: catalogue grows.
    in_menu: bool = True


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    # Nine tab commands live in this first block; Portfolio and Risk below bring
    # the Tabs category to the workspace's full eleven-command mapping.
    CommandSpec("overview", "Overview (All Roles) · System signal & cross-role dashboard + chart", "Tabs", "/overview", "/overview", "_cmd_tab_overview", ("tab_overview", "dashboard")),
    CommandSpec("research", "Research (Quant Researcher) · Strategy sweep & tearsheet + chart", "Tabs", "/research [SYMBOL]", "/research BTCUSDT", "_cmd_tab_research", ("tab_research", "lab")),
    CommandSpec("execution", "Execution (Quant Trader) · Live L2 book & routing + chart", "Tabs", "/execution [SYMBOL]", "/execution BTCUSDT", "_cmd_tab_execution", ("tab_execution", "trade")),
    CommandSpec("data", "Data (Data Engineer) · Quality, freshness & failover + chart", "Tabs", "/data", "/data", "_cmd_tab_data", ("tab_data", "dataeng")),
    CommandSpec("reliability", "Reliability (DevOps/SRE) · Telemetry & latency + chart", "Tabs", "/reliability", "/reliability", "_cmd_tab_reliability", ("tab_reliability", "sre")),
    CommandSpec("developer", "Developer (Quant Developer) · CI/CD, OpenAPI & repo posture + chart", "Tabs", "/developer", "/developer", "_cmd_tab_developer", ("tab_developer", "dev")),
    # Every workspace tab stays in Telegram's native slash menu. The 100-entry
    # platform cap is paid by hiding two redundant utilities below (`/ops`
    # overlaps `/status`; `/refresh` is already on every card), never by hiding
    # a destination from the workspace map. `/coherence` is a saved-command
    # compatibility alias for `/proofs`, not a fourth product name for the same
    # proof surface.
    CommandSpec("markets", "Markets engine — executable Kalshi books, family cost and provenance", "Tabs", "/markets [SERIES]", "/markets", "_cmd_tab_markets", ("tab_markets",)),
    CommandSpec("proofs", "Proofs engine — coherence certificate, witness and index sample", "Tabs", "/proofs [SERIES]", "/proofs", "_cmd_tab_proofs", ("coherence", "tab_coherence", "kalshi", "tab_proofs")),
    CommandSpec("diffusion", "Diffusion engine — absorption, survival and finding sample gates", "Tabs", "/diffusion", "/diffusion", "_cmd_tab_diffusion", ("tab_diffusion",)),

    # Essentials
    CommandSpec("start", "Essentials · Open the command centre", "Essentials", "/start", "/start", "_cmd_start"),
    CommandSpec("menu", "Essentials · Tappable desk menu", "Essentials", "/menu", "/menu", "_cmd_menu", ("home", "tabs")),
    CommandSpec("help", "Essentials · Help by category or command", "Essentials", "/help [CATEGORY|COMMAND]", "/help markets", "_cmd_help"),
    CommandSpec("commands", "Essentials · List the complete command catalogue", "Essentials", "/commands", "/commands", "_cmd_commands"),
    CommandSpec("status", "Essentials · Gateway, feeds, queue and OpenBB", "Essentials", "/status", "/status", "_cmd_status", ("health",)),
    CommandSpec("about", "Essentials · What this independent bot does", "Essentials", "/about", "/about", "_cmd_about"),
    CommandSpec("whoami", "Essentials · Show Telegram user and chat IDs", "Essentials", "/whoami", "/whoami", "_cmd_whoami"),
    CommandSpec("version", "Essentials · Runtime version and bot mode", "Essentials", "/version", "/version", "_cmd_version", in_menu=False),
    CommandSpec("ping", "Essentials · Check command-path responsiveness", "Essentials", "/ping", "/ping", "_cmd_ping", in_menu=False),

    # Portfolio manager. /portfolio and /risk are the 10th and 11th tab commands.
    # Both stay in category "Tabs" and carry a `_tab_footer` mapping to their web
    # rail sections.
    CommandSpec("portfolio", "Portfolio (Portfolio Manager) · Whole-book PM summary + charts", "Tabs", "/portfolio", "/portfolio", "_cmd_portfolio", ("bookstate",)),
    CommandSpec("equity", "Portfolio · Persisted equity curve and period returns", "Portfolio", "/equity [LIMIT]", "/equity", "_cmd_equity", ("curve", "history")),
    CommandSpec("positions", "Portfolio · Open positions and marks", "Portfolio", "/positions [SYMBOL]", "/positions BTCUSDT", "_cmd_positions", ("toppositions", "position")),
    CommandSpec("pnl", "Portfolio · Realised and unrealised P&L", "Portfolio", "/pnl", "/pnl", "_cmd_pnl"),
    CommandSpec("exposure", "Portfolio · Gross, net and leverage", "Portfolio", "/exposure", "/exposure", "_cmd_exposure"),
    CommandSpec("concentration", "Portfolio · Largest weights and effective bets", "Portfolio", "/concentration", "/concentration", "_cmd_concentration"),
    CommandSpec("headroom", "Portfolio · Remaining capacity before limits", "Portfolio", "/headroom", "/headroom", "_cmd_headroom"),
    CommandSpec("risk", "Risk (Risk Manager) · Drawdown, gateway budget & limit utilisation + charts", "Tabs", "/risk", "/risk", "_cmd_risk"),
    CommandSpec("limits", "Portfolio · Deployed hard risk limits", "Portfolio", "/limits", "/limits", "_cmd_limits"),
    CommandSpec("attribution", "Portfolio · Flow and costs by strategy", "Portfolio", "/attribution", "/attribution", "_cmd_attribution"),
    CommandSpec("allocation", "Portfolio · Current vs target weights and the rebalance trades", "Portfolio", "/allocation [ew|iv|erc|mv]", "/allocation", "_cmd_allocation", ("alloc",)),
    CommandSpec("performance", "Portfolio · Realised P&L and fees by strategy sleeve", "Portfolio", "/performance", "/performance", "_cmd_performance", ("perf",)),

    # Market data / OpenBB
    CommandSpec("openbb", "Markets · OpenBB provider readiness", "Markets", "/openbb", "/openbb", "_cmd_openbb"),
    CommandSpec("quote", "Markets · OpenBB quote", "Markets", "/quote SYMBOL [equity|crypto]", "/quote AAPL", "_cmd_quote", ("market",)),
    CommandSpec("bars", "Markets \u00b7 Recent OpenBB OHLCV rows, drawn as close, volume, drawdown or returns", "Markets", "/bars SYMBOL [15m|1h|4h|1d] [COUNT] [close|volume|drawdown|returns]", "/bars AAPL 1d 30 returns", "_cmd_bars"),
    CommandSpec("trend", "Markets · Return and direction over recent bars", "Markets", "/trend SYMBOL [INTERVAL] [COUNT]", "/trend NVDA 1d 20", "_cmd_trend"),
    CommandSpec("range", "Markets · High/low range over recent bars", "Markets", "/range SYMBOL [INTERVAL] [COUNT]", "/range BTCUSDT 4h 12", "_cmd_range", in_menu=False),
    CommandSpec("volume", "Markets · Latest and average volume", "Markets", "/volume SYMBOL [INTERVAL] [COUNT]", "/volume MSFT 1d 20", "_cmd_volume", in_menu=False),
    CommandSpec("news", "Markets · Latest company headlines", "Markets", "/news SYMBOL [COUNT]", "/news AAPL 5", "_cmd_news"),
    CommandSpec("fundamentals", "Markets · Company profile and key metrics", "Markets", "/fundamentals SYMBOL", "/fundamentals NVDA", "_cmd_fundamentals", ("profile", "valuation")),
    CommandSpec("snapshot", "Markets · Quote, fundamentals and headlines", "Markets", "/snapshot SYMBOL [equity|crypto]", "/snapshot AAPL", "_cmd_snapshot"),
    CommandSpec("symbols", "Markets · Tracked instruments and examples", "Markets", "/symbols", "/symbols", "_cmd_symbols", in_menu=False),
    CommandSpec("compare", "Markets · Normalised price overlay across instruments", "Markets", "/compare SYM1 SYM2 [SYM3…] [INTERVAL]", "/compare BTCUSDT ETHUSDT", "_cmd_compare", ("overlay",)),

    # Execution analytics (read-only)
    CommandSpec("book", "Execution · Top of book across venues", "Execution", "/book [SYMBOL]", "/book BTCUSDT", "_cmd_book"),
    CommandSpec("spread", "Execution · Venue and consolidated spreads", "Execution", "/spread [SYMBOL]", "/spread BTCUSDT", "_cmd_spread"),
    CommandSpec("depth", "Execution · Bid/ask depth by venue", "Execution", "/depth [SYMBOL]", "/depth ETHUSDT", "_cmd_depth"),
    CommandSpec("tca", "Execution · VWAP, slippage and smart route", "Execution", "/tca [SYMBOL] [NOTIONAL] [BUY|SELL]", "/tca BTCUSDT 100000 BUY", "_cmd_tca", ("cost",)),
    CommandSpec("route", "Execution · Smart-route allocation only", "Execution", "/route [SYMBOL] [NOTIONAL] [BUY|SELL]", "/route BTCUSDT 50000 SELL", "_cmd_route"),
    CommandSpec("liquidity", "Execution · Fillability and route capacity", "Execution", "/liquidity [SYMBOL] [NOTIONAL]", "/liquidity BTCUSDT 250000", "_cmd_liquidity"),
    CommandSpec("venues", "Execution · Venue connectivity overview", "Execution", "/venues", "/venues", "_cmd_venues"),
    CommandSpec("feedstatus", "Execution · Detailed market-feed health", "Execution", "/feedstatus", "/feedstatus", "_cmd_feedstatus"),
    CommandSpec("orders", "Execution · Recent gateway decisions", "Execution", "/orders [COUNT]", "/orders 10", "_cmd_orders"),
    CommandSpec("fills", "Execution · Recent accepted fills", "Execution", "/fills [COUNT]", "/fills 10", "_cmd_fills"),
    CommandSpec("rejections", "Execution · Recent rejected orders", "Execution", "/rejections [COUNT]", "/rejections 10", "_cmd_rejections"),
    CommandSpec("slippage", "Execution · Aggregate execution slippage", "Execution", "/slippage", "/slippage", "_cmd_slippage", in_menu=False),
    CommandSpec("fees", "Execution · Aggregate execution fees", "Execution", "/fees", "/fees", "_cmd_fees", in_menu=False),

    # Research and audit monitoring (no job submission)
    CommandSpec("researchstatus", "Research · OpenBB and job-system status", "Research", "/researchstatus", "/researchstatus", "_cmd_research_status", in_menu=False),
    CommandSpec("jobs", "Research · Recent research jobs", "Research", "/jobs [COUNT]", "/jobs 10", "_cmd_jobs"),
    CommandSpec("job", "Research · Inspect one job", "Research", "/job JOB_ID", "/job abcd1234", "_cmd_job", in_menu=False),
    CommandSpec("backtests", "Research · Completed backtest history", "Research", "/backtests [COUNT]", "/backtests 10", "_cmd_backtests", ("runs", "experiments")),
    CommandSpec("timeline", "Execution · Lifecycle of one order from the audit trail", "Execution", "/timeline ORDER_ID", "/timeline abc123", "_cmd_timeline", ("ordertrace",)),
    CommandSpec("working", "Execution · Orders resting on the book right now", "Execution", "/working [SYMBOL]", "/working", "_cmd_working"),
    CommandSpec("ops", "Essentials · Structured reliability snapshot", "Essentials", "/ops", "/ops", "_cmd_ops", in_menu=False),
    CommandSpec("backtest", "Research · Queue a parameter sweep on the shared jobs engine", "Research", "/backtest SYMBOL [INTERVAL] [STRATEGY]", "/backtest BTCUSDT 1h ma_cross", "_cmd_backtest", ("sweep",)),
    CommandSpec("rag", "Research · Similarity search (desk-scoped when enabled)", "Research", "/rag QUERY", "/rag momentum drawdown", "_cmd_rag", ("similar", "recall")),
    CommandSpec("strategies", "Research · Supported strategy catalogue", "Research", "/strategies [STRATEGY]", "/strategies", "_cmd_strategies", ("codex", "guide")),
    CommandSpec("intervals", "Research · Supported market horizons", "Research", "/intervals", "/intervals", "_cmd_intervals", in_menu=False),
    CommandSpec("events", "Research · Recent risk/audit events", "Research", "/events [COUNT]", "/events 10", "_cmd_events"),
    CommandSpec("incidents", "Research · Warning and critical events", "Research", "/incidents [COUNT]", "/incidents 10", "_cmd_incidents"),

    # Notification preferences
    CommandSpec("subscribe", "Alerts · Receive operational notifications", "Alerts", "/subscribe", "/subscribe", "_cmd_subscribe", ("unmute",)),
    CommandSpec("unsubscribe", "Alerts · Stop optional notifications", "Alerts", "/unsubscribe", "/unsubscribe", "_cmd_unsubscribe", ("mute",)),
    CommandSpec("subscriptions", "Alerts · Show notification state", "Alerts", "/subscriptions", "/subscriptions", "_cmd_subscriptions", ("alerts",), in_menu=False),
    CommandSpec("role", "Alerts · Set this chat's desk role for targeted alerts", "Alerts", "/role [pm|risk|trader|dev|any]", "/role pm", "_cmd_role", ("desk",)),
    CommandSpec("thresholds", "Alerts · Risk rules, their limits and what they read now", "Alerts", "/thresholds", "/thresholds", "_cmd_thresholds", ("rules",)),
    CommandSpec("live", "Alerts · Stream the desk into one message that updates itself", "Alerts", "/live [on|off]", "/live on", "_cmd_live", ("stream",)),
    CommandSpec("livestatus", "Alerts · What is streaming, and how often", "Alerts", "/livestatus", "/livestatus", "_cmd_livestatus", in_menu=False),
    CommandSpec("probe", "Execution · Cost of the default probe, no arguments needed", "Execution", "/probe [NOTIONAL] [BUY|SELL]", "/probe", "_cmd_probe", ("cost_probe",)),
    CommandSpec("engine", "Developer · Which decision engine is running, and its measured cost", "Developer", "/engine", "/engine", "_cmd_engine", ("core",)),
    CommandSpec("refresh", "Overview · Re-read the desk from the gateway right now", "Overview", "/refresh", "/refresh", "_cmd_refresh", ("resync",), in_menu=False),
    CommandSpec("watch", "Alerts · Watch execution-cost deterioration", "Alerts", "/watch SYMBOL [NOTIONAL] [MAX_BPS]", "/watch BTCUSDT 100000 25", "_cmd_watch"),
    CommandSpec("unwatch", "Alerts · Remove one or all liquidity watches", "Alerts", "/unwatch [SYMBOL]", "/unwatch BTCUSDT", "_cmd_unwatch", in_menu=False),
    CommandSpec("watches", "Alerts · Show active liquidity watches", "Alerts", "/watches", "/watches", "_cmd_watches", in_menu=False),
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
    CommandSpec("size", "Risk · Kelly position sizing from a win rate", "Risk", "/size WIN_RATE PAYOFF [EQUITY]", "/size 0.55 1.8", "_cmd_size", ("kelly",), in_menu=False),
    CommandSpec("dislocation", "Risk · Cross-venue crossed-book check", "Risk", "/dislocation SYMBOL", "/dislocation BTCUSDT", "_cmd_dislocation", ("arb",), in_menu=False),
    CommandSpec("montecarlo", "Risk · Bootstrapped terminal-P&L cone over a horizon", "Risk", "/montecarlo [1|5|20] [BLOCK]", "/montecarlo 5 10", "_cmd_montecarlo", ("mc", "cone")),
    CommandSpec("beta", "Risk · Beta and hedge ratio of a symbol against a reference", "Risk", "/beta SYM [REF]", "/beta ETHUSDT BTCUSDT", "_cmd_beta", ("hedge",)),

    # Research fold detail — reads the newest in-process completed backtest and
    # falls back to the audit history with an honest note when the run happened
    # in another process.
    CommandSpec("walkforward", "Research · In-sample vs out-of-sample Sharpe per fold", "Research", "/walkforward SYMBOL [STRATEGY]", "/walkforward BTCUSDT", "_cmd_walkforward", ("wf",)),
    CommandSpec("stability", "Research · Parameter-grid heatmap and the stable region", "Research", "/stability SYMBOL [STRATEGY]", "/stability BTCUSDT", "_cmd_stability", ("surface", "paramgrid")),
    CommandSpec("overfit", "Research · DSR, PSR, PBO and the minimum track record", "Research", "/overfit SYMBOL [STRATEGY]", "/overfit BTCUSDT", "_cmd_overfit", ("pbo", "dsr")),
    CommandSpec("decision", "Research · Promotion gates and sizing for a candidate", "Research", "/decision SYMBOL [STRATEGY]", "/decision BTCUSDT", "_cmd_decision", ("promote",)),

    # Execution / operations analytics — read-only reads of live state and audit.
    CommandSpec("lineage", "Execution · Signal path OpenBB→feeds→book→gates→decisions→audit", "Execution", "/lineage [SYMBOL]", "/lineage", "_cmd_lineage", ("signalpath", "loop")),
    CommandSpec("gates", "Execution · Dry-run the 17 pre-trade gates against current state", "Execution", "/gates [SYMBOL] [NOTIONAL] [BUY|SELL]", "/gates BTCUSDT", "_cmd_gates", ("pretrade", "preflight")),
    CommandSpec("quality", "Execution · Fill quality by venue or strategy", "Execution", "/quality [venue|strategy]", "/quality", "_cmd_quality", ("fillquality",)),
    CommandSpec("imbalance", "Execution · Order-book imbalance per venue", "Execution", "/imbalance SYMBOL", "/imbalance BTCUSDT", "_cmd_imbalance", ("imb", "pressure")),
    CommandSpec("costs", "Execution · Session fees versus slippage", "Execution", "/costs [YYYY-MM-DD]", "/costs", "_cmd_costs", ("sessioncosts",)),
    CommandSpec("latency", "Execution · Decision-latency CDF and route tail", "Execution", "/latency", "/latency", "_cmd_latency", ("decisionlatency", "tail")),
    CommandSpec("blotter", "Execution · Merged recent orders and working, rejections by gate", "Execution", "/blotter [all|fills|rejects|working] [N]", "/blotter", "_cmd_blotter", ("tape",)),
    CommandSpec("spreadhistory", "Execution · Spread, slippage or depth history per venue", "Execution", "/spreadhistory SYMBOL [VENUE] [spread|slip|depth]", "/spreadhistory BTCUSDT", "_cmd_spreadhistory", ("tcahistory", "liqhistory")),

    # Data engineer — feed trust, provenance and the web telemetry ledger.
    CommandSpec("trust", "Data · Feed trust verdict and book-age freshness", "Data", "/trust", "/trust", "_cmd_trust", ("datatrust",)),
    CommandSpec("dataquality", "Data · Feed degrade/recover events and reconnect counts", "Data", "/dataquality [N]", "/dataquality", "_cmd_dataquality", ("dq", "quarantine"), in_menu=False),
    CommandSpec("ack", "Data · Take a data-quality escalation, by id", "Data", "/ack <ID>", "/ack 7", "_cmd_ack", ("acknowledge",), in_menu=False),
    CommandSpec("payload", "Data · Per-venue provenance for one symbol", "Data", "/payload SYMBOL", "/payload BTCUSDT", "_cmd_payload", ("lineagepayload", "provenance"), in_menu=False),
    CommandSpec("providers", "Data · OpenBB, venue feeds and web-ops quota/outages", "Data", "/providers", "/providers", "_cmd_providers"),
    CommandSpec("tasks", "Data · The persisted Data work queue by status, and the research jobs engine", "Data", "/tasks", "/tasks", "_cmd_tasks", ("queue", "work"), in_menu=False),

    # DevOps / SRE — SLIs, dependency planes, breakers, traces and the runbook.
    CommandSpec("sli", "Reliability · Service-level indicators and the native core's latency", "Reliability", "/sli", "/sli", "_cmd_sli", ("slis", "attention")),
    CommandSpec("planes", "Reliability · Provider, platform and evidence dependency planes", "Reliability", "/planes", "/planes", "_cmd_planes", ("dependencies", "deps")),
    CommandSpec("circuits", "Reliability · Risk breakers as a headroom ladder", "Reliability", "/circuits", "/circuits", "_cmd_circuits", ("breakers",)),
    CommandSpec("traces", "Reliability · Recent audit events merged with web outages", "Reliability", "/traces [N]", "/traces", "_cmd_traces", ("logs",), in_menu=False),
    CommandSpec("remediation", "Reliability · The five typed controls, their scope and live state", "Reliability", "/remediation", "/remediation", "_cmd_remediation", ("runbook",), in_menu=False),
    CommandSpec("webops", "Reliability · Web telemetry ledger: p50/p99, outages, quota", "Reliability", "/webops", "/webops", "_cmd_webops", ("webtelemetry",), in_menu=False),

    # Quant developer — launch readiness, CI gates, the API surface and the repo.
    CommandSpec("readiness", "Developer · Launch-readiness grid across runtime and backends", "Developer", "/readiness", "/readiness", "_cmd_readiness", ("launchgates",)),
    CommandSpec("cicd", "Developer · The verify gates a deploy must pass", "Developer", "/cicd", "/cicd", "_cmd_cicd", ("verify", "pipeline"), in_menu=False),
    CommandSpec("apis", "Developer · OpenAPI surface by tag, or one tag's operations", "Developer", "/apis [TAG]", "/apis", "_cmd_apis", ("routes", "openapi"), in_menu=False),
    CommandSpec("codebase", "Developer · Python file and line counts by area", "Developer", "/codebase", "/codebase", "_cmd_codebase", ("repo",), in_menu=False),

    # Controls — gated by TELEGRAM_CONTROL_USER_IDS and a typed challenge.
    CommandSpec("halt", "Controls · Engage the kill switch", "Controls", "/halt [SYMBOL] | /halt CODE", "/halt", "_cmd_halt"),
    CommandSpec("resume", "Controls · Release the kill switch", "Controls", "/resume [SYMBOL] | /resume CODE", "/resume", "_cmd_resume"),
    CommandSpec("flatten", "Controls · Close every open position", "Controls", "/flatten [SYMBOL] | /flatten CODE", "/flatten", "_cmd_flatten"),
    CommandSpec("reduceonly", "Controls · Accept only risk-reducing orders", "Controls", "/reduceonly [on|off] | /reduceonly CODE", "/reduceonly on", "_cmd_reduceonly", ("softhalt",)),
    CommandSpec("resetbook", "Controls · Reset the paper book and session accounting", "Controls", "/resetbook | /resetbook CODE", "/resetbook", "_cmd_resetbook"),
    CommandSpec("replay", "Controls · Re-fetch a capability through the validated path and record the contract result", "Controls", "/replay [SYMBOL] | /replay CODE", "/replay BTCUSDT", "_cmd_replay", ("refetch",)),

    # Web-parity commands (2026-08-21). Each mirrors a web rail section that had no
    # Telegram equivalent. All in_menu=False: Telegram's "/" menu caps at 100 and 97
    # slots were already taken — these still dispatch and still list under /commands.
    CommandSpec("desks", "Overview \u00b7 Seven desk roles, the question each asks and the live figure answering it", "Overview", "/desks [SYMBOL]", "/desks BTCUSDT", "_cmd_desks", ("roles", "deskroles"), in_menu=False),
    CommandSpec("activity", "Execution \u00b7 The Activity section: order record, decision tape and alert feed", "Execution", "/activity [record|fills|unfilled|active|tape|alerts] [N]", "/activity", "_cmd_activity", ("desktape", "feed"), in_menu=False),
    CommandSpec("drivers", "Risk \u00b7 Per-position Euler risk contribution, marginal risk and limit pressure", "Risk", "/drivers [INTERVAL]", "/drivers", "_cmd_drivers", ("euler", "riskdrivers"), in_menu=False),
    CommandSpec("oraclevar", "Risk \u00b7 In-database GBM terminal VaR check and its backtest exceptions", "Risk", "/oraclevar [1|10|30|90]", "/oraclevar", "_cmd_oraclevar", ("gbmvar",), in_menu=False),
    CommandSpec("shock", "Risk \u00b7 Scenario report: every leg a shock moves, and the halt line", "Risk", "/shock [SCENARIO|SYM=PCT ...]", "/shock crypto_cascade", "_cmd_shock", ("stresslegs", "shocks"), in_menu=False),
    CommandSpec("parameters", "Research \u00b7 Sweep grid, cost model and the frictions this gateway does not charge", "Research", "/parameters [STRATEGY]", "/parameters ma_cross", "_cmd_parameters", ("sweepgrid", "frictions"), in_menu=False),
    CommandSpec("fitted", "Research \u00b7 Fitted-model reproducibility capsule: seed, data hash, features, purge, PBO", "Research", "/fitted [RUN_ID]", "/fitted", "_cmd_fitted", ("mlruns", "capsule"), in_menu=False),
    CommandSpec("services", "Reliability \u00b7 Gateway components and per-provider circuit posture", "Reliability", "/services", "/services", "_cmd_services", ("servicecircuits", "components"), in_menu=False),

    # in_menu=True deliberately: this is the read-only answer to "can the bot show me
    # what the ticket would say". It takes the menu to 98/100 — the last slots.
    CommandSpec("preview", "Execution \u00b7 Read-only pre-trade preview of the order ticket's verdict", "Execution", "/preview [SYMBOL] [BUY|SELL] [NOTIONAL]", "/preview BTCUSDT BUY 50000", "_cmd_preview", ("ticket", "verdict")),

    # Streaming approximation (2026-08-21): a chat app cannot hold a socket, so
    # "live" is a push on a SETTLED move — see SettledMove in _mixins/subscriptions.py.
    CommandSpec("track", "Alerts \u00b7 Push this chat when a measure has really moved", "Alerts", "/track SYMBOL|equity|drawdown|gross [MOVE_%]", "/track BTCUSDT 0.5", "_cmd_track", ("follow",)),
    CommandSpec("untrack", "Alerts \u00b7 Stop move pushes for one target, or all of them", "Alerts", "/untrack [SYMBOL|MEASURE]", "/untrack BTCUSDT", "_cmd_untrack", in_menu=False),
    CommandSpec("tracking", "Alerts \u00b7 What this chat is pushed on, and the rule that decides", "Alerts", "/tracking", "/tracking", "_cmd_tracking", ("tracked",), in_menu=False),
)

def _build_command_index(specs: tuple[CommandSpec, ...]) -> dict[str, CommandSpec]:
    """One name, one spec — a collision fails the import, not the user.

    The loop this replaces let a later alias silently overwrite an earlier
    command: `snapshot` carried the alias "research", so `/research` — a
    registered Tab command with its own handler — dispatched to `/snapshot`
    for as long as nobody noticed. Raising turns that class of defect into a
    red test suite instead of a quietly wrong command.
    """
    index: dict[str, CommandSpec] = {}
    for spec in specs:
        for name in (spec.name, *spec.aliases):
            key = f"/{name}"
            if key in index:
                raise RuntimeError(
                    f"telegram command registry collision: {key} is claimed by "
                    f"/{index[key].name} and /{spec.name}"
                )
            index[key] = spec
    return index


_COMMAND_BY_NAME: dict[str, CommandSpec] = _build_command_index(COMMAND_SPECS)

# Telegram's setMyCommands accepts at most 100 entries, so the pushed menu is
# the `in_menu` subset. Every spec dispatches regardless; /commands lists all.
BOT_COMMANDS = [(spec.name, spec.description) for spec in COMMAND_SPECS if spec.in_menu]
BOT_SHORT_DESCRIPTION = "Independent alerts and portfolio, market and risk reads — text, charts, buttons — plus six gated controls."
BOT_DESCRIPTION = (
    "AlphaEngine Companion is separate from the web workspace. It reads portfolio state, "
    "OpenBB market data, execution analytics, research status and alerts — as text "
    "cards, real-data charts and buttons; /menu opens the desks. There is no "
    "/order; /backtest queues research, not trades. Six controls (/halt, /resume, /flatten, "
    "/reduceonly, /resetbook, /replay) are typed, never tapped — only the confirm is a button, gated by an operator allow-list "
    "and a single-use code. Send /commands for the full catalogue."
)

def _category_names() -> list[str]:
    return list(dict.fromkeys(spec.category for spec in COMMAND_SPECS))
