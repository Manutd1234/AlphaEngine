"""Prepare one logical research document for an atomic corpus replacement."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from modules.research_image_ingest import IMAGE_PNG_FIELD, image_columns
from modules.research_image_store_write import CHART_PNG_FIELD
from modules.research_rag.chunking import parent_source_ref, plan_document

REPLACE_PATH = "/rest/v1/rpc/replace_research_document_chunks"


@dataclass(frozen=True)
class PreparedReplacement:
    """RPC body plus the local-only sidecars needed after it commits."""

    payload: dict[str, Any]
    documents: list[dict[str, Any]]
    vectors: list[list[float] | None]
    chart: tuple[bytes | None, dict[str, Any]] | None
    retrieve: tuple[list[float], dict[str, Any]] | None

    @property
    def indexed(self) -> int:
        # Postgres makes an incomplete generation wholly pending so no subset
        # can surface beside the last complete version.
        return len(self.vectors) if all(vector is not None for vector in self.vectors) else 0

    @property
    def pending(self) -> int:
        return len(self.vectors) - self.indexed


async def prepare_replacement(
    document: dict[str, Any],
    *,
    desk_id: str,
    embedding_model: str,
    embed: Callable[[str], Awaitable[list[float] | None]],
) -> PreparedReplacement:
    """Embed all physical rows before asking Postgres to replace the set."""
    rows: list[dict[str, Any]] = []
    physical: list[dict[str, Any]] = []
    vectors: list[list[float] | None] = []
    chart: tuple[bytes | None, dict[str, Any]] | None = None
    retrieve: tuple[list[float], dict[str, Any]] | None = None

    for planned in plan_document(document):
        item = dict(planned)
        retrieve_after = bool(item.pop("_retrieve_after", False))
        chart_png = item.pop(CHART_PNG_FIELD, None)
        vector = await embed(str(item["body"]))
        image = await image_columns(item.pop(IMAGE_PNG_FIELD, None))
        row = {
            **item,
            "desk_id": desk_id,
            "embedding": vector,
            "embedding_model": embedding_model if vector else None,
            "embedding_status": "ready" if vector else "pending",
            **image,
        }
        rows.append(row)
        physical.append(item)
        vectors.append(vector)
        if chart_png is not None:
            chart = (chart_png, item)
        if retrieve_after and vector:
            retrieve = (vector, item)

    return PreparedReplacement(
        payload={
            "p_desk_id": desk_id,
            "p_kind": str(document.get("kind") or ""),
            "p_parent_source_ref": parent_source_ref(document),
            "p_rows": rows,
        },
        documents=physical,
        vectors=vectors,
        chart=chart,
        retrieve=retrieve if all(vector is not None for vector in vectors) else None,
    )
