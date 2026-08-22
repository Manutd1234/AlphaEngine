"""The write half of the image arm: a chart's PNG, embedded beside its sentence.

``modules/research_image.py`` holds the model seam and argues the whole design —
why the shared CLIP pair, why 512-d, why never a zero vector, and the honest
caveat that CLIP on a line chart is an empirical question. This file is the
ingest side of it: which document gets which picture, and what three columns
that produces on the row ``research_rag/writer.py`` inserts.

WHAT IS ATTACHED TO WHAT, AND WHY IT IS NOT MORE
------------------------------------------------

``render_backtest_documents`` yields the run card plus one document per chart it
can DESCRIBE — equity curve, drawdown envelope, walk-forward folds, gate ladder.
A completed sweep renders exactly two PNGs: ``equity_curve_png`` and
``heatmap_png``. So the mapping is small and it is stated rather than inferred:

* the ``equity_curve`` chart document gets ``equity_curve_png``. Its sentence
  and its pixels are the same figure, which is the case this arm was built for;
* the RUN CARD gets ``heatmap_png``. The parameter heatmap is the sweep's own
  picture — the Sharpe surface over the whole grid — and no ``ChartDoc``
  describes it, because ``research_chartdoc`` has no renderer for a surface.
  Filing it against the run is the honest home: "which of these sweeps found a
  broad stable plateau rather than one lucky cell" is a question about the RUN,
  and it is a question only the picture can answer.

The drawdown, walk-forward and gate-ladder documents get NOTHING and stay
text-only. That is not an omission to be tidied later: the desk never rendered
those as separate images, and inventing an association — pointing the drawdown
document at the equity PNG, say, because the drawdown is drawn on it — would
put a vector under a document that is not what the vector is of. The owed
follow-up is a ``heatmap`` ``ChartDoc`` in ``research_chartdoc`` so the surface
has a sentence as well as pixels; that file is not this change's to edit.

THE ROLLOUT PROPERTY, WHICH IS WHY THIS IS GATED ON ``configured()``
--------------------------------------------------------------------

``image_embedding``, ``image_embedding_model`` and ``image_embedding_status``
exist only after ``20260822100000_research_image_embedding.sql`` has run. A
PostgREST insert naming a column the deployed schema does not have is answered
400, and ``deliver`` would then dead-letter EVERY document — the corpus stops
ingesting entirely, on a deployment that asked for no image search at all.

So an unconfigured deployment sends exactly the row it sent before this module
existed: no image keys, not even nulls. The only deployment that can send them
is one where an operator deliberately set ``RESEARCH_IMAGE_MODEL_PATH``, which
is the same operator who ran the migration. This is ``retrieval._scope``'s
argument applied to the write path, and it is a rollout property rather than a
style preference.

INDEXING MUST NEVER FAIL THE THING IT INDEXES
---------------------------------------------

Nothing here raises. A sweep that finished is filed as a sweep that finished
even when its PNGs are missing, malformed or unembeddable, and every one of
those outcomes is a NAMED state on the row rather than a lost document.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import logging
from typing import Any

from modules.research_image import (
    IMAGE_MODEL_VISION,
    _encoders,
    _vector,
    configured,
)

log = logging.getLogger("alphaengine.research_image")

#: The private key a queued document carries its PNG under, popped by
#: ``writer._index_one`` before the row is inserted. Underscored and named like
#: ``_retrieve_after`` for the same reason: it is an instruction to the drain,
#: not a column, and a key that reached PostgREST would be a 400.
IMAGE_PNG_FIELD = "_image_png"

#: Which ``ChartDoc`` gets which rendered figure. A dict rather than an
#: if-chain so the mapping is READABLE as data — the set of charts the desk
#: renders as images is small, changes rarely, and is the first thing anyone
#: debugging a missing image vector wants to see.
CHART_PNG_FIELDS = {"equity_curve": "equity_curve_png"}

#: The run card's own picture. See the module docstring: the parameter heatmap
#: describes the sweep, not any one of the charts the sweep drew.
RUN_PNG_FIELD = "heatmap_png"

#: Largest PNG the encoder will be handed, in base64 characters. A chart from
#: ``modules/backtester/plots.py`` is tens of kilobytes; four megabytes of
#: base64 is not a chart this desk drew, and decoding it to find that out is
#: memory spent on something that was going to be refused anyway. Bounded
#: rather than trusted because this input arrives on a job result and travels
#: through a bounded queue that the gateway holds in memory.
MAX_PNG_B64_CHARS = 4_000_000

#: How many chart embeds may occupy the default thread executor at once.
#:
#: One, and the number is smaller than ``research_stages._RERANK_BULKHEAD``'s
#: two on purpose. The drain is a single serial loop, so one is all that can
#: ever be wanted — but the semaphore is what guarantees that, and what stops a
#: future second writer from quietly doubling the CPU this process spends on
#: research while the pre-trade risk checks share the same box. Research may
#: wait; risk may not.
_ENCODE_BULKHEAD = asyncio.Semaphore(1)


def _decode(png_b64: str, image_lib: Any) -> Any | None:
    """The PNG as an RGB image, or None with the reason logged.

    RGB rather than whatever the file says: a matplotlib PNG is RGBA and CLIP's
    preprocessor wants three channels, so converting here is the difference
    between an embedding and an exception thrown deep inside ONNX.

    The rejected alternative wrote the bytes to a temp file and handed fastembed
    the path, which needs no Pillow import — and puts a filesystem write on the
    ingest path for every chart, leaves rubbish behind on a crash, and turns a
    decode failure into an IO error somewhere else entirely.
    """
    if len(png_b64) > MAX_PNG_B64_CHARS:
        log.warning(
            "research image: refused a %d-character base64 payload (limit %d); "
            "that is not a chart this desk drew",
            len(png_b64), MAX_PNG_B64_CHARS,
        )
        return None
    try:
        raw = base64.b64decode(png_b64, validate=True)
    except (binascii.Error, ValueError):
        log.warning("research image: the chart payload is not valid base64")
        return None
    try:
        return image_lib.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - Pillow raises many things here
        log.warning("research image: %s decoding the chart PNG", type(exc).__name__)
        return None


def embed_image(png_b64: str | None) -> tuple[list[float] | None, str, str]:
    """``(vector, state, reason)`` for one base64 PNG. Never raises.

    SYNCHRONOUS and CPU-bound, exactly like ``research_rerank.rerank`` and for
    its reason: the choice of executor belongs to the caller who knows what else
    that loop is carrying. ``image_columns`` below is the async caller that
    makes that choice for the drain.

    ``state`` is what the row's ``image_embedding_status`` becomes, and the four
    values are the four the migration's CHECK constraint allows:

    ``absent``   there was no image. Not a failure and not work owed — most
                 documents in this corpus have no picture, and marking them
                 'pending' would give the backfill rows to chase forever.
    ``ready``    a real 512-d vector, and the only state that produces one.
    ``pending``  there IS an image and no vector was produced, for a reason
                 that may not be true tomorrow: no model configured, fastembed
                 absent, the encoder raised. The document is indexed by its
                 text as it always was, and the image is owed.
    ``failed``   the image ITSELF is the problem — not base64, not a decodable
                 PNG, or an output this module refuses. Retrying will not help,
                 which is why it is named differently from 'pending'.
    """
    if not png_b64:
        return None, "absent", "the document carries no image"

    vision, _text, image_lib, reason, _state = _encoders()
    if vision is None:
        # PENDING rather than FAILED: the image is fine and the environment is
        # not, so a backfill should pick this row up the day a model lands.
        return None, "pending", reason or "no vision encoder is available"

    image = _decode(png_b64, image_lib)
    if image is None:
        return None, "failed", "the chart payload could not be decoded as a PNG"

    try:
        vectors = list(vision.embed([image]))
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return None, "pending", f"{type(exc).__name__} embedding the chart: {exc}"
    if len(vectors) != 1:
        # Refuse rather than take the first. A batch of one that came back as
        # something else means the encoder is not doing what this call assumes,
        # and a vector attributed to the wrong chart is exactly the confident
        # wrong answer this package is built to avoid.
        return None, "failed", f"the encoder returned {len(vectors)} vectors for one image"

    vector = _vector(vectors[0])
    if vector is None:
        return None, "failed", "the encoder's output is not a usable 512-d vector"
    return vector, "ready", ""


def attach_chart_pngs(documents: list[dict[str, Any]], result: Any) -> list[dict[str, Any]]:
    """Hand each document the rendered figure it is a document OF, if any.

    Returns the SAME list, mutated in place, so a caller that already holds it
    is not quietly given a copy — ``writer.on_backtest_complete`` iterates the
    return value and there must be no doubt which list it is submitting.

    UNCONFIGURED IS A NO-OP AND THAT IS THE ROLLOUT PROPERTY. See the module
    docstring: a deployment that never set ``RESEARCH_IMAGE_MODEL_PATH`` sends
    the row it sent before this module existed, so the three new columns cannot
    400 an insert against a schema that predates the migration.

    Never raises. ``result`` is a ``BacktestResult`` on the live path and could
    be anything on a replay, so every field read is a ``getattr`` with a
    default: a missing PNG is a document without an image, which is already one
    of the four states, and never a sweep that failed to index.
    """
    if not configured():
        return documents
    for document in documents:
        field = (
            RUN_PNG_FIELD
            if document.get("kind") == "backtest_run"
            else CHART_PNG_FIELDS.get(str((document.get("metrics") or {}).get("chart") or ""))
        )
        if not field:
            continue
        png = getattr(result, field, None)
        if isinstance(png, str) and png:
            document[IMAGE_PNG_FIELD] = png
    return documents


async def image_columns(png_b64: str | None) -> dict[str, Any]:
    """The three image columns for one row, or NOTHING AT ALL. Never raises.

    An empty dict on an unconfigured deployment, and that is the whole rollout
    argument again: ``{**document, **await image_columns(...)}`` then produces
    byte-for-byte the row the writer produced before this existed. Sending
    explicit nulls was the rejected alternative — it reads as more honest and it
    names three columns that a pre-migration schema does not have, which turns
    every insert into a 400 and every document into a dead letter.

    OFF THE EVENT LOOP, through ``asyncio.to_thread`` behind a small bulkhead,
    for ``research_stages``' reason rather than a general preference. A CLIP
    vision forward pass is solid CPU measured in tens of milliseconds, and this
    process also serves the pre-trade risk checks whose budget is MICROSECONDS.
    Running it inline would not show up in any research-plane latency number; it
    would show up as milliseconds added to a plane that never reports them.

    NEVER A ZERO VECTOR: a state other than 'ready' writes ``None`` into
    ``image_embedding`` and ``None`` into ``image_embedding_model``, because a
    stored vector whose model nobody recorded cannot be compared with anything
    later, and a zero vector would rank as similar to every query ever asked.
    """
    if not configured() or not png_b64:
        return {}
    async with _ENCODE_BULKHEAD:
        vector, state, reason = await asyncio.to_thread(embed_image, png_b64)
    if state != "ready":
        # Logged at warning, not error: the document IS indexed, by its text, on
        # every one of these branches. What is missing is one optional arm, and
        # an error line would page somebody for a feature that is off by default.
        log.warning("research image: chart not embedded (%s) — %s", state, reason)
    return {
        "image_embedding": vector,
        "image_embedding_model": IMAGE_MODEL_VISION if vector else None,
        "image_embedding_status": state,
    }
