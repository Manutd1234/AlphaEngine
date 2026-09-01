"""The deploy graph bootstrap walks a counted zero-grace snapshot to its end."""

from __future__ import annotations

import asyncio
from typing import Any

from modules.research_reconcile_complete import sweep_to_exhaustion

DESK = "00000000-0000-0000-0000-000000000001"
NOW_MS = 1_755_000_000_000.0


def _page(
    documents: int,
    *,
    cursor: dict[str, str] | None,
    wrapped: bool,
    deferred: int | None,
) -> dict[str, Any]:
    return {
        "reachable": True,
        "documents_swept": documents,
        "documents_not_assessable": 0,
        "writes_failed": 0,
        "edges_derived": documents * 2,
        "edges_written": documents,
        "edges_already_present": documents,
        "cursor": cursor,
        "wrapped": wrapped,
        "deferred": deferred,
        "graph": {"projected": True, "documents": documents, "edges": documents * 2, "reason": None},
    }


class _Pages:
    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, _client: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return self.pages.pop(0)


class _Counts:
    def __init__(self, *counts: int | None) -> None:
        self.counts = list(counts)
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, _client: Any, **kwargs: Any) -> tuple[int | None, str]:
        self.calls.append(kwargs)
        return self.counts.pop(0), "counted"


async def test_more_than_200_documents_are_paged_with_zero_grace_and_recounted():
    cursor = {"occurred_at": "2025-08-02T00:00:00Z", "id": "doc-048"}
    pages = _Pages([
        _page(200, cursor=cursor, wrapped=False, deferred=48),
        _page(48, cursor=None, wrapped=False, deferred=0),
    ])
    counts = _Counts(248, 248)

    report = await sweep_to_exhaustion(
        object(),
        desk_id=DESK,
        now_ms=NOW_MS,
        batch_size=200,
        max_documents=10_000,
        max_seconds=1.0,
        sweep_fn=pages,
        count_fn=counts,
    )

    assert report["complete"] is True
    assert report["eligible_documents"] == report["documents_swept"] == 248
    assert report["graph"]["documents"] == 248
    assert report["batches"] == 2
    assert [call["max_documents"] for call in pages.calls] == [200, 48]
    assert [call["cursor"] for call in pages.calls] == [None, cursor]
    assert all(call["grace_ms"] == 0.0 for call in pages.calls)
    assert len(counts.calls) == 2
    assert counts.calls[0]["horizon"] == counts.calls[1]["horizon"]


async def test_a_large_but_bounded_corpus_does_not_inherit_the_page_ceiling():
    cursor = {"occurred_at": "2025-08-02T00:00:00Z", "id": "doc-001"}
    pages = _Pages([
        _page(200, cursor=cursor, wrapped=False, deferred=1),
        _page(1, cursor=None, wrapped=False, deferred=0),
    ])
    counts = _Counts(201, 201)
    report = await sweep_to_exhaustion(
        object(), desk_id=DESK, now_ms=NOW_MS, batch_size=200, max_documents=1_000,
        max_seconds=1.0, sweep_fn=pages, count_fn=counts,
    )
    assert report["complete"] is True and report["documents_swept"] == 201


async def test_safety_ceiling_is_checked_before_any_graph_write():
    pages = _Pages([])
    report = await sweep_to_exhaustion(
        object(), desk_id=DESK, now_ms=NOW_MS, batch_size=200, max_documents=10_000,
        max_seconds=1.0, sweep_fn=pages, count_fn=_Counts(10_001),
    )
    assert report["complete"] is False
    assert "safety ceiling" in report["why"]
    assert pages.calls == []


async def test_recount_refuses_a_snapshot_that_changed_while_the_old_gateway_served():
    pages = _Pages([_page(37, cursor=None, wrapped=True, deferred=0)])
    report = await sweep_to_exhaustion(
        object(), desk_id=DESK, now_ms=NOW_MS, batch_size=200, max_documents=10_000,
        max_seconds=1.0, sweep_fn=pages, count_fn=_Counts(37, 38),
    )
    assert report["complete"] is False
    assert "changed or was skipped" in report["why"]


async def test_cursor_must_advance_until_the_counted_population_is_swept():
    pages = _Pages([_page(200, cursor=None, wrapped=False, deferred=48)])
    report = await sweep_to_exhaustion(
        object(), desk_id=DESK, now_ms=NOW_MS, batch_size=200, max_documents=10_000,
        max_seconds=1.0, sweep_fn=pages, count_fn=_Counts(248),
    )
    assert report["complete"] is False
    assert "cursor did not advance" in report["why"]


async def test_the_last_page_must_prove_its_cursor_is_exhausted():
    pages = _Pages([_page(37, cursor={"occurred_at": "2025-08-01T00:00:00Z", "id": "last"},
                          wrapped=False, deferred=1)])
    report = await sweep_to_exhaustion(
        object(), desk_id=DESK, now_ms=NOW_MS, batch_size=200, max_documents=10_000,
        max_seconds=1.0, sweep_fn=pages, count_fn=_Counts(37),
    )
    assert report["complete"] is False
    assert "final corpus page" in report["why"]


async def test_the_entire_count_and_walk_share_one_time_bound():
    async def never_counts(_client: Any, **_kwargs: Any) -> tuple[int | None, str]:
        await asyncio.Event().wait()
        return 0, "unreachable"

    report = await sweep_to_exhaustion(
        object(), desk_id=DESK, now_ms=NOW_MS, max_seconds=0.01, count_fn=never_counts,
    )
    assert report["complete"] is False
    assert "0.01-second safety bound" in report["why"]
