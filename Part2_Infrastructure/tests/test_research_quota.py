"""The bound in front of the one route that can spend money, and its wiring.

`POST /api/research/rag/ask` reaches a paid model on every graded answer. Until
`modules/research_quota.py` there was nothing between a retry loop and that
model: the gateway's only `TokenBucket` guards the ORDER path, and the token
counts `research_generate` records were written to the ledger and never totalled.

TWO CLAIMS, AND THE SECOND IS THE ONE THAT USUALLY GOES MISSING
---------------------------------------------------------------

That the bound works, and that the bound is WIRED. This repository has a scar
about modules shipping fully tested with no caller — `tests/test_research_contract.py`
is written about it — so `TestTheRouteIsActuallyBounded` drives the real route
through the real `answer_from_corpus`, the real router, the real grader and the
real `research_generate`, and asserts on what came back over HTTP. Only two
things are substituted, both at boundaries their own modules document as test
seams: the Supabase side of the wire (CI is network-free) and the Gemini SDK
(`tests/conftest.py` blanks `GEMINI_API_KEY` on purpose, and a suite that spent
live model calls to prove a spend cap would be a joke with a bill attached).

The spend assertions are computed from the SAME prices the module publishes
rather than from a hard-coded dollar figure: a test that pins 0.0004836 is a
test that fails the day the vendor's list price is corrected, which is a
deployment fact and not a defect.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import research_seam as seam
from fastapi.testclient import TestClient
from test_research_search_route import CORPUS, Corpus, _Settings

import main
import modules.research_generate as gen
import modules.research_quota as rq
import modules.research_rag.writer as rag_module
from modules.research_rag import get_rag, reset_rag

QUERY = "deflated sharpe drawdown sweep"
#: One priced call, from the token counts `research_seam.USAGE` reports.
CALL_USD = (
    seam.USAGE.prompt_token_count * rq.PRICE_INPUT_USD_PER_MTOK / 1_000_000
    + seam.USAGE.candidates_token_count * rq.PRICE_OUTPUT_USD_PER_MTOK / 1_000_000
)
GROUNDED = f"It ran [doc:{CORPUS[0]['id']}]."


def report(*, called: bool = True, tokens: dict | None = None) -> dict:
    """A generation report in `research_generate._report`'s shape."""
    row = {"generated": called, "verdict": "answered", "model_called": called}
    if tokens is not None:
        row["tokens"] = tokens
    return row


class TestPricing:
    def test_both_counts_are_priced_at_the_published_rates(self):
        usd = rq.price({"prompt": 1_000_000, "output": 1_000_000})
        assert usd == pytest.approx(rq.PRICE_INPUT_USD_PER_MTOK + rq.PRICE_OUTPUT_USD_PER_MTOK)

    def test_a_missing_count_prices_to_none_and_never_to_zero(self):
        """The rule this whole desk is most alert to, in the place it would hurt most.

        `research_generate._telemetry` OMITS a count the SDK did not report. If
        the missing half were read as zero, an unreported call would be priced
        as free — and a ceiling that is never reached is a ceiling that is not
        there. None is the only honest answer, and `AskQuota` records it as an
        unpriced call rather than as a cheap one.
        """
        assert rq.price({"prompt": 800}) is None
        assert rq.price({"output": 96}) is None
        assert rq.price({}) is None
        assert rq.price(None) is None

    def test_zero_tokens_is_still_a_measurement(self):
        """Reported zeros price to 0.0 — the one case where zero is the truth."""
        assert rq.price({"prompt": 0, "output": 0}) == 0.0


class TestTheBound:
    @pytest.fixture(autouse=True)
    def _spending_possible(self, monkeypatch):
        """A key configured, because a deployment with none is not bounded here.

        `tests/conftest.py` blanks `GEMINI_API_KEY` for the whole suite, and
        `AskQuota.check` passes unconditionally when no model can be reached —
        refusing a query that cannot cost anything would be refusing it on the
        grounds that a different deployment's version of it might have. So the
        cases below have to say which deployment they are about, and this is
        where they say it. `research_generate.settings` rather than
        `config.settings`: that is the module whose reading of the key decides
        whether a call happens.
        """
        monkeypatch.setattr(gen, "settings", SimpleNamespace(
            gemini_api_key="test-key-not-a-real-one", gemini_model="test-model",
        ))

    def test_a_deployment_that_cannot_reach_a_model_is_not_bounded(self, monkeypatch):
        """The scope of the bound, pinned so it cannot be widened by accident.

        This is also what keeps a suite that never spends a penny from being
        rate-limited by a cap written for a suite that would.
        """
        monkeypatch.setattr(gen, "settings", SimpleNamespace(gemini_api_key="", gemini_model="m"))
        quota = rq.AskQuota(rate_per_s=0.0001, burst=1, ceiling_usd=0.000001)
        quota.record(report(tokens={"prompt": 2_000_000, "output": 0}))

        assert [quota.check() for _ in range(5)] == [None] * 5

    def test_the_burst_passes_and_the_next_request_is_rate_limited(self):
        quota = rq.AskQuota(rate_per_s=0.0001, burst=3, ceiling_usd=0)

        assert [quota.check() for _ in range(3)] == [None, None, None]
        refusal = quota.check()
        assert refusal is not None
        assert refusal.state == rq.RATE_LIMITED
        assert refusal.retry_after_s is not None and refusal.retry_after_s > 0

    def test_the_spend_ceiling_refuses_and_names_itself(self):
        quota = rq.AskQuota(rate_per_s=1e6, burst=1_000, ceiling_usd=0.001)
        quota.record(report(tokens={"prompt": 2_000_000, "output": 0}))

        refusal = quota.check()
        assert refusal is not None
        assert refusal.state == rq.SPEND_CAPPED
        # Distinguishable from the other one by more than a string: an operator
        # reading this has to raise a ceiling, not wait a second.
        assert refusal.state != rq.RATE_LIMITED
        assert "budget" in refusal.reason

    def test_a_spend_refusal_does_not_also_cost_a_rate_token(self):
        """Two refusals for one cause is one refusal nobody can explain.

        A deployment sitting on its ceiling would otherwise drain the bucket
        with requests that never ran, and the first request after the window
        cleared would be refused for a rate it never consumed.
        """
        quota = rq.AskQuota(rate_per_s=0.0001, burst=2, ceiling_usd=0.001)
        quota.record(report(tokens={"prompt": 2_000_000, "output": 0}))

        before = quota.bucket.tokens
        assert quota.check().state == rq.SPEND_CAPPED
        assert quota.bucket.tokens == before

    def test_a_call_the_provider_did_not_price_is_counted_and_not_charged(self):
        quota = rq.AskQuota(ceiling_usd=1.0)
        assert quota.record(report(tokens={})) is None

        snapshot = quota.snapshot()
        assert snapshot["unpriced_calls"] == 1
        assert snapshot["priced_calls"] == 0
        assert snapshot["spent_usd"] == 0.0
        # The total is a FLOOR, and the state is how a reader is told so without
        # having to compare two counters themselves.
        assert snapshot["state"] == "partial"

    def test_a_call_that_never_reached_the_model_is_not_recorded_at_all(self):
        """Gated on `model_called`, the same flag the ledger row is gated on."""
        quota = rq.AskQuota()
        assert quota.record(report(called=False, tokens={"prompt": 1, "output": 1})) is None
        assert quota.record(None) is None
        assert quota.snapshot()["priced_calls"] == 0
        assert quota.snapshot()["unpriced_calls"] == 0

    def test_spend_leaves_the_window(self):
        """A ceiling over a rolling window, not a running total for all time."""
        quota = rq.AskQuota(rate_per_s=1e6, burst=1_000, ceiling_usd=0.001, window_s=0.0)
        quota.record(report(tokens={"prompt": 2_000_000, "output": 0}))

        assert quota.spent_usd() == 0.0
        assert quota.check() is None

    def test_an_unconfigured_ceiling_is_reported_as_uncapped_not_as_zero(self):
        quota = rq.AskQuota(ceiling_usd=0)
        assert quota.snapshot()["ceiling_usd"] is None
        assert quota.snapshot()["state"] == "uncapped"
        # A ceiling of zero read as a number would refuse every request forever.
        assert quota.check() is None


@pytest.fixture(autouse=True)
def _fresh_quota():
    rq.reset_ask_quota()
    yield
    rq.reset_ask_quota()


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def corpus(monkeypatch):
    """The real `ResearchRag` with the network stubbed, as the route builds it."""
    reset_rag()
    monkeypatch.setattr(rag_module, "settings", _Settings())
    get_rag()._client = Corpus()
    yield
    reset_rag()


@pytest.fixture
def model(monkeypatch):
    """A fake provider at `research_generate._sdk` — the real fences still run."""
    seam.absent(monkeypatch)
    return seam.install_model(monkeypatch, text=GROUNDED)


def ask(client, query: str = QUERY):
    return client.post("/api/research/rag/ask", json={"query": query, "match_count": 3})


class TestTheRouteIsActuallyBounded:
    def test_the_ask_route_refuses_over_the_burst_with_a_named_state(self, client, corpus, model):
        rq.reset_ask_quota()
        quota = rq.AskQuota(rate_per_s=0.0001, burst=2, ceiling_usd=0)
        rq._QUOTA = quota

        assert ask(client).status_code == 200
        assert ask(client).status_code == 200
        refused = ask(client)

        assert refused.status_code == 429, "a bound doing its job is not a 500"
        body = refused.json()
        assert body["state"] == "rate_limited"
        assert body["route"] == "/api/research/rag/ask"
        assert body["query"] == QUERY
        # Not confusable with either refusal this plane already has: CRAG's
        # `refused` means documents came back and none were relevant, and a
        # generation's `corpus_silent` means the model read them and said so.
        # Both of those are 200 answers about the corpus. This says nothing
        # about the corpus at all.
        assert "state" in body and body["state"] not in {"refused", "corpus_silent", "ok"}
        assert "matches" not in body and "band" not in body
        assert int(refused.headers["Retry-After"]) >= 1

    def test_the_route_charges_the_window_with_what_the_call_cost(self, client, corpus, model):
        rq.reset_ask_quota()
        quota = rq.AskQuota(rate_per_s=1e6, burst=1_000, ceiling_usd=1.0)
        rq._QUOTA = quota

        answered = ask(client)
        assert answered.status_code == 200
        assert answered.json()["generation"]["model_called"] is True, "no call was made to charge for"

        snapshot = quota.snapshot()
        assert snapshot["priced_calls"] == 1
        assert snapshot["unpriced_calls"] == 0
        # The ceiling and the `research_generation` ledger row are computed from
        # ONE number — the token counts on the report — rather than from two
        # estimates that can disagree.
        assert snapshot["spent_usd"] == pytest.approx(CALL_USD, rel=1e-6)

    def test_the_spend_ceiling_stops_the_next_request_over_the_wire(self, client, corpus, model):
        rq.reset_ask_quota()
        quota = rq.AskQuota(rate_per_s=1e6, burst=1_000, ceiling_usd=CALL_USD / 2)
        rq._QUOTA = quota

        assert ask(client).status_code == 200
        capped = ask(client)

        assert capped.status_code == 429
        body = capped.json()
        assert body["state"] == "spend_capped"
        assert body["spend"]["state"] == "priced"
        assert body["spend"]["spent_usd"] == pytest.approx(CALL_USD, rel=1e-6)
        assert len(model.calls) == 1, "the refused request must not have reached the model"

    def test_an_unbounded_deployment_is_unchanged(self, client, corpus, model):
        """The default constants must not turn a working desk into 429s."""
        rq.reset_ask_quota()
        assert ask(client).status_code == 200
        assert rq.get_ask_quota().snapshot()["spent_usd"] > 0
