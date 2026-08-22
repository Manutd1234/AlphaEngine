"""nDCG, MRR, recall and RRF — the SAME definitions the TypeScript half uses.

``web/lib/retrieval-eval.ts`` already holds these four functions, and it holds
them because the desk decided once that "adding a second retriever without an
evaluation replaces a pipeline whose quality is unknown with a pipeline whose
quality is unknown and more complicated". This file is the Python translation
of that decision, and the translation is DELIBERATELY literal.

WHY A SECOND COPY AT ALL, AND WHY IT MAY NOT DRIFT
---------------------------------------------------

The measurement has to happen where the models are. The CLIP pair is ONNX on
the gateway's CPU — ``modules/research_image.py`` explains at length why it
could never have run in the Edge runtime — so a harness that scores it has to
be Python, and a harness that scored it with metrics of its own invention would
produce a number that cannot be set beside the TypeScript one. Two harnesses
disagreeing about what nDCG@k means is worse than one harness, because the
disagreement is invisible until somebody quotes both in the same sentence.

So every function below is the TS function, line for line, including the parts
that look like they could be improved:

* nDCG uses BINARY relevance and an ideal DCG summed over ``min(k, |relevant|)``
  positions. Graded relevance would be more informative and would require
  somebody to have graded it; inventing grades to make a metric richer is
  inventing data.
* recall@k divides by ``|relevant|`` and returns 0 for an empty answer key
  rather than NaN — the TS comment's choice, kept.
* the fusion's tie-break is score, then the FIRST ranking's position with
  absent treated as infinity, then the id. Python's ``sorted`` on ``str``
  orders by code point where ``localeCompare`` orders by locale; for the ASCII
  ids this corpus uses they are the same order, and the corpus ids are ASCII by
  construction rather than by luck.
* an ordering that did not return a document contributes NOTHING for it rather
  than a penalty. Penalising absence turns the fusion into an AND across two
  retrievers with very different recall, which is exactly the failure the image
  arm must not introduce: it may add candidates, it may never remove one.

``RRF_K`` is IMPORTED from ``modules/research_bm25.py`` rather than restated.
That is the same 60 the hybrid RPC uses, that ``research_bm25.fuse`` uses, that
``research_image_arm`` fuses its fourth arm on, and that the TS file pins. A
bench measuring a fusion on its own private constant would be measuring
something the desk does not serve.

``tests/test_research_image_eval.py`` pins these against hand-computed values
taken from the TypeScript definitions, so the two implementations agree by
assertion rather than by intention.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules.research_bm25 import RRF_K  # noqa: E402


def ndcg_at(ranking: list[str], relevant: set[str], k: int) -> float:
    """``ndcgAt`` from ``web/lib/retrieval-eval.ts``.

    The headline metric because it is the only one of the three that cares
    about WHERE a relevant document landed. recall@k gives full marks for
    burying the right answer at position k, and for a panel that shows five
    results that is the same as not finding it.
    """
    dcg = sum(
        1.0 / math.log2(i + 2)
        for i, key in enumerate(ranking[:k])
        if key in relevant
    )
    ideal = sum(1.0 / math.log2(i + 2) for i in range(min(k, len(relevant))))
    return dcg / ideal if ideal > 0 else 0.0


def reciprocal_rank(ranking: list[str], relevant: set[str]) -> float:
    """Reciprocal rank of the FIRST relevant document; 0 when none appears."""
    for i, key in enumerate(ranking):
        if key in relevant:
            return 1.0 / (i + 1)
    return 0.0


def recall_at(ranking: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for key in ranking[:k] if key in relevant) / len(relevant)


def reciprocal_rank_fusion(
    primary: list[str], secondary: list[str], k: int = RRF_K
) -> list[dict]:
    """``reciprocalRankFusion`` from the TypeScript, with the arms renamed.

    ``vectorRanking``/``lexicalRanking`` there; ``primary``/``secondary`` here,
    because in this bench the two arms are the DESCRIPTION arm and the IMAGE
    arm and calling the image side "lexical" would be a lie that survives into
    a JSON key. The asymmetry is otherwise identical and it matters: ties break
    towards ``primary``, and ``primary`` is the description arm — the same
    precedence ``research_image_arm._order`` gives the text arms, and for the
    same stated reason, that an optional arm of unmeasured quality may add
    candidates but may not walk ahead of a text document that scored equally.
    """
    first = {key: i + 1 for i, key in enumerate(primary)}
    second = {key: i + 1 for i, key in enumerate(secondary)}
    fused = []
    for key in dict.fromkeys([*primary, *secondary]):
        primary_rank = first.get(key)
        secondary_rank = second.get(key)
        fused.append({
            "id": key,
            "primary_rank": primary_rank,
            "secondary_rank": secondary_rank,
            "score": (1.0 / (k + primary_rank) if primary_rank else 0.0)
                     + (1.0 / (k + secondary_rank) if secondary_rank else 0.0),
        })
    # Ties broken by the primary rank, then by id. An unstable order across runs
    # would make the numbers below move for no reason and destroy the point of
    # measuring them — the TS comment, and it applies with more force here,
    # where the whole output is a comparison of three orderings.
    fused.sort(key=lambda d: (
        -d["score"], d["primary_rank"] if d["primary_rank"] else math.inf, d["id"],
    ))
    return fused


def cosine_ranking(query: list[float], vectors: dict[str, list[float]]) -> list[str]:
    """Every document id, ordered by cosine similarity to ``query``.

    COSINE COMPUTED IN FULL rather than assumed from a dot product. fastembed
    normalises the output of some models and not others, and the two encoders
    compared here are different models from different families — so a bench
    that took the dot product would be comparing a cosine against something
    that is not one, and would report the difference as retrieval quality.

    A zero-norm vector sorts LAST with a similarity of -1 rather than raising or
    scoring 0.0. It cannot occur on the shipped path — ``research_image._vector``
    refuses an all-zero vector precisely because it would rank as similar to
    every query — but a bench that crashed on one would hide which document
    produced it, and 0.0 would place it above every genuinely opposed document.

    Ties break by id so the ordering is total and stable across runs.
    """
    query_norm = math.sqrt(sum(v * v for v in query))
    scored = []
    for key, vector in vectors.items():
        norm = math.sqrt(sum(v * v for v in vector))
        if norm == 0.0 or query_norm == 0.0:
            scored.append((-1.0, key))
            continue
        dot = sum(a * b for a, b in zip(query, vector, strict=True))
        scored.append((dot / (norm * query_norm), key))
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [key for _score, key in scored]


def _mean(values: list[float]) -> float:
    """Mean across cases; an empty set scores 0 rather than NaN — the TS rule."""
    return sum(values) / len(values) if values else 0.0


def score_configurations(rows: list[dict], k: int = 3) -> list[dict]:
    """Score every configuration on the same cases. ``evaluateRetrieval``'s job.

    All four are reported, including the two single-arm baselines, because
    "fused scores 0.59" is not a result — "fused scores 0.59 where the
    description arm alone scores 0.71" is one, and it is the sentence this
    whole tool was built to be able to say out loud.

    The ``k = 10`` row is the TS file's ablation, kept for its reason: if the
    fusion constant were doing the work, the fusion would be a tuned parameter
    wearing a citation. Here it also answers a narrower question — whether the
    image arm's poor showing is an artefact of 60 being too flat to let a good
    second ranking move anything.
    """
    configurations = [
        ("description only", lambda row: row["description"]),
        ("image only (CLIP)", lambda row: row["image"]),
        ("fused (RRF)", lambda row: [
            d["id"] for d in reciprocal_rank_fusion(row["description"], row["image"])
        ]),
        ("fused (RRF, k=10)", lambda row: [
            d["id"] for d in reciprocal_rank_fusion(row["description"], row["image"], 10)
        ]),
    ]
    scores = []
    for configuration, rank in configurations:
        scores.append({
            "configuration": configuration,
            "ndcg": _mean([ndcg_at(rank(r), set(r["relevant"]), k) for r in rows]),
            "mrr": _mean([reciprocal_rank(rank(r), set(r["relevant"])) for r in rows]),
            "recall": _mean([recall_at(rank(r), set(r["relevant"]), k) for r in rows]),
        })
    return scores
