"""The on-call rota: a grammar, a resolver, and the hour it would have missed.

E2.10 ships a mechanism, not a roster — an empty `DATA_ONCALL` is a supported
state. So most of these are about the cases a rota gets wrong quietly: a night
shift's tail, a week that wraps, a typo'd entry, and nobody being on at all.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from modules.oncall import oncall_at, oncall_snapshot, parse_entry, parse_rota, rota_health

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


class TestTheRedactedSnapshot:
    """`oncall_snapshot` is the shape `/api/ops/snapshot` may carry.

    That endpoint has a standing rule against usernames and error strings and
    is readable anonymously wherever auth is off, so the difference between
    this and `rota_health` is the whole point: the same facts, with the
    identity taken out.
    """

    def test_an_unset_rota_is_a_supported_state_not_an_absence(self):
        snapshot = oncall_snapshot("")
        assert snapshot.configured is False
        assert snapshot.entries == 0 and snapshot.covered is False
        assert snapshot.webhook_configured is False

    def test_a_covered_hour_says_covered_without_saying_who(self):
        snapshot = oncall_snapshot("mei@mon-fri=09:00-18:00", when=at(MON, 10))
        assert snapshot.configured is True and snapshot.covered is True
        dumped = snapshot.model_dump_json()
        assert "mei" not in dumped, "a handle is a username and this wire refuses those"

    def test_an_uncovered_hour_of_a_configured_rota_is_not_an_unset_rota(self):
        snapshot = oncall_snapshot("mei@mon-fri=09:00-18:00", when=at(MON, 3))
        assert snapshot.covered is False
        assert snapshot.configured is True and snapshot.entries == 1, (
            "'nobody is on right now' and 'there is no rota' are different "
            "faults and `entries` is what separates them"
        )

    def test_a_broken_entry_is_counted_here_and_named_only_in_rota_health(self):
        expression = "mei@mon-fri=09:00-18:00;ravi@funday=00:00-23:59"
        snapshot = oncall_snapshot(expression, when=at(MON, 10))
        assert (snapshot.entries, snapshot.valid, snapshot.invalid) == (2, 1, 1)
        assert "funday" not in snapshot.model_dump_json()
        # The typo is still findable — in the surface allowed to hold it.
        assert rota_health(parse_rota(expression))["invalid"][0]["raw"].startswith("ravi@")

    def test_the_webhook_url_is_reduced_to_a_boolean_and_never_stored(self):
        """A webhook URL routinely carries a token in its path."""
        url = "https://hooks.example.com/services/T000/B000/abcdefghijklmnop"
        snapshot = oncall_snapshot("", webhook_url=url)
        assert snapshot.webhook_configured is True
        assert "hooks.example.com" not in snapshot.model_dump_json()
        assert "abcdefghijklmnop" not in snapshot.model_dump_json()

    def test_the_two_shapes_are_computed_from_one_call_and_cannot_disagree(self):
        expression = "mei@mon-fri=09:00-18:00;ravi@sat,sun=00:00-23:59"
        moment = at(SAT, 12)
        health = rota_health(parse_rota(expression), moment)
        snapshot = oncall_snapshot(expression, when=moment)
        assert snapshot.entries == health["entries"]
        assert snapshot.valid == health["valid"]
        assert snapshot.invalid == len(health["invalid"])
        assert snapshot.covered is (health["on_call"] is not None)


class TestTheOperationsSnapshotCarriesIt:
    """The gap E2.10 left: a rota that reported itself nowhere.

    A mechanism nobody can see is not a mechanism. These pin the block onto the
    read model the reliability workspace polls, so removing it fails here rather
    than going unnoticed for another release.
    """

    @staticmethod
    def _build(monkeypatch, rota: str, webhook: str = ""):
        from types import SimpleNamespace

        from modules import operations

        monkeypatch.setattr(
            operations,
            "settings",
            SimpleNamespace(
                data_oncall=rota,
                data_ops_webhook_url=webhook,
                environment="test",
                version="0.0.0",
                venue_stale_after_s=5.0,
            ),
        )
        stub = SimpleNamespace(
            health=lambda: {"enabled": False, "feeds": [], "uptime_s": 0.0},
            state=lambda: SimpleNamespace(
                halted_symbols=[], kill_switch_active=False, reduce_only=False,
                orders_accepted=0, orders_rejected=0, working_orders=0,
                orders_last_second=0.0, daily_drawdown_pct=0.0,
                drawdown_budget_used_pct=0.0, equity=0.0, gross_exposure=0.0,
            ),
            stats=lambda: {"backend": "in-process", "workers": 1},
        )
        return operations.build_operations_snapshot(
            tca=stub,
            gateway=stub,
            queue=stub,
            audit=SimpleNamespace(health=lambda: {"backend": "duckdb", "available": True}),
            bot=SimpleNamespace(health=lambda: {"enabled": False}),
        )

    def test_the_rota_block_is_published(self, monkeypatch):
        snapshot = self._build(monkeypatch, "mei@mon-fri=09:00-18:00", "https://hook.invalid/x")
        assert snapshot.oncall is not None, "the rota reported itself nowhere"
        assert snapshot.oncall.entries == 1
        assert snapshot.oncall.webhook_configured is True

    def test_an_empty_roster_still_publishes_the_block(self, monkeypatch):
        """Silence would read as "no rota mechanism", which is the wrong fact."""
        snapshot = self._build(monkeypatch, "")
        assert snapshot.oncall is not None
        assert snapshot.oncall.configured is False

    def test_no_name_reaches_the_frequently_polled_endpoint(self, monkeypatch):
        snapshot = self._build(monkeypatch, "mei@mon-fri=09:00-18:00;broken@funday=1-2")
        assert "mei" not in snapshot.model_dump_json()
        assert "funday" not in snapshot.model_dump_json()

    def test_the_rota_does_not_move_the_platform_status(self, monkeypatch):
        """E2.10 ships the mechanism; the roster is the desk's to fill, and a
        desk that has not filled it is not a desk with a broken gateway. So the
        block is published beside the status ladder rather than inside it."""
        empty = self._build(monkeypatch, "")
        filled = self._build(monkeypatch, "mei@mon-fri=09:00-18:00")
        broken = self._build(monkeypatch, "broken@funday=1-2")
        assert empty.status == filled.status == broken.status


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
