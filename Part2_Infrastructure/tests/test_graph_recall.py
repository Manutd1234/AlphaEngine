"""`tools/graph_recall.py` — the traversal, and the boundary around the narrator.

The fake here is deliberately STRICTER than a convenient one would be, because a fake looser than
the real object is how a green suite hides a broken tool. It is an ``httpx.MockTransport`` behind a
real ``httpx.Client``, so URL building, query encoding and JSON handling are httpx's own; it refuses
a request carrying no ``apikey``, as PostgREST does; it filters on ``desk_id`` and projects to the
columns ``select`` asked for, so reading a column the tool never selected fails here rather than in
production; and it reads the traversal function's ARGUMENT NAMES out of migration 20260820090500,
answering PGRST202 for any other argument the way PostgREST answers a call that matches no
signature.

The `claude` paths use real processes on a real PATH — a script that exits 3, one that prints
nothing, one that answers — because the interesting failures are exit codes and empty stdout, and a
stubbed ``subprocess.run`` would agree with whatever the test wanted.
"""

from __future__ import annotations

import json
import pathlib
import re
import stat

import httpx
import pytest

from tools import graph_recall

REPO = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = REPO.parent / "supabase" / "migrations"
TRAVERSAL_SQL = MIGRATIONS / "20260820090500_research_graph_traverse.sql"
EDGES_SQL = MIGRATIONS / "20260820090400_research_edges.sql"

#: The desk every fixture row belongs to. Every read the tool makes is scoped to it, exactly as
#: `persist_edges` scopes its writes, so a fake that ignored the column would be looser than the table.
DESK = "00000000-0000-0000-0000-000000000001"

RUN_A = {"id": "11111111-1111-4111-8111-111111111111", "kind": "backtest_run", "source_ref": "job-4412",
         "symbol": "BTCUSDT", "strategy": "ma_cross", "interval": "4h", "data_hash": "9f2c1a77",
         "occurred_at": "2026-08-12T09:14:00Z", "title": "Sweep: MA crossover BTCUSDT 4h", "desk_id": DESK}
RUN_B = {"id": "22222222-2222-4222-8222-222222222222", "kind": "ml_run", "source_ref": "run-77",
         "symbol": "BTCUSDT", "strategy": "gbdt", "interval": "4h", "data_hash": "9f2c1a77",
         "occurred_at": "2026-08-13T11:00:00Z", "title": "Fitted: GBDT BTCUSDT 4h", "desk_id": DESK}
INCIDENT = {"id": "33333333-3333-4333-8333-333333333333", "kind": "risk_incident", "source_ref": "ord-88ab",
            "symbol": "BTCUSDT", "strategy": None, "interval": None, "data_hash": None,
            "occurred_at": "2026-08-12T18:02:00Z", "title": "Breaker: daily drawdown", "desk_id": DESK}
DOCUMENTS = [RUN_A, RUN_B, INCIDENT]
EDGES = [
    {"src_id": RUN_A["id"], "dst_id": RUN_B["id"], "relation": "same_data", "evidence": "9f2c1a77",
     "desk_id": DESK},
    {"src_id": RUN_A["id"], "dst_id": INCIDENT["id"], "relation": "followed_by", "evidence": "BTCUSDT",
     "desk_id": DESK},
]


def traversal_arguments() -> set[str]:
    """The argument names migration 20260820090500 actually declares."""
    assert TRAVERSAL_SQL.exists(), f"missing {TRAVERSAL_SQL} — this test is reading a path that moved"
    signature = TRAVERSAL_SQL.read_text(encoding="utf-8").split("traverse_research_graph(", 1)[1].split(")\nreturns", 1)[0]
    names = {line.strip().split()[0] for line in signature.splitlines() if line.strip()}
    assert "start_id" in names and "max_depth" in names, names
    return names


class FakePostgrest:
    """PostgREST, near enough to refuse what the real one refuses."""
    def __init__(self, documents=DOCUMENTS, edges=EDGES, fail: dict[str, int] | None = None):
        self.documents = [dict(row) for row in documents]
        self.edges = [dict(row) for row in edges]
        self.fail = fail or {}
        self.requests: list[httpx.Request] = []

    def client(self) -> httpx.Client:
        client, reason = graph_recall.open_client(url="https://desk.invalid", key="service-role-secret",
                                                  transport=httpx.MockTransport(self.handle))
        assert reason is None and client is not None
        return client

    def corpus(self) -> graph_recall.Corpus:
        return graph_recall.Corpus(self.client(), DESK)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers.get("apikey"), "PostgREST refuses a request carrying no apikey"
        path = request.url.path
        if path in self.fail:
            return httpx.Response(self.fail[path], json={"message": "server error"})
        if path == "/rest/v1/research_documents":
            return httpx.Response(200, json=self._select(self.documents, request))
        if path == "/rest/v1/research_edges":
            return httpx.Response(200, json=self._select(self.edges, request))
        if path == "/rest/v1/rpc/traverse_research_graph":
            return self._traverse(request)
        return httpx.Response(404, json={"message": f"no relation {path}"})

    @staticmethod
    def _matches(row: dict, column: str, predicate: str) -> bool:
        if predicate.startswith("eq."):
            return str(row.get(column)) == predicate[3:]
        if predicate.startswith("in.("):
            return str(row.get(column)) in predicate[4:-1].split(",")
        raise AssertionError(f"the fake does not implement {predicate!r}")

    def _select(self, rows: list[dict], request: httpx.Request) -> list[dict]:
        params = dict(request.url.params)
        kept = list(rows)
        for column, predicate in params.items():
            if column in ("select", "order", "limit"):
                continue
            if column == "or":
                clauses = re.findall(r"(\w+)\.(in\.\([^)]*\)|eq\.[^,)]+)", predicate[1:-1])
                kept = [r for r in kept if any(self._matches(r, c, p) for c, p in clauses)]
                continue
            kept = [r for r in kept if self._matches(r, column, predicate)]
        if order := params.get("order"):
            column, _, direction = order.partition(".")
            kept.sort(key=lambda r: str(r.get(column) or ""), reverse=direction == "desc")
        if limit := params.get("limit"):
            kept = kept[:int(limit)]
        columns = params["select"].split(",")
        return [{c: row.get(c) for c in columns} for row in kept]

    def _traverse(self, request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        if set(payload) - traversal_arguments():
            return httpx.Response(404, json={"code": "PGRST202",
                                             "message": f"no function takes {sorted(payload)}"})
        wanted = payload.get("relations")
        by_id = {row["id"]: row for row in self.documents}
        frontier, seen, out = [(payload["start_id"], [payload["start_id"]])], {payload["start_id"]}, []
        for depth in range(1, min(max(int(payload.get("max_depth", 2)), 1), 4) + 1):
            following = []
            for node, path in frontier:
                for edge in self.edges:
                    if wanted and edge["relation"] not in wanted:
                        continue
                    ends = (str(edge["src_id"]), str(edge["dst_id"]))
                    if node not in ends:
                        continue
                    other = ends[1] if ends[0] == node else ends[0]
                    if other in seen:
                        continue
                    seen.add(other)
                    out.append({**{k: by_id[other][k] for k in
                                   ("id", "kind", "source_ref", "symbol", "strategy", "occurred_at", "title")},
                                "depth": depth, "arrived_by": edge["relation"],
                                "evidence": edge["evidence"], "path": [*path, other]})
                    following.append((other, [*path, other]))
            frontier = following
        return httpx.Response(200, json=out[:int(payload.get("match_count", 20))])


def on_path(monkeypatch, directory: pathlib.Path, body: str | None = None) -> None:
    """Put a real `claude` on a real PATH, or deliberately leave the PATH without one.

    A directory with nothing in it is the honest way to test absence: `shutil.which` does the
    looking, and this machine's own `claude` — if it has one — is out of scope either way.
    """
    if body is None:
        monkeypatch.setenv("PATH", str(directory))
        return
    binary = directory / "claude"
    binary.write_text(f"#!/bin/sh\n{body}\n")
    binary.chmod(binary.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    # `cat` and friends have to stay reachable, or the script fails for a reason the test did not mean.
    monkeypatch.setenv("PATH", f"{directory}:/bin:/usr/bin")


class TestTheTraversal:
    def test_a_run_reference_resolves_then_walks(self):
        fake = FakePostgrest()
        result = graph_recall.from_run(fake.corpus(), "job-4412", "linked to job-4412")
        assert result.state == "ok"
        assert [row["source_ref"] for row in result.rows] == ["run-77", "ord-88ab"]
        assert [row["arrived_by"] for row in result.rows] == ["same_data", "followed_by"]
        assert "job-4412" in result.notes[0]
        # Resolved by source_ref, because the reference is not a uuid.
        assert dict(fake.requests[0].url.params)["source_ref"] == "eq.job-4412"

    def test_a_uuid_resolves_on_the_id_column(self):
        fake = FakePostgrest()
        result = graph_recall.from_run(fake.corpus(), RUN_A["id"], "linked")
        assert result.state == "ok" and result.rows
        assert dict(fake.requests[0].url.params)["id"] == f"eq.{RUN_A['id']}"

    def test_the_rpc_is_called_with_the_arguments_the_migration_declares(self):
        fake = FakePostgrest()
        graph_recall.from_run(fake.corpus(), "job-4412", "linked", depth=9, limit=500,
                              relations=["same_data"])
        call = json.loads(fake.requests[-1].content)
        assert set(call) <= traversal_arguments()
        assert call["max_depth"] == 4, "the CTE caps depth at 4; asking for 9 must not send 9"
        assert call["match_count"] == 100
        assert call["relations"] == ["same_data"]

    def test_relations_match_the_enum_in_the_migration(self):
        assert EDGES_SQL.exists(), f"missing {EDGES_SQL} — this test is reading a path that moved"
        declared = re.findall(r"^\s*'(\w+)',?$", EDGES_SQL.read_text(encoding="utf-8"), re.M)
        assert declared, "no enum members found; the extraction, not the tool, is broken"
        assert set(graph_recall.RELATIONS) == set(declared)

    def test_an_incident_resolves_by_its_order_id_and_kind(self):
        fake = FakePostgrest()
        result = graph_recall.from_run(fake.corpus(), "ord-88ab", "what led here", kind="risk_incident")
        assert result.state == "ok" and dict(fake.requests[0].url.params)["kind"] == "eq.risk_incident"
        assert [row["source_ref"] for row in result.rows] == ["job-4412", "run-77"]

    def test_reaching_nothing_is_an_answer_not_a_failure(self):
        fake = FakePostgrest(edges=[])
        result = graph_recall.from_run(fake.corpus(), "job-4412", "linked")
        assert result.state == "ok" and result.rows == []
        assert "not a failure" in result.notes[-1]


class TestTheDataHashQuestion:
    """Every run over the same bars, and what happened to each afterwards."""
    def test_each_run_carries_what_followed_it(self):
        result = graph_recall.over_data_hash(FakePostgrest().corpus(), "9f2c1a77", "same bars")
        assert result.state == "ok" and [r["source_ref"] for r in result.rows] == ["job-4412", "run-77"]
        breaker = result.rows[0]["outcomes"]
        assert [o["relation"] for o in breaker] == ["followed_by"]
        assert breaker[0]["document"]["kind"] == "risk_incident"
        assert result.rows[1]["outcomes"] == [], "a run with no downstream edge is [], not None"

    def test_a_failed_edge_read_is_partial_with_outcomes_unknown(self):
        fake = FakePostgrest(fail={"/rest/v1/research_edges": 500})
        result = graph_recall.over_data_hash(fake.corpus(), "9f2c1a77", "same bars")
        assert result.state == "partial"
        assert len(result.rows) == 2, "the runs were read successfully and are still the answer"
        assert all(row["outcomes"] is None for row in result.rows), "unknown is None, never []"
        assert "HTTP 500" in result.reason
        assert graph_recall.DASH in graph_recall.render(result)

    def test_a_hash_no_document_carries_is_ok_and_says_so(self):
        result = graph_recall.over_data_hash(FakePostgrest().corpus(), "deadbeef", "same bars")
        assert result.state == "ok" and result.rows == [] and "nothing failed" in result.notes[0]


class TestUnavailableIsNeverEmpty:
    def test_a_postgrest_failure_is_unavailable_with_its_reason(self):
        fake = FakePostgrest(fail={"/rest/v1/research_documents": 500})
        result = graph_recall.over_data_hash(fake.corpus(), "9f2c1a77", "same bars")
        assert result.state == "unavailable", "a failed read must never be reported as ok"
        assert result.rows == []
        assert "HTTP 500" in result.reason
        rendered = graph_recall.render(result)
        assert "unavailable" in rendered and "HTTP 500" in rendered

    def test_a_missing_traversal_function_names_the_migration(self):
        fake = FakePostgrest(fail={"/rest/v1/rpc/traverse_research_graph": 404})
        result = graph_recall.from_run(fake.corpus(), "job-4412", "linked")
        assert result.state == "unavailable"
        assert "20260820090500" in result.reason

    def test_a_transport_error_is_unavailable_with_the_error_named(self):
        def boom(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host", request=request)

        client, _ = graph_recall.open_client(url="https://desk.invalid", key="k",
                                             transport=httpx.MockTransport(boom))
        result = graph_recall.by_column(graph_recall.Corpus(client, "desk"), "symbol", "BTCUSDT", "q")
        assert result.state == "unavailable" and result.rows == []
        assert "ConnectError" in result.reason

    def test_unconfigured_reports_both_names_and_returns_no_client(self):
        client, reason = graph_recall.open_client(url="", key="")
        assert client is None
        assert "SUPABASE_URL" in reason and "SUPABASE_SERVICE_ROLE_KEY" in reason
        assert "holds nothing" in reason


class TestTheOtherEntryPoints:
    def test_symbol_lists_documents_with_their_edge_counts(self):
        result = graph_recall.by_column(FakePostgrest().corpus(), "symbol", "BTCUSDT", "on BTCUSDT")
        assert result.state == "ok"
        assert {row["source_ref"]: row["edges"] for row in result.rows} == {
            "job-4412": 2, "run-77": 1, "ord-88ab": 1}

    def test_a_failed_edge_count_is_none_and_renders_as_a_dash(self):
        fake = FakePostgrest(fail={"/rest/v1/research_edges": 500})
        result = graph_recall.by_column(fake.corpus(), "strategy", "ma_cross", "on ma_cross")
        assert result.state == "partial" and result.rows[0]["edges"] is None, "unread is None, never 0"
        assert f"edges {graph_recall.DASH}" in graph_recall.render(result)

    def test_a_null_column_renders_as_a_dash_but_zero_survives(self):
        assert graph_recall._cell(None) == graph_recall.DASH
        assert graph_recall._cell(0) == "0", "zero is a measurement, not a missing value"
        rendered = graph_recall.render(graph_recall.Recall("ok", "q", rows=[dict(INCIDENT)]))
        assert graph_recall.DASH in rendered and "risk_incident" in rendered


class TestTheNarrator:
    def result(self) -> graph_recall.Recall:
        return graph_recall.over_data_hash(FakePostgrest().corpus(), "9f2c1a77", "same bars")

    def test_absent_claude_is_reported_with_its_reason(self, tmp_path, monkeypatch):
        on_path(monkeypatch, tmp_path)
        narration = graph_recall.narrate(self.result())
        assert narration.state == "absent" and narration.text is None and "not on PATH" in narration.reason
        assert graph_recall.MARKS["unavailable"] in graph_recall.render_narration(narration, 2)

    def test_an_empty_result_is_a_reported_skip_not_prose_about_nothing(self, tmp_path, monkeypatch):
        on_path(monkeypatch, tmp_path, f"echo ran > {tmp_path}/ran.txt")
        narration = graph_recall.narrate(graph_recall.Recall("unavailable", "q", reason="HTTP 500"))
        assert narration.state == "skipped" and narration.text is None
        assert "no rows to narrate" in narration.reason
        assert not (tmp_path / "ran.txt").exists(), "`claude` must not be run over an empty result"

    def test_a_failing_claude_reports_its_exit_code_and_stderr(self, tmp_path, monkeypatch):
        on_path(monkeypatch, tmp_path, 'cat > /dev/null\necho "not logged in" >&2\nexit 3')
        narration = graph_recall.narrate(self.result())
        assert narration.state == "failed" and narration.text is None
        assert "exited 3" in narration.reason and "not logged in" in narration.reason

    def test_claude_printing_nothing_is_a_failure_not_an_empty_narration(self, tmp_path, monkeypatch):
        on_path(monkeypatch, tmp_path, "cat > /dev/null\nexit 0")
        narration = graph_recall.narrate(self.result())
        assert narration.state == "failed" and "printed nothing" in narration.reason

    def test_a_narration_is_marked_as_prose_over_the_rows(self, tmp_path, monkeypatch):
        on_path(monkeypatch, tmp_path, f'printf "%s " "$@" > {tmp_path}/argv.txt\n'
                f'cat > {tmp_path}/stdin.txt\necho "the sweep preceded the breaker"')
        narration = graph_recall.narrate(self.result())
        assert narration.state == "ok" and narration.text == "the sweep preceded the breaker"
        assert "not a retrieval" in graph_recall.render_narration(narration, 2)
        # The rows went in over stdin, and no credential went anywhere near argv.
        sent = (tmp_path / "stdin.txt").read_text()
        assert "job-4412" in sent and "ord-88ab" in sent
        assert "service-role-secret" not in sent
        assert (tmp_path / "argv.txt").read_text().strip() == "-p", "argv is the process table; keys stay out"

    def test_the_prompt_is_capped_and_never_carries_a_key(self):
        prompt = graph_recall.narration_prompt(self.result())
        assert len(prompt) <= graph_recall.NARRATION_BUDGET + 600
        assert "service-role-secret" not in prompt and "apikey" not in prompt


class TestTheCommandLine:
    def run(self, argv, fake, monkeypatch, capsys):
        client = fake.client()  # built before the patch, so the real open_client is what makes it
        monkeypatch.setattr(graph_recall, "open_client", lambda **_: (client, None))
        code = graph_recall.main(argv)
        return code, capsys.readouterr().out

    def test_json_is_scriptable_without_any_narrator(self, monkeypatch, capsys):
        code, out = self.run(["--data-hash", "9f2c1a77", "--json"], FakePostgrest(), monkeypatch, capsys)
        payload = json.loads(out)
        assert code == 0 and payload["state"] == "ok" and payload["row_count"] == 2
        assert payload["narration"] is None
        assert payload["rows"][0]["outcomes"][0]["document"]["kind"] == "risk_incident"

    def test_json_carries_the_unavailable_reason_and_exits_two(self, monkeypatch, capsys):
        fake = FakePostgrest(fail={"/rest/v1/research_documents": 503})
        code, out = self.run(["--symbol", "BTCUSDT", "--json"], fake, monkeypatch, capsys)
        payload = json.loads(out)
        assert code == 2 and payload["state"] == "unavailable" and payload["rows"] == []
        assert "HTTP 503" in payload["reason"], "a failed read is never an empty corpus"

    def test_partial_exits_one_and_still_prints_the_rows(self, monkeypatch, capsys):
        fake = FakePostgrest(fail={"/rest/v1/research_edges": 500})
        code, out = self.run(["--data-hash", "9f2c1a77"], fake, monkeypatch, capsys)
        assert code == 1 and "job-4412" in out and "run-77" in out

    def test_the_rows_print_even_when_the_narrator_is_absent(self, tmp_path, monkeypatch, capsys):
        on_path(monkeypatch, tmp_path)
        code, out = self.run(["--data-hash", "9f2c1a77", "--narrate"], FakePostgrest(), monkeypatch, capsys)
        assert code == 0 and "job-4412" in out and "ord-88ab" in out, "the deterministic rows must survive"
        assert "NARRATION NOT AVAILABLE" in out and "not on PATH" in out

    def test_a_narration_never_replaces_the_rows(self, tmp_path, monkeypatch, capsys):
        on_path(monkeypatch, tmp_path, "cat > /dev/null\necho 'one sweep, one breaker'")
        code, out = self.run(["--data-hash", "9f2c1a77", "--narrate"], FakePostgrest(), monkeypatch, capsys)
        assert code == 0 and "one sweep, one breaker" in out
        assert out.index("job-4412") < out.index("one sweep, one breaker"), "rows first, prose after"

    def test_an_entry_point_is_required(self):
        with pytest.raises(SystemExit):
            graph_recall.main([])


class TestTheGatewayNeverDependsOnThis:
    def test_no_module_and_not_main_imports_the_tool(self):
        assert (REPO / "tools" / "graph_recall.py").exists(), "the tool moved; this scan is reading nothing"
        scanned = [*(REPO / "modules").rglob("*.py"), REPO / "main.py"]
        assert len(scanned) > 30, f"only {len(scanned)} files scanned — the scan is looking in the wrong place"
        found = [str(f.relative_to(REPO)) for f in scanned if "graph_recall" in f.read_text(encoding="utf-8")]
        assert found == [], f"the gateway must not depend on a tool: {found}"

    def test_nothing_in_the_request_path_shells_out_to_claude(self):
        scanned = [*(REPO / "modules").rglob("*.py"), REPO / "main.py"]
        assert len(scanned) > 30, f"only {len(scanned)} files scanned — the scan is looking in the wrong place"
        found = [str(f.relative_to(REPO)) for f in scanned if '"claude"' in f.read_text(encoding="utf-8")]
        assert found == [], f"a non-deterministic call in the request path: {found}"

    def test_the_tool_adds_no_dependency_to_the_core_requirements(self):
        core = (REPO / "requirements-core.txt").read_text(encoding="utf-8").lower()
        assert "anthropic" not in core and "claude" not in core
        source = (REPO / "tools" / "graph_recall.py").read_text(encoding="utf-8")
        assert "import anthropic" not in source and "from anthropic" not in source
