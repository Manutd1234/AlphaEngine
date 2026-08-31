"""Routing, deep-link and source-safety contracts for Telegram engine tabs."""

from pathlib import Path

import pytest
from test_telegram import update

from config import settings
from modules.telegram import engine_snapshots as snapshot_module
from modules.telegram._mixins import tabs_engine
from modules.telegram.engine_snapshots import DiffusionSnapshot, MarketsSnapshot, ProofsSnapshot
from modules.telegram.keyboards import add_url_row, cb, kb


@pytest.mark.asyncio
async def test_legacy_coherence_dispatches_the_proofs_handler(bot, monkeypatch):
    async def proof(_series=None):
        return ProofsSnapshot(state="fresh", verdict="coherent", engine="linear_programme")

    monkeypatch.setattr(tabs_engine, "proofs_snapshot", proof)
    await bot.handle_update(update("/coherence", update_id=91_003))

    assert "Proofs" in bot.last
    assert "coherent" in bot.last
    assert "Unknown command" not in bot.last


@pytest.mark.asyncio
async def test_configured_workspace_adds_https_deep_link_without_credentials(bot, monkeypatch):
    async def market(_series=None):
        return MarketsSnapshot(state="empty")

    monkeypatch.setattr(tabs_engine, "markets_snapshot", market)
    monkeypatch.setattr(
        type(settings), "resolved_web_workspace_url", property(lambda _settings: "https://desk.test")
    )
    await bot.handle_update(update("/markets", update_id=91_004))

    buttons = [button for row in bot.keyboards[-1]["inline_keyboard"] for button in row]
    links = [button["url"] for button in buttons if "url" in button]
    assert links == ["https://desk.test/#markets/universe"]
    assert all("token" not in link and "chat" not in link for link in links)


@pytest.mark.asyncio
async def test_all_engine_commands_keep_their_exact_workspace_deep_link(bot, monkeypatch):
    async def market(_series=None):
        return MarketsSnapshot(state="empty")

    async def proof(_series=None):
        return ProofsSnapshot(
            state="empty",
            universe_state="empty",
            certificate_state="empty",
            index_state="empty",
        )

    async def diffusion():
        return DiffusionSnapshot(
            state="empty",
            absorption_state="empty",
            episodes_state="empty",
            findings_state="empty",
        )

    monkeypatch.setattr(tabs_engine, "markets_snapshot", market)
    monkeypatch.setattr(tabs_engine, "proofs_snapshot", proof)
    monkeypatch.setattr(tabs_engine, "diffusion_snapshot", diffusion)
    monkeypatch.setattr(
        type(settings), "resolved_web_workspace_url", property(lambda _settings: "https://desk.test")
    )

    for offset, (command, fragment) in enumerate((
        ("/markets", "markets/universe"),
        ("/proofs", "coherence/certificate"),
        ("/diffusion", "diffusion/arm"),
    )):
        bot.sent.clear()
        bot._rate_windows.clear()
        await bot.handle_update(update(command, update_id=91_020 + offset))
        buttons = [button for row in bot.keyboards[-1]["inline_keyboard"] for button in row]
        links = [button["url"] for button in buttons if "url" in button]
        assert links == [f"https://desk.test/#{fragment}"]
        assert f"<code>#{fragment}</code>" in bot.last


def test_web_view_button_rejects_insecure_or_credentialled_urls():
    markup = kb([[("Markets", cb("markets"))]])
    with pytest.raises(ValueError, match="HTTPS"):
        add_url_row(markup, "Open web view", "http://desk.test/#markets/universe")
    with pytest.raises(ValueError, match="credentials"):
        add_url_row(markup, "Open web view", "https://user:secret@desk.test/#markets/universe")


def test_new_engine_command_sources_contain_no_http_client_or_emoji():
    files = [Path(snapshot_module.__file__), Path(tabs_engine.__file__)]
    source = "\n".join(path.read_text() for path in files)
    assert "httpx" not in source and "requests." not in source
    assert not any(0x1F000 <= ord(character) <= 0x1FAFF for character in source)
