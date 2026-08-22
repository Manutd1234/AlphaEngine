"""The two fences that read ids rather than prose: the precheck, and citations.

Split out of `research_generate` when the multimodal budget pushed that file
past the 400-line ceiling, and they belong together: both are about DOCUMENT
IDENTITY rather than about the text of an answer. The precheck asks whether
these documents can be cited at all before a call is spent; `verify` asks
whether the ids that came back were ones we supplied. The figure fence lives in
`research_generate_figures` and the image states in `research_generate_vision`,
each for the same reason — one file per thing that can refuse, so a refusal's
argument sits next to the code that makes it.

Nothing here talks to a provider and nothing here raises. Both functions return
a REASON — the sentence a reader is shown — or None, and `research_generate`
turns that into the verdict. Keeping the reason text here rather than at the
call site is deliberate: the wording IS the product of a fence, and a reason
assembled two files away from the check that produced it is one that drifts.
"""

from __future__ import annotations

from typing import Any

from modules.research_crag import ANSWER_BAND, REFUSE_BAND
from modules.research_generate_prompt import CITATION, SILENCE_MARKER, injection_refusal


def evidence_band(score: float | None) -> str | None:
    """Which CRAG band a graded score falls in, or None when nothing was graded.

    The bands are imported from `research_crag`, never restated. A second copy
    of 0.4 can drift, and it would drift in the worst direction available:
    generation refusing at a threshold the grader no longer uses means the
    desk's stated relevance floor and its real one are different numbers.

    None for an ungraded score, never "refuse". "Nobody graded this" and "this
    graded badly" are different facts; the caller refuses on both, for different
    reasons the reader can read.
    """
    if score is None:
        return None
    return "answer" if score > ANSWER_BAND else "refuse" if score < REFUSE_BAND else "rewrite"


def precheck(documents: list[dict[str, Any]], crag_score: float | None) -> str | None:
    """The fences that must clear BEFORE a model call is spent. Reason, or None."""
    if not documents:
        return ("no documents were supplied, so there is nothing to ground an answer in; "
                "asking the model anyway would be asking it to invent the context")
    unciteable = [i for i, doc in enumerate(documents) if not doc.get("id")]
    if unciteable:
        return (f"the document(s) at position {unciteable} carry no id, so any claim drawn "
                "from them could neither be cited nor verified")
    poisoned = injection_refusal(documents)
    if poisoned:
        return poisoned
    band = evidence_band(crag_score)
    if band is None:
        return ("the retrieved context was not graded, so the refusal band could not be "
                "applied; ungraded context is not evidence worth generating over")
    if band == "refuse":
        return (f"the retrieved context graded {crag_score:.2f}, below the {REFUSE_BAND:.2f} "
                "refusal band, so no model call was made: evidence already judged "
                "insufficient does not become sufficient by being summarised")
    return None


def verify(text: str, supplied: set[str]) -> tuple[list[str], str | None]:
    """Citations that check out, and the reason to refuse if any do not."""
    cited = list(dict.fromkeys(CITATION.findall(text)))
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
