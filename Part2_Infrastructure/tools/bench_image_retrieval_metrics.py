"""The four definitions the image bench scores by, in Python, matching the TS.

``web/lib/retrieval-eval.ts`` already owns nDCG@k, reciprocal rank, recall@k and
reciprocal rank fusion for the web half of this desk. This file is the SAME FOUR
FUNCTIONS in Python, and it exists as its own module for two reasons.

WHY RESTATE THEM INSTEAD OF IMPORTING
-------------------------------------

There is nothing to import: the TypeScript runs under Node in ``web/`` and the
bench runs under the gateway's venv. The rejected alternative was shelling out
to ``node`` from the bench so that exactly one implementation exists — rejected
because it makes a measurement of a Python retrieval path depend on a Node
toolchain being installed, and a bench that cannot run is a bench nobody runs.

So the definitions are duplicated, and the duplication is DEFENDED BY TESTS
rather than by hope: ``tests/test_research_image_eval.py`` pins each function to
hand-computed values taken from the TypeScript's own arithmetic, so the day
somebody changes the discount, the ideal-DCG cap or the empty-set convention on
one side, the other side goes red. The three conventions worth naming, because
they are the ones implementations silently disagree about:

* the discount is ``1 / log2(i + 2)`` with ``i`` zero-based, so rank 1 is
  undiscounted;
* the ideal DCG is capped at ``min(k, len(relevant))`` — a query with two
  relevant documents scores 1.0 for finding both at ranks 1 and 2, rather than
  being marked down for not filling ten slots it has nothing to fill;
* an empty relevant set scores 0.0, NEVER a NaN and never a silent 1.0. This
  desk does not coerce absence to a number that flatters it, and a 0/0 that
  came back as 1.0 would report a perfect score for a query with no answer key.

WHY THE FUSION LIVES HERE TOO
-----------------------------

Because the bench's third configuration is not "an average of two scores" — it
is the ``1/(k + rank)`` sum ``modules/research_image_arm.fuse`` performs in
production, and measuring a fusion the desk does not ship would answer a
question nobody asked. ``RRF_K`` is imported from ``modules.research_bm25``
rather than re-declared as 60, so the bench cannot drift from the constant the
gateway fuses with; the test asserts that identity rather than the value.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules.research_bm25 import RRF_K  # noqa: E402

__all__ = ["RRF_K", "ndcg_at", "reciprocal_rank", "recall_at", "fuse_rankings", "score_ranking"]


def ndcg_at(ranking: list[str], relevant: set[str], k: int) -> float:
    """Normalised discounted cumulative gain over the first ``k`` results.

    The headline metric for the same reason the TypeScript gives it that job: it
    is the only one of the three that cares WHERE the relevant document landed.
    Recall@10 awards full marks for burying the right chart at position ten, and
    the workspace panel that reads this corpus shows five.

    Binary relevance, and on this corpus that is not a compromise. The bench
    GENERATES the series, so "this chart has a 45% drawdown" is a property of
    the data rather than a judgement somebody made about a picture — which is
    the whole reason this harness can produce a number and ``scripts/rag-eval``
    still cannot.
    """
    dcg = 0.0
    for i, doc in enumerate(ranking[:k]):
        if doc in relevant:
            dcg += 1.0 / math.log2(i + 2)
    ideal = sum(1.0 / math.log2(i + 2) for i in range(min(k, len(relevant))))
    return dcg / ideal if ideal > 0 else 0.0


def reciprocal_rank(ranking: list[str], relevant: set[str]) -> float:
    """1/rank of the FIRST relevant document; 0.0 when none appears at all.

    Zero, not None, and this is the one place in the tree where that is right:
    "no relevant document anywhere in the ranking" is a MEASURED outcome of a
    query that ran, not an absent measurement. The absent case — an arm that
    never ran because its model is missing — never reaches this function; it is
    reported one level up as a named state, the way the module it measures does.
    """
    for i, doc in enumerate(ranking):
        if doc in relevant:
            return 1.0 / (i + 1)
    return 0.0


def recall_at(ranking: list[str], relevant: set[str], k: int) -> float:
    """Fraction of the answer key that appears in the first ``k`` results."""
    if not relevant:
        return 0.0
    found = sum(1 for doc in ranking[:k] if doc in relevant)
    return found / len(relevant)


def fuse_rankings(
    text_ranking: list[str], image_ranking: list[str], k: int = RRF_K
) -> list[str]:
    """RRF over the description arm and the image arm — the shipped arithmetic.

    Two properties are copied deliberately from ``research_image_arm.fuse``,
    because a bench that fused differently would measure a pipeline the desk
    does not run:

    * a document an arm did not return contributes NOTHING for it, rather than a
      penalty. Penalising absence turns the fusion into an AND, and the image
      arm's entire licence to exist is that it may ADD a document and may never
      remove one.
    * ties are broken in favour of the DESCRIPTION arm's rank, then by id. That
      is ``_order``'s rule and its reason: ``1/(k+1)`` from the image arm alone
      ties exactly with ``1/(k+1)`` from the text arm alone, the tie is common
      rather than exotic, and the arm whose quality was the open question does
      not get to walk ahead of the one that scored identically.
    """
    text_rank = {doc: i + 1 for i, doc in enumerate(text_ranking)}
    image_rank = {doc: i + 1 for i, doc in enumerate(image_ranking)}
    ids = list(dict.fromkeys([*text_ranking, *image_ranking]))

    def score(doc: str) -> float:
        total = 0.0
        for ranks in (text_rank, image_rank):
            rank = ranks.get(doc)
            if rank is not None:
                total += 1.0 / (k + rank)
        return total

    # `math.inf` for an unranked document in the tie-break, never a large int:
    # the sort must put "the text arm never saw this" last among equals, and an
    # arbitrary sentinel like 10_000 would silently become a real rank the day a
    # corpus grew past it.
    return sorted(ids, key=lambda d: (-score(d), text_rank.get(d, math.inf), d))


def score_ranking(ranking: list[str], relevant: set[str]) -> dict[str, float]:
    """The three metrics for one ranking, at the k the TypeScript reports.

    nDCG@10, MRR and recall@5 — the same three and the same two k values as
    ``evaluateRetrieval``, so a figure from this bench and a figure from the web
    harness can be read side by side without a footnote about definitions.
    """
    return {
        "ndcg10": ndcg_at(ranking, relevant, 10),
        "mrr": reciprocal_rank(ranking, relevant),
        "recall5": recall_at(ranking, relevant, 5),
    }
