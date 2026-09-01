"""Deployment probes for the Supabase corpus and its Neo4j read model."""

from __future__ import annotations

from tools.e2e_checks import data
from tools.e2e_checks.transport import FAIL, OK, SKIP


def test_supabase_mirror_requires_a_live_clean_drain(monkeypatch):
    mirror = {
        "configured": True,
        "running": True,
        "written": 17,
        "queued": 0,
        "failed": 0,
        "dropped": 0,
    }
    monkeypatch.setattr(data, "fetch", lambda *_args, **_kwargs: (200, {"supabase": mirror}, 3.0))
    healthy = data.check_supabase_mirror("token")
    assert healthy.state == OK
    assert healthy.data == {"written": 17, "queued": 0}

    mirror["running"] = False
    stopped = data.check_supabase_mirror("token")
    assert stopped.state == FAIL
    assert "drain task" in stopped.detail

    mirror["running"] = True
    mirror["dropped"] = 1
    lossy = data.check_supabase_mirror("token")
    assert lossy.state == FAIL
    assert "dropped" in lossy.detail


def test_unconfigured_supabase_mirror_is_not_reported_as_healthy(monkeypatch):
    monkeypatch.setattr(
        data,
        "fetch",
        lambda *_args, **_kwargs: (200, {"supabase": {"configured": False}}, 3.0),
    )
    result = data.check_supabase_mirror("token")
    assert result.state == SKIP
    assert "SUPABASE_MIRROR_ENABLED" in result.fix


def test_rag_status_requires_a_live_drain(monkeypatch):
    monkeypatch.setattr(data, "fetch", lambda *_args, **_kwargs: (200, {
        "configured": True,
        "running": True,
        "indexed": 12,
        "queued": 0,
        "pending_embeddings": 0,
        "failed": 0,
        "dropped": 0,
    }, 4.0))
    assert data.check_rag_status("token").state == OK

    monkeypatch.setattr(data, "fetch", lambda *_args, **_kwargs: (200, {
        "configured": True,
        "running": False,
    }, 4.0))
    stopped = data.check_rag_status("token")
    assert stopped.state == FAIL
    assert "drain task" in stopped.detail


def test_unconfigured_rag_is_not_reported_as_a_working_empty_index(monkeypatch):
    monkeypatch.setattr(data, "fetch", lambda *_args, **_kwargs: (200, {
        "configured": False,
        "running": False,
    }, 3.0))
    result = data.check_rag_status("token")
    assert result.state == SKIP
    assert "SUPABASE_DESK_ID" in result.fix


def _graph_payloads(sweep: str = "sweep-1") -> dict[str, dict]:
    return {
        "communities": {
            "source": "neo4j",
            "sweep": sweep,
            "detection": {
                "detected": True,
                "source": "neo4j",
                "sweep": sweep,
                "documents": 6,
                "edges": 7,
                "community_count": 2,
            },
        },
        "centrality": {
            "source": "neo4j",
            "ranking": {
                "ranked": True,
                "source": "neo4j",
                "sweep": sweep,
                "documents": 6,
                "edges": 7,
                "ranking": [{"id": "a", "score": 1.0}],
            },
        },
    }


def test_graph_probe_requires_one_neo4j_sweep_and_population(monkeypatch):
    payloads = _graph_payloads()

    def fetch(url, **_kwargs):
        return 200, payloads[url.rsplit("/", 1)[-1]], 5.0

    monkeypatch.setattr(data, "fetch", fetch)
    result = data.check_graph_linkage("token")
    assert result.state == OK
    assert result.data == {"documents": 6, "edges": 7, "communities": 2, "sweep": "sweep-1"}

    payloads["centrality"]["ranking"]["sweep"] = "sweep-2"
    mismatched = data.check_graph_linkage("token")
    assert mismatched.state == FAIL
    assert "same sweep/population" in mismatched.detail


def test_graph_probe_names_an_unconfigured_projection_as_optional(monkeypatch):
    fallback = {
        "source": "corpus",
        "read_model": {
            "reason": "NEO4J_URI/NEO4J_PASSWORD are unset, so the graph was not projected",
        },
    }
    monkeypatch.setattr(data, "fetch", lambda *_args, **_kwargs: (200, fallback, 5.0))
    result = data.check_graph_linkage("token")
    assert result.state == SKIP
    assert "NEO4J_URI" in result.fix
