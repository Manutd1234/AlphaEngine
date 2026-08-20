"""The Python aggregate and the Postgres one must name the same columns.

`_AGGREGATE` in modules/data_quality_schema.py and `data_quality_rollup` in
supabase/migrations/20260820100400 compute the same six figures for the same
window on two different backends. Nothing else pins them together, and the
failure if they drift is the worst kind: both backends answer, neither errors,
and they disagree about how many checks a provider failed.

This is the same shape as the gate-parity fixtures — mirrored maths, asserted
to stay mirrored — one level cheaper, because it compares the column names
rather than the results. Comparing results needs a live Postgres, which
network-free CI does not have.
"""

from __future__ import annotations

import ast
import pathlib
import re

#: Where the two GROUP BY queries live. They moved out of `data_quality.py`
#: when it was split; the assertion below moved with them, which is the whole
#: point of measuring rather than trusting a path.
READ_PATH = pathlib.Path(__file__).resolve().parent.parent / "modules" / "data_quality_read.py"


def _executable_strings(path: pathlib.Path) -> str:
    """Every string literal in `path` EXCEPT the docstrings.

    Written this way because the previous version of this check —
    `"GROUP BY provider" in source` over the whole file — was agreeing with a
    sentence. `DataQualityLedger`'s own docstring says "aggregate — `GROUP BY
    provider`, `SUM(CASE WHEN passed=0 …)`", so that half of the assertion
    passed on prose and would have kept passing with the query deleted. The
    capability half was the only one measuring anything, and it is what caught
    the split.

    Stripping strings wholesale is not an option here: the subject IS a string.
    So drop comments and docstrings and keep the rest.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
        and ast.get_docstring(node, clean=False) is not None
    }
    return "\n".join(
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings
    )

MIGRATION = (
    pathlib.Path(__file__).resolve().parent.parent.parent
    / "supabase" / "migrations" / "20260820100400_data_quality_rollup.sql"
)

#: The six figures, in the order _AGGREGATE names them.
EXPECTED = ("evaluated", "passed", "fatal", "warn", "drift", "not_evaluated")


def test_the_python_aggregate_names_the_six_figures():
    from modules.data_quality import _AGGREGATE

    named = re.findall(r"AS (\w+)", _AGGREGATE)
    assert named[0] == "evaluated"
    for column in EXPECTED[1:]:
        assert re.search(rf"SUM\({column}\)", _AGGREGATE), f"_AGGREGATE lost {column}"


def test_the_migration_exists_and_names_the_same_six():
    assert MIGRATION.exists(), f"missing {MIGRATION}"
    sql = MIGRATION.read_text(encoding="utf-8")
    for column in EXPECTED:
        assert f"'{column}'" in sql, f"data_quality_rollup lost {column}"


def test_both_group_by_provider_and_capability():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "group by provider" in sql.lower()
    assert "group by capability" in sql.lower()
    # The Python side splices _AGGREGATE into the same two GROUP BYs. Checked
    # by the GROUP BY clauses rather than by the constant's text: _AGGREGATE is
    # written across two source lines, so the joined value is not a literal
    # substring of the file.
    assert READ_PATH.exists(), f"missing {READ_PATH} — the read path moved again"
    queries = _executable_strings(READ_PATH)
    assert "data_quality_findings" in queries, (
        "no query text at all was recovered from the read path, so the two "
        "assertions below would be scanning nothing"
    )
    assert "GROUP BY provider" in queries
    assert "GROUP BY capability" in queries


def test_the_rollup_is_scoped_by_desk():
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert "desk_id = p_desk_id" in sql, (
        "an unscoped rollup would aggregate every desk's findings into one "
        "desk's panel — the tenancy bug this column exists to prevent"
    )
