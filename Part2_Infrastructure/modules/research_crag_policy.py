"""The three-band policy: what actually happens to a graded retrieval.

`research_crag` documents the policy in its first ten lines and has done since
it was written:

    score > 0.8    answer
    0.4 - 0.8      rewrite the query once, re-query, then answer or refuse
    score < 0.4    refuse, and say why

For a long time that was not what ran. ONE band gated anything — ``refused =
grade.score < grader.refuse_band`` — so ``ANSWER_BAND`` was a constructor
default that decided nothing, and a mid-band retrieval was answered whether the
rewrite had improved it, made it worse, or never happened at all because the
corpus had no vocabulary to add. The middle band existed in the ``band`` field,
in the docstrings and in the workspace, and nowhere in the control flow. This
module is that control flow, and it is a BEHAVIOUR CHANGE: a mid-band result
that does not clear the answer band after its one rewrite now refuses, where it
used to be served with ``state: "ok"`` and ``band: "rewrite"``.

Why refusing a 0.79 is right
----------------------------

It reads harsh, and the harshness is the point of the middle band. A mid-band
grade means the retrieval was not good enough to answer from — that is what the
band SAYS. The rewrite is the one chance to fix it, built from the corpus's own
vocabulary because that is the only thing that can turn a near-miss into a hit
here. If the second attempt still does not clear, the desk's own research does
not hold the answer, and this repository's whole argument is that saying so is
an answer while a plausible one built on weak evidence is not.

Why the bound is structural
---------------------------

`rewrite_once` is called from straight-line code under one ``if``, takes the
first round and returns the round to serve, and contains no loop and no
counter. There is nowhere for a third attempt to be added by accident: adding
one means writing a loop, which is a visible change to the shape of the code
rather than a bumped constant.

Why it lives outside `research_crag`
------------------------------------

The file-length ceiling — `research_crag` is at the line where it may not grow
— and one property that turns out to be worth the split: nothing here imports
`research_crag` at runtime. The grader is passed IN, its bands are read off the
instance, and the two type names are imported under ``TYPE_CHECKING``. So the
import graph stays one-way and this module can be exercised with a grader
built by the caller, which is how the band edges get tested without the corpus.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any

from modules import research_stages

if TYPE_CHECKING:  # pragma: no cover - type names only, never imported at runtime
    from modules.research_crag import ContextGrader, Grade
    from modules.research_router import Execution, Plan, ResearchRouter, ToolResult


@dataclass(frozen=True, slots=True)
class Round:
    """One retrieval round, graded, plus everything the answer needs about it.

    Carried as a value rather than as five variables reassigned in place,
    because the retry has to be able to hand back EITHER round and the two
    differ in five correlated fields at once. A retry that improved the score
    but left `plan` pointing at the first round's planner is the class of bug
    this shape makes unwriteable.
    """

    query: str
    run: Execution
    grade: Grade
    plan: Plan
    rerank: dict[str, Any]
    calls: list[ToolResult] = field(default_factory=list)
    #: The rewritten query, set only when a rewrite was actually SPENT — a
    #: second round trip happened — never merely because one was considered.
    rewritten: str | None = None
    #: 1 or 2. Never 3: there is no loop here.
    retrievals: int = 1


async def rewrite_once(
    first: Round,
    rag: Any,
    router: ResearchRouter,
    grader: ContextGrader,
    *,
    match_count: int,
    kind: str | None,
    now: datetime | None,
) -> Round:
    """The ONE retry. Returns the round to serve — the better of at most two.

    Re-PLANNED rather than re-run, because the tokens the rewrite added are
    exactly the kind the router routes on: a rewrite that gained a data hash
    should reach the lexical tool this time.

    The retry is kept only when it graded at least as well as the first round.
    A rewrite that made things worse must not cost the caller the better round,
    and the comparison is only meaningful because both rounds were retrieved at
    the same width and narrowed by the same ranker — see `research_stages.wide`.
    """
    candidate = grader.rewrite(first.query, first.run.matches)
    if candidate == first.query:
        # The corpus's own vocabulary held nothing the query had not already
        # named. A second round trip would ask the identical question and be
        # answered identically, so it is not spent — and `retrievals` stays 1,
        # because a rewrite that was considered and not sent is not a retrieval
        # and the refusal below has to be able to say which happened.
        return first

    plan = router.plan(candidate)
    retry = await router.execute(
        plan,
        research_stages.with_graph_width(rag, match_count),
        match_count=research_stages.wide(match_count),
        kind=kind,
    )
    calls = first.calls + list(retry.calls)

    if retry.state != "ok" or not retry.matches:
        # The retry ran and came back with nothing to grade. It still HAPPENED
        # — it cost a round trip and it is in the ledger — so retrievals says
        # 2 while the first round's rows and grade stand.
        return replace(first, calls=calls, rewritten=candidate, retrievals=2)

    # The same narrowing as round one, or the comparison below is between a
    # cross-encoder score and an RRF one — two different scales.
    retry.matches, retry_rerank = await research_stages.narrow(
        candidate, retry.matches, match_count,
    )
    retry_grade = grader.grade(candidate, retry.matches, now=now)
    if retry_grade.score < first.grade.score:
        return replace(first, calls=calls, rewritten=candidate, retrievals=2)
    return Round(
        query=candidate, run=retry, grade=retry_grade, plan=plan, rerank=retry_rerank,
        calls=calls, rewritten=candidate, retrievals=2,
    )


def refused(round_: Round) -> bool:
    """Whether this round refuses. The whole policy, in one expression.

    A round is served when its grade is in the ANSWER band and refused
    otherwise, and by the time this is read the mid band has already had its
    one rewrite. So "answer if it clears, refuse if it does not" is not an
    extra rule bolted on after the retry — it is the same three bands, applied
    to the round that was kept.
    """
    return not round_.grade.usable


def refusal(round_: Round, grader: ContextGrader) -> str:
    """Why this refused, in one sentence a reader can act on.

    It has to carry the denominator. "Nothing relevant" over a corpus of four
    hundred documents is a statement about the query; the same words over a
    corpus of one are a statement about the corpus, and a refusal that cannot
    tell the reader which one it is has said nothing.

    And it has to carry WHICH refusal this is. A score below the floor and a
    mid-band score that survived its rewrite are two different findings — one
    says the corpus holds nothing like this, the other says it holds something
    close that still does not answer the question — and one sentence for both
    would flatten exactly the distinction the middle band was added for.
    """
    grade, run = round_.grade, round_.run
    searched = (
        f"{run.corpus_size} indexed documents were searched"
        if run.corpus_size is not None
        else "the corpus was searched"
    )
    reasons = "; ".join(grade.reasons)

    if grade.score < grader.refuse_band:
        return (
            f"Nothing in this desk's own research is relevant to that: {searched}, and the "
            f"closest {len(run.matches)} scored {grade.score:.2f} — below the "
            f"{grader.refuse_band:.2f} relevance floor. " + reasons + ". This is a refusal on "
            "relevance: documents came back and none of them answer the question. It is "
            "not an empty corpus and not a search that failed."
        )

    spent = (
        f"The one rewrite this path allows re-queried the corpus as "
        f"'{round_.rewritten}' and the result still did not clear the line."
        if round_.rewritten is not None
        else "No rewrite was spent: the closest match named no symbol or strategy the query "
        "had not already used, so a second query would have asked the same question."
    )
    return (
        f"Nothing in this desk's own research answers that well enough to build on: {searched}, "
        f"and the closest {len(run.matches)} scored {grade.score:.2f} — inside the "
        f"{grader.refuse_band:.2f}-{grader.answer_band:.2f} band, where retrieval is close "
        f"enough to be worth one rewrite and not close enough to answer from. {spent} "
        + reasons + ". This is a refusal on relevance: documents came back, they are related "
        "to the question and they do not answer it. It is not an empty corpus and not a "
        "search that failed."
    )
