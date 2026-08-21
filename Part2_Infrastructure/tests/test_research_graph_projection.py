"""The Neo4j projection, tested without a Neo4j.

Every assertion here runs against a fake session, deliberately. A test that
needs a live Aura instance is a test that does not run in CI, and CI is
network-free by construction — so the properties that matter would go unguarded
on exactly the path where an unreachable graph is most likely.

The properties that matter are all refusals. A projection is maintenance: it
must never take the gateway down, never raise into a scheduler tick, and never
report success for work it did not do. "Could not project" and "there was
nothing to project" are different facts, and the whole point of the report shape
is that a caller can tell them apart without parsing prose.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules import research_graph_projection as gp


def _settings(monkeypatch, **overrides):
    """Swap the whole settings object, not a field.

    `Settings` is a frozen dataclass, so setattr on it raises
    FrozenInstanceError — which is the point of freezing it, and why a test
    that wants different configuration substitutes the object instead.
    """
    base = {"neo4j_uri": "neo4j+s://x", "neo4j_user": "neo4j",
            "neo4j_password": "pw", "neo4j_database": "neo4j"}
    monkeypatch.setattr(gp, "settings", SimpleNamespace(**{**base, **overrides}))


class FakeSession:
    """Records the Cypher it was given. Raises only when told to."""

    def __init__(self, fail_on: str | None = None) -> None:
        self.statements: list[str] = []
        self.rows: list[list[dict]] = []
        self.fail_on = fail_on

    def run(self, cypher, **params):
        if self.fail_on and self.fail_on in cypher:
            raise RuntimeError("boom")
        self.statements.append(cypher)
        if "rows" in params:
            self.rows.append(params["rows"])
        return self

    def single(self):
        return {"n": 1}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeDriver:
    def __init__(self, session: FakeSession) -> None:
        self._session = session
        self.closed = False

    def session(self, **_):
        return self._session

    def close(self):
        self.closed = True


@pytest.fixture
def wired(monkeypatch):
    """A driver that works, so the tests below are about behaviour not plumbing."""
    session = FakeSession()
    monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
    return session


DOCS = [{"id": "a", "kind": "backtest", "symbol": "BTCUSDT"}, {"id": "b", "kind": "ml_run"}]
EDGES = [{"src_id": "a", "dst_id": "b", "relation": "same_symbol"}]


class TestAbsenceIsReportedNeverRaised:
    def test_an_unconfigured_desk_says_so_and_does_not_raise(self, monkeypatch):
        _settings(monkeypatch, neo4j_uri="")
        out = gp.project(DOCS, EDGES)
        assert out["projected"] is False
        assert "NEO4J_URI" in out["reason"]
        assert out["edges"] == 0

    def test_a_missing_driver_names_the_extras_file(self, monkeypatch):
        monkeypatch.setattr(gp, "_driver", lambda: (None, "the neo4j driver is not installed (pip install -r requirements-graph.txt)"))
        out = gp.project(DOCS, EDGES)
        assert out["projected"] is False
        assert "requirements-graph.txt" in out["reason"], "the reason must say how to fix it"

    def test_a_failure_mid_projection_is_a_report_not_an_exception(self, monkeypatch):
        session = FakeSession(fail_on="MERGE (a)-[")
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
        out = gp.project(DOCS, EDGES)
        assert out["projected"] is False
        assert "RuntimeError" in out["reason"]

    def test_nothing_to_project_is_not_a_failure(self, wired):
        # The distinction the report shape exists for: an empty corpus projected
        # successfully is `projected: True, edges: 0`, which is NOT the same as
        # `projected: False`.
        out = gp.project([], [])
        assert out["projected"] is True
        assert out["edges"] == 0
        assert out["reason"] is None


class TestItCannotInventARelationship:
    def test_an_unmapped_relation_refuses_the_whole_projection(self, wired):
        """A relation added to the Postgres enum must fail here, loudly.

        Silently skipping it would leave the graph quietly incomplete, which is
        the worst failure available: every traversal would still answer, just
        with an edge type missing and nothing saying so.
        """
        out = gp.project(DOCS, [{"src_id": "a", "dst_id": "b", "relation": "same_desk"}])
        assert out["projected"] is False
        assert "same_desk" in out["reason"]
        assert "RELATION_TYPES" in out["reason"], "the reason must name the fix"
        assert wired.statements == [], "nothing may be written when a relation is unmapped"

    def test_every_postgres_relation_has_a_mapping(self):
        # Kept in step with supabase/migrations/20260820090400_research_edges.sql.
        assert set(gp.RELATION_TYPES) == {
            "same_data", "same_symbol", "same_strategy",
            "same_regime", "followed_by", "promoted_to",
        }

    def test_the_interpolated_type_can_only_come_from_the_map(self, wired):
        gp.project(DOCS, EDGES)
        merges = [s for s in wired.statements if "MERGE (a)-[" in s]
        assert merges, "no relationship was written"
        for statement in merges:
            assert any(f"[:{t}]" in statement for t in gp.RELATION_TYPES.values()), (
                "a relationship type reached Cypher from somewhere other than RELATION_TYPES"
            )


class TestItIsSafeToRunTwice:
    def test_it_merges_and_never_creates(self, wired):
        gp.project(DOCS, EDGES)
        body = " ".join(wired.statements)
        assert "MERGE" in body
        assert "CREATE (" not in body, (
            "CREATE would duplicate on the second sweep; the projection must be idempotent"
        )

    def test_the_uniqueness_constraint_is_applied_first(self, wired):
        gp.project(DOCS, EDGES)
        assert "CONSTRAINT" in wired.statements[0], (
            "MERGE on an unconstrained property is a full scan, so the constraint "
            "must precede the first MERGE"
        )

    def test_a_repeat_projection_sends_the_same_statements(self, monkeypatch):
        first, second = FakeSession(), FakeSession()
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(first), None))
        gp.project(DOCS, EDGES)
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(second), None))
        gp.project(DOCS, EDGES)
        assert first.statements == second.statements


class TestItDoesNotLeakOrOverreach:
    def test_null_properties_are_dropped_rather_than_written_as_null(self, wired):
        gp.project([{"id": "a", "kind": "backtest", "symbol": None}], [])
        props = wired.rows[0][0]["props"]
        assert "symbol" not in props, (
            "a null property written as null is a measurement coerced into the graph; "
            "an absent key is the honest form"
        )
        assert props["kind"] == "backtest"

    def test_the_driver_is_closed_even_when_projection_fails(self, monkeypatch):
        session = FakeSession(fail_on="MERGE (d:Document")
        driver = FakeDriver(session)
        monkeypatch.setattr(gp, "_driver", lambda: (driver, None))
        gp.project(DOCS, EDGES)
        assert driver.closed is True, "a failed projection must not leak a connection"

    def test_configured_requires_a_password_not_just_a_uri(self, monkeypatch):
        _settings(monkeypatch, neo4j_password="")
        assert gp.configured() is False, (
            "a URI with no password reaches a server that refuses every statement; "
            "calling that configured moves the error far from its cause"
        )
