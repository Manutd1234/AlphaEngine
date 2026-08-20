"""Pushed risk alerts: who they reach, and when they fire.

Two properties are worth holding down here, because getting either wrong is
silent. Routing a breach by role must not stop paging a chat that never chose a
role — that is a migration quietly muting someone. And the rules must be
edge-triggered, or a book sitting on its limit sends a message every interval
until somebody mutes the bot, which is the same as having no alerts at all.
"""

from __future__ import annotations

import pytest

from config import settings
from modules.telegram import TelegramBot
from modules.telegram._mixins import alerts as alerts_module


class _Bot(TelegramBot):
    """The bot with its network and its registry replaced by lists."""

    def __init__(self, subscribers):  # noqa: D107 - test double
        self._subs = subscribers
        self.sent: list[str] = []
        self._risk_state = {}
        self._risk_var_due = 0.0
        self.alerts_sent = 0

    def _subscribers(self, *, alerts_only: bool = True):
        return list(self._subs)

    def _delivery_allowed(self, chat_id, *, require_alerts: bool = True) -> bool:
        return True

    def _alert_targets(self):
        return [s["chat_id"] for s in self._subs]

    async def send_message(self, chat_id, message, **kwargs):
        self.sent.append(str(chat_id))


SUBS = [
    {"chat_id": "pm", "role": "pm"},
    {"chat_id": "risk", "role": "risk"},
    {"chat_id": "trader", "role": "trader"},
    {"chat_id": "dev", "role": "dev"},
    {"chat_id": "legacy", "role": None},
    {"chat_id": "blank", "role": ""},
]


def test_a_breach_reaches_the_roles_whose_job_it_is():
    bot = _Bot(SUBS)
    assert bot._risk_alert_targets() == ["pm", "risk", "legacy", "blank"]


def test_a_chat_that_never_chose_a_role_keeps_receiving_everything():
    # The whole point of storing NULL rather than a fifth role: adding this
    # feature must not be the reason someone stops being paged.
    bot = _Bot([{"chat_id": "legacy", "role": None}])
    assert bot._risk_alert_targets() == ["legacy"]


def test_a_configured_escalation_list_is_not_narrowed_by_roles(monkeypatch):
    # A deployment that named its escalation path meant it; a per-chat
    # preference must not quietly override a deployment decision.
    #
    # Settings is a frozen dataclass by design, so the override is a proxy over
    # the real one rather than a mutation of it — the immutability is a feature
    # and a test should not be the thing that proves it can be worked around.
    class _WithEscalation:
        def __getattr__(self, name):
            return getattr(settings, name)

        telegram_alert_chat_ids = ["trader"]

    # `_risk_alert_targets` lives in `modules.telegram._mixins.alerts`, and a
    # `setattr` patch binds to the module object holding the reference. Aimed at
    # the package instead, this would patch a name the function never reads.
    monkeypatch.setattr(alerts_module, "settings", _WithEscalation())
    bot = _Bot(SUBS)
    assert bot._risk_alert_targets() == [s["chat_id"] for s in SUBS]


@pytest.mark.asyncio
async def test_a_rule_on_its_threshold_sends_once_not_every_tick():
    bot = _Bot(SUBS)
    bot._risk_thresholds = lambda: {"daily_drawdown": 0.03}
    bot._risk_observations = lambda: {"daily_drawdown": 0.04}

    await bot._risk_tick()
    await bot._risk_tick()
    await bot._risk_tick()
    assert len(bot.sent) == 4, "one breach message per eligible chat, once"

    # Back under the limit: one recovery, then silence again.
    bot._risk_observations = lambda: {"daily_drawdown": 0.01}
    await bot._risk_tick()
    await bot._risk_tick()
    assert len(bot.sent) == 8


@pytest.mark.asyncio
async def test_a_disabled_rule_and_an_unmeasurable_one_stay_quiet():
    bot = _Bot(SUBS)
    # Zero is off, not "fires at zero".
    bot._risk_thresholds = lambda: {"gross_exposure": 0.0}
    bot._risk_observations = lambda: {"gross_exposure": 5.0}
    await bot._risk_tick()
    assert bot.sent == []

    # None is "cannot measure", which is never a breach — the null-honesty
    # rule, in the one place where coercing to zero would page nobody at all.
    bot._risk_thresholds = lambda: {"daily_drawdown": 0.03}
    bot._risk_observations = lambda: {"daily_drawdown": None}
    await bot._risk_tick()
    assert bot.sent == []
