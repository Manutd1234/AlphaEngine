"""Every knob the coherence engine reads, resolved once at import.

These are module-level ``os.environ`` reads rather than fields on
``config.py``'s ``Settings``, following ``modules/research_quota.py``. That
file records the reason and it applies here unchanged: ``config.py`` is one
flat dataclass at its documented length ceiling, and a subsystem that adds ten
fields to it makes the file un-splittable for everyone else.

Read at import, never per call. A bound that can change midway through a
polling window makes a refusal impossible to explain afterwards — "why did it
stop at 40 requests?" has no answer if the limit moved while it ran.
"""

from __future__ import annotations

import os
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Final, Literal
from urllib.parse import urlsplit, urlunsplit

from env_coerce import BASE_DIR

API_ROOT_PATH: Final = "/trade-api/v2"
_SERIES_TICKER: Final = re.compile(r"KX[A-Z0-9][A-Z0-9._-]{0,125}\Z")


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env_decimal(name: str, default: str) -> Decimal:
    raw = _env(name, default)
    try:
        return Decimal(raw)
    except InvalidOperation:
        return Decimal(default)


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _env_optional_decimal(name: str) -> Decimal | None:
    """A knob with no default, because the honest default is 'we do not know'.

    Used for the carry rate. Kalshi pays interest on cash and open positions,
    but the API does not publish the rate — it lives in a help-centre article
    and it is variable. Hard-coding a number would put an unsourced figure into
    a P&L estimate, so an unset variable means carry is left out of the sum and
    the surface says it was left out.
    """
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def normalize_base_url(value: str, *, name: str = "Kalshi base URL") -> str:
    """Validate and canonicalise one Kalshi API root without exposing it.

    The client appends route paths and signs the resulting request path. An
    origin-only URL, a second path prefix, or credentials embedded in the URL
    would therefore either address a different endpoint or make provenance and
    signing disagree. Keep the one accepted shape explicit.
    """
    raw = value.strip()
    if not raw or any(char.isspace() for char in raw):
        raise ValueError(f"{name} must be an absolute HTTP(S) URL")
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{name} is not a valid URL") from exc
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{name} must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(f"{name} must not contain user information")
    if parsed.query or parsed.fragment or "?" in raw or "#" in raw:
        raise ValueError(f"{name} must not contain a query string or fragment")
    if parsed.path not in {API_ROOT_PATH, f"{API_ROOT_PATH}/"}:
        raise ValueError(f"{name} path must be exactly {API_ROOT_PATH}")

    hostname = parsed.hostname.lower()
    if ":" in hostname:
        hostname = f"[{hostname}]"
    netloc = f"{hostname}:{port}" if port is not None else hostname
    return urlunsplit((scheme, netloc, API_ROOT_PATH, "", ""))


def parse_series_watchlist(value: str) -> tuple[str, ...]:
    """Upper-case, validate and de-duplicate configured series tickers."""
    tickers: list[str] = []
    seen: set[str] = set()
    for item in value.split(","):
        ticker = item.strip().upper()
        if not ticker:
            continue
        if _SERIES_TICKER.fullmatch(ticker) is None:
            raise ValueError(
                "COHERENCE_SERIES contains an invalid ticker; expected a KX-prefixed "
                "series name using only letters, digits, dots, underscores, or hyphens"
            )
        if ticker not in seen:
            seen.add(ticker)
            tickers.append(ticker)
    return tuple(tickers)


def resolve_private_key_path(value: str, *, base_dir: Path = BASE_DIR) -> str:
    """Return one stable filesystem path for the configured demo key.

    ``uvicorn``, the recorder tools, and the container do not necessarily start
    in the same working directory.  Resolving a relative credential path from
    ``cwd`` therefore makes a valid configuration appear and disappear based
    on the launch command.  Relative paths are gateway-root relative; ``~`` and
    environment-variable prefixes remain available for local operator paths.
    """
    raw = value.strip()
    if not raw:
        return ""
    path = Path(os.path.expandvars(raw)).expanduser()
    if not path.is_absolute():
        path = base_dir / path
    return str(path.resolve(strict=False))


# ── Hosts ────────────────────────────────────────────────────────────────────
# Production for reads: the prices have to be real ones. `api.elections` is the
# documented shared host, kept as a failover rather than a default — Kalshi
# calls it "also supported", not deprecated.
PUBLIC_BASE_URL: Final = normalize_base_url(
    _env("KALSHI_PUBLIC_BASE_URL", "https://external-api.kalshi.com/trade-api/v2"),
    name="KALSHI_PUBLIC_BASE_URL",
)
PUBLIC_FAILOVER_URL: Final = normalize_base_url(
    _env("KALSHI_PUBLIC_FAILOVER_URL", "https://api.elections.kalshi.com/trade-api/v2"),
    name="KALSHI_PUBLIC_FAILOVER_URL",
)
# Demo fallback for private-channel reads. A demo key cannot sign a production
# request, so these two hosts are not interchangeable and the client keeps them
# apart.
DEMO_BASE_URL: Final = normalize_base_url(
    _env("KALSHI_DEMO_BASE_URL", "https://external-api.demo.kalshi.co/trade-api/v2"),
    name="KALSHI_DEMO_BASE_URL",
)
DEMO_FAILOVER_URL: Final = normalize_base_url(
    _env("KALSHI_DEMO_FAILOVER_URL", "https://demo-api.kalshi.co/trade-api/v2"),
    name="KALSHI_DEMO_FAILOVER_URL",
)
if {PUBLIC_BASE_URL, PUBLIC_FAILOVER_URL} & {DEMO_BASE_URL, DEMO_FAILOVER_URL}:
    raise ValueError("Kalshi public and demo API hosts must not overlap")
DEMO_KEY_ID: Final = os.environ.get("KALSHI_DEMO_KEY_ID", "").strip()
DEMO_PRIVATE_KEY_PATH: Final = resolve_private_key_path(
    os.environ.get("KALSHI_DEMO_PRIVATE_KEY_PATH", "")
)
# Production account-only reads, including the RFQ panel and CF Benchmarks
# passthrough, share this read credential. It is deliberately separate from the
# demo RFQ credential above: silently sending a sandbox key to production earns
# a misleading 401. The key ID declares which account environment the operator
# intends to use; once declared, an incomplete or invalid pair fails closed
# instead of quietly falling back to demo. A path alone is not intent because
# the documented Compose override always supplies its in-container mount path,
# even when no production key has been staged there.
PRODUCTION_KEY_ID: Final = os.environ.get("KALSHI_PRODUCTION_KEY_ID", "").strip()
PRODUCTION_PRIVATE_KEY_PATH: Final = resolve_private_key_path(
    os.environ.get("KALSHI_PRODUCTION_PRIVATE_KEY_PATH", "")
)


def preferred_rfq_signing_environment() -> Literal["production", "demo"] | None:
    """Select by account key ID so placeholder mount paths are not credentials."""
    if PRODUCTION_KEY_ID:
        return "production"
    if DEMO_KEY_ID:
        return "demo"
    return None

# ── What to watch ────────────────────────────────────────────────────────────
# Series tickers, comma separated. Empty means the recorder has nothing to do
# and says so rather than inventing a universe.
SERIES_WATCHLIST: Final = parse_series_watchlist(_env("COHERENCE_SERIES", ""))
# Broad live discovery. Zero retains the explicit-series behaviour; 1..100
# asks Kalshi for that many open event families in venue order and obtains all
# of their books through the bulk route. The cap is deliberately below the
# events endpoint's own page size so one poll cannot become an exchange crawl.
LIVE_FAMILY_LIMIT: Final = max(0, min(100, _env_int("COHERENCE_LIVE_FAMILIES", 0)))
POLL_SECONDS: Final = _env_int("COHERENCE_POLL_S", 0)  # 0 keeps the recorder off

# A collection campaign counts successful, observation-bearing passes over the
# complete watchlist. It never calls a pass an episode: episodes remain the
# much rarer, fee-positive violations tracked by ``episodes.py``. The ID makes
# progress survive a process/container restart without accidentally continuing
# a previous campaign that happened to have the same numerical target.
CAMPAIGN_ID: Final = _env("COHERENCE_CAMPAIGN_ID", "")
CAMPAIGN_TARGET: Final = max(0, _env_int("COHERENCE_CAMPAIGN_TARGET", 0))
if CAMPAIGN_TARGET > 0 and not CAMPAIGN_ID:
    raise ValueError("COHERENCE_CAMPAIGN_ID is required when COHERENCE_CAMPAIGN_TARGET is positive")
# The accelerated cadence is bounded by the campaign. Once it completes, keep
# collecting forward at the original five-minute baseline instead of turning a
# ~1.15 GB/day experiment into an unbounded operating mode.
POST_CAMPAIGN_POLL_SECONDS: Final = max(1, _env_int("COHERENCE_POST_CAMPAIGN_POLL_S", 300))

# How often the recorder scores the SETTLED corpus, which is a different
# question on a different clock. Nothing settles in five minutes, so scoring on
# every book poll would write three hundred near-identical rows a day and call
# it a series; the Scorecard's trend wants a point every few hours. Off by
# default for the reason POLL_SECONDS is: a process that starts doing work the
# moment it boots is not something to enable by accident. It costs no exchange
# read whatever it is set to — the score is taken over settlements already on
# the tape, never over a fresh harvest.
CALIBRATION_EVERY_SECONDS: Final = _env_int("COHERENCE_CALIBRATION_EVERY_S", 0)

# How many open events per series one poll reads. Bounds the tape, and the tape
# is what needs bounding: measured on the live exchange, KXBTCD alone carries
# three open events totalling 318 markets, and recording all of them every
# twenty-six seconds writes about 1.2 GB a day. A deployed gateway on a modest
# volume fills up in six weeks and the failure looks like a disk problem rather
# than like a configuration choice nobody made deliberately.
MAX_EVENTS_PER_SERIES: Final = _env_int("COHERENCE_MAX_EVENTS", 2)
# On-demand Shell reads need the complete namespace; unlike the recorder they do not persist every book.
SHELL_MAX_EVENTS_PER_SERIES: Final = _env_int("COHERENCE_SHELL_MAX_EVENTS", 50)

# ── Budget ───────────────────────────────────────────────────────────────────
# Kalshi documents token buckets per ACCOUNT and says nothing about keyless
# traffic. Basic is 200 read tokens/second; a default request costs 10. This
# takes a quarter of the smallest published tier — about five requests a second
# — because guessing high on someone else's infrastructure is not our risk to
# take.
READ_TOKENS_PER_S: Final = _env_int("COHERENCE_READ_TOKENS_PER_S", 50)
READ_BURST_TOKENS: Final = _env_int("COHERENCE_READ_BURST_TOKENS", 100)
DEFAULT_TOKEN_COST: Final = _env_int("COHERENCE_DEFAULT_TOKEN_COST", 10)
REQUEST_TIMEOUT_S: Final = _env_decimal("COHERENCE_REQUEST_TIMEOUT_S", "20")

# How long a fee document stays believable without re-reading it.
#
# `schedule_for_event` used to make three venue calls in series on EVERY
# certify — about 2.0 of its 4.4 seconds. All three read documents that change
# on a schedule measured in days: a series' fee multiplier, the exchange's
# published fee-change list, and a per-event override. An hour is short against
# how fast they move and long against how often the desk asks.
#
# A TTL rather than forever, unlike `series_meta`'s category cache: a category
# is a fact about what a series IS, and a fee is a fact about what it COSTS
# today. `fees_source.schedule_for` compares each scheduled timestamp against
# the clock, so caching the LIST is safe while caching the verdict would not be
# — a change published inside the window is applied late, by up to this long.
FEE_META_TTL_S: Final = _env_int("COHERENCE_FEE_META_TTL_S", 3600)

# ── The warm snapshot ────────────────────────────────────────────────────────
# How often to precompute the reads the desk asks for, so a request never waits
# on the venue. Zero keeps it off, and off is the default for the reason
# POLL_SECONDS is: a fresh clone with no keys and no watchlist must not start
# reaching for an exchange on boot.
#
# The trade this buys, stated plainly because the desk has to show it: reads
# answer in milliseconds and the data is as fresh as this cadence, never fresher.
# The age pill reads the snapshot's own `observed_at`, so what a reader sees is
# the age of the BOOK rather than the age of the request.
WARM_SECONDS: Final = _env_int("COHERENCE_WARM_S", 0)

# When a precomputed answer stops being worth serving. Zero means three times
# the cadence — long enough that one missed pass does not send every read back
# to the venue, short enough that a refresher which died an hour ago stops
# answering. A derived default rather than a magic number.
WARM_MAX_AGE_S: Final = _env_int("COHERENCE_WARM_MAX_AGE_S", 0)

# ── Fees ─────────────────────────────────────────────────────────────────────
# The published general taker rate and the maker ratio. Both are starting
# hypotheses: the per-series `fee_multiplier` scales them, per-event overrides
# replace them, and the engine derives the effective rate from its own fills
# once there are any.
TAKER_RATE: Final = _env_decimal("COHERENCE_TAKER_RATE", "0.07")
MAKER_RATIO: Final = _env_decimal("COHERENCE_MAKER_RATIO", "0.25")
COMBO_MAKER_RATIO: Final = _env_decimal("COHERENCE_COMBO_MAKER_RATIO", "0.5")
# $0.01 for an ordinary account, $0.0001 for a direct member. This single knob
# is worth a hundredfold on the rounding fee, which is the component nobody
# models.
BALANCE_PRECISION: Final = _env_decimal("COHERENCE_BALANCE_PRECISION", "0.01")
CARRY_APY: Final = _env_optional_decimal("COHERENCE_CARRY_APY")

# ── Storage ──────────────────────────────────────────────────────────────────
# Its own DuckDB file, beside the audit ledger rather than inside it: the tape
# is high-volume evidence with different write semantics, and sharing the
# ledger's single-writer lock would make a recorder stall look like an audit
# failure.
DB_PATH: Final = Path(_env("COHERENCE_DB_PATH", str(Path(_env("DATA_DIR", str(BASE_DIR / "data"))) / "coherence.duckdb")))

# The raw order-book tape is the high-volume part of the corpus. Refuse a poll
# before it consumes the host's safety reserve; an explicit tape cap is
# available when the volume size is known. Retention is opt-in because deleting
# evidence by default would contradict the recorder's purpose. When enabled it
# removes only expired raw ladders; index readings, certification decisions,
# campaign progress and episodes remain permanent.
MIN_FREE_BYTES: Final = max(0, _env_int("COHERENCE_MIN_FREE_BYTES", 0))
MAX_TAPE_BYTES: Final = max(0, _env_int("COHERENCE_MAX_TAPE_BYTES", 0))
RETENTION_DAYS: Final = max(0, _env_int("COHERENCE_RETENTION_DAYS", 0))
RETENTION_CHECK_SECONDS: Final = max(60, _env_int("COHERENCE_RETENTION_CHECK_S", 3600))

# ── Safety ───────────────────────────────────────────────────────────────────
# The engine sizes orders and renders an order plan. It does not send one.
# Turning this off is not sufficient to trade — there is no send path in this
# version — but the flag is read and reported so the surface can state it.
DRY_RUN: Final = _env("COHERENCE_DRY_RUN", "1") not in {"0", "false", "no", "off"}


def watchlist_configured() -> bool:
    """True when someone has told the recorder what to watch."""
    return bool(SERIES_WATCHLIST or LIVE_FAMILY_LIMIT > 0)


def signing_configured() -> bool:
    """True when the demo private-channel key pair is present."""
    return bool(DEMO_KEY_ID and DEMO_PRIVATE_KEY_PATH)


def production_signing_configured() -> bool:
    """True only when both halves of the production read credential exist."""
    return bool(PRODUCTION_KEY_ID and PRODUCTION_PRIVATE_KEY_PATH)
