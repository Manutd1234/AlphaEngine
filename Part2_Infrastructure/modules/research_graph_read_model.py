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
from modules import research_quota_scope
from modules.research_communities import _unavailable as _undetected
from modules.research_communities import _unranked

# Bound independently so patching the projection's writer driver cannot redirect reads.
from modules.research_graph_projection import _driver
from modules.research_graph_read_model_support import _COUNT_PAIRS_IN as _COUNT_PAIRS_IN
from modules.research_graph_read_model_support import (
    COUNT_CENTRALITY_PAIRS as COUNT_CENTRALITY_PAIRS,
)
from modules.research_graph_read_model_support import (
    COUNT_COMMUNITY_PAIRS as COUNT_COMMUNITY_PAIRS,
)
from modules.research_graph_read_model_support import READ_CENTRALITY as READ_CENTRALITY
from modules.research_graph_read_model_support import READ_COMMUNITIES as READ_COMMUNITIES
from modules.research_graph_read_model_support import (
    READ_COMMUNITY_RELATIONS as READ_COMMUNITY_RELATIONS,
)
from modules.research_graph_read_model_support import (
    RELATIONS_BY_TYPE as RELATIONS_BY_TYPE,
)
from modules.research_graph_read_model_support import _count as _count
from modules.research_graph_read_model_support import _impossible as _impossible
from modules.research_graph_read_model_support import _one_sweep as _one_sweep
from modules.research_graph_read_model_support import _rows as _rows
from modules.research_graph_read_model_support import _summarise as _summarise
from modules.research_graph_read_model_support import _tally as _tally

log = logging.getLogger("alphaengine.research_graph_read_model")

def _read_model_refusal(offered: bool) -> str | None:
    if not offered:
        return "the caller asked for the corpus computation, so Neo4j was not consulted"
    if research_quota_scope.SCOPE_TO_DESK and not str(settings.supabase_desk_id or "").strip():
        return (
            "RESEARCH_SCOPE_TO_DESK is on but SUPABASE_DESK_ID is empty, so the Neo4j "
            "projection was not read"
        )
    return None


def _desk_scope() -> str | None:
    """The node property predicate for this read, or None for legacy unscoped mode."""
    if not research_quota_scope.SCOPE_TO_DESK:
        return None
    return str(settings.supabase_desk_id or "").strip() or None

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
    refusal = _read_model_refusal(offered)
    if refusal:
        return _undetected(refusal)
    if writing:
        return _undetected(
            "this caller WRITES the labels, and a sweep that read its own last output back would "
            "be a fixpoint — the corpus could change every day and the partition never would"
        )
    def _read(session: Any) -> dict[str, Any]:
        desk_id = _desk_scope()
        return {
            "communities": _rows(session.run(READ_COMMUNITIES, desk_id=desk_id)),
            "relations": _rows(session.run(READ_COMMUNITY_RELATIONS, desk_id=desk_id)),
            "pairs": _count(session.run(COUNT_COMMUNITY_PAIRS, desk_id=desk_id)),
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
        # An untaken edge count cannot describe a complete partition.
        return _undetected("the projection's edge count could not be read, so the partition was not used")
    sweep, unusable = _one_sweep(rows)
    if sweep is None:
        return _undetected(unusable or "the projected labels could not be dated")

    communities = _summarise(rows, _tally(relations))
    documents = sum(row["size"] for row in communities)
    incoherent = _impossible(pairs, documents)
    if incoherent is not None:
        return _undetected(incoherent)
    return {
        "detected": True,
        "reason": None,
        "source": "neo4j",
        "sweep": sweep,
        "documents": documents,
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
    refusal = _read_model_refusal(offered)
    if refusal:
        return _unranked(refusal)

    def _read(session: Any) -> dict[str, Any]:
        desk_id = _desk_scope()
        return {
            "scores": _rows(session.run(READ_CENTRALITY, desk_id=desk_id)),
            "pairs": _count(session.run(COUNT_CENTRALITY_PAIRS, desk_id=desk_id)),
        }

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
        # A non-number is not a small score; never serve a ranking with rows omitted.
        return _unranked("a projected centrality score was not a number, so the ranking was not used")
    incoherent = _impossible(pairs, len(ranking))
    if incoherent is not None:
        return _unranked(incoherent)
    return {
        "ranked": True,
        "reason": None,
        "source": "neo4j",
        "sweep": sweep,
        "documents": len(ranking),
        "edges": pairs,
        "ranking": ranking,
    }
