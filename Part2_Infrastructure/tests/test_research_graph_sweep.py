"""The daily sweep writes BOTH label sets, which is what makes the read path reachable.

`research_graph_read_model` reads ``d.community`` and ``d.centrality`` back out
of Neo4j. Neither is worth anything if nothing writes them, and the centrality
half had no writer at all until `project_centrality` — so the route would have
fallen back to an in-process PageRank forever, against a graph sitting there
holding half the sweep's answer and nothing saying so.

The scar this file exists for is the one `tests/test_research_centrality_route.py`
names: a module can ship fully tested with no caller, and its own suite cannot
notice. So these assertions are about the WIRING — that the sweep's edges reach
both writers off one read, that the job id becomes both sweep stamps, and that
the rank travels beside the score. The only stand-ins are the network: a fake
PostgREST and a recording Neo4j driver.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from test_research_graph_read_model import networkx_required
from test_research_graph_reads import DESK, TRIANGLES, FakePostgrest

from modules import research_graph_reads as gr


class _Session:
    """`community_report` opens its corpus client as an async context manager."""

    def __init__(self, store) -> None:
        self._store = store

    async def __aenter__(self):
        return self._store

    async def __aexit__(self, *_):
        return False


@pytest.fixture
def corpus(monkeypatch):
    """A configured PostgREST corpus. Declared here rather than imported: a fixture
    imported by name is a module-level rebinding of it, and the argument of the same
    name in every test below then shadows the import."""
    def _serve(rows=TRIANGLES) -> FakePostgrest:
        store = FakePostgrest(rows)
        monkeypatch.setattr(gr, "settings", SimpleNamespace(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="sb_secret_test",
            supabase_desk_id=DESK, supabase_timeout_s=5.0,
        ))
        monkeypatch.setattr(gr, "httpx", SimpleNamespace(AsyncClient=lambda **_: _Session(store)))
        return store

    return _serve


@networkx_required
class TestTheSweepWritesBothLabelSets:
    async def test_the_daily_sweep_scores_as_well_as_partitions(self, monkeypatch, corpus):
        """The wiring that makes the centrality read path reachable at all.

        Without a writer, ``d.centrality`` is never set, ``centrality_scores``
        always refuses with "the sweep has not ranked this graph yet", and the
        route falls back forever to a PageRank the projection could have served.
        """
        from modules import research_graph_projection as gp

        written: list[tuple[str, list[dict]]] = []

        class _Recording:
            def run(self, cypher, **params):
                written.append((cypher, list(params.get("rows") or [])))
                return SimpleNamespace(single=lambda: {"n": len(params.get("rows") or [])})

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        monkeypatch.setattr(gp, "_driver", lambda: (
            SimpleNamespace(session=lambda **_: _Recording(), close=lambda: None), None))
        corpus()

        out = await gr.community_report(project=True, sweep="sweep-under-test")
        assert out["projection"]["projected"] is True
        assert out["centrality_projection"]["projected"] is True
        assert out["centrality_projection"]["sweep"] == "sweep-under-test"

        scored = [rows for cypher, rows in written if "d.centrality" in cypher]
        assert scored, "no centrality Cypher reached the driver: the read model would stay empty"
        assert sorted(row["id"] for batch in scored for row in batch) == ["a", "b", "c", "x", "y", "z"]
        assert all(isinstance(row["score"], float) for batch in scored for row in batch)
        assert [row["rank"] for batch in scored for row in batch] == [1, 2, 3, 4, 5, 6], (
            "the ORDER is the product; a score with no rank beside it makes a reader re-derive it"
        )

    async def test_the_sweeps_scores_are_stripped_out_of_the_report_it_returns(self, monkeypatch, corpus):
        from modules import research_graph_projection as gp

        monkeypatch.setattr(gp, "_driver", lambda: (None, "no driver here"))
        corpus()
        out = await gr.community_report(project=True, sweep="sweep-under-test")
        assert "ranking" not in out["centrality"], "a whole-corpus ranking is a payload, not a report"
        assert out["centrality"]["ranked"] is True
        assert out["centrality_projection"]["projected"] is False
        assert "no driver" in out["centrality_projection"]["reason"]
