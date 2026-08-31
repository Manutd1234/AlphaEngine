"""The read half of the image arm: a FOURTH ranking, fused at the same k = 60.

``modules/research_image.py`` holds the model seam and the whole design
argument. This file is the query side of it: embed the question with the TEXT
half of the CLIP pair, ask ``match_research_document_images`` for a ranking over
the ``image_embedding`` column, and fuse that ranking with the three the desk
already serves.

THE ONE THING THAT MAKES THIS MEANINGFUL
----------------------------------------

The query is embedded by ``Qdrant/clip-ViT-B-32-text`` and NOT by gte-small.
``retrieval.search`` already holds a gte-small vector for the same string and
handing it to this RPC would cost nothing, return rows, and rank by an accident
of two unrelated coordinate systems. 384 numbers against 512 is a length error
Postgres would catch; the far worse version is the one where a text encoder of
the right WIDTH is substituted and nothing errors at all. The shared space is
the mechanism, so the model pair is named in one place and used in both halves.

A FOURTH ARM, NOT A SECOND FUSION
---------------------------------

``1/(k + rank)`` at ``research_bm25.RRF_K`` — the same 60 that
``match_research_documents_hybrid`` uses for its two arms, that ``fuse`` uses
for BM25, and that ``web/lib/retrieval-eval.ts`` uses in the TypeScript
implementation. Imported rather than restated, because a fourth arm joining on
a different constant is not a fourth arm: it is a second fusion wearing the
first one's name, and the two would drift the first time either was touched.

IT ADDS RECALL AND CANNOT SUBTRACT IT
-------------------------------------

Two properties hold together and the tests pin both.

* Every document the three text arms found KEEPS every contribution it had.
  The fused score is recomputed from the row's own ``vector_rank``,
  ``lexical_rank`` and ``bm25_rank`` plus, where there is one, ``image_rank``.
  An arm that did not rank a document contributes nothing for it rather than a
  penalty — the rule the migration states and ``research_bm25.fuse`` follows.
* A document only the image arm found is APPENDED, carrying ``image_rank`` and
  ``image_similarity`` and nothing else. Its ``similarity`` stays None, never 0:
  it has no gte-small similarity to this query because no text arm ranked it,
  and a 0 there would read as "measured, and terrible".

So the three-arm ordering is a sub-ordering of the four-arm one, and the arm's
whole effect is to add candidates and to raise documents that BOTH the text and
the picture agree on. With the model absent it does not run at all and the
ordering is byte-for-byte today's.

WHY THERE IS NO SIMILARITY FLOOR HERE
-------------------------------------

``RAG_MIN_SIMILARITY`` is 0.76, and it is 0.76 because that number was MEASURED
against gte-small's compressed similarity range. CLIP image-text cosine
similarities live on a completely different and much lower range, so applying
0.76 would return nothing at all, and inventing a CLIP number would be exactly
the unmeasured constant this codebase refuses. The migration therefore exposes
``min_similarity`` defaulting to NULL — no floor — and this module passes one
only when an operator has set ``RESEARCH_IMAGE_MIN_SIMILARITY``, having measured
it in ``web/lib/retrieval-eval.ts``. Unfloored, the arm is bounded by
``match_count`` and by RRF itself: a weak image match contributes at most
``1/61``, which cannot outrank a document three arms agreed on.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
from typing import Any

import httpx

from modules.research_bm25 import RRF_K
from modules.research_image import IMAGE_MODEL_TEXT, configured, embed_query, unavailable

log = logging.getLogger("alphaengine.research_image")

IMAGE_RPC = "/rest/v1/rpc/match_research_document_images"

def _floor() -> float | None:
    """The optional, unset-by-default CLIP relevance floor. Never raises.

    Read off the environment rather than added to ``config.py``, which is over
    the file-length ceiling and may not take another line; the shape is
    ``research_stages._bounded_int_env``'s.

    NONE MEANS NO FLOOR, and none is the default because nobody has measured
    one — see the module docstring on why 0.76 is not transferable to CLIP. An
    unparseable value is treated as unset and SAID SO rather than silently
    becoming 0.0: an operator who typed something meant something, and a floor
    of zero is a different instruction from no floor at all on a metric that
    can legitimately go negative.

    Read per call rather than cached at import, because it is read once per
    search and an operator changing it should not have to restart the gateway.
    """
    raw = os.getenv("RESEARCH_IMAGE_MIN_SIMILARITY", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        log.warning(
            "research image: RESEARCH_IMAGE_MIN_SIMILARITY=%r is not a number; "
            "the image arm runs with no similarity floor", raw,
        )
        return None


def _fusable(matches: list[dict[str, Any]]) -> bool:
    """Whether these rows carry ranks a fourth arm can legitimately join.

    THE DENSE-ONLY PATH MUST BE LEFT ALONE. When the hybrid RPC 404s — a real
    state during a rollout — ``_match_arms`` falls through to
    ``match_research_documents``, whose rows carry NO ``vector_rank`` and no
    ``lexical_rank``. Recomputing a fused score over those would score every one
    of them on the image arm ALONE and discard the similarity ordering that is
    the only ordering that path has. That is the same trap ``_match_arms``
    already refuses BM25 for, and it is refused here for the same reason: worse
    than today is the one thing an optional arm may never be.

    An EMPTY candidate list is fusable, and deliberately. There is no ordering
    to destroy and the arm's contribution is pure recall — the case where a
    question about the SHAPE of a curve finds a chart no text arm could reach.
    """
    return not matches or any(
        m.get("vector_rank") is not None or m.get("lexical_rank") is not None for m in matches
    )


def _rank(row: dict[str, Any], field: str) -> float:
    """One arm's rank as a sortable number. Absent is LAST, never zero."""
    value = row.get(field)
    return math.inf if value is None else float(value)


def _order(row: dict[str, Any]) -> tuple[float, int, float, float, str]:
    """Deterministic, and never None inside a comparison key.

    A tie in the fused score is not evidence about which document is better, so
    it is broken by something stable rather than by the sort's own
    arbitrariness — the rule ``research_bm25._fusion_order`` follows. What
    breaks it here is chosen rather than incidental, in three steps.

    AGREEMENT FIRST. More arms having ranked a document is the one extra piece
    of evidence available at a tie, and it is the same evidence RRF is built on.

    THEN THE TEXT ARMS. ``1/(k+1)`` from the image arm alone ties exactly with
    ``1/(k+1)`` from the dense arm alone, and that tie is common rather than
    exotic. It is broken in favour of the document the WORDS found, because the
    text arms are the understood ones and this arm's retrieval quality on chart
    images is the open empirical question the module docstring records. An
    optional arm whose value is unmeasured may add candidates; it may not walk
    ahead of a description document that scored identically.

    THEN ``image_rank``, then ``id``, so the order is total and stable.
    """
    text_ranks = min(_rank(row, f) for f in ("vector_rank", "lexical_rank", "bm25_rank"))
    arms = sum(
        1 for f in ("vector_rank", "lexical_rank", "bm25_rank", "image_rank")
        if row.get(f) is not None
    )
    return (
        -float(row.get("fused_score") or 0.0),
        -arms,
        text_ranks,
        _rank(row, "image_rank"),
        str(row.get("id") or ""),
    )


def fuse(
    matches: list[dict[str, Any]], rows: list[dict[str, Any]], *, k: int = RRF_K
) -> tuple[list[dict[str, Any]], int]:
    """Four arms, one RRF, plus whatever the image arm alone found.

    Returns the fused list and how many documents were ADDED — the only number
    that says whether this arm bought any recall on this query, which is what
    makes "it must add recall, never replace the description arm" checkable
    rather than hopeful.

    NULL HONESTY, twice over. A document the image arm did not rank keeps
    ``image_rank: None``, never 0, which in a 1-based ranking would read as
    "better than first". A document only the image arm found keeps
    ``similarity: None``, never 0.0, because no text arm measured it.
    """
    ranked = {str(row["id"]): row for row in rows if row.get("id")}
    fused: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in matches:
        key = str(match["id"])
        seen.add(key)
        found = ranked.get(key)
        image_rank = found.get("image_rank") if found else None
        arms = (
            match.get("vector_rank"), match.get("lexical_rank"),
            match.get("bm25_rank"), image_rank,
        )
        fused.append({
            **match,
            "image_rank": image_rank,
            "image_similarity": found.get("image_similarity") if found else None,
            # A row no arm ranked scores 0.0 — a sum of no contributions, not a
            # missing score coerced to zero. Its four rank fields stay None, so
            # the absence is still readable off the row.
            "fused_score": sum(1.0 / (k + r) for r in arms if r is not None),
        })
    added = [
        {
            **row,
            # Spelled out rather than left absent: the workspace reads these
            # fields as evidence of WHICH retriever fired, and a missing key and
            # a None mean different things to a template.
            "similarity": None, "vector_rank": None, "lexical_rank": None, "bm25_rank": None,
            "fused_score": 1.0 / (k + int(row["image_rank"])),
        }
        for key, row in ranked.items() if key not in seen and row.get("image_rank") is not None
    ]
    return sorted(fused + added, key=_order), len(added)


async def image_arm(
    client: Any,
    query: str,
    matches: list[dict[str, Any]],
    match_count: int = 3,
    kind: str | None = None,
    desk_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fuse an image ranking into ``matches``, or say why it did not. Never raises.

    The contract every branch keeps: on ANY refusal the candidate list comes
    back exactly as it arrived — same rows, same order, no keys added — and the
    report names a state. That is what makes the arm optional in the sense the
    re-ranker is optional: with no model, no migration or no Supabase, the desk
    serves precisely the three-arm ordering it served before this existed.

    States a caller branches on: ``ranked``, ``unconfigured``, ``unavailable``,
    ``failed``, ``empty``, ``unfusable``.
    """
    if not configured():
        return matches, unavailable(
            "unconfigured", "RESEARCH_IMAGE_MODEL_PATH is unset, so the image arm did not run",
        )
    if client is None:
        return matches, unavailable("unavailable", "Supabase is not configured, so no image was ranked")
    if not _fusable(matches):
        return matches, unavailable(
            "unfusable",
            "the dense-only retrieval path returned rows carrying no rank, and fusing a fourth "
            "arm into them would discard the only ordering that path has",
        )

    vector, report = await asyncio.to_thread(embed_query, query)
    if vector is None:
        return matches, report

    floor = _floor()
    try:
        response = await client.post(IMAGE_RPC, json={
            "query_embedding": vector,
            "match_count": match_count,
            "filter_kind": kind,
            # Omitted rather than sent as an explicit null when unscoped, for
            # ``retrieval._scope``'s reason: a PostgREST call naming an argument
            # the deployed function does not declare is answered PGRST202 as a
            # 404. Here that 404 is survivable — it is this arm alone — but the
            # payload is kept identical in shape to the other two RPCs so a
            # reader comparing them sees one convention rather than two.
            **({"filter_desk_id": desk_id} if desk_id else {}),
            **({"min_similarity": floor} if floor is not None else {}),
        })
    except httpx.HTTPError:
        return matches, unavailable("unavailable", "the image RPC could not be reached")

    status = getattr(response, "status_code", 500)
    if status == 404:
        # The deployment predates 20260822100000. A real state during a rollout
        # and not an error: the other three arms have already answered.
        log.info("image RPC absent (404) — deployment predates the image migration")
        return matches, unavailable("unavailable", "the image RPC is absent; the migration has not run")
    if status >= 300:
        return matches, unavailable("unavailable", f"the image RPC answered HTTP {status}")
    try:
        payload = response.json()
    except ValueError:
        return matches, unavailable(
            "failed", f"the image RPC answered HTTP {status} with a body that is not JSON",
        )
    if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
        return matches, unavailable(
            "failed", f"the image RPC answered HTTP {status} with JSON that is not an array of documents",
        )

    fused, added = fuse(matches, payload)
    return fused, {
        "ranked": True,
        "state": "ranked",
        "reason": None,
        "model": IMAGE_MODEL_TEXT,
        "candidates": len(payload),
        "added": added,
    }
