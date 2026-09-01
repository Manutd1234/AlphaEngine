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

from types import SimpleNamespace

import pytest
from research_graph_read_model_support import DESK, SWEEP, Record
from research_graph_read_model_support import FakeDriver as FakeDriver
from research_graph_read_model_support import FakeSession as FakeSession
from research_graph_read_model_support import _Session as _Session
from research_graph_read_model_support import centrality_answer as centrality_answer
from research_graph_read_model_support import communities_answer as communities_answer
from research_graph_read_model_support import corpus as corpus
from research_graph_read_model_support import graph as graph
from research_graph_read_model_support import networkx_required as networkx_required

from modules import research_graph_read_model as rm
from modules import research_graph_reads as gr
from modules import research_quota_scope as scope_module


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


@networkx_required
class TestTenantScopedProjection:
    def test_every_scoped_query_constrains_all_nodes_it_reads(self):
        assert "d.desk_id = $desk_id" in rm.READ_COMMUNITIES
        assert "d.desk_id = $desk_id" in rm.READ_CENTRALITY
        for statement in (
            rm.READ_COMMUNITY_RELATIONS,
            rm.COUNT_COMMUNITY_PAIRS,
            rm.COUNT_CENTRALITY_PAIRS,
        ):
            assert "a.desk_id = $desk_id AND b.desk_id = $desk_id" in statement, (
                "a relationship query scoped only at one endpoint can leak the other desk's node"
            )

    def test_both_read_models_apply_the_desk_predicate(self, graph, monkeypatch):
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        community_driver = graph(communities_answer())

        community = rm.community_labels()
        assert community["detected"] is True
        assert all(params.get("desk_id") == DESK for params in community_driver._session.params)
        assert "a.desk_id = $desk_id AND b.desk_id = $desk_id" in " ".join(
            community_driver._session.statements
        )

        centrality_driver = graph(centrality_answer())
        centrality = rm.centrality_scores()
        assert centrality["ranked"] is True
        assert all(params.get("desk_id") == DESK for params in centrality_driver._session.params)

    def test_legacy_unscoped_nodes_are_refused_until_rebuilt(self, graph, monkeypatch):
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        # A real scoped Cypher query returns no rows for legacy nodes that have
        # no desk_id. The empty answer is a named fallback, never global data.
        graph({"d.community AS community": [], "type(r) AS relation": [],
               "count(DISTINCT": [Record(n=0)]})
        community = rm.community_labels()
        assert not community["detected"]
        assert "has not run" in community["reason"]

    def test_a_missing_desk_refuses_before_opening_the_driver(self, monkeypatch):
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        monkeypatch.setattr(rm, "settings", SimpleNamespace(
            neo4j_database="neo4j", supabase_desk_id="",
        ))
        monkeypatch.setattr(rm, "_driver", lambda: (_ for _ in ()).throw(
            AssertionError("a scoped request with no desk opened the graph"),
        ))

        community = rm.community_labels()
        centrality = rm.centrality_scores()
        assert not community["detected"] and not centrality["ranked"]
        assert "SUPABASE_DESK_ID is empty" in community["reason"]
        assert "SUPABASE_DESK_ID is empty" in centrality["reason"]

    async def test_reports_fall_back_to_the_desk_filtered_corpus(self, corpus, monkeypatch):
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        store = corpus()

        community = await gr.community_report(project=False)
        centrality = await gr.centrality_report()

        # The fake graph fixture is not configured in this test, so the read
        # model falls back. What matters here is that the fallback stays scoped.
        assert community["source"] == centrality["source"] == "corpus"
        assert store.requests
        assert all(request["desk_id"] == f"eq.{DESK}" for request in store.requests)
