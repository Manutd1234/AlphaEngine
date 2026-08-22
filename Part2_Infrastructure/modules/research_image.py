"""The vision half of retrieval: a chart embedded as PIXELS, not as a sentence.

WHAT THIS IS NOT REPLACING
--------------------------

``modules/research_chartdoc.py`` makes a chart retrievable by DESCRIPTION: the
desk computed ``total_return_x``, ``max_drawdown``, ``trades`` and the fold
Sharpes in order to draw the figure, so a sentence built from those numbers is
exact where a vision model is approximate, costs nothing and needs no new
dependency. That argument STANDS and nothing here weakens it. The description
documents keep their gte-small vectors, keep their place in the three-arm
fusion, and are ranked by this module for exactly zero queries.

WHAT IT REACHES THAT THE DESCRIPTION CANNOT
-------------------------------------------

Everything about a chart that is not a number the desk computed. The SHAPE of
an equity curve — one steady climb versus the same terminal multiple reached by
a spike and a long flat plateau, which describe identically and answer
different questions. A rendering artefact. A recovery, visible as a shape long
before it is a figure in any table. No sentence from ``research_chartdoc``
states any of those, because the desk never computed them: they are properties
of the DRAWING, and only something that looks at the drawing can rank by them.

THE HONEST CAVEAT, AND IT IS NOT A SMALL ONE
--------------------------------------------

CLIP is trained on natural images — photographs, illustrations, things with
objects in them. A matplotlib line chart on a white ground is an odd domain for
it, and there is a real possibility that its embeddings of two different equity
curves are nearer to each other than either is to any query about them. How
much genuine retrieval quality this arm delivers ON THIS CORPUS is an EMPIRICAL
question, and no line in this file settles it. ``web/lib/retrieval-eval.ts`` is
where it would be measured, the same way ``RAG_MIN_SIMILARITY`` was measured
rather than chosen. Until somebody measures it, three things hold the risk down
and all three are deliberate: the arm is OPTIONAL and off by default, it only
ever ADDS a ``1/(k + rank)`` term to a fusion the other three arms already
decide, and it can introduce a document but can never remove one.

WHY fastembed's SHARED CLIP PAIR, ON THE GATEWAY'S CPU
------------------------------------------------------

``Qdrant/clip-ViT-B-32-vision`` (512-d, ~0.34 GB) and
``Qdrant/clip-ViT-B-32-text`` (512-d, ~0.25 GB) are two halves of ONE model and
therefore ONE vector space. That is the entire reason a text query can be
compared against an image vector at all, and it is the property this module
exists to protect: ``embed_query`` uses the TEXT half and nothing else. A
gte-small query vector compared against a CLIP image vector is not a worse
ranking, it is a meaningless one — 384 numbers against 512, and even padded it
would be two unrelated coordinate systems. Two models, two spaces, two columns.

fastembed is already the re-ranker's library, so this adds a model rather than a
dependency, and it is ONNX on CPU: no GPU to want, no key to hold, no vendor on
the retrieval path. It also runs IN THE GATEWAY, which is what makes the whole
arm possible — ``Supabase.ai.Session`` exposes gte-small and takes no image, the
constraint ``research_chartdoc`` records, so the Edge runtime could never have
done this. ``jinaai/jina-clip-v1`` is the rejected alternative: one model for
both sides is tidier, and it is 768-d, which is a different column, a different
index and a second migration for a quality difference nobody here has measured.

WHERE THE THREE PIECES LIVE
---------------------------

This file is the MODEL SEAM and the design argument: the two model names, the
cached pair, ``_import_encoders`` (the one boundary the suite substitutes) and
``embed_query``. ``modules/research_image_ingest.py`` is the write half — which
document gets which PNG, and the three columns that produces on the inserted
row. ``modules/research_image_arm.py`` is the read half — the RPC and the
four-way RRF. Split three ways because each was going to cross the file-length
ceiling ``tests/test_file_size.py`` enforces, and because the split falls where
the subject does rather than where the line count did.

ABSENCE IS A STATE
------------------

An unset ``RESEARCH_IMAGE_MODEL_PATH`` is the NORMAL deployment and an
uninstalled ``fastembed`` is the normal environment. Both are reported the way
``research_rerank`` reports them — a named state and a reason, never an
exception and never a silent success. And NEVER A ZERO VECTOR: a 512-d zero is
equidistant from everything under cosine distance and would rank as similar to
every query ever asked, which is the one failure this package is most alert to.
Every path below that cannot produce a real vector returns ``None``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("alphaengine.research_image")

#: The image side of the pair. Written into every row it embeds, because a
#: stored vector whose model nobody recorded cannot be compared with anything
#: later — the same rule ``embedding_model`` follows for the text column.
IMAGE_MODEL_VISION = "Qdrant/clip-ViT-B-32-vision"

#: The text side of the SAME pair. Not gte-small, not a "close enough" text
#: encoder: the shared space is the whole mechanism, and swapping this for any
#: other text model silently turns the arm into noise that still returns rows.
IMAGE_MODEL_TEXT = "Qdrant/clip-ViT-B-32-text"

#: CLIP ViT-B/32 is 512-d on both sides, and so is the column
#: ``20260822100000_research_image_embedding.sql`` declares. Enforced rather
#: than assumed: pointing ``RESEARCH_IMAGE_MODEL_PATH`` at a jina-clip-v1
#: directory yields 768 numbers, which Postgres would reject at INSERT time —
#: one dead document per chart, discovered in a log nobody reads. Checked here,
#: the mismatch is a named refusal on the first attempt.
IMAGE_DIMENSIONS = 512

#: Where fastembed resolves the two models from. A module constant read off the
#: environment rather than a ``Settings`` field, because ``config.py`` sits over
#: the file-length ceiling ``tests/test_file_size.py`` enforces and may not take
#: another line; the shape is ``research_stages._bounded_int_env``'s and
#: ``decision_core``'s before it.
#:
#: EMPTY IS THE DEFAULT AND THE NORMAL STATE. The desk retrieved with three arms
#: before this module existed and still does. Read at import so a test can
#: substitute the constant, and used as fastembed's ``cache_dir`` so a SEEDED
#: directory means no network at request time — the property the re-ranker was
#: chosen for and the reason CI never touches this path.
#:
#: OWED, AND NOT THIS CHANGE'S TO WRITE: ``tests/conftest.py`` ASSIGNS
#: ``RERANK_MODEL_PATH = ""`` so that a developer whose shell exports a seeded
#: model directory cannot have the suite load ~110M parameters off disk. This
#: variable wants the same line for the same reason, and wants it more — the
#: CLIP pair is roughly 0.6 GB. Nothing can download today, because ``fastembed``
#: is deliberately absent from ``requirements-dev.txt`` and ``_import_encoders``
#: refuses first; the hole opens the day somebody installs it locally. The image
#: suites set this constant themselves in an autouse fixture, so they are safe
#: either way — it is every OTHER suite that goes through ``search`` that is not.
IMAGE_MODEL_PATH = os.environ.get("RESEARCH_IMAGE_MODEL_PATH", "").strip()

# The two loaded encoders, cached at module level so each model is read off disk
# once per process rather than once per document. `_LOAD_ERROR` is the other
# half: a load that failed is REMEMBERED and not retried, because retrying a
# missing model directory on every chart turns one misconfiguration into a
# per-document stall. `_LOADED_PATH` records which setting the cache belongs to,
# so changed configuration invalidates it rather than being ignored. Exactly
# `research_rerank`'s cache, for exactly its reasons.
_VISION: Any = None
_TEXT: Any = None
#: Pillow, cached beside the encoders it is only ever used with.
_IMAGE_LIB: Any = None
_LOAD_ERROR: str | None = None
_LOAD_ERROR_STATE: str | None = None
_LOADED_PATH: str | None = None


def configured() -> bool:
    """Whether the image arm is configured at all.

    ``RESEARCH_IMAGE_MODEL_PATH`` is empty by default and that is not a mistake
    to be corrected. This is the function that names the state, so no caller has
    to infer "off" from an empty result.
    """
    return bool(IMAGE_MODEL_PATH)


def unavailable(state: str, reason: str) -> dict[str, Any]:
    """The shape every refusal on this arm takes. Never raises.

    ``ranked`` mirrors ``research_bm25``'s report key rather than inventing a
    verb, because the search response now carries two arm reports and a reader
    comparing them should not have to learn two vocabularies. ``added`` is this
    arm's own: it is the number of documents the arm INTRODUCED, which is the
    only number that says whether it bought any recall on this query.
    """
    return {
        "ranked": False,
        "state": state,
        "reason": reason,
        "model": None,
        "candidates": 0,
        "added": 0,
    }


def _import_encoders() -> tuple[Any, Any, Any, str | None]:
    """``(ImageEmbedding, TextEmbedding, Image, reason)`` — the ONE test seam.

    Alone in its own function for the two reasons ``research_rerank``'s import
    is. It must be LAZY: ``fastembed`` is an optional extra that is not in
    ``requirements-dev.txt``, and a module-level import would stop the gateway
    booting for want of a feature it is not using. And it must be a BOUNDARY:
    the suite substitutes THIS function to get fake encoders, rather than
    injecting a fake package into ``sys.modules``, which keeps the tests honest
    about what they are mocking and keeps CI network-free by construction.

    ``PIL.Image`` comes through the same door. fastembed's image models depend
    on Pillow already, so this is not a second dependency — but it is a second
    IMPORT that can fail, and a caller must be able to tell "no vision model"
    from "no image library" by reading a sentence rather than a traceback.
    """
    try:
        from fastembed import (  # type: ignore[import-not-found]
            ImageEmbedding,
            TextEmbedding,
        )
    except ImportError:
        return None, None, None, (
            "the fastembed package is not installed, so no chart was embedded "
            "as an image (pip install fastembed)"
        )
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        return None, None, None, (
            "Pillow is not installed, so a PNG cannot be decoded for the vision "
            "encoder (pip install pillow)"
        )
    return ImageEmbedding, TextEmbedding, Image, None


def _encoders() -> tuple[Any, Any, Any, str | None, str | None]:
    """The cached pair and the image decoder, or a reason AND a state.

    A state beside the reason, not the reason alone: "not configured", "not
    installed" and "the model raised" want three different responses from an
    operator — set an env var, install an extra, page somebody — and a caller
    that had to tell them apart by matching on prose would break the first time
    somebody reworded the sentence.

    BOTH HALVES LOAD TOGETHER. The rejected alternative loads the vision model
    on ingest and the text model on query, which halves boot cost on each path
    and buys a deployment that indexes charts for weeks and then discovers at
    query time that its text half is missing. The pair is the unit, because the
    shared space is the thing that makes either half worth having.
    """
    global _VISION, _TEXT, _IMAGE_LIB, _LOAD_ERROR, _LOAD_ERROR_STATE, _LOADED_PATH

    path = IMAGE_MODEL_PATH
    if not path:
        return None, None, None, (
            "RESEARCH_IMAGE_MODEL_PATH is unset, so the image arm did not run"
        ), "unconfigured"

    if path != _LOADED_PATH:
        # Configuration moved. Drop the encoders AND the remembered failure: a
        # sticky error from the old path would deny a correctly configured one.
        _VISION = _TEXT = _IMAGE_LIB = _LOAD_ERROR = _LOAD_ERROR_STATE = None
        _LOADED_PATH = path

    if _VISION is not None and _TEXT is not None:
        return _VISION, _TEXT, _IMAGE_LIB, None, None
    if _LOAD_ERROR is not None:
        return None, None, None, _LOAD_ERROR, _LOAD_ERROR_STATE

    vision_cls, text_cls, image_lib, reason = _import_encoders()
    if vision_cls is None:
        _LOAD_ERROR, _LOAD_ERROR_STATE = reason, "unavailable"
        log.warning("research image: %s", reason)
        return None, None, None, _LOAD_ERROR, _LOAD_ERROR_STATE

    try:
        vision = vision_cls(model_name=IMAGE_MODEL_VISION, cache_dir=path)
        text = text_cls(model_name=IMAGE_MODEL_TEXT, cache_dir=path)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        # Exception, not a narrower class: the directory can be missing,
        # unreadable, or hold an ONNX file this fastembed cannot open, and all
        # three mean the same thing to a caller — no image arm, here is why.
        _LOAD_ERROR = f"{type(exc).__name__} loading the CLIP pair from {path}: {exc}"
        _LOAD_ERROR_STATE = "failed"
        log.warning("research image: %s", _LOAD_ERROR)
        return None, None, None, _LOAD_ERROR, _LOAD_ERROR_STATE

    _VISION, _TEXT, _IMAGE_LIB = vision, text, image_lib
    return _VISION, _TEXT, _IMAGE_LIB, None, None


def _vector(raw: Any) -> list[float] | None:
    """One embedding as plain floats, or None if it is not a usable vector.

    fastembed yields numpy arrays; PostgREST wants JSON. ``tolist`` is tried
    first and a plain sequence is accepted, so a fake encoder in the suite can
    return lists without the tests pretending numpy is involved.

    THREE REFUSALS, and each is a real failure wearing a success's shape:

    * the wrong DIMENSION means the configured model is not the one this column
      was built for, and the insert would be rejected one document at a time;
    * a NON-FINITE value poisons cosine distance for the whole index;
    * an ALL-ZERO vector is the defect this package is most alert to. It is
      equidistant from everything, so it does not fail — it ranks as similar to
      every query ever asked. A degenerate ONNX output is rare and the check is
      one pass over 512 floats, which is cheaper than one wrong answer.
    """
    values = raw.tolist() if hasattr(raw, "tolist") else raw
    try:
        vector = [float(v) for v in values]
    except (TypeError, ValueError):
        return None
    if len(vector) != IMAGE_DIMENSIONS:
        log.warning(
            "research image: the encoder returned %d dimensions, not %d — "
            "RESEARCH_IMAGE_MODEL_PATH is not the %s pair",
            len(vector), IMAGE_DIMENSIONS, IMAGE_MODEL_VISION,
        )
        return None
    if not all(v == v and abs(v) != float("inf") for v in vector):
        return None
    if not any(vector):
        log.warning(
            "research image: the encoder returned an all-zero vector; refused, "
            "because a zero vector is equidistant from everything and would be "
            "returned as similar to any query",
        )
        return None
    return vector


def embed_query(query: str) -> tuple[list[float] | None, dict[str, Any] | None]:
    """A CLIP TEXT vector for the question, or ``(None, report)``. Never raises.

    THE TEXT HALF OF THE SAME PAIR, and this is the place that says so loudly.
    The vectors in ``research_documents.image_embedding`` were written by
    ``Qdrant/clip-ViT-B-32-vision``, and the ONLY text encoder whose output
    shares that space is its own text half. Handing this the gte-small query
    vector ``retrieval.search`` already holds would cost nothing, return rows,
    and rank by an accident of two unrelated geometries — and the width check in
    ``_vector`` would not save it, because a substituted 512-d text model errors
    nowhere at all. So the pair is named once, in this file, and used in both
    halves of the arm.

    SYNCHRONOUS and CPU-bound like ``research_rerank.rerank``, for its reason:
    the choice of executor belongs to the caller who knows what else that loop
    is carrying. ``research_image_arm.image_arm`` is the caller that makes it.

    ``None`` on the report means the vector is real; there is no success report
    here, because the arm's own report is assembled by the caller that also
    knows how many rows came back and how many of them were new.
    """
    if not query or not query.strip():
        return None, unavailable("empty", "no query text was offered to the image arm")

    _vision, text, _lib, reason, state = _encoders()
    if text is None:
        return None, unavailable(state or "unavailable", reason or "no text encoder is available")

    try:
        vectors = list(text.embed([query]))
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return None, unavailable(
            "failed", f"{type(exc).__name__} embedding the query with {IMAGE_MODEL_TEXT}: {exc}",
        )
    if len(vectors) != 1:
        return None, unavailable(
            "failed", f"{IMAGE_MODEL_TEXT} returned {len(vectors)} vectors for one query",
        )
    vector = _vector(vectors[0])
    if vector is None:
        return None, unavailable(
            "failed", f"{IMAGE_MODEL_TEXT} did not return a usable {IMAGE_DIMENSIONS}-d vector",
        )
    return vector, None
