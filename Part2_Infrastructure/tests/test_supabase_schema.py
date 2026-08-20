"""The committed Supabase SQL, held in parity with the Python engine — offline.

Even a two-gate SQL sandbox can drift from config.py, and a mirror that
relabels or drops a gate is worse than no mirror. These tests parse the
committed migration text and import the live settings/engine, so the drift
surfaces as a red test instead of a silently wrong Postgres blotter. No test
here touches a network or a database.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from config import settings
from modules.risk_proxy import GATE_ORDER
from modules.supabase_mirror import GATE_TO_VERDICT

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"
SQL = {path.name: path.read_text() for path in sorted(MIGRATIONS.glob("*.sql"))}
ALL_SQL = "\n".join(SQL.values())
# The WHOLE risk_proxy package, not one named file.
#
# This read `modules/risk_proxy.py` by path and broke the moment that module
# became a package — loudly, with FileNotFoundError, which is the good failure
# mode and the reason this was caught. Re-pointing it at
# `risk_proxy/decision.py` would only move the breakage to the next split, and
# would be worse: a gate emitted from a sibling module would go unharvested and
# this test would pass against a SMALLER set than the engine can raise, which
# is precisely the drift it exists to catch.
#
# Reading every module in the package means a gate may move WITHIN the package
# without this test caring, while the property it guards — that every gate the
# engine can emit has a verdict in the map and a label in the SQL enum — still
# fails loudly if either side changes alone.
RISK_PROXY_PKG = Path(__file__).resolve().parent.parent / "modules" / "risk_proxy"
RISK_PROXY_FILES = sorted(RISK_PROXY_PKG.glob("*.py"))
RISK_PROXY = "\n".join(path.read_text() for path in RISK_PROXY_FILES)


def engine_gate_names() -> set[str]:
    """Every gate name `submit()` can emit, read from the package's source.

    Parsed, not grepped. The regex this replaced — `add\("([a-z_]+)"` — could
    only see a call whose name literal sat on the same line as the `add(`, and
    two of the seventeen gates do not: `paper_execution_model` and
    `reference_freshness` are written across several lines because they carry
    `observed=`/`limit=`. The harvest therefore returned FIFTEEN names, which
    is exactly the number of keys `GATE_TO_VERDICT` holds, so
    `test_every_engine_gate_maps_into_the_enum` compared fifteen against
    fifteen and passed — while the two gates it could not see had no verdict in
    the map and no label in the SQL enum. Both sides had drifted to the same
    wrong answer, which is the one arrangement a set comparison cannot detect.

    An AST walk sees the call however it is formatted. `ast.Name` and not
    `ast.Attribute` on purpose: `submit()`'s local helper is a bare `add(...)`,
    while `self._seen_set.add(...)` and `halted_symbols.add(...)` are set
    mutations that are not gates.
    """
    harvested: set[str] = set()
    for path in RISK_PROXY_FILES:
        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "add"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                harvested.add(node.args[0].value)
    return harvested


class TestMigrationHygiene:
    def test_filenames_are_ordered_timestamped_migrations(self):
        for name in SQL:
            assert re.fullmatch(r"\d{14}_[a-z0-9_]+\.sql", name), name
        assert list(SQL) == sorted(SQL), "migrations must apply in filename order"

    def test_no_secret_shaped_literals(self):
        for shape in (r"\bsb_(secret|publishable)_", r"\beyJ[A-Za-z0-9_-]{10,}"):
            assert not re.search(shape, ALL_SQL)


class TestGateParity:
    def test_the_harvest_reads_a_package_worth_scanning(self):
        """A glob that matched nothing would make every assertion below pass.

        This is the shape that has gone wrong nine times in this codebase: a
        source scan whose path stopped holding its subject does not fail, it
        passes having read an empty string.
        """
        assert len(RISK_PROXY_FILES) > 1, f"only found {len(RISK_PROXY_FILES)} modules"
        assert 'add("' in RISK_PROXY, "the package source carries no gate calls"
        # Anchored to the DECLARED registry rather than to a floor. A floor of
        # ten was satisfied by a harvest that had gone blind to two gates, and
        # a harvest that is merely "big enough" is a harvest nobody can trust
        # the next comparison against. `GATE_ORDER` is itself pinned to the
        # seventeen names by `tests/test_decision_core_native.py`, so this ties
        # the scan to something that cannot quietly shrink with it.
        assert engine_gate_names() == set(GATE_ORDER), (
            "the harvest and the declared gate registry disagree — "
            f"unharvested: {sorted(set(GATE_ORDER) - engine_gate_names())}, "
            f"unregistered: {sorted(engine_gate_names() - set(GATE_ORDER))}"
        )

    def test_every_engine_gate_maps_into_the_enum(self):
        engine = engine_gate_names()
        assert engine == set(GATE_TO_VERDICT), (
            "GATE_TO_VERDICT out of step with risk_proxy's gates — "
            f"engine-only: {engine - set(GATE_TO_VERDICT)}, "
            f"map-only: {set(GATE_TO_VERDICT) - engine}"
        )

    def test_every_mapped_verdict_is_declared_in_the_sql_enum(self):
        """The CREATE plus every later ALTER, not one migration file.

        This read `20260808120000_desk_enums.sql` alone. An enum is not defined
        by the migration that creates it — `alter type … add value` in a later
        migration is just as much part of it, and pinning the CREATE means a
        value added afterwards is invisible here. That is how
        `paper_execution_model` and `reference_freshness` could be added to the
        map and still be reported missing from an enum that now declares them.
        """
        declared = self._declared_verdicts()
        for label in list(GATE_TO_VERDICT.values()) + ["ACCEPTED", "unmapped_gate"]:
            assert label in declared, f"order_verdict enum is missing {label}"

    def test_the_enum_scan_reads_more_than_the_create(self):
        """A scan that matched only the CREATE would pass for the wrong reason.

        Every value added by a later migration would be absent from `declared`,
        so this asserts the ALTERs were actually seen.
        """
        declared = self._declared_verdicts()
        assert "unmapped_gate" in declared, (
            "the scan is reading only the create-type migration; values added by "
            "a later `alter type … add value` are invisible to it"
        )

    @staticmethod
    def _declared_verdicts() -> set[str]:
        declared: set[str] = set()
        for sql in SQL.values():
            if "create type public.order_verdict" in sql:
                body = sql[sql.index("create type public.order_verdict") :]
                declared |= set(re.findall(r"'([A-Za-z_]+)'", body[: body.index(";")]))
            for value in re.findall(
                r"alter type public\.order_verdict\s+add value(?:\s+if not exists)?\s+'([A-Za-z_]+)'",
                sql, re.I,
            ):
                declared.add(value)
        return declared

    def test_limit_defaults_mirror_config(self):
        tables = SQL["20260808120100_desk_tables.sql"]
        expectations = {
            "max_order_notional_usd": settings.max_order_notional_usd,
            "max_gross_exposure_usd": settings.max_gross_exposure_usd,
            "max_symbol_notional_usd": settings.max_symbol_notional_usd,
            "max_daily_drawdown_pct": settings.max_daily_drawdown_pct,
            "max_est_slippage_bps": settings.max_est_slippage_bps,
        }
        for column, expected in expectations.items():
            match = re.search(rf"{column}\s+numeric[^\n]*default\s+([0-9.]+)", tables)
            assert match, f"{column} has no DEFAULT in the migration"
            assert float(match.group(1)) == expected, (
                f"{column}: SQL default {match.group(1)} != config {expected} — "
                "change config.py and the migration in the same commit"
            )


class TestSecurityPosture:
    def test_every_security_definer_pins_search_path(self):
        for chunk in re.split(r"create or replace function", ALL_SQL, flags=re.I)[1:]:
            head = chunk[:600].lower()
            if "security definer" in head:
                assert "set search_path" in head, (
                    "SECURITY DEFINER without a pinned search_path is a "
                    "privilege-escalation footgun"
                )

    def test_rls_enabled_and_anon_denied(self):
        rls = SQL["20260808120200_rls_policies.sql"].lower()
        for table in ("desk_risk_limits", "order_blotter"):
            assert f"public.{table} enable row level security" in rls
            assert f"revoke all on public.{table} from anon" in rls
        assert "to anon" not in rls, "no policy may grant anon anything"

    def test_blotter_is_append_only_by_trigger(self):
        tables = SQL["20260808120100_desk_tables.sql"].lower()
        assert "before update or delete on public.order_blotter" in tables

    def test_provenance_column_and_idempotency_exist(self):
        tables = SQL["20260808120100_desk_tables.sql"]
        assert "decided_by public.desk_decider not null" in tables
        assert "unique_decider_order" in tables

    def test_the_sandbox_rpc_stamps_its_provenance(self):
        rpc = SQL["20260808120300_order_mirror_rpc.sql"]
        assert "'supabase_rpc'" in rpc, "the sandbox decider must label its rows"
        assert "'gateway'" in rpc, "the mirror path must label its rows"
        # The blueprint hardcoded latency_ms 0.19 — a fabricated measurement.
        # The RPC may only ever read latency from the payload it was handed.
        assert "0.19" not in rpc


class TestSandboxIsolation:
    """Two writers share ``order_blotter``; only one of them is the desk.

    The gateway appends real fifteen-gate decisions; ``submit_alphaengine_order``
    and the ``evaluate-order`` Edge Function append labelled two-gate sandbox
    decisions. ``decided_by`` is what keeps them apart, and the table is
    append-only by trigger — so a reader that forgets to filter produces a
    blended blotter that cannot be cleaned up afterwards.

    These assert the structural guard rather than the convention: the safe read
    surface exists, it filters, and the sandbox writer stamps itself.
    """

    _EDGE_SRC = (
        Path(__file__).resolve().parent.parent.parent
        / "supabase" / "functions" / "evaluate-order" / "index.ts"
    ).read_text()
    # Comment bodies removed. That file documents at length what was WRONG with
    # the blueprint's listing — the `import { Deno }` that fails at boot, the
    # hardcoded 0.19 latency, the `*` CORS — so scanning the raw text finds the
    # explanation and reports each fix as the defect it describes.
    EDGE_FN = re.sub(r"//[^\n]*", "", _EDGE_SRC)

    def test_the_desk_view_excludes_sandbox_rows(self):
        view = SQL["20260808120600_desk_blotter_view.sql"]
        assert "create or replace view public.desk_blotter" in view
        assert "decided_by = 'gateway'" in view, (
            "desk_blotter must filter to gateway decisions — it is the surface readers "
            "are pointed at precisely so the filter cannot be forgotten"
        )

    def test_views_do_not_bypass_rls(self):
        # Without security_invoker a view runs as its owner, which would make
        # these a way around the deny-by-default policies.
        view = SQL["20260808120600_desk_blotter_view.sql"]
        assert view.count("security_invoker = true") == 2
        assert "revoke all on public.desk_blotter from anon" in view

    def test_the_edge_function_stamps_every_row_it_writes(self):
        inserts = len(re.findall(r'\.from\("order_blotter"\)\s*\.insert\(', self.EDGE_FN))
        assert inserts >= 2, f"expected an accept path and a reject path, found {inserts}"
        assert self.EDGE_FN.count('decided_by: "supabase_rpc"') == inserts, (
            "every insert from the Edge sandbox must stamp decided_by, or its rows become "
            "indistinguishable from the desk's in an append-only table"
        )

    def test_the_edge_function_boots(self):
        # The blueprint's listing imports `Deno` from std/http/server.ts, which
        # exports `serve`. `Deno` is a runtime global; that import fails at boot.
        assert "import { Deno }" not in self.EDGE_FN
        assert "Deno.serve(" in self.EDGE_FN

    def test_the_edge_function_does_not_fabricate_latency(self):
        # The blueprint hardcodes 0.19 as a measurement.
        assert "0.19" not in self.EDGE_FN
        assert "performance.now()" in self.EDGE_FN

    def test_cors_is_not_open(self):
        # It is deployed --no-verify-jwt and it writes rows.
        assert '"Access-Control-Allow-Origin": "*"' not in self.EDGE_FN
        assert "ALLOWED_ORIGINS" in self.EDGE_FN


class TestHybridRetrieval:
    """The lexical half of retrieval, and the caller that has to agree with it.

    Hybrid search exists because this corpus is keyed by exactly the tokens a
    sentence embedder handles worst: `BTCUSDT`, a job id, an eight-character
    `data_hash`, a parameter pair like `20/100`. A dense retriever blurs them
    and a lexical one is exact on them, so the answer is both, fused.

    Everything here is parsed from the committed SQL and the committed Python.
    A renamed argument on either side is a red test rather than a 404 at
    runtime that falls back to dense-only search and looks like nothing
    happened.
    """

    SEARCH_RPC = "match_research_documents_hybrid"

    def _rag_source(self) -> str:
        # Every file of the package. `research_rag.py` is gone, and reading one
        # file of a package is how a scan like this quietly stops scanning.
        package = Path(__file__).resolve().parent.parent / "modules" / "research_rag"
        return "\n".join(p.read_text() for p in sorted(package.rglob("*.py")))

    def test_the_hybrid_function_exists(self):
        assert f"function public.{self.SEARCH_RPC}" in ALL_SQL

    def test_the_caller_sends_exactly_the_arguments_the_function_declares(self):
        block = ALL_SQL[ALL_SQL.index(f"function public.{self.SEARCH_RPC}"):]
        # To `\n)\nreturns`, not to the first `)` — the first one closes
        # `extensions.vector(384)` and truncating there reports a one-argument
        # function. The first draft of this test did exactly that and "passed"
        # by comparing against a set of one.
        signature = block[: block.index("\n)\nreturns")]
        declared = set(re.findall(r"^\s{2}(\w+)\s", signature, re.MULTILINE))
        assert len(declared) >= 4, f"the signature parser found only {declared}"
        # `rrf_k` has a default and the caller deliberately does not send it —
        # the constant is the published one and overriding it per call would
        # make two searches incomparable.
        required = declared - {"rrf_k"}

        source = self._rag_source()
        call = source[source.index(f'rpc/{self.SEARCH_RPC}'):]
        sent = set(re.findall(r'"(\w+)":', call[: call.index("}")]))
        assert required == sent, (
            f"the hybrid RPC declares {sorted(required)} and the caller sends {sorted(sent)}"
        )

    def test_the_tsvector_is_generated_not_triggered(self):
        # A trigger-maintained column drifts the moment a row is written by a
        # path that forgets the trigger, and this table has two writers. A
        # generated column has no code path that can skip it.
        assert "generated always as" in ALL_SQL
        assert "search_tsv" in ALL_SQL
        assert re.search(r"create index[^;]*search_tsv[^;]*using gin", ALL_SQL, re.S | re.I) \
            or re.search(r"using gin \(search_tsv\)", ALL_SQL, re.I)

    def test_the_title_outweighs_the_body(self):
        # `setweight` is what makes a query matching a title outrank the same
        # query matching one mention deep in a body. Without it `ts_rank_cd` has
        # no way to know which it saw.
        assert "setweight(to_tsvector('english', coalesce(title, '')), 'A')" in ALL_SQL
        assert "setweight(to_tsvector('english', coalesce(body, '')), 'B')" in ALL_SQL

    def test_fusion_never_penalises_a_retriever_that_returned_nothing(self):
        # `coalesce(..., 0)` rather than a large penalty. Penalising absence
        # turns the fusion into an AND across two retrievers with very different
        # recall, and the lexical side returns nothing at all for a paraphrase —
        # deleting exactly the results the dense retriever was added to find.
        assert "coalesce(1.0 / (rrf_k + v.v_rank), 0)" in ALL_SQL
        assert "coalesce(1.0 / (rrf_k + l.l_rank), 0)" in ALL_SQL

    def test_the_candidate_pool_is_wider_than_the_result(self):
        # Fusing two top-5 lists can only surface documents already top-5 in one
        # of them, which defeats the purpose: a document ranked 8th by both is a
        # better answer than one ranked 1st by neither.
        block = ALL_SQL[ALL_SQL.index(f"function public.{self.SEARCH_RPC}"):]
        assert "limit 50" in block

    def test_a_missing_migration_falls_back_but_a_failure_does_not(self):
        # 404 is a real state during a rollout and the only case where serving
        # the dense function instead is right. Any other failure must return
        # nothing rather than quietly serving worse results under the same
        # label — that is the same "silent substitution" the two-backend design
        # elsewhere in this repo explicitly refuses.
        source = self._rag_source()
        assert "status_code != 404" in source
        assert "predates the migration" in source

    def test_an_exact_lexical_match_is_not_filtered_by_the_dense_floor(self):
        # The relevance floor was measured against cosine similarity. A document
        # surfaced by an exact ticker or job-id match is relevant even when its
        # cosine score is unremarkable, which is the entire reason lexical
        # retrieval was added.
        source = self._rag_source()
        assert 'r.get("lexical_rank") is not None' in source
