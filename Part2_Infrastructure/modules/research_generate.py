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

2. **The context is closed.** The instruction states that the supplied
   documents are the only permissible source and gives the model a structural
   way to say the corpus is silent. A model falling back on its training data
   for a figure about THIS desk is undetectable downstream: the sentence reads
   exactly like a grounded one.

3. **Figures are quoted, never computed.** No arithmetic, no rounding, no
   annualising. A model that computes is one whose output must be checked
   against the source anyway, at which point it has saved nobody anything.

4. **Citations are verified after generation** against the ids actually
   supplied, and one that was not in the context REFUSES the answer whole. The
   rejected alternative — return it with ``grounded: false`` — fails on how
   people read: a warning beside an answer is a thing readers learn to skip,
   and one fabricated citation means the claims around it were not written
   from the documents either.

5. **The call is bounded** by a wall-clock timeout and an output token cap,
   both named constants below.

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
import re
import time
from typing import Any

from config import settings
from modules.research_crag import ANSWER_BAND, REFUSE_BAND

log = logging.getLogger("alphaengine.research_generate")

#: Wall-clock ceiling on one generation, in milliseconds.
#:
#: 20s, not 60: this sits behind a request a person is waiting on, and an answer
#: slower than the reader's patience is one they went elsewhere for. Not 5s
#: either — a grounded answer over several thousand characters of context
#: routinely takes longer, and a timeout that fires on healthy calls trains
#: people to retry, which doubles the spend for the same answer.
TIMEOUT_MS = 20_000

#: Output token ceiling. 1024 is three or four paragraphs with citations — the
#: length of an answer somebody reads. A cost bound second and a scope bound
#: first: an unbounded budget invites an essay, and an essay over four retrieved
#: documents is padding, which is the material ungrounded claims hide in.
MAX_OUTPUT_TOKENS = 1024

#: Per-document context ceiling, in characters. Bounded for the reason the
#: projection sweep is batched: one pathological document must not fail — or
#: price — the whole request. The cut is MARKED in the prompt rather than made
#: silently, because a model that cannot see the end of a table must not quote
#: a figure as though it had.
MAX_DOCUMENT_CHARS = 4_000

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

#: What the model says when the documents do not answer. A token rather than a
#: phrase so the check is exact: "the corpus does not say" has a hundred
#: paraphrases, each of which would need recognising, whereas an unmatched
#: sentinel falls through to the citation fence, which refuses.
SILENCE_MARKER = "CORPUS_SILENT"

#: The citation form. Prefixed so it cannot be confused with the model's own
#: bracketed asides, and loose enough to catch a malformed id: an id that does
#: not match is a fabrication and must REACH the fence, not be skipped by a
#: pattern too strict to see it.
_CITATION = re.compile(r"\[doc:([^\]\s]+)\]")

#: The SDK's usage field names, mapped to the ledger's. Read defensively: a
#: count the SDK did not report is an ABSENT key in the report, never a zero.
#: Zero prompt tokens is a measurement, and a false one.
TOKEN_FIELDS: dict[str, str] = {
    "prompt": "prompt_token_count",
    "output": "candidates_token_count",
    "total": "total_token_count",
}

#: The instruction that closes the context. A constant rather than something
#: built per call, so the fence a given answer was generated under is a fixed,
#: diffable object — a prompt assembled from conditionals is one nobody can
#: state the rules of afterwards.
SYSTEM_INSTRUCTION = f"""\
You are answering questions for a quantitative trading desk from that desk's own
research corpus.

THE SUPPLIED DOCUMENTS ARE THE ONLY PERMISSIBLE SOURCE. You have no other
knowledge of this desk, its strategies, its trades or its results. Anything not
in the documents below does not exist for the purposes of this answer.

If the documents do not answer the question, reply with exactly {SILENCE_MARKER}
and nothing else. That is a CORRECT and expected answer, always preferred to one
assembled from general knowledge, and you will never be penalised for it.

Every claim you make must cite the document it came from, in the form
[doc:<id>], using the ids exactly as given. Never cite an id that does not
appear in the supplied documents.

FIGURES MUST BE QUOTED, NEVER PRODUCED. Every number, date, symbol and parameter
must appear verbatim in a document. Do not compute, estimate, round, convert,
annualise, aggregate or otherwise derive a figure — not even one that follows
trivially from two that are present. If a number the question asks for is not
written in the documents, say so, and cite nothing for it.

Be brief. Answer the question that was asked and stop.
"""


def evidence_band(score: float | None) -> str | None:
    """Which CRAG band a graded score falls in, or None when nothing was graded.

    The bands are imported from `research_crag`, never restated. A second copy
    of 0.4 can drift, and it would drift in the worst direction available:
    generation refusing at a threshold the grader no longer uses means the
    desk's stated relevance floor and its real one are different numbers.

    None for an ungraded score, never "refuse". "Nobody graded this" and "this
    graded badly" are different facts; this module refuses on both, for
    different reasons the caller can read.
    """
    if score is None:
        return None
    return "answer" if score > ANSWER_BAND else "refuse" if score < REFUSE_BAND else "rewrite"


def _report(
    verdict: str,
    reason: str | None,
    *,
    answer: str | None = None,
    citations: tuple[str, ...] | list[str] = (),
    telemetry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The one shape all three verdicts take. Never raises.

    ``generated`` is derived from the verdict rather than passed, so there is no
    call site that can report an answer it did not clear. `telemetry` is present
    exactly when a call was spent — including refusals that happen AFTER
    generation, because a call that produced a fabricated citation is precisely
    the one somebody will go looking for later.
    """
    report: dict[str, Any] = {
        "generated": verdict == ANSWERED,
        "verdict": verdict,
        "reason": reason,
        "answer": answer,
        "citations": list(citations),
        "model_called": telemetry is not None,
    }
    if telemetry is not None:
        report.update(telemetry)
    return report


def _telemetry(response: Any, started: float) -> dict[str, Any]:
    """Model, latency and token counts — the ledger row, minus the query.

    Never optional. An ungrounded model call nobody can audit afterwards is the
    exact thing this desk avoids, so latency is recorded even when the call
    RAISED — the time and the money were still spent.

    Token counts are omitted when the SDK does not report them: an absent key
    says "not reported", whereas a zero would say "this call used no tokens",
    which is a measurement and a false one.
    """
    telemetry: dict[str, Any] = {
        "model": settings.gemini_model,
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "tokens": {},
    }
    usage = getattr(response, "usage_metadata", None)
    for name, attribute in TOKEN_FIELDS.items():
        value = getattr(usage, attribute, None)
        if value is not None:
            telemetry["tokens"][name] = int(value)
    return telemetry


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


def _context(documents: list[dict[str, Any]]) -> str:
    """The documents, each headed by the id the model must cite it as."""
    blocks = []
    for doc in documents:
        body = str(doc.get("body") or "")
        if len(body) > MAX_DOCUMENT_CHARS:
            body = body[:MAX_DOCUMENT_CHARS] + (
                f"\n[TRUNCATED at {MAX_DOCUMENT_CHARS} characters. The rest of this "
                "document is NOT available to you; do not quote or infer figures from it.]"
            )
        fields = " ".join(
            f"{key}={doc[key]}"
            for key in ("kind", "symbol", "strategy", "occurred_at")
            if doc.get(key)
        )
        blocks.append(
            f"[doc:{doc['id']}] {doc.get('title') or '(untitled)'}\n{fields}\n{body}".strip()
        )
    return "\n\n---\n\n".join(blocks)


def _prompt(query: str, documents: list[dict[str, Any]]) -> str:
    return (
        f"DOCUMENTS\n\n{_context(documents)}\n\n"
        f"QUESTION\n\n{query}\n\n"
        f"Answer from the documents above, citing each claim as [doc:<id>]. "
        f"If they do not answer it, reply with exactly {SILENCE_MARKER}."
    )


async def _call(genai: Any, types: Any, prompt: str) -> Any:
    """One generation. Every bound this module has is applied here.

    The timeout is set on the SDK's HTTP options AND enforced again by
    `asyncio.wait_for` in `generate`: the SDK's covers the request, the outer
    one covers everything else the client may do — a retry loop, a token
    refresh, a DNS stall — none of which a request budget distinguishes.
    """
    client = genai.Client(api_key=settings.gemini_api_key)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        temperature=TEMPERATURE,
        http_options=types.HttpOptions(timeout=TIMEOUT_MS),
    )
    return await client.aio.models.generate_content(
        model=settings.gemini_model, contents=prompt, config=config
    )


def _precheck(documents: list[dict[str, Any]], crag_score: float | None) -> str | None:
    """The fences that must clear BEFORE a model call is spent. Reason, or None."""
    if not documents:
        return ("no documents were supplied, so there is nothing to ground an answer in; "
                "asking the model anyway would be asking it to invent the context")
    unciteable = [i for i, doc in enumerate(documents) if not doc.get("id")]
    if unciteable:
        return (f"the document(s) at position {unciteable} carry no id, so any claim drawn "
                "from them could neither be cited nor verified")
    band = evidence_band(crag_score)
    if band is None:
        return ("the retrieved context was not graded, so the refusal band could not be "
                "applied; ungraded context is not evidence worth generating over")
    if band == "refuse":
        return (f"the retrieved context graded {crag_score:.2f}, below the {REFUSE_BAND:.2f} "
                "refusal band, so no model call was made: evidence already judged "
                "insufficient does not become sufficient by being summarised")
    return None


def _verify(text: str, supplied: set[str]) -> tuple[list[str], str | None]:
    """Citations that check out, and the reason to refuse if any do not."""
    cited = list(dict.fromkeys(_CITATION.findall(text)))
    fabricated = [c for c in cited if c not in supplied]
    if fabricated:
        return [], (f"the answer cited {fabricated}, which was not among the documents supplied "
                    f"({sorted(supplied)}). A citation to an id that was not in the context is a "
                    "fabrication, and the claims around it were not written from the documents "
                    "either, so the whole answer is refused rather than flagged")
    if not cited:
        return [], ("the answer cited no document, so nothing in it can be traced back to the "
                    "corpus; an uncited answer is indistinguishable from one written out of the "
                    f"model's own training data. {SILENCE_MARKER} is the reply for that case")
    return cited, None


async def generate(
    query: str,
    documents: list[dict[str, Any]],
    crag_score: float | None,
) -> dict[str, Any]:
    """Answer `query` from `documents`, or report why not. Never raises.

    `documents` are mappings carrying at least ``id``; ``title``, ``body``,
    ``kind``, ``symbol``, ``strategy`` and ``occurred_at`` are used when present.
    `crag_score` is the grade `research_crag` gave the retrieval that produced
    them — None when nothing graded it, which is itself a refusal.

    The report always carries ``generated``, ``verdict``, ``reason``, ``answer``,
    ``citations`` and ``model_called``, and carries ``model``, ``latency_ms`` and
    ``tokens`` exactly when ``model_called`` is True — a caller writing the
    ledger row branches on that flag rather than reading a latency of zero for a
    call that never happened.
    """
    refusal = _precheck(documents, crag_score)
    if refusal:
        return _report(REFUSED, refusal)

    genai, types, reason = _sdk()
    if reason:
        return _report(REFUSED, reason)

    started = time.perf_counter()
    try:
        response = await asyncio.wait_for(
            _call(genai, types, _prompt(query, documents)), timeout=TIMEOUT_MS / 1000
        )
    except TimeoutError:
        reason = f"the model did not answer within {TIMEOUT_MS} ms, so it was cancelled"
        return _report(REFUSED, reason, telemetry=_telemetry(None, started))
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        reason = f"{type(exc).__name__} calling the model: {exc}"
        return _report(REFUSED, reason, telemetry=_telemetry(None, started))

    telemetry = _telemetry(response, started)
    text = (getattr(response, "text", None) or "").strip()
    if not text:
        return _report(REFUSED, "the model returned no text", telemetry=telemetry)

    if text.upper().startswith(SILENCE_MARKER):
        # Not a refusal. The model was asked, it read the documents, and it
        # reported that they do not answer the question — the answer the
        # instruction explicitly asks for, and the one a desk needs to hear.
        silent = "the supplied documents do not answer this question"
        return _report(CORPUS_SILENT, silent, telemetry=telemetry)

    citations, ungrounded = _verify(text, {str(doc["id"]) for doc in documents})
    if ungrounded:
        log.warning("research generate: refused an ungrounded answer (%s)", ungrounded[:80])
        return _report(REFUSED, ungrounded, telemetry=telemetry)

    return _report(ANSWERED, None, answer=text, citations=citations, telemetry=telemetry)
