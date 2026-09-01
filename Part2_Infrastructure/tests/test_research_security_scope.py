"""Tenancy, and the ledger row `/search` never wrote.

TENANCY WAS NOMINAL, in three independent ways
-----------------------------------------------

`research_documents` has RLS enabled and a policy reading
`(select auth.uid()) = user_id`. The writer sets `user_id` on nothing, so the
column is NULL corpus-wide; the gateway reads with the service role key, which
bypasses RLS entirely; and neither retrieval RPC took a tenant argument at all,
so a search spanned every row in the table whoever wrote it.

`supabase/migrations/20260822090000_research_tenant_scope.sql` fixes the third,
because it is the one that has to be fixed first — a predicate inside the
function scopes the read on the connection the gateway actually uses. This file
pins the SQL contract offline (the way `tests/test_supabase_schema.py` pins the
gate enum) and pins the ONE invariant the route half must satisfy while the
retrieval half is still landing:

    with a desk scope configured, `/search` and `/ask` either pass it to
    retrieval or REFUSE. They never serve unscoped rows.

Written as an either/or on purpose. Asserting "the route refuses today" would
be a test that fails the moment `modules/research_rag/retrieval.py` learns the
argument — a test that punishes the fix — and asserting "the route passes it"
would be red until then. The invariant is true on both sides of that change and
false in exactly the case that matters: a deployment that switched scoping on
and got a full-corpus read.

Nothing here reaches a network. The Supabase side of the wire is a stub that
RECORDS the RPC payload, which is the only place the predicate can be observed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_research_search_route import CORPUS, _Settings

import main
import modules.research_quota as rq
import modules.research_quota_scope as scope_module
import modules.research_rag.writer as rag_module
from modules.audit import AuditLog
from modules.research_rag import EMBEDDING_DIMENSIONS, get_rag, reset_rag

MIGRATION = (
    Path(__file__).resolve().parent.parent.parent
    / "supabase" / "migrations" / "20260822090000_research_tenant_scope.sql"
)
QUERY = "deflated sharpe drawdown sweep"


def statements() -> str:
    """The migration's SQL with its comment lines removed, lowercased.

    `tests/test_migration_bundle._statements` in one line and for its reason: a
    comment must not be able to satisfy — or fail — a check about the SQL. This
    file's migration names the rejected `is not distinct from` spelling in prose
    directly above the line that does not use it.
    """
    return "\n".join(
        line for line in MIGRATION.read_text().lower().splitlines()
        if not line.lstrip().startswith("--")
    )


class Reply:
    def __init__(self, payload, status_code: int = 200, headers=None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class RecordingCorpus:
    """The Supabase side of the wire, keeping every RPC payload it was sent.

    The predicate is only observable here. A stub that answered without
    recording would let a route claim a scope it never sent, which is the
    failure this file is about.
    """

    def __init__(self) -> None:
        self.rpc: list[tuple[str, dict]] = []

    async def post(self, path, json=None, headers=None):  # noqa: A002 - httpx's kwarg
        if path.endswith("/embed-research"):
            return Reply({"embeddings": [[0.05] * EMBEDDING_DIMENSIONS for _ in json["texts"]]})
        self.rpc.append((path.rsplit("/", 1)[-1], dict(json or {})))
        if path.endswith("match_research_documents_hybrid"):
            return Reply(CORPUS[: json.get("match_count", 3)])
        if path.endswith("match_research_documents"):
            return Reply([
                {k: v for k, v in row.items() if k not in ("vector_rank", "lexical_rank")}
                for row in CORPUS[: json.get("match_count", 3)]
            ])
        raise AssertionError(f"unexpected POST {path}")

    async def head(self, path, params=None, headers=None):
        return Reply(None, headers={"content-range": "0-0/412"})

    @property
    def scopes(self) -> list:
        return [payload.get("filter_desk_id") for _, payload in self.rpc]


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
    reset_rag()
    monkeypatch.setattr(rag_module, "settings", _Settings())
    stub = RecordingCorpus()
    get_rag()._client = stub
    yield stub
    reset_rag()


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    """The real ledger on a throwaway file, in the singleton's own slot.

    `tests/test_research_router.py`'s fixture plus a redirection: these routes
    reach the log through `get_audit()`, not an argument. Read from the
    process-wide one these four passed alone and failed after
    `tests/test_api.py`, whose client fixture ENTERS the app lifespan, whose
    shutdown closes that singleton — every later file then inherits a closed
    log and no row is written (`tests/test_web_state.py:194`, same hazard). The
    slot, not the `get_audit` name imported into the two route modules: a third
    consumer would silently reach the closed one again."""
    log = AuditLog(tmp_path / "scope-ledger.duckdb")
    monkeypatch.setattr("modules.audit._audit", log)
    yield log
    log.close()


@pytest.fixture
def scoped(monkeypatch):
    """The deployment that asked to be scoped to its own desk."""
    monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
    monkeypatch.setattr(scope_module, "settings", _Settings())
    return _Settings.supabase_desk_id


def search(client, query: str = QUERY):
    return client.post("/api/research/rag/search", json={"query": query, "match_count": 3})


class TestTheSqlContract:
    def test_both_retrieval_functions_take_an_optional_tenant_predicate(self):
        sql = statements()
        for function in ("match_research_documents", "match_research_documents_hybrid"):
            assert f"function public.{function}(" in sql, function
        assert sql.count("filter_desk_id uuid default null") == 2
        assert sql.count("filter_user_id uuid default null") == 2

    def test_null_means_unscoped_and_never_matches_rows_with_no_owner(self):
        """`is null or =`, never `is not distinct from`.

        The second reads as an equality that also matches nulls, which would
        turn an unscoped call into a search for rows with NO desk — an empty
        result that looks exactly like an empty corpus.
        """
        sql = statements()
        assert sql.count("(filter_desk_id is null or d.desk_id = filter_desk_id)") == 2
        assert sql.count("(filter_user_id is null or d.user_id = filter_user_id)") == 2
        assert "is not distinct from" not in sql

    def test_the_old_signatures_are_dropped_rather_than_overloaded(self):
        """`create or replace` matches on the argument list.

        Adding two defaulted parameters therefore creates an OVERLOAD, and a
        PostgREST call naming only the original arguments then matches both
        candidates and fails with "function is not unique" — every search 300s
        at once. This is the assertion that a reviewer would otherwise have to
        know Postgres to make.
        """
        sql = statements()
        assert sql.count("drop function if exists") == 2

    def test_the_service_role_only_acls_are_reapplied_after_the_drop(self):
        """Dropping a function drops its ACL, and a new one is executable by PUBLIC.

        Without the complete revoke-plus-grant pairs, this migration would
        reopen the RPC to PUBLIC as a side effect of adding a tenancy predicate
        or leave its intended gateway caller implicit.
        """
        sql = statements()
        revokes = re.findall(r"revoke execute on function\s+public\.(\w+)", sql)
        grants = re.findall(r"grant execute on function\s+public\.(\w+)", sql)
        assert sorted(revokes) == ["match_research_documents", "match_research_documents_hybrid"]
        assert sorted(grants) == ["match_research_documents", "match_research_documents_hybrid"]
        assert sql.count("from public, anon, authenticated;") == 2
        assert sql.count("to service_role;") == 2

    def test_the_predicate_scopes_the_candidate_set_of_the_hybrid_function(self):
        """Filtered in `candidates`, before either ranking is taken.

        `lexical_rank` and `vector_rank` are positions WITHIN that CTE. Filtering
        after the ranks were computed would return this desk's rows carrying
        ranks that counted another desk's documents ahead of them — a "rank 4"
        that silently means "rank 4 of everybody".
        """
        sql = statements()
        candidates = sql[sql.index("with candidates as"):sql.index("vector_ranked as")]
        assert "filter_desk_id is null or d.desk_id = filter_desk_id" in candidates


class TestTheProbe:
    def test_a_callee_that_takes_the_parameter_is_accepted(self):
        def retrieve(query, match_count=3, desk_id=None):
            return None

        assert scope_module.scope_parameter_accepted(retrieve)

    def test_a_callee_that_does_not_is_refused(self):
        def retrieve(query, match_count=3):
            return None

        assert not scope_module.scope_parameter_accepted(retrieve)

    def test_kwargs_counts_as_accepting(self):
        """The one false positive this can produce, pinned so it is a decision.

        A retrieval method that swallowed the argument in `**kwargs` would be a
        defect in that file; the alternative — refusing every `**kwargs` callee
        — would refuse a perfectly good wrapper.
        """
        def retrieve(query, **kwargs):
            return None

        assert scope_module.scope_parameter_accepted(retrieve)

    def test_the_parameter_name_is_the_contract(self):
        """One spelling, named here so the two halves cannot drift apart.

        `retrieval.search(..., desk_id=...)` forwards it to the RPC as
        `filter_desk_id`, which is the name the migration declares.
        """
        assert scope_module.SCOPE_PARAM == "desk_id"


class TestTheDefaultDeploymentIsUnchanged:
    def test_scoping_off_sends_no_tenant_argument(self, client, corpus):
        assert not scope_module.SCOPE_TO_DESK, "the default must be off"

        response = search(client)

        assert response.status_code == 200
        assert response.json()["state"] == "ok"
        assert corpus.rpc, "no RPC was made, so this proves nothing"
        assert corpus.scopes == [None] * len(corpus.rpc)


class TestAScopedDeploymentNeverServesUnscopedRows:
    def test_search_either_passes_the_scope_or_refuses(self, client, corpus, scoped):
        response = search(client)

        if response.status_code == 200:
            assert corpus.scopes and all(s == scoped for s in corpus.scopes), (
                "the route served rows without passing the configured desk scope"
            )
        else:
            assert response.status_code == 503, "a bound doing its job is not a 500"
            body = response.json()
            assert body["state"] == "scope_unavailable"
            assert body["route"] == "/api/research/rag/search"
            # Waiting is not the answer, so no number is offered for it.
            assert body["retry_after_s"] is None
            assert scoped in body["reason"]
            assert corpus.rpc == [], "a refused search must not have run"

    def test_ask_passes_the_scope_through_the_answer_pipeline(self, client, corpus, scoped):
        response = client.post("/api/research/rag/ask", json={"query": QUERY, "match_count": 3})

        assert response.status_code == 200, response.text
        assert corpus.scopes and all(s == scoped for s in corpus.scopes)

    def test_a_scope_refusal_does_not_spend_a_rate_token(self, client, corpus, scoped):
        """The refusal is at the door, before the bucket is touched.

        A request that was never going to run must not consume the token whose
        absence then refuses the next one for an unrelated reason.
        """
        rq.reset_ask_quota()
        before = rq.get_ask_quota().bucket.tokens
        client.post("/api/research/rag/ask", json={"query": QUERY, "match_count": 3})
        after = rq.get_ask_quota().bucket.tokens
        if not scope_module.scope_parameter_accepted(get_rag().search):
            assert after == before


class TestSearchIsLedgered:
    def _rows(self, ledger, query: str) -> list[dict]:
        return [
            {**row, "payload": json.loads(row["payload"])}
            for row in ledger.query(
                "SELECT event, actor, detail, payload FROM risk_events "
                "WHERE event = ? AND detail = ? ORDER BY ts",
                ("research_search", query),
            )
        ]

    def test_a_search_writes_one_row_carrying_what_it_retrieved(self, client, corpus, ledger):
        query = f"{QUERY} ledgered-ok"
        assert self._rows(ledger, query) == []

        response = search(client, query)

        rows = self._rows(ledger, query)
        assert len(rows) == 1, "`/search` wrote nothing, so half the retrieval traffic is invisible"
        row = rows[0]
        assert row["actor"] == "research", "the same actor `/ask`'s plan rows carry"
        payload = row["payload"]
        assert payload["state"] == response.json()["state"]
        assert payload["rows"] == len(response.json()["matches"])
        assert payload["kind"] is None
        assert payload["corpus_size"] == response.json()["corpus_size"]

    def test_the_row_is_written_even_when_the_index_is_unavailable(self, client, monkeypatch, ledger):
        """"The index was not configured when this was asked" is the fact a
        reader reconstructing an afternoon needs. A ledger that records only
        successes cannot explain anything."""
        reset_rag()
        query = f"{QUERY} ledgered-unavailable"

        response = search(client, query)

        assert response.json()["state"] == "unavailable"
        rows = self._rows(ledger, query)
        assert len(rows) == 1
        assert rows[0]["payload"]["state"] == "unavailable"
        assert rows[0]["payload"]["rows"] == 0
        reset_rag()

    def test_the_ask_route_publishes_the_id_its_ledger_rows_carry(self, client, corpus, ledger):
        """The other half of the tie, and the reason it is a header.

        `/ask` returns `research_crag`'s `ResearchAnswer`, which this plane does
        not own, so the id goes on `X-Research-Correlation-Id` rather than into
        the body. The claim is not that a header exists — it is that the id on
        it is the SAME one the plan and tool-call rows were written under, which
        is what makes a request reconstructable from the ledger.

        Matched against the raw payload text rather than a named key: the router
        owns the shape of its own rows, and a test that pinned the key would be
        this file asserting on another module's field names.
        """
        query = f"{QUERY} ask-correlated"

        response = client.post("/api/research/rag/ask", json={"query": query, "match_count": 3})

        assert response.status_code == 200, response.text
        correlation = response.headers.get("X-Research-Correlation-Id")
        rows = ledger.query(
            "SELECT event, payload FROM risk_events WHERE detail = ? ORDER BY ts", (query,),
        )
        assert rows, "`/ask` wrote no ledger row at all"
        # A header is published only when the rows actually carry an id. None is
        # the honest answer on a deployment whose router does not mint one yet;
        # what may never happen is an id published to a caller that appears on
        # nothing, which would send a reader hunting rows that do not exist.
        if correlation is not None:
            assert any(correlation in str(row["payload"]) for row in rows), (
                "the id published to the caller appears on none of the rows the request wrote"
            )

    def test_the_correlation_id_ties_the_response_to_its_row(self, client, corpus, ledger):
        query = f"{QUERY} ledgered-correlated"

        response = search(client, query)

        body = response.json()
        correlation = body["correlation_id"]
        assert correlation, "a reader cannot tie this response to any row"
        # Published in both places: the body for this plane's own model, and the
        # header because `/ask` returns `research_crag`'s model and has nowhere
        # else to put it.
        assert response.headers["X-Research-Correlation-Id"] == correlation
        assert self._rows(ledger, query)[0]["payload"]["correlation_id"] == correlation
