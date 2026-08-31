"""Deterministic, schema-compatible chunks for quantitative research cards.

The corpus has no chunk table and no parent columns.  Chunks therefore remain
ordinary ``research_documents`` rows: a deterministic derived ``source_ref``
keeps the existing uniqueness constraint useful, while the original citation,
order and count live under one reserved key in the existing ``metrics`` JSON.
Retrieval restores that citation and keeps the best-ranked chunk per parent.

Chart documents deliberately remain whole.  Their row id owns the durable PNG;
splitting one without a parent-id column would let retrieval select a sibling
whose id has no image.  Chart descriptions are already compact, so preserving
that invariant costs no useful chunking coverage.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any

CHUNK_META_KEY = "_retrieval_chunk"
CHUNK_REF_MARKER = "::rag-chunk:"


def _bounded_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if low <= value <= high else default


# Safely below embed-research's hard 8,000-character input bound.  Character
# bounds are deterministic across tokeniser/model upgrades and are measurable
# before a network call is made.
CHUNK_MAX_CHARS = _bounded_int("RESEARCH_CHUNK_MAX_CHARS", 2400, 512, 8000)
CHUNK_OVERLAP_CHARS = _bounded_int("RESEARCH_CHUNK_OVERLAP_CHARS", 240, 0, 1200)


def _cut(text: str, start: int, maximum: int) -> int:
    hard = min(len(text), start + maximum)
    if hard == len(text):
        return hard
    floor = start + max(1, maximum // 2)
    for marker in ("\n\n", "\n", ". ", "; ", ", ", " "):
        point = text.rfind(marker, floor, hard)
        if point >= floor:
            return point + len(marker)
    return hard


def _resume(text: str, start: int, end: int, overlap: int) -> int:
    if overlap <= 0:
        return end
    candidate = max(start + 1, end - overlap)
    # Do not begin an overlap in the middle of a number, ticker or identifier.
    while candidate < end and not (
        text[candidate - 1].isspace() or text[candidate].isspace()
    ):
        candidate += 1
    return candidate


def split_text(text: str, *, max_chars: int, overlap_chars: int) -> list[str]:
    """Split on the latest useful boundary, with bounded contextual overlap."""
    cleaned = str(text).strip()
    if not cleaned:
        return []
    maximum = max(1, int(max_chars))
    overlap = max(0, min(int(overlap_chars), maximum // 2))
    if len(cleaned) <= maximum:
        return [cleaned]

    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = _cut(cleaned, start, maximum)
        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(cleaned):
            break
        next_start = _resume(cleaned, start, end, overlap)
        start = next_start if next_start > start else end
    return chunks


def _chunk_ref(parent: str, generation: str, index: int, count: int) -> str:
    return f"{parent}{CHUNK_REF_MARKER}{generation}-{index:04d}-of-{count:04d}"


def plan_document(
    document: dict[str, Any], *, max_chars: int | None = None,
    overlap_chars: int | None = None,
) -> list[dict[str, Any]]:
    """Return queue-ready rows; short and chart documents retain identity."""
    body = str(document.get("body") or "")
    maximum = CHUNK_MAX_CHARS if max_chars is None else int(max_chars)
    overlap = CHUNK_OVERLAP_CHARS if overlap_chars is None else int(overlap_chars)
    if document.get("kind") == "chart" or len(body) <= maximum:
        return [document]
    bodies = split_text(body, max_chars=maximum, overlap_chars=overlap)
    if len(bodies) <= 1:
        return [document]

    parent = str(document.get("source_ref") or "")
    original_metrics = document.get("metrics")
    metrics = dict(original_metrics) if isinstance(original_metrics, dict) else {}
    controls = {key: value for key, value in document.items() if key.startswith("_")}
    base = {key: value for key, value in document.items() if not key.startswith("_")}
    count = len(bodies)
    # A content generation keeps a failed re-index separate from the last
    # complete version.  The replacement RPC can stage pending chunks without
    # overwriting rows that remain the only retrievable copy.
    generation = hashlib.sha256(body.strip().encode("utf-8")).hexdigest()[:12]
    planned: list[dict[str, Any]] = []
    for offset, chunk_body in enumerate(bodies):
        index = offset + 1
        chunk_ref = _chunk_ref(parent, generation, index, count)
        chunk_metrics = {
            **metrics,
            CHUNK_META_KEY: {
                "parent_source_ref": parent,
                "chunk_source_ref": chunk_ref,
                "index": index,
                "count": count,
            },
        }
        chunk = {**base, "source_ref": chunk_ref, "body": chunk_body, "metrics": chunk_metrics}
        if offset == 0:
            chunk.update({key: value for key, value in controls.items() if key != "_retrieve_after"})
        if offset == count - 1 and controls.get("_retrieve_after"):
            chunk["_retrieve_after"] = True
        planned.append(chunk)
    return planned


def parent_source_ref(document: dict[str, Any]) -> str:
    metrics = document.get("metrics")
    meta = metrics.get(CHUNK_META_KEY) if isinstance(metrics, dict) else None
    if isinstance(meta, dict) and meta.get("parent_source_ref") is not None:
        return str(meta["parent_source_ref"])
    return str(document.get("source_ref") or "")


def collapse_parent_matches(
    matches: list[dict[str, Any]], limit: int,
) -> tuple[list[dict[str, Any]], bool]:
    """Keep the best-ranked chunk per parent and restore its citation."""
    kept: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    duplicate = False
    for position, match in enumerate(matches):
        parent = parent_source_ref(match)
        logical_ref = parent or str(match.get("id") or f"unidentified-row-{position}")
        key = (str(match.get("kind") or ""), logical_ref)
        if key in seen:
            duplicate = True
            continue
        seen.add(key)
        row = dict(match)
        if parent:
            row["source_ref"] = parent
        kept.append(row)
    # Preserve the historical seam when there are no sibling chunks: RPC/image
    # stubs may deliberately return more than requested to prove an arm never
    # drops recall.  The real RPC already applies its bound.  Only chunk
    # collapse needs a second local bound after several physical rows became
    # one logical citation.
    return (kept[:max(1, int(limit))] if duplicate else kept), duplicate
