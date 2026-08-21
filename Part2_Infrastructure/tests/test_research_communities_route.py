"""`GET /api/research/graph/communities`, pinned to the sweep behind it.

`modules/research_communities.py` arrived with twenty-three tests and no caller,
and `modules/research_graph_reads.py` gave it a fetch but no route. Neither of
those suites could say whether anything on the HTTP surface ever asks for a
partition — the shape of defect `tests/test_research_contract.py` exists for.

So the route here is the real route, the reader is the real reader, and Louvain
is the real Louvain. Two things are faked and both of them are the network:
PostgREST, because CI has none, and the Neo4j driver, which is faked in order to
prove it is never REACHED. A GET that wrote community labels would be a GET with
a side effect, and any prefetch or retry would repartition the desk's graph.

The route's sibling seam — the fields the search route publishes — is in
`tests/test_research_search_route.py`.
"""

from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from test_research_graph_reads import DESK, TRIANGLES, FakePostgrest

import main
from modules import research_graph_projection as gp
from modules import research_graph_reads as reads
from modules.api import research as api_research


@pytest.fixture
def client():
    """No lifespan: no feeds, no bot, no drain task — just the routes."""
    return TestClient(main.app)


@pytest.fixture
def edges(monkeypatch):
    """A configured corpus whose PostgREST is a fake, and a Neo4j that records being touched."""
    touched: list[str] = []
    monkeypatch.setattr(gp, "_driver", lambda: (touched.append("driver"), (None, "recorded"))[1])

    def _serve(rows=TRIANGLES):
        store = FakePostgrest(rows)
        monkeypatch.setattr(reads, "settings", SimpleNamespace(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="sb_secret_test",
            supabase_desk_id=DESK, supabase_timeout_s=5.0,
        ))
        monkeypatch.setattr(reads, "httpx", SimpleNamespace(
            AsyncClient=lambda **_: _Session(store),
        ))
        return SimpleNamespace(store=store, touched=touched)

    return _serve


class _Session:
    """`community_report` opens its client as an async context manager."""

    def __init__(self, store) -> None:
        self._store = store

    async def __aenter__(self):
        return self._store

    async def __aexit__(self, *_):
        return False


def communities(client) -> dict:
    response = client.get("/api/research/graph/communities")
    assert response.status_code == 200, response.text
    return response.json()


class TestTheCommunitiesRouteIsReachable:
    def test_the_literal_path_is_not_swallowed_by_the_document_id_route(self, client, edges):
        """The ordering trap, asserted on the SHAPE rather than the status code.

        `/api/research/graph/{document_id}` declared first would match this URL
        with `document_id="communities"` and answer 200 with a neighbour list —
        a wrong shape under a right status code.
        """
        body = communities(client)
        assert body["scope"] == "communities"
        assert "connected" not in body, "the traversal route answered instead"

    def test_the_partition_is_louvain_over_the_rows_the_reader_walked(self, client, edges):
        served = edges()
        body = communities(client)

        assert body["read"]["read"] is True and body["read"]["pages"] == 1
        assert body["detection"]["detected"] is True
        assert body["detection"]["community_count"] == 2, "the two disjoint triangles"
        assert body["detection"]["documents"] == 6
        assert served.store.requests, "the edge read never happened"

    def test_nothing_numpy_reaches_the_serialiser(self, client, edges):
        """`modularity` is cast to float in the module; this is where that pays.

        A numpy scalar would not have survived the response, so reading the
        value back out of parsed JSON is the assertion.
        """
        edges()
        modularity = communities(client)["detection"]["modularity"]
        assert isinstance(modularity, float) and modularity > 0.0

    def test_a_read_only_route_writes_no_labels(self, client, edges):
        served = edges()
        body = communities(client)

        assert served.touched == [], "a GET reached for the Neo4j driver"
        assert body["projection"]["projected"] is False
        assert "partition only" in body["projection"]["reason"]
        assert body["projection"]["sweep"] == body["sweep"], "the sweep stamp ties the two together"

    def test_an_unconfigured_corpus_is_reported_rather_than_raised(self, client, monkeypatch):
        monkeypatch.setattr(reads, "settings", SimpleNamespace(
            supabase_url="", supabase_service_role_key="",
            supabase_desk_id=DESK, supabase_timeout_s=5.0,
        ))
        body = communities(client)

        assert body["read"]["read"] is False
        assert body["detection"]["detected"] is False
        assert "SUPABASE_URL" in body["detection"]["reason"]

    def test_a_refusal_omits_the_measurements_it_did_not_take(self, client, monkeypatch):
        """Absent, not null. A null modularity is the one somebody reads `?? 0`."""
        monkeypatch.setattr(reads, "settings", SimpleNamespace(
            supabase_url="", supabase_service_role_key="",
            supabase_desk_id=DESK, supabase_timeout_s=5.0,
        ))
        body = communities(client)

        assert "modularity" not in body["detection"]
        assert "labelled" not in body["projection"]


class TestTheRouterStillBootsWithoutTheOptionalExtras:
    """`import main` cannot prove this on every machine, so the source is read.

    `modules/api/research.py` now reaches four optional dependencies through the
    modules that own them — fastembed for the cross-encoder, google-genai for
    generation, networkx for Louvain, the neo4j driver for the projection — and
    every one of them is reached LAZILY, inside a function. A module-level
    import of any of them anywhere on this router's path stops the gateway
    booting for want of a feature it is not using.

    A boot check would catch that only on a machine where the package is
    missing, and this one has networkx and neo4j installed. Reading the import
    statements is what makes the guard hold everywhere.
    """

    def test_the_research_router_names_no_optional_package_at_module_level(self):
        tree = ast.parse(Path(api_research.__file__).read_text())
        top = [node for node in tree.body if isinstance(node, ast.Import | ast.ImportFrom)]
        names = [alias.name for node in top for alias in getattr(node, "names", [])]
        names += [node.module or "" for node in top if isinstance(node, ast.ImportFrom)]

        for optional in ("fastembed", "networkx", "neo4j", "google"):
            assert not any(optional in name for name in names), (
                f"{optional} is imported at module level by the research router ({names})"
            )
