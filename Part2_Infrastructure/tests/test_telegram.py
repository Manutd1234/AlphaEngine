"""Text-only Telegram companion: registry, security, rendering and commands."""

from __future__ import annotations

import re

import pytest

from config import settings
from conftest import deep_book, stub_feed
from modules.audit import AuditLog
from modules.jobs import JobQueue
from modules.risk_proxy import RiskGateway, TokenBucket
from modules.schemas import OrderRequest
from modules.tca_engine import BookState, TCAEngine
from modules.telegram import (
    _BOOTSTRAP_COMMANDS,
    TelegramBot,
)  # noqa: F401
from modules.telegram import (
    BOT_COMMANDS,
    BOT_DESCRIPTION,
    BOT_SHORT_DESCRIPTION,
    COMMAND_SPECS,
    TelegramBot,
    command_catalogue,
    esc,
    help_text,
    split_telegram_html,
)

CHAT = "12345"
USER = "7"


class StubBot(TelegramBot):
    """Captures outbound messages without touching api.telegram.org."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.token = "999:TEST"
        self.sent: list[str] = []
        self.api_calls: list[tuple[str, dict]] = []

    async def api(self, method, **params):
        self.api_calls.append((method, params))
        return {"ok": True, "result": {}}

    async def send_message(self, chat_id, text):
        self.sent.extend(split_telegram_html(text))
        return {"ok": True}

    @property
    def last(self) -> str:
        return self.sent[-1] if self.sent else ""


@pytest.fixture
def bot(tmp_path) -> StubBot:
    tca = TCAEngine(symbols=["BTCUSDT"], venues=[])
    tca.feeds = {"TEST": stub_feed("TEST", deep_book())}
    audit = AuditLog(tmp_path / "telegram.duckdb")
    gateway = RiskGateway(tca_engine=tca, audit=audit)
    gateway.bucket = TokenBucket(1e6, 1_000_000)
    return StubBot(gateway=gateway, tca=tca, queue=JobQueue(workers=1), audit=audit)


@pytest.fixture(autouse=True)
def telegram_lists():
    saved = (
        list(settings.telegram_allowed_user_ids),
        list(settings.telegram_allowed_chat_ids),
        list(settings.telegram_alert_chat_ids),
    )
    settings.telegram_allowed_user_ids[:] = [USER]
    settings.telegram_allowed_chat_ids[:] = []
    settings.telegram_alert_chat_ids[:] = []
    yield
    settings.telegram_allowed_user_ids[:] = saved[0]
    settings.telegram_allowed_chat_ids[:] = saved[1]
    settings.telegram_alert_chat_ids[:] = saved[2]


def update(text: str, *, chat_id: str = CHAT, user_id: str = USER, update_id: int = 1) -> dict:
    return {
        "update_id": update_id,
        "message": {
            "message_id": 1,
            "chat": {"id": int(chat_id), "type": "private" if chat_id == user_id else "group"},
            "from": {"id": int(user_id), "username": "operator"},
            "text": text,
        },
    }


class TestRegistry:
    def test_large_catalogue_is_valid_and_dispatchable(self):
        assert len(COMMAND_SPECS) >= 50
        names = [spec.name for spec in COMMAND_SPECS]
        assert len(names) == len(set(names))
        for spec in COMMAND_SPECS:
            assert re.fullmatch(r"[a-z0-9_]{1,32}", spec.name)
            assert 1 <= len(spec.description) <= 256
            assert hasattr(TelegramBot, spec.handler)
        assert BOT_COMMANDS == [(spec.name, spec.description) for spec in COMMAND_SPECS]
        assert len(BOT_SHORT_DESCRIPTION) <= 120
        assert len(BOT_DESCRIPTION) <= 512

    def test_the_companion_stays_text_only_and_never_links_a_web_ui(self):
        """
        Unchanged half of the original boundary. The bot gained risk controls,
        but it is still a text client: it does not open, embed or link to the
        web workspace, and it cannot queue work.
        """
        names = {spec.name for spec in COMMAND_SPECS}
        assert names.isdisjoint({"app", "backtest"}), "no web-UI launch, no job submission"
        source = "\n".join([command_catalogue(), help_text(), BOT_DESCRIPTION]).lower()
        for forbidden in ("web_app", "telegram mini app", "vercel.app", "http://", "https://"):
            assert forbidden not in source

    def test_trading_controls_exist_but_are_gated(self):
        """
        The boundary that MOVED, stated explicitly.

        This test previously asserted the companion had no controls at all. It
        now has three, and what replaces "they are absent" is not nothing — it
        is the set of properties that make them safe to expose over chat. If a
        future change relaxes any of these, this fails rather than the change
        passing silently because the old assertion was simply deleted.
        """
        controls = {spec.name for spec in COMMAND_SPECS if spec.category == "Controls"}
        assert controls == {"halt", "resume", "flatten"}

        # 1. Never reachable before authorisation.
        assert not ({"/halt", "/resume", "/flatten"} & _BOOTSTRAP_COMMANDS)

        # 2. A second, narrower allow-list — reading the book does not imply
        #    being able to stop the desk, and it is empty by default.
        assert hasattr(settings, "telegram_control_user_ids")
        bot = TelegramBot()
        object.__setattr__(settings, "telegram_control_user_ids", [])
        assert bot._may_control("anyone") is False, "control must fail closed"

        # 3. A single-use, user-bound, expiring challenge — never a bare command.
        object.__setattr__(settings, "telegram_control_user_ids", ["operator"])

        # A fresh challenge per assertion: consuming BURNS the code even on a
        # failed attempt, deliberately, so a wrong guess cannot be followed by a
        # brute force against a still-live four-digit code.
        code = bot._issue_challenge("operator", "halt", None)
        assert bot._consume_challenge("other_user", "halt", code)[0] is False, "bound to the user"

        code = bot._issue_challenge("operator", "halt", None)
        assert bot._consume_challenge("operator", "flatten", code)[0] is False, "bound to the action"

        code = bot._issue_challenge("operator", "halt", None)
        assert bot._consume_challenge("operator", "halt", code)[0] is True
        assert bot._consume_challenge("operator", "halt", code)[0] is False, "single use"

    def test_help_is_grouped_and_has_exact_syntax(self):
        catalogue = command_catalogue()
        assert "Portfolio" in catalogue and "Markets" in catalogue and "Execution" in catalogue
        assert "/snapshot" in catalogue and "/digest" in catalogue
        quote_help = help_text("quote")
        assert "/quote SYMBOL" in quote_help and "/quote AAPL" in quote_help
        assert "9 COMMANDS" in help_text("portfolio")


@pytest.mark.asyncio
class TestAccessAndDispatch:
    async def test_start_is_text_only_and_does_not_auto_subscribe(self, bot):
        await bot.handle_update(update("/start"))
        assert "TEXT ONLY" in bot.last
        assert bot._subscribers() == []

    async def test_empty_allowlist_is_bootstrap_only(self, bot):
        settings.telegram_allowed_user_ids[:] = []
        await bot.handle_update(update("/risk", update_id=2))
        assert "Not authorised" in bot.last
        assert "User ID" in bot.last
        await bot.handle_update(update("/whoami", update_id=3))
        assert "NOT YET AUTHORISED" in bot.last

    async def test_group_authorisation_uses_user_not_chat_id(self, bot):
        settings.telegram_allowed_user_ids[:] = ["88"]
        await bot.handle_update(update("/portfolio", chat_id=CHAT, user_id="77", update_id=4))
        assert "Not authorised" in bot.last
        await bot.handle_update(update("/portfolio", chat_id=CHAT, user_id="88", update_id=5))
        assert "Portfolio" in bot.last

    async def test_duplicate_update_is_ignored(self, bot):
        event = update("/ping", update_id=100)
        await bot.handle_update(event)
        await bot.handle_update(event)
        assert sum("Command path" in message for message in bot.sent) == 1

    async def test_unknown_command_is_concise(self, bot):
        await bot.handle_update(update("/frobnicate", update_id=6))
        assert "Unknown command" in bot.last
        assert "command catalogue" not in bot.last.lower()

    async def test_handler_exception_returns_safe_reference(self, bot, monkeypatch):
        async def explode(*_args):
            raise RuntimeError("secret internal detail")

        monkeypatch.setattr(bot, "_cmd_ping", explode)
        await bot.handle_update(update("/ping", update_id=4321))
        assert "Command failed" in bot.last and "tg-4321" in bot.last
        assert "secret internal detail" not in bot.last

    async def test_registry_aliases_dispatch(self, bot):
        await bot.handle_update(update("/health", update_id=7))
        assert "AlphaEngine systems" in bot.last
        await bot.handle_update(update("/bookstate", update_id=8))
        assert "Portfolio" in bot.last


@pytest.mark.asyncio
class TestPortfolioAndExecution:
    async def test_portfolio_command_renders_pm_state(self, bot):
        await bot.handle_update(update("/portfolio", update_id=10))
        assert "Portfolio" in bot.last and "Risk budget" in bot.last

    async def test_read_only_commands_do_not_change_gateway_state(self, bot):
        before = bot.gateway.state().model_dump()
        commands = ["/risk", "/limits", "/exposure", "/concentration", "/headroom", "/pnl"]
        for index, command in enumerate(commands, 11):
            await bot.handle_update(update(command, update_id=index))
        after = bot.gateway.state().model_dump()
        assert after == before

    async def test_book_spread_depth_and_tca_are_text_cards(self, bot):
        commands = [
            ("/book BTCUSDT", "top of book"),
            ("/spread BTCUSDT", "spreads"),
            ("/depth BTCUSDT", "displayed depth"),
            ("/tca BTCUSDT 50000 BUY", "TCA"),
            ("/route BTCUSDT 50000 SELL", "smart route"),
            ("/liquidity BTCUSDT 50000", "liquidity"),
        ]
        for index, (command, expected) in enumerate(commands, 30):
            await bot.handle_update(update(command, update_id=index))
            assert expected.lower() in bot.last.lower()

    async def test_bad_numeric_arguments_return_usage_failure_not_silence(self, bot):
        await bot.handle_update(update("/tca BTCUSDT nope BUY", update_id=40))
        assert "Command failed" in bot.last
        assert "no trading state was changed" in bot.last

    async def test_orders_fills_rejections_and_cost_stats(self, bot):
        await bot.gateway.submit(OrderRequest(symbol="BTCUSDT", side="BUY", notional=10_000))
        bot.gateway.kill.active = True
        bot.gateway.kill.reason = "test"
        await bot.gateway.submit(OrderRequest(symbol="BTCUSDT", side="BUY", notional=10_000))
        bot.gateway.kill.active = False
        for index, command in enumerate(("/orders", "/fills", "/rejections", "/slippage", "/fees"), 50):
            await bot.handle_update(update(command, update_id=index))
            assert "AUDIT" in bot.last or "Execution" in bot.last


@pytest.mark.asyncio
class TestOpenBBCommands:
    @pytest.fixture(autouse=True)
    def fake_openbb(self, monkeypatch):
        from modules import research

        async def status():
            return {"ok": True, "provider": "yfinance", "detail": None}

        async def quote(symbol, asset="equity"):
            return {"ok": True, "data": {"symbol": symbol, "price": 101.0, "change": 1.0,
                    "change_percent": 1.0, "open": 100.0, "high": 102.0, "low": 99.0,
                    "volume": 1234, "currency": "USD", "delayed": True}}

        async def bars(symbol, asset, interval, limit):
            rows = [
                {"date": f"2026-08-{day:02d}", "open": 99 + day, "high": 101 + day,
                 "low": 98 + day, "close": 100 + day, "volume": 1000 * day}
                for day in range(1, max(limit, 2) + 1)
            ]
            return {"ok": True, "data": rows[-limit:]}

        async def news(symbols, limit):
            return {"ok": True, "data": [
                {"title": f"{symbols[0]} update {index}", "source": "Wire", "date": "2026-08-04"}
                for index in range(limit)
            ]}

        async def fundamentals(symbol):
            return {"ok": True, "data": {"symbol": symbol, "name": "Example Corp", "exchange": "NMS",
                    "sector": "Technology", "industry": "Software", "market_cap": 1_000_000,
                    "pe_ratio": 20.0, "eps": 5.0, "beta": 1.1, "description": "A test company."}}

        monkeypatch.setattr(research, "openbb_status_async", status)
        monkeypatch.setattr(research, "quote", quote)
        monkeypatch.setattr(research, "bars", bars)
        monkeypatch.setattr(research, "news", news)
        monkeypatch.setattr(research, "fundamentals", fundamentals)

    async def test_openbb_quote_bars_and_derived_market_commands(self, bot):
        commands = [
            ("/openbb", "READY"),
            ("/quote AAPL", "AAPL quote"),
            ("/bars AAPL 1d 5", "DELAYED BARS"),
            ("/trend AAPL 1d 5", "Return"),
            ("/range AAPL 1d 5", "Range width"),
            ("/volume AAPL 1d 5", "Average"),
        ]
        for index, (command, expected) in enumerate(commands, 70):
            await bot.handle_update(update(command, update_id=index))
            assert expected in bot.last

    async def test_news_fundamentals_and_snapshot(self, bot):
        for index, (command, expected) in enumerate((
            ("/news AAPL 3", "AAPL headlines"),
            ("/fundamentals AAPL", "Example Corp"),
            ("/snapshot AAPL", "research snapshot"),
            ("/research AAPL", "research snapshot"),
        ), 90):
            await bot.handle_update(update(command, update_id=index))
            assert expected in bot.last

    async def test_openbb_unavailability_is_clear(self, bot, monkeypatch):
        from modules import research

        async def unavailable(*_args):
            return {"ok": False, "error": "provider unavailable"}

        monkeypatch.setattr(research, "quote", unavailable)
        await bot.handle_update(update("/quote AAPL", update_id=1000))
        assert "UNAVAILABLE" in bot.last and "provider unavailable" in bot.last

    async def test_openbb_inputs_are_bounded(self, bot):
        await bot.handle_update(update("/bars AAPL 7m 5", update_id=1001))
        assert "Command failed" in bot.last
        await bot.handle_update(update("/news AAPL 999", update_id=1002))
        assert "Command failed" in bot.last


@pytest.mark.asyncio
class TestSubscriptionsAndAlerts:
    async def test_start_requires_explicit_subscription_and_persists(self, bot):
        await bot.handle_update(update("/start", update_id=110))
        assert bot._subscribers() == []
        await bot.handle_update(update("/subscribe", update_id=111))
        assert [row["chat_id"] for row in bot._subscribers()] == [CHAT]
        assert bot.audit.get_subscriber(CHAT)["user_id"] == USER
        reborn = StubBot(gateway=bot.gateway, tca=bot.tca, queue=bot.queue, audit=bot.audit)
        assert reborn._alert_targets() == [CHAT]

    async def test_allowlist_revocation_disables_persisted_pushes(self, bot):
        await bot.handle_update(update("/watch BTCUSDT 100000 1", update_id=1111))
        settings.telegram_allowed_user_ids[:] = ["88"]

        assert bot._subscribers() == []
        assert bot._alert_targets() == []
        bot.sent.clear()
        thin = BookState("TEST", "BTCUSDT")
        thin.apply_snapshot(bids=[(100.0, 1.0)], asks=[(100.0, 1.0), (900.0, 10_000.0)])
        bot.tca.feeds["TEST"].books["BTCUSDT"] = thin
        await bot._watch_tick()
        await bot.broadcast("critical", "must not be delivered")
        assert bot.sent == []

    async def test_legacy_recipient_and_watch_are_fail_closed(self, bot):
        bot.audit.upsert_subscriber(
            CHAT,
            "legacy-username-without-owner-id",
            alerts=True,
            watches=[{"symbol": "BTCUSDT", "notional": 100_000, "threshold_bps": 1}],
        )
        settings.telegram_alert_chat_ids[:] = [CHAT]
        thin = BookState("TEST", "BTCUSDT")
        thin.apply_snapshot(bids=[(100.0, 1.0)], asks=[(100.0, 1.0), (900.0, 10_000.0)])
        bot.tca.feeds["TEST"].books["BTCUSDT"] = thin

        assert bot.audit.get_subscriber(CHAT)["user_id"] is None
        assert bot._alert_targets() == []
        await bot._watch_tick()
        await bot.broadcast("critical", "must not be delivered")
        assert bot.sent == []

    async def test_central_chat_target_requires_authorised_owner(self, bot):
        settings.telegram_alert_chat_ids[:] = [CHAT]
        assert bot._alert_targets() == []
        await bot.handle_update(update("/subscribe", update_id=1112))
        assert bot._alert_targets() == [CHAT]
        settings.telegram_allowed_user_ids[:] = ["88"]
        assert bot._alert_targets() == []

    async def test_unsubscribe_is_truthful_for_central_targets(self, bot):
        settings.telegram_alert_chat_ids[:] = [CHAT]
        await bot.handle_update(update("/unsubscribe", update_id=112))
        assert "CANNOT MUTE HERE" in bot.last

    async def test_watch_rejects_nonfinite_and_lists_valid_watch(self, bot):
        await bot.handle_update(update("/watch BTCUSDT nan 25", update_id=113))
        assert "Command failed" in bot.last
        await bot.handle_update(update("/watch BTCUSDT 50000 30", update_id=114))
        assert "ACTIVE" in bot.last
        await bot.handle_update(update("/watches", update_id=115))
        assert "BTCUSDT" in bot.last and "30.0 bps" in bot.last

    async def test_breach_alerts_once_and_recovery_once(self, bot):
        await bot.handle_update(update("/watch BTCUSDT 100000 1", update_id=116))
        bot.sent.clear()
        thin = BookState("TEST", "BTCUSDT")
        thin.apply_snapshot(bids=[(100.0, 1.0)], asks=[(100.0, 1.0), (900.0, 10_000.0)])
        bot.tca.feeds["TEST"].books["BTCUSDT"] = thin
        for _ in range(3):
            await bot._watch_tick()
        assert sum("liquidity deterioration" in message for message in bot.sent) == 1
        bot.tca.feeds["TEST"].books["BTCUSDT"] = deep_book()
        for _ in range(3):
            await bot._watch_tick()
        assert sum("liquidity recovered" in message for message in bot.sent) == 1

    async def test_gateway_alert_is_normalized_as_text(self, bot):
        await bot.handle_update(update("/subscribe", update_id=117))
        bot.sent.clear()
        await bot.broadcast("critical", "<b>Risk limit reached</b>")
        assert "operational alert" in bot.last and "CRITICAL" in bot.last
        assert "Risk limit reached" in bot.last

    async def test_backtest_completion_is_text_only(self, bot):
        await bot.handle_update(update("/subscribe", update_id=118))

        class Record:
            job_id, kind, status, error = "j1", "backtest", "succeeded", None
            meta = {"chat_id": CHAT}
            result = {
                "best": {"fast": 10, "slow": 40, "sharpe": 1.2, "total_return": 0.3, "max_drawdown": -0.1},
                "deflated_sharpe_ratio": 0.97,
                "walk_forward_oos_sharpe": 0.8,
                "request": {"symbol": "BTCUSDT", "interval": "1h", "strategy": "ma_cross"},
                "combos_tested": 74,
                "dsr_verdict": "PASS",
                "equity_curve_png": "must-not-be-used",
            }

        await bot.push_backtest_result(Record())
        assert "TEXT RESULT" in bot.last and "DSR" in bot.last
        assert not any(method == "sendPhoto" for method, _ in bot.api_calls)

        bot.sent.clear()
        settings.telegram_allowed_user_ids[:] = ["88"]
        await bot.push_backtest_result(Record())
        assert bot.sent == []


class TestRenderingAndSafety:
    def test_legacy_subscriber_schema_migrates_without_inferred_owner(self, tmp_path):
        db_path = tmp_path / "legacy-subscriber.duckdb"
        legacy = AuditLog(db_path)
        legacy._exec("DROP TABLE subscribers")
        legacy._exec(
            "CREATE TABLE subscribers (chat_id VARCHAR, username VARCHAR, "
            "subscribed_at TIMESTAMP, alerts BOOLEAN, watches VARCHAR)"
        )
        legacy._exec(
            "INSERT INTO subscribers VALUES (?,?,?,?,?)",
            (CHAT, f"tg:{USER}:operator", "2026-08-04 00:00:00", True, "[]"),
        )
        legacy.close()

        migrated = AuditLog(db_path)
        row = migrated.get_subscriber(CHAT)
        assert row is not None
        assert "user_id" in row and row["user_id"] is None
        migrated.close()

    def test_html_is_escaped(self):
        assert esc("<script>&") == "&lt;script&gt;&amp;"

    def test_long_messages_split_without_broken_html(self):
        text = "\n".join(f"<b>Section {index}</b> " + "x" * 120 for index in range(80))
        chunks = split_telegram_html(text)
        assert len(chunks) > 1
        assert all(len(chunk) <= 3900 for chunk in chunks)
        assert all(chunk.count("<b>") == chunk.count("</b>") for chunk in chunks)

    def test_oversized_single_line_becomes_safe_plain_text(self):
        chunks = split_telegram_html("<b>" + "x" * 8000 + "</b>")
        assert all(len(chunk) <= 3900 for chunk in chunks)
        assert all("<b>" not in chunk and "</b>" not in chunk for chunk in chunks)

    def test_health_declares_separation_contract(self, bot):
        health = bot.health()
        assert health["read_only"] is True
        assert health["text_only"] is True

    @pytest.mark.asyncio
    async def test_transport_error_never_echoes_token(self, bot):
        class BrokenClient:
            async def post(self, *_args, **_kwargs):
                raise RuntimeError(f"failed at {bot.base}/getMe")

        bot._client = BrokenClient()  # type: ignore[assignment]
        await TelegramBot.api(bot, "getMe")
        assert bot.token not in (bot.last_error or "")
        assert "RuntimeError" in (bot.last_error or "")
