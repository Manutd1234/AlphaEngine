"""Stage 5: a grounded answer over the corpus, or a refusal that says why.

The pipeline in front of this module ends at rows: retrieval fuses two rankings,
CRAG grades what came back, the router records every tool call, and the caller
is handed documents to read. This is the synthesis step that was missing — and
the only place in the research plane where a model writes prose a trader acts on.

Which is why it is built as a fence rather than as a client. A model that invents
a Sharpe ratio is worse than no answer at all: the invented number is fluent, it
is specific, and it arrives wearing the same typography as a measured one. The
guardrails are not a wrapper around the feature — they ARE the feature, and the
model call is the small part in the middle.

Five fences, each of which refuses rather than warns
----------------------------------------------------

1. **The refusal band is checked BEFORE the call.** CRAG already judged this
   evidence too weak to answer from, and spending a call to dress it up is how
   a desk gets a confident answer to an unanswerable question. The rejected
   alternative — generate first, grade the answer after — spends the money
   first and, worse, leaves a fluent paragraph that is far harder to throw away
   than one that was never written.

2. **The context is closed, and the documents are QUOTED as untrusted data.**
   The instruction states that the supplied documents are the only permissible
   source and gives the model a structural way to say the corpus is silent. A
   model falling back on its training data for a figure about THIS desk is
   undetectable downstream: the sentence reads exactly like a grounded one.
   Until `research_generate_prompt` the instruction was ALL there was, and the
   documents were pasted into the user turn verbatim — client-reachable text a
   blank line away from the rules it was meant to override. Every document line
   is now quoted, this module's control tokens are made inert inside it, and an
   instruction-shaped override in a document refuses BEFORE the call.

3. **Figures are quoted, never computed.** No arithmetic, no rounding, no
   annualising. A model that computes is one whose output must be checked
   against the source anyway, at which point it has saved nobody anything. This
   was prompt text too until `research_generate_figures`; it is now checked the
   way fence 4 is checked — every number the answer states, other than a
   citation id, a date, an ordinal or a figure the answer MARKED as read off an
   attached chart, must appear in a supplied document, and one that does not
   refuses the answer whole under its own reason. That fourth exemption is the
   vision one and it is argued at length in `research_generate_figures`: a
   marker naming a document whose image was not actually sent refuses too, so
   on a text-only call the exemption cannot be reached at all.

4. **Citations are verified after generation** against the ids actually
   supplied, and one that was not in the context REFUSES the answer whole. The
   rejected alternative — return it with ``grounded: false`` — fails on how
   people read: a warning beside an answer is a thing readers learn to skip,
   and one fabricated citation means the claims around it were not written
   from the documents either.

5. **The call is bounded** by a wall-clock timeout, an output token cap and an
   explicit thinking budget, all named constants below — and a reply the
   provider says it CUT OFF at that cap is refused under its own name rather
   than being handed to the fences above, which would read a truncated answer's
   missing citations as a model that cited nothing. `research_generate_call`
   holds the measurements.

The chart itself, not only its description
-------------------------------------------

A chart document's PNG is attached to the call when this process still holds it,
so the model answers with the picture in front of it and not only the sentence
`research_chartdoc` wrote about it. An image is EVIDENCE ABOUT a document that
is already cited — never a source in its own right — and every way it can be
absent is a named state on the report rather than a silent text-only call that
lets an answer say "the chart shows". `research_generate_vision` holds that
argument, the states and the measurements.

Absence is a state, not a failure. An unset ``GEMINI_API_KEY`` is a normal
deployment, and so is an uninstalled ``google-genai``: ``requirements-genai.txt``
is optional and the desk's whole test suite passes without either. Both are
reported in the shape the Neo4j projection uses — a named reason, never an
exception and never a silent success — so the gateway boots with no generation
provider configured at all.

Three verdicts, and they never collapse into each other
-------------------------------------------------------

``answered``        an answer survived every fence and may be shown.
``corpus_silent``   the model was asked and reported that the documents do not
                    answer the question. A CORRECT answer, not a failure.
``refused``         a fence stopped it, and ``reason`` says which.

"Could not answer" and "there was nothing to answer with" are different facts,
and a caller tells them apart by branching on ``verdict``, never by reading
``reason`` as prose.

``settings.gemini_model`` names the model and ``settings.gemini_api_key`` the
credential; the key this desk holds is a Gemini one, which is why the lazy import
is of ``google-genai``. Nothing above depends on the provider — the fences apply
to the text that came back, not to the SDK that produced it.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from config import settings
from modules import research_generate_vision as vision

# Re-exported, not merely imported. `research_generate.REFUSE_BAND is
# research_crag.REFUSE_BAND` is an assertion in this repository — a second copy
# of 0.4 would let generation refuse at a threshold the grader no longer uses —
# and `evidence_band` has been this module's public name for the mapping since
# it was written. Both moved to `research_generate_fences` with the precheck
# they serve; the names stay here so no caller learns about the split.
from modules.research_crag import ANSWER_BAND, REFUSE_BAND  # noqa: F401
from modules.research_generate_call import telemetry, thinking, truncation_refusal
from modules.research_generate_fences import evidence_band, precheck, verify  # noqa: F401
from modules.research_generate_figures import figure_refusal
from modules.research_generate_prompt import (
    SILENCE_MARKER,
    SYSTEM_INSTRUCTION,
    user_turn,
)

log = logging.getLogger("alphaengine.research_generate")

#: Wall-clock ceiling on one TEXT generation, in milliseconds.
#:
#: 20s, not 60: this sits behind a request a person is waiting on, and an answer
#: slower than the reader's patience is one they went elsewhere for. Not 5s
#: either — a grounded answer over several thousand characters of context
#: routinely takes longer, and a timeout that fires on healthy calls trains
#: people to retry, which doubles the spend for the same answer.
#:
#: It stays 20s, and a call carrying an IMAGE gets its own larger budget in
#: `research_generate_vision.VISION_TIMEOUT_MS` instead. Two live multimodal
#: calls were measured at 20,590 ms and 29,924 ms, so this budget would have
#: aborted essentially every one of them — but raising THIS number to cover them
#: would hand the text path, which has never needed more than 20s, a 45s hang
#: budget as well, so a stalled text call would hold a worker for more than
#: twice as long for nothing. The bound is paid by the call that needs it.
TIMEOUT_MS = 20_000

#: Output token ceiling. 1024 is three or four paragraphs with citations — the
#: length of an answer somebody reads. A cost bound second and a scope bound
#: first: an unbounded budget invites an essay, and an essay over four retrieved
#: documents is padding, which is the material ungrounded claims hide in.
#:
#: The number did not change when thinking did; what changed is that it now
#: MEANS what it says. On gemini-2.5-flash thinking tokens are charged against
#: this cap, so before `THINKING_BUDGET` below was set explicitly the answer's
#: real ceiling was 1024 minus however much the model chose to think — unknown,
#: and measured at ~190 of a 200-token budget on one live call, which left six
#: usable tokens and a truncated sentence.
MAX_OUTPUT_TOKENS = 1024

#: Thinking tokens allowed. ZERO, explicitly, on every call.
#:
#: MEASURED, twice, against the real key: at `max_output_tokens=200` with no
#: thinking config the answer came back as "The equity curve shows significant
#: volatility" — 6 output tokens of 491 total, the rest spent thinking. At 300
#: with `thinking_budget=0` the same question over the same image returned 85
#: tokens of complete, citation-bearing answer.
#:
#: The argument for zero is not only budget. This task is QUOTATION AND
#: ATTRIBUTION, not reasoning: the fences downstream refuse anything the
#: documents do not contain, so a model that thinks harder cannot produce a
#: better answer here — it can only produce a shorter one, because the thinking
#: comes out of the same cap the answer does. An SDK too old to express the
#: budget is a named state, not a refusal; see `research_generate_call.thinking`.
THINKING_BUDGET = 0

#: Deterministic decoding. This is quotation and attribution, not composition;
#: sampling buys variety in a task where variety means the same question gets
#: two different answers on two afternoons and neither is reproducible.
TEMPERATURE = 0.0

#: The closed verdict vocabulary. Values, not prose, because the workspace
#: renders each of these differently and a caller must never have to pattern
#: match on a sentence to find out which one it got.
ANSWERED = "answered"
CORPUS_SILENT = "corpus_silent"
REFUSED = "refused"

#: `SILENCE_MARKER`, `CITATION`, `SYSTEM_INSTRUCTION` and the per-document
#: character cap live in `research_generate_prompt`: they are the wire protocol
#: between the prompt and the fences that read the answer, and the boundary
#: module has to neutralise the control tokens inside untrusted text. A copy
#: here would be a copy of exactly the strings a document must not be able to
#: forge. `SYSTEM_INSTRUCTION` is re-exported rather than re-declared so that
#: `research_generate.SYSTEM_INSTRUCTION` still resolves for every caller and
#: test that has ever read it.


def _report(
    verdict: str,
    reason: str | None,
    *,
    answer: str | None = None,
    citations: tuple[str, ...] | list[str] = (),
    telemetry_: dict[str, Any] | None = None,
    images: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The one shape all three verdicts take. Never raises.

    ``generated`` is derived from the verdict rather than passed, so there is no
    call site that can report an answer it did not clear. `telemetry_` is present
    exactly when a call was spent — including refusals that happen AFTER
    generation, because a call that produced a fabricated citation is precisely
    the one somebody will go looking for later.

    ``images`` is always present and is a LIST OF NAMED STATES, one per chart
    document that was retrieved. Empty means no chart document came back, which
    is honest; it never means "an image was skipped and nobody said so". A
    reader who sees an answer describing a chart can check here whether the
    model was actually shown one.
    """
    report: dict[str, Any] = {
        "generated": verdict == ANSWERED,
        "verdict": verdict,
        "reason": reason,
        "answer": answer,
        "citations": list(citations),
        "model_called": telemetry_ is not None,
        "images": list(images or ()),
    }
    if telemetry_ is not None:
        report.update(telemetry_)
    return report


def _sdk() -> tuple[Any, Any, str | None]:
    """``(genai, types, None)``, or ``(None, None, reason)``.

    Imported lazily and inside the function: `requirements-genai.txt` is
    optional, and a module-level import would make an unconfigured desk fail at
    import time — the gateway would not boot for want of a feature it is not
    using.
    """
    if not settings.gemini_api_key:
        return None, None, ("GEMINI_API_KEY is unset, so no answer was generated; the "
                            "retrieved documents are unaffected and can still be read")
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return None, None, ("the google-genai package is not installed "
                            "(pip install -r requirements-genai.txt)")
    return genai, types, None


def budget_ms(attachments: list[vision.Attachment]) -> int:
    """The wall-clock ceiling this particular call runs under.

    Read as a module global at call time rather than captured, because the
    timeout is the one bound a test moves to prove the fence exists.
    """
    return vision.VISION_TIMEOUT_MS if attachments else TIMEOUT_MS


async def _call(
    genai: Any, types: Any, prompt: str, attachments: list[vision.Attachment]
) -> Any:
    """One generation. Every bound this module has is applied here.

    The timeout is set on the SDK's HTTP options AND enforced again by
    `asyncio.wait_for` in `generate`: the SDK's covers the request, the outer
    one covers everything else the client may do — a retry loop, a token
    refresh, a DNS stall — none of which a request budget distinguishes. Both
    read `budget_ms`, so a multimodal call cannot end up with one of the two
    bounds set for the text path.

    An SDK with no image `Part` constructor sends the prompt alone; that is a
    named state the caller records, never an exception and never an unlabelled
    text-only call.
    """
    client = genai.Client(api_key=settings.gemini_api_key)
    thinking_config, _ = thinking(types, THINKING_BUDGET)
    payload, _ = vision.contents(types, prompt, attachments)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        temperature=TEMPERATURE,
        thinking_config=thinking_config,
        http_options=types.HttpOptions(timeout=budget_ms(attachments)),
    )
    return await client.aio.models.generate_content(
        model=settings.gemini_model, contents=payload, config=config
    )


async def generate(
    query: str,
    documents: list[dict[str, Any]],
    crag_score: float | None,
) -> dict[str, Any]:
    """Answer `query` from `documents`, or report why not. Never raises.

    `documents` are mappings carrying at least ``id``; ``title``, ``body``,
    ``kind``, ``symbol``, ``strategy`` and ``occurred_at`` are used when present.
    A ``kind`` of ``chart`` additionally makes the document a candidate for
    having its rendered PNG attached to the call — see `research_generate_vision`
    for where the bytes come from and every named reason they may not.
    `crag_score` is the grade `research_crag` gave the retrieval that produced
    them — None when nothing graded it, which is itself a refusal.

    The report always carries ``generated``, ``verdict``, ``reason``, ``answer``,
    ``citations``, ``model_called`` and ``images``, and carries ``model``,
    ``latency_ms`` and ``tokens`` exactly when ``model_called`` is True — a
    caller writing the ledger row branches on that flag rather than reading a
    latency of zero for a call that never happened.
    """
    refusal = precheck(documents, crag_score)
    if refusal:
        return _report(REFUSED, refusal)

    genai, types, reason = _sdk()
    if reason:
        return _report(REFUSED, reason)

    attachments, images = vision.reconcile(
        types, *vision.resolve(documents, model=settings.gemini_model)
    )
    prompt = user_turn(query, documents, vision.clause(attachments))
    started = time.perf_counter()
    try:
        response = await asyncio.wait_for(
            _call(genai, types, prompt, attachments), timeout=budget_ms(attachments) / 1000
        )
    except TimeoutError:
        reason = f"the model did not answer within {budget_ms(attachments)} ms, so it was cancelled"
        return _report(REFUSED, reason, telemetry_=_spent(None, started), images=images)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        reason = f"{type(exc).__name__} calling the model: {exc}"
        return _report(REFUSED, reason, telemetry_=_spent(None, started), images=images)

    return _judge(response, documents, images, attachments, started)


def _spent(response: Any, started: float) -> dict[str, Any]:
    return telemetry(response, started, model=settings.gemini_model)


def _judge(
    response: Any,
    documents: list[dict[str, Any]],
    images: list[dict[str, Any]],
    attachments: list[vision.Attachment],
    started: float,
) -> dict[str, Any]:
    """Every fence that reads the REPLY, in the order their reasons must be read.

    Truncation goes first, before the text is even checked for emptiness. A
    reply cut off at the token cap has lost its trailing citations, so fence 4
    would refuse it as "cited no document" — a true observation and a false
    explanation, and the reader would go looking at the corpus for a defect that
    is a number in this file.
    """
    spent = _spent(response, started)
    cut_off = truncation_refusal(response, MAX_OUTPUT_TOKENS)
    if cut_off:
        log.warning("research generate: refused a truncated answer")
        return _report(REFUSED, cut_off, telemetry_=spent, images=images)

    text = (getattr(response, "text", None) or "").strip()
    if not text:
        return _report(REFUSED, "the model returned no text", telemetry_=spent, images=images)

    if text.upper().startswith(SILENCE_MARKER):
        # Not a refusal. The model was asked, it read the documents, and it
        # reported that they do not answer the question — the answer the
        # instruction explicitly asks for, and the one a desk needs to hear.
        silent = "the supplied documents do not answer this question"
        return _report(CORPUS_SILENT, silent, telemetry_=spent, images=images)

    citations, ungrounded = verify(text, {str(doc["id"]) for doc in documents})
    if ungrounded:
        log.warning("research generate: refused an ungrounded answer (%s)", ungrounded[:80])
        return _report(REFUSED, ungrounded, telemetry_=spent, images=images)

    # Fence 3, and it is deliberately checked AFTER the citations: an answer
    # that fabricated an id has already failed for a stronger reason, and
    # reporting the number as well would put two facts in one `reason`. The
    # attached set is what was SENT, so a [chart:<id>] marker on a text-only
    # call refuses here rather than buying an exemption.
    unquoted = figure_refusal(text, documents, images=frozenset(a.document_id for a in attachments))
    if unquoted:
        log.warning("research generate: refused an unquoted figure (%s)", unquoted[:80])
        return _report(REFUSED, unquoted, telemetry_=spent, images=images)

    return _report(ANSWERED, None, answer=text, citations=citations,
                   telemetry_=spent, images=images)
