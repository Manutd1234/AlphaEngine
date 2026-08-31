"""Pytest bootstrap: put the project root on sys.path and isolate the audit DB."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Point every test at a throwaway DuckDB file and keep the tests offline.
#
# These are set before ``config`` is imported precisely so they win over a local
# ``.env``: python-dotenv does not override variables that already exist. A
# developer's deployment file must not decide whether the suite passes — the
# tests that care about authentication turn it on themselves via monkeypatch.
_TMP = Path(tempfile.mkdtemp(prefix="alphaengine-test-"))
os.environ["DATA_DIR"] = str(_TMP)
os.environ["DB_PATH"] = str(_TMP / "test.duckdb")
# Keep ordinary singletons local; PostgREST tests construct their store explicitly.
os.environ["DATA_OPS_BACKEND"] = "sqlite"
os.environ["ENABLE_MARKET_DATA"] = "0"
os.environ["TELEGRAM_BOT_TOKEN"] = ""
os.environ["REQUIRE_AUTH"] = "0"
# The research plane's three optional extras, blanked for the same reason as the
# bot token. `POST /api/research/rag/ask` now calls `research_generate` on every
# graded answer, so a developer whose `.env` holds a real GEMINI_API_KEY — and
# who has `requirements-genai.txt` installed — would have `test_research_answer`
# spending live model calls on every run. The suite must be free and offline on
# any machine, not only on the one where the key happens to be missing.
#
# ASSIGNED, NOT `setdefault`, and the difference is the whole claim above.
# `setdefault` only wins over a `.env`; an EXPORTED variable is already in
# `os.environ`, so it survives untouched and reaches `settings.gemini_api_key`.
# `tests/test_research_answer.py` drives the real `/api/research/rag/ask` route
# and patches neither `research_generate.settings` nor `_sdk` — it relies on
# this line alone — so `setdefault` here left a shell that exports the key
# spending a live call per test while the file said it could not happen.
# Measured: with the key exported, `settings.gemini_api_key` came through whole.
#
# Nothing legitimate is lost. No test in this suite calls either extra for real:
# the generation seam installs a fake provider at `research_generate._sdk` and
# the re-rank seam a fake encoder at `research_rerank._import_cross_encoder`,
# both of which are patched onto the module and ignore the environment. That is
# the difference from SUPABASE_URL below, which keeps `setdefault` because
# `tests/test_data_ops_postgrest.py` is a documented opt-in.
#
# RERANK_MODEL_PATH goes the same way for the second half of the house rule: a
# seeded fastembed cache would have the route tests LOAD ~110M parameters off
# disk, which is "no model downloaded" broken by a directory nobody mentioned.
#
# RESEARCH_IMAGE_MODEL_PATH is the THIRD of exactly this kind, and it was owed:
# `modules/research_image.py` recorded the hole above its own constant and
# `docs/testing/TESTING.md` recorded it in prose; neither closed it. The CLIP
# ViT-B/32 pair behind the image arm is ~0.6 GB, six times the re-ranker, so if
# the ~110M-parameter argument holds for RERANK_MODEL_PATH it holds harder here.
# It is a refusal and not a consent, which is what puts it in this group:
# `setdefault` beats only a `.env`, while the shape that actually loads 0.6 GB
# is an EXPORTED path — the developer who ran `bench_image_retrieval.py --seed`
# and kept it in their shell. Blanking it outright takes no opt-in away, which
# is the other half of earning the assignment: `test_research_rerank_real.py`
# opts in through its own separate RERANK_TEST_MODEL_PATH, deliberately left
# alone here, and the bench is a tool rather than a test —
# `tools/bench_image_retrieval_models.py` assigns the variable itself before
# importing the module.
#
# Blanked HERE rather than only in the image suites, which is where it was. Each
# of the arm's four files patches `research_image.IMAGE_MODEL_PATH` in an
# autouse fixture, so those four were safe and nothing else was, while any suite
# driving `/api/research/rag/search` reaches `research_image_arm`. The constant
# is read off `os.environ` in a module-level assignment at IMPORT, so before the
# first test module imports the package is the last moment the value is
# settable: a per-file fixture is structurally too late for every file but its
# own — the difference between protecting one suite and making the property true
# of the run.
os.environ["GEMINI_API_KEY"] = ""
os.environ["RERANK_MODEL_PATH"] = ""
os.environ["RESEARCH_IMAGE_MODEL_PATH"] = ""
# A fourth: harvest pages per series, so a two-series `.env` doubles a count.
os.environ["COHERENCE_SERIES"] = ""
# The two research BACKENDS, blanked for the same reason and in the same place.
#
# `tests/test_research_contract.py` calls `research_reconcile.run_reconcile`,
# which builds its corpus client from `settings` — so on a machine whose `.env`
# names a live Supabase the sweep REACHES IT, reports `reachable: True`, and the
# test that exists to prove "could not sweep" is distinguishable from "nothing to
# sweep" fails while the suite quietly makes a network call. The same `.env`
# hands `research_graph_projection._driver` real Aura credentials.
#
# Blanked here rather than patched inside that one test: the rejected
# alternative fixes the assertion and leaves every other suite reading a
# developer's live corpus, which is the condition, not the symptom. `setdefault`
# keeps the deliberate opt-in intact — `tests/test_data_ops_postgrest.py` still
# exercises the Postgres backend when the variables are EXPORTED for the run,
# which is a choice somebody made, rather than one a deployment file made for
# them.
os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")
os.environ.setdefault("NEO4J_URI", "")
os.environ.setdefault("NEO4J_PASSWORD", "")


def stub_feed(name: str, book):
    """A real ``VenueFeed`` pre-loaded with a fixed book and no WebSocket.

    Using the production class (rather than a duck-typed stand-in) means the
    tests exercise the same ``status()`` / staleness logic the gateway does.
    """
    from modules.tca_engine import VenueFeed

    feed = VenueFeed([book.symbol])
    feed.name = name
    feed.books = {book.symbol: book}
    feed.connected = True
    return feed


def deep_book(symbol: str = "BTCUSDT", venue: str = "TEST", mid: float = 100.0, size: float = 5000.0):
    """50 levels either side of ``mid``, 1c apart — deep enough that sizing maths
    is exact and slippage is small but non-zero."""
    from modules.tca_engine import BookState

    book = BookState(venue, symbol)
    book.apply_snapshot(
        bids=[(round(mid - i * 0.01, 4), size) for i in range(50)],
        asks=[(round(mid + i * 0.01, 4), size) for i in range(50)],
    )
    return book


# ---------------------------------------------------------------------------
# Telegram fixtures.
#
# These lived in `test_telegram.py`, which meant a second Telegram test file
# could not use them — pytest only shares fixtures through conftest. They are
# defined here so the registry floor in `test_telegram_commands.py` and the
# suites in `test_telegram.py` exercise exactly the same bot.
# ---------------------------------------------------------------------------

import pytest  # noqa: E402


@pytest.fixture
def bot(tmp_path):
    """A bot wired to real engines on a throwaway DuckDB, sending nowhere.

    Real `TCAEngine`/`RiskGateway`/`AuditLog`/`JobQueue` on purpose: a stubbed
    engine would let a handler pass a test and fail against the thing it
    actually calls.
    """
    from test_telegram import StubBot

    from modules.audit import AuditLog
    from modules.jobs import JobQueue
    from modules.risk_proxy import RiskGateway, TokenBucket
    from modules.tca_engine import TCAEngine

    tca = TCAEngine(symbols=["BTCUSDT"], venues=[])
    tca.feeds = {"TEST": stub_feed("TEST", deep_book())}
    audit = AuditLog(tmp_path / "telegram.duckdb")
    gateway = RiskGateway(tca_engine=tca, audit=audit)
    gateway.bucket = TokenBucket(1e6, 1_000_000)
    return StubBot(gateway=gateway, tca=tca, queue=JobQueue(workers=1), audit=audit)


@pytest.fixture
def fake_market_data(monkeypatch):
    """Deterministic OpenBB responses.

    The registry floor dispatches every command, including the market ones. A
    real provider call would make the suite depend on a vendor being up and on
    a key being present, so the floor would report a network outage as a bot
    defect.
    """
    from modules import research

    async def status():
        return {"ok": True, "provider": "yfinance", "detail": None}

    async def quote(symbol, asset="equity"):
        return {"ok": True, "data": {
            "symbol": symbol, "price": 101.0, "change": 1.0, "change_percent": 1.0,
            "open": 100.0, "high": 102.0, "low": 99.0, "volume": 1234,
            "currency": "USD", "delayed": True,
        }}

    async def bars(symbol, asset, interval, limit):
        rows = [
            {"date": f"2026-08-{day:02d}", "open": 99 + day, "high": 101 + day,
             "low": 98 + day, "close": 100 + day, "volume": 1000 * day}
            for day in range(1, max(limit, 30) + 1)
        ]
        return {"ok": True, "data": rows[-limit:]}

    async def news(symbols, limit):
        return {"ok": True, "data": [
            {"title": f"{symbols[0]} update {index}", "source": "Wire", "date": "2026-08-04"}
            for index in range(limit)
        ]}

    async def fundamentals(symbol):
        return {"ok": True, "data": {
            "symbol": symbol, "name": "Example Corp", "exchange": "NMS",
            "sector": "Technology", "industry": "Software", "market_cap": 1_000_000,
            "pe_ratio": 20.0, "eps": 5.0, "beta": 1.1, "description": "A test company.",
        }}

    monkeypatch.setattr(research, "openbb_status_async", status)
    monkeypatch.setattr(research, "quote", quote)
    monkeypatch.setattr(research, "bars", bars)
    monkeypatch.setattr(research, "news", news)
    monkeypatch.setattr(research, "fundamentals", fundamentals)


TELEGRAM_TEST_CHAT = "12345"
TELEGRAM_TEST_USER = "7"


@pytest.fixture(autouse=True)
def telegram_lists():
    """Authorise the test user for the duration of each test.

    Autouse and global: the allowlists are module-level settings, so a test
    that forgot to set them would exercise the refusal path while looking like
    it exercised the command. Restored afterwards so the ordering of tests
    cannot matter.
    """
    from config import settings

    saved = (
        list(settings.telegram_allowed_user_ids),
        list(settings.telegram_allowed_chat_ids),
        list(settings.telegram_alert_chat_ids),
    )
    settings.telegram_allowed_user_ids[:] = [TELEGRAM_TEST_USER]
    settings.telegram_allowed_chat_ids[:] = []
    settings.telegram_alert_chat_ids[:] = []
    yield
    settings.telegram_allowed_user_ids[:] = saved[0]
    settings.telegram_allowed_chat_ids[:] = saved[1]
    settings.telegram_alert_chat_ids[:] = saved[2]


# A 1×1 PNG, base64'd — a real image the fold-detail commands can decode without
# depending on the backtester having run.
_ONE_BY_ONE_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@pytest.fixture
def completed_backtest(bot):
    """Inject a succeeded backtest JobRecord into the bot's queue.

    Gives the fold-detail commands (/walkforward, /stability, /overfit,
    /decision) a realistic in-process result to read — three walk-forward folds,
    six top params, the full DSR family and a decoded equity/heatmap image —
    without running the backtester. Returns the result dict for assertions.
    """
    from datetime import datetime, timezone

    from modules.jobs import JobRecord

    result = {
        "request": {"symbol": "BTCUSDT", "interval": "1h", "strategy": "ma_cross", "bars": 1500},
        "combos_tested": 64,
        "bars": 1500,
        "best": {"fast": 10, "slow": 40, "sharpe": 1.42, "total_return": 0.31, "max_drawdown": -0.12},
        "top_results": [
            {"fast": 10 + index, "slow": 40 + index * 2, "sharpe": 1.4 - index * 0.1}
            for index in range(6)
        ],
        "deflated_sharpe_ratio": 0.96,
        "probabilistic_sharpe_ratio": 0.91,
        "min_track_record_bars": 620.0,
        "dsr_verdict": "PASS",
        "overfitting_probability": 0.22,
        "walk_forward": [
            {
                "fold": fold,
                "chosen_fast": 10.0,
                "chosen_slow": 40.0,
                "is_sharpe": 1.5 - fold * 0.1,
                "oos_sharpe": 1.1 - fold * 0.2,
                "oos_return": 0.08 - fold * 0.01,
                "oos_rank": fold + 1,
                "combos_ranked": 64,
            }
            for fold in range(3)
        ],
        "walk_forward_oos_sharpe": 0.74,
        "equity_curve_png": _ONE_BY_ONE_PNG,
        "heatmap_png": _ONE_BY_ONE_PNG,
    }
    now = datetime.now(timezone.utc)
    record = JobRecord(
        job_id="bt-fixture-1",
        kind="backtest",
        status="succeeded",
        progress=1.0,
        submitted_at=now,
        started_at=now,
        finished_at=now,
        result=result,
        backend="in-process",
        meta={"chat_id": TELEGRAM_TEST_CHAT, "symbol": "BTCUSDT", "actor": "tg:7:operator"},
    )
    bot.queue._jobs[record.job_id] = record
    return result


@pytest.fixture(autouse=True)
def _reset_data_ops_backend(tmp_path, monkeypatch):
    """Give every test a fresh local store and close it deterministically.

    The process-wide singleton must be cleared before its path is redirected.

    Three decisions here, each the answer to a real failure:

    SETUP clears the cache, so the first lookup in this test builds against
    this test's path. REDIRECT points `data_ops_db_path` at `tmp_path`, so no
    two tests ever open the same SQLite file: the suite used to share one file
    under `DATA_DIR` for all 1,700 tests, and the CI flake — `database is
    locked` raised from `PRAGMA journal_mode=WAL` on a fresh connection while
    `test_api.py` rendered the console — was the previous test's leaked handle
    being closed by the garbage collector, checkpointing that shared file's WAL
    under an exclusive lock, while this test opened it. Separate files cannot
    contend. The `settings` object is frozen, so it is REPLACED rather than
    patched (the shape `test_data_jobs._point_at` already uses); only
    `open_data_ops_store` reads `config.settings` at call time, which is the
    one reader that needs to see it.

    TEARDOWN closes, through `reset_data_ops_store`, rather than clearing. The
    earlier version of this fixture said "cleared rather than CLOSED" and was
    right at the time: closing took the handle out from under module-scoped
    fixtures, and `test_web_state.py` failed in the full run while passing
    alone. A closed file-backed `SqliteStore` now reopens on its next use, so
    a holder that outlives this test — the scheduler singleton's run store, a
    module-scoped `TestClient` — carries on against the file it was built on,
    which still exists under `tmp_path`. Closing deterministically is what
    takes the garbage collector, and its timing, out of the picture.
    """
    from dataclasses import replace

    import config
    from modules.data_ops_backend import clear_data_ops_cache, reset_data_ops_store

    clear_data_ops_cache()
    monkeypatch.setattr(
        config, "settings",
        replace(config.settings, data_ops_backend="sqlite", data_ops_db_path=tmp_path / "data_ops.sqlite"),
    )
    yield
    reset_data_ops_store()


@pytest.fixture(autouse=True)
def _fresh_injected_books():
    """Stamp every book on the process-wide TCA engine as just-updated before
    each test — what the next tick of a live feed would do.

    `test_api.py` injects one deep book into `get_engine()` for the whole
    module and never touches it again, and `BookState.stale` is wall-clock:
    `age_s > settings.venue_stale_after_s`, ten seconds by default. So every
    order test there silently depended on the tests before it finishing
    inside ten seconds of the fixture — true for years at ~3s a module, and
    false the day `requirements-dev.txt` started installing vectorbt:
    `TestJobs::test_backtest_job_lifecycle` then pays numba's cold JIT compile
    on the CI runner, the module crosses the window, and every
    `TestOrderLifecycle` order after it is REJECTED for a stale venue. CI read
    six failures on a tree that passed locally and in a warm venv — the
    signature of a clock inside a fixture. Reproduced by shrinking the window
    (`VENUE_STALE_AFTER_S=0.5`): the same six fail without this and pass with it.

    Here rather than in `test_api.py` because that file is over the length
    ceiling `test_file_size.py` ratchets, and may not grow. Reads the
    singleton's cache directly so a suite that never built the engine does
    not build one here; touches only books that have a timestamp, so "never
    updated" keeps its infinite age. The staleness rule itself is untouched —
    it is the gate's, and `test_tca_patch_points.py` pins it — and a test that
    wants a stale book sets `last_update_wall` itself, as `test_tca_engine.py`
    does, after this has run.
    """
    import time

    from modules.tca_engine import engine as tca_engine_module

    engine = tca_engine_module._engine
    if engine is None:
        return
    for feed in engine.feeds.values():
        for book in feed.books.values():
            if book.last_update_wall:
                book.last_update_wall = time.time()
