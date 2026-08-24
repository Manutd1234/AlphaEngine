"""What a watched series is ABOUT, and the three ways that could go wrong.

The Universe section cuts its families by asset type, and the whole value of
that cut is that the label is the exchange's own. ``KXBTCD`` means Crypto
because ``GET /series/KXBTCD`` says ``"category": "Crypto"`` — not because the
ticker looks like it. So the tests here are about the reader's trust in the
label rather than about the HTTP call: a category is never invented, a series
the venue will not answer for is absent rather than defaulted, and the read
happens once per series rather than once per poll against a token bucket the
engine already rations.
"""

from __future__ import annotations

import pytest

from modules.coherence.drivers.kalshi_rest import KalshiUnavailable
from modules.coherence.series_meta import (
    categories_for,
    forget_categories,
    parse_category,
)


@pytest.fixture(autouse=True)
def _clean_cache():
    """The cache is process-lifetime by design, so one test must not seed another."""
    forget_categories()
    yield
    forget_categories()


class FakeClient:
    """Counts reads, so "once per series" is measured rather than asserted."""

    def __init__(self, categories: dict[str, str], refuse: set[str] | None = None):
        self._categories = categories
        self._refuse = refuse or set()
        self.reads: list[str] = []

    async def series(self, ticker: str):
        self.reads.append(ticker)
        if ticker in self._refuse:
            raise KalshiUnavailable(f"{ticker} is not published")

        class Fetched:
            payload = {"series": {"ticker": ticker, "category": self._categories.get(ticker, "")}}

        return Fetched()


class TestTheLabelIsTheExchangesOwn:
    def test_reads_the_category_field_and_nothing_else(self):
        assert parse_category({"series": {"category": "Climate and Weather"}}) == "Climate and Weather"
        # Some payloads arrive unwrapped; both shapes are the same fact.
        assert parse_category({"category": "Crypto"}) == "Crypto"

    @pytest.mark.parametrize(
        "payload",
        [None, {}, {"series": {}}, {"series": {"category": None}}, {"series": {"category": "   "}}, {"series": []}],
        ids=["none", "empty", "no-field", "null", "blank", "not-an-object"],
    )
    def test_an_absent_category_is_empty_never_guessed(self, payload):
        """Empty means "this read did not carry one".

        The one thing that must not happen is a plausible default: "Other" or a
        prefix guess reads as a fact about the contract and is a fact about our
        code. The surface groups the absences and says how many.
        """
        assert parse_category(payload) == ""


class TestOncePerSeriesForTheLifeOfTheProcess:
    @pytest.mark.asyncio
    async def test_a_second_call_reads_nothing(self):
        client = FakeClient({"KXBTCD": "Crypto", "KXHIGHNY": "Climate and Weather"})
        first = await categories_for(client, ["KXBTCD", "KXHIGHNY"])
        assert first == {"KXBTCD": "Crypto", "KXHIGHNY": "Climate and Weather"}
        assert sorted(client.reads) == ["KXBTCD", "KXHIGHNY"]

        again = await categories_for(client, ["KXBTCD", "KXHIGHNY"])
        assert again == first
        assert len(client.reads) == 2, "a poll re-read a category that cannot have changed"

    @pytest.mark.asyncio
    async def test_a_repeated_ticker_in_one_call_is_read_once(self):
        """Every EVENT of a series carries that series' ticker.

        The caller passes one ticker per event, so a four-event watchlist over
        two series would otherwise spend four requests to learn two strings.
        """
        client = FakeClient({"KXBTCD": "Crypto"})
        result = await categories_for(client, ["KXBTCD", "KXBTCD", "KXBTCD"])
        assert result == {"KXBTCD": "Crypto"}
        assert client.reads == ["KXBTCD"]


class TestAVenueThatWillNotAnswer:
    @pytest.mark.asyncio
    async def test_a_refused_series_is_absent_and_does_not_raise(self):
        """A missing category must never fail the universe read around it.

        The families still price; they are simply grouped as uncategorised. And
        the failure is not cached as an empty string, so a later poll can still
        pick the label up.
        """
        client = FakeClient({"KXBTCD": "Crypto"}, refuse={"KXNOPE"})
        result = await categories_for(client, ["KXBTCD", "KXNOPE"])
        assert result == {"KXBTCD": "Crypto"}
        assert "KXNOPE" not in result

        client._refuse = set()
        client._categories["KXNOPE"] = "Economics"
        recovered = await categories_for(client, ["KXBTCD", "KXNOPE"])
        assert recovered["KXNOPE"] == "Economics", "a refusal was cached as a permanent absence"

    @pytest.mark.asyncio
    async def test_a_series_answering_with_no_category_is_left_out(self):
        client = FakeClient({"KXBTCD": "Crypto", "KXBLANK": ""})
        result = await categories_for(client, ["KXBTCD", "KXBLANK"])
        assert result == {"KXBTCD": "Crypto"}

    @pytest.mark.asyncio
    async def test_an_empty_watchlist_reads_nothing(self):
        client = FakeClient({})
        assert await categories_for(client, []) == {}
        assert client.reads == []
