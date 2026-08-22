"""Stage 5's last gap: the chart itself reaches the model, as evidence.

Two things called "multimodal" on this desk are NOT the same thing, and
conflating them is how this capability got written off as blocked:

* **Multimodal EMBEDDING** — indexing a chart's pixels so a query can retrieve
  it — runs in the Supabase Edge function, whose runtime exposes `gte-small`
  and takes no image. `research_chartdoc` records that constraint and answers it
  by embedding the chart's MEANING as a sentence. That path is genuinely
  constrained and is not this module's business.
* **Multimodal GENERATION** — showing the model the chart while it answers — has
  never been blocked. `settings.gemini_model` is already `gemini-2.5-flash`,
  which is natively multimodal; the key is configured; and the PNG exists
  in-process, because a completed backtest `JobRecord.result` carries a base64
  ``equity_curve_png`` that `modules/telegram/_mixins/delivery.py` already
  decodes and sends to a chat.

So the picture was two function calls away from the one place on this desk where
a model writes prose a trader acts on, and it was not being sent.

MEASURED, against the real key, on a rendered equity curve with a -34% drawdown
deliberately injected at bars 220-300: with `ThinkingConfig(thinking_budget=0)`
and a 300-token cap, the model answered in 29,924 ms with 85 output tokens and
read the injection back off the pixels — "a significant drawdown occurring
roughly between bar 200 and bar 300, where the equity drops from over 140,000
USD to below 95,000 USD before a sharp recovery". It is not decoration; it sees
the shape the description cannot carry.

An image is EVIDENCE, never a source
------------------------------------

The document text stays the thing that gets cited. A chart is attached only
alongside the chart DOCUMENT it belongs to, it is named to the model by that
document's id, and the instruction says plainly that a claim resting on an image
alone is not an answer. The reason is the reason fence 3 exists at all: a number
read off pixels is an approximation, and this desk's whole posture is that an
approximation must never arrive wearing a measured figure's typography. The
protocol for that — `[chart:<id>]` — lives in `research_generate_prompt` beside
the citation form, and `research_generate_figures` refuses a marker naming a
document whose image was not actually sent. Without that check the marker would
be a way to buy an exemption from fence 3 by labelling an invented number.

Absence is a typed state, one name per way it can be absent
-----------------------------------------------------------

Every path that ends in "no image" ends in a NAMED state on the report, never an
exception and never a silent text-only call. That matters more here than
almost anywhere else in the plane, because the failure it prevents is an answer
that says "the chart shows" over a call that carried no chart. A reader cannot
tell those apart from the prose, so the report has to.

The states are values rather than sentences so a caller branches instead of
matching on prose, and each one is a different fact with a different fix:
``chart_not_rendered`` is a gap in what this desk draws, ``job_not_retained`` is
a restart, ``image_too_large`` is a bound, ``model_declines_images`` is
configuration.

Why the job queue and not the corpus
------------------------------------

The corpus row for a chart carries the chart's DESCRIPTION and no pixels —
`research_cards.render_backtest_documents` writes `kind="chart"`,
`source_ref="<job id>:<chart>"` and a body, and `research_documents` has no blob
column. The bytes live exactly one place: the finished `JobRecord` in this
process. So the join is `source_ref` -> job id -> `record.result[<png key>]`,
which is why a chart from a run this process did not serve, or served before a
restart, reports ``job_not_retained`` rather than pretending. Writing the PNGs
into the corpus was the rejected alternative: it puts a megabyte of base64 in
every retrieval payload, on every query, to serve the small fraction of answers
that want to look at one.

`modules.jobs` is imported INSIDE the resolver, not at module scope. The
research plane must not drag the job queue into its import graph — and
`get_queue()` constructs a `ThreadPoolExecutor`, which spawns no thread until
something is submitted, so resolving an image never starts a worker.
"""

from __future__ import annotations

import base64
import logging
import os
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("alphaengine.research_generate_vision")

#: Wall-clock ceiling for a call that carries an image, in milliseconds, and
#: SEPARATE from the text budget on purpose — see `research_generate.TIMEOUT_MS`
#: for the other half of the argument. 45s, from two measured live calls that
#: took 20,590 ms and 29,924 ms: a ceiling set at the slowest observed sample
#: aborts roughly half the population by construction, which is the failure the
#: text budget's own comment already names — a timeout that fires on healthy
#: calls trains people to retry and doubles the spend for the same answer. 45s
#: is 1.5x the slower measurement, which leaves room for a second image and a
#: slow afternoon without becoming "no bound at all". Rejected: 30s, which sits
#: ON the measurement; and 60s, which the module docstring already argues past
#: as slower than the reader's patience.
#:
#: A module constant read from `os.environ` rather than a `Settings` field
#: because `config.py` is at its own recorded ceiling and may not gain a line;
#: `research_stages` and `research_ingest_delivery` set the same precedent.
VISION_TIMEOUT_MS = int(os.environ.get("RESEARCH_VISION_TIMEOUT_MS", "45000"))

#: Per-image byte ceiling, after decoding. MEASURED: a real
#: `backtester.plots.plot_equity_curve` PNG over 800 bars is 150,111 bytes
#: (200,148 base64 characters), so 2 MiB is roughly fourteen times the artefact
#: this actually sends. The cap is not there to trim a desk chart — it is there
#: so that something which is NOT a desk chart, because a job result was
#: replaced or a caller passed its own bytes, cannot put an unbounded payload on
#: a request a person is waiting on. Over the cap is a named state, never a
#: silent downscale: an image this module quietly resized is one whose pixels
#: the answer was read off and nobody can reproduce.
MAX_IMAGE_BYTES = int(os.environ.get("RESEARCH_VISION_MAX_IMAGE_BYTES", str(2 * 1024 * 1024)))

#: How many images one call may carry. Two, not four: each image is roughly 260
#: prompt tokens plus latency, the retrieval that reaches this module is capped
#: at a handful of documents anyway, and an answer written over four charts is
#: one whose citations nobody checks. Over the budget is a named state on the
#: documents that lost, so a reader can see which chart was not looked at.
MAX_IMAGES = int(os.environ.get("RESEARCH_VISION_MAX_IMAGES", "2"))

#: Model families this desk has established accept an image part. A prefix
#: allow-list rather than "call it and see": discovering that a model is
#: text-only by having the provider raise spends the call and reports the fact
#: as a provider exception, which is precisely the shape this module exists to
#: replace with a named state. gemini-2.5 is on the list because it was
#: measured; the others are the same API family and the same `Part` contract.
VISION_MODEL_PREFIXES = ("gemini-1.5", "gemini-2.0", "gemini-2.5", "gemini-3")

#: Chart name -> the key its rendered PNG occupies in a finished backtest
#: result. Deliberately only the one entry that both halves exist for.
#: `research_chartdoc.describe_run` also produces `drawdown`, `walk_forward` and
#: `gate_ladder` documents, and this desk draws none of them as their own image
#: — the drawdown is a subplot inside the equity figure and the other two are
#: text. `heatmap_png` goes the other way: the Sharpe surface IS rendered, and
#: no chart document describes it, so there is nothing to cite it against and an
#: image with no citable document is exactly what this module refuses to send.
#: Both gaps are recorded here rather than discovered later.
CHART_IMAGE_KEYS: dict[str, str] = {"equity_curve": "equity_curve_png"}

#: Every way this can end, as values. See the module docstring.
ATTACHED = "attached"
CHART_NOT_RENDERED = "chart_not_rendered"
IMAGE_ABSENT = "image_absent"
IMAGE_TOO_LARGE = "image_too_large"
IMAGE_UNDECODABLE = "image_undecodable"
JOB_NOT_RETAINED = "job_not_retained"
JOB_UNFINISHED = "job_unfinished"
MODEL_DECLINES_IMAGES = "model_declines_images"
OVER_IMAGE_BUDGET = "over_image_budget"
SDK_HAS_NO_IMAGE_PART = "sdk_has_no_image_part"

PNG = "image/png"

#: The key a caller may use to hand an image straight to this module, bypassing
#: the job lookup. The seam a future retrieval path can fill without touching
#: this file, and what the offline tests drive.
IMAGE_FIELD = "image_b64"


@dataclass(frozen=True, slots=True)
class Attachment:
    """One image, and the document it is evidence about."""

    document_id: str
    chart: str
    mime: str
    data: bytes


def _note(document_id: str | None, chart: str | None, state: str, reason: str) -> dict[str, Any]:
    return {"document_id": document_id, "chart": chart, "state": state, "reason": reason}


def accepts_images(model: str) -> bool:
    return str(model or "").startswith(VISION_MODEL_PREFIXES)


def is_chart(doc: dict[str, Any]) -> bool:
    return str(doc.get("kind") or "") == "chart"


def chart_name(doc: dict[str, Any]) -> str:
    """Which chart this document describes, from either place it is recorded.

    `metrics.chart` is what `research_cards` writes and the authoritative one;
    the `source_ref` suffix is the same fact spelled into the corpus's unique
    key. Both are read because a row that came back from a projection, a graph
    traversal or a fixture may carry one and not the other, and a chart this
    module cannot name is one whose image it must not guess at.
    """
    metrics = doc.get("metrics")
    if isinstance(metrics, dict) and metrics.get("chart"):
        return str(metrics["chart"])
    ref = str(doc.get("source_ref") or "")
    return ref.rsplit(":", 1)[1] if ":" in ref else ""


def _job_id(doc: dict[str, Any]) -> str:
    ref = str(doc.get("source_ref") or "")
    return ref.rsplit(":", 1)[0] if ":" in ref else ref


def _from_job(doc: dict[str, Any], key: str) -> tuple[str | None, str | None]:
    """The base64 PNG a finished job holds, or the state that says why not."""
    from modules.jobs import get_queue

    job_id = _job_id(doc)
    if not job_id:
        return None, JOB_NOT_RETAINED
    try:
        record = get_queue().get(job_id)
    except Exception as exc:  # noqa: BLE001 - a queue failure is a state, not an outage
        log.warning("research vision: job lookup failed for %s (%s)", job_id, exc)
        return None, JOB_NOT_RETAINED
    if record is None:
        return None, JOB_NOT_RETAINED
    result = getattr(record, "result", None)
    if not isinstance(result, dict):
        return None, JOB_UNFINISHED
    encoded = result.get(key)
    return (str(encoded), None) if encoded else (None, IMAGE_ABSENT)


def _decoded(encoded: str) -> tuple[bytes | None, str | None]:
    try:
        data = base64.b64decode(encoded, validate=True)
    except Exception:  # noqa: BLE001 - malformed base64 is a state, not an outage
        return None, IMAGE_UNDECODABLE
    if not data:
        return None, IMAGE_ABSENT
    if len(data) > MAX_IMAGE_BYTES:
        return None, IMAGE_TOO_LARGE
    return data, None


REASONS: dict[str, str] = {
    CHART_NOT_RENDERED: ("this desk draws no separate image for that chart, so there was "
                         "nothing to attach; the document's own description is the evidence"),
    IMAGE_ABSENT: "the run that produced this chart recorded no image for it",
    IMAGE_TOO_LARGE: (f"the image is larger than the {MAX_IMAGE_BYTES}-byte ceiling and was "
                      "NOT downscaled: an image this module resized is one whose pixels the "
                      "answer was read off and nobody can reproduce"),
    IMAGE_UNDECODABLE: "the stored image is not decodable base64, so it was not sent",
    JOB_NOT_RETAINED: ("the job that drew this chart is not in this process's queue — a "
                       "restart, or a worker elsewhere — so the pixels are unreachable from "
                       "here; the corpus stores the chart's description, never the image"),
    JOB_UNFINISHED: "the job that drew this chart carries no result yet",
    SDK_HAS_NO_IMAGE_PART: ("the installed google-genai build exposes no image Part, so the "
                            "call was made with text alone; the image was resolved and then "
                            "not sent, which is why this is a state and not silence"),
    OVER_IMAGE_BUDGET: (f"only {MAX_IMAGES} image(s) are sent with one call, and this chart "
                        "was not among them"),
}


def resolve(
    documents: list[dict[str, Any]], *, model: str
) -> tuple[list[Attachment], list[dict[str, Any]]]:
    """``(attachments, notes)`` — the images to send, and why the rest are not.

    One note per CHART document, plus one for a model that declines images at
    all. A document that is not a chart produces no note, because "there was
    never an image here" is not an absence a reader needs told about; a chart
    document with no image always produces one, because that is exactly the case
    where an answer might otherwise claim to have looked.

    Never raises. Every failure below — a queue that is gone, base64 that will
    not decode, a job still running — resolves to a state name.
    """
    charts = [doc for doc in documents if is_chart(doc)]
    if not charts:
        return [], []
    if not accepts_images(model):
        return [], [_note(None, None, MODEL_DECLINES_IMAGES, (
            f"{model!r} is not a model this desk has established accepts an image, so the "
            f"{len(charts)} chart document(s) were answered from their descriptions alone"
        ))]

    attachments: list[Attachment] = []
    notes: list[dict[str, Any]] = []
    for doc in charts:
        chart = chart_name(doc)
        state = _resolve_one(doc, chart, attachments)
        notes.append(_note(str(doc.get("id")), chart or None, state,
                           REASONS.get(state, "the chart image was attached to the call")))
    return attachments, notes


def _resolve_one(doc: dict[str, Any], chart: str, attachments: list[Attachment]) -> str:
    """Resolve one chart document, appending to `attachments` when it lands.

    The budget is checked AFTER the lookup rather than before it, so a chart
    that has no image at all reports that rather than reporting a budget it
    never reached — two different facts, and the second would send a reader
    looking for a bound when the real answer is that the run drew nothing.
    """
    encoded = doc.get(IMAGE_FIELD)
    if not encoded:
        key = CHART_IMAGE_KEYS.get(chart)
        if key is None:
            return CHART_NOT_RENDERED
        encoded, missing = _from_job(doc, key)
        if missing:
            return missing
    if len(attachments) >= MAX_IMAGES:
        return OVER_IMAGE_BUDGET
    data, bad = _decoded(str(encoded))
    if bad or data is None:
        return bad or IMAGE_ABSENT
    attachments.append(Attachment(str(doc.get("id")), chart or "chart", PNG, data))
    return ATTACHED


def supports_parts(types: Any) -> bool:
    """Whether this SDK build can express an image at all."""
    return getattr(getattr(types, "Part", None), "from_bytes", None) is not None


def reconcile(
    types: Any, attachments: list[Attachment], notes: list[dict[str, Any]]
) -> tuple[list[Attachment], list[dict[str, Any]]]:
    """Drop images the SDK cannot carry, and SAY SO in the notes.

    Called before the request is built rather than inside it, and that ordering
    is the whole point. `contents` below already declines to invent a part it
    has no constructor for — but a fall-back that happens inside the call leaves
    the report saying ``attached`` for an image the provider never received,
    which is precisely the lie this module exists to prevent: an answer that
    says "the chart shows" beside a ledger that agrees it was shown one.
    """
    if not attachments or supports_parts(types):
        return attachments, notes
    sent = {a.document_id for a in attachments}
    rewritten = [
        _note(note["document_id"], note["chart"], SDK_HAS_NO_IMAGE_PART,
              REASONS[SDK_HAS_NO_IMAGE_PART])
        if note["document_id"] in sent else note
        for note in notes
    ]
    return [], rewritten


def contents(types: Any, prompt: str, attachments: list[Attachment]) -> tuple[Any, str | None]:
    """The `contents` argument for one call, or the state that says why text-only.

    The prompt goes FIRST and the images after it, so the rules and the
    documents are read before the pixels are — the same ordering argument
    `ANSWER_INSTRUCTION` makes about sitting next to the data.
    """
    if not attachments:
        return prompt, None
    from_bytes = getattr(getattr(types, "Part", None), "from_bytes", None)
    if from_bytes is None:
        return prompt, SDK_HAS_NO_IMAGE_PART
    parts: list[Any] = [prompt]
    parts.extend(from_bytes(data=a.data, mime_type=a.mime) for a in attachments)
    return parts, None


def clause(attachments: list[Attachment]) -> str:
    """The user-turn tail that names the attached images. Empty when none.

    It names each image by the id of the document it belongs to, because that
    id is the only thing tying a picture to something citable — and because the
    `[chart:<id>]` marker the answer must use is checked against exactly this
    list. A clause that said "a chart is attached" without naming which document
    would leave the model to guess the id, and a guessed id refuses the answer.
    """
    if not attachments:
        return ""
    listed = "\n".join(f"  [chart:{a.document_id}] — {a.chart}" for a in attachments)
    return (
        "CHART IMAGES ATTACHED\n\n"
        "The image(s) after this text are the charts belonging to these documents, in "
        f"order:\n{listed}\n"
        "They are further evidence ABOUT those documents, never a substitute for the text "
        "you cite. A figure you read off one is an approximation off pixels: write it as an "
        "approximation and mark it with that document's id in the form [chart:<id>] above. "
        "Every other figure must still appear verbatim in a document."
    )
