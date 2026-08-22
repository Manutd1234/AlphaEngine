"""The graph arm, fused into the ranking rather than appended after it.

``research_rag.retrieval.connected`` answers "what is reachable from this", and
until this module existed the router put those rows in a separate ``connected``
list beside the ranked ones. That placement is the defect. A document only the
graph can reach — the incident that FOLLOWED a promotion, the run that shared a
data hash — could never outrank a weak vector hit, because it was never in the
same ordering to be compared: it sat below the answer in a list of its own,
whatever the other arms had actually found.

Fusing it makes the comparison possible. A neighbour ranked first by the
traversal contributes ``1/(60 + 1)`` exactly as a document ranked first by the
dense arm does, and it out-scores a document that only one arm ranked fifth.
That is the whole point: three arms with different recall, one order.

WHY RRF AND NOT A WEIGHT. The obvious alternative is a tuned blend — 0.6 of the
similarity plus 0.4 of something derived from depth. It needs the arms' scores
to be comparable, and they are not: cosine similarity over gte-small runs in a
compressed band near 0.73-0.9 (see ``RAG_MIN_SIMILARITY``), BM25 is unbounded
and set-relative, and a traversal has no score at all — only a depth and an
order. RRF needs nothing but the ranks, which is why the two Postgres arms, the
BM25 arm and now this one all join on the same terms.

THE SAME k, DELIBERATELY. ``RRF_K`` is imported from ``research_bm25`` rather
than restated: k = 60 is what ``match_research_documents_hybrid`` uses, what
``web/lib/retrieval-eval.ts`` uses, and what the BM25 arm uses. A fourth arm
joining at a different constant is a second fusion wearing the first one's name,
and the argument is the same one that module makes.

WHAT THE TRAVERSAL'S ORDER MEANS. ``traverse_research_graph`` returns one row
per document at the SHORTEST depth it was reached, ordered by depth and then by
recency. Position in that list is therefore a genuine ranking — nearer first —
and it is the only ranking the graph states. Depth is NOT converted into a
score here: a two-hop document is not "half as relevant" as a one-hop one by any
measurement this desk has taken, and inventing that number would put a
fabricated weight into the one arm that has no scores to argue with.

DECLINING IS NOT FAILING, and never rewriting the answer is the guarantee. Every
refusal returns the caller's rows UNCHANGED and names its reason in the shape
the BM25 arm uses (``ranked: False`` plus a ``reason`` a caller branches on and
a ``detail`` it prints), because an arm that declines is a state of the search
rather than an error. The two invariants ``tests/test_research_graph_fusion.py``
pins are that fusion never invents a row and never drops one it was given.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from modules.research_bm25 import RRF_K, _fusion_order

#: The rank fields the other three arms write. Read rather than trusted: a row's
#: incoming ``fused_score`` may have been computed before the graph arm existed,
#: so the score is rebuilt from the ranks that are actually on the row and the
#: graph's contribution added to that. One formula, in one place.
RANK_FIELDS = ("vector_rank", "lexical_rank", "bm25_rank")

#: The field this arm writes. 1-based, like every other rank in the fusion, and
#: ``None`` — never 0 — for a document the traversal did not reach, because 0 in
#: a 1-based ranking reads as "better than first".
GRAPH_RANK = "graph_rank"

#: Named reasons. A caller branches on these; ``detail`` is what it prints.
REASON_NO_NEIGHBOURS = "no_neighbours"
REASON_UNJOINABLE_CANDIDATES = "candidates_without_ids"
REASON_UNJOINABLE_NEIGHBOURS = "neighbours_without_ids"
REASON_UNRANKED_CANDIDATES = "candidates_without_ranks"
REASON_UNUSABLE_K = "unusable_rrf_k"


def _report(
    reason: str | None,
    detail: str | None,
    *,
    k: int,
    matches: int,
    offered: int,
    considered: int = 0,
    joined: int = 0,
    added: int = 0,
    entered_top: int = 0,
    fused: int | None = None,
) -> dict[str, Any]:
    """One report shape for both outcomes, so a caller reads one shape either way.

    Same discipline as ``research_bm25._unavailable``: a refusal carries the
    same keys as a success with its counters at zero, and never a key the other
    lacks. ``fused`` defaults to ``matches`` because a refusal returns the rows
    it was handed, unchanged and in their original order.
    """
    return {
        "ranked": reason is None,
        "reason": reason,
        "detail": detail,
        "k": k,
        # Offered by the traversal, before duplicates are collapsed.
        "neighbours": offered,
        # Distinct ids that were actually given a graph rank.
        "considered": considered,
        # Of those, how many the ranked arms had already found. A high number
        # is not waste: it is the graph agreeing with retrieval, and it moves
        # those documents UP rather than adding anything.
        "joined": joined,
        # Rows only the graph could reach. This is the arm's whole contribution
        # to recall, and it is the number that was zero before fusion existed.
        "added": added,
        # Of the added rows, how many landed inside the incumbent ranking's own
        # width — i.e. would displace a row a caller asking for the same number
        # of results was going to show. "Entered the top" measured against the
        # answer that existed, since this function is not told the caller's k.
        "entered_top": entered_top,
        "matches": matches,
        "fused": matches if fused is None else fused,
    }


def _scored(row: Mapping[str, Any], graph_rank: int | None, k: int) -> dict[str, Any]:
    """One fused row: every rank it carries, summed as ``1/(k + rank)``.

    An arm that did not rank this document contributes NOTHING rather than a
    penalty — the same rule ``research_bm25.fuse`` states, and for the same
    reason: penalising absence turns the fusion into an AND across arms with
    very different recall, which deletes exactly the documents a third and
    fourth arm were added to find.
    """
    ranks = [row.get(field) for field in RANK_FIELDS]
    ranks.append(graph_rank)
    return {
        **row,
        GRAPH_RANK: graph_rank,
        # A row no arm ranked scores 0.0 — a sum of no contributions, not a
        # missing measurement coerced to zero. Its rank fields stay None, so the
        # absence is still readable off the row itself.
        "fused_score": sum(1.0 / (k + rank) for rank in ranks if rank is not None),
    }


def _ranked_neighbours(neighbours: Sequence[Mapping[str, Any]]) -> tuple[dict[Any, int], dict[Any, dict[str, Any]]]:
    """Graph ranks by id, and the first row seen for each id.

    FIRST SIGHTING WINS. The CTE already returns one row per document at its
    shortest depth, so a repeat can only come from a caller concatenating two
    walks — and there the nearer one is the one that arrived first. Re-ranking
    on the later sighting would quietly demote a one-hop document because some
    other seed reached it in three.
    """
    ranks: dict[Any, int] = {}
    rows: dict[Any, dict[str, Any]] = {}
    for neighbour in neighbours:
        identifier = neighbour["id"]
        if identifier in ranks:
            continue
        ranks[identifier] = len(ranks) + 1
        rows[identifier] = dict(neighbour)
    return ranks, rows


def fuse_graph_matches(
    matches: list[dict],
    neighbours: list[dict],
    *,
    rrf_k: int = RRF_K,
) -> tuple[list[dict], dict]:
    """Fuse graph neighbours into the ranked matches by RRF at the same k, returning (fused_rows, report).

    ``matches`` are the rows the ranked arms produced, carrying whichever of
    ``vector_rank``, ``lexical_rank`` and ``bm25_rank`` their path stated.
    ``neighbours`` are ``traverse_research_graph`` rows, in the order it
    returned them — nearest first.

    The output holds EVERY row it was given and every distinct neighbour, and
    nothing else: fusion may reorder an answer and may add a document the graph
    reached, and it may never drop one. Rows the graph did not reach keep
    ``graph_rank: None``.

    Four refusals, each returning ``matches`` untouched:

    * no neighbours at all — the traversal found nothing, or was never run;
    * a row on either side with no ``id`` — nothing can be joined or deduplicated
      without one, and a ``KeyError`` here would turn a search that works today
      into a 500;
    * matches that carry no rank from any arm. That is the dense-only path, and
      fusing there would rank the whole answer by the GRAPH alone, discarding the
      similarity ordering that is the only ordering that path has. ``_match_arms``
      declines the BM25 arm on the same rows for the same reason;
    * a k that cannot be fused at, which is a caller's mistake reported rather
      than a ZeroDivisionError raised inside a request.
    """
    rows = list(matches)
    offered = list(neighbours)
    if rrf_k < 1:
        detail = f"rrf_k={rrf_k} is below 1, and 1/(k + rank) is not a fusion term at that value"
        return rows, _report(REASON_UNUSABLE_K, detail, k=rrf_k, matches=len(rows), offered=len(offered))
    if not offered:
        detail = "the traversal offered no neighbour, so there was no graph ranking to fuse"
        return rows, _report(REASON_NO_NEIGHBOURS, detail, k=rrf_k, matches=len(rows), offered=0)
    if any(not isinstance(row, Mapping) or row.get("id") is None for row in rows):
        detail = "a ranked row carried no id, so the graph ranking could not be joined to it"
        return rows, _report(REASON_UNJOINABLE_CANDIDATES, detail, k=rrf_k, matches=len(rows), offered=len(offered))
    if any(not isinstance(row, Mapping) or row.get("id") is None for row in offered):
        detail = "a neighbour carried no id, so it could not be ranked or deduplicated"
        return rows, _report(REASON_UNJOINABLE_NEIGHBOURS, detail, k=rrf_k, matches=len(rows), offered=len(offered))
    if rows and not any(row.get(field) is not None for row in rows for field in RANK_FIELDS):
        detail = (
            "the ranked rows carry no rank from any arm (the dense-only path), so fusing would "
            "order the answer by the graph alone and discard the similarity ordering"
        )
        return rows, _report(REASON_UNRANKED_CANDIDATES, detail, k=rrf_k, matches=len(rows), offered=len(offered))

    ranks, first_seen = _ranked_neighbours(offered)
    held = {row["id"] for row in rows}
    fused = [_scored(row, ranks.get(row["id"]), rrf_k) for row in rows]
    added: list[dict[str, Any]] = []
    for identifier, rank in ranks.items():
        if identifier in held:
            continue
        # The three ranks are written as None rather than left absent: a caller
        # reading a row to say WHICH retriever found it must be able to see that
        # the dense and lexical arms did not, and a missing key and a null read
        # the same way only until somebody defaults one of them.
        added.append(_scored({field: None for field in RANK_FIELDS} | first_seen[identifier], rank, rrf_k))
    fused.extend(added)
    fused.sort(key=_fusion_order)

    width = len(rows) or len(fused)
    added_ids = {row["id"] for row in added}
    entered_top = sum(1 for row in fused[:width] if row["id"] in added_ids)
    return fused, _report(
        None, None, k=rrf_k, matches=len(rows), offered=len(offered),
        considered=len(ranks), joined=len(ranks) - len(added), added=len(added),
        entered_top=entered_top, fused=len(fused),
    )
