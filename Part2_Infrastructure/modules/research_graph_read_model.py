"""Reading the Neo4j projection back — the half that makes it a read model.

``research_graph_projection`` copies ``research_edges`` into Neo4j and
``project_communities``/``project_centrality`` write the sweep's labels onto
those nodes. Until this module existed, ``_driver()`` was called from exactly
two places and both were WRITES: nothing in the request path ever read the graph
back. The community and centrality routes recomputed everything in-process with
networkx over a whole-corpus PostgREST read, which is the computation the
projection exists to avoid repeating.

A store kept in sync that nothing reads is cost without retrieval. Either it is
read or it should not exist, and reading it is the better answer here: the
labels were computed once, by the sweep that had whole-corpus evidence, and a
route that reads them serves the SAME partition every caller sees rather than
recomputing a fresh one per request over a corpus that may have moved.

What is read, and what is deliberately not
------------------------------------------

Only what the sweep actually WROTE, plus what the graph itself holds:
``d.community``/``d.community_sweep``, ``d.centrality``/``d.centrality_sweep``,
and the relationships between Documents. ``seed``, ``resolution`` and
``damping`` are absent from these reports on purpose — they are parameters of
the run that produced the labels and nothing in the graph records them, so
stating them here would let a reader quote a resolution that nothing used. An
absent key is the honest form; a plausible default is the lie.

``modularity`` is absent for the same reason and one stronger: it is a
measurement of a partition against an edge set, it was never written to the
graph, and 0.0 in its place would read as a worthless partition rather than as
an unmeasured one.

The refusals, and why each of them falls back rather than fails
--------------------------------------------------------------

Every path returns the shape its in-process twin returns — ``detected: False``
from ``research_communities._unavailable``, ``ranked: False`` from
``_unranked`` — with a named reason, so ``research_graph_reads`` can fall back
to the networkx computation and SAY WHY it did. "Neo4j is not configured", "the
sweep has not run yet" and "the projection is mid-rebuild" are three different
facts and a caller that cannot tell them apart cannot fix any of them.

The mid-rebuild refusal is the one worth arguing for. Community ids are stable
for a FIXED edge set and not across edge sets, so labels from two different
sweeps sitting in the graph at once do not describe one partition — community 3
of Tuesday's sweep and community 3 of Wednesday's are different sets that would
be read as one. A partial re-label is exactly what a sweep interrupted halfway
leaves behind, and it is indistinguishable from a good partition unless the
stamps are checked. They are checked here.

A WRITER MAY NOT READ ITS OWN OUTPUT. ``community_labels`` refuses when the
caller is the sweep that writes labels. A sweep that read the graph's current
partition and wrote it back would be a fixpoint: the corpus could change every
day and the labels never would, and every report would say ``detected: True``
while nothing had been detected since the first run.
"""

from __future__ import annotations

import logging
from typing import Any

from config import settings
from modules.research_communities import _unavailable as _undetected
from modules.research_communities import _unranked

# Bound at import rather than reached through the module, so that patching
# ``research_graph_projection._driver`` — which the projection's own suites do
# to prove a GET never WRITES — does not silently redirect this read path too.
# The two are different questions about the same driver.
from modules.research_graph_projection import RELATION_TYPES, _driver

log = logging.getLogger("alphaengine.research_graph_read_model")

#: The community labels, grouped by the id the sweep wrote. The sweep stamp
#: travels with them: ``(community_sweep, community)`` is the citable pair, and
#: a bare integer a week later is unreadable — it may have been renumbered by
#: one new document.
READ_COMMUNITIES = (
    "MATCH (d:Document) WHERE d.community IS NOT NULL "
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
    "RETURN a.community AS community, type(r) AS relation, count(r) AS n"
)

#: Distinct undirected PAIRS, not relationships. ``_build`` collapses parallel
#: edges into one weighted edge, so ``graph.number_of_edges()`` counts pairs —
#: and two documents joined by both ``same_symbol`` and ``same_data`` are two
#: relationships here and one edge there. Counting relationships would report a
#: bigger graph than the networkx path does under the same field name.
COUNT_PAIRS = (
    "MATCH (a:Document)-[r]->(b:Document) "
    "RETURN count(DISTINCT CASE WHEN a.id < b.id THEN [a.id, b.id] ELSE [b.id, a.id] END) AS n"
)

#: The PageRank scores ``project_centrality`` wrote, already in rank order. The
#: ORDER BY is not decoration: ``rank_documents`` returns an ordered list because
#: the order is the product, and a score quoted on its own means nothing.
READ_CENTRALITY = (
    "MATCH (d:Document) WHERE d.centrality IS NOT NULL "
    "RETURN d.id AS id, d.centrality AS score, d.centrality_sweep AS sweep "
    "ORDER BY d.centrality DESC, d.id ASC"
)

#: Neo4j relationship type back to the ``public.research_relation`` value. Built
#: from the projection's own map so a relation added there cannot be read back
#: here under a name Postgres never used.
RELATIONS_BY_TYPE: dict[str, str] = {value: key for key, value in RELATION_TYPES.items()}


def _rows(result: Any) -> list[dict[str, Any]] | None:
    """Every record as a plain dict, or ``None`` when the driver returned nothing readable.

    ``None`` and ``[]`` are different answers and both are normal: an empty list
    is a graph with no labels in it, and ``None`` is a result object this code
    could not read — which must fall back to the corpus rather than be reported
    as an empty partition.
    """
    try:
        records = list(result)
    except Exception:  # noqa: BLE001 - an unreadable result is an absence, not a failure
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


def _one_sweep(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """The single sweep stamp these labels carry, or a reason they cannot be used."""
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


def _summarise(rows: list[dict[str, Any]], tally: dict[Any, dict[str, int]]) -> list[dict[str, Any]]:
    """One row per community, in the shape ``research_communities._summarise`` returns.

    ``id`` is the label the sweep WROTE, not a position in this list. The
    networkx path numbers communities by size because it has just computed them
    and nothing else names them; here the number is already in the graph, it is
    half of the ``(sweep, community)`` pair a reader cites, and renumbering it by
    size would break that pairing for anyone holding a label from yesterday.
    """
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
            # A LIST, as in the networkx path: a genuine tie between two relation
            # types is common in this corpus and picking one would invent a fact.
            "dominant_relations": sorted(name for name, n in relations.items() if n == top) if top else [],
        })
    communities.sort(key=lambda row: (-row["size"], str(row["members"][0]) if row["members"] else ""))
    return communities


def _tally(rows: list[dict[str, Any]]) -> dict[Any, dict[str, int]]:
    """Relation counts per community, with the Neo4j type mapped back to the enum value."""
    tally: dict[Any, dict[str, int]] = {}
    for row in rows:
        relation = RELATIONS_BY_TYPE.get(str(row.get("relation")))
        count = row.get("n")
        if relation is None or not isinstance(count, int):
            # An unmapped type is a relationship this projection did not write.
            # Skipped rather than reported under its Cypher name, which would put
            # a relation Postgres has never heard of into a desk's report.
            continue
        tally.setdefault(row.get("community"), {})[relation] = count
    return tally


def _session(read: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Open a session, run ``read`` against it, and turn every failure into a reason.

    The driver is closed on every path. A read model that leaks a connection per
    request is worse than one that is never read, and this runs on the request
    path rather than on a sweep.
    """
    driver, reason = _driver()
    if driver is None:
        return None, reason or "no driver"
    try:
        with driver.session(database=settings.neo4j_database) as session:
            return read(session), None
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return None, f"{type(exc).__name__} reading the Neo4j projection: {exc}"
    finally:
        driver.close()


def community_labels(*, writing: bool = False, offered: bool = True) -> dict[str, Any]:
    """The partition the sweep last wrote, read back out of Neo4j.

    Returns ``detect_communities``' own report shape, with ``source: "neo4j"``
    and the ``sweep`` the labels carry, so a caller can hand it straight to
    whatever reads a detection report today. Every refusal is
    ``detected: False`` with a named reason and NO measurements, so a fallback
    can say which of the several absences it hit.
    """
    if not offered:
        return _undetected("the caller asked for the corpus computation, so Neo4j was not consulted")
    if writing:
        return _undetected(
            "this caller WRITES the labels, and a sweep that read its own last output back would "
            "be a fixpoint — the corpus could change every day and the partition never would"
        )

    def _read(session: Any) -> dict[str, Any]:
        return {
            "communities": _rows(session.run(READ_COMMUNITIES)),
            "relations": _rows(session.run(READ_COMMUNITY_RELATIONS)),
            "pairs": _count(session.run(COUNT_PAIRS)),
        }

    answer, reason = _session(_read)
    if answer is None:
        return _undetected(reason or "the Neo4j projection could not be read")
    rows, relations, pairs = answer["communities"], answer["relations"], answer["pairs"]
    if rows is None or relations is None:
        return _undetected("the Neo4j projection returned a result this reader could not read")
    if not rows:
        return _undetected(
            "the Neo4j projection carries no community labels, so the whole-corpus sweep has not "
            "run against this graph yet"
        )
    if pairs is None:
        # Refused rather than reported with the count omitted or zeroed: an edge
        # count is how a reader tells a partition of the corpus from a partition
        # of a fragment, and one that was never taken must not be printed.
        return _undetected("the projection's edge count could not be read, so the partition was not used")
    sweep, unusable = _one_sweep(rows)
    if sweep is None:
        return _undetected(unusable or "the projected labels could not be dated")

    communities = _summarise(rows, _tally(relations))
    return {
        "detected": True,
        "reason": None,
        "source": "neo4j",
        "sweep": sweep,
        "documents": sum(row["size"] for row in communities),
        "edges": pairs,
        "communities": communities,
        "community_count": len(communities),
        "singletons": sum(1 for row in communities if row["size"] == 1),
    }


def centrality_scores(*, offered: bool = True) -> dict[str, Any]:
    """The PageRank the sweep last wrote, read back out of Neo4j.

    ``rank_documents``' report shape, minus ``damping``: the graph does not hold
    the value the ranking was computed with, and stating a default here would
    let a reader quote a damping factor that nothing used. The ordering is
    Neo4j's, taken from the same score the sweep wrote, so the product — the
    ORDER — is the sweep's and not this reader's opinion of it.
    """
    if not offered:
        return _unranked("the caller asked for the corpus computation, so Neo4j was not consulted")

    def _read(session: Any) -> dict[str, Any]:
        return {"scores": _rows(session.run(READ_CENTRALITY)), "pairs": _count(session.run(COUNT_PAIRS))}

    answer, reason = _session(_read)
    if answer is None:
        return _unranked(reason or "the Neo4j projection could not be read")
    rows, pairs = answer["scores"], answer["pairs"]
    if rows is None:
        return _unranked("the Neo4j projection returned a result this reader could not read")
    if not rows:
        return _unranked(
            "the Neo4j projection carries no centrality scores, so the whole-corpus sweep has not "
            "ranked this graph yet"
        )
    if pairs is None:
        return _unranked("the projection's edge count could not be read, so the ranking was not used")
    sweep, unusable = _one_sweep(rows)
    if sweep is None:
        return _unranked(unusable or "the projected scores could not be dated")

    ranking = [
        {"id": row.get("id"), "score": float(row.get("score"))}
        for row in rows
        if row.get("id") is not None and isinstance(row.get("score"), int | float)
    ]
    if len(ranking) != len(rows):
        # A score that is not a number is not a small score. Refusing the whole
        # read keeps "the graph holds something this reader cannot price" from
        # being served as a ranking with rows silently missing from it.
        return _unranked("a projected centrality score was not a number, so the ranking was not used")
    return {
        "ranked": True,
        "reason": None,
        "source": "neo4j",
        "sweep": sweep,
        "documents": len(ranking),
        "edges": pairs,
        "ranking": ranking,
    }
