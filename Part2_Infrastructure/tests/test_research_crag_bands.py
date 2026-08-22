"""Where the CRAG bands actually fall, measured against the committed fixture.

test_research_crag.py checks the grader's LOGIC on hand-built rows. This checks
its CALIBRATION on the same golden cases lib/retrieval-eval.ts scores, so the
band edges are a measurement rather than two numbers someone liked.

One fixture, one grader. The cases live in
``web/tests/fixtures/retrieval-golden.json`` and are read from here rather than
copied, because two divergent copies of an answer key is how a calibration
quietly stops describing the thing it was calibrated on.

WHAT THIS CAN AND CANNOT MEASURE
--------------------------------

The fixture records rankings, not cosine similarities — it was built to score
the FUSION of two orderings, which is all lib/retrieval-eval.ts needs. So
`similarity` is held constant across every case here and `occurred_at` is left
absent (which the grader reads as unknown, weight 1.0). Both then contribute
identically to every case and cancel out of the comparison.

That leaves agreement (0.40) and vocabulary overlap (0.25) — 65 % of the
grader's weight — driving the ordering, which is exactly the half the fixture
was built to exercise. Stated rather than glossed: this measures the ordering
those two produce, not an absolute score anyone should quote.

WHAT IT MEASURED, 2026-08-20
----------------------------

    0.925  answer   BTCUSDT drawdown
    0.792  rewrite  risk incident breaker
    0.575  rewrite  supertrend equity backtest
    0.408  rewrite  job 7f3a91
    0.275  refuse   bitcoin moving average crossover results
    0.275  refuse   strategies that lost money

The bands separate the fixture's own strong and weak cases, which is the
property being checked. What `rewrite` COSTS changed after this table was
measured and the numbers did not: a mid-band case now buys one rewrite and is
then answered or refused on what that second query returned, where it used to
be served regardless. So the four `rewrite` rows above are cases whose verdict
depends on a second retrieval this fixture does not model — the calibration
they pin is the grade, and `tests/test_research_crag_policy.py` is where the
verdict is pinned. Two things in that table are worth saying out loud
rather than leaving for someone to notice later.

**The dense-only cases are understated here, by construction.** "bitcoin
moving average crossover results" is a paraphrase whose relevant document IS
reachable — dense ranks it first — and it lands in `refuse`. That is the
constant `similarity` talking: with agreement worth 0.40 and every case given
the same middling cosine, a genuine dense-only hit cannot distinguish itself.
In production it would, because a strong dense hit carries a high similarity
and this fixture has none to give. So these figures are a floor for
dense-only retrieval, not a verdict on it.

**"job 7f3a91" sits at 0.408, a hair above the refuse line.** It is the case
the fixture keeps to justify hybrid retrieval at all — lexical finds the
identifier immediately where the subword tokeniser shreds it. Grading it
`rewrite` is the right call (one rewrite adding the corpus's own vocabulary is
cheap), but it is close enough to the edge that a change to the weights should
re-read this table rather than assume it still holds.
"""

from __future__ import annotations

import json
from pathlib import Path

from modules.research_crag import ContextGrader

GOLDEN = (
    Path(__file__).resolve().parents[1]
    / "web" / "tests" / "fixtures" / "retrieval-golden.json"
)

#: Held constant — see the module docstring. 0.7 is unremarkable for gte-small
#: on a real hit and, being identical for every case, cannot tilt the ordering.
FIXED_SIMILARITY = 0.7


def _fixture() -> dict:
    return json.loads(GOLDEN.read_text())


def _matches(case: dict, documents: dict[str, str]) -> list[dict]:
    """The fixture's two rankings, fused into the rows the grader reads."""
    vector = {doc: i + 1 for i, doc in enumerate(case["vectorRanking"])}
    lexical = {doc: i + 1 for i, doc in enumerate(case["lexicalRanking"])}
    order = list(case["vectorRanking"]) + [d for d in case["lexicalRanking"] if d not in vector]
    return [
        {
            "title": documents.get(doc, ""),
            "body": documents.get(doc, ""),
            "symbol": None,
            "strategy": None,
            "similarity": FIXED_SIMILARITY,
            "vector_rank": vector.get(doc),
            "lexical_rank": lexical.get(doc),
            "occurred_at": None,
        }
        for doc in order
    ]


def _scored() -> dict[str, float]:
    data = _fixture()
    grader = ContextGrader()
    return {
        case["query"]: grader.grade(case["query"], _matches(case, data["documents"])).score
        for case in data["cases"]
    }


def test_the_fixture_is_reachable_and_has_the_cases_it_is_meant_to():
    # Guards the path: a rename would otherwise make every assertion below pass
    # by scoring nothing at all.
    data = _fixture()
    assert len(data["cases"]) >= 6
    assert len(data["documents"]) >= 8


def test_the_case_both_retrievers_answer_scores_above_the_case_neither_does():
    # The fixture's own notes say so. "BTCUSDT drawdown" is where lexical
    # matches the ticker and dense reaches a report that never uses the word;
    # "strategies that lost money" is kept BECAUSE neither retriever is good at
    # it — 'lost money' appears nowhere and the negative Sharpe is a number.
    scores = _scored()
    assert scores["BTCUSDT drawdown"] > scores["strategies that lost money"], (
        f"the grader ranks a known-weak case at or above a known-strong one: {scores}"
    )


def test_an_exact_identifier_found_by_both_beats_a_paraphrase_only_dense_reaches():
    # "job 7f3a91" — lexical finds it immediately, dense ranks it fourth; the
    # agreement is the signal. "bitcoin moving average crossover results" is a
    # paraphrase where lexical returns nothing at all.
    scores = _scored()
    assert scores["job 7f3a91"] > scores["bitcoin moving average crossover results"]


def test_a_case_no_retriever_agrees_on_does_not_reach_the_answer_band():
    # The band that matters. If a query neither retriever handles still scored
    # above 0.8, the grader would be waving through exactly the retrieval it
    # exists to catch.
    grader = ContextGrader()
    data = _fixture()
    weak = next(c for c in data["cases"] if c["query"] == "strategies that lost money")
    grade = grader.grade(weak["query"], _matches(weak, data["documents"]))
    assert grade.band != "answer", f"a case with no agreement graded {grade.band} at {grade.score:.3f}"


def test_the_measured_spread_is_wide_enough_for_the_bands_to_mean_something():
    # Two bands need three regions to separate. If every golden case scored
    # within a few points of the others, 0.4 and 0.8 would be arbitrary lines
    # through one cluster and this whole mechanism would be decoration.
    scores = _scored()
    spread = max(scores.values()) - min(scores.values())
    assert spread > 0.15, f"only {spread:.3f} between the best and worst case: {scores}"


def test_every_golden_case_grades_without_raising():
    # Cheap, and it covers the shapes the hand-built tests do not: an empty
    # lexical ranking, a single-document ranking, and multi-document relevance.
    for query, score in _scored().items():
        assert 0.0 <= score <= 1.0, query
