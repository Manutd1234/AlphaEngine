"""The Oracle schema applier splits the committed DDL correctly.

Splitting SQL is where a naive applier silently does the wrong thing: every
PL/SQL block in `oracle/*.sql` contains semicolons *inside* it, so the obvious
`sql.split(";")` tears each block into fragments that are individually invalid
and applies none of them. The files terminate statements with `/` on its own
line for exactly this reason, and this pins that contract from both ends.

Offline — no database, no credentials, same as every other test here.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from tools.apply_oracle_schema import describe, split_statements

ORACLE = Path(__file__).resolve().parent.parent.parent / "oracle"
SCHEMA = (ORACLE / "01_schema.sql").read_text()
MONTE_CARLO = (ORACLE / "02_monte_carlo.sql").read_text()


class TestSplitter:
    def test_a_lone_slash_terminates_a_statement(self):
        assert split_statements("SELECT 1 FROM dual\n/\nSELECT 2 FROM dual\n/") == [
            "SELECT 1 FROM dual",
            "SELECT 2 FROM dual",
        ]

    def test_semicolons_inside_a_block_do_not_split_it(self):
        block = "BEGIN\n  a := 1;\n  b := 2;\nEND;"
        assert split_statements(block + "\n/") == [block]

    def test_a_slash_inside_a_line_is_not_a_terminator(self):
        # Division, or a path in a comment. Only a line that is *only* a slash.
        assert len(split_statements("SELECT 1/2 FROM dual\n/")) == 1

    def test_trailing_statement_without_a_slash_still_applies(self):
        assert split_statements("SELECT 1 FROM dual;") == ["SELECT 1 FROM dual"]

    def test_blank_regions_produce_no_statements(self):
        assert split_statements("\n\n/\n\n/\n") == []


class TestCommittedFiles:
    """The files themselves, so a future edit cannot break the applier."""

    def test_every_statement_is_slash_terminated(self):
        for name, sql in (("01_schema.sql", SCHEMA), ("02_monte_carlo.sql", MONTE_CARLO)):
            # A trailing fragment means someone added a statement without `/`.
            # It would still apply today, but only because the splitter tolerates
            # exactly one — a second would be silently merged into it.
            assert sql.rstrip().endswith("/"), f"{name} does not end with a `/` terminator"

    def test_the_schema_creates_what_the_app_binds_against(self):
        names = {describe(s) for s in split_statements(SCHEMA)}
        assert "table strategy_research_rag" in names
        assert any(n.startswith("vector index") for n in names)

    def test_the_procedure_is_a_single_statement(self):
        statements = split_statements(MONTE_CARLO)
        assert len(statements) == 1, "the procedure was split — it must be one unit"
        assert describe(statements[0]) == "procedure run_monte_carlo_portfolio"

    @pytest.mark.parametrize("sql", [SCHEMA, MONTE_CARLO])
    def test_re_running_is_safe(self, sql):
        """Every CREATE either replaces or handles its own 'already exists'.

        A schema script that fails on a second run turns the apply workflow into
        a one-shot: correct once, red on every subsequent invocation, and
        useless as the repair tool it is meant to be.
        """
        for statement in split_statements(sql):
            creates = re.search(r"\bCREATE\b", statement, re.IGNORECASE)
            if not creates:
                continue
            replaces = re.search(r"CREATE OR REPLACE", statement, re.IGNORECASE)
            # -955 is "name is already used by an existing object"; WHEN OTHERS
            # covers the vector index, which has more ways to be unavailable.
            handled = "-955" in statement or "WHEN OTHERS" in statement
            assert replaces or handled, (
                f"not re-runnable: {describe(statement)}"
            )
