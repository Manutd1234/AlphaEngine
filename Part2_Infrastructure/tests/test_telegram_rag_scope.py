"""Telegram recall obeys the same tenant rollout boundary as HTTP recall."""

from __future__ import annotations

import pytest
from test_telegram import CHAT

import modules.research_quota_scope as scope_module
import modules.research_rag as rag_package


class Corpus:
    def __init__(self) -> None:
        self.scopes: list[str | None] = []

    async def search(self, query: str, match_count: int = 3, desk_id: str | None = None):
        self.scopes.append(desk_id)
        return {"state": "ok", "matches": []}


@pytest.mark.asyncio
async def test_rag_command_passes_the_configured_desk_when_scoping_is_on(bot, monkeypatch):
    corpus = Corpus()
    monkeypatch.setattr(rag_package, "get_rag", lambda: corpus)
    monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
    monkeypatch.setattr(
        scope_module, "settings", type("Scoped", (), {"supabase_desk_id": "desk-telegram"})(),
    )

    await bot._cmd_rag(["momentum", "drawdown"], CHAT, "operator")

    assert corpus.scopes == ["desk-telegram"]


@pytest.mark.asyncio
async def test_rag_command_refuses_when_scope_is_on_but_desk_is_missing(bot, monkeypatch):
    corpus = Corpus()
    monkeypatch.setattr(rag_package, "get_rag", lambda: corpus)
    monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
    monkeypatch.setattr(scope_module, "settings", type("Unscoped", (), {"supabase_desk_id": ""})())

    await bot._cmd_rag(["momentum", "drawdown"], CHAT, "operator")

    assert corpus.scopes == []
    assert "SCOPE UNAVAILABLE" in bot.last
    assert "No corpus search was run" in bot.last


@pytest.mark.asyncio
async def test_rag_command_preserves_unscoped_rollout_behavior_when_flag_is_off(bot, monkeypatch):
    corpus = Corpus()
    monkeypatch.setattr(rag_package, "get_rag", lambda: corpus)
    monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", False)

    await bot._cmd_rag(["momentum", "drawdown"], CHAT, "operator")

    assert corpus.scopes == [None]
