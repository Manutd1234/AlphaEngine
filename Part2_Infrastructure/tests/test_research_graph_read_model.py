"""Reading the projection back, and the fallback that must name why it could not.

Neo4j was WRITE-ONLY. ``_driver()`` had two callers, both writes, and every
request-path answer about communities or centrality was recomputed in-process
from a whole-corpus PostgREST read — so the graph was a store kept in sync that
nothing consulted, which is cost with no retrieval against it.

The transport is faked and nothing else is. ``community_report`` and
``centrality_report`` are the real entry points the routes call, the composite
they build is the real one, the fallback runs the real Louvain and the real
PageRank over the real reader. The fake driver is a driver: it answers Cypher
with records, and it can be told to fail the way a driver fails.

What is asserted here, in order of what would hurt most if it broke:

* the read path is REACHED at all — the defect was that nothing read the graph;
* every refusal falls back and NAMES itself, because "Neo4j is unset", "the
  sweep has not run" and "the projection is mid-rebuild" are three different
  things to fix and only the first is a normal deployment;
* a writer never reads its own output back, which would be a fixpoint: the
  corpus could change every day and the labels never would;
* nothing invented. No modularity, no resolution, no damping — the graph does
  not hold them, and a plausible default is the lie a reader would quote.
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
    """A neo4j Record is a mapping with ``keys()`` and ``get()``; this is one."""


class FakeSession:
    """Answers each Cypher by matching on a fragment of it. Records what it was asked."""

    def __init__(self, answers: dict[str, Any], *, fail_on: str | None = None) -> None:
        self.answers = answers
        self.fail_on = fail_on
        self.statements: list[str] = []

    def run(self, cypher: str, **params: Any) -> Any:
        self.statements.append(cypher)
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
    return {
        "d.centrality AS score": [
            Record(id="a", score=0.4, sweep=sweep),
            Record(id="b", score=0.35, sweep=sweep),
            Record(id="c", score=0.25, sweep=sweep),
        ],
        "count(DISTINCT": [Record(n=6)],
    }


@pytest.fixture
def graph(monkeypatch):
    """A configured Neo4j whose answers each test chooses."""
    def _serve(answers: dict[str, Any], *, fail_on: str | None = None) -> FakeDriver:
        session = FakeSession(answers, fail_on=fail_on)
        driver = FakeDriver(session)
        monkeypatch.setattr(rm, "_driver", lambda: (driver, None))
        monkeypatch.setattr(rm, "settings", SimpleNamespace(neo4j_database="neo4j"))
        return driver

    return _serve


@pytest.fixture
def corpus(monkeypatch):
    """A configured PostgREST corpus, so the fallback has somewhere to fall back TO."""
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


class _Session:
    def __init__(self, store) -> None:
        self._store = store

    async def __aenter__(self):
        return self._store

    async def __aexit__(self, *_):
        return False


class TestTheProjectionIsReadBack:
    def test_the_partition_comes_out_as_the_partition_that_went_in(self, graph):
        graph(communities_answer())
        out = rm.community_labels()
        assert out["detected"] is True, out["reason"]
        assert out["source"] == "neo4j"
        assert out["sweep"] == SWEEP
        assert [row["members"] for row in out["communities"]] == [["a", "b", "c"], ["x", "y", "z"]]
        assert out["community_count"] == 2
        assert out["documents"] == 6
        assert out["edges"] == 6

    def test_a_community_keeps_the_id_the_sweep_wrote(self, graph):
        """Not a position in this list: ``(sweep, community)`` is the citable pair.

        Renumbering by size here would break that pairing for anybody holding a
        label from yesterday's report — the number would still look like a
        community id and would mean a different set.
        """
        graph(communities_answer())
        assert [row["id"] for row in rm.community_labels()["communities"]] == [0, 1]

    def test_the_relation_tally_comes_back_in_the_enum_the_desk_uses(self, graph):
        graph(communities_answer())
        first = rm.community_labels()["communities"][0]
        assert first["relations"] == {"same_data": 1, "same_symbol": 2}, (
            "a Cypher relationship type in a desk report is a name Postgres never used"
        )
        assert first["dominant_relations"] == ["same_symbol"]

    def test_the_ranking_comes_out_in_the_order_the_sweep_wrote(self, graph):
        graph(centrality_answer())
        out = rm.centrality_scores()
        assert out["ranked"] is True, out["reason"]
        assert [row["id"] for row in out["ranking"]] == ["a", "b", "c"]
        assert out["ranking"][0]["score"] == pytest.approx(0.4)
        assert out["sweep"] == SWEEP

    def test_the_driver_is_closed_on_every_path(self, graph):
        opened = graph(communities_answer())
        rm.community_labels()
        assert opened.closed is True
        failed = graph(communities_answer(), fail_on="d.community AS community")
        assert rm.community_labels()["detected"] is False
        assert failed.closed is True, "a read model that leaks a connection per request is worse than none"


class TestNothingIsInvented:
    def test_no_modularity_reaches_a_report_that_did_not_measure_one(self, graph):
        graph(communities_answer())
        out = rm.community_labels()
        for absent in ("modularity", "seed", "resolution"):
            assert absent not in out, (
                f"{absent} was never written to the graph; a plausible default is the value "
                "somebody quotes as though it had been measured"
            )

    def test_no_damping_reaches_a_ranking_read_out_of_the_graph(self, graph):
        graph(centrality_answer())
        assert "damping" not in rm.centrality_scores()

    def test_an_unreadable_edge_count_refuses_rather_than_reporting_zero(self, graph):
        answers = communities_answer()
        answers["count(DISTINCT"] = [Record(n=None)]
        graph(answers)
        out = rm.community_labels()
        assert out["detected"] is False
        assert "edge count" in out["reason"]
        assert out["edges"] == 0 and out["communities"] == [], "a refusal measures nothing"

    def test_a_score_that_is_not_a_number_refuses_the_whole_ranking(self, graph):
        answers = centrality_answer()
        answers["d.centrality AS score"] = [
            Record(id="a", score=0.4, sweep=SWEEP), Record(id="b", score="high", sweep=SWEEP),
        ]
        graph(answers)
        out = rm.centrality_scores()
        assert out["ranked"] is False, "a ranking with rows silently missing is worse than no ranking"
        assert "not a number" in out["reason"]


class TestEveryRefusalNamesItself:
    def test_an_unconfigured_neo4j_names_the_variables(self, monkeypatch):
        monkeypatch.setattr(rm, "_driver", lambda: (
            None, "NEO4J_URI/NEO4J_PASSWORD are unset, so the graph was not projected"))
        assert "NEO4J_URI" in rm.community_labels()["reason"]
        assert "NEO4J_URI" in rm.centrality_scores()["reason"]

    def test_a_missing_driver_names_the_extras_file(self, monkeypatch):
        monkeypatch.setattr(rm, "_driver", lambda: (
            None, "the neo4j driver is not installed (pip install -r requirements-graph.txt)"))
        assert "requirements-graph.txt" in rm.community_labels()["reason"]

    def test_an_empty_projection_says_the_sweep_has_not_run(self, graph):
        graph({"d.community AS community": [], "type(r) AS relation": [], "count(DISTINCT": [Record(n=0)]})
        out = rm.community_labels()
        assert out["detected"] is False
        assert "has not run" in out["reason"], (
            "'the sweep has not run' and 'the corpus has no communities' are different facts"
        )

    def test_a_driver_that_raises_is_a_reason_not_an_exception(self, graph):
        graph(communities_answer(), fail_on="d.community AS community")
        out = rm.community_labels()
        assert out["detected"] is False
        assert "RuntimeError" in out["reason"]

    def test_labels_from_two_sweeps_are_refused_as_mid_rebuild(self, graph):
        """A partial re-label reads as one partition and is two.

        Community ids are stable for a FIXED edge set and not across edge sets,
        so community 1 of Tuesday's sweep and community 1 of Wednesday's are
        different sets of documents. A sweep interrupted halfway leaves exactly
        this, and it is indistinguishable from a good partition unless the
        stamps are checked.
        """
        answers = communities_answer()
        answers["d.community AS community"] = [
            Record(community=0, sweep="sweep-monday", members=["a", "b"]),
            Record(community=1, sweep="sweep-tuesday", members=["x", "y"]),
        ]
        graph(answers)
        out = rm.community_labels()
        assert out["detected"] is False
        assert "mid-rebuild" in out["reason"]

    def test_an_undated_label_is_refused(self, graph):
        answers = communities_answer()
        answers["d.community AS community"] = [Record(community=0, sweep=None, members=["a", "b"])]
        graph(answers)
        assert "sweep stamp" in rm.community_labels()["reason"]

    def test_a_caller_that_asked_for_the_corpus_is_not_served_the_graph(self, graph):
        driver = graph(communities_answer())
        assert rm.community_labels(offered=False)["detected"] is False
        assert rm.centrality_scores(offered=False)["ranked"] is False
        assert driver.closed is False, "the driver must not even be opened"

    def test_a_writer_may_not_read_its_own_output(self, graph):
        """The fixpoint the sweep would become.

        If the sweep read the graph's current partition and wrote it back, the
        corpus could change every day and the labels never would — and every
        report would say ``detected: True`` while nothing had been detected
        since the first run.
        """
        graph(communities_answer())
        out = rm.community_labels(writing=True)
        assert out["detected"] is False
        assert "fixpoint" in out["reason"]


@networkx_required
class TestTheRoutesReadTheGraphAndFallBackWhenTheyCannot:
    async def test_the_communities_route_serves_what_the_projection_holds(self, graph, corpus):
        graph(communities_answer())
        store = corpus()
        out = await gr.community_report(project=False)
        assert out["source"] == "neo4j"
        assert out["detection"]["community_count"] == 2
        assert out["sweep"] == SWEEP
        assert store.requests == [], "the corpus was read anyway, so the projection bought nothing"

    async def test_reading_labels_is_not_writing_them(self, graph, corpus):
        graph(communities_answer())
        corpus()
        out = await gr.community_report(project=False)
        assert out["projection"]["projected"] is False
        assert "READ back" in out["projection"]["reason"]
        assert out["read"]["read"] is False, "no page was fetched, and `read: True` would say one was"

    async def test_a_refused_read_falls_back_to_louvain_and_says_why(self, graph, corpus):
        graph({"d.community AS community": [], "type(r) AS relation": [], "count(DISTINCT": [Record(n=0)]})
        store = corpus()
        out = await gr.community_report(project=False)
        assert out["source"] == "corpus"
        assert out["detection"]["detected"] is True, out["detection"]["reason"]
        assert out["detection"]["community_count"] == 2, "the real Louvain over the real reader"
        assert "has not run" in out["read_model"]["reason"], (
            "a fallback that does not name its reason leaves nobody able to fix it"
        )
        assert store.requests, "the corpus must actually be read when the graph cannot answer"

    async def test_the_centrality_route_serves_the_scores_the_sweep_wrote(self, graph, corpus):
        graph(centrality_answer())
        store = corpus()
        out = await gr.centrality_report()
        assert out["source"] == "neo4j"
        assert [row["id"] for row in out["ranking"]["ranking"]] == ["a", "b", "c"]
        assert store.requests == []

    async def test_centrality_falls_back_to_pagerank_and_says_why(self, graph, corpus):
        graph({"d.centrality AS score": [], "count(DISTINCT": [Record(n=0)]})
        corpus()
        out = await gr.centrality_report()
        assert out["source"] == "corpus"
        assert out["ranking"]["ranked"] is True, out["ranking"].get("reason")
        assert "has not ranked" in out["read_model"]["reason"]

    async def test_a_caller_can_demand_the_corpus_and_be_given_it(self, graph, corpus):
        graph(communities_answer())
        store = corpus()
        out = await gr.community_report(project=False, read_model=False)
        assert out["source"] == "corpus"
        assert store.requests, "read_model=False must reach the edges, not the labels"
        assert "not consulted" in out["read_model"]["reason"]
