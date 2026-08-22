"""The three bands, as they actually run — one test per branch of the policy.

`test_research_crag.py` tests the grader's arithmetic on hand-built rows and
`test_research_crag_bands.py` tests where the band edges fall on the golden
fixture. Neither could catch what was wrong here, because what was wrong was
not the grade: it was that the grade did not decide anything. One line gated
the whole path —

    refused = grade.score < grader.refuse_band

— so ``ANSWER_BAND`` was a constructor default that nothing read, and a
mid-band retrieval was served with ``state: "ok"`` whether its rewrite had
improved it, made it worse, or never happened at all. Every document in this
repository described a three-band policy and one band was doing the work.

So these tests run the REAL `answer_from_corpus` over the seam's fake corpus
and assert on the VERDICT rather than on the score: which state came back, how
many round trips were spent, and what the refusal says. The corpus is the only
thing substituted — `tests/research_seam.py` says exactly where and why.

This file is where the behaviour change is written down. A mid-band result that
does not clear the answer band after its one rewrite now REFUSES.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import research_seam as seam
from research_seam import (
    IRRELEVANT,
    NEAR,
    NOW,
    QUERY,
    RELEVANT,
    STALE,
    Corpus,
    answer,
    off_topic,
    row,
)

from modules import research_crag_signals
from modules.research_crag import ANSWER_BAND, REFUSE_BAND, ContextGrader

#: Three documents both retrievers found, recent, every query term present.
#: Grades 0.99 — the answer band, with no argument about it.
STRONG = [row(f"s-{i}") for i in range(3)]
STRONG_QUERY = "BTCUSDT ma_crossover drawdown sweep"

#: A near miss: both retrievers agree but similarity is middling and the query
#: uses none of the corpus's own vocabulary. Grades 0.76 — the middle band —
#: and its best match names a symbol and a strategy the query does not, so the
#: rewrite has something to add and fires.
MID_QUERY = "crossover sweep"

#: What the rewritten query finds when the rewrite works: three agreeing rows
#: that carry the added tokens. Grades 0.92.
AFTER_REWRITE = [row(f"hit-{i}") for i in range(3)]

#: A second round that is BETTER than the near miss and still not good enough:
#: both retrievers agree and it carries the rewritten query's added tokens, but
#: it is four hundred days old and its similarity is middling. Grades 0.79,
#: which is one point of relevance below the answer band and still a refusal.
IMPROVED = [row(
    "later", similarity=0.81, vector_rank=1, lexical_rank=1,
    occurred_at=(NOW - timedelta(days=400)).isoformat(),
)]

#: A mid-band round whose best match ALREADY names everything the query does.
#: `rewrite` returns the query unchanged here, so there is no second attempt to
#: decide on — the branch the old code could not reach and the new code must
#: still refuse rather than answer on.
UNREWRITABLE = [row("solo", similarity=0.95, vector_rank=1, lexical_rank=None)]


@pytest.fixture(autouse=True)
def unconfigured(monkeypatch):
    """Neither optional extra configured: the default deployment.

    The policy is not an optional extra and must be visible without one, so
    every test here runs on the desk as it ships.
    """
    seam.absent(monkeypatch)


# --------------------------------------------------------------------------- #
# The two bands that were already decided, unchanged
# --------------------------------------------------------------------------- #
async def test_a_grade_above_the_answer_band_is_served_without_a_rewrite():
    corpus = Corpus([STRONG])
    result = await answer(corpus, query=STRONG_QUERY)

    assert result.state == "ok" and result.band == "answer"
    assert result.score > ANSWER_BAND
    assert [m.source_ref for m in result.matches] == [r["source_ref"] for r in STRONG]
    assert result.retrievals == 1 and result.rewritten_query is None
    assert len(corpus.queries) == 1, "a strong result must not pay for a rewrite"


async def test_a_grade_below_the_refuse_band_refuses_without_spending_a_rewrite():
    corpus = Corpus([[off_topic("sour")]])
    result = await answer(corpus, query=STRONG_QUERY)

    assert result.state == "refused" and result.band == "refuse"
    assert result.score < REFUSE_BAND
    assert result.matches == [], "a refusal does not hand back the rows it refused"
    assert len(corpus.queries) == 1, "a result that is not close does not earn a rewrite"
    assert "relevance floor" in result.refusal and "0.40" in result.refusal
    assert "412 indexed documents were searched" in result.refusal, (
        "the denominator is what separates a statement about the query from a "
        "statement about the corpus"
    )
    assert "not an empty corpus" in result.refusal


# --------------------------------------------------------------------------- #
# The middle band, which is the one that was not implemented
# --------------------------------------------------------------------------- #
class TestTheMiddleBandDecidesOnTheSecondAttempt:
    async def test_a_rewrite_that_clears_the_answer_band_is_answered(self):
        corpus = Corpus([NEAR, AFTER_REWRITE])
        result = await answer(corpus, query=MID_QUERY)

        assert corpus.queries == [MID_QUERY, "crossover sweep BTCUSDT ma_crossover"]
        assert result.retrievals == 2
        assert result.state == "ok" and result.band == "answer"
        assert result.query == result.rewritten_query, "the answer names the query it answered"
        assert [m.source_ref for m in result.matches] == [r["source_ref"] for r in AFTER_REWRITE]

    async def test_a_rewrite_that_does_not_clear_it_refuses(self):
        # THE BEHAVIOUR CHANGE. Round one grades 0.76, the rewrite fires, the
        # second round grades 0.08 and is discarded, and round one's 0.76 is
        # exactly the situation the old code served as `state: "ok"` with
        # `band: "rewrite"` — an answer built on retrieval the grader had
        # already said was not good enough to answer from.
        corpus = Corpus([NEAR, [STALE]])
        result = await answer(corpus, query=MID_QUERY)

        assert len(corpus.queries) == 2, "the rewrite must still be spent"
        assert result.retrievals == 2 and result.rewritten_query is not None
        assert result.state == "refused"
        assert result.band == "rewrite", (
            "the band still reports where the grade fell; it is the VERDICT that "
            "changed, and flattening the two would lose why this refused"
        )
        assert result.matches == [] and result.connected == []
        assert REFUSE_BAND < result.score < ANSWER_BAND, (
            "the score is still reported: a caller that wants to show how close "
            "this came has the number"
        )

    async def test_the_refusal_names_the_rewrite_it_spent(self):
        result = await answer(Corpus([NEAR, [STALE]]), query=MID_QUERY)

        assert "crossover sweep BTCUSDT ma_crossover" in result.refusal, (
            "a refusal that spent a second query must say what it asked, or the "
            "reader cannot tell it apart from one that never tried"
        )
        assert "0.40-0.80 band" in result.refusal
        assert "not an empty corpus" in result.refusal and "not a search that failed" in result.refusal
        assert any(reason in result.refusal for reason in result.reasons)
        assert "relevance floor" not in result.refusal, (
            "this did not fall below the floor; saying so would describe the "
            "wrong finding to whoever reads it"
        )

    async def test_a_mid_band_result_with_nothing_to_rewrite_refuses_and_says_so(self):
        # The branch with no second attempt at all: the closest match names the
        # symbol and the strategy the query already used, so a second query
        # would ask the identical question. It must not be spent, and the
        # refusal must not claim a rewrite that never happened.
        corpus = Corpus([UNREWRITABLE])
        result = await answer(corpus, query=STRONG_QUERY)

        assert len(corpus.queries) == 1, "an identical re-query is a round trip for nothing"
        assert result.retrievals == 1 and result.rewritten_query is None
        assert result.state == "refused" and result.band == "rewrite"
        assert "No rewrite was spent" in result.refusal
        assert "would have asked the same question" in result.refusal


class TestTheRewriteBudgetIsStructurallyOne:
    async def test_a_third_round_is_never_retrieved_even_when_it_would_have_won(self):
        # Three rounds are on offer and the THIRD is the one that would have
        # answered. It is never asked for. The bound is not a counter somebody
        # could raise — `rewrite_once` is called under one `if` and contains no
        # loop — and this is the observable half of that claim: the query ends
        # in a refusal with a perfectly good round sitting unreached behind it.
        corpus = Corpus([NEAR, [STALE], AFTER_REWRITE])
        result = await answer(corpus, query=MID_QUERY)

        assert len(corpus.queries) == 2, f"the loop ran {len(corpus.queries)} times"
        assert result.retrievals == 2
        assert result.state == "refused", (
            "two rounds end the query; a third attempt is the corrective loop "
            "this path refused to become"
        )

    async def test_the_better_of_the_two_rounds_is_the_one_reported(self):
        # The retry improves things without clearing the band. It is still the
        # round that gets reported, because it is the better evidence — and the
        # verdict is still a refusal, because better is not enough.
        corpus = Corpus([NEAR, IMPROVED])
        result = await answer(corpus, query=MID_QUERY)

        assert result.state == "refused"
        assert result.query == result.rewritten_query
        assert result.score == 0.79, (
            "0.79 is the retry's grade and 0.76 is round one's; reporting the "
            "lower one would describe evidence the answer did not rest on"
        )
        assert "400 days old" in result.refusal, "and the retry's reasons with it"


# --------------------------------------------------------------------------- #
# ANSWER_BAND is now load-bearing, which is the whole defect in one test
# --------------------------------------------------------------------------- #
async def test_the_answer_band_decides_the_verdict_and_not_only_the_label():
    """The same rows, the same grade, two answer bands, two verdicts.

    Before this, `answer_band` moved the `band` STRING and nothing else: both
    of these returned `state: "ok"`. A constructor argument that cannot change
    what the caller is served is decoration, and this is the test that would
    have failed on the day it became decoration.
    """
    rows = [NEAR, [STALE]]
    strict = await answer(Corpus(list(rows)), query=MID_QUERY)
    lenient = await answer(
        Corpus(list(rows)), query=MID_QUERY, grader=ContextGrader(answer_band=0.5),
    )

    assert strict.state == "refused" and lenient.state == "ok"
    assert strict.score == lenient.score, "the arithmetic did not move; the policy did"
    assert lenient.band == "answer" and strict.band == "rewrite"


# --------------------------------------------------------------------------- #
# What a refusal costs downstream
# --------------------------------------------------------------------------- #
async def test_a_mid_band_refusal_never_reaches_the_generator():
    """`generation is None` means never ATTEMPTED, and that must stay true.

    A refusal that still spent a generation call would be paying a model to
    write over evidence CRAG had just rejected. `None` here is the fact that no
    attempt was made — a different fact from a report whose verdict is
    "refused", which is why the field is not flattened into `state`.
    """
    refused = await answer(Corpus([NEAR, [STALE]]), query=MID_QUERY)
    answered = await answer(Corpus([STRONG]), query=STRONG_QUERY)

    assert refused.generation is None
    assert answered.generation is not None, (
        "the generator is unconfigured here, so it reports its own absence — but "
        "it was REACHED, which is what tells this apart from the refusal above"
    )


# --------------------------------------------------------------------------- #
# The signal the grader was not reading, decided on the real path
# --------------------------------------------------------------------------- #
class TestTheCrossEncoderDecidesTheVerdict:
    """Wired, not merely implemented.

    `test_research_crag.py` proves the fold is arithmetic that works. This
    proves it reaches the verdict a caller is served, over the real
    `answer_from_corpus`, with `research_rerank` substituted only at the ONNX
    boundary it documents as its own test seam.

    The two rows are the case the cross-encoder exists for: an off-topic
    document fused first and the one that answers the question second. The
    re-ranker puts them in the right order, which is what the grader's four
    retrieval signals then read — and its own confidence is what carries the
    result across the answer band. Both halves have to be there.
    """

    ROWS = [IRRELEVANT, RELEVANT]

    @pytest.fixture
    def reranker(self, monkeypatch):
        return seam.install_reranker(monkeypatch)

    async def test_the_cross_encoders_confidence_carries_the_answer(self, reranker):
        result = await answer(Corpus([list(self.ROWS)]), query=QUERY)

        assert result.reranked is True and result.rerank_state == "reranked"
        assert result.state == "ok" and result.band == "answer"
        assert result.retrievals == 1, "nothing here needed a rewrite"
        assert any("cross-encoder" in reason for reason in result.reasons), (
            "the grade must say that it read the model's opinion, or a reader "
            "cannot tell which signals decided it"
        )

    async def test_without_the_fold_the_same_rows_and_the_same_order_refuse(
        self, reranker, monkeypatch,
    ):
        # The counterfactual, and the whole defect in one assertion. The
        # re-ranker still runs and still puts the relevant row first — the ONLY
        # thing removed is the grade reading its score — and the four retrieval
        # signals alone land at 0.79, inside the middle band, where the rewrite
        # has nothing to add because the query already names the symbol and the
        # strategy. So it refuses. That 0.79 is what the cross-encoder was
        # being asked about and not answered on.
        monkeypatch.setattr(research_crag_signals, "CROSS_ENCODER_WEIGHT", 0.0)
        result = await answer(Corpus([list(self.ROWS)]), query=QUERY)

        assert result.reranked is True, "the re-ranker still ran and still re-ordered"
        assert result.state == "refused" and result.band == "rewrite"
        assert result.retrievals == 1 and "No rewrite was spent" in result.refusal
