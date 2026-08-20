"""The on-call rota: a grammar, a resolver, and the hour it would have missed.

E2.10 ships a mechanism, not a roster — an empty `DATA_ONCALL` is a supported
state. So most of these are about the cases a rota gets wrong quietly: a night
shift's tail, a week that wraps, a typo'd entry, and nobody being on at all.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from modules.oncall import oncall_at, parse_entry, parse_rota, rota_health

# 2026-08-17 is a Monday, which every date below is anchored to.
MON, TUE, FRI, SAT, SUN = 17, 18, 21, 22, 23


def at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, day, hour, minute)


class TestTheGrammar:
    def test_a_plain_entry_parses(self):
        entry = parse_entry("mei@mon-fri=09:00-18:00")
        assert entry.valid and entry.who == "mei"
        assert entry.days == frozenset({0, 1, 2, 3, 4})

    def test_a_comma_list_of_days(self):
        assert parse_entry("ravi@sat,sun=00:00-23:59").days == frozenset({5, 6})

    def test_a_day_range_may_wrap_the_week(self):
        # `fri-mon` is a real weekend rota and must not parse as an empty set.
        assert parse_entry("w@fri-mon=00:00-23:59").days == frozenset({4, 5, 6, 0})

    @pytest.mark.parametrize("expression", [
        "mei@funday=09:00-18:00",
        "@mon-fri=09:00-18:00",
        "mei@mon-fri",
        "mei@mon-fri=09:00",
        "mei@mon-fri=25:00-26:00",
        "mei@mon-fri=9-18",
    ])
    def test_a_malformed_entry_is_invalid_and_says_why(self, expression):
        entry = parse_entry(expression)
        assert not entry.valid
        assert entry.error, "an invalid entry with no reason is unfixable"

    def test_an_invalid_entry_is_kept_rather_than_dropped(self):
        """A rota that silently discards the broken line pages nobody."""
        rota = parse_rota("mei@mon-fri=09:00-18:00;ravi@funday=00:00-23:59")
        assert len(rota) == 2
        health = rota_health(rota, at(MON, 10))
        assert health["valid"] == 1
        assert health["invalid"][0]["raw"] == "ravi@funday=00:00-23:59"
        # And the good entry still works.
        assert health["on_call"] == "mei"


class TestWhoIsOn:
    ROTA = "mei@mon-fri=09:00-18:00;ravi@sat,sun=00:00-23:59"

    def test_inside_the_window(self):
        assert oncall_at(parse_rota(self.ROTA), at(MON, 10)) == "mei"

    def test_the_weekend_entry(self):
        assert oncall_at(parse_rota(self.ROTA), at(SAT, 12)) == "ravi"

    def test_outside_every_window_is_nobody(self):
        # Monday 03:00 is covered by neither entry, and "nobody" is the honest
        # answer — naming somebody who is not on call is the failure that makes
        # a rota worse than none.
        assert oncall_at(parse_rota(self.ROTA), at(MON, 3)) is None

    def test_order_is_precedence(self):
        rota = parse_rota("first@mon-fri=09:00-18:00;second@mon-fri=09:00-18:00")
        assert oncall_at(rota, at(MON, 10)) == "first"

    def test_an_empty_rota_names_nobody(self):
        assert oncall_at(parse_rota(""), at(MON, 10)) is None
        assert oncall_at(parse_rota(None), at(MON, 10)) is None


class TestTheNightShift:
    """The wrapped window, which is where a rota is most likely to be wrong.

    `mon-fri=22:00-06:00` means Monday through Friday NIGHTS. Matching the
    calendar day of the moment gets this backwards: it covers Monday 03:00 —
    which is Sunday night, a night the entry does not name — and leaves
    Saturday 03:00 uncovered, which is Friday's shift and the single hour a
    weekday rota most needs to reach.
    """

    ROTA = parse_rota("night@mon-fri=22:00-06:00")

    def test_the_shift_starts_on_a_named_day(self):
        assert oncall_at(self.ROTA, at(MON, 23)) == "night"

    def test_the_tail_belongs_to_the_night_that_began_it(self):
        assert oncall_at(self.ROTA, at(TUE, 3)) == "night"

    def test_friday_night_reaches_into_saturday(self):
        assert oncall_at(self.ROTA, at(SAT, 3)) == "night", (
            "this is the hour the naive calendar-day test drops"
        )

    def test_sunday_night_is_not_covered(self):
        assert oncall_at(self.ROTA, at(MON, 3)) is None, (
            "this is the hour the naive calendar-day test wrongly covers"
        )

    def test_saturday_evening_is_not_covered(self):
        assert oncall_at(self.ROTA, at(SAT, 23)) is None

    def test_the_gap_between_shifts(self):
        assert oncall_at(self.ROTA, at(TUE, 12)) is None


class TestWhatTheOpsSurfaceSees:
    def test_an_unset_rota_reports_itself_rather_than_erroring(self):
        health = rota_health(parse_rota(""))
        assert health["configured"] is False
        assert health["entries"] == 0
        assert health["on_call"] is None

    def test_a_configured_rota_names_who_is_on(self):
        health = rota_health(parse_rota("mei@mon-fri=09:00-18:00"), at(MON, 10))
        assert health["configured"] is True
        assert health["on_call"] == "mei"

    def test_invalid_entries_are_named_not_counted(self):
        health = rota_health(parse_rota("broken@nope=1-2"), at(MON, 10))
        assert health["invalid"] and "raw" in health["invalid"][0], (
            "a count sends somebody to read the whole variable; the raw line "
            "sends them to the typo"
        )


class TestTheWebhookChannel:
    @pytest.mark.asyncio
    async def test_an_unset_url_is_not_a_delivery(self):
        from modules.oncall import post_webhook

        assert await post_webhook("", {"any": "payload"}) is False

    @pytest.mark.asyncio
    async def test_a_refusal_never_raises(self, monkeypatch):
        """The sync round trip that opened the escalation must not fail here."""
        import httpx

        from modules import oncall

        class Refusing:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_a):
                return False

            async def post(self, *_a, **_k):
                raise httpx.ConnectError("no route to host")

        monkeypatch.setattr(httpx, "AsyncClient", lambda **_k: Refusing())
        assert await oncall.post_webhook("https://example.invalid/hook", {}) is False

    @pytest.mark.asyncio
    async def test_a_4xx_is_reported_as_not_delivered(self, monkeypatch):
        import httpx

        from modules import oncall

        class Rejecting:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_a):
                return False

            async def post(self, *_a, **_k):
                return httpx.Response(403, request=httpx.Request("POST", "https://x"))

        monkeypatch.setattr(httpx, "AsyncClient", lambda **_k: Rejecting())
        assert await oncall.post_webhook("https://example.invalid/hook", {}) is False
