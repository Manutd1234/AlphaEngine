"""Text-only Telegram companion: registry, security, rendering and commands."""

from __future__ import annotations

import re

import pytest
from conftest import deep_book

from config import settings
from modules.audit import AuditLog
from modules.schemas import OrderRequest
from modules.tca_engine import BookState
from modules.telegram import (
    _BOOTSTRAP_COMMANDS,
    BOT_COMMANDS,
    BOT_DESCRIPTION,
    BOT_SHORT_DESCRIPTION,
    COMMAND_SPECS,
    TelegramBot,
    command_catalogue,
    esc,
    help_text,
    split_telegram_html,
)  # noqa: F401

CHAT = "12345"
USER = "7"


class StubBot(TelegramBot):
    """Captures outbound messages without touching api.telegram.org."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.token = "999:TEST"
        self.sent: list[str] = []
        self.api_calls: list[tuple[str, dict]] = []
        self.albums: list[list[tuple[str, bytes]]] = []

    async def api(self, method, **params):
        self.api_calls.append((method, params))
        return {"ok": True, "result": {}}

    async def send_message(self, chat_id, text):
        self.sent.extend(split_telegram_html(text))
        return {"ok": True}

    async def send_photo(self, chat_id, photo_bytes, caption=""):
        if caption:
            self.sent.extend(split_telegram_html(caption))
        self.api_calls.append(("sendPhoto", {"chat_id": chat_id, "photo": photo_bytes, "caption": caption}))
        return {"ok": True}

    async def send_media_group(self, chat_id, photos, caption=""):
        # Captured here rather than per-test: without it the chart commands
        # fall through to the real multipart sender, so every album test had
        # to monkeypatch this method itself.
        usable = [(name, blob) for name, blob in photos if blob]
        self.albums.append(usable)
        if caption:
            self.sent.extend(split_telegram_html(caption))
        self.api_calls.append(
            ("sendMediaGroup", {"chat_id": chat_id, "photos": [name for name, _ in usable]})
        )
        return {"ok": True}

    @property
    def last(self) -> str:
        return self.sent[-1] if self.sent else ""


# The `bot` fixture now lives in conftest.py so both Telegram test files
# share one wiring. StubBot stays here — conftest imports it.


# `telegram_lists` moved to conftest.py — every Telegram test file needs the
# same authorised-user setup, and a module-scoped autouse fixture only reached
# this one.


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
        # Ten since /equity joined the category — the count is rendered from
        # the registry, so this moves whenever a Portfolio command lands.
        assert "10 COMMANDS" in help_text("portfolio")


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
        # This test used to assert read_only/text_only were True, which locked
        # a false contract into CI: the control commands mutate risk state and
        # the chart commands send photos. The contract that matters is not
        # "the bot cannot act" — it is "acting is separately gated".
        health = bot.health()
        assert health["read_only"] is False
        assert health["text_only"] is False
        assert health["controls"]["gated"] is True
        assert health["controls"]["commands"] == 3
        assert health["controls"]["control_allowlist_configured"] == bool(
            bot.control_user_ids
        )

    @pytest.mark.asyncio
    async def test_transport_error_never_echoes_token(self, bot):
        class BrokenClient:
            async def post(self, *_args, **_kwargs):
                raise RuntimeError(f"failed at {bot.base}/getMe")

        bot._client = BrokenClient()  # type: ignore[assignment]
        await TelegramBot.api(bot, "getMe")
        assert bot.token not in (bot.last_error or "")
        assert "RuntimeError" in (bot.last_error or "")


@pytest.mark.asyncio
class TestDeskRoleTabsAndCharts:
    """
    The desk-role cards must report what was measured, or say nothing was.

    The previous version of this test asserted that every one of these commands
    sends a photo. That is the invariant that produced the problem: with no
    real series to draw, "always send a chart" can only be satisfied by drawing
    a fake one, and the module duly shipped `64200 + sin(i * 0.3) * 450` under
    the title "Real-Time Market Quote", plus hardcoded captions reporting a
    Sharpe of 2.14 and 99.99% uptime that nothing had computed.

    The contract now is: always answer, chart only what exists.
    """

    async def test_every_desk_role_command_answers(self, bot):
        commands = [
            "/overview", "/research BTCUSDT", "/execution BTCUSDT", "/portfolio",
            "/risk", "/data", "/reliability", "/developer",
        ]
        for idx, cmd in enumerate(commands, start=100):
            bot.sent.clear()
            await bot.handle_update(update(cmd, update_id=idx))
            assert bot.sent, f"{cmd} produced no card at all"

    async def test_a_card_without_data_says_so_instead_of_drawing_one(self, bot):
        # `metrics` keeps one process-wide latency window, and any earlier test
        # that exercised a route leaves samples in it — this assertion is about
        # the empty case, so it has to establish that itself rather than assume
        # the suite ran in a convenient order.
        from modules import metrics

        metrics.reset_request_latency()

        # No request has been timed and no venue has a book in this harness, so
        # both cards must name the absence rather than plot around it.
        bot.sent.clear()
        await bot.handle_update(update("/reliability", update_id=140))
        assert "NO SAMPLES" in bot.last or "nothing to plot" in bot.last

        bot.sent.clear()
        await bot.handle_update(update("/execution BTCUSDT", update_id=141))
        assert "NO LIVE BOOK" in bot.last or "depth" in bot.last.lower()

    async def test_measured_latency_reaches_the_reliability_card(self, bot):
        from modules import metrics

        metrics.reset_request_latency()
        for _ in range(5):
            metrics.observe_request("/api/quote", 12.5)
        try:
            bot.sent.clear()
            await bot.handle_update(update("/reliability", update_id=142))
            assert "/api/quote" in bot.last
            assert "MEASURED" in bot.last
        finally:
            metrics.reset_request_latency()



@pytest.mark.asyncio
class TestBookDerivedCharts:
    """
    Portfolio and risk draw the book, not a stock picture.

    `/portfolio` shipped a fixed three-slice pie captioned with the real report
    beside it, so the numbers and the chart described different books. Both
    commands now chart the gateway's own state, and chart nothing when the book
    is empty.
    """

    async def test_portfolio_and_risk_chart_the_gateway_state(self, bot):
        albums: list[list[tuple[str, bytes]]] = []

        async def capture(chat_id, photos, caption=""):
            albums.append(list(photos))
            bot.sent.extend(split_telegram_html(caption))
            return {"ok": True}

        monkey = capture
        original = bot.send_media_group
        bot.send_media_group = monkey
        try:
            await bot.handle_update(update("/risk", update_id=930))
            await bot.handle_update(update("/portfolio", update_id=931))
        finally:
            bot.send_media_group = original

        assert len(albums) == 2, "both commands must go through the album path"
        risk_charts = [name for name, _ in albums[0]]
        # The gateway always publishes hard limits, so a utilisation chart is
        # always derivable even on an empty book.
        assert risk_charts == ["limits"], risk_charts
        # Allocation and P&L only exist when something is held; either way the
        # command must not invent them.
        assert all(name in {"allocation", "pnl"} for name, _ in albums[1])


@pytest.mark.asyncio
class TestMultiSymbolCharts:
    """
    A command that names several symbols has to answer about all of them.

    `sendPhoto` carries one image, so before this the bot could show one
    symbol's chart and let it stand for a watch list. These pin the three things
    that make the album honest: the parser stops where the asset argument
    begins, one chart is produced per symbol that has bars, and a symbol whose
    bars are missing keeps its quote row instead of being dropped.
    """

    async def test_several_symbols_produce_one_chart_each(self, bot, monkeypatch):
        seen: list[str] = []

        async def quote(symbol, asset):
            return {"ok": True, "data": {"price": 10.0, "change_percent": 1.0, "high": 11.0, "low": 9.0, "delayed": False}}

        async def chart(symbol, asset):
            seen.append(symbol)
            return b"\x89PNG-" + symbol.encode()

        album: list[list[tuple[str, bytes]]] = []

        async def send_media_group(chat_id, photos, caption=""):
            album.append(list(photos))
            bot.sent.extend(split_telegram_html(caption))
            return {"ok": True}

        monkeypatch.setattr(bot, "_quote_payload", quote)
        monkeypatch.setattr(bot, "_symbol_chart", chart)
        monkeypatch.setattr(bot, "send_media_group", send_media_group)

        await bot.handle_update(update("/quote BTCUSDT ETHUSDT SOLUSDT", update_id=901))

        assert seen == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
        assert [name for name, _ in album[0]] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
            assert symbol in bot.last

    async def test_a_symbol_without_bars_keeps_its_quote_row(self, bot, monkeypatch):
        async def quote(symbol, asset):
            return {"ok": True, "data": {"price": 10.0, "change_percent": 1.0, "high": 11.0, "low": 9.0, "delayed": False}}

        async def chart(symbol, asset):
            return None if symbol == "ETHUSDT" else b"\x89PNG"

        album: list[list[tuple[str, bytes]]] = []

        async def send_media_group(chat_id, photos, caption=""):
            album.append(list(photos))
            bot.sent.extend(split_telegram_html(caption))
            return {"ok": True}

        monkeypatch.setattr(bot, "_quote_payload", quote)
        monkeypatch.setattr(bot, "_symbol_chart", chart)
        monkeypatch.setattr(bot, "send_media_group", send_media_group)

        await bot.handle_update(update("/quote BTCUSDT ETHUSDT", update_id=902))

        assert [name for name, _ in album[0]] == ["BTCUSDT"]
        # The number survives even though the picture did not.
        assert "ETHUSDT" in bot.last

    async def test_album_degrades_to_a_single_photo_and_then_to_text(self, bot):
        # Calls the production method explicitly: StubBot captures albums for
        # every other test, and the degradation ladder is exactly the logic
        # that capture would skip.
        real = TelegramBot.send_media_group

        # One item is a plain photo, never an album; none at all is the card.
        await real(bot, CHAT, [("BTCUSDT", b"\x89PNG")], caption="one chart")
        assert any(method == "sendPhoto" for method, _ in bot.api_calls)

        bot.sent.clear()
        await real(bot, CHAT, [], caption="no charts at all")
        assert "no charts at all" in bot.last


class TestMultiSymbolParsingAndDrawing:
    """The synchronous half: argument parsing, pixels, and the honesty scan."""

    def test_no_fabricated_desk_figures_survive_in_the_module(self):
        from pathlib import Path

        import modules.telegram as telegram_module

        # Strip comments and docstrings — this file's own explanation names the
        # very literals it is banning, and a raw substring scan would match it.
        raw = Path(telegram_module.__file__).read_text()
        source = "\n".join(
            line for line in raw.splitlines()
            if not line.lstrip().startswith("#")
        )
        # Each of these was printed as live desk telemetry and computed by
        # nothing. They are pinned as literals so a future edit cannot quietly
        # reintroduce the pattern.
        for fabricated in [
            "Sharpe Ratio <code>2.14",
            "99.99%",
            "84% Remaining",
            "Binance 58% / Bybit 42%",
            "$64,608.20",
            "1,080 CI PASSED",
        ]:
            assert fabricated not in source, f"fabricated desk figure is back: {fabricated}"

    def test_no_chart_generator_invents_its_own_data(self):
        """Every `generate_*_png` must plot what it was handed.

        The module shipped a `generate_chart_png` that drew
        `64200 + sin(i * 0.3) * 450` under the caption "Real-Time Market
        Quote" — a decorative curve a reader could not tell apart from a
        measurement. It has been deleted; this keeps the shape of that mistake
        out. AST rather than substring, so the prose above (which names the
        banned calls) cannot fail its own rule.
        """
        import ast
        import importlib
        from pathlib import Path

        import modules.telegram as telegram_module

        modules_to_scan = [telegram_module]
        # The generators may live in their own module; scan it too when it is
        # there, so extracting them cannot quietly escape this rule.
        try:
            modules_to_scan.append(importlib.import_module("modules.telegram_charts"))
        except ModuleNotFoundError:
            pass

        banned = {"random", "sin", "cos", "uniform", "randn", "normal"}
        for module in modules_to_scan:
            tree = ast.parse(Path(module.__file__).read_text())
            for node in ast.walk(tree):
                if not isinstance(node, ast.FunctionDef):
                    continue
                if not (node.name.startswith("generate_") and node.name.endswith("_png")):
                    continue
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute):
                        assert inner.func.attr not in banned, (
                            f"{module.__name__}.{node.name} synthesises data "
                            f"with {inner.func.attr}()"
                        )

        assert not hasattr(telegram_module, "generate_chart_png"), (
            "generate_chart_png drew fake desk data under factual captions"
        )

    def test_symbol_parsing_stops_at_the_asset_argument(self, bot):
        assert bot._symbols(["btcusdt", "ethusdt", "solusdt"]) == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
        # `_asset` reads the positional after the symbols; it must not be eaten.
        assert bot._symbols(["AAPL", "equity"]) == ["AAPL"]
        assert bot._symbols(["BTCUSDT", "BTCUSDT"]) == ["BTCUSDT"]
        assert bot._symbols([]) == [settings.symbols[0].upper()]
        assert len(bot._symbols(["A", "B", "C", "D", "E", "F", "G", "H"])) == 6

    def test_the_series_chart_is_drawn_from_the_closes_it_is_given(self):
        from modules.telegram import generate_series_chart_png

        rising = generate_series_chart_png("BTCUSDT", [100.0, 101.0, 108.0], "1d", "OpenBB")
        falling = generate_series_chart_png("BTCUSDT", [108.0, 101.0, 100.0], "1d", "OpenBB")
        assert rising[:4] == b"\x89PNG" and falling[:4] == b"\x89PNG"
        # Different inputs must not render the same picture — the point of the
        # separate generator is that it plots data rather than a fixed curve.
        assert rising != falling
