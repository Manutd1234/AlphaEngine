"""The warm snapshot: what it serves, what it refuses, and what it never hides.

The promise this module makes to the desk is "a read answers in milliseconds and
the data is as fresh as the cadence, never fresher". Both halves are testable and
both are here, because the second half is the one that would rot quietly: a cache
that keeps serving after the refresher dies is faster and wrong, and nothing
about the response would say so.
"""

from __future__ import annotations

import time

import pytest

from modules.coherence import tunables, warm
from modules.schemas import CoherenceCertificate


@pytest.fixture(autouse=True)
def _clean_cache():
    warm.forget_snapshots()
    yield
    warm.forget_snapshots()


def _certificate(ticker: str) -> CoherenceCertificate:
    return CoherenceCertificate(
        verdict="coherent", engine="highs", component_id=ticker,
        series_ticker="KXTEST", exchange_index=0,
    )


class TestTheKeyIsBuiltInOnePlace:
    def test_the_same_key_comes_from_the_route_and_the_refresher(self):
        # Two spellings of a key are two things to keep in agreement, and the
        # first time they drift the refresher fills a cache nobody reads: every
        # request goes to the venue, the latency returns, every test stays green.
        assert warm.snapshot_key("certify", event_ticker="A", max_contracts=1000) == \
            warm.snapshot_key("certify", max_contracts=1000, event_ticker="A")

    def test_different_families_do_not_collide(self):
        assert warm.snapshot_key("certify", event_ticker="A") != \
            warm.snapshot_key("certify", event_ticker="B")


class TestAnAnswerIsServedOnlyWhileItIsWorthServing:
    def test_nothing_is_served_when_the_refresher_is_off(self, monkeypatch):
        # The default shape: a fresh clone answers exactly as it did before this
        # module existed, and every route reads live.
        monkeypatch.setattr(tunables, "WARM_SECONDS", 0)
        warm._store("certify", _certificate("A"), time.time_ns(), event_ticker="A")
        assert warm.snapshot_for("certify", event_ticker="A") is None

    def test_a_fresh_entry_is_served(self, monkeypatch):
        monkeypatch.setattr(tunables, "WARM_SECONDS", 20)
        monkeypatch.setattr(tunables, "WARM_MAX_AGE_S", 0)
        warm._store("certify", _certificate("A"), time.time_ns(), event_ticker="A")
        held = warm.snapshot_for("certify", event_ticker="A")
        assert held is not None
        assert held.value.component_id == "A"

    def test_a_stale_entry_is_refused_so_the_route_reads_live(self, monkeypatch):
        # THE HALF THAT WOULD ROT QUIETLY. A refresher that died an hour ago must
        # not keep answering with an hour-old ladder; the route falls through and
        # pays the venue, which is slow and true.
        monkeypatch.setattr(tunables, "WARM_SECONDS", 20)
        monkeypatch.setattr(tunables, "WARM_MAX_AGE_S", 0)
        old = time.time_ns() - 61 * 1_000_000_000  # older than 3 x 20s
        warm._store("certify", _certificate("A"), old, event_ticker="A")
        assert warm.snapshot_for("certify", event_ticker="A") is None

    def test_the_max_age_is_three_cadences_unless_set(self, monkeypatch):
        monkeypatch.setattr(tunables, "WARM_SECONDS", 20)
        monkeypatch.setattr(tunables, "WARM_MAX_AGE_S", 0)
        assert warm.max_age_s() == 60
        monkeypatch.setattr(tunables, "WARM_MAX_AGE_S", 5)
        assert warm.max_age_s() == 5


class TestAgeIsTheBooksAgeNotTheRequests:
    def test_age_grows_with_the_clock(self):
        taken = time.time_ns() - 7 * 1_000_000_000
        assert warm.Snapshot(value=None, taken_at_ns=taken).age_s() == pytest.approx(7, abs=0.5)

    def test_a_missing_pass_reports_no_age_rather_than_zero(self):
        # Null is never coerced to zero. "The refresher has not run" and "the
        # data is current" are opposite claims and must not share a number.
        state = warm.warm_state().to_dict()
        assert state["seconds_since_last_pass"] is None


class TestARefresherThatIsNotConfiguredDoesNothing:
    @pytest.mark.asyncio
    async def test_the_loop_returns_immediately_with_no_cadence(self, monkeypatch):
        monkeypatch.setattr(tunables, "WARM_SECONDS", 0)
        await warm.warm_loop()          # returns rather than sleeping forever
        assert warm.warm_state().passes == 0

    @pytest.mark.asyncio
    async def test_the_loop_returns_immediately_with_no_watchlist(self, monkeypatch):
        monkeypatch.setattr(tunables, "WARM_SECONDS", 20)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ())
        await warm.warm_loop()
        assert warm.warm_state().passes == 0

    @pytest.mark.asyncio
    async def test_a_pass_with_no_watchlist_stores_nothing(self, monkeypatch):
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ())
        assert await warm.refresh_once(object()) == 0


class TestTheRouteDoesNotTouchTheVenueWhenAnAnswerIsHeld:
    @pytest.mark.asyncio
    async def test_certify_answers_from_the_snapshot_without_a_client(self, monkeypatch):
        # THE TEST THE WHOLE MODULE IS FOR. A warm route must not call Kalshi at
        # all — not "quickly", not "once" — so the client is replaced with one
        # that fails the test if it is constructed.
        from modules.api import coherence as route

        monkeypatch.setattr(tunables, "WARM_SECONDS", 20)
        monkeypatch.setattr(tunables, "WARM_MAX_AGE_S", 0)

        def _refuse(*args, **kwargs):
            raise AssertionError("a warm certify reached for the exchange")

        monkeypatch.setattr(route, "KalshiClient", _refuse)
        taken = time.time_ns()
        warm._store("certify", _certificate("KXTEST-1"), taken,
                    event_ticker="KXTEST-1", max_contracts=1000)

        answer = await route.coherence_certify(
            event_ticker="KXTEST-1", max_contracts=1000, _actor="test",
        )
        assert answer.component_id == "KXTEST-1"
        assert answer.observed_at == taken

    @pytest.mark.asyncio
    async def test_a_family_outside_the_warm_set_still_falls_through(self, monkeypatch):
        # A miss is not an error. An off-watchlist family answers live, exactly
        # as it did before any of this existed.
        from modules.api import coherence as route

        monkeypatch.setattr(tunables, "WARM_SECONDS", 20)
        reached = {"live": False}

        def _mark(*args, **kwargs):
            reached["live"] = True
            raise RuntimeError("stop here")

        monkeypatch.setattr(route, "KalshiClient", _mark)
        with pytest.raises(RuntimeError):
            await route.coherence_certify(
                event_ticker="NOT-WARMED", max_contracts=1000, _actor="test",
            )
        assert reached["live"], "the route answered without reading, for a family it never warmed"
