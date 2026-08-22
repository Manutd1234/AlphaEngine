"""The graph arm's fusion, and the traversal filter it can now be pointed at.

Two defects, one seam. The graph's neighbours were APPENDED to an answer as
``connected`` rather than ranked with the other arms, so a document only the
graph could reach could never outrank a weak vector hit however far the vector
arm had reached for that hit. And ``traverse_research_graph`` has taken a
``relations`` filter since the migration that created it, with no caller in this
process able to pass one.

Nothing here is a mock of the thing under test. ``fuse_graph_matches`` is the
real function with real dictionaries, and the traversal assertions run the real
``ResearchRag.connected`` against a stub transport — the network is the only
stand-in, because CI is network-free by construction.

The two invariants worth more than the arithmetic are at the bottom: fusion
never invents a row and never drops one it was given. An arm that can add a
document nobody retrieved, or quietly lose one somebody did, is not a ranking
change — it is a different answer wearing the ranking's name.
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

from modules import research_bm25
from modules.research_graph_fusion import (
    RANK_FIELDS,
    REASON_NO_NEIGHBOURS,
    REASON_UNJOINABLE_CANDIDATES,
    REASON_UNJOINABLE_NEIGHBOURS,
    REASON_UNRANKED_CANDIDATES,
    REASON_UNUSABLE_K,
    fuse_graph_matches,
)
from modules.research_rag import retrieval
from modules.research_rag.writer import ResearchRag

K = research_bm25.RRF_K


def match(identifier: str, *, vector: int | None = None, lexical: int | None = None,
          bm25: int | None = None) -> dict[str, Any]:
    """One row as the ranked arms leave it: 1-based ranks, absent arms as None."""
    return {"id": identifier, "title": f"doc {identifier}",
            "vector_rank": vector, "lexical_rank": lexical, "bm25_rank": bm25}


def neighbour(identifier: str, depth: int = 1, arrived_by: str = "same_data") -> dict[str, Any]:
    """One row as ``traverse_research_graph`` returns it — no score, only an order."""
    return {"id": identifier, "title": f"doc {identifier}", "depth": depth,
            "arrived_by": arrived_by, "evidence": "abcd1234", "path": ["seed", identifier]}


def ids(rows: list[dict[str, Any]]) -> list[str]:
    return [str(row["id"]) for row in rows]


class TestTheSignatureTheRouterWasPromised:
    def test_it_takes_the_two_lists_positionally_and_k_by_keyword(self):
        """A caller that resolves and then raises is the break this pins.

        The router passes ``matches`` and ``neighbours`` positionally. Making
        either keyword-only would import cleanly and fail on every request that
        actually walked the graph.
        """
        parameters = list(inspect.signature(fuse_graph_matches).parameters.values())
        positional = [p for p in parameters if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
        assert [p.name for p in positional] == ["matches", "neighbours"]
        keyword = {p.name: p for p in parameters if p.kind is p.KEYWORD_ONLY}
        assert "rrf_k" in keyword, "the k must be nameable, so a test can vary what a request may not"
        assert keyword["rrf_k"].default == research_bm25.RRF_K

    def test_it_is_reachable_from_retrieval_where_the_arms_are_named(self):
        """``retrieval`` is where a reader looks for the arms; the router imports it from there."""
        assert retrieval.fuse_graph_matches is fuse_graph_matches

    def test_it_joins_at_the_same_k_as_every_other_arm(self):
        """A fourth arm at a different constant is a second fusion wearing the first one's name."""
        assert research_bm25.RRF_K == 60
        _rows, report = fuse_graph_matches([match("a", vector=1)], [neighbour("b")])
        assert report["k"] == 60


class TestTheArithmeticIsReciprocalRankFusion:
    def test_a_neighbour_contributes_one_over_k_plus_its_rank(self):
        rows, report = fuse_graph_matches([match("a", vector=1)], [neighbour("b"), neighbour("c")])
        by_id = {row["id"]: row for row in rows}
        assert by_id["b"]["graph_rank"] == 1
        assert by_id["c"]["graph_rank"] == 2
        assert by_id["b"]["fused_score"] == pytest.approx(1.0 / (K + 1))
        assert by_id["c"]["fused_score"] == pytest.approx(1.0 / (K + 2))
        assert report["ranked"] is True

    def test_a_document_both_arms_found_sums_their_contributions(self):
        rows, _report = fuse_graph_matches([match("a", vector=3, lexical=2)], [neighbour("a")])
        assert rows[0]["fused_score"] == pytest.approx(
            1.0 / (K + 3) + 1.0 / (K + 2) + 1.0 / (K + 1)
        )
        assert rows[0]["graph_rank"] == 1

    def test_a_graph_only_document_can_outrank_a_weak_vector_hit(self):
        """The defect in one assertion.

        `a` is the only thing the vector arm ranked first, `e` is a fifth-place
        hit and nothing else found it, and `g` is what the graph reached first.
        Before fusion `g` could not appear in the ranking at all, whatever `e`
        was worth; RRF at k = 60 puts 1/61 above 1/65 and the order says so.
        """
        rows, report = fuse_graph_matches(
            [match("a", vector=1), match("e", vector=5)], [neighbour("g")],
        )
        assert ids(rows) == ["a", "g", "e"]
        assert report["added"] == 1
        assert report["entered_top"] == 1, "it displaced a row the caller was going to be shown"

    def test_depth_is_not_turned_into_a_score(self):
        """Only the ORDER is the graph's opinion; a two-hop document is not half as relevant.

        Two neighbours at wildly different depths, offered in traversal order,
        score exactly as their positions dictate — no depth term anywhere.
        """
        rows, _report = fuse_graph_matches([], [neighbour("g", depth=1), neighbour("h", depth=4)])
        assert [row["fused_score"] for row in rows] == pytest.approx(
            [1.0 / (K + 1), 1.0 / (K + 2)]
        )

    def test_a_repeated_neighbour_keeps_its_first_and_nearest_rank(self):
        rows, report = fuse_graph_matches(
            [], [neighbour("g", depth=1), neighbour("h"), neighbour("g", depth=3)],
        )
        assert report["neighbours"] == 3, "the offer is reported as it was made"
        assert report["considered"] == 2, "and the distinct ids are what was ranked"
        assert {row["id"]: row["graph_rank"] for row in rows} == {"g": 1, "h": 2}

    def test_the_ordering_is_the_one_the_other_fusion_uses(self):
        """Same key function, so the two fusions cannot drift into different orders."""
        rows, _ = fuse_graph_matches([match("a", vector=2), match("b", vector=1)], [neighbour("c")])
        assert rows == sorted(rows, key=research_bm25._fusion_order)


class TestNullHonesty:
    def test_a_document_the_graph_did_not_reach_keeps_a_null_rank(self):
        rows, _report = fuse_graph_matches([match("a", vector=1)], [neighbour("g")])
        by_id = {row["id"]: row for row in rows}
        assert by_id["a"]["graph_rank"] is None, (
            "0 in a 1-based ranking reads as better than first"
        )

    def test_an_added_row_carries_the_other_arms_as_null_rather_than_absent(self):
        rows, _report = fuse_graph_matches([match("a", vector=1)], [neighbour("g")])
        added = next(row for row in rows if row["id"] == "g")
        for field in RANK_FIELDS:
            assert field in added and added[field] is None, (
                "a reader asking WHICH retriever found this row must be able to see that "
                f"{field} did not"
            )

    def test_the_neighbour_fields_survive_the_fusion(self):
        """The traversal's evidence is why the row is defensible; fusing must not eat it."""
        rows, _report = fuse_graph_matches([], [neighbour("g", arrived_by="promoted_to")])
        assert rows[0]["arrived_by"] == "promoted_to"
        assert rows[0]["path"] == ["seed", "g"]


class TestDecliningIsNotFailing:
    @pytest.mark.parametrize(
        ("matches", "neighbours", "reason"),
        [
            ([match("a", vector=1)], [], REASON_NO_NEIGHBOURS),
            ([{"title": "no id"}], [neighbour("g")], REASON_UNJOINABLE_CANDIDATES),
            ([match("a", vector=1)], [{"title": "no id"}], REASON_UNJOINABLE_NEIGHBOURS),
            ([{"id": "a", "similarity": 0.9}], [neighbour("g")], REASON_UNRANKED_CANDIDATES),
        ],
    )
    def test_each_refusal_names_itself_and_returns_the_rows_untouched(self, matches, neighbours, reason):
        rows, report = fuse_graph_matches(matches, neighbours)
        assert rows == matches, "a refusal must return the caller's ordering exactly as it was"
        assert report["ranked"] is False
        assert report["reason"] == reason
        assert report["detail"], "a reason a caller branches on still needs prose it can print"

    def test_the_dense_only_path_is_declined_by_name_rather_than_reordered(self):
        """Fusing there would rank the whole answer by the graph alone.

        These rows carry no rank from any arm — only a similarity — so the only
        ordering they have is the one the dense RPC returned. ``_match_arms``
        declines BM25 on exactly these rows for exactly this reason.
        """
        dense = [{"id": "a", "similarity": 0.91}, {"id": "b", "similarity": 0.88}]
        rows, report = fuse_graph_matches(dense, [neighbour("g")])
        assert ids(rows) == ["a", "b"], "the similarity ordering is the only one this path has"
        assert report["reason"] == REASON_UNRANKED_CANDIDATES
        assert report["added"] == 0

    def test_an_unusable_k_is_reported_rather_than_divided_by(self):
        rows, report = fuse_graph_matches([match("a", vector=1)], [neighbour("g")], rrf_k=0)
        assert rows == [match("a", vector=1)]
        assert report["reason"] == REASON_UNUSABLE_K

    def test_a_refusal_carries_the_same_keys_as_a_success(self):
        """One shape either way, the discipline ``research_bm25._unavailable`` keeps."""
        _rows, declined = fuse_graph_matches([match("a", vector=1)], [])
        _rows, ranked = fuse_graph_matches([match("a", vector=1)], [neighbour("g")])
        assert set(declined) == set(ranked)
        assert declined["added"] == 0 and declined["considered"] == 0

    def test_an_empty_answer_may_still_be_ranked_by_the_graph_alone(self):
        """There is no incumbent ordering to damage, and the rows were going to be shown anyway."""
        rows, report = fuse_graph_matches([], [neighbour("g"), neighbour("h")])
        assert ids(rows) == ["g", "h"]
        assert report["ranked"] is True and report["matches"] == 0


class TestItNeverInventsARowAndNeverDropsOne:
    CASES = [
        ([match("a", vector=1), match("b", lexical=2)], [neighbour("b"), neighbour("c")]),
        ([match("a", vector=1)], [neighbour("a")]),
        ([], [neighbour("g"), neighbour("g")]),
        ([match("a", vector=1), match("b", vector=2)], [neighbour("c"), neighbour("d"), neighbour("c")]),
    ]

    @pytest.mark.parametrize(("matches", "neighbours"), CASES)
    def test_every_row_it_was_given_is_still_there(self, matches, neighbours):
        rows, _report = fuse_graph_matches(matches, neighbours)
        assert set(ids(matches)) <= set(ids(rows))
        assert set(ids(neighbours)) <= set(ids(rows))

    @pytest.mark.parametrize(("matches", "neighbours"), CASES)
    def test_it_holds_nothing_that_came_from_neither_side(self, matches, neighbours):
        rows, report = fuse_graph_matches(matches, neighbours)
        assert set(ids(rows)) == set(ids(matches)) | set(ids(neighbours))
        assert len(rows) == len(set(ids(rows))), "a document may appear once, however many arms found it"
        assert report["fused"] == len(rows) == report["matches"] + report["added"]

    @pytest.mark.parametrize(("matches", "neighbours"), CASES)
    def test_the_counts_in_the_report_are_the_rows_on_the_table(self, matches, neighbours):
        _rows, report = fuse_graph_matches(matches, neighbours)
        assert report["joined"] + report["added"] == report["considered"]
        assert report["neighbours"] == len(neighbours)
        assert report["entered_top"] <= report["added"]

    def test_a_row_the_graph_agrees_with_is_moved_not_duplicated(self):
        """Agreement between arms promotes a document; it never adds a second copy of it.

        `b` leads on the vector arm alone. `a` is ninth there and first in the
        graph, and 1/69 + 1/61 beats 1/61 — so the answer reorders, and it still
        holds exactly two rows.
        """
        candidates = [match("a", vector=9), match("b", vector=1)]
        rows, report = fuse_graph_matches(candidates, [neighbour("a")])
        assert ids(rows) == ["a", "b"], "the arms agreeing on a document must move it up"
        assert len(rows) == 2
        assert report["joined"] == 1 and report["added"] == 0


class _Response:
    def __init__(self, status: int, payload: Any) -> None:
        self.status_code = status
        self._payload = payload

    def json(self) -> Any:
        return self._payload


class _Client:
    """Records the traversal payload, which is the whole point of these two tests."""

    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []

    async def post(self, path: str, json: dict[str, Any] | None = None) -> _Response:
        assert path.endswith("traverse_research_graph"), path
        self.payloads.append(json or {})
        return _Response(200, [neighbour("g")])


def _rag(client: _Client) -> ResearchRag:
    rag = ResearchRag()
    rag.enabled = True
    rag._client = client
    return rag


class TestTheTraversalFilterIsReachableAtLast:
    """The CTE has taken ``relations public.research_relation[]`` since 20260820090500."""

    async def test_a_relation_list_reaches_the_rpc(self):
        client = _Client()
        out = await _rag(client).connected("seed", relations=["promoted_to", "followed_by"])
        assert out["state"] == "ok"
        assert client.payloads[0]["relations"] == ["promoted_to", "followed_by"]

    async def test_no_filter_and_an_empty_filter_both_traverse_everything(self):
        """``[]`` is normalised to absent, never sent.

        An empty ``research_relation[]`` is not "no filter" in the CTE — the
        function tests ``relations is null``, so an empty array would match no
        relation at all and the walk would return nothing while looking like a
        successful traversal of an unconnected document.
        """
        client = _Client()
        await _rag(client).connected("seed")
        await _rag(client).connected("seed", relations=[])
        assert all("relations" not in payload for payload in client.payloads)
