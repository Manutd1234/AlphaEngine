"""Fakes and fixtures shared by the Neo4j read-model behaviour tests.

The fake transport stays here while the assertions stay in the test module:
one fixture models a Neo4j driver/session and the other the authoritative
PostgREST fallback.  Neither replaces the report assembly under test.
"""

from __future__ import annotations

from importlib.util import find_spec
from types import SimpleNamespace
from typing import Any

import pytest
from test_research_graph_reads import DESK, TRIANGLES, FakePostgrest

from modules import research_graph_read_model as rm
from modules import research_graph_reads as gr

networkx_required = pytest.mark.skipif(
    find_spec("networkx") is None,
    reason="networkx is not installed (pip install -r requirements-communities.txt)",
)

SWEEP = "2026-08-22T00:00:00.000Z"


class Record(dict):
    """A Neo4j Record is a mapping with ``keys()`` and ``get()``; this is one."""


class FakeSession:
    """Answer Cypher by fragment and retain every statement and parameter."""

    def __init__(self, answers: dict[str, Any], *, fail_on: str | None = None) -> None:
        self.answers = answers
        self.fail_on = fail_on
        self.statements: list[str] = []
        self.params: list[dict[str, Any]] = []

    def run(self, cypher: str, **params: Any) -> Any:
        self.statements.append(cypher)
        self.params.append(params)
        if self.fail_on and self.fail_on in cypher:
            raise RuntimeError("the graph went away mid-read")
        for fragment, answer in self.answers.items():
            if fragment in cypher:
                return answer
        raise AssertionError(f"the reader ran a statement the fake was not given: {cypher}")

    def __enter__(self) -> FakeSession:
        return self

    def __exit__(self, *_: Any) -> bool:
        return False


class FakeDriver:
    def __init__(self, session: FakeSession) -> None:
        self._session = session
        self.closed = False

    def session(self, **_: Any) -> FakeSession:
        return self._session

    def close(self) -> None:
        self.closed = True


def communities_answer(sweep: str = SWEEP) -> dict[str, Any]:
    """The two triangles, as the graph holds them after a sweep labelled them."""
    return {
        "d.community AS community": [
            Record(community=0, sweep=sweep, members=["a", "b", "c"]),
            Record(community=1, sweep=sweep, members=["x", "y", "z"]),
        ],
        "type(r) AS relation": [
            Record(community=0, relation="SAME_SYMBOL", n=2),
            Record(community=0, relation="SAME_DATA", n=1),
            Record(community=1, relation="SAME_STRATEGY", n=3),
        ],
        "count(DISTINCT": [Record(n=6)],
    }


def centrality_answer(sweep: str = SWEEP) -> dict[str, Any]:
    """One triangle scored, with its three possible undirected pairs."""
    return {
        "d.centrality AS score": [
            Record(id="a", score=0.4, sweep=sweep),
            Record(id="b", score=0.35, sweep=sweep),
            Record(id="c", score=0.25, sweep=sweep),
        ],
        "count(DISTINCT": [Record(n=3)],
    }


class _Session:
    def __init__(self, store: FakePostgrest) -> None:
        self._store = store

    async def __aenter__(self) -> FakePostgrest:
        return self._store

    async def __aexit__(self, *_: Any) -> bool:
        return False


@pytest.fixture
def graph(monkeypatch):
    """A configured Neo4j whose answers each test chooses."""

    def _serve(answers: dict[str, Any], *, fail_on: str | None = None) -> FakeDriver:
        session = FakeSession(answers, fail_on=fail_on)
        driver = FakeDriver(session)
        monkeypatch.setattr(rm, "_driver", lambda: (driver, None))
        monkeypatch.setattr(
            rm,
            "settings",
            SimpleNamespace(neo4j_database="neo4j", supabase_desk_id=DESK),
        )
        return driver

    return _serve


@pytest.fixture
def corpus(monkeypatch):
    """A configured PostgREST corpus for the real fallback path."""

    def _serve(rows=TRIANGLES) -> FakePostgrest:
        store = FakePostgrest(rows)
        monkeypatch.setattr(
            gr,
            "settings",
            SimpleNamespace(
                supabase_url="https://example.supabase.co",
                supabase_service_role_key="sb_secret_test",
                supabase_desk_id=DESK,
                supabase_timeout_s=5.0,
            ),
        )
        monkeypatch.setattr(gr, "httpx", SimpleNamespace(AsyncClient=lambda **_: _Session(store)))
        return store

    return _serve
