"""The warm snapshot: what it serves, what it refuses, and what it never hides.

The promise this module makes to the desk is "a read answers in milliseconds and
the data is as fresh as the cadence, never fresher". Both halves are testable and
both are here, because the second half is the one that would rot quietly: a cache
that keeps serving after the refresher dies is faster and wrong, and nothing
about the response would say so.
"""

from __future__ import annotations

import asyncio
import pathlib
import time
from types import SimpleNamespace

import pytest

from modules.coherence import tunables, warm
from modules.coherence.kernel.certificate import Certificate
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


class TestTheWarmRefresherKeepsTheGatewayResponsive:
    @staticmethod
    def _arrange_pass(monkeypatch, solve):
        observation = SimpleNamespace(
            event=SimpleNamespace(
                event_ticker="KXTEST-1", series_ticker="KXTEST", exchange_index=0,
            ),
            notes=[],
        )

        async def observe(*_args, **_kwargs):
            return [observation]

        async def schedule(*_args, **_kwargs):
            return object()

        async def no_combo_listing(*_args, **_kwargs):
            raise ValueError("no combo listing in this focused pass")

        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXTEST",))
        monkeypatch.setattr(warm, "observe_series", observe)
        monkeypatch.setattr(warm.fee_meta, "schedule_for_event", schedule)
        monkeypatch.setattr(warm, "event_view", lambda _observation: {
            "event_ticker": "KXTEST-1",
            "series_ticker": "KXTEST",
            "title": "Test event",
            "mutually_exclusive": True,
            "exchange_index": 0,
            "markets": [],
        })
        monkeypatch.setattr(warm, "certify", solve)

        from modules.coherence.syscalls import combos
        monkeypatch.setattr(combos, "fetch_listing", no_combo_listing)

    @pytest.mark.asyncio
    async def test_the_warm_solve_and_proof_render_run_off_the_event_loop(self, monkeypatch):
        def solve(*_args, **_kwargs):
            time.sleep(0.15)
            return Certificate(
                verdict="coherent", engine="highs", component_id="KXTEST-1",
                series_ticker="KXTEST", exchange_index=0,
            )

        self._arrange_pass(monkeypatch, solve)
        started = time.perf_counter()
        task = asyncio.create_task(warm.refresh_once(object()))

        await asyncio.sleep(0.02)

        assert time.perf_counter() - started < 0.10, "the warm solver blocked the gateway event loop"
        assert not task.done(), "the blocking stand-in should still be running in its worker"
        assert await task == 2  # one certificate and its same-observation universe

    @pytest.mark.asyncio
    async def test_a_failed_warm_solve_leaves_the_last_good_certificate_held(self, monkeypatch):
        old = _certificate("KXTEST-1")
        old_taken = time.time_ns() - 1_000_000
        key = warm.snapshot_key("certify", event_ticker="KXTEST-1", max_contracts=1000)
        warm._store(
            "certify", old, old_taken,
            event_ticker="KXTEST-1", max_contracts=1000,
        )

        def fail(*_args, **_kwargs):
            raise ValueError("solver refused this refresh")

        self._arrange_pass(monkeypatch, fail)
        assert await warm.refresh_once(object()) == 1  # universe only

        held = warm._CACHE[key]
        assert held.value is old
        assert held.taken_at_ns == old_taken


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
        # An AGE, computed here against the clock that took the reading — never
        # a timestamp the reader's machine would have to subtract from its own.
        assert answer.observed_age_s is not None
        assert answer.observed_age_s == pytest.approx(0, abs=1.0)

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


class TestTheColdCertificateRouteKeepsTheGatewayResponsive:
    @staticmethod
    def _slow_solver(monkeypatch, delay_s: float):
        from modules.api import coherence as route

        observation = SimpleNamespace(
            event=SimpleNamespace(event_ticker="KXTEST-1", series_ticker="KXTEST", exchange_index=0),
        )

        async def observe(*_args, **_kwargs):
            return observation

        async def schedule(*_args, **_kwargs):
            return object()

        def solve(*_args, **_kwargs):
            time.sleep(delay_s)
            return Certificate(
                verdict="coherent", engine="highs", component_id="KXTEST-1",
                series_ticker="KXTEST", exchange_index=0,
            )

        monkeypatch.setattr(route, "observe_event", observe)
        monkeypatch.setattr(route.fee_meta, "schedule_for_event", schedule)
        monkeypatch.setattr(route, "certify", solve)
        return route

    @pytest.mark.asyncio
    async def test_the_scipy_solve_runs_off_the_event_loop(self, monkeypatch):
        route = self._slow_solver(monkeypatch, 0.15)
        started = time.perf_counter()
        task = asyncio.create_task(route.coherence_certify("KXTEST-1", 1000, "test"))

        await asyncio.sleep(0.02)

        assert time.perf_counter() - started < 0.10, "the solver blocked the gateway event loop"
        assert not task.done(), "the blocking stand-in should still be running in its worker"
        answer = await task
        assert answer.verdict == "coherent"

    @pytest.mark.asyncio
    async def test_a_solver_over_the_route_deadline_returns_a_typed_non_verdict(self, monkeypatch):
        route = self._slow_solver(monkeypatch, 0.05)
        monkeypatch.setattr(route, "CERTIFY_SOLVE_DEADLINE_S", 0.01)

        answer = await route.coherence_certify("KXTEST-1", 1000, "test")

        assert answer.verdict == "untestable"
        assert "gateway stayed available" in answer.notes[0]
        await asyncio.sleep(0.06)  # let the cancelled worker finish before monkeypatch restores the seam

    @pytest.mark.asyncio
    async def test_the_shell_certificate_uses_the_same_non_blocking_solver_boundary(self, monkeypatch):
        from modules.api import coherence as route
        from modules.api import coherence_lab as lab

        observation = SimpleNamespace(event=SimpleNamespace(
            event_ticker="KXTEST-1", series_ticker="KXTEST", exchange_index=0,
        ))

        async def schedule(*_args, **_kwargs):
            return object()

        def solve(*_args, **_kwargs):
            time.sleep(0.15)
            return Certificate(
                verdict="coherent", engine="highs", component_id="KXTEST-1",
                series_ticker="KXTEST", exchange_index=0,
            )

        monkeypatch.setattr(lab.fee_meta, "schedule_for_event", schedule)
        monkeypatch.setattr(route, "certify", solve)
        task = asyncio.create_task(lab._certificate_for(
            [observation], "/shards/0/KXTEST/KXTEST-1/certificate",
        ))

        await asyncio.sleep(0.02)

        assert not task.done(), "the Shell solver blocked or completed on the event loop"
        assert (await task).verdict == "coherent"

    @pytest.mark.asyncio
    async def test_a_consumed_proxy_budget_starts_no_solver_work(self, monkeypatch):
        from modules.api import coherence as route

        class ConsumedBudget:
            def remaining_s(self):
                return route.CERTIFY_RESPONSE_MARGIN_S

        observation = SimpleNamespace(event=SimpleNamespace(
            event_ticker="KXTEST-1", series_ticker="KXTEST", exchange_index=0,
        ))
        monkeypatch.setattr(route, "current_request_budget", lambda: ConsumedBudget())
        monkeypatch.setattr(route, "certify", lambda *_args, **_kwargs: pytest.fail("solver started"))

        answer = await route.bounded_certify(observation, object())

        assert answer.verdict == "untestable"
        assert "gateway stayed available" in answer.notes[0]


class TestTheWarmSetMatchesWhatTheDeskAsksFor:
    """The one failure mode that is silent in both directions.

    A route serves a snapshot only when the request's parameters match the
    refresher's, which is right — a universe of two events is a DIFFERENT answer
    from one of six, not a staler one. But the two numbers are written in two
    languages: the refresher's in `warm.py`, the desk's in
    `web/lib/coherence/routes.ts`. Move either and the refresher fills a cache
    nobody reads: every request goes to the venue, the latency comes back, and
    every test in this file still passes because the cache still works.

    So this reads the TypeScript. It is the only assertion here that leaves
    Python, and it is the only one that could catch that.
    """

    @staticmethod
    def _desk_default(name: str) -> int:
        import re

        routes = pathlib.Path(__file__).resolve().parents[1] / "web/lib/coherence/routes.ts"
        text = routes.read_text(encoding="utf-8")
        # The FIRST parameter's default, however many follow it. This read
        # `\(\w+ = (\d+)\)` until `combosRoute` gained a `ticker` argument, and
        # then matched nothing — which failed the test rather than passing it,
        # so the guard reported a drift it had merely stopped being able to see.
        # That is the right way round for a guard to break.
        found = re.search(rf"export const {name} = \(\w+ = (\d+)[,)]", text)
        assert found, f"{name} is not declared the way this test reads it: {routes}"
        return int(found.group(1))

    def test_the_universe_event_count_agrees_with_the_desk(self):
        assert warm.WARM_MAX_EVENTS == self._desk_default("universeRoute"), (
            "the refresher warms a universe the desk never asks for, so every "
            "universe read goes to the venue and nothing says so"
        )

    def test_the_parlay_limit_agrees_with_the_desk(self):
        assert warm.WARM_COMBOS_LIMIT == self._desk_default("combosRoute"), (
            "the refresher warms a parlay count the desk never asks for, so the "
            "slowest route on the tab stays slow and nothing says so"
        )
