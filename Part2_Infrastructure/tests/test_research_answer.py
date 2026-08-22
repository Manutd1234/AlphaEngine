"""The corrective retrieval path, exercised THROUGH THE ROUTE THAT SERVES IT.

Both halves of this feature shipped dead. `ContextGrader` graded nothing,
`ResearchRouter` planned for nobody, and every test about them passed, because
every test built the object itself or handed it a stand-in. This repository has
paid for that shape before — `MLRunStore.persist` had exactly one caller and it
was a test — so the tests here start at `POST /api/research/rag/ask` with the
real `ResearchRag`, the real `ResearchRouter` and the real `AuditLog`, and the
only thing faked is the network.

What is stubbed and why
-----------------------

One object: the httpx client inside `ResearchRag`. Everything on the gateway
side of it is production code, including the RRF filter, the corpus count, the
router's plan, the grader's arithmetic and the DuckDB writes. Stubbing the
transport keeps the suite offline; stubbing anything above it would put the
tests back where they started.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
import modules.audit as audit_module

# The package's only reader of `settings`; patching the facade would not apply.
import modules.research_rag.writer as rag_module
from modules.audit import AuditLog
from modules.research_rag import EMBEDDING_DIMENSIONS, get_rag, reset_rag

NOW = datetime.now(UTC)


class _Settings:
    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_test"
    research_rag_enabled = True
    supabase_desk_id = "00000000-0000-0000-0000-000000000001"
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 10


def document(
    ref: str,
    body: str,
    *,
    similarity: float,
    both: bool,
    age_days: float = 1.0,
    symbol: str | None = "BTCUSDT",
    strategy: str | None = "ma_crossover",
) -> dict:
    """One row shaped exactly like `match_research_documents_hybrid` returns."""
    return {
        "id": f"11111111-0000-0000-0000-{ref:>012}",
        "kind": "backtest_run",
        "source_ref": ref,
        "symbol": symbol,
        "strategy": strategy,
        "occurred_at": (NOW - timedelta(days=age_days)).isoformat(),
        "title": body[:60],
        "body": body,
        "metrics": {"sharpe": 1.1},
        "similarity": similarity,
        "vector_rank": 1,
        "lexical_rank": 1 if both else None,
    }


STRONG = [
    document(f"strong-{i}", "BTCUSDT ma_crossover drawdown sweep results", similarity=0.93, both=True)
    for i in range(3)
]
MID = [
    document("mid-0", "crossover sweep tear sheet", similarity=0.90, both=True),
    document("mid-1", "another crossover sweep", similarity=0.85, both=False),
    document("mid-2", "a third crossover sweep", similarity=0.84, both=False),
]
FAR = [
    document(
        "far-0", "BTCUSDT ma_crossover drawdown sweep", similarity=0.78, both=False,
        age_days=500.0, symbol=None, strategy=None,
    )
]
NEIGHBOURS = [
    {
        "id": "22222222-0000-0000-0000-000000000001",
        "kind": "risk_incident", "source_ref": "ord-9", "symbol": "BTCUSDT",
        "strategy": "ma_crossover", "occurred_at": NOW.isoformat(),
        "title": "Execution anomaly", "depth": 1,
        "arrived_by": "shares_data_hash", "evidence": "8e43f5f7",
    }
]


class _Response:
    def __init__(self, payload, status_code=200, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class Corpus:
    """The Supabase side of the wire, and nothing else.

    ``rounds`` is a list of match lists served to successive hybrid queries, so
    a test can say "weak first, strong after the rewrite" and then assert on how
    many rounds were actually spent.
    """

    def __init__(self, rounds, *, connected=None, corpus_size=412):
        self.rounds = list(rounds)
        self.connected = connected
        self.corpus_size = corpus_size
        self.queries: list[str] = []
        self.traversals: list[str] = []

    async def post(self, path, json=None, headers=None):  # noqa: A002 — httpx's kwarg
        if path.endswith("/embed-research"):
            return _Response({"embeddings": [[0.05] * EMBEDDING_DIMENSIONS for _ in json["texts"]]})
        if path.endswith("match_research_documents_hybrid"):
            self.queries.append(json["query_text"])
            index = min(len(self.queries) - 1, len(self.rounds) - 1)
            return _Response(self.rounds[index])
        if path.endswith("traverse_research_graph"):
            self.traversals.append(json["start_id"])
            return _Response(self.connected if self.connected is not None else [])
        raise AssertionError(f"unexpected POST {path}")

    async def head(self, path, params=None, headers=None):
        return _Response(None, headers={"content-range": f"0-0/{self.corpus_size}"})


@pytest.fixture
def client():
    """No lifespan: no feeds, no bot, no drain task — just the routes."""
    return TestClient(main.app)


@pytest.fixture
def corpus(monkeypatch):
    reset_rag()
    monkeypatch.setattr(rag_module, "settings", _Settings())
    rag = get_rag()

    def _serve(rounds, **kw):
        stub = Corpus(rounds, **kw)
        rag._client = stub
        return stub

    yield _serve
    reset_rag()


def ask(client, query, **kw):
    response = client.post("/api/research/rag/ask", json={"query": query, **kw})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def ledger(monkeypatch, tmp_path):
    """A fresh, OPEN `AuditLog` installed as the gateway's singleton.

    The process-wide one has usually been CLOSED by the time these run — any
    test that drives the lifespan (`TestClient` as a context manager) closes it
    on shutdown, and a closed `AuditLog` answers every query with an empty list
    and swallows every write. Reading through a fresh one keeps these
    assertions about the router's writes rather than about test ordering; the
    route still reaches it the production way, through `get_audit()`.
    """
    log = AuditLog(tmp_path / "ledger.duckdb")
    monkeypatch.setattr(audit_module, "_audit", log)

    def read(event: str, detail: str) -> list[dict]:
        return [
            {**row, "payload": json.loads(row["payload"])}
            for row in log.query(
                "SELECT event, actor, detail, payload FROM risk_events "
                "WHERE event = ? AND detail = ? ORDER BY ts",
                (event, detail),
            )
        ]

    yield read
    log.close()


# --------------------------------------------------------------------------- #
# The three bands, over the route
# --------------------------------------------------------------------------- #
def test_a_strong_retrieval_is_graded_and_answered_in_one_round(client, corpus):
    stub = corpus([STRONG])
    body = ask(client, "BTCUSDT ma_crossover drawdown sweep")

    assert body["state"] == "ok"
    assert body["band"] == "answer" and body["score"] > 0.8
    assert len(body["matches"]) == 3
    assert body["retrievals"] == 1 and body["rewritten_query"] is None
    assert len(stub.queries) == 1, "a strong result must not pay for a rewrite"
    assert body["corpus_size"] == 412


def test_a_mid_band_query_is_rewritten_once_and_requeried(client, corpus):
    stub = corpus([MID, STRONG])
    body = ask(client, "crossover sweep results")

    # The rewrite is built from the corpus's own vocabulary, not paraphrased.
    assert body["rewritten_query"] == "crossover sweep results BTCUSDT ma_crossover"
    assert stub.queries == ["crossover sweep results", body["rewritten_query"]]
    assert body["retrievals"] == 2
    assert body["state"] == "ok" and body["band"] == "answer"
    assert body["query"] == body["rewritten_query"], "the answer names the query it answered"


def test_the_rewrite_budget_is_one_even_when_the_second_round_is_no_better(client, corpus):
    # The bound is the design. A corrective loop that keeps going is the thing
    # this codebase refused, so the second mid-band grade must END the query.
    # This WAS `state == "ok"` ("a mid-band second round answers; it does not
    # refuse"), which pinned the defect: `refused = score < refuse_band` was the
    # only gate, so ANSWER_BAND decided nothing and a 0.66 came back ok/rewrite,
    # the middle band living in a field rather than in the control flow. Every
    # document here reads "rewrite once, re-query, then answer OR REFUSE".
    stub = corpus([MID, MID, STRONG])
    body = ask(client, "crossover sweep results")

    assert len(stub.queries) == 2, f"the loop ran {len(stub.queries)} times"
    assert body["retrievals"] == 2 and body["state"] == "refused"
    assert body["band"] == "rewrite" and 0.4 <= body["score"] <= 0.8
    assert body["matches"] == [], "a refusal does not hand back the rows it refused"
    # A mid-band grade that survived its rewrite is a different finding from a
    # score under the floor, so the sentence carries the band and what was spent.
    assert "0.40-0.80 band" in body["refusal"] and body["rewritten_query"] in body["refusal"]


def test_a_below_band_result_refuses_and_says_why(client, corpus):
    stub = corpus([FAR])
    body = ask(client, "sourdough bread recipe proofing schedule")

    assert body["state"] == "refused"
    assert body["matches"] == [], "a refusal does not hand back the rows it refused"
    assert body["score"] < 0.4 and body["band"] == "refuse"
    assert len(stub.queries) == 1, "a result that is not close does not earn a rewrite"

    refusal = body["refusal"]
    # Why it refused, in terms of the signals that decided it.
    assert "relevance floor" in refusal and "0.40" in refusal
    assert any(reason in refusal for reason in body["reasons"])
    assert "412 indexed documents were searched" in refusal
    # And the sentence that keeps this apart from an empty corpus.
    assert "not an empty corpus" in refusal


# --------------------------------------------------------------------------- #
# A refusal is not the other three states
# --------------------------------------------------------------------------- #
def test_an_empty_corpus_result_is_ok_with_no_matches(client, corpus):
    corpus([[]])
    body = ask(client, "BTCUSDT ma_crossover drawdown sweep")

    assert body["state"] == "ok" and body["matches"] == []
    assert body["refusal"] is None and body["band"] is None, (
        '"searched and found nothing" is an answer; grading it would make it a refusal'
    )


def test_an_unconfigured_index_is_unavailable_not_refused(client):
    reset_rag()
    body = ask(client, "BTCUSDT ma_crossover drawdown sweep")
    assert body["state"] == "unavailable"
    assert body["matches"] == [] and body["refusal"] is None
    reset_rag()


def test_the_four_states_are_four_different_sentences(client, corpus):
    corpus([FAR])
    refused = ask(client, "sourdough bread recipe proofing schedule")
    corpus([[]])
    empty = ask(client, "BTCUSDT ma_crossover drawdown sweep")
    assert refused["state"] != empty["state"]
    assert (refused["refusal"] is not None) and (empty["refusal"] is None)


# --------------------------------------------------------------------------- #
# The router, at its production construction site
# --------------------------------------------------------------------------- #
def test_the_route_writes_the_plan_to_the_audit_log(client, corpus, ledger):
    corpus([STRONG])
    query = "BTCUSDT ma_crossover drawdown sweep audit-plan-probe"
    body = ask(client, query)

    rows = ledger("research_plan", query)
    assert len(rows) == 1, "the gateway's own audit log has no plan for this query"
    assert rows[0]["actor"] == "research"
    plan = rows[0]["payload"]
    assert plan["planner"] == "rules" and plan["fallback"] is False
    assert [c["tool"] for c in plan["calls"]] == ["hybrid_search"]
    assert body["planner"] == "rules"


def test_the_route_writes_every_tool_call_to_the_audit_log(client, corpus, ledger):
    corpus([STRONG], connected=NEIGHBOURS)
    query = "what happened after the BTCUSDT ma_crossover drawdown sweep results promotion"
    body = ask(client, query)

    plan = ledger("research_plan", query)[0]["payload"]
    assert set(c["tool"] for c in plan["calls"]) == {"graph_traverse", "hybrid_search"}

    calls = [row["payload"] for row in ledger("research_tool_call", query)]
    assert len(calls) == len(plan["calls"]), "a call nobody recorded cannot be replayed"
    by_tool = {c["tool"]: c for c in calls}
    assert by_tool["hybrid_search"]["state"] == "ok" and by_tool["hybrid_search"]["rows"] == 3
    assert by_tool["graph_traverse"]["state"] == "ok"
    # And the same rows come back to the caller, so the ledger is checkable.
    assert [c["tool"] for c in body["calls"]] == [c["tool"] for c in calls]
    assert len(body["connected"]) == 1


def test_a_rewrite_puts_its_own_plan_in_the_ledger_too(client, corpus, ledger):
    corpus([MID, STRONG])
    body = ask(client, "crossover sweep results")
    assert ledger("research_plan", body["rewritten_query"]), (
        "the second query was planned by the router and must replay like the first"
    )


def test_a_tool_that_could_not_produce_a_number_is_recorded_with_its_reason(client, corpus, ledger):
    # WAS `test_a_tool_with_no_executor_is_recorded_as_unsupported`: counts were routed to
    # `structured_runs`, no reader existed, and the row said so. `research_structured` is that reader
    # now, so every name in TOOLS has an arm and "unsupported" is unreachable through the router. The
    # property it protected is not: an arm that produced no number says so in a NAMED state with a
    # sentence, in the response AND the ledger, never a silent skip and never a zero read as a count.
    corpus([STRONG])
    query = "how many BTCUSDT ma_crossover drawdown sweep results are recorded"
    body = ask(client, query)

    runs = {c["tool"]: c for c in body["calls"]}["structured_runs"]
    assert runs["state"] == "empty" and runs["rows"] == 0, "it ran, and counted nothing"
    assert "backtest_runs" in runs["detail"], "the row names the table it counted over"
    assert body["state"] == "ok", "an arm with no number must not fail the query"
    assert [row["payload"]["state"] for row in ledger("research_tool_call", query)
            if row["payload"]["tool"] == "structured_runs"] == ["empty"]


def test_a_data_hash_query_re_queries_the_bare_token_for_the_lexical_half(client, corpus):
    # The token gte-small handles worst, asked for on its own so the lexical
    # half of the fused index ranks it first. Graph runs LAST whatever the plan
    # says, because a traversal needs a document to start from.
    stub = corpus([STRONG, STRONG], connected=NEIGHBOURS)
    query = "8e43f5f7 BTCUSDT ma_crossover drawdown sweep results"
    body = ask(client, query)

    assert stub.queries == ["8e43f5f7", query]
    calls = {c["tool"]: c for c in body["calls"]}
    assert calls["lexical_exact"]["state"] == "ok"
    assert stub.traversals == [STRONG[0]["id"]]
    assert len(body["matches"]) == 3, "the same document retrieved twice is one row"


def test_the_graph_call_is_skipped_when_nothing_was_retrieved_to_walk_from(client, corpus):
    corpus([[]], connected=NEIGHBOURS)
    query = "what happened after nothing at all"
    body = ask(client, query)
    graph = {c["tool"]: c for c in body["calls"]}["graph_traverse"]
    assert graph["state"] == "skipped" and "walk from" in graph["detail"]


# --------------------------------------------------------------------------- #
# The gap that let both of these ship
# --------------------------------------------------------------------------- #
def test_the_grader_and_the_router_are_reachable_from_production_code():
    """Neither module may go back to being imported only by its own tests.

    This is the check whose absence let C72 and C76 both ship green: `grep -rn
    research_crag --include='*.py' .` matched two test files and nothing else.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    sources = [root / "main.py"] + sorted((root / "modules").rglob("*.py"))
    for module in ("research_crag", "research_router"):
        importers = [
            path.relative_to(root).as_posix()
            for path in sources
            if path.name != f"{module}.py"
            and f"modules.{module}" in path.read_text()
        ]
        assert importers, f"nothing outside tests/ imports modules.{module}"
