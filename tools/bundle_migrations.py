"""Concatenate supabase/migrations/*.sql into one bundle that can be RE-RUN.

Why this needs to do more than `cat`
------------------------------------
The first version of this file concatenated the directory and claimed in its
header that re-running was safe because "the migrations use CREATE TABLE IF NOT
EXISTS / CREATE OR REPLACE throughout". That was false, and it failed on the
very first statement of the very first migration:

    ERROR: 42710: type "order_side" already exists

Postgres has no `CREATE TYPE IF NOT EXISTS`, and the 2026-08-08 migrations —
written when the project was empty — also use bare `CREATE TABLE`, bare
`CREATE INDEX`, bare `CREATE POLICY` and a bare `CREATE TRIGGER`. None of those
can be applied twice. That is completely fine for a migration RUNNER, which
applies each file once and records it; it is not fine for a bundle whose whole
purpose is to be pasted into a SQL editor against a project whose state nobody
is certain of.

So the bundle is rewritten rather than copied, and the rewrite is mechanical
and narrow:

    create type X as enum (...)   ->  do $$ begin ... exception
                                        when duplicate_object then null;
                                      end $$;
    create table X (              ->  create table if not exists X (
    create [unique] index N on    ->  create [unique] index if not exists N on
    create policy "N" on T        ->  drop policy if exists "N" on T;  + original
    create trigger N ... on T     ->  drop trigger if exists N on T;   + original

Everything else in the corpus is already idempotent: `create or replace
function`/`view`, `create extension if not exists`, `create sequence if not
exists`, `alter table ... add column if not exists`, `alter type ... add value
if not exists`, and the two `do $$ ... exception ... end $$` blocks in the
avatar-bucket migration.

What this deliberately does NOT do
----------------------------------
It does not reconcile a type whose values have drifted. `create type ...
exception when duplicate_object then null` skips the statement when the type
exists, whatever values it holds — so if `order_verdict` were created before a
gate was added to `modules/risk_proxy.py`, this bundle would leave it stale and
say nothing. That is recorded in the generated header rather than papered over,
because the alternative (dropping and recreating a type five tables depend on)
is far more dangerous than a stale enum.

`tests/test_migration_bundle.py` asserts the output contains no statement from
the non-idempotent list, so this cannot quietly regress.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
TARGET = ROOT / "supabase" / "apply_all.generated.sql"

RULE = "-- " + "=" * 72

HEADER = """\
-- AlphaEngine — every migration, concatenated and made re-runnable.
--
-- GENERATED. Regenerate with `python3 tools/bundle_migrations.py`; do not edit
-- this file, or it drifts from the migrations it claims to be.
--
-- WHAT THIS IS FOR. The migrations in supabase/migrations/ were written and
-- committed; several were never applied to the live project. This bundle is
-- for applying them by hand, against a project whose current state nobody is
-- certain of.
--
--     Supabase dashboard -> SQL Editor -> paste -> Run
--
-- or, with the database password to hand:
--
--     supabase link --project-ref <ref> && supabase db push
--
-- SAFE TO RE-RUN, and unlike the first version of this file that is a property
-- of the generator rather than a hope. Postgres has no CREATE TYPE IF NOT
-- EXISTS, and the 2026-08-08 migrations use bare CREATE TABLE, CREATE INDEX,
-- CREATE POLICY and CREATE TRIGGER as well — so a plain concatenation stops on
-- the first statement:
--
--     ERROR: 42710: type "order_side" already exists
--
-- Every such statement below has been rewritten: enums are wrapped in a DO
-- block that swallows duplicate_object, tables and indexes gained IF NOT
-- EXISTS, and each policy and trigger is preceded by a DROP ... IF EXISTS.
--
-- ONE THING IT CANNOT DO. If a type already exists with DIFFERENT values —
-- say `order_verdict` predates a gate added to modules/risk_proxy.py — the
-- wrapped CREATE is skipped and the stale type is left as it is. Recreating a
-- type that five tables depend on is more dangerous than leaving it, so that
-- case is reported here rather than handled silently.
-- tests/test_supabase_schema.py is what catches a drifted order_verdict.
"""

# --------------------------------------------------------------------------- #
# The rewrites
# --------------------------------------------------------------------------- #

#: `create type X as enum (...)`. `[^)]*` is safe on this corpus and asserted
#: to stay safe: no enum body here contains a parenthesis, including in its
#: inline comments. A body that grew one would fail the bundle test rather than
#: silently truncate.
_ENUM = re.compile(
    r"^create type\s+(?P<name>[\w.]+)\s+as enum\s*\((?P<body>[^)]*)\);",
    re.M | re.I,
)

_TABLE = re.compile(r"^create table\s+(?!if not exists)(?=[\w.\"])", re.M | re.I)

_INDEX = re.compile(
    r"^create\s+(?P<unique>unique\s+)?index\s+(?!if not exists)(?=[\w.\"])",
    re.M | re.I,
)

#: `create policy "N"\n  on T for ...`. The name is always double-quoted in
#: this corpus and the table always follows on the `on` clause.
_POLICY = re.compile(
    r"^(?P<indent>[ \t]*)create policy\s+(?P<name>\"[^\"]+\")\s*\n?\s*on\s+(?P<table>[\w.]+)",
    re.M | re.I,
)

_TRIGGER = re.compile(
    r"^(?P<indent>[ \t]*)create trigger\s+(?P<name>[\w]+)\s*\n?[\s\S]{0,200}?\bon\s+(?P<table>[\w.]+)",
    re.M | re.I,
)


def _wrap_enums(sql: str) -> str:
    def repl(m: re.Match[str]) -> str:
        statement = m.group(0)
        indented = "\n".join("  " + line if line.strip() else line
                             for line in statement.splitlines())
        return (
            "do $$ begin\n"
            f"{indented}\n"
            "exception\n"
            "  when duplicate_object then null;  -- already applied\n"
            "end $$;"
        )

    return _ENUM.sub(repl, sql)


def _guard_policies(sql: str) -> str:
    def repl(m: re.Match[str]) -> str:
        # The avatar-bucket migration already drops before creating. Adding a
        # second drop there would be harmless but noisy, so it is skipped.
        preceding = sql[max(0, m.start() - 400):m.start()].lower()
        if f"drop policy if exists {m.group('name').lower()}" in preceding:
            return m.group(0)
        indent = m.group("indent")
        return (
            f"{indent}drop policy if exists {m.group('name')} on {m.group('table')};\n"
            f"{m.group(0)}"
        )

    return _POLICY.sub(repl, sql)


def _guard_triggers(sql: str) -> str:
    def repl(m: re.Match[str]) -> str:
        indent = m.group("indent")
        return (
            f"{indent}drop trigger if exists {m.group('name')} on {m.group('table')};\n"
            f"{m.group(0)}"
        )

    return _TRIGGER.sub(repl, sql)


def idempotent(sql: str) -> str:
    """Rewrite one migration's SQL so applying it twice is a no-op."""
    sql = _wrap_enums(sql)
    sql = _TABLE.sub("create table if not exists ", sql)
    sql = _INDEX.sub(
        lambda m: f"create {(m.group('unique') or '').lower()}index if not exists ", sql,
    )
    sql = _guard_policies(sql)
    sql = _guard_triggers(sql)
    return sql


def build() -> str:
    parts = [HEADER.rstrip()]
    for path in sorted(MIGRATIONS.glob("*.sql")):
        body = idempotent(path.read_text(encoding="utf-8").rstrip())
        parts.append(f"\n\n{RULE}\n-- {path.name}\n{RULE}\n\n{body}")
    return "\n".join(parts) + "\n"


if __name__ == "__main__":
    built = build()
    count = len(list(MIGRATIONS.glob("*.sql")))
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != built:
            print("supabase/apply_all.generated.sql is stale; rerun without --check")
            raise SystemExit(1)
        print(f"bundle matches {count} migrations")
    else:
        TARGET.write_text(built, encoding="utf-8")
        print(f"wrote {TARGET.relative_to(ROOT)} from {count} migrations")
