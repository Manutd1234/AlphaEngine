"""The research graph, projected into Neo4j as a rebuildable read model.

Postgres remains authoritative. `research_edges` is written by `persist_edges`
on the document write path and reconciled by `research_reconcile`; this module
copies that derived state into Neo4j and never the other way. Nothing writes to
Neo4j except this module, and what it writes is READ BACK by
`research_graph_read_model` on the request path — which is what makes the graph
a read model rather than a store nobody consults.

Why a projection and not a second write path
--------------------------------------------

A dual write is two systems that must agree, and this one already has a latent
way to disagree: `persist_edges` posts its edge batch with
``Prefer: resolution=ignore-duplicates`` and NO ``on_conflict`` parameter, so a
batch containing one already-present edge can 409 whole — losing every genuinely
new edge in it while returning 0 and raising nothing. Adding a second writer
alongside that doubles the surface on which the two stores can drift apart, and
drift between an authoritative store and a copy is only detectable if somebody
goes looking.

Projecting instead makes divergence a non-event: if the graph is wrong, drop it
and re-project. That is only safe because MERGE is idempotent and because
nothing but this function writes here — both properties are asserted in
`tests/test_research_graph_projection.py`.

Why Neo4j at all, when a recursive CTE already traverses this
-------------------------------------------------------------

It does, and for depth-bounded reachability the CTE is the better tool — it
needs no second process, no driver and no credentials. What it cannot do is
community detection: Louvain, Leiden, PageRank. The enterprise GraphRAG pattern
this desk is built toward asks for "community summaries" and macro-level
synthesis across disparate documents, and that is a graph-algorithm workload
rather than a traversal one. Neo4j earns its place there and nowhere else: the
per-document traversal stays on the CTE, and what moved onto the graph is the
whole-corpus partition and ranking — computed once by the sweep, written here,
and served from here instead of being recomputed on every request.

Absence is a state, not a failure
---------------------------------

An unset ``NEO4J_URI`` is the normal deployment. So is an uninstalled driver:
`requirements-graph.txt` is optional and the desk's whole test suite passes
without it. Both are reported in the same shape the corpus sweep uses for an
unset ``SUPABASE_URL`` — a named reason, never an exception and never a silent
success. "Could not project" and "there was nothing to project" are different
facts and must stay distinguishable at the call site.
"""

from __future__ import annotations

import logging
from typing import Any

from config import settings

log = logging.getLogger("alphaengine.research_graph_projection")

#: Relation values in `public.research_relation`, mapped to Neo4j relationship
#: types. Spelled out rather than upper-cased on the fly so an enum value added
#: in Postgres fails HERE, loudly, rather than silently projecting a new edge
#: type nobody declared.
RELATION_TYPES: dict[str, str] = {
    "same_data": "SAME_DATA",
    "same_symbol": "SAME_SYMBOL",
    "same_strategy": "SAME_STRATEGY",
    "same_regime": "SAME_REGIME",
    "followed_by": "FOLLOWED_BY",
    "promoted_to": "PROMOTED_TO",
}

#: Edges per transaction. Bounded for the same reason the corpus sweep is: a
#: projection that tries the whole graph in one statement is a projection that
#: fails entirely on a graph large enough to matter.
BATCH = 500

#: Run once per projection. `MERGE` on an unconstrained property is a full scan,
#: so without this the sweep degrades quadratically as the corpus grows.
CONSTRAINT = (
    "CREATE CONSTRAINT research_document_id IF NOT EXISTS "
    "FOR (d:Document) REQUIRE d.id IS UNIQUE"
)


def configured() -> bool:
    """Whether a projection target is configured at all.

    The password is required as well as the URI: a URI alone reaches a server
    that will refuse every statement, and reporting that as "configured" turns
    a setup mistake into a runtime error a long way from its cause.
    """
    return bool(settings.neo4j_uri and settings.neo4j_password)


def _unavailable(reason: str) -> dict[str, Any]:
    """The shape every refusal takes. Never raises, never reports success."""
    return {
        "projected": False,
        "reason": reason,
        "documents": 0,
        "edges": 0,
    }


def _driver() -> tuple[Any, str | None]:
    """The Neo4j driver, or a reason it is not available.

    Imported lazily and inside the function: `requirements-graph.txt` is
    optional, and a module-level import would make an unconfigured desk fail at
    import time — the gateway would not boot for want of a feature it is not
    using.
    """
    if not configured():
        return None, "NEO4J_URI/NEO4J_PASSWORD are unset, so the graph was not projected"
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return None, "the neo4j driver is not installed (pip install -r requirements-graph.txt)"
    return GraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    ), None


def project(
    documents: list[dict[str, Any]], edges: list[dict[str, Any]], *, desk_id: str | None = None,
) -> dict[str, Any]:
    """MERGE `documents` and `edges` into Neo4j. Idempotent by construction.

    `documents` carry at least ``id``; any of kind, symbol, strategy, data_hash
    and occurred_at present are set on the node. `edges` carry ``src_id``,
    ``dst_id`` and ``relation``. ``desk_id`` is supplied by the reconciler and
    written onto every node it touches. That makes an existing unscoped graph
    upgrade in place: ``MERGE`` finds the old node and ``SET`` adds the scope;
    until a node has been revisited, scoped reads cannot see it and fall back to
    the authoritative corpus instead of leaking a legacy global projection.

    Returns a report rather than raising: a projection is maintenance, and a
    maintenance task that takes the gateway down with it is worse than one that
    reports it could not run.
    """
    driver, reason = _driver()
    if driver is None:
        return _unavailable(reason or "no driver")

    unknown = sorted({e.get("relation") for e in edges} - set(RELATION_TYPES) - {None})
    if unknown:
        # Declared above for exactly this: a new enum value in Postgres must not
        # become an undeclared relationship type in the graph.
        return _unavailable(f"unmapped relation(s) {unknown}; add them to RELATION_TYPES")

    scope = str(desk_id or "").strip() or None
    foreign = sorted({
        str(row.get("desk_id"))
        for row in [*documents, *edges]
        if row.get("desk_id") not in (None, "", scope)
    }) if scope else []
    if foreign:
        return _unavailable(
            "the projection batch mixed desk scopes; refusing to write nodes from "
            f"{foreign} into desk {scope}"
        )

    try:
        with driver.session(database=settings.neo4j_database) as session:
            session.run(CONSTRAINT)
            for start in range(0, len(documents), BATCH):
                session.run(
                    "UNWIND $rows AS row "
                    "MERGE (d:Document {id: row.id}) "
                    "SET d += row.props",
                    rows=[{"id": d["id"], "props": {
                        **{k: v for k, v in d.items() if k != "id" and v is not None},
                        **({"desk_id": scope} if scope else {}),
                    }} for d in documents[start:start + BATCH]],
                )
            written = 0
            for relation, rel_type in RELATION_TYPES.items():
                rows = [e for e in edges if e.get("relation") == relation]
                for start in range(0, len(rows), BATCH):
                    chunk = rows[start:start + BATCH]
                    # The relationship type cannot be parameterised in Cypher, so
                    # it is interpolated — safely, because it comes from
                    # RELATION_TYPES' values and never from the caller.
                    session.run(
                        "UNWIND $rows AS row "
                        "MATCH (a:Document {id: row.src}), (b:Document {id: row.dst}) "
                        f"MERGE (a)-[:{rel_type}]->(b)",
                        rows=[{"src": e["src_id"], "dst": e["dst_id"]} for e in chunk],
                    )
                    written += len(chunk)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return _unavailable(f"{type(exc).__name__} projecting to Neo4j: {exc}")
    finally:
        driver.close()

    return {"projected": True, "reason": None, "documents": len(documents), "edges": written}


#: The label write, one row per member per community. The ``RETURN`` is not
#: decoration: ``MATCH`` silently skips an id the graph has never seen, so a
#: count of the rows SENT would report a corpus labelled that Neo4j does not
#: hold. Aliased ``n`` because that is what the rest of this plane's counts are
#: called and what a caller reading the record already expects.
LABEL_COMMUNITIES = (
    "UNWIND $rows AS row "
    "MATCH (d:Document {id: row.id}) "
    "SET d.community = row.community, d.community_sweep = $sweep "
    "RETURN count(d) AS n"
)


#: The centrality write, one row per ranked document. Same shape and same
#: ``RETURN`` as the community write, and for the same reason: ``MATCH`` skips an
#: id the graph has never seen, so counting the rows SENT would report a corpus
#: scored that Neo4j does not hold. The RANK is written beside the score because
#: the order is the product — ``rank_documents`` returns a list rather than a
#: mapping precisely so nobody quotes one score on its own — and a reader that
#: has only the score would have to re-derive the ordering the sweep already
#: knew.
LABEL_CENTRALITY = (
    "UNWIND $rows AS row "
    "MATCH (d:Document {id: row.id}) "
    "SET d.centrality = row.score, d.centrality_rank = row.rank, d.centrality_sweep = $sweep "
    "RETURN count(d) AS n"
)


def _unlabelled(reason: str, sweep: str) -> dict[str, Any]:
    """The refusal shape for `project_communities`.

    No ``labelled`` key, for the reason `research_communities` omits
    ``modularity`` from its own refusal: nothing was measured, and a null
    measurement sitting in a report is the one somebody later defaults to zero.
    The sweep stamp is carried even here, so a log line says WHICH sweep failed.
    """
    return {"projected": False, "reason": reason, "sweep": sweep, "communities": 0, "members": 0}


def _matched(result: Any) -> int | None:
    """How many Document nodes the label write actually reached, or ``None``.

    ``None`` — never 0 — when the driver returned nothing readable. "We do not
    know how many were labelled" and "none were labelled" are different facts,
    and only one of them means the projection is missing its documents.
    """
    try:
        record = result.single()
    except Exception:  # noqa: BLE001 - an unreadable count is an absence, not a failed write
        return None
    value = record.get("n") if hasattr(record, "get") else None
    return int(value) if isinstance(value, int) else None


def _label(
    statement: str, rows: list[dict[str, Any]], *, sweep: str, what: str,
) -> tuple[int | None, str | None]:
    """One batched label write. Returns (matched, reason); exactly one is meaningful.

    Shared by both label writers rather than copied: the batching, the
    constraint, the driver close and the "how many did Neo4j actually match"
    count are properties of writing labels at all, and two copies of them drift
    the day one learns something the other does not.

    ``(None, None)`` is a real answer and NOT a failure — the write happened and
    the store did not say how many rows it matched. ``(_, reason)`` is the
    failure, and the caller wraps the reason in its own refusal shape because
    "no partition was written" and "no ranking was written" are different facts.
    """
    driver, reason = _driver()
    if driver is None:
        return None, reason or "no driver"

    labelled: int | None = 0
    try:
        with driver.session(database=settings.neo4j_database) as session:
            # MERGE and MATCH alike scan an unconstrained property, and this may
            # run on a graph `project` has not touched in this process.
            session.run(CONSTRAINT)
            for start in range(0, len(rows), BATCH):
                matched = _matched(session.run(statement, rows=rows[start:start + BATCH], sweep=sweep))
                labelled = None if matched is None or labelled is None else labelled + matched
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return None, f"{type(exc).__name__} labelling {what} in Neo4j: {exc}"
    finally:
        driver.close()
    return labelled, None


def project_communities(report: dict[str, Any], *, sweep: str) -> dict[str, Any]:
    """Write a `research_communities.detect_communities` report onto the projected nodes.

    SEPARATE FROM `project` DELIBERATELY. That one is a pure edge copy — drop the
    graph, re-run it, and the result is the same — and a community label is not
    a copy of anything in Postgres: it is a derived opinion about a partition,
    computed from an edge set that may not be the one the graph currently holds.
    Folding it into `project` would make every per-tick projection carry a
    partition it has no evidence for; keeping it apart is what lets the caller
    that DOES have whole-corpus evidence be the only one that labels.

    ``sweep`` is required and travels with every label. Community ids are stable
    for a fixed edge set and NOT across edge sets, so ``d.community`` alone is
    unreadable a week later — a bare integer that may have been renumbered by
    one new document. ``(community_sweep, community)`` together is the citable
    pair, and the stamp is what makes a stale label detectable rather than
    indistinguishable from a current one.

    A report that did not detect is refused rather than written as an empty
    partition: zero communities from a failed run and zero communities from an
    unlinked corpus would leave identical labels in the graph.
    """
    if not report.get("detected"):
        return _unlabelled(
            f"the community report says it could not detect ({report.get('reason')}), so nothing was labelled",
            sweep,
        )
    communities = report.get("communities") or []
    rows = [{"id": member, "community": community.get("id")}
            for community in communities for member in (community.get("members") or [])]

    labelled, reason = _label(LABEL_COMMUNITIES, rows, sweep=sweep, what="communities")
    if reason is not None:
        return _unlabelled(reason, sweep)

    return {"projected": True, "reason": None, "sweep": sweep,
            "communities": len(communities), "members": len(rows), "labelled": labelled}


def _unscored(reason: str, sweep: str) -> dict[str, Any]:
    """The refusal shape for `project_centrality`.

    No ``scored`` key, for the reason `_unlabelled` omits ``labelled``: nothing
    was measured, and a null count sitting in a report is the one somebody later
    defaults to zero.
    """
    return {"projected": False, "reason": reason, "sweep": sweep, "documents": 0}


def project_centrality(report: dict[str, Any], *, sweep: str) -> dict[str, Any]:
    """Write a `research_communities.rank_documents` report onto the projected nodes.

    THE SAME SPLIT AS `project_communities`, and the same argument: PageRank
    over one reconciliation window is not PageRank over the corpus — mass flows
    over the edges that are present, so a window's ranking inflates every
    document the cut spared. Only a caller holding whole-corpus evidence may
    write these, which is why this takes a finished report rather than an edge
    list and refuses one that says it could not rank.

    ``sweep`` travels with every score for the reason it travels with every
    community label: a score is comparable only against the ranking it came
    from, and an undated one cannot be told from a stale one.

    WHY THESE ARE WRITTEN AT ALL. Until this existed, the centrality route
    recomputed PageRank per request over a whole-corpus PostgREST read while the
    projection it could have read sat there holding only community labels. The
    read half is `research_graph_read_model.centrality_scores`, and these two
    are a pair: writing scores nothing reads would be the defect this change was
    made to remove, one field along.
    """
    if not report.get("ranked"):
        return _unscored(
            f"the centrality report says it could not rank ({report.get('reason')}), so nothing was scored",
            sweep,
        )
    ranking = report.get("ranking") or []
    rows = [{"id": row.get("id"), "score": row.get("score"), "rank": index}
            for index, row in enumerate(ranking, start=1)]
    if any(row["id"] is None or not isinstance(row["score"], int | float) for row in rows):
        # Refused whole rather than filtered. A row without a numeric score is
        # not a low-scoring document, and writing the rest would leave a graph
        # whose ranking is missing documents with nothing saying which.
        return _unscored("a ranking row carried no id or no numeric score, so nothing was scored", sweep)

    scored, reason = _label(LABEL_CENTRALITY, rows, sweep=sweep, what="centrality")
    if reason is not None:
        return _unscored(reason, sweep)

    return {"projected": True, "reason": None, "sweep": sweep,
            "documents": len(rows), "scored": scored}
