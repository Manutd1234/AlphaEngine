"""The whole-corpus edge read, and the seam it exists to close.

Two halves were built without meeting: `research_communities.detect_communities`
takes an edge list and reads nothing, and nothing in the tree read the whole
edge table. The module was dead code — a partition with no fetch in front of it
— and no suite could have said so, because each side's tests were complete on
their own.

So nothing in the SEAM tests below is substituted. `detect_communities` is the
real one, `project_communities` is the real one, and the report that reaches
Neo4j is the report Louvain actually produced from the rows the reader actually
returned. The only fakes are the PostgREST client and the Neo4j driver, which
are the network rather than collaborators — and CI is network-free by
construction. Monkeypatching either module here would prove the wiring against a
fiction of itself, which is the defect `tests/test_research_contract.py` was
written for.

The fake corpus PAGINATES for real: it sorts on the unique triple and applies
the keyset filter the reader sends it. A fake that ignored the cursor and handed
back a canned page would leave the walk untested on exactly the property that
makes it correct — that no edge is skipped at a page boundary.
"""

from __future__ import annotations

import ast
import inspect
import re
from importlib.util import find_spec
from pathlib import Path
from types import SimpleNamespace

import pytest

from modules import research_communities as rc
from modules import research_graph_projection as gp
from modules import research_graph_reads as gr

networkx_required = pytest.mark.skipif(
    find_spec("networkx") is None,
    reason="networkx is not installed (pip install -r requirements-communities.txt)",
)

DESK = "00000000-0000-0000-0000-000000000001"

#: Two disjoint triangles, as they sit in `research_edges`.
TRIANGLES = [
    {"src_id": "a", "dst_id": "b", "relation": "same_symbol"},
    {"src_id": "b", "dst_id": "c", "relation": "same_symbol"},
    {"src_id": "a", "dst_id": "c", "relation": "same_data"},
    {"src_id": "x", "dst_id": "y", "relation": "same_strategy"},
    {"src_id": "y", "dst_id": "z", "relation": "same_strategy"},
    {"src_id": "x", "dst_id": "z", "relation": "same_strategy"},
]

#: One source document joined to three others, and a second relation on one of
#: those pairs. Every page boundary in it falls inside a single ``src_id``,
#: which is the case a cursor keyed on ``src_id`` alone would silently skip.
ONE_SOURCE = [
    {"src_id": "a", "dst_id": "b", "relation": "same_data"},
    {"src_id": "a", "dst_id": "b", "relation": "same_symbol"},
    {"src_id": "a", "dst_id": "c", "relation": "same_symbol"},
    {"src_id": "a", "dst_id": "d", "relation": "same_symbol"},
]

_UNSET = object()


def _key(row: dict) -> tuple:
    return (row["src_id"], row["dst_id"], row["relation"])


def _cursor_key(expression: str) -> tuple:
    """The (src, dst, relation) a keyset filter means, read back out of the query string.

    Parsing rather than trusting: if the reader ever sends a cursor this cannot
    read, the test fails here with the expression in the message instead of the
    walk quietly returning everything twice.
    """
    match = re.search(
        r"and\(src_id\.eq\.([^,]+),dst_id\.eq\.([^,]+),relation\.gt\.([^)]+)\)", expression,
    )
    assert match, f"the reader sent a cursor no keyset can be read out of: {expression}"
    return match.groups()


class Reply:
    def __init__(self, payload, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakePostgrest:
    """A corpus that pages honestly: sorted on the unique triple, sliced to the limit."""

    def __init__(self, rows, *, status: int = 200, payload=_UNSET, ignore_cursor: bool = False) -> None:
        self.rows = sorted(rows, key=_key)
        self.status = status
        self.payload = payload
        self.ignore_cursor = ignore_cursor
        self.requests: list[dict] = []

    async def get(self, path, params=None, **_):
        self.requests.append({"path": path, **(params or {})})
        if self.status >= 300 or self.payload is not _UNSET:
            return Reply([] if self.payload is _UNSET else self.payload, self.status)
        rows = self.rows
        cursor = (params or {}).get("or")
        if cursor and not self.ignore_cursor:
            rows = [row for row in rows if _key(row) > _cursor_key(cursor)]
        return Reply(rows[: int((params or {})["limit"])])


class RecordingSession:
    """The Neo4j half. Records; never raises."""

    def __init__(self) -> None:
        self.statements: list[str] = []
        self.params: list[dict] = []
        self._last = 0

    def run(self, cypher, **params):
        self.statements.append(cypher)
        self.params.append(params)
        if "rows" in params:
            self._last = len(params["rows"])
        return self

    def single(self):
        return {"n": self._last}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def graph(monkeypatch):
    """A Neo4j that accepts everything, so a refusal in a test is the code's own."""
    session = RecordingSession()
    monkeypatch.setattr(gp, "_driver", lambda: (SimpleNamespace(
        session=lambda **_: session, close=lambda: None), None))
    return session


class TestTheReadIsWholeCorpusAndDeskFiltered:
    async def test_it_names_its_columns_and_filters_by_desk(self):
        client = FakePostgrest(TRIANGLES)
        await gr.read_all_edges(client, desk_id=DESK)
        first = client.requests[0]
        assert first["path"] == "/rest/v1/research_edges"
        assert first["desk_id"] == f"eq.{DESK}", (
            "an unfiltered read would partition every desk's corpus into one graph"
        )
        assert first["select"] == "src_id,dst_id,relation"
        assert first["order"] == "src_id.asc,dst_id.asc,relation.asc"

    async def test_it_pages_until_a_page_comes_back_short(self):
        client = FakePostgrest(TRIANGLES)
        out = await gr.read_all_edges(client, desk_id=DESK, page=2)
        assert out["read"] is True
        assert out["truncated"] is False
        assert out["pages"] == 4, "three full pages and the short one that ends the walk"
        assert sorted(map(_key, out["edges"])) == sorted(map(_key, TRIANGLES))

    async def test_the_cursor_is_a_keyset_on_the_whole_unique_triple(self):
        """`gt` on src_id alone skips every remaining edge out of the same document.

        `ONE_SOURCE` puts all four edges under one src_id, so a cursor that
        advanced on src_id would lose three of them and nothing would say so:
        a graph with fewer ties looks exactly like a corpus with fewer ties.
        """
        client = FakePostgrest(ONE_SOURCE)
        out = await gr.read_all_edges(client, desk_id=DESK, page=2)
        assert sorted(map(_key, out["edges"])) == sorted(map(_key, ONE_SOURCE))
        cursor = client.requests[1]["or"]
        assert "src_id.gt." in cursor
        assert "dst_id.gt." in cursor
        assert "relation.gt." in cursor

    async def test_a_row_returned_twice_is_read_once_and_counted(self):
        """The paging duplicate that would silently double a tie's weight.

        `_build` sums parallel edges into a weight, so an edge read twice makes
        that relation twice as strong and moves the partition. Deduplicated on
        the unique triple, and the repeats reported rather than swallowed.
        """
        client = FakePostgrest(TRIANGLES, ignore_cursor=True)
        out = await gr.read_all_edges(client, desk_id=DESK, page=2, max_pages=3)
        assert len(out["edges"]) == 2, "the same page three times is two distinct edges"
        assert out["duplicates"] == 4
        assert out["truncated"] is True


class TestAReadThatFailedIsNotAReadThatFoundNothing:
    async def test_an_unconfigured_corpus_names_the_variables(self):
        out = await gr.read_all_edges(None, desk_id=DESK)
        assert out["read"] is False
        assert "SUPABASE_URL" in out["reason"]
        assert out["edges"] == []

    async def test_a_failed_page_discards_what_was_already_read(self):
        out = await gr.read_all_edges(FakePostgrest(TRIANGLES, status=500), desk_id=DESK)
        assert out["read"] is False
        assert "HTTP 500" in out["reason"]
        assert out["edges"] == [], (
            "a short list handed to a caller is indistinguishable from a small corpus, "
            "and partitioning it would invent communities"
        )

    async def test_a_404_names_the_migration_rather_than_blaming_the_corpus(self):
        out = await gr.read_all_edges(FakePostgrest([], status=404), desk_id=DESK)
        assert "20260820090400" in out["reason"]

    async def test_a_body_that_is_not_json_is_a_reason(self):
        client = FakePostgrest([], payload=ValueError("not json"))
        out = await gr.read_all_edges(client, desk_id=DESK)
        assert out["read"] is False
        assert "not JSON" in out["reason"]

    async def test_a_body_that_is_not_a_list_is_a_reason(self):
        out = await gr.read_all_edges(FakePostgrest([], payload={"message": "no"}), desk_id=DESK)
        assert out["read"] is False
        assert "not a list" in out["reason"]

    async def test_an_empty_corpus_reads_successfully_with_no_edges(self):
        out = await gr.read_all_edges(FakePostgrest([]), desk_id=DESK)
        assert out["read"] is True, "'nothing to read' is not 'could not read'"
        assert out["edges"] == []
        assert out["reason"] is None


@networkx_required
class TestTheReaderAndThePartitionMeetForReal:
    async def test_the_rows_the_reader_returns_are_the_rows_louvain_partitions(self, graph):
        """The seam, with both real modules and no stand-in between them."""
        out = await gr.detect_corpus_communities(FakePostgrest(TRIANGLES), desk_id=DESK, page=2)
        detection = out["detection"]
        assert detection["detected"] is True, detection["reason"]
        assert detection["documents"] == 6
        assert detection["edges"] == 6
        assert [row["members"] for row in detection["communities"]] == [["a", "b", "c"], ["x", "y", "z"]]

    async def test_the_partition_reaches_neo4j_as_one_row_per_member(self, graph):
        out = await gr.detect_corpus_communities(FakePostgrest(TRIANGLES), desk_id=DESK, page=2)
        # Filtered to the COMMUNITY rows: the same sweep now writes centrality
        # scores through the same session, and a bare "every row it sent" would
        # count each document twice and read as a duplicated partition.
        rows = [row for params in graph.params if "rows" in params
                for row in params["rows"] if "community" in row]
        assert sorted(row["id"] for row in rows) == ["a", "b", "c", "x", "y", "z"]
        by_id = {row["id"]: row["community"] for row in rows}
        assert by_id["a"] == by_id["c"] != by_id["x"]
        assert out["projection"]["projected"] is True
        assert out["projection"]["labelled"] == 6

    async def test_every_label_carries_the_sweep_the_report_names(self, graph):
        out = await gr.detect_corpus_communities(FakePostgrest(TRIANGLES), desk_id=DESK)
        stamps = {params["sweep"] for params in graph.params if "sweep" in params}
        assert stamps == {out["sweep"]}, (
            "the stamp in the graph must be the stamp in the report, or a reader cannot "
            "tell which partition a label came from"
        )
        assert out["projection"]["sweep"] == out["sweep"]

    async def test_the_stamp_defaults_to_the_instant_rather_than_being_absent(self, graph):
        out = await gr.detect_corpus_communities(FakePostgrest(TRIANGLES), desk_id=DESK)
        assert out["sweep"].endswith("Z") and out["sweep"].startswith("20")
        assert (await gr.detect_corpus_communities(
            FakePostgrest(TRIANGLES), desk_id=DESK, sweep="fixed"))["sweep"] == "fixed"

    async def test_a_partition_only_caller_is_refused_by_name_not_silently_skipped(self, graph):
        out = await gr.detect_corpus_communities(
            FakePostgrest(TRIANGLES), desk_id=DESK, project=False)
        assert out["detection"]["detected"] is True
        assert out["projection"]["projected"] is False
        assert "partition only" in out["projection"]["reason"]
        assert graph.statements == [], "project=False must reach Neo4j not at all"


@networkx_required
class TestAFragmentIsNeverPartitioned:
    """The trap the community module's builder named, guarded at the seam."""

    async def test_a_truncated_read_refuses_to_partition_and_writes_nothing(self, graph):
        out = await gr.detect_corpus_communities(
            FakePostgrest(TRIANGLES), desk_id=DESK, page=2, max_pages=2)
        assert out["read"]["truncated"] is True
        assert out["detection"]["detected"] is False
        assert "FRAGMENT" in out["detection"]["reason"], (
            "partitioning the first N pages would return communities that do not exist "
            "in the whole graph, and nothing downstream could tell"
        )
        assert out["projection"]["projected"] is False
        assert graph.statements == [], "no label may be written from a fragment"

    async def test_a_failed_read_carries_its_reason_into_both_sub_reports(self, graph):
        out = await gr.detect_corpus_communities(FakePostgrest(TRIANGLES, status=500), desk_id=DESK)
        assert out["read"]["read"] is False
        assert out["detection"]["detected"] is False
        assert "HTTP 500" in out["detection"]["reason"]
        assert out["projection"]["projected"] is False
        assert "HTTP 500" in out["projection"]["reason"]
        assert graph.statements == []

    async def test_a_refused_detection_carries_no_modularity(self, graph):
        out = await gr.detect_corpus_communities(FakePostgrest([], status=500), desk_id=DESK)
        assert "modularity" not in out["detection"], (
            "a refusal measured nothing, and 0.0 would read as a worthless partition"
        )

    async def test_the_edge_rows_are_not_echoed_back_in_the_report(self, graph):
        out = await gr.detect_corpus_communities(FakePostgrest(TRIANGLES), desk_id=DESK)
        assert "edges" not in out["read"], "a whole-corpus edge list is a payload, not a report"
        assert out["read"]["pages"] == 1


class TestTheEntryPointARouteWillCall:
    async def test_an_unconfigured_desk_reports_rather_than_raising(self, monkeypatch):
        monkeypatch.setattr(gr, "settings", SimpleNamespace(
            supabase_url="", supabase_service_role_key="", supabase_desk_id=DESK,
            supabase_timeout_s=5.0))
        out = await gr.community_report()
        assert out["read"]["read"] is False
        assert "SUPABASE_URL" in out["detection"]["reason"]
        assert out["detection"]["detected"] is False
        assert out["projection"]["projected"] is False

    def test_it_takes_no_required_positional_argument(self):
        """So a route or a job can call it with keywords and nothing else."""
        params = inspect.signature(gr.community_report).parameters.values()
        assert not [
            p.name for p in params
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is p.empty
        ]


class TestTheModuleBoundariesHold:
    def test_no_optional_dependency_is_imported_at_module_level(self):
        """The gateway must boot on a desk with no networkx and no neo4j driver.

        Both are reached lazily through the modules that own them, and an import
        added here would take the whole service down for want of a feature it is
        not using.
        """
        tree = ast.parse(Path(gr.__file__).read_text())
        top = [node for node in tree.body if isinstance(node, ast.Import | ast.ImportFrom)]
        names = [alias.name for node in top for alias in getattr(node, "names", [])]
        names += [node.module or "" for node in top if isinstance(node, ast.ImportFrom)]
        for optional in ("networkx", "neo4j", "fastembed", "google"):
            assert not any(optional in name for name in names), (
                f"{optional} is imported at module level ({names})"
            )

    def test_the_community_module_still_reads_nothing_itself(self):
        """The property that keeps Louvain testable against a literal.

        The fetch lives in the caller. A `client` argument appearing in
        `detect_communities` would make every test of it a test of a database.
        """
        assert list(inspect.signature(rc.detect_communities).parameters) == [
            "edges", "seed", "resolution",
        ]
        source = Path(rc.__file__).read_text()
        for reached in ("/rest/v1/", "httpx", "client"):
            assert reached not in source, (
                f"research_communities reached for {reached!r}; the caller owns the fetch"
            )
