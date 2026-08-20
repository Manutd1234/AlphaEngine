"""Concatenate supabase/migrations/*.sql into one applyable file.

The migrations in this repo had never been applied to the live project — every
table but `research_documents` returned PGRST205 — and the credentials that
would let CI apply them are marked Sensitive in Vercel, which makes them
write-only. So the bundle is for a human with dashboard access, and it is
generated rather than hand-maintained so it cannot drift from the directory it
claims to represent.
"""

from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
TARGET = ROOT / "supabase" / "apply_all.generated.sql"


def build() -> str:
    header = TARGET.read_text(encoding="utf-8").split("-- " + "=" * 72, 1)[0]
    parts = [header.rstrip()]
    for path in sorted(MIGRATIONS.glob("*.sql")):
        rule = "-- " + "=" * 72
        parts.append(f"\n\n{rule}\n-- {path.name}\n{rule}\n\n{path.read_text(encoding='utf-8').rstrip()}")
    return "\n".join(parts) + "\n"


if __name__ == "__main__":
    built = build()
    if "--check" in sys.argv:
        if TARGET.read_text(encoding="utf-8") != built:
            print("supabase/apply_all.generated.sql is stale; rerun without --check")
            raise SystemExit(1)
        print(f"bundle matches {len(list(MIGRATIONS.glob('*.sql')))} migrations")
    else:
        TARGET.write_text(built, encoding="utf-8")
        print(f"wrote {TARGET.relative_to(ROOT)}")
