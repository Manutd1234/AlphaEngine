"""Community detection, tested without a graph database and without a network.

Nothing here talks to Neo4j, and that is the point of the module under test:
Louvain and PageRank run in process over the edge list, so the properties worth
guarding — determinism, the refusal shape, the honesty of a missing measurement
— are all reachable from a literal. A test that needed Aura would not run in CI,
and CI is network-free by construction.

The algorithm tests skip when networkx is absent, exactly as the vectorbt and
scikit-learn suites do for their optional extras. The REFUSAL tests do not skip:
an uninstalled networkx is the case they exist for, and a suite that skipped it
would have no coverage on the deployment shape that is most common.
"""

from __future__ import annotations

import ast
import sys
from importlib.util import find_spec
from pathlib import Path
from types import SimpleNamespace

import pytest

from modules import research_communities as rc

networkx_required = pytest.mark.skipif(
    find_spec("networkx") is None,
    reason="networkx is not installed (pip install -r requirements-communities.txt)",
)

#: Two triangles that share nothing. The partition is not in question — this is
#: the shape every community detector is expected to get right — which is what
#: makes it a usable fixture for everything else the report claims.
TRIANGLES = [
    {"src_id": "a", "dst_id": "b", "relation": "same_symbol"},
    {"src_id": "b", "dst_id": "c", "relation": "same_symbol"},
    {"src_id": "a", "dst_id": "c", "relation": "same_data"},
    {"src_id": "x", "dst_id": "y", "relation": "same_strategy"},
    {"src_id": "y", "dst_id": "z", "relation": "same_strategy"},
    {"src_id": "x", "dst_id": "z", "relation": "same_strategy"},
]

MISSING = "the networkx package is not installed (pip install -r requirements-communities.txt)"


class _LouvainRaises:
    """A networkx whose Louvain blows up, wrapping the real one for everything else.

    Wrapping rather than replacing keeps `_build` on the genuine `Graph`, so the
    test exercises the real path right up to the call that fails — which is what
    makes it evidence about `detect_communities` rather than about the stub.
    """

    def __init__(self, real):
        self._real = real
        self.community = SimpleNamespace(
            louvain_communities=self._boom, modularity=real.community.modularity
        )

    def __getattr__(self, name):
        return getattr(self._real, name)

    @staticmethod
    def _boom(*_args, **_kwargs):
        raise MemoryError("the partition did not fit")


class TestAbsenceIsReportedNeverRaised:
    def test_a_missing_networkx_is_reported_with_the_line_that_fixes_it(self, monkeypatch):
        monkeypatch.setattr(rc, "_networkx", lambda: (None, MISSING))
        out = rc.detect_communities(TRIANGLES)
        assert out["detected"] is False
        assert "requirements-communities.txt" in out["reason"], "the reason must say how to fix it"
        assert out["communities"] == []
        assert "modularity" not in out, (
            "a refusal measured nothing; a null modularity is the value somebody "
            "later defaults to zero"
        )

    def test_the_same_absence_reaches_rank_documents(self, monkeypatch):
        monkeypatch.setattr(rc, "_networkx", lambda: (None, MISSING))
        out = rc.rank_documents(TRIANGLES)
        assert out["ranked"] is False
        assert "requirements-communities.txt" in out["reason"]
        assert out["ranking"] == [], "a refusal must never carry invented scores"

    def test_the_lazy_import_reports_rather_than_raising(self, monkeypatch):
        # None in sys.modules is what an import of an absent package looks like
        # from inside the function, without uninstalling anything.
        monkeypatch.setitem(sys.modules, "networkx", None)
        module, reason = rc._networkx()
        assert module is None
        assert "pip install" in reason

    def test_networkx_is_never_imported_at_module_level(self):
        """The gateway must boot on a desk that has no networkx.

        A module-level import of an optional package takes the whole service
        down for want of a feature it is not using — the defect this test
        exists to prevent, and one that only shows up in an environment nobody
        develops in.
        """
        tree = ast.parse(Path(rc.__file__).read_text())
        top_level = [node for node in tree.body if isinstance(node, ast.Import | ast.ImportFrom)]
        names = [alias.name for node in top_level for alias in getattr(node, "names", [])]
        names += [node.module or "" for node in top_level if isinstance(node, ast.ImportFrom)]
        assert not any("networkx" in name for name in names), (
            f"networkx is imported at module level ({names}); it must be imported inside _networkx"
        )

    @networkx_required
    def test_a_failure_inside_louvain_is_a_report_not_an_exception(self, monkeypatch):
        import networkx

        monkeypatch.setattr(rc, "_networkx", lambda: (_LouvainRaises(networkx), None))
        out = rc.detect_communities(TRIANGLES)
        assert out["detected"] is False
        assert "MemoryError" in out["reason"], "the report must name what went wrong"
        assert out["community_count"] == 0


class TestNothingToDetectIsNotAFailure:
    """The distinction the report shape exists for, one step past the projection."""

    @networkx_required
    def test_an_empty_edge_list_is_a_success_with_zero_communities(self):
        out = rc.detect_communities([])
        assert out["detected"] is True, (
            "an unlinked corpus is a corpus that was partitioned successfully into "
            "nothing; reporting it as a failure hides the real failures"
        )
        assert out["reason"] is None
        assert out["community_count"] == 0
        assert out["communities"] == []

    @networkx_required
    def test_an_empty_edge_list_reports_no_modularity_rather_than_zero(self):
        out = rc.detect_communities([])
        assert "modularity" not in out, (
            "0.0 modularity reads as 'we partitioned this and it is worthless'; the "
            "truth is that an edgeless graph has no modularity at all"
        )

    @networkx_required
    def test_an_empty_edge_list_ranks_successfully_with_an_empty_ranking(self):
        out = rc.rank_documents([])
        assert out["ranked"] is True
        assert out["ranking"] == []
        assert out["reason"] is None


@networkx_required
class TestItFindsTheCommunitiesThatAreThere:
    def test_two_disjoint_triangles_are_exactly_two_communities(self):
        out = rc.detect_communities(TRIANGLES)
        assert out["community_count"] == 2
        assert [row["members"] for row in out["communities"]] == [["a", "b", "c"], ["x", "y", "z"]]
        assert out["documents"] == 6
        assert out["edges"] == 6

    def test_modularity_is_returned_and_is_a_float(self):
        out = rc.detect_communities(TRIANGLES)
        assert isinstance(out["modularity"], float), (
            "a caller judging partition quality needs a number, not a numpy scalar "
            "that will not serialise"
        )
        assert 0.0 < out["modularity"] <= 1.0

    def test_a_community_names_the_relation_that_holds_it_together(self):
        """The macro-level fact a community summary is written from.

        Without it a community is an opaque bag of ids: a reader cannot tell
        whether these six documents cluster because they share a data hash or
        because they share a symbol, and those are different claims.
        """
        out = rc.detect_communities(TRIANGLES)
        by_first = {row["members"][0]: row for row in out["communities"]}
        assert by_first["a"]["dominant_relations"] == ["same_symbol"]
        assert by_first["a"]["relations"] == {"same_data": 1, "same_symbol": 2}
        assert by_first["x"]["dominant_relations"] == ["same_strategy"]

    def test_a_tie_between_relations_reports_both_rather_than_picking_one(self):
        out = rc.detect_communities([
            {"src_id": "a", "dst_id": "b", "relation": "same_data"},
            {"src_id": "b", "dst_id": "c", "relation": "same_symbol"},
        ])
        assert out["communities"][0]["dominant_relations"] == ["same_data", "same_symbol"], (
            "breaking a genuine tie invents a fact about what the community is for"
        )

    def test_an_unlinked_document_is_counted_as_a_singleton(self):
        out = rc.detect_communities(TRIANGLES + [{"src_id": "q", "dst_id": "q", "relation": "same_data"}])
        assert out["community_count"] == 3
        assert out["singletons"] == 1, (
            "singletons are the documents a community summary cannot say anything "
            "about; a count that misses them overstates the coverage of the sweep"
        )
        assert [row["size"] for row in out["communities"]] == [3, 3, 1]


#: Twelve triangles joined in a ring — Louvain's resolution limit, and the only
#: fixture here whose partition the seed can change. Measured: 17 distinct
#: partitions across 40 seeds. `TRIANGLES` cannot serve this purpose no matter
#: how the assertion is written, which is the point the test below records.
AMBIGUOUS = [
    *(
        {"src_id": f"d{c * 3 + i}", "dst_id": f"d{c * 3 + j}", "relation": "same_symbol"}
        for c in range(12)
        for i in range(3)
        for j in range(i + 1, 3)
    ),
    *(
        {"src_id": f"d{c * 3}", "dst_id": f"d{((c + 1) % 12) * 3}", "relation": "same_regime"}
        for c in range(12)
    ),
]


@networkx_required
class TestTheSameCorpusPartitionsTheSameWay:
    """Louvain is randomised. Unseeded, community ids reshuffle between sweeps and
    a note citing one means nothing a week later."""

    def test_the_same_edges_twice_yield_an_identical_report(self):
        assert rc.detect_communities(AMBIGUOUS) == rc.detect_communities(AMBIGUOUS)
        assert rc.rank_documents(AMBIGUOUS) == rc.rank_documents(AMBIGUOUS)

    def test_the_determinism_fixture_is_one_the_seed_can_actually_change(self):
        """Guards the guard above, which was a tautology when first written.

        It originally asserted determinism over `TRIANGLES`, and two disjoint
        triangles have exactly one sensible partition — every seed finds it. The
        assertion held for a graph whose answer the seed could not have changed,
        so replacing `seed=seed` with a random integer left the whole suite
        green. A determinism test on an unambiguous input proves nothing.

        `AMBIGUOUS` is the resolution-limit case: twelve triangles in a ring,
        where merging adjacent triangles and keeping them apart score almost
        identically. Across forty seeds it yields seventeen distinct partitions,
        which is what makes the test above capable of failing.

        This test exists so that property cannot quietly decay — a future edit
        that shrinks the fixture back to something unambiguous fails HERE, with
        a message saying why, rather than silently disarming its neighbour.
        """
        networkx = pytest.importorskip("networkx")
        louvain = pytest.importorskip("networkx.algorithms.community")
        graph, _ = rc._build(networkx, AMBIGUOUS)
        partitions = {
            tuple(sorted(tuple(sorted(c)) for c in louvain.louvain_communities(graph, seed=s)))
            for s in range(40)
        }
        assert len(partitions) > 1, (
            f"AMBIGUOUS produced one partition across 40 seeds, so the determinism "
            f"test above cannot fail. Restore a fixture with genuine partition "
            f"ambiguity ({len(partitions)} distinct partitions found)"
        )

    def test_a_shuffled_edge_list_yields_the_same_partition(self):
        """A partition must not depend on the order rows came back from Postgres.

        `research_edges` has no ORDER BY on the read path, so the same corpus can
        arrive in a different order on the next sweep. Without the canonical
        insertion order in `_build`, that alone would repartition the graph.
        """
        shuffled = list(reversed(TRIANGLES))
        assert rc.detect_communities(shuffled) == rc.detect_communities(TRIANGLES)

    def test_a_different_seed_is_visible_in_the_report(self):
        # The seed is configuration that changes the answer, so it travels with
        # the answer — a partition nobody can reproduce is not evidence.
        assert rc.detect_communities(TRIANGLES, seed=1)["seed"] == 1
        assert rc.detect_communities(TRIANGLES)["seed"] == rc.SEED


@networkx_required
class TestCentrality:
    def test_pagerank_sums_to_approximately_one(self):
        out = rc.rank_documents(TRIANGLES)
        total = sum(row["score"] for row in out["ranking"])
        assert total == pytest.approx(1.0, abs=1e-6), (
            f"PageRank is a probability distribution over documents; {total} means "
            "the walk leaked or the iteration stopped short"
        )

    def test_the_hub_of_a_star_outranks_its_leaves(self):
        """The behaviour the ranking exists for: find the artefact everything touches.

        It also pins MAX_ITER against TOLERANCE. A star is the slowest common
        structure to converge, and at networkx's default budget of 100
        iterations this exact graph raises rather than ranking — so a tolerance
        tightened without moving the budget turns the hub case, of all cases,
        into a refusal.
        """
        star = [{"src_id": "hub", "dst_id": leaf, "relation": "same_data"} for leaf in "abcd"]
        report = rc.rank_documents(star)
        assert report["ranked"] is True, f"the star did not converge: {report['reason']}"
        assert report["ranking"][0]["id"] == "hub"
        assert report["ranking"][0]["score"] > report["ranking"][1]["score"]


@networkx_required
class TestAwkwardEdgesDoNotCrashIt:
    def test_a_self_loop_is_counted_and_leaves_modularity_alone(self):
        """A document linked to itself would inflate its own weighted degree.

        Dropped from the graph but kept as a node, and COUNTED — a silently
        discarded edge looks exactly like an edge that was never derived.
        """
        out = rc.detect_communities([{"src_id": "a", "dst_id": "a", "relation": "same_data"}])
        assert out["detected"] is True
        assert out["self_loops"] == 1
        assert out["documents"] == 1
        assert out["edges"] == 0
        assert "modularity" not in out

    def test_a_duplicate_edge_becomes_one_weighted_tie_rather_than_two(self):
        out = rc.detect_communities([
            {"src_id": "a", "dst_id": "b", "relation": "same_data"},
            {"src_id": "b", "dst_id": "a", "relation": "same_symbol"},
        ])
        assert out["edges"] == 1, "the same pair joined twice is one tie, weighted twice"
        assert out["communities"][0]["relations"] == {"same_data": 1, "same_symbol": 1}, (
            "collapsing the pair must not lose either relation; the tally is what a "
            "community summary is written from"
        )

    def test_an_edge_missing_an_endpoint_is_counted_not_silently_dropped(self):
        out = rc.detect_communities(TRIANGLES + [{"src_id": "a", "dst_id": None, "relation": "same_data"}])
        assert out["malformed"] == 1
        assert out["edges"] == 6, "a half-edge must not become a tie to nothing"
        assert out["detected"] is True

    def test_an_edge_with_no_relation_still_joins_but_names_nothing(self):
        out = rc.detect_communities([{"src_id": "a", "dst_id": "b"}])
        assert out["unlabelled"] == 1
        assert out["edges"] == 1
        assert out["communities"][0]["dominant_relations"] == [], (
            "an unlabelled tie must not be attributed to a relation nobody derived"
        )
