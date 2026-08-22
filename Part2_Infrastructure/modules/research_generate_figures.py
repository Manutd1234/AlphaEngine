"""Fence 3, enforced: a figure in the answer must be a figure in a document.

`research_generate`'s system instruction has always said FIGURES MUST BE QUOTED,
NEVER PRODUCED. Until this module it said only that. Fence 4 extracted the
citations from the answer and checked every one against the ids actually
supplied; nothing did the same for the numbers, so an answer citing a perfectly
real document and carrying a Sharpe that appears in NO document passed every
check and reached a trader wearing a citation.

That is the worse half of the pair. A fabricated id is at least inspectable —
the reader can look for `doc-z` and fail to find it. A fabricated number beside
a real id is invisible: the citation resolves, the document opens, and only
somebody who reads the whole document and remembers what the answer claimed
notices that 2.9 is nowhere in it.

So the check is the same shape as fence 4, on purpose. Extract what the answer
claims, compare it against what was supplied, and REFUSE THE WHOLE ANSWER when
one item does not check out. Not a warning, not a `grounded: false` flag beside
the paragraph, for the reason fence 4 already argues: a warning next to fluent
prose is a thing readers learn to skip, and a model that produced one number it
could not have read produced the sentence around it the same way.

The refusal is its own reason, never folded into the citation one. "Cited a
document that does not exist" and "quoted a number that is not in the
documents" are different failures with different fixes, and a ledger that
records them under one sentence cannot answer which one this provider does.

False positives are the whole difficulty
----------------------------------------

A check that refuses legitimate prose is a check somebody turns off. Three
classes of digit in an answer are NOT claimed measurements, and each is removed
before anything is compared:

* **the ids in citations.** `[doc:11111111-0000-...]` is thirty digits of
  document id, and the seam's own fixtures use UUIDs. Fence 4 has already
  verified them, against a stricter standard than this one.
* **dates and clock times.** `12 March`, `2026-08-22`, `03:00`. A date has too
  many surface forms for verbatim comparison — a document writing
  `2026-03-12` and an answer writing `12 March` are the same fact and would
  refuse — so dates are outside this fence and this comment is where that gap is
  recorded rather than discovered. They are not arithmetic, which is what the
  fence exists to catch.
* **ordinals.** `the 2nd run` counts documents, it does not measure anything.

Everything else must appear, character for character after commas are stripped,
in the text of some supplied document. That deliberately refuses ROUNDING: a
document reading 1.425 does not license an answer reading 1.42, which is exactly
the derivation the instruction forbids and the one a reader is least able to
spot.

A fourth class, and the one that had to be argued for
-----------------------------------------------------

`research_generate_vision` now attaches a chart's PNG alongside the chart
document it belongs to, and the model reads figures off it — MEASURED: given a
rendered equity curve with a -34% drawdown injected at bars 220-300, it reported
"the equity drops from over 140,000 USD to below 95,000 USD" without being told.
Neither 140,000 nor 95,000 is in any document body, because they were never
written down; they were read off pixels. Under the rule above, every one of
those answers refuses.

Three ways out, and only one of them is honest:

* **leave the fence alone.** Vision then contributes nothing it can state, and
  worse, the refusals it causes are frequent and their stated reason is WRONG —
  "figures must be quoted, never computed" describes arithmetic, and this number
  was not computed, it was read. A fence whose reason misdescribes the failure
  sends whoever reads it to fix the wrong thing.
* **exempt anything on a call that carried an image.** Unacceptable. The
  exemption would then cover every number in the answer, including the ones the
  model made up, and it would cover them silently.
* **make the model DECLARE it**, which is what happens. A figure read off a
  chart is admissible only when the answer marks it `[chart:<id>]`, naming the
  document whose image was attached. The exemption is not "the model said it
  read this off a chart" — the marker is IN THE PROSE THE READER SEES, right
  next to the number, so the approximation cannot arrive wearing a measured
  figure's typography. That is the same promise the citation form makes, in the
  other direction.

The check that keeps it from being a hole: a `[chart:<id>]` naming a document
whose image was NOT attached to this call refuses the answer, under its own
reason. Without it the marker is a licence — a model could label any invented
number and walk past fence 3 — and since `research_generate` passes the ids it
actually sent, a text-only call has an empty set and every marker refuses.

What this does NOT defend, said plainly: a model that attaches the marker to a
number it invented rather than read still gets that number in front of a reader,
labelled as an approximation off a chart that WAS sent. The residual is real.
What it is not is a number that reads as measured, and the size of it is bounded
by the chart actually being in the context beside the claim — which is more than
fence 3 can say about any figure it passes today.
"""

from __future__ import annotations

import re

from modules.research_generate_prompt import CHART_READING, CITATION, document_text

#: A number as prose writes one: thousands separators optional, decimals
#: optional, sign and unit left outside because `-3%` and `3%` are the same
#: token to a corpus search and the minus is carried by the words around it.
_FIGURE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")

_MONTH = (
    r"January|February|March|April|May|June|July|August|September|October|November|"
    r"December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec"
)

#: Digits that are not claimed measurements, stripped before comparison. Order
#: matters: the longest date shape has to go first or its day would survive as a
#: bare number once the month around it was removed.
#: A figure the answer marked as read off an attached chart: the number, then a
#: short run of unit and prose, then the marker naming the document. The gap is
#: capped at 24 characters and may hold no other digit and no bracket, so the
#: marker cannot reach backwards past an intervening number and launder it —
#: "Sharpe 2.9 and the curve ends near 1.4x [chart:doc-a]" exempts 1.4 and
#: leaves 2.9 to the fence, which is the whole point of the cap.
_CHART_FIGURE = re.compile(
    r"\d+(?:,\d{3})*(?:\.\d+)?[^\d\[\]]{0,24}\[chart:[^\]\s]+\]"
)

_NOT_MEASUREMENTS: tuple[re.Pattern[str], ...] = (
    # The marker itself, so an id's own digits never become a claimed figure.
    # `_CHART_FIGURE` runs BEFORE this tuple; if it ran after, this pattern
    # would eat the marker and leave the number it was labelling exposed.
    CHART_READING,
    CITATION,
    re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?"
               r"(?:Z|[+-]\d{2}:?\d{2})?)?"),
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),
    re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"),
    re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{_MONTH})\.?(?:\s+\d{{4}})?\b", re.I),
    re.compile(rf"\b(?:{_MONTH})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}\b", re.I),
    re.compile(rf"\b(?:{_MONTH})\.?\s+\d{{1,4}}\b", re.I),
    re.compile(r"\b\d+(?:st|nd|rd|th)\b", re.I),
)


def _canonical(token: str) -> str:
    """One spelling per value, so 1,024 and 1024 are the same figure.

    Leading zeros are dropped from integers (`03` is `3`) and decimals are left
    exactly as written. Trailing zeros are NOT normalised away: `1.40` and `1.4`
    are different strings here on purpose, because turning one into the other is
    rounding, and rounding is the derivation this fence exists to refuse.
    """
    token = token.replace(",", "")
    if "." not in token:
        token = token.lstrip("0") or "0"
    return token


def _figures(text: str) -> list[str]:
    return [_canonical(found) for found in _FIGURE.findall(text)]


def _claimed(answer: str) -> list[str]:
    """The figures an answer asserts, in order, once the exemptions are removed."""
    stripped = _CHART_FIGURE.sub(" ", answer)
    for pattern in _NOT_MEASUREMENTS:
        stripped = pattern.sub(" ", stripped)
    return list(dict.fromkeys(_figures(stripped)))


def unbacked_chart_readings(answer: str, images: frozenset[str]) -> list[str]:
    """Ids the answer marked as chart readings whose image was never attached."""
    marked = dict.fromkeys(CHART_READING.findall(answer))
    return [document_id for document_id in marked if document_id not in images]


def chart_reading_refusal(answer: str, images: frozenset[str]) -> str | None:
    """The reason to refuse a chart marker this call did not earn, or None.

    Checked BEFORE the figure comparison and reported separately, because the
    two are different failures: this one says the answer claimed to have looked
    at a picture that was not sent, and that claim is false whatever the number
    beside it turns out to be.
    """
    unbacked = unbacked_chart_readings(answer, images)
    if not unbacked:
        return None
    sent = "no chart image was attached to this call at all" if not images else (
        f"the only image(s) attached were for {sorted(images)}"
    )
    return (
        f"the answer marked {unbacked} as figures read off a chart, but {sent}. A "
        "[chart:<id>] marker is the ONE exemption from the quoted-figures rule, and it is "
        "earned by the image actually having been sent — otherwise it is a way to label an "
        "invented number and walk past the fence. The whole answer is refused rather than "
        "shown with the marker stripped: a model that claimed to read a chart it was never "
        "given did not write the sentences around that claim from the documents either"
    )


def unquoted_figures(answer: str, documents: list[dict]) -> list[str]:
    """Figures the answer states that no supplied document contains.

    The haystack is `document_text`, the same rendering the prompt quotes to the
    model — including its truncation — so a figure that sits past the character
    cut is correctly NOT quotable: the model could not have read it.
    """
    supplied: set[str] = set()
    for doc in documents:
        supplied.update(_figures(document_text(doc)))
    return [figure for figure in _claimed(answer) if figure not in supplied]


def figure_refusal(
    answer: str, documents: list[dict], *, images: frozenset[str] = frozenset()
) -> str | None:
    """The reason to refuse an answer whose figures were not quoted, or None.

    `images` is the set of document ids whose chart image was ACTUALLY attached
    to the call that produced this answer — `research_generate` passes what
    `research_generate_vision.resolve` sent, never what it wished it had sent.
    Empty is the text-only call and the default, and on it every `[chart:<id>]`
    marker refuses, which is the half of the vision exemption that lives in code
    rather than in the instruction.
    """
    unbacked = chart_reading_refusal(answer, images)
    if unbacked:
        return unbacked
    fabricated = unquoted_figures(answer, documents)
    if not fabricated:
        return None
    return (
        f"the answer states the figure(s) {fabricated}, which appear in none of the "
        "supplied documents. Figures must be QUOTED from the documents, never computed, "
        "rounded, converted or annualised, so the answer is refused whole rather than "
        "shown with a caveat. This is a different fact from a fabricated citation: the "
        "citations here may well resolve, and a real id beside an invented number is the "
        "harder of the two for a reader to catch. A figure genuinely read off an attached "
        "chart is the one exemption and must be marked [chart:<id>] in the answer itself"
    )
