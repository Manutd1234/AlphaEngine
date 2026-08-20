"""
AlphaEngine Trading Automation — System Constants & Risk Limits
===============================================================

Single source of truth for every tunable in the gateway. Everything is
overridable through environment variables (or a local ``.env`` file) so that the
same image can be promoted dev -> staging -> prod without a code change.

Risk limits deliberately live *in code with env overrides* rather than in a
database: a limit that can be silently mutated at runtime by a compromised
service is not a limit. Changing a hard limit requires a deploy and therefore a
code review.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# .env loading (optional dependency — the system runs fine without it)
# --------------------------------------------------------------------------- #
BASE_DIR = Path(__file__).resolve().parent

try:  # pragma: no cover - trivial
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except Exception:  # pragma: no cover  # noqa: S110 - see below
    # Nothing is logged here on purpose: logging is not configured yet at import
    # time, and a missing .env is the normal case in CI and in a container where
    # configuration arrives as real environment variables.
    pass


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


def _env_float(key: str, default: float) -> float:
    raw = _env(key)
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    raw = _env(key)
    try:
        return int(float(raw)) if raw else default
    except ValueError:
        return default


def _env_bool(key: str, default: bool) -> bool:
    raw = _env(key).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "y", "on"}


def _env_list(key: str, default: list[str]) -> list[str]:
    raw = _env(key)
    if not raw:
        return list(default)
    return [item.strip().upper() for item in raw.split(",") if item.strip()]


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Settings:
    # ---- Application -------------------------------------------------------
    app_name: str = "AlphaEngine Trading Automation — Execution Gateway & Risk Portal"
    version: str = "1.0.0"
    environment: str = field(default_factory=lambda: _env("ENVIRONMENT", "development"))
    host: str = field(default_factory=lambda: _env("HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: _env_int("PORT", 8000))
    # Public base URL of this service (needed only for Telegram webhook delivery).
    public_url: str = field(default_factory=lambda: _env("PUBLIC_URL", "").rstrip("/"))

    # ---- Data / persistence ------------------------------------------------
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(BASE_DIR / "data"))))
    db_path: Path = field(
        default_factory=lambda: Path(
            _env("DB_PATH", str(Path(_env("DATA_DIR", str(BASE_DIR / "data"))) / "alphaengine.duckdb"))
        )
    )

    # ---- Data operations: quality ledger, work queue, jobs -----------------
    # The durable data-plane state lives in one stdlib sqlite3 file on the
    # same volume as the audit database (modules/data_ops_store.py).
    data_ops_db_path: Path = field(default_factory=lambda: Path(
        _env("DATA_OPS_DB_PATH", str(Path(_env("DATA_DIR", str(BASE_DIR / "data"))) / "data_ops.sqlite"))
    ))
    # "sqlite" (default) or "postgres" — see open_data_ops_store for what it does not buy.
    data_ops_backend: str = field(default_factory=lambda: _env("DATA_OPS_BACKEND", "sqlite").strip().lower())
    # Contract findings pushed by every web instance are kept this long.
    data_quality_retention_days: int = field(default_factory=lambda: max(1, min(90, _env_int("DATA_QUALITY_RETENTION_DAYS", 7))))
    # The window the aggregate view summarises, and the number of recent
    # findings it carries.
    data_quality_view_window_minutes: int = field(default_factory=lambda: _env_int("DATA_QUALITY_VIEW_WINDOW_MINUTES", 1440))
    data_quality_recent_limit: int = field(default_factory=lambda: _env_int("DATA_QUALITY_RECENT_LIMIT", 25))
    # Escalation rules. R1: this many fatal findings from one provider inside
    # the window. R2: a contract-fail rate above this fraction, once at least
    # min_samples payloads were evaluated. One escalation per (rule, provider)
    # per cooldown; auto-resolved when the condition clears.
    data_quality_escalate_fatal_count: int = field(default_factory=lambda: _env_int("DATA_QUALITY_ESCALATE_FATAL_COUNT", 3))
    data_quality_escalate_window_minutes: int = field(default_factory=lambda: _env_int("DATA_QUALITY_ESCALATE_WINDOW_MINUTES", 15))
    data_quality_escalate_fail_rate: float = field(default_factory=lambda: _env_float("DATA_QUALITY_ESCALATE_FAIL_RATE", 0.25))
    data_quality_escalate_min_samples: int = field(default_factory=lambda: _env_int("DATA_QUALITY_ESCALATE_MIN_SAMPLES", 8))
    data_quality_escalate_cooldown_minutes: int = field(default_factory=lambda: _env_int("DATA_QUALITY_ESCALATE_COOLDOWN_MINUTES", 60))
    # Seed the Data tab's work queue with its nine sample rows the first time
    # the table is empty; they are marked as samples and can be edited away.
    data_work_seed: bool = field(default_factory=lambda: _env_bool("DATA_WORK_SEED", True))
    # Replay and backfill jobs. Replay re-runs a capability through the web
    # workspace's own validated fetch path (its adapters, credentials and
    # contracts live only there); the base URL defaults to the origin of the
    # paper-equity quote façade when that is set. Backfill fetches bars in a
    # date range and merges them into the gateway's bar cache after a contract
    # check. Schedules are a config-driven list; see modules/data_scheduler.py.
    web_workspace_url: str = field(default_factory=lambda: _env("WEB_WORKSPACE_URL", "").rstrip("/"))
    data_job_timeout_s: float = field(default_factory=lambda: _env_float("DATA_JOB_TIMEOUT_S", 20.0))
    data_backfill_max_bars: int = field(default_factory=lambda: _env_int("DATA_BACKFILL_MAX_BARS", 20_000))
    data_schedules: list[str] = field(default_factory=lambda: [
        item.strip() for item in _env("DATA_SCHEDULES", "").split(";") if item.strip()
    ])
    data_scheduler_tick_s: float = field(default_factory=lambda: _env_float("DATA_SCHEDULER_TICK_S", 30.0))
    # The on-call rota and a second escalation channel — E2.10 ships both as
    # mechanism; an empty roster is a supported state. See modules/oncall.py for
    # the grammar and why it is not the DATA_SCHEDULES cadence grammar.
    data_oncall: str = field(default_factory=lambda: _env("DATA_ONCALL", ""))
    data_ops_webhook_url: str = field(default_factory=lambda: _env("DATA_OPS_WEBHOOK_URL", ""))

    # ---- Module A: TCA / market data --------------------------------------
    symbols: list[str] = field(default_factory=lambda: _env_list("SYMBOLS", ["BTCUSDT", "ETHUSDT", "SOLUSDT"]))
    venues: list[str] = field(default_factory=lambda: _env_list("VENUES", ["BINANCE", "BYBIT"]))
    book_depth: int = field(default_factory=lambda: _env_int("BOOK_DEPTH", 50))
    # Default notional used for slippage / VWAP estimates ($100k per the blueprint).
    default_probe_notional: float = field(default_factory=lambda: _env_float("PROBE_NOTIONAL_USD", 100_000.0))
    # Persist a TCA snapshot to the audit log every N seconds (0 disables).
    tca_snapshot_interval_s: float = field(default_factory=lambda: _env_float("TCA_SNAPSHOT_INTERVAL_S", 15.0))
    # Seconds without a book update before a venue is declared stale.
    venue_stale_after_s: float = field(default_factory=lambda: _env_float("VENUE_STALE_AFTER_S", 10.0))
    ws_reconnect_base_s: float = field(default_factory=lambda: _env_float("WS_RECONNECT_BASE_S", 1.0))
    ws_reconnect_max_s: float = field(default_factory=lambda: _env_float("WS_RECONNECT_MAX_S", 30.0))
    enable_market_data: bool = field(default_factory=lambda: _env_bool("ENABLE_MARKET_DATA", True))
    # When every venue feed is down (e.g. offline grading environment) synthesise a
    # book so the UI stays demonstrable. ALWAYS tagged `synthetic: true` in payloads.
    allow_synthetic_book: bool = field(default_factory=lambda: _env_bool("ALLOW_SYNTHETIC_BOOK", True))

    binance_ws_url: str = field(default_factory=lambda: _env("BINANCE_WS_URL", "wss://stream.binance.com:9443/stream"))
    binance_rest_url: str = field(default_factory=lambda: _env("BINANCE_REST_URL", "https://api.binance.com"))
    bybit_ws_url: str = field(default_factory=lambda: _env("BYBIT_WS_URL", "wss://stream.bybit.com/v5/public/spot"))

    # ---- Supabase mirror + RAG (optional; all empty/off by default) -------
    # DuckDB stays authoritative. These enable a best-effort Postgres mirror
    # and the pgvector research index; with any of the first two empty every
    # Supabase code path is a no-op and the suite passes offline.
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL", ""))
    supabase_service_role_key: str = field(default_factory=lambda: _env("SUPABASE_SERVICE_ROLE_KEY", ""))
    supabase_mirror_enabled: bool = field(default_factory=lambda: _env_bool("SUPABASE_MIRROR_ENABLED", False))
    supabase_desk_id: str = field(default_factory=lambda: _env("SUPABASE_DESK_ID", "00000000-0000-0000-0000-000000000001"))
    supabase_timeout_s: float = field(default_factory=lambda: _env_float("SUPABASE_TIMEOUT_S", 5.0))
    supabase_mirror_queue_max: int = field(default_factory=lambda: _env_int("SUPABASE_MIRROR_QUEUE_MAX", 1000))
    research_rag_enabled: bool = field(default_factory=lambda: _env_bool("RESEARCH_RAG_ENABLED", False))

    # ---- Module B: Pre-trade risk limits ----------------------------------
    # Hard ceiling on a single order's notional value. Fat-finger guard.
    max_order_notional_usd: float = field(default_factory=lambda: _env_float("MAX_ORDER_NOTIONAL_USD", 50_000.0))
    # Aggregate gross notional across all open positions.
    max_gross_exposure_usd: float = field(default_factory=lambda: _env_float("MAX_GROSS_EXPOSURE_USD", 500_000.0))
    # Per-symbol net notional ceiling.
    max_symbol_notional_usd: float = field(default_factory=lambda: _env_float("MAX_SYMBOL_NOTIONAL_USD", 150_000.0))
    # Token-bucket rate limit: sustained orders/second, with a small burst allowance.
    max_orders_per_sec: float = field(default_factory=lambda: _env_float("MAX_ORDERS_PER_SEC", 5.0))
    rate_limit_burst: int = field(default_factory=lambda: _env_int("RATE_LIMIT_BURST", 10))
    # Daily drawdown circuit breaker, as a fraction of start-of-day equity.
    max_daily_drawdown_pct: float = field(default_factory=lambda: _env_float("MAX_DAILY_DRAWDOWN_PCT", 0.05))
    # Fraction of the drawdown budget at which the desk goes reduce-only:
    # risk-increasing orders are refused while risk-reducing ones still pass.
    # Between this and 1.0 the response is graduated instead of binary — the
    # FIA practice of letting a desk close out of trouble but not deeper into
    # it. Set to 1.0 to disable and keep the original all-or-nothing behaviour.
    reduce_only_threshold: float = field(default_factory=lambda: _env_float("REDUCE_ONLY_THRESHOLD", 0.80))
    # Advisory ceiling on 1-day 95% VaR as a fraction of equity. Reported, never
    # enforced: VaR needs history, and denying orders on a missing covariance
    # would halt a healthy book on its first day. Prop-desk practice is 1–3%.
    var_budget_pct: float = field(default_factory=lambda: _env_float("VAR_BUDGET_PCT", 0.02))
    # Limit price may not deviate from mid by more than this many bps (fat-finger price guard).
    max_price_deviation_bps: float = field(default_factory=lambda: _env_float("MAX_PRICE_DEVIATION_BPS", 500.0))
    # Reject an order whose *estimated* slippage exceeds this (liquidity guard).
    max_est_slippage_bps: float = field(default_factory=lambda: _env_float("MAX_EST_SLIPPAGE_BPS", 75.0))
    # --- pushed risk alerts (modules/telegram.py, _risk_tick) ------------- #
    # Each rule is a fraction of equity (or of the book, for concentration) at
    # or above which the desk pushes a breach to its subscribers, and below
    # which it pushes a recovery. Zero disables a rule outright rather than
    # setting an unreachable threshold — "off" and "never fires in practice"
    # are different states and only one of them is honest on /thresholds.
    #
    # Drawdown leads at 3 % because it is the figure the breaker itself reads
    # (RiskGateway.daily_drawdown_pct), so the alert and the halt cannot
    # disagree about what is happening. It sits well below the 5 % default of
    # MAX_DAILY_DRAWDOWN_PCT on purpose: an alert that fires at the same
    # moment as the kill switch is a notification, not a warning.
    alert_drawdown_pct: float = field(default_factory=lambda: _env_float("ALERT_DRAWDOWN_PCT", 0.03))
    # 1-day 95 % historical VaR as a fraction of equity. Forward-looking and a
    # model estimate, which is why it is reported beside the realised drawdown
    # rather than instead of it.
    alert_var95_pct: float = field(default_factory=lambda: _env_float("ALERT_VAR95_PCT", 0.03))
    # Gross exposure over equity. Off by default: a desk running deliberate
    # leverage would be paged constantly, and the right number is a house
    # decision rather than something this file can guess.
    alert_gross_exposure_pct: float = field(default_factory=lambda: _env_float("ALERT_GROSS_EXPOSURE_PCT", 0.0))
    # Largest single position as a share of gross. Off by default for the same
    # reason: a one-instrument desk is 100 % concentrated and correct.
    alert_concentration_pct: float = field(default_factory=lambda: _env_float("ALERT_CONCENTRATION_PCT", 0.0))
    # How often the rules are evaluated. The liquidity watch runs at 20 s and
    # walks the book; these are arithmetic over state already in memory.
    alert_risk_interval_s: float = field(default_factory=lambda: _env_float("ALERT_RISK_INTERVAL_S", 20.0))
    # Notional starting equity for the paper book.
    starting_equity_usd: float = field(default_factory=lambda: _env_float("STARTING_EQUITY_USD", 1_000_000.0))
    # Persist a mark-to-market equity observation every N seconds (0 disables).
    # Long enough that a day of trading is a few hundred rows, short enough to
    # show the shape of an intraday drawdown.
    equity_snapshot_interval_s: float = field(default_factory=lambda: _env_float("EQUITY_SNAPSHOT_INTERVAL_S", 60.0))
    #: How often the book is marked to market and the drawdown breaker checked.
    #:
    #: This is the desk's reaction time to its own losses, and it was 5s. The
    #: work on each tick is arithmetic over an in-memory book — no I/O, no
    #: database — so 1s costs almost nothing and the breaker trips up to four
    #: seconds sooner. It also sets the floor for how fresh any pushed P&L can
    #: be: streaming faster than this only delivers the same number more often.
    risk_monitor_interval_s: float = field(default_factory=lambda: _env_float("RISK_MONITOR_INTERVAL_S", 1.0))
    # Taker fee applied to paper fills, in bps.
    paper_fee_bps: float = field(default_factory=lambda: _env_float("PAPER_FEE_BPS", 4.0))
    # Equity orders use a trusted quote rather than an exchange ladder. Keep the
    # model explicit and conservative: this is simulated execution, never L2.
    paper_equity_slippage_bps: float = field(default_factory=lambda: _env_float("PAPER_EQUITY_SLIPPAGE_BPS", 8.0))
    # A weekend close remains usable for a paper demonstration, but a quote
    # older than a week is not evidence a risk engine should size against.
    paper_equity_quote_max_age_s: float = field(default_factory=lambda: _env_float("PAPER_EQUITY_QUOTE_MAX_AGE_S", 604_800.0))
    # Optional server-side quote bridge for clients that predate the enriched
    # order contract. The production workflow points this at the web portal's
    # validated provider facade; empty keeps unknown symbols fail-closed.
    paper_equity_quote_url: str = field(default_factory=lambda: _env("PAPER_EQUITY_QUOTE_URL", ""))
    paper_equity_quote_timeout_s: float = field(default_factory=lambda: _env_float("PAPER_EQUITY_QUOTE_TIMEOUT_S", 5.0))
    # Maker fee, for a resting order that was filled *by* someone crossing the
    # spread rather than by crossing it. Charging a resting fill the taker fee
    # would report a cost the desk did not pay.
    paper_maker_fee_bps: float = field(default_factory=lambda: _env_float("PAPER_MAKER_FEE_BPS", 1.0))
    # How often the resting book is checked against the consolidated touch.
    working_order_sweep_s: float = field(default_factory=lambda: _env_float("WORKING_ORDER_SWEEP_S", 1.0))
    # A ceiling on the resting book itself. Without it a runaway algo leaves an
    # unbounded number of orders alive, which is unbounded memory and an
    # unbounded sweep — the failure Module B exists to stop.
    max_working_orders: int = field(default_factory=lambda: _env_int("MAX_WORKING_ORDERS", 200))

    # ---- Module C: Backtester ---------------------------------------------
    backtest_max_combos: int = field(default_factory=lambda: _env_int("BACKTEST_MAX_COMBOS", 400))
    backtest_default_bars: int = field(default_factory=lambda: _env_int("BACKTEST_DEFAULT_BARS", 1500))
    backtest_fee_bps: float = field(default_factory=lambda: _env_float("BACKTEST_FEE_BPS", 6.0))
    backtest_slippage_bps: float = field(default_factory=lambda: _env_float("BACKTEST_SLIPPAGE_BPS", 2.0))
    walk_forward_folds: int = field(default_factory=lambda: _env_int("WALK_FORWARD_FOLDS", 4))
    job_workers: int = field(default_factory=lambda: _env_int("JOB_WORKERS", 2))
    # Celery/Redis is used automatically when a broker URL is configured.
    celery_broker_url: str = field(default_factory=lambda: _env("CELERY_BROKER_URL", _env("REDIS_URL", "")))
    celery_result_backend: str = field(
        default_factory=lambda: _env("CELERY_RESULT_BACKEND", _env("CELERY_BROKER_URL", _env("REDIS_URL", "")))
    )

    # ---- Telegram ----------------------------------------------------------
    telegram_bot_token: str = field(default_factory=lambda: _env("TELEGRAM_BOT_TOKEN"))
    # Shared secret echoed by Telegram in X-Telegram-Bot-Api-Secret-Token.
    telegram_webhook_secret: str = field(default_factory=lambda: _env("TELEGRAM_WEBHOOK_SECRET"))
    # Stable Telegram *user* IDs authorised to read operational data. Empty is
    # fail-closed: only bootstrap commands such as /whoami remain available.
    # Fall back to the legacy private-chat setting so existing local configs do
    # not break; group deployments should always set ALLOWED_USER_IDS explicitly.
    telegram_allowed_user_ids: list[str] = field(
        default_factory=lambda: [
            value.strip()
            for value in _env("TELEGRAM_ALLOWED_USER_IDS", _env("TELEGRAM_ALLOWED_CHAT_IDS")).split(",")
            if value.strip()
        ]
    )
    # A SECOND, narrower allow-list for the commands that change risk state
    # (/halt, /resume, /flatten). Deliberately separate from the read allow-list
    # above and empty by default, so the companion stays reporting-only unless
    # someone opts in explicitly.
    #
    # The two answer different questions. Being on the read list means "you may
    # see this book". Being here means "you may stop the desk". Collapsing them
    # would mean every analyst added for /portfolio silently gains a kill
    # switch, which is exactly the accident this split exists to prevent.
    telegram_control_user_ids: list[str] = field(
        default_factory=lambda: [
            value.strip()
            for value in _env("TELEGRAM_CONTROL_USER_IDS").split(",")
            if value.strip()
        ]
    )
    # Legacy compatibility only. Alert destinations are configured separately.
    telegram_allowed_chat_ids: list[str] = field(
        default_factory=lambda: [c.strip() for c in _env("TELEGRAM_ALLOWED_CHAT_IDS").split(",") if c.strip()]
    )
    # Chat IDs that receive unsolicited risk / execution alerts.
    telegram_alert_chat_ids: list[str] = field(
        default_factory=lambda: [
            c.strip()
            for c in _env("TELEGRAM_ALERT_CHAT_IDS", _env("TELEGRAM_ALLOWED_CHAT_IDS")).split(",")
            if c.strip()
        ]
    )
    # "webhook" | "polling" | "auto". auto => webhook when PUBLIC_URL is https, else polling.
    telegram_mode: str = field(default_factory=lambda: _env("TELEGRAM_MODE", "auto").lower())
    telegram_api_base: str = field(default_factory=lambda: _env("TELEGRAM_API_BASE", "https://api.telegram.org"))

    # ---- Telegram ↔ web account linking -----------------------------------
    # Shared HMAC key held by BOTH the web app and this gateway. The web mints a
    # one-time deep-link token for the desk pass it is already holding; the bot
    # verifies it here. Never prefixed NEXT_PUBLIC_: a browser-readable key would
    # let anyone mint a link for any identity.
    #
    # Empty is fail-closed and the /start handler says so on screen. Linking is a
    # feature that is absent when unconfigured, never one that silently accepts
    # unauthenticated tokens.
    telegram_link_secret: str = field(default_factory=lambda: _env("TELEGRAM_LINK_SECRET"))
    # A deep link is clicked within seconds of being minted; the window only has
    # to survive the tap and the Telegram app cold-starting. Fifteen minutes is
    # generous for that and short enough that a token leaked into a screenshot or
    # a shared browser history is worthless by the time anyone reads it.
    telegram_link_token_ttl_s: float = field(
        default_factory=lambda: _env_float("TELEGRAM_LINK_TOKEN_TTL_S", 900.0)
    )
    # How long a GUEST binding keeps read parity. A guest desk pass is a browser
    # session cookie, and the gateway cannot observe that cookie dying — so the
    # binding carries its own expiry rather than pretending to track one it
    # cannot see. Account bindings have a durable Supabase row and no timer.
    telegram_guest_link_ttl_s: float = field(
        default_factory=lambda: _env_float("TELEGRAM_GUEST_LINK_TTL_S", 43_200.0)
    )

    # ---- Web UI auth -------------------------------------------------------
    # The gateway console and external web clients use a server-side bearer
    # token. Telegram is an independent notification client and is not an auth
    # provider for either web interface.
    #
    # Account linking (TELEGRAM_LINK_SECRET above) does not weaken that. It runs
    # in the opposite direction: a *web* desk pass authorises a *Telegram* read,
    # never the reverse. No Telegram identity, bound or otherwise, is ever
    # accepted as a credential by a web request, and no binding touches
    # TELEGRAM_CONTROL_USER_IDS.
    web_api_token: str = field(default_factory=lambda: _env("WEB_API_TOKEN", "alphaengine-dev-token"))
    require_auth: bool = field(default_factory=lambda: _env_bool("REQUIRE_AUTH", False))

    # ------------------------------------------------------------------ #
    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token)

    @property
    def resolved_web_workspace_url(self) -> str:
        """The web workspace's origin: explicit, else the paper-equity façade's origin, else empty."""
        if self.web_workspace_url:
            return self.web_workspace_url
        if self.paper_equity_quote_url:
            from urllib.parse import urlsplit

            parts = urlsplit(self.paper_equity_quote_url)
            if parts.scheme and parts.netloc:
                return f"{parts.scheme}://{parts.netloc}"
        return ""

    @property
    def resolved_telegram_mode(self) -> str:
        if not self.telegram_enabled:
            return "disabled"
        if self.telegram_mode in {"webhook", "polling"}:
            return self.telegram_mode
        return "webhook" if self.public_url.startswith("https://") else "polling"

    @property
    def telegram_link_enabled(self) -> bool:
        """Whether desk-pass → Telegram linking may run at all.

        The 32-character floor is the webhook secret's rule, for the same
        reason: this key is the only thing standing between a stranger and a
        token that claims to be someone else's desk pass, and a short one is
        guessable offline because the verifier is a pure function.
        """
        return len(self.telegram_link_secret) >= 32

    @property
    def webhook_path(self) -> str:
        return "/telegram/webhook"

    @property
    def gateway_ui_url(self) -> str:
        base = self.public_url or f"http://{self.host}:{self.port}"
        return f"{base}/app"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.data_ops_db_path.parent.mkdir(parents=True, exist_ok=True)

    def risk_limits_dict(self) -> dict[str, float]:
        """Flat view of every hard limit — surfaced by /risk/limits and /limits."""
        return {
            "max_order_notional_usd": self.max_order_notional_usd,
            "max_gross_exposure_usd": self.max_gross_exposure_usd,
            "max_symbol_notional_usd": self.max_symbol_notional_usd,
            "max_orders_per_sec": self.max_orders_per_sec,
            "rate_limit_burst": float(self.rate_limit_burst),
            "max_daily_drawdown_pct": self.max_daily_drawdown_pct,
            "alert_drawdown_pct": self.alert_drawdown_pct,
            "alert_var95_pct": self.alert_var95_pct,
            "alert_gross_exposure_pct": self.alert_gross_exposure_pct,
            "alert_concentration_pct": self.alert_concentration_pct,
            "max_price_deviation_bps": self.max_price_deviation_bps,
            "max_est_slippage_bps": self.max_est_slippage_bps,
            "starting_equity_usd": self.starting_equity_usd,
        }


settings = Settings()
settings.ensure_dirs()

__all__ = ["settings", "Settings", "BASE_DIR"]
