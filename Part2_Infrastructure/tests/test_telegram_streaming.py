"""The streaming approximation: a push on a settled move, never on a twitch.

Telegram cannot hold a socket open to a reader, so "live" over chat is a push —
and a push that fires whenever a price wobbles across a threshold is worse than
no feature at all, because the reader mutes the bot and loses the alerts that
were already working.

`SettledMove` is the rule that prevents it, and this file is the evidence. It
is the Python half of the argument `web/tests/venue-liveness.test.ts` and
`desk-source.test.ts` make: the oscillation is three lines to reproduce against
a clock the test owns, and it was unreachable while the decision lived inside a
loop that slept.

Four properties, in order: no push on a twitch, a push on a settled move, one
subscription's state cannot move another's, and the bounds hold.
"""

from __future__ import annotations

import pytest
from conftest import deep_book
from test_telegram import CHAT, USER

from config import settings
from modules.telegram.settled_move import SettledMove

ACTOR = f"tg:{USER}:operator"
OTHER = "54321"


class FakeClock:
    """The clock, owned by the test. Injected exactly as `DeskSourceMachine`'s is."""

    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def machine(**overrides) -> SettledMove:
    """A 1 % band, two confirmations, no cooldown unless a test asks for one."""
    return SettledMove(**{"band": 0.01, "confirmations": 2, "cooldown_s": 0.0, **overrides})


def prices(bot, mid: float) -> None:
    """Move the consolidated mid the way a venue would."""
    bot.tca.feeds["TEST"].books["BTCUSDT"] = deep_book(mid=mid)


def pushes(bot, needle: str = "<code>SETTLED MOVE</code>") -> int:
    """Cards whose STATUS is the one named — the /track card advertises the rule
    in its own status line, and counting that as a push would prove nothing."""
    return sum(needle in message for message in bot.sent)


# --------------------------------------------------------------------------- #
# 1. No push on a twitch
# --------------------------------------------------------------------------- #


def test_a_wobble_across_the_band_never_pushes():
    """The exact failure mode: a value oscillating either side of the boundary.

    Ten crossings of a 1 % band, alternating. Every one of them clears the
    threshold and not one of them is a move, because none survives the next
    sample — which is the whole difference between a threshold and a rule.
    """
    rule = machine()
    assert rule.observe(100.0) is None, "the first reading anchors, it does not push"
    for _ in range(10):
        assert rule.observe(101.5) is None
        assert rule.observe(100.0) is None
    assert rule.pushes == 0
    assert rule.reference == 100.0, "the reference is what the reader was last told"


def test_one_straggling_sample_past_the_band_is_not_a_move():
    """The single late frame `VenueLiveness` refuses to be promoted by."""
    rule = machine()
    rule.observe(100.0)
    assert rule.observe(102.0) is None
    assert rule.streak == 1 and rule.pushes == 0


def test_a_reversal_restarts_the_streak_rather_than_continuing_it():
    """Two samples past the band in OPPOSITE directions are not a confirmation."""
    rule = machine()
    rule.observe(100.0)
    assert rule.observe(102.0) is None   # up, streak 1
    assert rule.observe(98.0) is None    # past the band, but the other way
    assert rule.streak == 1
    assert rule.observe(97.9)[0] == "move", "two consecutive down samples settle it"


def test_a_missing_sample_neither_confirms_a_move_nor_settles_one():
    """A gap in the data is not evidence that the move persisted."""
    rule = machine()
    rule.observe(100.0)
    assert rule.observe(101.5) is None   # streak 1
    assert rule.observe(None) is None    # unmeasurable: the streak is cleared
    assert rule.streak == 0
    assert rule.observe(101.6) is None, "the streak starts again, it does not resume"
    assert rule.observe(101.7)[0] == "move"


# --------------------------------------------------------------------------- #
# 2. A push on a settled move
# --------------------------------------------------------------------------- #


def test_a_settled_move_pushes_once_and_rebases_the_reference():
    rule = machine()
    rule.observe(100.0)
    assert rule.observe(101.5) is None
    verdict = rule.observe(101.6)
    assert verdict == ("move", 100.0, 101.6)
    assert rule.reference == 101.6 and rule.streak == 0
    # Sitting still at the new level is not a second move.
    for _ in range(5):
        assert rule.observe(101.6) is None
    assert rule.pushes == 1


def test_a_drift_is_reported_once_per_band_it_crosses():
    """Not once per tick spent outside one — that is the same spam, slower."""
    rule = machine()
    rule.observe(100.0)
    verdicts = [rule.observe(100.0 + step * 0.4) for step in range(1, 16)]
    assert [v for v in verdicts if v], "a real drift must be reported"
    # 6 % of drift, sampled fifteen times. Each push costs the band plus the
    # confirmations that follow it — about 1.6 % — so three is the arithmetic,
    # and the number that matters is that it is not fifteen.
    assert rule.pushes == 3, f"6 % of drift across a 1 % band pushed {rule.pushes} times"


def test_the_cooldown_holds_a_settled_move_until_it_lapses():
    clock = FakeClock()
    rule = machine(cooldown_s=120.0, now=clock)
    rule.observe(100.0)
    rule.observe(101.5)
    assert rule.observe(101.6)[0] == "move"
    rule.observe(103.0)
    assert rule.observe(103.2) is None, "a real move, but inside the cooldown"
    assert rule.streak >= 2, "the streak is held, not thrown away"
    clock.advance(121.0)
    assert rule.observe(103.3)[0] == "move", "the push follows once the floor lapses"


def test_consecutive_blind_samples_are_reported_once_per_episode():
    """Silence and "nothing moved" are indistinguishable, and different facts."""
    rule = machine()
    rule.observe(100.0)
    assert rule.observe(None) is None
    assert rule.observe(None) == ("blind", 100.0, None)
    for _ in range(5):
        assert rule.observe(None) is None, "one report, not one a tick"
    rule.observe(100.0)
    rule.observe(None)
    assert rule.observe(None)[0] == "blind", "a new outage is a new episode"


def test_an_absolute_band_measures_percentage_points():
    """A measure that is already a ratio moves in points, not in per cent of itself."""
    rule = machine(band=0.005, relative=False)
    rule.observe(0.01)
    assert rule.observe(0.014) is None, "0.4 points is inside a 0.5 point band"
    rule.observe(0.02)
    assert rule.observe(0.021)[0] == "move"


def test_a_zero_reference_does_not_divide_by_zero():
    rule = machine()
    rule.observe(0.0)
    assert rule.observe(5.0) is None
    assert rule.observe(6.0)[0] == "move"


# --------------------------------------------------------------------------- #
# 3. Per-subscription isolation, through the real delivery path
# --------------------------------------------------------------------------- #


async def test_track_anchors_on_the_live_mid_without_pushing(bot):
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    assert "PUSH ON A SETTLED MOVE" in bot.last
    assert bot._streams[CHAT]["BTCUSDT"].reference == pytest.approx(100.0)
    assert pushes(bot) == 0
    # A push is an alert, so tracking registers the chat for delivery.
    assert bot._delivery_allowed(CHAT) is True


async def test_the_watch_loop_pushes_on_a_settled_move_and_not_on_a_twitch(bot):
    """End to end on the loop that already exists — no second scheduler."""
    bot._stream_now = FakeClock()
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    bot.sent.clear()

    for mid in (101.5, 100.0, 101.5, 100.0, 101.5, 100.0):
        prices(bot, mid)
        await bot._watch_tick()
    assert pushes(bot) == 0, "six crossings of the band, none of them settled"

    for mid in (101.5, 101.6):
        prices(bot, mid)
        await bot._watch_tick()
    assert pushes(bot) == 1
    assert "▲" in bot.last and "+1.60%" in bot.last and "1%</code> band" in bot.last


async def test_two_subscriptions_keep_their_own_state(bot):
    """Same instrument, two chats, two bands. Neither machine sees the other."""
    bot._stream_now = FakeClock()
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    await bot._cmd_track(["BTCUSDT", "5"], OTHER, ACTOR)
    bot.sent.clear()

    for mid in (101.5, 101.6):
        prices(bot, mid)
        await bot._watch_tick()

    assert pushes(bot) == 1, "the 1 % subscription pushed; the 5 % one had nothing to say"
    assert bot._streams[CHAT]["BTCUSDT"].reference == pytest.approx(101.6)
    assert bot._streams[OTHER]["BTCUSDT"].reference == pytest.approx(100.0)
    assert bot._streams[OTHER]["BTCUSDT"].pushes == 0


async def test_a_second_measure_in_one_chat_is_not_moved_by_the_first(bot):
    bot._stream_now = FakeClock()
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    await bot._cmd_track(["equity", "1"], CHAT, ACTOR)
    bot.sent.clear()

    for mid in (101.5, 101.6):
        prices(bot, mid)
        await bot._watch_tick()

    assert pushes(bot) == 1, "the price moved; the book did not"
    assert bot._streams[CHAT]["equity"].pushes == 0


async def test_an_unmeasurable_measure_says_so_rather_than_going_quiet(bot):
    """The null discipline, pushed: a missing reading is not a flat one."""
    bot._stream_now = FakeClock()
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    bot.sent.clear()
    bot.tca.feeds["TEST"].books.clear()

    for _ in range(4):
        await bot._watch_tick()

    assert pushes(bot, "<code>MEASUREMENT MISSING</code>") == 1
    assert "could not be read" in bot.last
    assert pushes(bot) == 0, "an outage is never rendered as a move"


async def test_a_revoked_chat_is_dropped_from_the_map_and_pushed_nothing(bot):
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    bot.sent.clear()
    settings.telegram_allowed_user_ids[:] = ["88"]

    prices(bot, 105.0)
    await bot._watch_tick()
    await bot._watch_tick()

    assert bot.sent == []
    assert bot._streams == {}, "a chat that may not be delivered to holds no subscription"


# --------------------------------------------------------------------------- #
# 4. The bounds
# --------------------------------------------------------------------------- #


async def test_the_per_chat_cap_refuses_rather_than_dropping_one_silently(bot):
    bot.STREAM_MAX_PER_CHAT = 2
    await bot._cmd_track(["BTCUSDT"], CHAT, ACTOR)
    await bot._cmd_track(["ETHUSDT"], CHAT, ACTOR)
    with pytest.raises(ValueError, match="already tracks"):
        await bot._cmd_track(["SOLUSDT"], CHAT, ACTOR)
    assert set(bot._streams[CHAT]) == {"BTCUSDT", "ETHUSDT"}
    # Re-tracking something already tracked re-bands it rather than being refused.
    await bot._cmd_track(["BTCUSDT", "2"], CHAT, ACTOR)
    assert bot._streams[CHAT]["BTCUSDT"].band == pytest.approx(0.02)


async def test_the_chat_map_evicts_the_oldest_rather_than_growing_forever(bot):
    """The `modules/data_scheduler.py` defect, refused here by construction."""
    bot.STREAM_MAX_CHATS = 2
    for chat in ("100", "200", "300"):
        await bot._cmd_track(["BTCUSDT"], chat, ACTOR)
    assert list(bot._streams) == ["200", "300"]
    assert len(bot._streams) <= bot.STREAM_MAX_CHATS


async def test_the_shipped_bounds_are_finite_and_stated(bot):
    assert (bot.STREAM_MAX_PER_CHAT, bot.STREAM_MAX_CHATS) == (6, 64)
    assert bot.STREAM_CONFIRMATIONS == 2 and bot.STREAM_COOLDOWN_S == 120.0
    with pytest.raises(ValueError, match="move must be between"):
        await bot._cmd_track(["BTCUSDT", "0"], CHAT, ACTOR)
    with pytest.raises(ValueError, match="move must be between"):
        await bot._cmd_track(["BTCUSDT", "nan"], CHAT, ACTOR)
    with pytest.raises(ValueError):
        await bot._cmd_track(["DOGEUSDT"], CHAT, ACTOR)


# --------------------------------------------------------------------------- #
# The three commands
# --------------------------------------------------------------------------- #


async def test_tracking_reports_the_rule_the_band_and_the_reading(bot):
    await bot._cmd_tracking([], CHAT, ACTOR)
    assert "NONE" in bot.last
    await bot._cmd_track(["BTCUSDT", "1"], CHAT, ACTOR)
    await bot._cmd_tracking([], CHAT, ACTOR)
    assert "BTCUSDT" in bot.last and "1%" in bot.last and "100.0000" in bot.last
    assert "consecutive samples" in bot.last and "120s" in bot.last


async def test_untrack_removes_one_or_all_and_empties_the_map(bot):
    await bot._cmd_track(["BTCUSDT"], CHAT, ACTOR)
    await bot._cmd_track(["equity"], CHAT, ACTOR)
    await bot._cmd_untrack(["BTCUSDT"], CHAT, ACTOR)
    assert set(bot._streams[CHAT]) == {"equity"}
    await bot._cmd_untrack([], CHAT, ACTOR)
    assert CHAT not in bot._streams
    await bot._cmd_untrack(["BTCUSDT"], CHAT, ACTOR)
    assert "Removed <code>0</code>" in bot.last, "removing nothing says so"


async def test_a_missing_reading_at_subscribe_time_is_not_reported_as_a_value(bot):
    bot.tca.feeds["TEST"].books.clear()
    await bot._cmd_track(["BTCUSDT"], CHAT, ACTOR)
    assert "NOT MEASURABLE YET" in bot.last
    assert "<code>—</code>" in bot.last, "a missing measurement is dashed, never zeroed"
