"""Community detection over the research graph — the capability the projection promised.

`modules/research_graph_projection.py` argues that Neo4j earns its place because
a recursive CTE cannot do community detection — Louvain, Leiden, PageRank — and
that the GraphRAG pattern this desk is built toward needs community summaries
and macro-level synthesis across documents that never mention one another. That
argument is still correct about the CTE. This module is the other half of it:
the partition itself, computed over the SAME derived edges the projection
copies, and returned as a report rather than written anywhere.

Why the algorithm runs here and not in the database
---------------------------------------------------

Neo4j's Louvain and PageRank live in the Graph Data Science library, which is an
Enterprise product. The Aura Free tier this desk is wired to does not have it,
so `CALL gds.louvain.stream(...)` on that instance is a procedure-not-found
error rather than a slow query — a fact worth writing down, because the obvious
next commit after a projection lands is one that assumes GDS is there.

networkx is pure Python: no compiler, no CUDA, no server-side plugin, no
licence. It reads the edge list the projection already assembles, partitions it
in process, and hands back a plain dict. So community detection is available on
the free tier, in CI, and on a laptop with no Neo4j at all — which is why this
module takes `edges` as an argument instead of a driver. Neo4j's remaining job
is to HOLD the labels (see the integration note at the foot of this docstring),
not to compute them.

The ceiling is honest and worth naming: this partitions in memory, so it is
bounded by what one process can hold. At the corpus size this desk is at, that
is not close. When it is, GDS — or Leiden, which networkx does not ship — is the
escalation, and it will need Enterprise.

Determinism, because a community id gets cited
-----------------------------------------------

Louvain is a randomised algorithm: it visits nodes in a shuffled order and the
partition it settles on depends on that order. Left unseeded, two sweeps over an
unchanged corpus return different communities with different ids, and a research
note that says "cluster 3" means nothing a week later. Everything here is
therefore pinned: a fixed `SEED`, nodes and edges inserted in a canonical sorted
order so the graph is identical whatever order the caller's rows arrived in, and
communities sorted largest-first before ids are handed out.

What that buys is reproducibility for a FIXED edge set. It is not stability
across edge sets — adding one document can legitimately merge two clusters and
renumber everything after them. Cite a community by its members, or by (sweep,
id) together; never by the bare integer.

Absence is a state, not a failure
---------------------------------

An uninstalled networkx is the normal deployment: `requirements-communities.txt`
is optional and the suite passes without it. It is reported in the same shape
the projection uses for an unset ``NEO4J_URI`` — a named reason, never an
exception. And an empty edge list is NOT that: it is a successful partition of
nothing, ``detected: True`` with zero communities. "Could not detect" and "there
was nothing to detect" are different facts and a caller must be able to branch
on the flag rather than read the prose.

Modularity is the one measurement here, and it is absent rather than zero when
it does not exist. networkx divides by twice the edge count, so a graph with no
ties raises ZeroDivisionError; reporting 0.0 instead would tell a reader "we
partitioned this and the partition is worthless", when the truth is "there was
nothing to partition". The key is omitted, and callers must treat its absence as
a state rather than defaulting it.

Writing the labels back to Neo4j
--------------------------------

Deliberately not done here — this module reads and returns, exactly like the
projection reads Postgres and writes Neo4j in one direction only. A caller that
wants the labels queryable projects them itself, as a node property, from the
report:

    UNWIND $rows AS row
    MATCH (d:Document {id: row.id})
    SET d.community = row.community, d.community_sweep = $sweep

with one row per member per community. The `community_sweep` stamp is what makes
the renumbering above survivable: a label with no sweep attached cannot be told
apart from a stale one.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

#: The Louvain seed. Any fixed integer would do — the point is that it is fixed
#: and written down, not which one. Chosen as the date the graph plane landed so
#: that a future change to it is visibly a deliberate act rather than a tidy-up.
#:
#: Changing this REPARTITIONS the corpus: every community id may move, and every
#: note citing one goes stale. It is configuration in the sense that a schema
#: version is configuration.
SEED = 20260821

#: Louvain's resolution. Above 1.0 finds more, smaller communities; below, fewer
#: and larger. Left at the definition's own default because this desk has no
#: measured basis for another value yet — a threshold tuned to make today's
#: corpus look tidy is a description of today's corpus, not a threshold.
RESOLUTION = 1.0

#: PageRank's damping factor, the probability the random walker follows an edge
#: rather than teleporting. 0.85 is the value the original paper used and every
#: comparison in the literature assumes; moving it would make this desk's
#: centrality scores incomparable with anybody's, for no gain.
DAMPING = 0.85

#: Power-iteration budget and tolerance, and they are ONE decision rather than
#: two. The error of the k-th iterate falls as roughly ``DAMPING ** k``, so
#: networkx's defaults (100 iterations, tol 1e-6) leave 0.85**100 ≈ 1.9e-7 of
#: headroom and no more. Tightening the tolerance to 1e-8 without moving the
#: budget makes a star — one hub document joined to four leaves, which is
#: precisely the shape `rank_documents` exists to find — fail to converge and
#: refuse. MEASURED on that graph: 100 iterations raise, 150 converge, and the
#: scores at 150, 200 and 500 are identical to every digit.
#:
#: 200 is that measurement with room over it. The tighter tolerance is worth the
#: iterations because it is what makes two runs agree in the last decimal place,
#: and a ranking whose scores wobble is a ranking nobody can diff.
MAX_ITER = 200
TOLERANCE = 1.0e-8


def _networkx() -> tuple[Any, str | None]:
    """The networkx module, or a reason it is not available.

    Imported inside the function on purpose. `requirements-communities.txt` is
    optional, and a module-level import would mean the gateway does not boot for
    want of a feature it is not using — the same rule the Neo4j driver follows
    in `research_graph_projection`.
    """
    try:
        import networkx as nx
    except ImportError:
        return None, "the networkx package is not installed (pip install -r requirements-communities.txt)"
    return nx, None


def _unavailable(reason: str) -> dict[str, Any]:
    """The shape every refusal takes. Never raises, never reports success.

    No ``modularity`` key: nothing was measured, and a null measurement invites
    the ``?? 0`` that turns "we do not know" into "it is fine".
    """
    return {
        "detected": False,
        "reason": reason,
        "documents": 0,
        "edges": 0,
        "communities": [],
        "community_count": 0,
        "singletons": 0,
    }


def _unranked(reason: str) -> dict[str, Any]:
    """The refusal shape for `rank_documents`. Empty ranking, never fake scores."""
    return {
        "ranked": False,
        "reason": reason,
        "documents": 0,
        "edges": 0,
        "ranking": [],
    }


def _build(nx: Any, edges: list[dict[str, Any]]) -> tuple[Any, dict[str, int]]:
    """An undirected weighted graph over `edges`, built in a canonical order.

    Three decisions, each of which changes the partition:

    DIRECTION IS DISCARDED. Modularity is an undirected notion, and so is the
    question being asked — ``followed_by`` joins two documents whichever way the
    arrow points. Keeping direction would make Louvain silently symmetrise it
    anyway, one layer further from where a reader could see it happen.

    PARALLEL EDGES BECOME WEIGHT. Two documents joined by ``same_symbol`` AND
    ``same_data`` AND ``same_strategy`` are more strongly related than two joined
    by one relation, and a plain ``Graph`` would keep only whichever arrived
    last. Summing them into a weight is the only reading that does not throw
    away the corpus's own evidence.

    INSERTION IS SORTED. Louvain's node visit order comes from the graph's
    adjacency dicts, which are insertion-ordered, so an unsorted build makes the
    partition a function of the order the caller's rows happened to arrive in.
    Sorting by ``str`` rather than natively because document ids are opaque and
    a mixed-type id list would otherwise raise on comparison.

    The returned counts are what the input was before the algorithm saw it. They
    exist so that a dropped edge is visible in the report rather than silently
    absent from the graph.
    """
    weights: dict[tuple[Any, Any], int] = {}
    relations: dict[tuple[Any, Any], Counter] = {}
    nodes: set[Any] = set()
    counts = {"self_loops": 0, "malformed": 0, "unlabelled": 0}

    for edge in edges:
        src, dst = edge.get("src_id"), edge.get("dst_id")
        if not src or not dst:
            # An edge missing an endpoint joins nothing. Counted rather than
            # ignored: a corpus quietly shedding edges looks exactly like a
            # corpus with fewer relations in it.
            counts["malformed"] += 1
            continue
        nodes.add(src)
        nodes.add(dst)
        if src == dst:
            # A self-loop adds no tie but the document is real, so the node
            # stays and lands in a community of its own. Kept out of the graph
            # because a loop inflates weighted degree, which shifts modularity
            # for a relation that connects nothing.
            counts["self_loops"] += 1
            continue
        key = (src, dst) if str(src) <= str(dst) else (dst, src)
        weights[key] = weights.get(key, 0) + 1
        relation = edge.get("relation")
        if relation:
            relations.setdefault(key, Counter())[relation] += 1
        else:
            # The tie is still real; it just has no relation to attribute. It
            # counts toward weight and toward no relation total, and is reported
            # so nobody reads a short tally as a missing edge.
            counts["unlabelled"] += 1

    graph = nx.Graph()
    graph.add_nodes_from(sorted(nodes, key=str))
    for key in sorted(weights, key=lambda pair: (str(pair[0]), str(pair[1]))):
        graph.add_edge(*key, weight=float(weights[key]), relations=dict(relations.get(key, {})))
    return graph, counts


def _summarise(graph: Any, partition: list[set[Any]]) -> list[dict[str, Any]]:
    """One row per community: members, size, and what actually holds it together.

    The relation tally counts only INTERNAL ties — edges with both endpoints in
    the community — because that is what the community is made of. Counting the
    edges leaving it would describe the boundary instead, which is a different
    question and one nothing here asks.

    Ordered largest-first, ties broken by first member, so ids are positions in a
    total order rather than whatever order Louvain returned its sets in.
    `dominant_relations` is a LIST because a genuine tie between two relation
    types is common in this corpus and picking one arbitrarily would invent a
    fact; an empty list means the community has no internal ties at all.
    """
    rows: list[dict[str, Any]] = []
    for members in partition:
        ordered = sorted(members, key=str)
        tally: Counter = Counter()
        for _src, _dst, data in graph.subgraph(members).edges(data=True):
            tally.update(data.get("relations") or {})
        top = max(tally.values(), default=0)
        rows.append({
            "members": ordered,
            "size": len(ordered),
            "relations": dict(sorted(tally.items())),
            "dominant_relations": sorted(name for name, n in tally.items() if n == top) if top else [],
        })
    rows.sort(key=lambda row: (-row["size"], str(row["members"][0]) if row["members"] else ""))
    return [{"id": index, **row} for index, row in enumerate(rows)]


def detect_communities(
    edges: list[dict[str, Any]],
    *,
    seed: int = SEED,
    resolution: float = RESOLUTION,
) -> dict[str, Any]:
    """Partition the derived edges into communities with Louvain.

    `edges` are the rows `research_graph.persist_edges` derives and
    `research_graph_projection.project` copies: ``src_id``, ``dst_id`` and
    ``relation``. Nothing is read from Postgres or Neo4j here — the caller owns
    the fetch, which is what lets this function be tested against a literal.

    Returns a report, never an exception. Community detection is analysis, and
    analysis that takes down the caller is worse than analysis that reports it
    could not run. ``modularity`` is present only when the graph has at least one
    tie; see the module docstring for why its absence is deliberate.
    """
    nx, reason = _networkx()
    if nx is None:
        return _unavailable(reason or "networkx is unavailable")

    graph, counts = _build(nx, edges)
    try:
        partition = nx.community.louvain_communities(
            graph, weight="weight", resolution=resolution, seed=seed
        )
        # Guarded rather than caught: networkx divides by twice the edge count,
        # so an edgeless graph raises. The guard is what keeps "no modularity"
        # a state instead of an error, and 0.0 out of the report entirely.
        modularity = (
            float(nx.community.modularity(graph, partition, weight="weight", resolution=resolution))
            if graph.number_of_edges()
            else None
        )
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return _unavailable(f"{type(exc).__name__} detecting communities: {exc}")

    communities = _summarise(graph, partition)
    report: dict[str, Any] = {
        "detected": True,
        "reason": None,
        "documents": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "communities": communities,
        "community_count": len(communities),
        "singletons": sum(1 for row in communities if row["size"] == 1),
        "seed": seed,
        "resolution": resolution,
        **counts,
    }
    if modularity is not None:
        report["modularity"] = modularity
    return report


def rank_documents(edges: list[dict[str, Any]], *, damping: float = DAMPING) -> dict[str, Any]:
    """Rank documents by PageRank — the most central research artefacts first.

    Centrality answers a question Louvain does not: within or across communities,
    which documents does the corpus keep coming back to? A backtest whose data
    hash, symbol and strategy each pull in a different neighbourhood outranks one
    that sits in a single cluster, and that is the artefact a synthesis should
    open with.

    NO SEED PARAMETER, and that is not an omission. PageRank as networkx
    implements it has no random element: power iteration from a uniform start,
    stopped on a fixed tolerance. Its determinism comes from `_build`'s canonical
    node order and from `MAX_ITER`/`TOLERANCE` being pinned here. A `seed=`
    argument that controlled nothing would be worse than none — it reads like a
    guarantee.

    Scores are returned as an ORDERED list rather than a mapping. The order is
    the product, and a dict invites a caller to look one document up and quote
    its score as though the number meant anything on its own; it does not, only
    the ranking does.
    """
    nx, reason = _networkx()
    if nx is None:
        return _unranked(reason or "networkx is unavailable")

    graph, counts = _build(nx, edges)
    try:
        scores = nx.pagerank(
            graph, alpha=damping, weight="weight", max_iter=MAX_ITER, tol=TOLERANCE
        )
    except Exception as exc:  # noqa: BLE001 - a failure to converge is a report, not a raise
        return _unranked(f"{type(exc).__name__} ranking documents: {exc}")

    ranking = [
        {"id": node, "score": float(score)}
        for node, score in sorted(scores.items(), key=lambda item: (-item[1], str(item[0])))
    ]
    return {
        "ranked": True,
        "reason": None,
        "documents": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "damping": damping,
        "ranking": ranking,
        **counts,
    }
