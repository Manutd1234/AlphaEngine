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
except Exception:  # pragma: no cover
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
    # Public base URL of this service (needed for Telegram webhook + Mini App button).
    public_url: str = field(default_factory=lambda: _env("PUBLIC_URL", "").rstrip("/"))

    # ---- Data / persistence ------------------------------------------------
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(BASE_DIR / "data"))))
    db_path: Path = field(
        default_factory=lambda: Path(
            _env("DB_PATH", str(Path(_env("DATA_DIR", str(BASE_DIR / "data"))) / "alphaengine.duckdb"))
        )
    )

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
    # Limit price may not deviate from mid by more than this many bps (fat-finger price guard).
    max_price_deviation_bps: float = field(default_factory=lambda: _env_float("MAX_PRICE_DEVIATION_BPS", 500.0))
    # Reject an order whose *estimated* slippage exceeds this (liquidity guard).
    max_est_slippage_bps: float = field(default_factory=lambda: _env_float("MAX_EST_SLIPPAGE_BPS", 75.0))
    # Notional starting equity for the paper book.
    starting_equity_usd: float = field(default_factory=lambda: _env_float("STARTING_EQUITY_USD", 1_000_000.0))
    # Taker fee applied to paper fills, in bps.
    paper_fee_bps: float = field(default_factory=lambda: _env_float("PAPER_FEE_BPS", 4.0))

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
    telegram_webhook_secret: str = field(default_factory=lambda: _env("TELEGRAM_WEBHOOK_SECRET", "alphaengine-dev-secret"))
    # Chat IDs authorised to issue commands. Empty => open (dev only, logged loudly).
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

    # ---- External research portal (Vercel) ---------------------------------
    # The Next.js strategy-research UI. Deployed separately because a serverless
    # runtime cannot hold the L2 WebSocket subscriptions or the risk state that
    # Modules A and B depend on — so the gateway keeps those and links out to it.
    research_portal_url: str = field(
        default_factory=lambda: _env("RESEARCH_PORTAL_URL", "").rstrip("/")
    )

    # ---- Web UI auth -------------------------------------------------------
    # Mini App requests are authenticated by validating Telegram initData HMAC.
    # In a plain browser (no Telegram) we fall back to this bearer token.
    web_api_token: str = field(default_factory=lambda: _env("WEB_API_TOKEN", "alphaengine-dev-token"))
    require_auth: bool = field(default_factory=lambda: _env_bool("REQUIRE_AUTH", False))

    # ------------------------------------------------------------------ #
    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token)

    @property
    def resolved_telegram_mode(self) -> str:
        if not self.telegram_enabled:
            return "disabled"
        if self.telegram_mode in {"webhook", "polling"}:
            return self.telegram_mode
        return "webhook" if self.public_url.startswith("https://") else "polling"

    @property
    def webhook_path(self) -> str:
        return "/telegram/webhook"

    @property
    def miniapp_url(self) -> str:
        base = self.public_url or f"http://{self.host}:{self.port}"
        return f"{base}/app"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def risk_limits_dict(self) -> dict[str, float]:
        """Flat view of every hard limit — surfaced by /risk/limits and /limits."""
        return {
            "max_order_notional_usd": self.max_order_notional_usd,
            "max_gross_exposure_usd": self.max_gross_exposure_usd,
            "max_symbol_notional_usd": self.max_symbol_notional_usd,
            "max_orders_per_sec": self.max_orders_per_sec,
            "rate_limit_burst": float(self.rate_limit_burst),
            "max_daily_drawdown_pct": self.max_daily_drawdown_pct,
            "max_price_deviation_bps": self.max_price_deviation_bps,
            "max_est_slippage_bps": self.max_est_slippage_bps,
            "starting_equity_usd": self.starting_equity_usd,
        }


settings = Settings()
settings.ensure_dirs()

__all__ = ["settings", "Settings", "BASE_DIR"]
