"""The deploy-only research rebuild: strict order, complete counts, safe output."""

from __future__ import annotations

import json

from tools import reconcile_research_once as once

DESK = "00000000-0000-0000-0000-000000000001"
SWEEP = "deploy-123-1"


def _graph(**overrides):
    report = {
        "reachable": True,
        "complete": True,
        "eligible_documents": 37,
        "documents_swept": 37,
        "documents_not_assessable": 0,
        "writes_failed": 0,
        "deferred": 0,
        "batches": 1,
        "graph": {"projected": True, "reason": None, "documents": 37, "edges": 41},
    }
    report.update(overrides)
    return report


def _communities(**overrides):
    report = {
        "sweep": SWEEP,
        "read": {"read": True, "truncated": False},
        "detection": {"detected": True, "reason": None, "documents": 37, "edges": 41},
        "projection": {"projected": True, "reason": None, "sweep": SWEEP, "labelled": 37},
        "centrality": {"ranked": True, "reason": None},
        "centrality_projection": {
            "projected": True,
            "reason": None,
            "sweep": SWEEP,
            "scored": 37,
        },
    }
    report.update(overrides)
    return report


def _community_read(**overrides):
    report = {
        "detected": True,
        "source": "neo4j",
        "sweep": SWEEP,
        "documents": 37,
        "edges": 41,
        "community_count": 5,
    }
    report.update(overrides)
    return report


def _centrality_read(**overrides):
    report = {
        "ranked": True,
        "source": "neo4j",
        "sweep": SWEEP,
        "documents": 37,
        "edges": 41,
    }
    report.update(overrides)
    return report


def _run(*, calls=None, graph=None, communities=None, community=None, centrality=None):
    order = calls if calls is not None else []

    def graph_fn(**_kwargs):
        order.append("graph")
        return graph or _graph()

    def communities_fn(**_kwargs):
        order.append("communities")
        return communities or _communities()

    def community_fn():
        order.append("community_read")
        return community or _community_read()

    def centrality_fn():
        order.append("centrality_read")
        return centrality or _centrality_read()

    report = once.reconcile_once(
        desk_id=DESK,
        sweep=SWEEP,
        limit=200,
        graph_fn=graph_fn,
        communities_fn=communities_fn,
        community_read_fn=community_fn,
        centrality_read_fn=centrality_fn,
    )
    return report, order


def test_rebuilds_nodes_before_labels_then_reads_back_one_population():
    report, order = _run()
    assert order == ["graph", "communities", "community_read", "centrality_read"]
    assert report == {
        "ok": True,
        "sweep": SWEEP,
        "graph": {"documents": 37, "edges": 41, "batches": 1, "reason": None},
        "communities": {"documents": 37, "edges": 41, "count": 5, "reason": None},
        "centrality": {"documents": 37, "edges": 41, "reason": None},
    }


def test_refuses_partial_projection_and_mismatched_readback():
    partial = _communities(
        projection={"projected": True, "reason": None, "sweep": SWEEP, "labelled": 36},
    )
    try:
        _run(communities=partial)
    except once.ReconcileOnceError as exc:
        assert "not every detected document was labelled" in str(exc)
    else:
        raise AssertionError("a partial community projection was accepted")

    try:
        _run(centrality=_centrality_read(sweep="another-sweep"))
    except once.ReconcileOnceError as exc:
        assert "wrong sweep" in str(exc)
    else:
        raise AssertionError("readbacks from two sweeps were accepted")


def test_refuses_a_graph_walk_that_did_not_reach_the_verified_corpus_end():
    calls = []
    try:
        _run(calls=calls, graph=_graph(complete=False, why="deploy safety ceiling reached"))
    except once.ReconcileOnceError as exc:
        assert "complete corpus" in str(exc)
    else:
        raise AssertionError("a partial graph walk reached community detection")
    assert calls == ["graph"]


def test_failure_output_redacts_endpoints_and_credential_shaped_values(monkeypatch, capsys):
    def fail(**_kwargs):
        raise RuntimeError(
            "could not reach neo4j+s://graph.example/db password=do-not-print token=also-private"
        )

    monkeypatch.setattr(once, "reconcile_once", fail)
    assert once.main(["--sweep", SWEEP]) == 1
    output = capsys.readouterr().out
    parsed = json.loads(output)
    assert parsed["ok"] is False
    assert "graph.example" not in output
    assert "do-not-print" not in output
    assert "also-private" not in output
    assert "<endpoint>" in parsed["reason"]
    assert "<redacted>" in parsed["reason"]
