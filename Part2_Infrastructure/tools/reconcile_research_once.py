#!/usr/bin/env python3
"""One bounded, sequential rebuild of the scoped Neo4j research read model.

This is a deployment adapter over the existing reconciliation functions, not a
second graph writer.  It exists for the scope migration: legacy Neo4j nodes do
not carry ``desk_id``, so the safe scoped reader hides them until the normal
graph sweep revisits each node.  Schedule history lives on the durable OCI
volume, however, and can postpone that sweep for six hours after an upgrade.

The deploy runs this tool in a disposable replacement-image container before
cutover.  A fixed zero-grace horizon, cursor pagination and exact counts before
and after the walk give the two existing writes a strict order -- all scoped
nodes/edges first, whole-corpus labels second -- without exposing an
administrative HTTP route.

Output is deliberately a small JSON report containing states, counts and
sanitised reasons only.  No document, edge, URL or credential is printed.
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Callable
from typing import Any

MAX_BATCH_SIZE = 200
MAX_DOCUMENTS = 10_000
MAX_SECONDS = 150.0


class ReconcileOnceError(RuntimeError):
    """A named validation failure safe for the deployment log."""


def _safe_reason(value: Any) -> str | None:
    """A bounded diagnostic with endpoints and credential-shaped values removed."""
    if value in (None, ""):
        return None
    text = str(value).replace("\n", " ")
    text = re.sub(r"(?:https?|neo4j(?:\+s)?)://\S+", "<endpoint>", text, flags=re.I)
    text = re.sub(
        r"\b(password|token|secret|apikey|authorization)\s*[=:]\s*\S+",
        r"\1=<redacted>",
        text,
        flags=re.I,
    )
    return text[:300]


def _reason(report: dict[str, Any]) -> str | None:
    return _safe_reason(report.get("reason") or report.get("why"))


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise ReconcileOnceError(reason)


def reconcile_once(
    *,
    desk_id: str,
    sweep: str,
    limit: int = MAX_BATCH_SIZE,
    graph_fn: Callable[..., dict[str, Any]] | None = None,
    communities_fn: Callable[..., dict[str, Any]] | None = None,
    community_read_fn: Callable[..., dict[str, Any]] | None = None,
    centrality_read_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Rebuild nodes, then labels, then prove both read paths agree.

    Callables are injectable solely so the validation can be tested without a
    network.  Production resolves the existing integration points lazily.
    """
    desk = str(desk_id or "").strip()
    stamp = str(sweep or "").strip()
    _require(bool(desk), "SUPABASE_DESK_ID is empty")
    _require(bool(stamp), "the deploy sweep stamp is empty")
    _require(1 <= int(limit) <= MAX_BATCH_SIZE, f"limit must be between 1 and {MAX_BATCH_SIZE}")

    if graph_fn is None or communities_fn is None:
        from modules.research_graph_reads import reconcile_communities
        from modules.research_reconcile_complete import reconcile_graph_complete

        graph_fn = graph_fn or reconcile_graph_complete
        communities_fn = communities_fn or reconcile_communities
    if community_read_fn is None or centrality_read_fn is None:
        from modules.research_graph_read_model import centrality_scores, community_labels

        community_read_fn = community_read_fn or community_labels
        centrality_read_fn = centrality_read_fn or centrality_scores

    graph = graph_fn(
        desk_id=desk,
        batch_size=int(limit),
        max_documents=MAX_DOCUMENTS,
        max_seconds=MAX_SECONDS,
        job_id=stamp,
    )
    graph_projection = graph.get("graph") if isinstance(graph.get("graph"), dict) else {}
    _require(bool(graph.get("reachable")), f"graph sweep was unreachable ({_reason(graph) or 'no reason'})")
    _require(bool(graph.get("complete")), f"graph sweep did not cover the complete corpus ({_reason(graph) or 'no reason'})")
    _require(
        int(graph.get("documents_not_assessable") or 0) == 0,
        "graph sweep left documents not assessable",
    )
    _require(int(graph.get("writes_failed") or 0) == 0, "authoritative edge writes failed")
    _require(graph.get("deferred") == 0, "graph sweep left documents deferred")
    _require(
        bool(graph_projection.get("projected")),
        f"Neo4j node/edge projection failed ({_reason(graph_projection) or 'no reason'})",
    )
    swept = int(graph.get("documents_swept") or 0)
    eligible = graph.get("eligible_documents")
    projected_documents = int(graph_projection.get("documents") or 0)
    _require(swept > 0, "graph sweep found no eligible research documents")
    _require(eligible is not None and int(eligible) == swept, "graph sweep and verified corpus counts differ")
    _require(projected_documents == swept, "Neo4j projected a different document count than the sweep")

    communities = communities_fn(desk_id=desk, job_id=stamp)
    read = communities.get("read") if isinstance(communities.get("read"), dict) else {}
    detection = communities.get("detection") if isinstance(communities.get("detection"), dict) else {}
    projection = communities.get("projection") if isinstance(communities.get("projection"), dict) else {}
    centrality = communities.get("centrality") if isinstance(communities.get("centrality"), dict) else {}
    centrality_projection = (
        communities.get("centrality_projection")
        if isinstance(communities.get("centrality_projection"), dict)
        else {}
    )
    _require(bool(read.get("read")) and not read.get("truncated"), "whole-corpus edge read was incomplete")
    _require(bool(detection.get("detected")), f"community detection failed ({_reason(detection) or 'no reason'})")
    _require(bool(centrality.get("ranked")), f"centrality ranking failed ({_reason(centrality) or 'no reason'})")
    _require(bool(projection.get("projected")), f"community projection failed ({_reason(projection) or 'no reason'})")
    _require(
        bool(centrality_projection.get("projected")),
        f"centrality projection failed ({_reason(centrality_projection) or 'no reason'})",
    )
    _require(str(communities.get("sweep") or "") == stamp, "community report carries the wrong sweep")
    _require(str(projection.get("sweep") or "") == stamp, "community projection carries the wrong sweep")
    _require(
        str(centrality_projection.get("sweep") or "") == stamp,
        "centrality projection carries the wrong sweep",
    )

    community_read = community_read_fn()
    centrality_read = centrality_read_fn()
    _require(bool(community_read.get("detected")), f"community readback failed ({_reason(community_read) or 'no reason'})")
    _require(bool(centrality_read.get("ranked")), f"centrality readback failed ({_reason(centrality_read) or 'no reason'})")
    _require(community_read.get("source") == "neo4j", "community readback did not use Neo4j")
    _require(centrality_read.get("source") == "neo4j", "centrality readback did not use Neo4j")
    _require(str(community_read.get("sweep") or "") == stamp, "community readback carries the wrong sweep")
    _require(str(centrality_read.get("sweep") or "") == stamp, "centrality readback carries the wrong sweep")

    community_documents = int(community_read.get("documents") or 0)
    centrality_documents = int(centrality_read.get("documents") or 0)
    community_edges = int(community_read.get("edges") or 0)
    centrality_edges = int(centrality_read.get("edges") or 0)
    _require(community_documents == centrality_documents, "readbacks disagree on document count")
    _require(community_edges == centrality_edges, "readbacks disagree on edge count")
    _require(int(detection.get("documents") or 0) == community_documents, "detection/readback document counts differ")
    _require(int(detection.get("edges") or 0) == community_edges, "detection/readback edge counts differ")
    _require(int(projection.get("labelled") or 0) == community_documents, "not every detected document was labelled")
    _require(
        int(centrality_projection.get("scored") or 0) == centrality_documents,
        "not every ranked document was scored",
    )

    return {
        "ok": True,
        "sweep": stamp,
        "graph": {
            "documents": projected_documents,
            "edges": int(graph_projection.get("edges") or 0),
            "batches": int(graph.get("batches") or 0),
            "reason": _reason(graph_projection),
        },
        "communities": {
            "documents": community_documents,
            "edges": community_edges,
            "count": int(community_read.get("community_count") or 0),
            "reason": _reason(community_read),
        },
        "centrality": {
            "documents": centrality_documents,
            "edges": centrality_edges,
            "reason": _reason(centrality_read),
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sweep", required=True, help="non-secret deploy-scoped rebuild stamp")
    parser.add_argument(
        "--limit",
        type=int,
        default=MAX_BATCH_SIZE,
        choices=range(1, MAX_BATCH_SIZE + 1),
        help="documents per page; the zero-grace walk continues to the verified corpus end",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        from config import settings

        report = reconcile_once(
            desk_id=settings.supabase_desk_id,
            sweep=args.sweep,
            limit=args.limit,
        )
    except Exception as exc:  # noqa: BLE001 - deploy needs one bounded, secret-free refusal
        report = {"ok": False, "reason": _safe_reason(exc) or type(exc).__name__}
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
