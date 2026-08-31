"""``observe`` and the views: what one poll sees, and how it is said.

Everything here runs against recorded payloads through an injected transport,
so the whole path — client, parser, kernel, view — is the real code and only
the exchange is substituted. That is the seam the house doctrine asks for: a
stand-in for our own modules would let both sides agree about a fiction.
"""

from __future__ import annotations

import httpx
import pytest
from coherence_fixtures import body, markets

from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.scheduler.budget import ReadBudget
from modules.coherence.syscalls.observe import observe_event, observe_series
from modules.coherence.views import UNQUOTED_BOTH_SIDES, UNQUOTED_ONE_SIDE, book_view, event_view

EVENT = "KXHIGHNY-26AUG23"


def _ladder_event() -> dict:
    """The ladder markets, shaped as a nested-markets event response.

    Composed in memory from two recorded payloads rather than captured as a
    third: both halves are real, and writing a file into the fixture directory
    at test time leaves a stray behind whenever a run is interrupted.
    """
    return {
        "event": {
            "event_ticker": EVENT,
            "series_ticker": "KXHIGHNY",
            "title": "Highest temperature in NYC today",
            "mutually_exclusive": True,
            "exchange_index": 0,
            "settlement_sources": [{"name": "The Weather Company", "url": "https://weather.com/kalshi"}],
            "markets": markets("markets_ladder"),
        },
        # The empty outer list the real response also carries — see
        # tests/test_coherence_kalshi_parse.py for why it matters.
        "markets": [],
    }


def _transport(orderbook_status: int = 200) -> httpx.MockTransport:
    """The exchange, as recorded. ``orderbook_status`` forces the 401 path."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "/markets/orderbooks" in path:
            if orderbook_status != 200:
                return httpx.Response(orderbook_status, json={"error": "unauthorized"})
            return httpx.Response(200, json=body("orderbook_bulk"))
        if path.startswith("/trade-api/v2/events/"):
            return httpx.Response(200, json=_ladder_event())
        return httpx.Response(404, json={"error": "unexpected path in test"})

    return httpx.MockTransport(handler)


def _client(orderbook_status: int = 200) -> KalshiClient:
    return KalshiClient(transport=_transport(orderbook_status), budget=ReadBudget())


class TestOneObservation:
    @pytest.mark.anyio
    async def test_reads_every_open_market_and_its_book(self):
        observation = await observe_event(_client(), EVENT)
        assert observation.complete
        assert len(observation.markets) == 6
        assert observation.depth == "full"

    @pytest.mark.anyio
    async def test_a_refused_orderbook_degrades_to_top_of_book_and_says_so(self):
        """Kalshi's own documents disagree about whether this route needs a key.

        When it refuses, the market object's top-of-book fields are still
        public — so the engine keeps working, at a depth it declares, rather
        than reporting an outage.
        """
        observation = await observe_event(_client(orderbook_status=401), EVENT)
        assert observation.depth == "top_of_book"
        assert observation.markets, "the fallback produced no books at all"
        assert any("cannot answer a depth question" in note for note in observation.notes)
        assert not observation.complete, "a degraded read must not report itself complete"


class TestOneSeries:
    @pytest.mark.anyio
    async def test_a_filesystem_read_can_require_every_event_while_other_callers_keep_partial_results(self, monkeypatch):
        good = await observe_event(_client(), EVENT)

        class Client:
            async def markets(self, *_args, **_kwargs):
                return type("Read", (), {
                    "payload": {
                        "markets": [
                            {"event_ticker": "GOOD"},
                            {"event_ticker": "REFUSED"},
                        ]
                    }
                })()

        async def read_event(_client, event_ticker):
            if event_ticker == "REFUSED":
                raise KalshiUnavailable("read budget exhausted")
            return good

        monkeypatch.setattr("modules.coherence.syscalls.observe.observe_event", read_event)

        assert await observe_series(Client(), "SERIES") == [good]
        with pytest.raises(KalshiUnavailable, match="REFUSED: read budget exhausted"):
            await observe_series(Client(), "SERIES", require_complete=True)

    @pytest.mark.anyio
    async def test_a_filesystem_read_refuses_a_series_cut_off_by_its_event_cap(self, monkeypatch):
        class Client:
            async def markets(self, *_args, **_kwargs):
                return type("Read", (), {
                    "payload": {"markets": [{"event_ticker": "ONE"}, {"event_ticker": "TWO"}]}
                })()

        async def read_event(_client, _event_ticker):
            pytest.fail("a strict capped listing spent an event read before refusing")

        monkeypatch.setattr("modules.coherence.syscalls.observe.observe_event", read_event)

        with pytest.raises(KalshiUnavailable, match="2 open events; a complete read is capped at 1"):
            await observe_series(Client(), "SERIES", max_events=1, require_complete=True)

    @pytest.mark.anyio
    async def test_a_filesystem_read_refuses_an_event_missing_an_open_market_book(self, monkeypatch):
        incomplete = await observe_event(_client(), EVENT)
        incomplete.markets.pop()

        class Client:
            async def markets(self, *_args, **_kwargs):
                return type("Read", (), {"payload": {"markets": [{"event_ticker": EVENT}]}})()

        async def read_event(_client, _event_ticker):
            return incomplete

        monkeypatch.setattr("modules.coherence.syscalls.observe.observe_event", read_event)

        missing_ticker = incomplete.event.markets[-1].ticker
        with pytest.raises(KalshiUnavailable, match=f"missing open-market books for {missing_ticker}"):
            await observe_series(Client(), "SERIES", require_complete=True)

    @pytest.mark.anyio
    async def test_a_filesystem_read_accepts_top_of_book_when_every_market_path_is_present(self, monkeypatch):
        degraded = await observe_event(_client(orderbook_status=401), EVENT)

        class Client:
            async def markets(self, *_args, **_kwargs):
                return type("Read", (), {"payload": {"markets": [{"event_ticker": EVENT}]}})()

        async def read_event(_client, _event_ticker):
            return degraded

        monkeypatch.setattr("modules.coherence.syscalls.observe.observe_event", read_event)

        assert await observe_series(Client(), "SERIES", require_complete=True) == [degraded]

    @pytest.mark.anyio
    async def test_a_filesystem_read_refuses_a_markets_listing_with_an_unread_page(self, monkeypatch):
        complete = await observe_event(_client(), EVENT)

        class Client:
            async def markets(self, *_args, **_kwargs):
                return type("Read", (), {
                    "payload": {"markets": [{"event_ticker": EVENT}], "cursor": "NEXT"}
                })()

        async def read_event(_client, _event_ticker):
            return complete

        monkeypatch.setattr("modules.coherence.syscalls.observe.observe_event", read_event)

        with pytest.raises(KalshiUnavailable, match="listing has another page"):
            await observe_series(Client(), "SERIES", require_complete=True)
        assert await observe_series(Client(), "SERIES") == [complete]


class TestWhatTheDeskIsTold:
    @pytest.mark.anyio
    async def test_the_basket_total_is_stated_for_a_mutually_exclusive_event(self):
        view = event_view(await observe_event(_client(), EVENT))
        assert view.mutually_exclusive
        assert view.yes_ask_total is not None
        assert view.basket_note

    @pytest.mark.anyio
    async def test_each_side_is_totalled_independently(self):
        """A tail leg with an ask and no bid must not blind the buy-side test.

        This is the common shape, not a corner case: nobody bids for the market
        that will not happen, but it is offered at a cent. Requiring both sides
        would suppress the Dutch-book test on exactly those events.
        """
        view = event_view(await observe_event(_client(), EVENT))
        assert view.yes_ask_total is not None, "the buy side was answerable and was not answered"
        assert view.yes_bid_total is None, "the recorded book has an unquoted YES bid; the fixture changed"
        assert "cannot be sold as a whole" in view.basket_note

    @pytest.mark.anyio
    async def test_an_unquoted_side_is_named_rather_than_shown_as_zero(self):
        view = event_view(await observe_event(_client(), EVENT))
        unquoted = [market for market in view.markets if market.unquoted_reason]
        assert unquoted, "the recorded ladder has one-sided markets; the fixture changed"
        assert all(market.yes_bid is None for market in unquoted)
        assert all(market.unquoted_reason == UNQUOTED_ONE_SIDE for market in unquoted)

    @pytest.mark.anyio
    async def test_a_book_view_carries_both_sides_of_the_lesson_zero_identity(self):
        """The pane shows the identity rather than asserting it."""
        observation = await observe_event(_client(), EVENT)
        quoted = next(item for item in observation.markets if item.book.spread is not None)
        view = book_view(quoted.book, source="test")
        assert view.identity_sum == view.identity_one_plus_spread
        assert view.yes_asks, "the implied ask ladder is what a reader cannot see on Kalshi"

    def test_a_completely_unquoted_book_says_which_kind_of_empty_it_is(self):
        from modules.coherence.kernel.book import parse_orderbook

        view = book_view(parse_orderbook("NOBODY", {"yes_dollars": [], "no_dollars": []}), source="test")
        assert view.unquoted_reason == UNQUOTED_BOTH_SIDES
        assert view.spread is None
        assert view.identity_sum is None


@pytest.fixture
def anyio_backend():
    return "asyncio"
