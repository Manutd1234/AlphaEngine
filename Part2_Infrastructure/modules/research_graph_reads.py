"""The whole-corpus edge read, and the community sweep that is the only reason for it.

``modules/research_communities.py`` takes an edge list and reads nothing itself —
the caller owns the fetch, which is what lets Louvain be tested against a
literal rather than against a database. This module is that caller. It reads
``research_edges`` whole, hands the rows to ``detect_communities``, and offers
the resulting labels to Neo4j through ``project_communities``. Nothing here
partitions anything; nothing in the community module reads anything. That split
is the property worth keeping, so the fetch lives here and stays out of there.

Why this is NOT wired into the per-tick sweep
---------------------------------------------

``research_reconcile._project_graph`` already has an edge list in its hand and
the four lines that would call ``detect_communities`` on it would look obviously
right. They would be wrong. A reconciliation tick carries ONE WINDOW of the
corpus — at most ``MAX_DOCUMENTS_PER_TICK`` documents and the edges touching
them — and partitioning a fragment of a graph produces communities that do not
exist in the whole graph: two documents land together because nothing else was
in the window to pull them apart, and that label then goes to Neo4j as though it
were a fact about the corpus. Community detection is a WHOLE-CORPUS operation
and this module exists so that it is one. ``_project_graph`` stays a per-tick
edge copy, which is the one thing a tick's edge list is actually evidence for.

The same trap, one layer down, is why a truncated read refuses to partition
rather than partitioning what it got. ``MAX_PAGES`` is a real ceiling and the
day it is reached the honest answer is a named reason, not a partition of the
first fifty thousand edges.

Keyset, not offset
------------------

The walk pages on ``(src_id, dst_id, relation)`` — the columns of
``research_edges_are_unique``, so the order is an index scan rather than a sort,
and the same argument ``research_corpus_reads._query`` makes about
``(occurred_at, id)`` applies here: ``OFFSET`` over a table that is being
written re-ranks the remaining rows, so a row inserted before the cursor pushes
one past the page boundary and it is never read. A skipped edge is invisible —
it looks exactly like an edge nobody derived — and it changes the partition.

Repeated rows are the other half of that and are handled rather than assumed
away: ``_build`` sums parallel edges into a weight, so the same edge read twice
would quietly make that tie twice as strong. Rows are deduplicated on the unique
triple and the repeats are COUNTED, because a page walk that starts returning
duplicates is saying something about the store that a silent ``set()`` would
swallow.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from config import settings
from modules.research_communities import _unavailable as _undetected
from modules.research_communities import detect_communities
from modules.research_corpus_reads import _iso
from modules.research_graph_projection import _unlabelled, project_communities

log = logging.getLogger("alphaengine.research_graph_reads")

_EDGES = "/rest/v1/research_edges"

#: The three columns ``detect_communities`` reads, named rather than ``*``. The
#: partition is a function of these and nothing else, so widening the select
#: would only widen the payload of a whole-corpus read.
EDGE_COLUMNS = "src_id,dst_id,relation"

#: Rows per request. PostgREST caps its own page size on most deployments, so
#: this is a request rather than a guarantee — the walk ends when a page comes
#: back SHORT, which is true whichever side chose the number.
PAGE = 1000

#: Pages per sweep. 50,000 edges is far above this desk's corpus and far below
#: what a Louvain in one process will hold; the point of the ceiling is that a
#: runaway read stops and says so instead of pulling until something dies.
MAX_PAGES = 50


def _unread(reason: str) -> dict[str, Any]:
    """The shape a failed read takes. Never raises, never returns a partial set.

    The edges read so far are DISCARDED rather than returned, because a caller
    handed a short list has no way to tell it from a small corpus — and the one
    thing this module must not do is partition a fragment.
    """
    return {"read": False, "reason": reason, "edges": [], "pages": 0, "duplicates": 0, "truncated": False}


def _after(row: dict[str, Any]) -> str:
    """The keyset filter for everything ordered after `row`.

    ``gt`` on ``src_id`` alone would skip every remaining edge out of the same
    source document, which is the boundary case the unique triple exists for.
    Interpolated rather than parameterised because PostgREST takes its logic in
    the query string; the values are uuids and enum labels the store itself
    returned, never caller input.
    """
    src, dst, relation = row.get("src_id"), row.get("dst_id"), row.get("relation")
    return (
        f"(src_id.gt.{src},"
        f"and(src_id.eq.{src},dst_id.gt.{dst}),"
        f"and(src_id.eq.{src},dst_id.eq.{dst},relation.gt.{relation}))"
    )


async def _page(client: Any, params: dict[str, str]) -> tuple[list[dict[str, Any]] | None, str | None]:
    """One page of edges, or a reason. ``None`` for a failure, never ``[]``."""
    try:
        response = await client.get(_EDGES, params=params)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return None, f"{type(exc).__name__} reading {_EDGES}"
    status = getattr(response, "status_code", 599)
    if status >= 300:
        why = "this deployment predates migration 20260820090400" if status == 404 else "the corpus could not be read"
        return None, f"HTTP {status} reading {_EDGES} — {why}"
    try:
        rows = response.json()
    except Exception:  # noqa: BLE001 - a body that will not parse is a reason, not a crash
        return None, f"{_EDGES} returned a body that is not JSON"
    if not isinstance(rows, list):
        return None, f"{_EDGES} returned {type(rows).__name__}, not a list of edges"
    return rows, None


async def read_all_edges(
    client: Any, *, desk_id: str, page: int = PAGE, max_pages: int = MAX_PAGES,
) -> dict[str, Any]:
    """Every derived edge on the desk, in one list. The fetch `detect_communities` refuses to do.

    ``truncated`` is the field that matters and it is deliberately not an error:
    the read itself succeeded, it simply did not reach the end. A caller that
    only wants to count edges may use what came back; a caller that wants to
    PARTITION must not, and `detect_corpus_communities` is where that judgement
    is made rather than here.
    """
    if client is None:
        return _unread(
            "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset, so the corpus edges could not be read"
        )

    query = {
        "select": EDGE_COLUMNS,
        "desk_id": f"eq.{desk_id}",
        "order": "src_id.asc,dst_id.asc,relation.asc",
        "limit": str(page),
    }
    edges: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any, Any]] = set()
    pages = duplicates = 0
    cursor: str | None = None

    while pages < max_pages:
        rows, reason = await _page(client, query if cursor is None else {**query, "or": cursor})
        if rows is None:
            return _unread(f"{reason} after {pages} page(s); no partition was attempted")
        pages += 1
        for row in rows:
            key = (row.get("src_id"), row.get("dst_id"), row.get("relation"))
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            edges.append(row)
        if len(rows) < page:
            return {"read": True, "reason": None, "edges": edges,
                    "pages": pages, "duplicates": duplicates, "truncated": False}
        cursor = _after(rows[-1])

    return {"read": True, "reason": None, "edges": edges,
            "pages": pages, "duplicates": duplicates, "truncated": True}


def _refusal(read: dict[str, Any], page: int) -> str | None:
    """Why this read must not be partitioned, or ``None`` if it may be."""
    if not read["read"]:
        return read["reason"] or "the corpus edges could not be read"
    if read["truncated"]:
        return (
            f"the edge read filled all {read['pages']} pages of {page} rows, so this is a FRAGMENT of the "
            "graph; partitioning a fragment produces communities that do not exist in the whole corpus"
        )
    return None


async def detect_corpus_communities(
    client: Any, *, desk_id: str, sweep: str | None = None, project: bool = True,
    page: int = PAGE, max_pages: int = MAX_PAGES,
) -> dict[str, Any]:
    """Read the whole corpus, partition it, and offer the labels to Neo4j.

    The three sub-reports are nested rather than flattened, each in the exact
    shape its own module documents, so a reader already holding ``detected`` or
    ``projected`` reads it unchanged and a new key on either side arrives here
    without this function being touched.

    ``sweep`` is the stamp that ties them together and it travels into the graph
    with every label. Community ids are reproducible for a FIXED edge set and
    not across edge sets — one new document can merge two clusters and renumber
    everything after them — so a label with no sweep on it cannot be told apart
    from a stale one. Defaulted to the instant of the sweep, never omitted.
    """
    stamp = sweep or _iso(time.time() * 1000.0)
    read = await read_all_edges(client, desk_id=desk_id, page=page, max_pages=max_pages)
    report: dict[str, Any] = {
        "scope": "communities",
        "sweep": stamp,
        # The rows themselves are not in the report: a whole-corpus edge list is
        # a payload, and the counts are what a caller reads.
        "read": {k: v for k, v in read.items() if k != "edges"},
    }

    refused = _refusal(read, page)
    if refused is not None:
        # Logged as well as reported: a sweep that refuses leaves the graph's
        # labels untouched, so the only trace it ran at all is this line and the
        # report the caller may or may not be reading.
        log.warning("research communities: %s", refused)
        # Both refusal shapes come from the modules that own them rather than
        # being spelled again here, so a key added to either cannot drift out of
        # step with the composite report.
        report["detection"] = _undetected(refused)
        report["projection"] = _unlabelled(f"nothing was detected ({refused})", stamp)
        return report

    detection = detect_communities(read["edges"])
    report["detection"] = detection
    report["projection"] = (
        project_communities(detection, sweep=stamp) if project
        else _unlabelled("the caller asked for a partition only, so no label was written", stamp)
    )
    return report


async def community_report(
    *, desk_id: str | None = None, project: bool = True,
    page: int = PAGE, max_pages: int = MAX_PAGES, sweep: str | None = None,
) -> dict[str, Any]:
    """The entry point a route or a job calls: builds its own corpus client and sweeps.

    An unconfigured corpus is passed through as ``client=None`` rather than
    branching into a second refusal here — one path, and the reason names the
    variables that are missing.
    """
    desk = desk_id or settings.supabase_desk_id
    key = settings.supabase_service_role_key
    if not (settings.supabase_url and key):
        return await detect_corpus_communities(
            None, desk_id=desk, sweep=sweep, project=project, page=page, max_pages=max_pages,
        )

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(
        base_url=settings.supabase_url.rstrip("/"), headers=headers, timeout=settings.supabase_timeout_s,
    ) as client:
        return await detect_corpus_communities(
            client, desk_id=desk, sweep=sweep, project=project, page=page, max_pages=max_pages,
        )


async def centrality_report(
    *, desk_id: str | None = None, page: int = PAGE, max_pages: int = MAX_PAGES,
) -> dict[str, Any]:
    """PageRank over the whole corpus — the route the communities sweep owes.

    The communities route's docstring names the debt: "centrality is owed its
    own route, not a passenger on this one", because it is a second whole-corpus
    computation answering a different question. Same read, same refusal rules —
    a truncated or failed read ranks nothing, for the same reason a partition
    refuses a fragment: PageRank mass flows over the edges that are present, so
    a missing page quietly inflates every document the cut spared.
    """
    from modules.research_communities import rank_documents

    desk = desk_id or settings.supabase_desk_id
    key = settings.supabase_service_role_key
    if not (settings.supabase_url and key):
        read: dict[str, Any] = {"read": False, "reason":
                                "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset, so the corpus could not be reached"}
    else:
        headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"), headers=headers, timeout=settings.supabase_timeout_s,
        ) as client:
            read = await read_all_edges(client, desk_id=desk, page=page, max_pages=max_pages)

    report: dict[str, Any] = {"scope": "centrality",
                              "read": {k: v for k, v in read.items() if k != "edges"}}
    refused = _refusal(read, page)
    if refused is not None:
        log.warning("research centrality: %s", refused)
        # The wrapped reason keeps "could not read" distinguishable from the
        # module's own "nothing to rank" — same convention as the partition.
        report["ranking"] = {"ranked": False, "reason": f"nothing was ranked ({refused})"}
        return report
    report["ranking"] = rank_documents(read["edges"])
    return report


def reconcile_communities(
    *, desk_id: str | None = None, now_ms: float | None = None, job_id: str | None = None,
) -> dict[str, Any]:
    """The scheduled caller ``project_communities`` was written for.

    The communities ROUTE fixes ``project=False`` — a GET must not write, or
    any crawler, prefetch or retry repartitions the desk's graph. Its docstring
    hands the write to a sweep on its own cadence; this adapter is that sweep,
    and until it existed the Neo4j label write-back was reachable by no
    production caller at all. ``job_id`` becomes the sweep stamp, so every
    label in the graph names the job that wrote it. Defined here rather than in
    ``research_reconcile`` (which re-exports it for the scheduler's name
    resolution) because that module is fenced off from the community machinery:
    a reconciliation tick carries one window's edges, and this is deliberately
    a WHOLE-corpus read on a daily clock, not a passenger on the 6h tick.
    """
    del now_ms  # offered by the scheduler; a whole-corpus partition takes neither a clock nor a limit
    import asyncio

    return asyncio.run(community_report(desk_id=desk_id, project=True, sweep=job_id))
