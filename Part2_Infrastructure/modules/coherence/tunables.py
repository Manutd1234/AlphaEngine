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
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Final

from env_coerce import BASE_DIR


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


# ── Hosts ────────────────────────────────────────────────────────────────────
# Production for reads: the prices have to be real ones. `api.elections` is the
# documented shared host, kept as a failover rather than a default — Kalshi
# calls it "also supported", not deprecated.
PUBLIC_BASE_URL: Final = _env("KALSHI_PUBLIC_BASE_URL", "https://external-api.kalshi.com/trade-api/v2")
PUBLIC_FAILOVER_URL: Final = _env("KALSHI_PUBLIC_FAILOVER_URL", "https://api.elections.kalshi.com/trade-api/v2")
# Demo for anything signed. A demo key cannot sign a production request, so
# these two hosts are not interchangeable and the client keeps them apart.
DEMO_BASE_URL: Final = _env("KALSHI_DEMO_BASE_URL", "https://external-api.demo.kalshi.co/trade-api/v2")
DEMO_KEY_ID: Final = os.environ.get("KALSHI_DEMO_KEY_ID", "").strip()
DEMO_PRIVATE_KEY_PATH: Final = os.environ.get("KALSHI_DEMO_PRIVATE_KEY_PATH", "").strip()

# ── What to watch ────────────────────────────────────────────────────────────
# Series tickers, comma separated. Empty means the recorder has nothing to do
# and says so rather than inventing a universe.
SERIES_WATCHLIST: Final = tuple(s.strip() for s in _env("COHERENCE_SERIES", "").split(",") if s.strip())
POLL_SECONDS: Final = _env_int("COHERENCE_POLL_S", 0)  # 0 keeps the recorder off

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

# ── Safety ───────────────────────────────────────────────────────────────────
# The engine sizes orders and renders an order plan. It does not send one.
# Turning this off is not sufficient to trade — there is no send path in this
# version — but the flag is read and reported so the surface can state it.
DRY_RUN: Final = _env("COHERENCE_DRY_RUN", "1") not in {"0", "false", "no", "off"}


def watchlist_configured() -> bool:
    """True when someone has told the recorder what to watch."""
    return bool(SERIES_WATCHLIST)


def signing_configured() -> bool:
    """True when a demo key pair is present. Never true for production reads."""
    return bool(DEMO_KEY_ID and DEMO_PRIVATE_KEY_PATH)
