"""The rule that decides a measure has really moved.

A chat app cannot hold a socket open to a reader, so "live" here is a PUSH. The
hard part is not delivery — `_watch_loop` already existed — it is deciding when
a move is real, because a subscriber notified every time a price wobbles across
a threshold mutes the bot, which makes the feature worth less than nothing.

Same asymmetry as `DeskSourceMachine` and `VenueLiveness` on the web side, and
for the same reason those two exist: a state derived from the LAST SAMPLE
oscillates. Falling quiet is immediate — a sample back inside the band clears
the streak where it stands, and so does one that moved the other way. Pushing is
not: the move must sit past the band, in the SAME direction, for
`STREAM_CONFIRMATIONS` consecutive samples. A value wobbling across the boundary
therefore never accumulates a streak, so one straggling tick can never fire.

A push re-bases the reference, so a drift is reported once per band it crosses
rather than once per tick outside one.

An unmeasurable sample is neither a move nor a settling: it clears the streak,
because a gap is not evidence the move persisted. After two consecutive blind
samples the chat is told the measurement is missing, with the last pushed value
dashed — never zeroed.

Its own module, not a mixin: it holds no I/O, takes its clock by injection, and
is therefore drivable by a fake clock with no bot, no chat and no network — the
only way the oscillation above is testable at all.
"""

from __future__ import annotations

import time

from modules.telegram.format import _finite


class SettledMove:
    """One subscription's opinion of whether its measure has really moved.

    Deliberately not a coroutine and not bound to the bot — it holds no I/O, so
    a test drives it with a scripted list of samples and a clock it owns. Same
    argument `DeskSourceMachine` makes for being a class rather than a hook.
    `observe` decides; the tick loop only renders what comes back.

    ``band`` is a fraction: relative to the reference for a price or a money
    figure, which is scale-free, and absolute for a measure that is already a
    ratio, where a percentage POINT is what a reader means by "moved".
    """

    def __init__(self, *, band, relative=True, confirmations=2, cooldown_s=120.0, now=time.monotonic) -> None:
        self.band, self.relative = abs(float(band)), bool(relative)
        self.confirmations, self.cooldown_s, self._now = max(1, int(confirmations)), max(0.0, float(cooldown_s)), now
        #: The value this chat was last told. None until the first reading,
        #: which anchors it — an anchor is not a move and never pushes.
        self.reference: float | None = None
        self.streak = self.direction = self.blind = self.pushes = 0
        self.blind_reported = False
        self.last_push_at: float | None = None

    def _cooling(self) -> bool:
        return self.last_push_at is not None and (self._now() - self.last_push_at) < self.cooldown_s

    def _fire(self, kind: str, previous: float | None, current: float | None) -> tuple:
        self.streak = self.direction = 0
        self.last_push_at = self._now()
        self.pushes += 1
        return (kind, previous, current)

    def _missing(self) -> tuple | None:
        """A sample that could not be read. Clears the streak, reports once."""
        self.streak = self.direction = 0
        self.blind += 1
        if self.blind < self.confirmations or self.blind_reported or self._cooling():
            return None
        self.blind_reported = True
        return self._fire("blind", self.reference, None)

    def observe(self, value) -> tuple | None:
        """One sample. ``(kind, previous, current)`` when the chat should hear."""
        reading = _finite(value)
        if reading is None:
            return self._missing()
        self.blind, self.blind_reported = 0, False
        if self.reference is None:
            self.reference = reading
            return None
        move = abs(reading - self.reference)
        if self.relative:
            move = (move / abs(self.reference)) if self.reference else (0.0 if move == 0 else float("inf"))
        if move < self.band:
            # Immediate, and the mirror of `VenueLiveness` re-arming its stale
            # mark on every silent tick: one sample back inside the band ends
            # the candidate move, so a wobble can never reach the streak.
            self.streak = self.direction = 0
            return None
        direction = 1 if reading > self.reference else -1
        self.streak, self.direction = (self.streak + 1 if direction == self.direction else 1), direction
        if self.streak < self.confirmations or self._cooling():
            return None
        previous, self.reference = self.reference, reading
        return self._fire("move", previous, reading)
