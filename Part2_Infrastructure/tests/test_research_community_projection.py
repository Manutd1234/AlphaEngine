"""The community writeback, tested without a Neo4j — and without a fake partition.

Same argument as `tests/test_research_graph_projection.py`, whose fakes this
file follows: a test that needs a live Aura is a test that does not run in CI,
and CI is network-free. The driver is the only thing stubbed here, because the
driver is the network. The community REPORT is never stubbed — every report a
test writes back is one `modules.research_communities.detect_communities`
actually produced, so the two modules meet for real. A hand-written dict shaped
like a report is exactly the fiction `tests/test_research_contract.py` exists to
forbid: a mocked collaborator cannot fail a contract.

The properties that matter are the refusals and the stamp. `project` must stay a
pure edge copy; a report that could not detect must never be written back as an
empty partition; and `community_sweep` must reach every labelled node, because a
community id with no sweep on it cannot be told apart from a stale one.
"""

from __future__ import annotations

import inspect
from importlib.util import find_spec
from pathlib import Path
from types import SimpleNamespace

import pytest

from modules import research_communities as rc
from modules import research_graph_projection as gp
from modules import research_reconcile

networkx_required = pytest.mark.skipif(
    find_spec("networkx") is None,
    reason="networkx is not installed (pip install -r requirements-communities.txt)",
)

SWEEP = "2026-08-21T09:00:00Z"

#: Two disjoint triangles — the partition nobody argues about, which is what
#: makes it a usable fixture for questions about the WRITEBACK.
TRIANGLES = [
    {"src_id": "a", "dst_id": "b", "relation": "same_symbol"},
    {"src_id": "b", "dst_id": "c", "relation": "same_symbol"},
    {"src_id": "a", "dst_id": "c", "relation": "same_data"},
    {"src_id": "x", "dst_id": "y", "relation": "same_strategy"},
    {"src_id": "y", "dst_id": "z", "relation": "same_strategy"},
    {"src_id": "x", "dst_id": "z", "relation": "same_strategy"},
]


class FakeSession:
    """Records the Cypher and the parameters it was given. Raises only when told to.

    `matched` is how the fake answers ``RETURN count(d) AS n``: "all" for a graph
    holding every id, an integer for one that holds fewer, and "silent" for a
    driver that returns a record with no count in it at all — the case the
    report must carry as None rather than as zero.
    """

    def __init__(self, fail_on: str | None = None, matched: object = "all") -> None:
        self.statements: list[str] = []
        self.rows: list[list[dict]] = []
        self.params: list[dict] = []
        self.fail_on = fail_on
        self.matched = matched
        self._last = 0

    def run(self, cypher, **params):
        if self.fail_on and self.fail_on in cypher:
            raise RuntimeError("boom")
        self.statements.append(cypher)
        self.params.append(params)
        if "rows" in params:
            self.rows.append(params["rows"])
            self._last = len(params["rows"])
        return self

    def single(self):
        if self.matched == "all":
            return {"n": self._last}
        if self.matched == "silent":
            return {}
        if self.matched is None:
            return None
        return {"n": self.matched}

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


@pytest.fixture
def report():
    """A REAL partition of `TRIANGLES`, not a dict shaped like one."""
    pytest.importorskip("networkx")
    out = rc.detect_communities(TRIANGLES)
    assert out["detected"] is True, f"the fixture itself failed to partition: {out['reason']}"
    return out


class TestAbsenceIsReportedNeverRaised:
    def test_an_unconfigured_desk_says_so_and_does_not_raise(self, monkeypatch, report):
        monkeypatch.setattr(gp, "settings", SimpleNamespace(
            neo4j_uri="", neo4j_user="neo4j", neo4j_password="pw", neo4j_database="neo4j"))
        out = gp.project_communities(report, sweep=SWEEP)
        assert out["projected"] is False
        assert "NEO4J_URI" in out["reason"]
        assert out["members"] == 0

    def test_a_missing_driver_names_the_extras_file(self, monkeypatch, report):
        monkeypatch.setattr(gp, "_driver", lambda: (
            None, "the neo4j driver is not installed (pip install -r requirements-graph.txt)"))
        out = gp.project_communities(report, sweep=SWEEP)
        assert out["projected"] is False
        assert "requirements-graph.txt" in out["reason"], "the reason must say how to fix it"

    def test_a_failure_mid_write_is_a_report_not_an_exception(self, monkeypatch, report):
        session = FakeSession(fail_on="SET d.community")
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
        out = gp.project_communities(report, sweep=SWEEP)
        assert out["projected"] is False
        assert "RuntimeError" in out["reason"], "the report must name what went wrong"

    def test_the_driver_is_closed_even_when_the_write_fails(self, monkeypatch, report):
        driver = FakeDriver(FakeSession(fail_on="SET d.community"))
        monkeypatch.setattr(gp, "_driver", lambda: (driver, None))
        gp.project_communities(report, sweep=SWEEP)
        assert driver.closed is True, "a failed writeback must not leak a connection"

    def test_a_refusal_carries_no_labelled_count_at_all(self, monkeypatch, report):
        monkeypatch.setattr(gp, "_driver", lambda: (None, "no driver"))
        out = gp.project_communities(report, sweep=SWEEP)
        assert "labelled" not in out, (
            "a refusal measured nothing; a null count sitting in the report is the "
            "one somebody later defaults to zero"
        )


class TestItRefusesToWriteBackAPartitionThatWasNotFound:
    def test_an_undetected_report_is_never_written(self, wired, monkeypatch):
        """The one case where writing "zero communities" would be a lie.

        A failed detection and an unlinked corpus both carry an empty
        `communities` list, and labelling from the first would leave the graph
        looking exactly as it does after the second.
        """
        monkeypatch.setattr(rc, "_networkx", lambda: (None, "networkx is not installed"))
        refused = rc.detect_communities(TRIANGLES)
        assert refused["detected"] is False, "the fixture must be a genuine refusal"

        out = gp.project_communities(refused, sweep=SWEEP)
        assert out["projected"] is False
        assert "could not detect" in out["reason"]
        assert wired.statements == [], "nothing may be written from a report that detected nothing"

    @networkx_required
    def test_an_empty_corpus_labels_nothing_and_that_is_a_success(self, wired):
        """"Nothing to label" is not "could not label" — the distinction the shape exists for."""
        out = gp.project_communities(rc.detect_communities([]), sweep=SWEEP)
        assert out["projected"] is True
        assert out["members"] == 0
        assert out["labelled"] == 0
        assert out["reason"] is None


@networkx_required
class TestTheSweepStampIsLoadBearing:
    def test_the_stamp_cannot_be_omitted_by_accident(self):
        """A default would make the stamp droppable, which is the whole failure.

        Community ids are reproducible for a fixed edge set and NOT across edge
        sets, so a label written without a sweep is indistinguishable from one
        left behind by a partition three corpora ago.
        """
        sweep = inspect.signature(gp.project_communities).parameters["sweep"]
        assert sweep.default is inspect.Parameter.empty, "the sweep stamp must be required"
        assert sweep.kind is inspect.Parameter.KEYWORD_ONLY

    def test_every_label_write_carries_the_stamp(self, wired, report):
        gp.project_communities(report, sweep=SWEEP)
        writes = [p for p in wired.params if "rows" in p]
        assert writes, "no label was written"
        for params in writes:
            assert params["sweep"] == SWEEP

    def test_the_cypher_sets_both_the_community_and_the_sweep(self, wired, report):
        gp.project_communities(report, sweep=SWEEP)
        statement = next(s for s in wired.statements if "SET d.community" in s)
        assert "MATCH (d:Document {id: row.id})" in statement
        assert "d.community = row.community" in statement
        assert "d.community_sweep = $sweep" in statement, (
            "a community label with no sweep attached cannot be told apart from a stale one"
        )

    def test_the_uniqueness_constraint_is_applied_first(self, wired, report):
        gp.project_communities(report, sweep=SWEEP)
        assert "CONSTRAINT" in wired.statements[0], (
            "MATCH on an unconstrained property is a full scan, so the constraint "
            "must precede the first label write"
        )


@networkx_required
class TestTheRowsAreThePartitionThatWasFound:
    def test_one_row_per_member_per_community(self, wired, report):
        gp.project_communities(report, sweep=SWEEP)
        rows = [row for batch in wired.rows for row in batch]
        expected = [{"id": member, "community": community["id"]}
                    for community in report["communities"] for member in community["members"]]
        assert rows == expected
        assert sorted(r["id"] for r in rows) == ["a", "b", "c", "x", "y", "z"]

    def test_the_two_triangles_are_labelled_as_two_communities(self, wired, report):
        gp.project_communities(report, sweep=SWEEP)
        rows = [row for batch in wired.rows for row in batch]
        by_id = {row["id"]: row["community"] for row in rows}
        assert by_id["a"] == by_id["b"] == by_id["c"]
        assert by_id["x"] == by_id["y"] == by_id["z"]
        assert by_id["a"] != by_id["x"], "two disjoint triangles must not share a label"

    def test_a_large_partition_is_written_in_batches(self, monkeypatch, report):
        session = FakeSession()
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
        monkeypatch.setattr(gp, "BATCH", 2)
        out = gp.project_communities(report, sweep=SWEEP)
        assert [len(batch) for batch in session.rows] == [2, 2, 2]
        assert out["labelled"] == 6, "the count must sum across batches, not report the last one"


@networkx_required
class TestTheCountIsWhatNeo4jMatched:
    def test_a_document_the_graph_does_not_hold_is_not_counted_as_labelled(self, monkeypatch, report):
        """MATCH skips an id the graph has never seen, and says nothing about it.

        Counting the rows SENT would report a fully labelled corpus on a Neo4j
        that holds none of it — the projection having never run, or having run
        against a different desk.
        """
        session = FakeSession(matched=4)
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
        out = gp.project_communities(report, sweep=SWEEP)
        assert out["members"] == 6
        assert out["labelled"] == 4, "the report must carry what the graph matched, not what was sent"

    def test_an_unreadable_count_is_none_and_never_zero(self, monkeypatch, report):
        session = FakeSession(matched="silent")
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
        out = gp.project_communities(report, sweep=SWEEP)
        assert out["projected"] is True, "the write happened; only the count is missing"
        assert out["labelled"] is None, (
            "0 would say the graph holds none of these documents; the truth is that "
            "the store did not say how many it matched"
        )

    def test_a_driver_returning_no_record_is_also_none(self, monkeypatch, report):
        session = FakeSession(matched=None)
        monkeypatch.setattr(gp, "_driver", lambda: (FakeDriver(session), None))
        assert gp.project_communities(report, sweep=SWEEP)["labelled"] is None


class TestTheEdgeCopyStaysAPureEdgeCopy:
    def test_project_writes_no_community_property(self):
        """`project` is rebuildable from Postgres alone; a partition is not.

        Folding the label into it would make every per-tick projection carry a
        partition computed from one window's edges — communities that do not
        exist in the whole graph.
        """
        source = inspect.getsource(gp.project)
        assert "community" not in source, (
            "project() must stay a pure edge copy; the labels belong to project_communities"
        )

    def test_the_per_tick_sweep_labels_nothing(self):
        """The trap this split exists to keep shut, asserted where it would be sprung.

        `research_reconcile._project_graph` holds an edge list and calling
        `detect_communities` on it would read as the obvious next commit. A tick
        carries ONE WINDOW, and a partition of a window is not a partition of
        the corpus — so the sweep must reach `project` and nothing else.
        """
        source = Path(research_reconcile.__file__).read_text()
        for forbidden in ("detect_communities", "project_communities", "research_communities"):
            assert forbidden not in source, (
                f"research_reconcile references {forbidden}: a reconciliation tick carries one "
                "window's edges, and partitioning a fragment invents communities that do not "
                "exist in the whole graph. Communities are a whole-corpus operation"
            )
