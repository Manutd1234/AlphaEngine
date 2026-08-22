"""The edge count served beside a partition, and the arithmetic that refutes it.

Live, on 2026-08-23, ``GET /api/research/graph/communities`` and
``/centrality`` both served this:

    "source":"neo4j","sweep":"7f9a972a4c53","documents":7,"edges":44

Seven documents admit C(7,2) = 21 undirected pairs. Forty-four is not a big
number here, it is an IMPOSSIBLE one, and the field was self-refuting on its
face for anybody who did the sum.

The cause was one missing predicate. ``COUNT_PAIRS`` matched
``(a:Document)-[r]->(b:Document)`` with no scope at all, so it counted every
Document pair in the Aura instance — 25 nodes, 17 of them test fixtures MERGEd
in by past runs, and 32 of the 44 pairs carried by ``SAME_DATA`` and
``FOLLOWED_BY`` relationships that have no rows in the corpus — and the result
was printed beside ``documents``, which is the sum of the LABELLED community
sizes. Two populations, served as one graph's two measurements.

The numbers move with the store and the defect does not, which is the reason
this file asserts an inequality and not a constant. Measured the same day, one
projection sweep later, the unscoped query served 51 edges over 8 documents —
C(8,2) = 28, impossible again — while the scoped query read 11, which is
exactly the pair count of the authoritative ``research_edges`` corpus over
those 8 documents. The drop is the fix, not a loss of edges.

What is asserted here, and why in this order:

* the RESPONSE is coherent — ``edges <= C(documents, 2)`` on the served pair of
  numbers, whatever query produced them. This is the check that would have
  caught the defect the day it shipped: it is total, it is arithmetic, and it
  needs no fixture of the corpus to run against;
* the count the reader RUNS is the scoped one, so the constant cannot be
  correct while the statement sent to Neo4j is not;
* the boundary is not off by one. A complete graph is legal and must not be
  refused, or the guard would start rejecting the small dense corpora this desk
  actually has.

The PageRank scores are deliberately untouched and untested here.
``project_centrality`` takes a finished report rather than an edge list, so the
polluted count fed no computation; the ranking is read on the same path and is
the same before and after.
"""

from __future__ import annotations

from importlib.util import find_spec
from types import SimpleNamespace
from typing import Any

import pytest
from test_research_graph_read_model import (
    SWEEP,
    FakeDriver,
    FakeSession,
    Record,
    _Session,
    centrality_answer,
    communities_answer,
)
from test_research_graph_reads import DESK, TRIANGLES, FakePostgrest

from modules import research_graph_read_model as rm
from modules import research_graph_reads as gr

networkx_required = pytest.mark.skipif(
    find_spec("networkx") is None,
    reason="networkx is not installed (pip install -r requirements-communities.txt)",
)


# The fakes and the answers are imported; the two fixtures are declared here
# rather than imported, because a fixture reached by import is shadowed by the
# test parameter of the same name and ruff reads that, correctly, as a
# redefinition. Same transport, same records, one file's worth of wiring.
@pytest.fixture
def graph(monkeypatch):
    """A configured Neo4j whose answers each test chooses."""
    def _serve(answers: dict[str, Any]) -> FakeDriver:
        driver = FakeDriver(FakeSession(answers))
        monkeypatch.setattr(rm, "_driver", lambda: (driver, None))
        monkeypatch.setattr(rm, "settings", SimpleNamespace(neo4j_database="neo4j"))
        return driver

    return _serve


@pytest.fixture
def corpus(monkeypatch):
    """A configured PostgREST corpus, so a refused read has somewhere to fall back TO."""
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


def pairs_ceiling(documents: int) -> int:
    """C(n, 2) — the most undirected pairs ``documents`` nodes can hold."""
    return documents * (documents - 1) // 2


def served(report: dict[str, Any]) -> tuple[int, int]:
    """The two numbers whose relationship is the invariant."""
    return report["edges"], report["documents"]


class TestTheServedNumbersCohere:
    def test_a_count_over_more_pairs_than_the_documents_admit_is_refused(self, graph):
        """The live payload, as a fixture: 7 documents, 44 edges.

        Refused rather than served with a caveat. An edge count is how a reader
        tells a partition of the corpus from a partition of a fragment, and one
        that cannot describe the node set beside it is not a weak measurement,
        it is a measurement of something else.
        """
        answers = communities_answer()
        answers["d.community AS community"] = [
            Record(community=0, sweep=SWEEP, members=["a", "b", "c", "d"]),
            Record(community=1, sweep=SWEEP, members=["w", "x", "y"]),
        ]
        answers["count(DISTINCT"] = [Record(n=44)]
        graph(answers)
        out = rm.community_labels()
        assert out["detected"] is False, "44 edges over 7 documents was served for weeks"
        assert "44 edges over 7 documents" in out["reason"]
        assert "21" in out["reason"], "the reason must state the ceiling the reader can check"
        assert out["edges"] == 0 and out["communities"] == [], "a refusal measures nothing"

    def test_an_impossible_count_refuses_the_ranking_too(self, graph):
        answers = centrality_answer()
        answers["count(DISTINCT"] = [Record(n=44)]
        graph(answers)
        out = rm.centrality_scores()
        assert out["ranked"] is False
        assert "44 edges over 3 documents" in out["reason"]

    def test_the_invariant_holds_on_the_partition_that_is_served(self, graph):
        graph(communities_answer())
        edges, documents = served(rm.community_labels())
        assert edges <= pairs_ceiling(documents), (
            "the response is the thing that has to be coherent; a correct query behind an "
            "incoherent payload is not a fix"
        )

    def test_the_invariant_holds_on_the_ranking_that_is_served(self, graph):
        graph(centrality_answer())
        edges, documents = served(rm.centrality_scores())
        assert edges <= pairs_ceiling(documents)

    def test_a_complete_graph_is_not_refused(self, graph):
        """The boundary, from the legal side: C(6,2) = 15 over the two triangles.

        A guard that rejected equality would refuse exactly the dense corpora
        this desk has most of, and would have been discovered as a false
        fallback rather than as a wrong number.
        """
        answers = communities_answer()
        answers["count(DISTINCT"] = [Record(n=15)]
        graph(answers)
        out = rm.community_labels()
        assert out["detected"] is True, out["reason"]
        assert out["edges"] == 15

    def test_a_single_document_admits_no_edges(self, graph):
        answers = communities_answer()
        answers["d.community AS community"] = [Record(community=0, sweep=SWEEP, members=["a"])]
        answers["count(DISTINCT"] = [Record(n=1)]
        graph(answers)
        out = rm.community_labels()
        assert out["detected"] is False, "one document has no pair to be joined to"
        assert "at most 0" in out["reason"]


class TestTheCountIsScopedToThePartitionItIsReportedBeside:
    def test_the_community_count_names_both_endpoints_and_the_sweep(self):
        cypher = rm.COUNT_COMMUNITY_PAIRS
        assert "a.community IS NOT NULL" in cypher
        assert "b.community IS NOT NULL" in cypher, (
            "one labelled endpoint is not a pair in the partition; both must be in it"
        )
        assert "a.community_sweep = b.community_sweep" in cypher, (
            "a tie spanning two sweeps belongs to neither partition"
        )

    def test_the_centrality_count_is_keyed_on_the_centrality_sweep(self):
        cypher = rm.COUNT_CENTRALITY_PAIRS
        assert "a.centrality IS NOT NULL" in cypher and "b.centrality IS NOT NULL" in cypher
        assert "a.centrality_sweep = b.centrality_sweep" in cypher
        assert "community" not in cypher, (
            "the two sweeps are written by different calls and either can be the older"
        )

    def test_neither_count_matches_every_document_pair_in_the_instance(self):
        for cypher in (rm.COUNT_COMMUNITY_PAIRS, rm.COUNT_CENTRALITY_PAIRS):
            assert "WHERE" in cypher, (
                "an unscoped MATCH counts the whole database, including fixtures MERGEd in by "
                "test runs, and reports it as this sweep's graph"
            )
            assert "a.id <> b.id" in cypher, (
                "_build drops self-loops before number_of_edges() counts, so a loop counted as "
                "a pair breaks the parity this field claims"
            )

    def test_the_statement_the_reader_runs_is_the_scoped_one(self, graph):
        """A correct constant that nothing sends to Neo4j is a comment."""
        driver = graph(communities_answer())
        rm.community_labels()
        counted = [s for s in driver._session.statements if "count(DISTINCT" in s]
        assert counted == [rm.COUNT_COMMUNITY_PAIRS]
        driver = graph(centrality_answer())
        rm.centrality_scores()
        counted = [s for s in driver._session.statements if "count(DISTINCT" in s]
        assert counted == [rm.COUNT_CENTRALITY_PAIRS]


@networkx_required
class TestTheRouteNeverServesAnImpossibleGraph:
    async def test_the_communities_route_serves_a_coherent_pair_of_numbers(self, graph, corpus):
        graph(communities_answer())
        corpus()
        out = await gr.community_report(project=False)
        edges, documents = served(out["detection"])
        assert edges <= pairs_ceiling(documents)
        assert out["read_model"]["edges"] == edges, "the two copies must not disagree"

    async def test_an_impossible_read_falls_back_rather_than_being_served(self, graph, corpus):
        """The fallback is the right answer here, and it must NAME the arithmetic.

        Falling back to Louvain over the corpus is what every other refusal in
        this reader does, and it keeps a mid-rebuild or a polluted store from
        taking the route offline. What must not happen is the impossible pair
        of numbers reaching the desk under ``source: neo4j``.
        """
        answers = communities_answer()
        answers["count(DISTINCT"] = [Record(n=44)]
        graph(answers)
        store = corpus()
        out = await gr.community_report(project=False)
        assert out["source"] == "corpus"
        assert "44 edges over 6 documents" in out["read_model"]["reason"]
        assert store.requests, "the corpus must actually be read when the graph cannot be trusted"
        edges, documents = served(out["detection"])
        assert edges <= pairs_ceiling(documents)

    async def test_the_centrality_route_serves_a_coherent_pair_of_numbers(self, graph, corpus):
        graph(centrality_answer())
        corpus()
        out = await gr.centrality_report()
        edges, documents = served(out["ranking"])
        assert edges <= pairs_ceiling(documents)
        assert [row["id"] for row in out["ranking"]["ranking"]] == ["a", "b", "c"], (
            "the scores are not this change's business and must come back untouched"
        )
