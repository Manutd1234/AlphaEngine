"""Every table closes to anon, and every SECURITY DEFINER function says who may call it.

Written after four tables and three functions shipped without either, and the
omission was found by probing the live project rather than by reading the SQL —
which is the point. Both mistakes are invisible in review:

* A table with `enable row level security` and no policy already returns
  nothing to anon, so forgetting the REVOKE changes no behaviour *today*. It
  changes what the first permissive policy added later means.
* A SECURITY DEFINER function runs as its owner, so RLS does not apply to it at
  all — and Postgres grants EXECUTE to PUBLIC on every new function, of which
  `anon` is a member. Forgetting the REVOKE there is not latent: it is open
  now. `data_quality_rollup` answered anonymous callers with real aggregate
  counts, and `next_work_item_id` let them consume an id sequence.

These read the whole migration corpus rather than one file, because a REVOKE
belongs wherever it was written — 20260812091000 closes functions created in
20260808120300, and that is correct.
"""

from __future__ import annotations

import pathlib
import re

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"


def _corpus() -> str:
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert files, f"no migrations under {MIGRATIONS}"
    # Comments are stripped: several of these files DISCUSS a revoke they do
    # not perform, and a prose mention must not satisfy the check.
    body = "\n".join(p.read_text(encoding="utf-8") for p in files)
    return "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("--"))


#: Tables whose rows a browser is meant to read directly. Each one is a
#: deliberate publication with a policy behind it, and is exempt by name so
#: that adding a new one is a decision rather than an omission.
PUBLISHED = {"order_blotter", "user_preferences", "telegram_link", "research_documents"}


def test_every_rls_table_also_revokes_from_anon():
    sql = _corpus()
    protected = set(re.findall(r"alter table public\.(\w+) enable row level security", sql, re.I))
    assert protected, "no RLS tables found — the parser has drifted from the SQL"

    missing = sorted(
        table for table in protected - PUBLISHED
        if not re.search(rf"revoke .*? on public\.{table}\b[^;]*from[^;]*anon", sql, re.I | re.S)
    )
    assert missing == [], (
        "these tables enable RLS and never revoke from anon. RLS with no policy "
        "hides them today; the first policy added later is then the only thing "
        "between a browser and the rows:\n  " + "\n  ".join(missing)
    )


def test_every_security_definer_function_revokes_execute():
    sql = _corpus()
    definers = set(re.findall(
        r"create or replace function public\.(\w+)\s*\([^)]*\)[\s\S]{0,400}?security definer",
        sql, re.I,
    ))
    assert definers, "no SECURITY DEFINER functions found — the parser has drifted"

    missing = sorted(
        fn for fn in definers
        if not re.search(rf"revoke execute on function public\.{fn}\b", sql, re.I)
    )
    assert missing == [], (
        "these run as their owner, so RLS does not apply to them, and Postgres "
        "grants EXECUTE to PUBLIC — which anon belongs to. They are open now, "
        "not latently:\n  " + "\n  ".join(missing)
    )


def test_the_work_item_sequences_match_the_pinned_fixture():
    """`create sequence if not exists` cannot correct one that already exists.

    So the seeds are asserted against the ids `test_work_items.py` pins, and a
    guarded restart exists for the case where a sequence was advanced before
    any real row was written.
    """
    sql = _corpus()
    for name, start in (("bug", 95), ("req", 188), ("tkt", 323)):
        assert re.search(rf"create sequence if not exists public\.work_item_{name}_seq start with {start}\b", sql, re.I), (
            f"work_item_{name}_seq is not seeded to {start}"
        )
        assert re.search(rf"alter sequence public\.work_item_{name}_seq restart with {start}\b", sql, re.I), (
            f"nothing can correct work_item_{name}_seq once it exists"
        )
    assert re.search(r"if not exists \(select 1 from public\.data_work_items\)", sql, re.I), (
        "the sequence restart must be guarded on an empty table — resetting a "
        "live counter mints duplicate ids, which is worse than the burned "
        "number it repairs"
    )
