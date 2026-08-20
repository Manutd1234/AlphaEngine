"""The migration bundle can be applied twice.

This exists because the first version of `apply_all.generated.sql` claimed in
its own header that re-running was safe and then failed on the first statement
of the first migration:

    ERROR: 42710: type "order_side" already exists

The claim was the defect, not the SQL. `supabase db push` applies each file
once and records it, so bare `CREATE TYPE` / `CREATE TABLE` / `CREATE POLICY`
are perfectly correct there. A hand-applied bundle has no such record, and the
person pasting it into a SQL editor does not know which half of it already ran.

So the generator rewrites those statements, and these tests hold the rewrite to
its promise — by reading the GENERATED file, not by re-running the generator
and checking it agrees with itself.
"""

from __future__ import annotations

import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
MIGRATIONS = REPO / "supabase" / "migrations"
BUNDLE = REPO / "supabase" / "apply_all.generated.sql"


def _bundle() -> str:
    assert BUNDLE.exists(), f"missing {BUNDLE}"
    return BUNDLE.read_text(encoding="utf-8")


def _statements(sql: str) -> str:
    """The SQL with comment lines removed, so a comment cannot fail a check."""
    return "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )


class TestTheBundleIsRerunnable:
    def test_no_bare_create_type(self):
        """The statement that actually failed, and its whole family."""
        body = _statements(_bundle())
        bare = [
            line.strip()
            for line in body.splitlines()
            if re.match(r"^\s*create type\b", line, re.I)
            and "do $$" not in line.lower()
        ]
        # Every surviving `create type` must sit inside a DO block that catches
        # duplicate_object. Check by pairing: each one is preceded by `do $$`.
        for match in re.finditer(r"^\s*create type\b", body, re.M | re.I):
            before = body[max(0, match.start() - 200):match.start()].lower()
            assert "do $$ begin" in before, (
                f"an unwrapped CREATE TYPE would fail on a second run: "
                f"{body[match.start():match.start() + 80].strip()!r}"
            )
        assert bare or True  # the loop above is the assertion

    def test_every_wrapped_enum_swallows_duplicate_object(self):
        body = _bundle().lower()
        wrapped = body.count("do $$ begin")
        caught = body.count("when duplicate_object then null")
        assert caught >= body.count("create type"), (
            f"{body.count('create type')} CREATE TYPE statements but only "
            f"{caught} duplicate_object handlers ({wrapped} DO blocks)"
        )

    def test_no_bare_create_table(self):
        body = _statements(_bundle())
        bare = re.findall(r"^\s*create table\s+(?!if not exists)\S+", body, re.M | re.I)
        assert bare == [], f"these would fail on a second run: {bare}"

    def test_no_bare_create_index(self):
        body = _statements(_bundle())
        bare = re.findall(
            r"^\s*create\s+(?:unique\s+)?index\s+(?!if not exists)\S+", body, re.M | re.I,
        )
        assert bare == [], f"these would fail on a second run: {bare}"

    def test_every_policy_is_dropped_first(self):
        """Postgres has no CREATE POLICY IF NOT EXISTS; a DROP is the only way."""
        body = _statements(_bundle())
        for match in re.finditer(
            r"^\s*create policy\s+(\"[^\"]+\")", body, re.M | re.I,
        ):
            name = match.group(1).lower()
            before = body[max(0, match.start() - 400):match.start()].lower()
            assert f"drop policy if exists {name}" in before, (
                f"CREATE POLICY {name} is not preceded by a DROP and would fail "
                f"on a second run"
            )

    def test_every_trigger_is_dropped_first(self):
        body = _statements(_bundle())
        for match in re.finditer(r"^\s*create trigger\s+(\w+)", body, re.M | re.I):
            name = match.group(1).lower()
            before = body[max(0, match.start() - 400):match.start()].lower()
            assert f"drop trigger if exists {name}" in before, (
                f"CREATE TRIGGER {name} is not preceded by a DROP"
            )


class TestTheGeneratorsAssumptions:
    def test_no_enum_body_contains_a_parenthesis(self):
        """The rewrite's `[^)]*` rests on this, so it is asserted, not assumed.

        An enum whose body grew a parenthesis — in a value or an inline comment
        — would make the regex stop early and emit a truncated CREATE TYPE
        wrapped in a DO block that swallows the resulting error. That is the
        one failure mode of this generator that would be silent, so it fails
        here instead.
        """
        for path in sorted(MIGRATIONS.glob("*.sql")):
            for match in re.finditer(
                r"create type\s+[\w.]+\s+as enum\s*\((.*?)\);",
                path.read_text(encoding="utf-8"),
                re.S | re.I,
            ):
                assert "(" not in match.group(1) and ")" not in match.group(1), (
                    f"{path.name}: an enum body contains a parenthesis, which "
                    f"breaks the bundle generator's statement boundary"
                )

    def test_the_bundle_holds_every_migration(self):
        bundle = _bundle()
        names = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
        assert names, "no migrations found"
        missing = [n for n in names if n not in bundle]
        assert missing == [], f"the bundle is missing {missing}"

    def test_the_bundle_is_not_stale(self):
        """Generated, so it must equal what the generator produces right now."""
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "bundle_migrations", REPO / "tools" / "bundle_migrations.py",
        )
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert module.build() == _bundle(), (
            "apply_all.generated.sql is stale — run python3 tools/bundle_migrations.py"
        )
