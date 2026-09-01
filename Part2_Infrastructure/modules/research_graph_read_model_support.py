"""Cypher and pure decoding helpers for the Neo4j research read model.

The public read decisions remain in :mod:`research_graph_read_model`.  This
module owns the stable query contract and the transformations that need no
configuration, driver or fallback policy.  Keeping those pure pieces together
makes it possible to inspect and test the graph vocabulary without opening a
Neo4j session.
"""

from __future__ import annotations

from typing import Any

from modules.research_graph_projection import RELATION_TYPES

#: Labels grouped by the sweep's id; only ``(community_sweep, community)`` is citable.
#: A bare integer after the corpus moves may have been renumbered.
READ_COMMUNITIES = (
    "MATCH (d:Document) WHERE d.community IS NOT NULL "
    "AND ($desk_id IS NULL OR d.desk_id = $desk_id) "
    "RETURN d.community AS community, d.community_sweep AS sweep, collect(d.id) AS members"
)

#: The internal relation tally, one row per (community, relationship type).
#: Internal ties ONLY — both endpoints in the same community — because that is
#: what a community is made of; counting the ties leaving it would describe the
#: boundary, which is a different question and one nothing here asks. Matches
#: what ``research_communities._summarise`` counts, so the two paths report the
#: same field to mean the same thing.
READ_COMMUNITY_RELATIONS = (
    "MATCH (a:Document)-[r]->(b:Document) "
    "WHERE a.community IS NOT NULL AND a.community = b.community "
    "AND a.community_sweep = b.community_sweep "
    "AND ($desk_id IS NULL OR (a.desk_id = $desk_id AND b.desk_id = $desk_id)) "
    "RETURN a.community AS community, type(r) AS relation, count(r) AS n"
)

#: Distinct undirected PAIRS, not relationships, AMONG THE NODES THE REPORT IS
#: ABOUT. ``_build`` collapses parallel edges into one weighted edge, so
#: ``graph.number_of_edges()`` counts pairs — two documents joined by both
#: ``same_symbol`` and ``same_data`` are two relationships here and one edge
#: there — and counting relationships would report a bigger graph than the
#: networkx path does under the same field name. Both endpoints are constrained
#: and the sweep stamps must match, so a pair spanning two sweeps or desks
#: belongs to neither report. Self-loops are excluded for parity with ``_build``.
_COUNT_PAIRS_IN = (
    "MATCH (a:Document)-[r]->(b:Document) "
    "WHERE {scope} AND a.id <> b.id "
    "RETURN count(DISTINCT CASE WHEN a.id < b.id THEN [a.id, b.id] ELSE [b.id, a.id] END) AS n"
)

#: The pairs among the documents this sweep LABELLED — the graph it partitioned.
COUNT_COMMUNITY_PAIRS = _COUNT_PAIRS_IN.format(
    scope="a.community IS NOT NULL AND b.community IS NOT NULL "
    "AND a.community_sweep = b.community_sweep "
    "AND ($desk_id IS NULL OR (a.desk_id = $desk_id AND b.desk_id = $desk_id))"
)

#: The pairs among the documents this sweep SCORED. Keyed on the centrality
#: stamp rather than the community one: the two sweeps are written separately.
COUNT_CENTRALITY_PAIRS = _COUNT_PAIRS_IN.format(
    scope="a.centrality IS NOT NULL AND b.centrality IS NOT NULL "
    "AND a.centrality_sweep = b.centrality_sweep "
    "AND ($desk_id IS NULL OR (a.desk_id = $desk_id AND b.desk_id = $desk_id))"
)

#: The PageRank scores the sweep wrote, already in rank order. The order is the
#: product, and a score quoted on its own means nothing.
READ_CENTRALITY = (
    "MATCH (d:Document) WHERE d.centrality IS NOT NULL "
    "AND ($desk_id IS NULL OR d.desk_id = $desk_id) "
    "RETURN d.id AS id, d.centrality AS score, d.centrality_sweep AS sweep "
    "ORDER BY d.centrality DESC, d.id ASC"
)

#: Neo4j relationship type back to the ``public.research_relation`` value.
RELATIONS_BY_TYPE: dict[str, str] = {value: key for key, value in RELATION_TYPES.items()}


def _rows(result: Any) -> list[dict[str, Any]] | None:
    """Every record as a plain dict, or ``None`` for an unreadable result.

    ``None`` and ``[]`` are different answers: an empty list is a graph with no
    labels; ``None`` is a result this code could not read and must fall back.
    """
    try:
        records = list(result)
    except Exception:  # noqa: BLE001 - unreadable is an absence, not a failure
        return None
    rows: list[dict[str, Any]] = []
    for record in records:
        if not hasattr(record, "keys") or not hasattr(record, "get"):
            return None
        rows.append({key: record.get(key) for key in record.keys()})
    return rows


def _count(result: Any) -> int | None:
    """The single ``n`` a count query returns, or ``None`` — never 0 on failure."""
    rows = _rows(result)
    if not rows:
        return None
    value = rows[0].get("n")
    return int(value) if isinstance(value, int) else None


def _impossible(pairs: int, documents: int) -> str | None:
    """Why ``pairs`` cannot be an edge count over ``documents`` nodes, if so."""
    ceiling = documents * (documents - 1) // 2
    if pairs <= ceiling:
        return None
    return (
        f"the projection reported {pairs} edges over {documents} documents, and {documents} "
        f"documents admit at most {ceiling} undirected pairs, so the two were counted over "
        "different populations and neither can be quoted"
    )


def _one_sweep(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """The single sweep stamp these labels carry, or why they cannot be used."""
    stamps = {row.get("sweep") for row in rows}
    if None in stamps or "" in stamps:
        return None, (
            "the projected labels carry no sweep stamp, so a stale partition could not be told "
            "apart from a current one"
        )
    if len(stamps) > 1:
        return None, (
            f"the projection holds labels from {len(stamps)} different sweeps "
            f"({sorted(str(s) for s in stamps)}), so it is mid-rebuild; ids are comparable only "
            "within one sweep"
        )
    return str(next(iter(stamps))), None


def _summarise(
    rows: list[dict[str, Any]], tally: dict[Any, dict[str, int]],
) -> list[dict[str, Any]]:
    """One row per community, preserving the id the sweep wrote."""
    communities: list[dict[str, Any]] = []
    for row in rows:
        members = sorted((member for member in (row.get("members") or []) if member), key=str)
        relations = dict(sorted(tally.get(row.get("community"), {}).items()))
        top = max(relations.values(), default=0)
        communities.append({
            "id": row.get("community"),
            "members": members,
            "size": len(members),
            "relations": relations,
            # A real tie is common; picking one would invent a fact.
            "dominant_relations": sorted(name for name, n in relations.items() if n == top) if top else [],
        })
    communities.sort(key=lambda row: (-row["size"], str(row["members"][0]) if row["members"] else ""))
    return communities


def _tally(rows: list[dict[str, Any]]) -> dict[Any, dict[str, int]]:
    """Relation counts per community, mapped back to the Postgres enum value."""
    tally: dict[Any, dict[str, int]] = {}
    for row in rows:
        relation = RELATIONS_BY_TYPE.get(str(row.get("relation")))
        count = row.get("n")
        if relation is None or not isinstance(count, int):
            continue
        tally.setdefault(row.get("community"), {})[relation] = count
    return tally
