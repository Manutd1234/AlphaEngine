"""The ingest half of the durable chart store: pixels beside the document.

`research_image_store` holds the design argument, the shared state and the read
path; `supabase/migrations/20260822110000_research_chart_images.sql` holds the
storage argument and the two rejected alternatives. This file is the one thing
neither of those does: it writes the row.

WHY THIS IS A SEPARATE REQUEST, AND WHY THAT IS THE POINT
---------------------------------------------------------

Indexing must never be able to fail the thing it indexes. The image write goes
to a SEPARATE table, AFTER the document has already landed, so a deployment that
has not run the migration answers 404 here and nowhere else: the document is
indexed exactly as it was before this module existed, the drain is untouched,
and the store stops asking for the life of the process.

That isolation is a third argument for the side table which the migration does
not make. Had these bytes been a column on `research_documents`, the same
deployment would have answered 400 to the DOCUMENT insert — PostgREST rejects a
payload naming a column the deployed schema has not got — and every research
document, chart or not, would have dead-lettered. The corpus would have stopped
ingesting on a deployment that asked for no chart images at all.

`research_image_ingest` reaches the same rollout property by a different route:
its three columns ARE on `research_documents`, so it gates itself on an operator
having set `RESEARCH_IMAGE_MODEL_PATH` and sends no image keys otherwise. Both
are correct; this one needs no gate, because the blast radius of being wrong is
one row in one table nothing else reads.

NOTHING HERE RAISES
-------------------

A sweep that indexed is a sweep that indexed even when its picture could not be
stored. The corpus is the primary artefact and the image is evidence about it —
the ordering `persist_edges` states for the graph, for the same reason: a
missing image is recoverable by re-indexing the run, and a missing document is
not.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
from typing import Any

from modules.research_image_store import (
    CHART_PNG_FIELD,  # noqa: F401 - re-exported: the drain imports the field and the writer together
    MAX_PNG_B64_CHARS,
    TABLE,
    _Rollout,
    remember,
)

log = logging.getLogger("alphaengine.research_image_store")


def _measure(png_b64: str) -> tuple[int, str] | None:
    """``(byte_length, sha256)`` over the DECODED bytes, or None if undecodable.

    Over the decoded bytes rather than the base64, so the digest means the same
    thing whichever home the artefact lands in — the migration's argument, and
    what lets `storage_path` be adopted later without re-digesting every row.
    The decode costs a fraction of a millisecond on the measured 200 kB and buys
    validation: a payload that will not decode is never written, so a reader is
    never handed a row it cannot use.
    """
    try:
        raw = base64.b64decode(png_b64, validate=True)
    except (binascii.Error, ValueError):
        return None
    return (len(raw), hashlib.sha256(raw).hexdigest()) if raw else None


async def persist_chart_image(
    client: Any, response: Any, png_b64: str | None, document: dict[str, Any]
) -> bool:
    """Store one chart's pixels beside the document that just landed.

    Returns whether a row was written, so a caller can count it; NEVER raises
    and never signals through an exception.

    Keyed to the document id PostgREST just returned, which is why this runs
    after delivery rather than as part of it. With
    ``resolution=ignore-duplicates`` a re-indexed document comes back with an
    EMPTY representation — there is no id, the image was stored when the
    document was first written, and this returns False rather than inventing a
    key to hang 200 kilobytes off.
    """
    if not png_b64 or len(png_b64) > MAX_PNG_B64_CHARS or _Rollout.table_absent:
        return False
    try:
        rows = response.json() or []
    except (ValueError, AttributeError):
        return False
    inserted = rows[0] if isinstance(rows, list) and rows else None
    if not isinstance(inserted, dict) or not inserted.get("id"):
        return False

    measured = _measure(png_b64)
    if measured is None:
        log.warning(
            "research chart images: %s carries a payload that is not decodable base64; "
            "the document is indexed and the picture is not stored",
            document.get("source_ref"),
        )
        return False
    byte_length, digest = measured
    document_id = str(inserted["id"])
    row = {
        "document_id": document_id,
        "source_ref": str(document.get("source_ref") or ""),
        "chart": str((document.get("metrics") or {}).get("chart") or ""),
        "png_b64": png_b64,
        "byte_length": byte_length,
        "sha256": digest,
    }
    if not await _write(client, row, document):
        return False
    # Warm the read half's cache with bytes this process already holds. On a
    # gateway that served the sweep this is what makes the blocking fetch never
    # happen at all — the cache is the write path's gift to the read path.
    remember(document_id, png_b64)
    return True


async def _write(client: Any, row: dict[str, Any], document: dict[str, Any]) -> bool:
    """The insert itself. Every failure is a log line and a False.

    ``ignore-duplicates`` because a re-indexed document that DID get an id is a
    document whose image row may already exist, and the picture is the same
    picture: the alternative, an upsert, would rewrite 200 kilobytes to change
    nothing. ``return=minimal`` because the only thing worse than fetching an
    image needlessly is being handed one back on the write.
    """
    try:
        response = await client.post(
            TABLE, json=row,
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
    except Exception as exc:  # noqa: BLE001 - the image is evidence, never the document
        log.warning(
            "research chart images: %s storing %s", type(exc).__name__, row["source_ref"],
        )
        return False
    if response.status_code == 404:
        _Rollout.table_absent = True
        log.info(
            "research chart images: table absent (404) — the deployment predates "
            "20260822110000_research_chart_images.sql, so charts stay reachable only "
            "from the job queue. Nothing else about indexing changes."
        )
        return False
    if response.status_code >= 300:
        log.warning(
            "research chart images: HTTP %s storing %s/%s; the document is indexed and "
            "its picture is not",
            response.status_code, document.get("kind"), row["source_ref"],
        )
        return False
    return True
