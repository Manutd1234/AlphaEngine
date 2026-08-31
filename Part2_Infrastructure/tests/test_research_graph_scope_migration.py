"""Offline contract for the tenant-scoped research graph successor migration."""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parent.parent.parent
    / "supabase" / "migrations" / "20260831130000_research_graph_desk_scope.sql"
)


def sql() -> str:
    without_comments = "\n".join(
        line for line in MIGRATION.read_text(encoding="utf-8").lower().splitlines()
        if not line.lstrip().startswith("--")
    )
    return re.sub(r"\s+", " ", without_comments).strip()


def test_the_old_signature_is_dropped_before_the_scoped_one_is_created():
    source = sql()
    old = (
        "drop function if exists public.traverse_research_graph( "
        "uuid, integer, public.research_relation[], integer );"
    )
    assert old in source
    successor = "create or replace function public.traverse_research_graph("
    assert source.index(old) < source.index(successor)
    assert source.count("filter_desk_id uuid default null") == 1


def test_scope_is_enforced_at_every_graph_boundary():
    source = sql()
    assert source.count("(filter_desk_id is null or d.desk_id = filter_desk_id)") == 2
    assert source.count("(filter_desk_id is null or e.desk_id = filter_desk_id)") == 2
    assert source.count(
        "(filter_desk_id is null or next_document.desk_id = filter_desk_id)"
    ) == 2

    recursive = source[source.index("with recursive walk as"):source.index(") select d.id")]
    assert recursive.count("join public.research_documents next_document") == 2
    final_join = source[source.index(") w join public.research_documents d") :]
    assert "filter_desk_id is null or d.desk_id = filter_desk_id" in final_join


def test_the_recreated_rpc_has_an_explicit_service_role_only_acl():
    source = sql()
    signature = "uuid, integer, public.research_relation[], integer, uuid"
    assert (
        f"revoke execute on function public.traverse_research_graph( {signature} ) "
        "from public, anon, authenticated;"
    ) in source
    assert (
        f"grant execute on function public.traverse_research_graph( {signature} ) "
        "to service_role;"
    ) in source
    assert "notify pgrst, 'reload schema';" in source
