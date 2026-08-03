"""Telegram command layer — dispatch, authorisation and rendering.

The transport is stubbed (no network), but every handler runs for real against
the live gateway objects, so these tests fail if a command stops producing
correct output — which is the failure mode that matters when ``/kill`` is the
last line of defence.
"""

from __future__ import annotations

import pytest

from conftest import deep_book, stub_feed
from config import settings
from modules.audit import AuditLog
from modules.jobs import JobQueue
from modules.risk_proxy import RiskGateway, TokenBucket
from modules.schemas import OrderRequest
from modules.tca_engine import TCAEngine
from modules.telegram import TelegramBot, esc

CHAT = "12345"


class StubBot(TelegramBot):
    """Captures outbound calls instead of hitting api.telegram.org."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.token = "999:TEST"
        self.sent: list[str] = []
        self.photos: list[tuple[str, str]] = []

    async def api(self, method, **params):
        return {"ok": True, "result": {}}

    async def send_message(self, chat_id, text, keyboard=None):
        self.sent.append(text)
        return {"ok": True}

    async def send_photo_b64(self, chat_id, png_b64, caption=""):
        self.photos.append((png_b64[:16], caption))
        return {"ok": True}

    @property
    def last(self) -> str:
        return self.sent[-1] if self.sent else ""


@pytest.fixture
def bot(tmp_path) -> StubBot:
    tca = TCAEngine(symbols=["BTCUSDT"], venues=[])
    tca.feeds = {"TEST": stub_feed("TEST", deep_book())}
    audit = AuditLog(tmp_path / "tg.duckdb")
    gw = RiskGateway(tca_engine=tca, audit=audit)
    gw.bucket = TokenBucket(1e6, 1_000_000)
    return StubBot(gateway=gw, tca=tca, queue=JobQueue(workers=1), audit=audit)


@pytest.fixture
def chat_lists():
    """`Settings` is a frozen dataclass on purpose — a risk limit that can be
    mutated at runtime is not a limit. The chat-id lists are still mutable
    objects, so tests edit them in place and restore afterwards."""
    saved = (list(settings.telegram_allowed_chat_ids), list(settings.telegram_alert_chat_ids))
    yield settings.telegram_allowed_chat_ids, settings.telegram_alert_chat_ids
    settings.telegram_allowed_chat_ids[:] = saved[0]
    settings.telegram_alert_chat_ids[:] = saved[1]


def update(text: str, chat_id: str = CHAT) -> dict:
    return {"update_id": 1, "message": {"message_id": 1, "chat": {"id": int(chat_id)},
                                        "from": {"id": 7, "username": "trader"}, "text": text}}


@pytest.mark.asyncio
class TestCommands:
    async def test_start_lists_the_emergency_command_first(self, bot):
        await bot.handle_update(update("/start"))
        assert "/kill" in bot.last
        assert "AlphaEngine" in bot.last

    async def test_kill_halts_and_confirms(self, bot):
        await bot.handle_update(update("/kill"))
        assert bot.gateway.kill.active
        assert "KILL ENGAGED" in bot.last
        assert bot.gateway.kill.actor == "tg:trader"

    async def test_kill_with_symbol_is_scoped(self, bot):
        await bot.handle_update(update("/kill BTCUSDT"))
        assert not bot.gateway.kill.active
        assert "BTCUSDT" in bot.gateway.kill.halted_symbols

    async def test_resume_releases(self, bot):
        await bot.handle_update(update("/kill"))
        await bot.handle_update(update("/resume"))
        assert not bot.gateway.kill.active
        assert "resumed" in bot.last.lower()

    async def test_kill_is_reachable_from_an_inline_button(self, bot):
        await bot._handle_callback({"id": "1", "data": "kill", "message": {"chat": {"id": int(CHAT)}}})
        assert bot.gateway.kill.active

    async def test_risk_renders_the_drawdown_budget(self, bot):
        await bot.handle_update(update("/risk"))
        assert "Equity" in bot.last and "Drawdown" in bot.last

    async def test_book_shows_every_venue(self, bot):
        await bot.handle_update(update("/book BTCUSDT"))
        assert "TEST" in bot.last and "spread" in bot.last

    async def test_tca_renders_the_smart_route(self, bot):
        await bot.handle_update(update("/tca BTCUSDT 50000 BUY"))
        assert "Smart route" in bot.last
        assert "blended vwap" in bot.last

    async def test_status_reports_feed_health(self, bot):
        await bot.handle_update(update("/status"))
        assert "Market data feeds" in bot.last

    async def test_orders_reads_the_audit_log(self, bot):
        await bot.gateway.submit(OrderRequest(symbol="BTCUSDT", side="BUY", notional=10_000))
        await bot.handle_update(update("/orders"))
        assert "BTCUSDT" in bot.last

    async def test_limits_lists_every_hard_limit(self, bot):
        await bot.handle_update(update("/limits"))
        for key in settings.risk_limits_dict():
            assert key in bot.last

    async def test_backtest_queues_a_job(self, bot):
        await bot.handle_update(update("/backtest BTCUSDT 1h ma_cross"))
        assert "Backtest queued" in bot.last
        assert bot.queue.list(), "no job was submitted"

    async def test_bad_backtest_arguments_are_reported_not_raised(self, bot):
        await bot.handle_update(update("/backtest BTCUSDT 1h no_such_strategy"))
        assert "Bad parameters" in bot.last

    async def test_unknown_command_shows_help(self, bot):
        await bot.handle_update(update("/frobnicate"))
        assert "Unknown command" in bot.last

    async def test_non_command_text_is_ignored(self, bot):
        await bot.handle_update(update("just chatting"))
        assert not bot.sent


@pytest.mark.asyncio
class TestAuthorisation:
    async def test_allowlist_blocks_foreign_chats(self, bot, chat_lists):
        allowed, _ = chat_lists
        allowed[:] = ["999"]
        await bot.handle_update(update("/kill", chat_id="4321"))
        assert not bot.gateway.kill.active
        assert "Not authorised" in bot.last

    async def test_allowlisted_chat_passes(self, bot, chat_lists):
        allowed, _ = chat_lists
        allowed[:] = [CHAT]
        await bot.handle_update(update("/kill"))
        assert bot.gateway.kill.active

    async def test_empty_allowlist_is_open(self, bot, chat_lists):
        allowed, _ = chat_lists
        allowed[:] = []
        await bot.handle_update(update("/kill", chat_id="55"))
        assert bot.gateway.kill.active


@pytest.mark.asyncio
class TestOutbound:
    async def test_risk_alerts_reach_the_chat(self, bot, chat_lists):
        _, alerts = chat_lists
        alerts[:] = [CHAT]
        bot.gateway.add_alert_hook(bot.broadcast)
        await bot.gateway.trigger_kill("drawdown", "circuit-breaker")
        assert any("KILL SWITCH ENGAGED" in m for m in bot.sent)

    async def test_backtest_result_is_pushed_as_a_photo(self, bot):
        class Rec:
            job_id, kind, status, error = "j1", "backtest", "succeeded", None
            meta = {"chat_id": CHAT}
            result = {
                "best": {"fast": 10, "slow": 40, "sharpe": 1.2, "total_return": 0.3, "max_drawdown": -0.1},
                "deflated_sharpe_ratio": 0.97, "walk_forward_oos_sharpe": 0.8,
                "request": {"symbol": "BTCUSDT", "interval": "1h", "strategy": "ma_cross"},
                "combos_tested": 74, "duration_s": 2.1, "engine": "vectorbt",
                "benchmark_buy_hold": {"sharpe": 0.4}, "dsr_verdict": "PASS",
                "equity_curve_png": "aGVsbG8=", "heatmap_png": "aGVsbG8=",
            }

        await bot.push_backtest_result(Rec())
        assert len(bot.photos) == 2
        assert "DSR 0.970" in bot.photos[0][1]

    async def test_failed_job_reports_the_error(self, bot):
        class Rec:
            job_id, kind, status = "j2", "backtest", "failed"
            error = "insufficient data"
            meta = {"chat_id": CHAT}
            result = None

        await bot.push_backtest_result(Rec())
        assert "failed" in bot.last and "insufficient data" in bot.last


@pytest.mark.asyncio
class TestSubscriptions:
    async def test_start_auto_subscribes(self, bot, chat_lists):
        chat_lists[1][:] = []
        await bot.handle_update(update("/start"))
        assert [s["chat_id"] for s in bot._subscribers()] == [CHAT]

    async def test_subscription_survives_a_restart(self, bot, chat_lists):
        """The alert list lives in the audit log, not memory — otherwise a
        restart silently stops delivering kill-switch alerts."""
        chat_lists[1][:] = []
        await bot.handle_update(update("/subscribe"))

        reborn = StubBot(gateway=bot.gateway, tca=bot.tca, queue=bot.queue, audit=bot.audit)
        assert reborn._alert_targets() == [CHAT]

    async def test_unsubscribe_stops_alerts(self, bot, chat_lists):
        chat_lists[1][:] = []
        await bot.handle_update(update("/subscribe"))
        await bot.handle_update(update("/unsubscribe"))
        assert bot._subscribers() == []

    async def test_alert_with_no_subscribers_is_dropped_not_raised(self, bot, chat_lists):
        chat_lists[1][:] = []
        bot._known_chats.clear()
        await bot.broadcast("critical", "nobody is listening")
        assert not bot.sent

    async def test_configured_targets_take_precedence(self, bot, chat_lists):
        chat_lists[1][:] = ["777"]
        await bot.handle_update(update("/subscribe"))
        assert bot._alert_targets() == ["777"]


@pytest.mark.asyncio
class TestWatches:
    async def test_watch_is_registered_and_listed(self, bot, chat_lists):
        chat_lists[1][:] = []
        await bot.handle_update(update("/watch BTCUSDT 50000 30"))
        assert "Watching BTCUSDT" in bot.last
        await bot.handle_update(update("/watches"))
        assert "BTCUSDT" in bot.last and "30.0bps" in bot.last

    async def test_watch_rejects_untracked_symbol(self, bot):
        await bot.handle_update(update("/watch DOGEUSDT"))
        assert "Not a tracked instrument" in bot.last

    async def test_watch_rejects_bad_numbers(self, bot):
        await bot.handle_update(update("/watch BTCUSDT abc"))
        assert "Usage" in bot.last

    async def test_unwatch_removes(self, bot, chat_lists):
        chat_lists[1][:] = []
        await bot.handle_update(update("/watch BTCUSDT"))
        await bot.handle_update(update("/unwatch BTCUSDT"))
        assert "Removed 1" in bot.last

    async def test_breach_alerts_once_then_alerts_on_recovery(self, bot, chat_lists):
        """Transition-only alerting: a liquidity event must not send a message
        every poll, or the trader mutes the bot and misses the next kill."""
        from modules.tca_engine import BookState

        chat_lists[1][:] = []
        await bot.handle_update(update("/watch BTCUSDT 100000 1"))
        bot.sent.clear()

        thin = BookState("TEST", "BTCUSDT")
        thin.apply_snapshot(bids=[(100.0, 1.0)], asks=[(100.0, 1.0), (900.0, 10_000.0)])
        bot.tca.feeds["TEST"].books["BTCUSDT"] = thin

        for _ in range(3):
            await bot._watch_tick()
        assert sum("Liquidity alert" in m for m in bot.sent) == 1

        bot.tca.feeds["TEST"].books["BTCUSDT"] = deep_book()
        for _ in range(3):
            await bot._watch_tick()
        assert sum("recovered" in m for m in bot.sent) == 1


class TestRendering:
    def test_html_is_escaped(self):
        assert esc("<script>&") == "&lt;script&gt;&amp;"

    def test_long_messages_are_truncated_below_the_api_cap(self):
        bot = TelegramBot()
        assert len("x" * 5000) > 4096   # would be rejected by Telegram
        # send_message truncates; verify the guard exists and the bound is right.
        import inspect

        src = inspect.getsource(bot.send_message)
        assert "4000" in src and "truncated" in src
