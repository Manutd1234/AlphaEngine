"""Static contract for failure-atomic research chunk replacement."""

from __future__ import annotations

import asyncio
from pathlib import Path

import modules.research_rag.chunking as chunking
from modules.research_rag import EMBEDDING_DIMENSIONS
from modules.research_rag.chunking import plan_document
from modules.research_rag.replacement import prepare_replacement

MIGRATION = (
    Path(__file__).resolve().parent.parent.parent
    / "supabase/migrations/20260831131000_research_chunk_replace.sql"
)


def _sql() -> str:
    return "\n".join(
        line for line in MIGRATION.read_text(encoding="utf-8").lower().splitlines()
        if not line.lstrip().startswith("--")
    )


def test_replace_is_one_rerunnable_function_with_one_transactional_write_boundary():
    sql = _sql()

    assert "create or replace function public.replace_research_document_chunks(" in sql
    function = sql[sql.index("create or replace function"):sql.index("comment on function")]
    assert function.count("insert into public.research_documents") == 1
    assert function.count("delete from public.research_documents") == 1
    assert function.index("insert into public.research_documents") < function.index(
        "delete from public.research_documents"
    )


def test_stale_rows_are_scoped_and_deleted_only_after_a_complete_generation():
    sql = _sql()
    deletion = sql[sql.index("if v_complete then"):sql.index("return query")]

    assert "document.desk_id = p_desk_id" in deletion
    assert "document.kind = p_kind" in deletion
    assert "parent_source_ref}' = p_parent_source_ref" in deletion
    assert "not (document.source_ref = any(v_source_refs))" in deletion
    assert "where v_complete" in sql, "an incomplete re-index must not overwrite old refs"
    assert "case when v_complete then 'ready' else 'pending' end" in sql


def test_only_the_service_role_can_call_the_replacement_rpc():
    sql = _sql()
    signature = "uuid, public.research_doc_kind, text, jsonb"

    assert signature in sql
    assert ") from public, anon, authenticated;" in sql
    assert ") to service_role;" in sql


def test_changed_body_gets_a_new_chunk_generation_even_when_count_is_unchanged():
    first = plan_document(
        {"kind": "backtest_run", "source_ref": "job-88", "body": "alpha metric " * 80},
        max_chars=100, overlap_chars=10,
    )
    second = plan_document(
        {"kind": "backtest_run", "source_ref": "job-88", "body": "bravo metric " * 80},
        max_chars=100, overlap_chars=10,
    )

    assert len(first) == len(second) > 1
    assert {row["source_ref"] for row in first}.isdisjoint(
        row["source_ref"] for row in second
    ), "a failed new generation must not overwrite the last complete one"


def test_one_failed_chunk_makes_the_whole_generation_pending(monkeypatch):
    monkeypatch.setattr(chunking, "CHUNK_MAX_CHARS", 80)
    monkeypatch.setattr(chunking, "CHUNK_OVERLAP_CHARS", 10)
    calls = 0

    async def embed(_text: str) -> list[float] | None:
        nonlocal calls
        calls += 1
        return None if calls == 2 else [0.1] * EMBEDDING_DIMENSIONS

    prepared = asyncio.run(prepare_replacement(
        {
            "kind": "risk_incident", "source_ref": "incident-parent",
            "body": "quant metric observation " * 30, "metrics": {},
            "_retrieve_after": True,
        },
        desk_id="desk-a", embedding_model="gte-small", embed=embed,
    ))

    assert len(prepared.vectors) > 1
    assert prepared.indexed == 0 and prepared.pending == len(prepared.vectors)
    assert prepared.retrieve is None, "partial generations must not trigger graph/retrieval sidecars"
