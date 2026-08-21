"""The centrality route and the communities sweep — the two wirings a verifier
found dead by mutation.

`rank_documents` had no caller and `project_communities`' only caller pinned
``project=False``, so PageRank and the Neo4j label write-back were both
unreachable in production while every one of their unit tests passed. The same
lesson as `test_research_contract.py`, one layer up: a module's own suite
cannot notice that nothing calls it. These tests hold the two new callers —
GET /api/research/graph/centrality and the scheduled ``reconcile_communities``
sweep — against the REAL modules; the only stand-ins are the network (PostgREST
via a fake httpx client) and the Neo4j driver, which are boundaries, not
collaborators.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from modules import research_graph_projection as gp
from modules import research_graph_reads as reads
from modules import research_reconcile

DESK = "00000000-0000-0000-0000-000000000001"

#: Two triangles bridged at d0—d3, plus a second bridge d0—d5: with only the
#: first bridge the graph has an automorphism swapping the clusters, d0 and d3
#: carry EQUAL mass, and float iteration order picks the winner — the first
#: draft of this fixture asserted on exactly that coin flip. The extra edge
#: gives d0 strictly the highest degree, and undirected PageRank follows
#: degree, so d0 leading is a fact of the shape rather than of tie-breaking.
BRIDGED = [
    {"src_id": "d0", "dst_id": "d1", "relation": "same_symbol"},
    {"src_id": "d1", "dst_id": "d2", "relation": "same_symbol"},
    {"src_id": "d2", "dst_id": "d0", "relation": "same_symbol"},
    {"src_id": "d3", "dst_id": "d4", "relation": "same_data"},
    {"src_id": "d4", "dst_id": "d5", "relation": "same_data"},
    {"src_id": "d5", "dst_id": "d3", "relation": "same_data"},
    {"src_id": "d0", "dst_id": "d3", "relation": "same_regime"},
    {"src_id": "d0", "dst_id": "d5", "relation": "same_regime"},
]


class _Store:
    """Just enough PostgREST: one GET shape, keyset paging never triggered."""

    def __init__(self, rows):
        self._rows = rows
        self.gets = 0

    async def get(self, path, params=None, **_):
        self.gets += 1
        rows = self._rows if self.gets == 1 else []
        return SimpleNamespace(status_code=200, json=lambda: rows,
                               headers={}, text="")


class _Session:
    def __init__(self, store):
        self._store = store

    async def __aenter__(self):
        return self._store

    async def __aexit__(self, *_):
        return False


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def corpus(monkeypatch):
    def _serve(rows=BRIDGED):
        store = _Store(rows)
        monkeypatch.setattr(reads, "settings", SimpleNamespace(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="sb_secret_test",
            supabase_desk_id=DESK, supabase_timeout_s=5.0,
        ))
        monkeypatch.setattr(reads, "httpx", SimpleNamespace(
            AsyncClient=lambda **_: _Session(store)))
        return store

    return _serve


class TestTheCentralityRouteIsAlive:
    def test_the_literal_path_is_not_swallowed_by_the_document_id_route(self, client, corpus):
        corpus()
        body = client.get("/api/research/graph/centrality").json()
        assert body.get("scope") == "centrality", (
            "a neighbour-list shape here means the {document_id} handler "
            "swallowed the literal path — declaration order regressed"
        )

    def test_pagerank_actually_ran_and_found_the_bridge(self, client, corpus):
        # The real rank_documents, end to end: severing it from the route (the
        # mutation that proved it dead) empties the ranking and fails here.
        corpus()
        ranking = client.get("/api/research/graph/centrality").json()["ranking"]
        assert ranking["ranked"] is True
        # `ranking["ranking"]` is already sorted, score-descending with a stable
        # id tie-break, so "who leads" is a single index — not a re-sort here.
        assert ranking["ranking"][0]["id"] == "d0", (
            "the document bridging both clusters must carry the most PageRank mass"
        )

    def test_an_unconfigured_corpus_is_reported_not_ranked(self, client, monkeypatch):
        monkeypatch.setattr(reads, "settings", SimpleNamespace(
            supabase_url="", supabase_service_role_key="",
            supabase_desk_id=DESK, supabase_timeout_s=5.0))
        ranking = client.get("/api/research/graph/centrality").json()["ranking"]
        assert ranking["ranked"] is False
        assert "SUPABASE_URL" in ranking["reason"], "the reason must name the missing variables"


class TestTheScheduledSweepWritesTheLabels:
    def test_reconcile_communities_projects_where_the_route_refuses(self, corpus, monkeypatch):
        """The wiring the verifier proved missing: project=True from the sweep.

        The route pins project=False (a GET must not write), so the ONLY path to
        `project_communities` is this adapter. Re-pinning it to False here —
        the exact state the verifier found — leaves the fake driver untouched
        and fails the assertion below.
        """
        corpus()
        statements: list[str] = []

        class _FakeSession:
            def run(self, cypher, **params):
                statements.append(cypher)
                return SimpleNamespace(single=lambda: {"n": 0}, consume=lambda: None)

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        driver = SimpleNamespace(session=lambda **_: _FakeSession(), close=lambda: None)
        monkeypatch.setattr(gp, "_driver", lambda: (driver, None))
        monkeypatch.setattr(gp, "settings", SimpleNamespace(
            neo4j_uri="neo4j+s://x", neo4j_user="u", neo4j_password="p",
            neo4j_database="d"))

        report = research_reconcile.reconcile_communities(job_id="sweep-test")
        assert report["projection"]["projected"] is True
        assert report["projection"]["sweep"] == "sweep-test", (
            "the job id must become the sweep stamp, or a label cannot be dated"
        )
        assert any("community" in s for s in statements), (
            "no label Cypher reached the driver: the sweep asked for a partition only"
        )

    def test_the_scheduler_resolves_the_new_scope_with_what_it_offers(self):
        # The contract test's loop covers this once the scope is scheduled; this
        # duplicate is deliberate belt-and-braces for the one scope this file owns.
        from modules import research_schedule

        fn, name = research_schedule._resolve("communities")
        assert name == "reconcile_communities"
        assert getattr(research_reconcile, name) is fn


class TestTheDeclaredCadences:
    def test_each_scope_runs_at_its_declared_cadence(self):
        """Lives here, not in test_research_schedule.py, because that file sits
        at the 400-line ceiling and this file owns the scope that ended the
        one-cadence era: graph reconciles six-hourly, communities daily. A new
        scope must extend this map or fail loudly, never inherit a cadence."""
        from modules.research_schedule import (
            DEFAULT_RECONCILE_SCHEDULES,
            parse_reconcile_schedule,
        )

        hour_ms = 3_600_000.0
        expected = {"graph": 6 * hour_ms, "communities": 24 * hour_ms}
        seen = set()
        for expression in DEFAULT_RECONCILE_SCHEDULES:
            schedule = parse_reconcile_schedule(expression)
            assert schedule.valid, schedule.error
            scope = expression.split(":", 1)[1].split("@", 1)[0]
            seen.add(scope)
            assert schedule.every_ms == expected[scope], f"{scope} drifted from its declared cadence"
        assert seen == set(expected), "a scheduled scope is missing from the cadence map"
