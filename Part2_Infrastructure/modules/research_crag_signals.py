"""The one relevance signal the CRAG grader was not reading.

`ContextGrader.grade` weighs four things off the row the hybrid RPC returned —
whether both retrievers agreed, the cosine similarity, how much of the query's
vocabulary the document contains, and how old it is. All four are properties of
the RETRIEVAL. None of them is a judgement about whether this document answers
this question, because the fused index cannot make one: RRF sees rank, and the
bi-encoder embedded the query and the document in ignorance of each other.

The cross-encoder can. `research_rerank` runs the pair through one model
together with full cross-attention and writes its opinion onto the row as
``rerank_score`` — and the grader never read it. The score changed a grade only
by changing WHICH ROW happened to be first, which means the most informative
signal in the pipeline was contributing through a side effect of sorting. This
module is the arithmetic that folds it in.

Why this is arithmetic and not a second model call
--------------------------------------------------

Same argument `research_crag` makes for grading at all: a grade that is a
function of a model version is not reproducible across deployments, and
reproducibility is what the rest of this project spends its effort on. The
cross-encoder has already run by the time this is reached — its cost is spent,
its output is a number on the row, and turning that number into a contribution
is a logistic and a weighted mean. Nothing here loads, calls or waits on
anything.

Absence is absence, never zero
------------------------------

A row with no ``rerank_score`` key gets the grade it gets today, to the last
decimal. That is not a nicety: an unconfigured desk is the DEFAULT deployment,
and a fold that treated a missing score as 0.0 — or as a neutral 0.5 — would
move every grade on every desk that never asked for a re-ranker, which is the
`?? 0` defect this codebase is most alert to wearing a different hat. The fold
happens when there is a measurement and does not happen when there is not, and
the returned reason line is `None` in the second case so that the grade's own
reasons never claim a signal that was never read.
"""

from __future__ import annotations

import math
from typing import Any

from modules import research_rerank

#: How much of the grade the cross-encoder may move.
#:
#: A quarter, and the number is bounded from both sides by an argument. Below
#: it: the fold has to be able to carry a mid-band grade across a band edge, or
#: reading the signal changes nothing that matters — the seam's own re-ranked
#: pair measures 0.787 unfolded and 0.810 folded, which is exactly the
#: 0.8 crossing this is for. Above it: the other four signals are read off the
#: retrieval itself and can be checked by a reader looking at the row, whereas
#: this one is a model's opinion that no field on the row corroborates. A
#: quarter is enough to decide a borderline case and never enough to carry a
#: document over the answer line on its own — ``_confidence`` returns at most
#: 1.0, so the fold contributes at most 0.25 and a document the retrieval
#: signals score below 0.55 cannot be answered from on the model's say-so.
CROSS_ENCODER_WEIGHT = 0.25


def _confidence(logit: float) -> float:
    """The cross-encoder's raw logit as a probability in 0..1.

    A logistic, because that is the function ``bge-reranker-base`` was trained
    under: its objective is cross-entropy over the sigmoid of this number, so
    ``sigmoid(logit)`` is the model's own calibrated relevance probability and
    anything else here would be re-scaling a score into units it was not fitted
    in. Min-max normalising the batch was the rejected alternative — it makes
    the best candidate score 1.0 whether it is relevant or not, which is
    precisely the "three cards that look like an answer" failure CRAG exists to
    catch, re-introduced one layer down.

    Written in two branches to stay finite: ``exp(-x)`` overflows for a large
    negative logit, and a re-ranker that is confidently NEGATIVE about a
    document is the ordinary case, not the edge one.
    """
    if logit >= 0.0:
        return 1.0 / (1.0 + math.exp(-logit))
    odds = math.exp(logit)
    return odds / (1.0 + odds)


def cross_encoder(best: Any, score: float) -> tuple[float, str | None]:
    """Fold the cross-encoder's opinion of `best` into `score`, if it has one.

    Returns the score and the reason line to append, or the score UNCHANGED and
    `None` when the row carries no score. Three ways that happens and all three
    mean the same thing here: no re-ranker is configured, one is configured and
    could not run, or this particular row carried no text and was never scored
    — `research_rerank` leaves the key absent in every one of them rather than
    writing a plausible-looking zero, which is what makes this check a check on
    a measurement and not on a default.
    """
    raw = best.get(research_rerank.SCORE_FIELD) if hasattr(best, "get") else None
    if raw is None:
        return score, None
    try:
        logit = float(raw)
    except (TypeError, ValueError):
        # A non-numeric score is a corrupt row, not a zero-relevance one. The
        # grade it would have had is the honest answer; inventing a low
        # confidence would refuse a query on the strength of a type error.
        return score, None
    if not math.isfinite(logit):
        return score, None

    confidence = _confidence(logit)
    folded = (1.0 - CROSS_ENCODER_WEIGHT) * score + CROSS_ENCODER_WEIGHT * confidence
    return folded, (
        f"the cross-encoder read the query and the closest match together and "
        f"scored them {confidence:.0%} relevant"
    )
