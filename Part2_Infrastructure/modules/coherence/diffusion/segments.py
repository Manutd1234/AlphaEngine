"""The parts of a statement that carry the decision, separated from the parts that do not.

This module exists because of a measurement, and the measurement is the most
useful thing this study produced.

A general sentence encoder over a whole FOMC statement CANNOT RECOVER THE
POLICY MOVE THAT IS WRITTEN IN IT. Out of fold, regressing the move in basis
points on a twelve-dimensional projection of the whole-statement embedding
gives R^2 = -0.60 — worse than predicting the mean — and a three-class
hike/hold/cut classifier reaches 0.84 against a 0.64 majority baseline.
Embedding ONLY the sentence that states the target range gives R^2 = +0.74 and
classifies direction at 1.00.

The cause is dilution, not the encoder. The decision sentence is about 130
characters of a 1,950-character statement — seven per cent of it — and the
other ninety-three per cent is an economic assessment whose wording moves for
reasons unrelated to the decision. A mean-pooled embedding averages the signal
into the boilerplate. The same thing defeats the literal word-diff that the
Lazy Prices literature uses: the fraction of words that changed since the
previous statement correlates +0.014 with the size of the policy move, because
a fifty-basis-point cut can be a two-word edit while a hold can arrive with a
rewritten paragraph about the labour market.

So any study measuring "how novel is this announcement" over a whole
central-bank statement is measuring the boilerplate. Segment first.

The extractors are regexes and deliberately so: a sentence splitter is a
dependency, and the three sentences that matter are each identified by a phrase
the Committee has used unchanged since 2019. A segment that does not match is
absent rather than approximated.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: The sentence that states the target range. The decision itself.
_DECISION = re.compile(r"[^.]*target range for the federal funds rate[^.]*\.", re.I | re.S)

#: The roll call. Dissents are the sharpest discrete signal in the document and
#: they are absent from any summary of it.
_VOTE = re.compile(r"Voting (?:for|against) the (?:FOMC )?monetary policy action[^.]*\.", re.I | re.S)

#: Forward guidance: what the Committee says it will do next.
_GUIDANCE = re.compile(
    r"[^.]*(?:in determining the (?:timing and size|extent)|anticipates that|will continue to "
    r"monitor|prepared to adjust)[^.]*\.", re.I | re.S)

#: The clause naming who voted against, to the end of the block.
_DISSENT = re.compile(r"Voting against[^.]*?\b(?:were|was)\b(.*)", re.I | re.S)

#: A sentence ends at a full stop followed by a capital or by the end of the
#: text, EXCEPT after a middle initial. Both exceptions were found the hard
#: way: "raise the target range by 0.5 percentage point" carries a full stop
#: inside a number, and "Esther L. George" carries one that is followed by a
#: space and a capital and is not the end of anything. Cutting at either loses
#: dissenters — the second turned a three-dissent meeting into a one.
_SENTENCE_END = re.compile(r"(?<!\s[A-Z])\.(?=\s+[A-Z]|\s*$)")

#: A member is "Firstname Lastname" or "Firstname M. Lastname". Counting names
#: rather than splitting on separators, because the clause that names them also
#: explains what each of them wanted — "…, who preferred to maintain the target
#: range at 2 percent to 2-1/4 percent" — and those explanations carry commas
#: and "and"s of their own.
_MEMBER = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+\b")


@dataclass(frozen=True)
class Segments:
    """The pieces of a statement, each present or absent and never invented."""

    decision: str | None = None
    vote: str | None = None
    guidance: str | None = None
    dissenters: int = 0

    @property
    def decision_chars(self) -> int:
        return len(self.decision or "")

    def channel(self, name: str) -> str | None:
        return {"decision": self.decision, "vote": self.vote, "guidance": self.guidance}.get(name)


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    found = pattern.search(text or "")
    return found.group(0).strip() if found else None


def count_dissenters(text: str) -> int:
    """How many members voted against. Zero when the sentence says nobody did.

    Distinguishing "nobody dissented" from "no vote sentence" is left to the
    caller through `Segments.vote`: this returns a count, and a count of zero
    with no vote sentence means unknown rather than unanimous.
    """
    found = _DISSENT.search(text or "")
    if not found:
        return 0
    clause = found.group(1)
    if not clause or "none" in clause.lower():
        return 0
    # One sentence only. What follows it is a different fact: the Committee
    # notes who "voted as an alternate member", and reading that as a dissent
    # turned an 8-1 vote into a 2-dissent meeting.
    end = _SENTENCE_END.search(clause)
    if end:
        clause = clause[: end.start()]
    return len({name for name in _MEMBER.findall(clause)})


def extract(text: str) -> Segments:
    """Split a statement into the parts a reader acts on."""
    return Segments(
        decision=_first(_DECISION, text),
        vote=_first(_VOTE, text),
        guidance=_first(_GUIDANCE, text),
        dissenters=count_dissenters(text),
    )
