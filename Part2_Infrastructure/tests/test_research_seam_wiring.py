"""Four seams the parallel build left unwired, each pinned at the JOIN.

This repo has a documented scar — `tests/test_research_contract.py` states it —
about modules shipping fully tested with no caller: two suites green, both sides
perfect, and nothing between them. Every test here is therefore about a CALL,
not a capability. The capability tests already exist and pass; they passed while
all four of these were dead.

1. THE NEO4J READ WAS ON THE EVENT LOOP. `research_graph_reads` called
   `community_labels` / `centrality_scores` — synchronous driver I/O — straight
   out of an `async def`, on the loop that also answers the pre-trade risk
   checks. Proved off it here by making the read BLOCK until a coroutine on that
   loop releases it: if the read is on the loop, nothing releases it and the
   assertion fails with the deadlock, rather than passing on a stub that was
   never slow enough to notice.
2. `desk_id` NEVER REACHED THE RPC. The migration and the route both existed;
   `grep -c desk_id modules/research_rag/retrieval.py` returned 0. Checked by
   reading the payload the client was actually handed.
4. THE `relations` FILTER HAD NO ROUTE. The method took it and the SQL used it;
   no caller could ask.

Seams 2 (the tenant scope) and 3 (the poisoned embed body) are in
`tests/test_research_scope_wiring.py`, which imports the stubs below rather than
restating them — one file of all four crossed the 400-line ceiling
`tests/test_file_size.py` enforces. The split is by seam and the scaffolding
stayed here, where the first seam that needs it is.

Offline, like every test in this suite: the network is stubbed at the client
boundary and the Neo4j read model at its own function. Nothing else is
substituted — the real `research_graph_offload`, the real `_RetrievalMixin`, the
real drain-side `_index_one`, the real FastAPI app.
"""

from __future__ import annotations

import ast
import asyncio
import json
import re
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
import modules.research_graph_read_model as read_model
import modules.research_graph_reads as reads
import modules.research_rag.writer as rag_module
from modules import research_graph_offload as offload
from modules.research_graph_projection import RELATION_TYPES
from modules.research_graph_relations import RELATIONS
from modules.research_rag import EMBEDDING_DIMENSIONS, get_rag, reset_rag

DESK = "00000000-0000-0000-0000-0000000000aa"
QUERY = "deflated sharpe drawdown sweep"
DOCUMENT_ID = "11111111-1111-1111-1111-111111111111"
EMBED_PATH = "/functions/v1/embed-research"
INSERT_PATH = "/rest/v1/research_documents"
MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"


class _Settings:
    """`writer.py` is the package's only reader of `settings`."""

    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_test"
    research_rag_enabled = True
    supabase_desk_id = DESK
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 10


class Reply:
    def __init__(self, payload, status_code: int = 200, headers=None, *, poisoned: bool = False):
        self.status_code = status_code
        self._payload = payload
        self._poisoned = poisoned
        self.headers = headers or {}

    def json(self):
        if self._poisoned:
            # Exactly what httpx raises for an HTML body served under a 200: a
            # JSONDecodeError, which is a ValueError and is not an HTTPError.
            raise json.JSONDecodeError("Expecting value", "<html>502 Bad Gateway</html>", 0)
        return self._payload


class Corpus:
    """Supabase at the HTTP boundary, keeping every payload it was handed.

    The scope, the relation filter and the poisoned body are only observable
    here. A stub that answered without recording would let a route claim an
    argument it never sent, which is the whole failure this file is about.
    """

    def __init__(self, *, hybrid_status: int = 200, embed_poisoned: bool = False,
                 rpc_poisoned: bool = False) -> None:
        self.hybrid_status = hybrid_status
        self.embed_poisoned = embed_poisoned
        self.rpc_poisoned = rpc_poisoned
        self.rpc: list[tuple[str, dict]] = []
        self.head_params: list[dict] = []
        self.inserts: list[dict] = []

    async def aclose(self) -> None:
        """`stop()` closes its client; the fake has to be closable too."""

    async def post(self, path, json=None, headers=None):  # noqa: A002 - httpx's kwarg
        if path.endswith(EMBED_PATH):
            if self.embed_poisoned:
                return Reply(None, 200, poisoned=True)
            return Reply({"embeddings": [[0.02] * EMBEDDING_DIMENSIONS for _ in json["texts"]]})
        if path == INSERT_PATH:
            self.inserts.append(dict(json or {}))
            return Reply([], 201)
        name = path.rsplit("/", 1)[-1]
        self.rpc.append((name, dict(json or {})))
        if name == "match_research_documents_hybrid" and self.hybrid_status != 200:
            return Reply(None, self.hybrid_status)
        if self.rpc_poisoned:
            return Reply(None, 200, poisoned=True)
        return Reply([])

    async def head(self, path, params=None, headers=None):
        self.head_params.append(dict(params or {}))
        return Reply(None, headers={"content-range": "0-0/412"})

    def payload(self, name: str) -> dict:
        for called, body in self.rpc:
            if called == name:
                return body
        raise AssertionError(f"{name} was never called; the recorded calls were {[c for c, _ in self.rpc]}")


@pytest.fixture
def corpus(monkeypatch):
    """A `ResearchRag` reachable through `get_rag()`, wired to a recording stub."""
    reset_rag()
    monkeypatch.setattr(rag_module, "settings", _Settings())
    stub = Corpus()
    get_rag()._client = stub
    yield stub
    reset_rag()


@pytest.fixture
def client():
    return TestClient(main.app)


# --------------------------------------------------------------------------- #
# 1. The Neo4j read is off the event loop
# --------------------------------------------------------------------------- #
class TestTheGraphReadIsOffTheLoop:
    def _labels(self):
        return {"detected": True, "sweep": "sweep-1", "communities": [], "pairs": 0}

    def _scores(self):
        return {"ranked": True, "sweep": "sweep-1", "scores": []}

    def test_the_community_read_cannot_block_the_loop(self, monkeypatch):
        """The read waits on the loop, and the loop has to keep running to free it.

        A stub that merely records its thread would pass against a read that was
        FAST enough not to matter today and slow tomorrow. This one is a
        deadlock detector: `blocking_read` cannot return until `ticker` runs, and
        `ticker` cannot run if the read holds the loop. `released.wait` is
        bounded so a regression fails in five seconds with a clear assertion
        instead of hanging CI.
        """
        released = threading.Event()
        seen: dict[str, object] = {}

        def blocking_read(*, writing=False, offered=True):
            seen["thread"] = threading.current_thread()
            seen["freed"] = released.wait(timeout=5.0)
            return self._labels()

        monkeypatch.setattr(read_model, "community_labels", blocking_read)
        ticks: list[int] = []

        async def ticker():
            for i in range(3):
                await asyncio.sleep(0)
                ticks.append(i)
            released.set()

        async def scenario():
            report, _ = await asyncio.gather(reads.community_report(project=False), ticker())
            return report

        report = asyncio.run(scenario())

        assert seen["freed"] is True, (
            "the loop never ran while the Neo4j read was in flight — the read is ON the loop, "
            "which is the loop this process answers pre-trade risk checks on"
        )
        assert ticks == [0, 1, 2]
        assert seen["thread"] is not threading.main_thread()
        assert report["source"] == "neo4j"
        assert report["sweep"] == "sweep-1"

    def test_the_centrality_read_cannot_block_the_loop(self, monkeypatch):
        """The sibling route, pinned identically — one wired seam is not two."""
        released = threading.Event()
        seen: dict[str, object] = {}

        def blocking_read(*, offered=True):
            seen["thread"] = threading.current_thread()
            seen["freed"] = released.wait(timeout=5.0)
            return self._scores()

        monkeypatch.setattr(read_model, "centrality_scores", blocking_read)

        async def scenario():
            async def ticker():
                await asyncio.sleep(0)
                released.set()

            report, _ = await asyncio.gather(reads.centrality_report(), ticker())
            return report

        report = asyncio.run(scenario())

        assert seen["freed"] is True, "the centrality read is still on the event loop"
        assert seen["thread"] is not threading.main_thread()
        assert report["source"] == "neo4j"

    def test_no_more_than_two_reads_occupy_the_executor_at_once(self, monkeypatch):
        """The bulkhead, measured rather than read off the constant.

        `asyncio.to_thread` hands work to ONE shared default executor, so an
        unbounded path through it lets N concurrent GETs pin N of its workers.
        The peak is asserted from both sides: at most two, or the bound does not
        hold, and at least two, or the calls were never concurrent and this
        proves nothing about a bulkhead.
        """
        lock = threading.Lock()
        state = {"now": 0, "peak": 0}

        def slow_read(*, offered=True):
            with lock:
                state["now"] += 1
                state["peak"] = max(state["peak"], state["now"])
            time.sleep(0.02)
            with lock:
                state["now"] -= 1
            return self._scores()

        monkeypatch.setattr(read_model, "centrality_scores", slow_read)

        async def scenario():
            await asyncio.gather(*(reads.centrality_report() for _ in range(6)))

        asyncio.run(scenario())

        assert state["peak"] == 2, f"the bulkhead let {state['peak']} reads into the executor at once"

    def test_the_reads_module_no_longer_reaches_the_read_model_directly(self):
        """The import, not the behaviour — a direct call would be a new blocking path.

        Read off the AST rather than by grepping the text, because this file's
        own docstring names `research_graph_read_model` and a text search would
        be satisfied by prose.
        """
        tree = ast.parse(Path(reads.__file__).read_text())
        modules = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        assert "modules.research_graph_read_model" not in modules
        assert "modules.research_graph_offload" in modules

    def test_the_offload_calls_the_module_attribute_and_not_a_bound_copy(self, monkeypatch):
        """Patching the read model must reach the thing the wrapper runs.

        If `research_graph_offload` had imported the two functions by name at
        import time, a stub installed on `research_graph_read_model` would be
        ignored and the real driver would still be dialled — the exact shape of
        bug where a test looks green and the deployment reaches Aura.
        """
        monkeypatch.setattr(read_model, "centrality_scores", lambda *, offered=True: self._scores())
        assert asyncio.run(offload.centrality_scores())["ranked"] is True


# --------------------------------------------------------------------------- #
# 4. The relations filter has a caller
# --------------------------------------------------------------------------- #
class TestTheRelationFilterIsReachable:
    def test_the_route_forwards_the_filter_to_the_traversal(self, client, corpus):
        response = client.get(
            f"/api/research/graph/{DOCUMENT_ID}",
            params=[("relations", "followed_by"), ("relations", "promoted_to")],
        )

        assert response.status_code == 200
        assert corpus.payload("traverse_research_graph")["relations"] == ["followed_by", "promoted_to"]

    def test_asking_for_nothing_traverses_everything(self, client, corpus):
        """The key is left OFF, never sent as an empty array.

        `relations = '{}'` matches no edge at all, so an empty array would answer
        "this document is connected to nothing" — a lie about the corpus wearing
        a successful status code.
        """
        response = client.get(f"/api/research/graph/{DOCUMENT_ID}")

        assert response.status_code == 200
        assert "relations" not in corpus.payload("traverse_research_graph")

    def test_a_relation_postgres_has_never_heard_of_is_refused_at_the_door(self, client, corpus):
        """422 here rather than `invalid input value for enum` as a 500 there."""
        response = client.get(f"/api/research/graph/{DOCUMENT_ID}", params={"relations": "banana"})

        assert response.status_code == 422
        assert corpus.rpc == [], "a refused request must not have reached the corpus"

    def test_the_route_vocabulary_matches_postgres_and_the_projection(self):
        """The drift this Literal is allowed to exist in exchange for catching.

        Three statements of one enum — the migration, `RELATION_TYPES`, and the
        route's `Literal` — and this is where they are made to agree. An
        `assert` at import would have caught it too, and would have taken a
        gateway that also serves the pre-trade risk checks down to do it.
        """
        sql = (MIGRATIONS / "20260820090400_research_edges.sql").read_text()
        declared = sql[sql.index("create type public.research_relation"):]
        declared = declared[:declared.index(");")]
        from_sql = set(re.findall(r"'([a-z_]+)'", declared))

        assert set(RELATIONS) == from_sql
        assert set(RELATIONS) == set(RELATION_TYPES)
