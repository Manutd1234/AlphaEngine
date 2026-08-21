"""``/track`` — the streaming approximation, and the pushes it sends.

Split out of ``_mixins/subscriptions.py``. That file owns WHO may be delivered
to (the subscriber map, the authorisation, the alert opt-in); this one owns WHEN
a measure has moved enough to be worth interrupting someone for. The rule itself
is `modules/telegram/settled_move.py` — a class with an injected clock and no
I/O — and this mixin is the thin part that reads the desk and renders the card.

Deliberately NOT a second delivery path. It rides the existing 20s
``_watch_loop`` via one ``await self._stream_tick()``; there is no second task,
no second scheduler and no second dedupe. Two delivery paths that could disagree
about who is subscribed is the defect this arrangement refuses.
"""

from __future__ import annotations

import logging
import time

from config import settings
from modules.telegram.format import _finite, _money, _number, _percent, esc, text_card
from modules.telegram.settled_move import (
    SettledMove,
)

log = logging.getLogger("alphaengine.telegram")


class StreamingMixin:
    #: The two bounds. Per chat is a REFUSAL — a reader who has filled their
    #: slots chooses which to drop, rather than having one silently dropped for
    #: them. Across chats it is an EVICTION, oldest first: a map keyed by
    #: whoever has ever typed /track and cleared by nothing is a leak, which is
    #: the defect `modules/data_scheduler.py` was found carrying.
    STREAM_MAX_PER_CHAT, STREAM_MAX_CHATS = 6, 64
    #: The clock every machine reads. An attribute so a test can replace it on
    #: the instance and drive the cooldown without waiting.
    _stream_now = staticmethod(time.monotonic)


    @property
    def _streams(self) -> dict[str, dict[str, SettledMove]]:
        """chat_id -> target -> machine, built on first use.

        In memory and lost on restart, like `_live_feeds` and for the same
        reason: a hysteresis streak carried across a restart would be evidence
        about a desk that is no longer running. /tracking says so out loud.
        """
        streams = getattr(self, "_stream_state", None)
        if streams is None:
            streams = self._stream_state = {}
        return streams

    def _stream_reading(self, target: str) -> float | None:
        """What ``target`` reads right now, or None when it cannot be read."""
        if target == "drawdown":
            return self._risk_observations().get("daily_drawdown")
        if target in {"equity", "gross"}:
            state = self.gateway.state() if self.gateway else None
            return _finite(getattr(state, "equity" if target == "equity" else "gross_exposure", None))
        return self.tca.consolidated_mid(target) if self.tca else None

    def _stream_format(self, target: str, value) -> str:
        kind = self.STREAM_MEASURES.get(target, ("", "price", True))[1]
        return _money(value) if kind == "money" else _percent(value) if kind == "percent" else _number(value, 4)

    def _stream_label(self, target: str) -> str:
        return self.STREAM_MEASURES.get(target, (target,))[0]

    def _stream_target(self, args, *, tracked_only: bool = True) -> str:
        raw = str(args[0]).strip().lower() if args else ""
        if raw in self.STREAM_MEASURES:
            return raw
        symbol = self._symbol(args)
        if tracked_only and symbol not in [tracked.upper() for tracked in settings.symbols]:
            raise ValueError(f"track a tracked instrument, or one of: {', '.join(self.STREAM_MEASURES)}")
        return symbol

    async def _cmd_track(self, args, chat_id, actor) -> None:
        target = self._stream_target(args)
        move_pct = _finite(args[1]) if len(args) > 1 else self.STREAM_DEFAULT_MOVE_PCT
        if move_pct is None or not self.STREAM_MIN_MOVE_PCT <= move_pct <= self.STREAM_MAX_MOVE_PCT:
            raise ValueError(f"move must be between {self.STREAM_MIN_MOVE_PCT:g}% and {self.STREAM_MAX_MOVE_PCT:g}%")
        # A push is an alert, so it needs the same delivery grant /watch takes.
        self._subscribe(chat_id, actor, alerts=True)
        streams = self._streams.setdefault(str(chat_id), {})
        if target not in streams and len(streams) >= self.STREAM_MAX_PER_CHAT:
            raise ValueError(f"this chat already tracks {self.STREAM_MAX_PER_CHAT} measures; /untrack one first")
        while len(self._streams) > self.STREAM_MAX_CHATS:
            stale = next(chat for chat in self._streams if chat != str(chat_id))
            self._streams.pop(stale, None)
            log.warning("telegram streams: chat %s evicted at %d tracking chats; its move pushes stop until it tracks again", stale, self.STREAM_MAX_CHATS)
        machine = SettledMove(band=move_pct / 100.0, relative=self.STREAM_MEASURES.get(target, ("", "", True))[2], confirmations=self.STREAM_CONFIRMATIONS, cooldown_s=self.STREAM_COOLDOWN_S, now=self._stream_now)
        machine.observe(self._stream_reading(target))  # the first reading anchors; it never pushes
        streams[target] = machine
        await self.send_message(chat_id, text_card(f"📈 {esc(self._stream_label(target))} tracked", "PUSH ON A SETTLED MOVE" if machine.reference is not None else "TRACKED · NOT MEASURABLE YET", [f"Band <code>{move_pct:g}%</code> from <code>{self._stream_format(target, machine.reference)}</code>", f"A push needs <code>{self.STREAM_CONFIRMATIONS}</code> consecutive readings past that band in one direction — a wobble across it sends nothing.", f"Then at most one every <code>{self.STREAM_COOLDOWN_S:g}s</code>, measured from the value last pushed.", f"Stop it with <code>/untrack {esc(target)}</code>."], source="Consolidated mid / gateway risk state, checked every 20s", next_commands="/watches · /subscriptions · /live on"))

    async def _cmd_untrack(self, args, chat_id, actor) -> None:
        streams = self._streams.get(str(chat_id), {})
        # Not `tracked_only`: an instrument dropped from the deployment's list
        # must still be removable by the chat that is still being pushed it.
        target = self._stream_target(args, tracked_only=False) if args else ""
        removed = int(streams.pop(target, None) is not None) if target else len(streams)
        if not target:
            streams.clear()
        if not streams:
            self._streams.pop(str(chat_id), None)
        await self.send_message(chat_id, text_card("📈 Tracked measures", "UPDATED", [f"Removed <code>{removed}</code> tracked measure(s).", f"Still tracked <code>{len(streams)}</code>"], source="Telegram move stream", next_commands="/watches · /subscriptions"))

    async def _cmd_tracking(self, args, chat_id, actor) -> None:
        streams = self._streams.get(str(chat_id), {})
        if not streams:
            await self.send_message(chat_id, text_card("📈 Tracked measures", "NONE", ["Nothing in this chat is pushed on a move.", "Start one with <code>/track BTCUSDT 0.5</code> or <code>/track drawdown 0.5</code>."], source="Telegram move stream", next_commands="/watches · /subscriptions · /live on"))
            return
        lines = [f"{'▲' if machine.direction > 0 else '▼' if machine.direction < 0 else '●'} <b>{esc(self._stream_label(target))}</b> · band <code>{machine.band * 100:g}%</code> · last pushed <code>{self._stream_format(target, machine.reference)}</code> · now <code>{self._stream_format(target, self._stream_reading(target))}</code> · pushes <code>{machine.pushes}</code>" for target, machine in streams.items()]
        lines.append(f"A push needs <code>{self.STREAM_CONFIRMATIONS}</code> consecutive samples past the band and <code>{self.STREAM_COOLDOWN_S:g}s</code> since the last one. Nothing here survives a gateway restart.")
        await self.send_message(chat_id, text_card("📈 Tracked measures", "PUSH ON A SETTLED MOVE", lines, source="Consolidated mid / gateway risk state", next_commands="/watches · /subscriptions · /live on"))

    async def _stream_tick(self) -> None:
        """One pass over every tracked measure, inside `_watch_tick`'s own loop.

        No second scheduler, no second dedupe and no second delivery queue:
        `_watch_loop` already wakes every 20 seconds, `SettledMove` is the
        dedupe, `_delivery_allowed` already re-checks the allow-list and
        `alerts_sent` already counts what went out.
        """
        for chat_id, streams in list(self._streams.items()):
            if not self._delivery_allowed(chat_id):
                # The disposal `_live_tick` already makes: a chat that may not
                # be delivered to holds no subscription, and keeping it is how
                # an in-memory map only ever grows.
                self._streams.pop(chat_id, None)
                continue
            for target, machine in list(streams.items()):
                verdict = machine.observe(self._stream_reading(target))
                if verdict is not None:
                    await self.send_message(chat_id, self._stream_card(target, machine, verdict))
                    self.alerts_sent += 1

    def _stream_card(self, target: str, machine: SettledMove, verdict) -> str:
        kind, previous, current = verdict
        label = self._stream_label(target)
        chain = "/refresh · /risk · /thresholds" if target in self.STREAM_MEASURES else f"/book {target} · /liquidity {target}"
        if kind == "blind":
            return text_card(f"⚠️ {esc(label)} unmeasurable", "MEASUREMENT MISSING", [f"No reading for <code>{machine.confirmations}</code> consecutive checks.", f"Last pushed <code>{self._stream_format(target, previous)}</code>", "This is not <i>unchanged</i>: the measure could not be read at all, and those are different facts."], source="Telegram move stream", next_commands=chain)
        delta = current - previous
        size = (abs(delta) / abs(previous)) if machine.relative and previous else abs(delta)
        return text_card(f"{'▲' if delta > 0 else '▼'} {esc(label)} moved", "SETTLED MOVE", [f"From <code>{self._stream_format(target, previous)}</code> to <code>{self._stream_format(target, current)}</code>", f"Move <code>{(size if delta > 0 else -size) * 100:+.2f}%</code> against a <code>{machine.band * 100:g}%</code> band", f"Confirmed by <code>{machine.confirmations}</code> consecutive readings past it — not one tick."], source="Consolidated mid / gateway risk state", next_commands=chain)
