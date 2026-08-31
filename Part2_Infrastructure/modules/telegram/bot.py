"""``TelegramBot`` — one class, assembled from the mixins in this package.

It has to be one class. `_dispatch` looks a handler up by string name off
`COMMAND_SPECS` (``getattr(self, spec.handler)``), every ``_cmd_*`` calls
`self.send_message` and `self._authorised`, and `tests/test_telegram_commands.py`
asserts ``hasattr`` on this class for every handler named in the registry. What
the split buys is that each *file* is one concern; what it must not cost is the
single object those concerns share.

The bases are listed in the order the original file defined them, so the MRO
matches the old top-to-bottom class body exactly.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Any

import httpx

from config import settings
from modules.telegram._mixins import (
    ActivityMixin,
    AlertsMixin,
    AllocationMixin,
    AnalyticsMixin,
    CoherenceTabMixin,
    CompareMixin,
    ControlsMixin,
    CostsMixin,
    DataOpsMixin,
    DeliveryMixin,
    DesksMixin,
    DeveloperMixin,
    EngineTabsMixin,
    EssentialsMixin,
    FoldsMixin,
    LinkingMixin,
    LiveMixin,
    MarketMixin,
    MicrostructureMixin,
    MonteCarloMixin,
    OrdersMixin,
    ParsingMixin,
    PortfolioMixin,
    PreviewMixin,
    ReliabilityMixin,
    ResearchDetailMixin,
    ResearchMixin,
    RiskDriversMixin,
    RiskMixin,
    ScenarioReportMixin,
    ScenariosMixin,
    ServicesMixin,
    StreamingMixin,
    SubscriptionsMixin,
    TabsMixin,
    TabsOpsMixin,
)
from modules.telegram.auth import AuthMixin
from modules.telegram.dispatch import DispatchMixin
from modules.telegram.registry import COMMAND_SPECS
from modules.telegram.runtime import RuntimeMixin
from modules.telegram.send import SendMixin
from modules.telegram.transport import TransportMixin


class TelegramBot(
    TransportMixin,
    SendMixin,
    RuntimeMixin,
    AuthMixin,
    DispatchMixin,
    ParsingMixin,
    LinkingMixin,
    EssentialsMixin,
    TabsMixin,
    TabsOpsMixin,
    CoherenceTabMixin,
    EngineTabsMixin,
    PortfolioMixin,
    MarketMixin,
    ControlsMixin,
    RiskMixin,
    ScenariosMixin,
    MicrostructureMixin,
    OrdersMixin,
    ResearchMixin,
    FoldsMixin,
    AnalyticsMixin,
    CostsMixin,
    AllocationMixin,
    MonteCarloMixin,
    DataOpsMixin,
    ReliabilityMixin,
    DeveloperMixin,
    CompareMixin,
    StreamingMixin,
    SubscriptionsMixin,
    AlertsMixin,
    LiveMixin,
    DeliveryMixin,
    # Web-parity mixins (2026-08-21): one per web rail section that had no
    # Telegram equivalent. Appended rather than interleaved so the original
    # MRO order is untouched.
    ActivityMixin,
    PreviewMixin,
    DesksMixin,
    RiskDriversMixin,
    ScenarioReportMixin,
    ResearchDetailMixin,
    ServicesMixin,
):
    def __init__(self, gateway=None, tca=None, queue=None, audit=None) -> None:
        self.gateway = gateway
        self.tca = tca
        self.queue = queue
        self.audit = audit
        self.token = settings.telegram_bot_token
        self.base = f"{settings.telegram_api_base}/bot{self.token}"
        self.mode = settings.resolved_telegram_mode
        self._client: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._watch_task: asyncio.Task | None = None
        self._offset = 0
        self._seen_updates: set[int] = set()
        self._seen_update_order: deque[int] = deque(maxlen=2048)
        self._rate_windows: dict[str, deque[float]] = {}
        # Outbound pacing. In-process and lost on restart, like the challenge
        # dict and the dedup ring — a deploy simply starts the clock again.
        self._next_global_send = 0.0
        self._next_chat_send: dict[str, float] = {}
        # Pending control confirmations, keyed by user. Single-use and
        # time-boxed — see `_issue_challenge`. In-process on purpose: a restart
        # invalidating every pending kill-switch confirmation is the safe
        # direction to fail.
        self._challenges: dict[str, dict[str, Any]] = {}
        # Telegram user ids with a live web binding, and when that set was last
        # read from the audit store. A cache, never a record: the binding itself
        # is persisted, and this is dropped whenever one is written.
        self._bound_users: set[str] = set()
        self._bound_users_read_at: float | None = None
        self.links_completed = 0
        self.me: dict[str, Any] | None = None
        self.started_at: float | None = None
        self.updates_handled = 0
        self.callbacks_handled = 0
        self.last_error: str | None = None
        #: What kind of failure `last_error` is, for a reader who may not see
        #: the text: "transport" (the request never got an answer), "conflict"
        #: (Telegram refused getUpdates because another process holds the long
        #: poll for this token), or "api" (Telegram answered, and said no).
        self.last_error_kind: str | None = None
        self._watch_state: dict[tuple[str, str], bool] = {}
        #: Per-rule breach state for the pushed risk alerts. Edge-triggered like
        #: the liquidity watch above: a rule sitting on its threshold sends one
        #: message, not one every tick.
        self._risk_state: dict[str, bool] = {}
        #: Monotonic deadline for the next VaR evaluation. VaR needs a bar
        #: fetch per held symbol, which must not run at the alert interval.
        self._risk_var_due: float = 0.0
        self._risk_task: asyncio.Task | None = None
        #: chat_id -> {message_id, started}. Deliberately in memory: a live feed
        #: edits a message that exists in one chat right now, and a restart has
        #: already broken that contract whatever a database says. /live reports
        #: this rather than pretending the feed survived.
        self._live_feeds: dict[str, dict[str, Any]] = {}
        self._live_task: asyncio.Task | None = None
        self.alerts_sent = 0

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    @property
    def allowed_user_ids(self) -> list[str]:
        return list(settings.telegram_allowed_user_ids)

    @property
    def control_user_ids(self) -> list[str]:
        return list(settings.telegram_control_user_ids)

    def _may_control(self, user_id: str) -> bool:
        """
        Reading the book must not imply being able to stop the desk.

        Fails closed on an empty list, like the read allow-list — an
        unconfigured deployment has a reporting bot, not a dormant kill switch
        waiting for someone to guess a command.

        One list, read once, and no second grant: `_authorised` gained a web
        binding as an alternative source of *read* rights, and this function
        deliberately did not. Whatever else changes about who may read this
        book, changing who may stop it stays an edit to
        ``TELEGRAM_CONTROL_USER_IDS`` by someone with deploy access.

        ``user_id`` is a bare numeric id. Callers holding a composite actor must
        put it through `actor_user_id` first.
        """
        return bool(self.control_user_ids) and user_id in self.control_user_ids


    def health(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "username": (self.me or {}).get("username"),
            "updates_handled": self.updates_handled,
            # Inline keyboards and callback queries are served; every button
            # resolves to a registered typed command, and controls are excluded
            # except a confirmation carrying a live, single-use code.
            "interactive": True,
            "callbacks_handled": self.callbacks_handled,
            "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else 0.0,
            "alert_targets": len(self._alert_targets()),
            "subscribers": len(self._subscribers()),
            "watches": sum(len(subscriber.get("watches", [])) for subscriber in self._subscribers()),
            "alerts_sent": self.alerts_sent,
            "allowlist_configured": bool(self.allowed_user_ids),
            # These two read `True` for a long time after they stopped being
            # true: /halt, /resume and /flatten mutate risk state, and the
            # chart commands send photos. A health endpoint that misreports the
            # blast radius of its own commands is worse than one that omits it,
            # so the shape now describes what the bot can actually do.
            "read_only": False,
            "text_only": False,
            "controls": {
                # Derived from the registry, because the hard-coded 3 this
                # replaces went on reading 3 for two whole controls after
                # /reduceonly and /resetbook shipped.
                "commands": sum(1 for spec in COMMAND_SPECS if spec.category == "Controls"),
                "gated": True,
                "control_allowlist_configured": bool(self.control_user_ids),
            },
            # Counts and contract only — never which account is bound to which
            # chat. This endpoint is proxied to a public web origin, and the
            # binding is the one genuinely personal fact this module holds.
            "links": {
                "configured": settings.telegram_link_enabled,
                "bound_users": len(self._bound_user_ids()),
                "completed": self.links_completed,
                "grants": "read-parity-with-a-web-desk-pass",
                # Stated as a field because `read_only` above is the cautionary
                # tale: a contract nobody can assert drifts silently. The
                # controls read TELEGRAM_CONTROL_USER_IDS and nothing else.
                "grants_control": False,
            },
            "charts": "real-data-only",
            "last_error": self.last_error,
            "last_error_kind": self.last_error_kind,
        }
