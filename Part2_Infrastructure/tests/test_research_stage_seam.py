"""The cross-encoder, pinned to the corrective path that calls it.

`tests/test_research_contract.py` says why this file is shaped the way it is:
two modules once shipped that did not meet, and the suite stayed green because
each side tested against a fiction of the other. `research_rerank` arrived with
twenty tests and NO caller. Every one of those proves the module; not one of
them could prove the wiring.

So the real `research_crag`, the real `research_stages` and the real
`research_rerank.rerank` run in every test here. Only the corpus and the ONNX
model are substituted — see `tests/research_seam.py` for exactly where and why.
The generator's half of the same seam is in
`tests/test_research_generation_seam.py`.

The first class is the one that matters most, and it is not about re-ranking at
all: an unconfigured desk must answer exactly as it did before this wiring
existed. The stage is optional, and optional means invisible when it is off.
"""

from __future__ import annotations

import pytest
import research_seam as seam
from research_seam import DECOY, IRRELEVANT, NEAR, NOW, QUERY, RELEVANT, STALE, Corpus, answer, row

from modules import research_crag as crag
from modules import research_rerank as rr
from modules import research_stages as stages


@pytest.fixture(autouse=True)
def unconfigured(monkeypatch):
    """The default deployment, restored before every test in this file."""
    seam.absent(monkeypatch)


@pytest.fixture
def reranker(monkeypatch):
    """A configured re-ranker with a scorer at `research_rerank`'s own boundary."""
    return seam.install_reranker(monkeypatch)


# --------------------------------------------------------------------------- #
# The regression guard: an unconfigured desk is unchanged
# --------------------------------------------------------------------------- #
class TestNeitherExtraConfigured:
    """The critical one. Both stages are optional, so off must mean invisible."""

    ROWS = [row(f"s-{i}") for i in range(3)]

    async def test_the_answer_is_what_the_grader_alone_would_have_produced(self):
        result = await answer(Corpus([self.ROWS]))

        # Graded again here, independently, against the rows in the order
        # retrieval returned them. If the wiring re-ordered, truncated or
        # dropped anything, these two come apart.
        expected = crag.ContextGrader().grade(QUERY, self.ROWS, now=NOW)
        assert result.state == "ok"
        assert result.score == round(expected.score, 4)
        assert result.band == expected.band
        assert result.reasons == list(expected.reasons)
        assert [m.id for m in result.matches] == [r["id"] for r in self.ROWS]
        assert result.retrievals == 1 and result.rewritten_query is None
        assert result.corpus_size == 412

    async def test_retrieval_still_asks_for_three_not_twenty(self):
        # `research_rerank`'s own argument: a wider net with nothing to sort it
        # out again buys recall and pays for it immediately in precision. The
        # width moves only when a re-ranker is there to do the sorting.
        corpus = Corpus([self.ROWS])
        await answer(corpus)
        assert corpus.widths == [3]

    async def test_the_fused_order_survives_unchanged_and_unscored(self):
        # The property the whole fallback exists for, at the seam that owns it.
        rows = [row(f"s-{i}") for i in range(5)]
        kept, report = await stages.narrow(QUERY, rows, 3)

        assert [d["source_ref"] for d in kept] == [r["source_ref"] for r in rows[:3]]
        assert report["reranked"] is False and report["state"] == "unconfigured"
        assert all(rr.SCORE_FIELD not in d for d in kept), (
            "a document the cross-encoder never saw must come back WITHOUT a score, "
            "not with a plausible-looking zero"
        )

    async def test_the_absence_is_reported_as_a_state_with_a_named_reason(self):
        result = await answer(Corpus([self.ROWS]))

        assert result.reranked is False
        assert result.rerank_state == "unconfigured", (
            "unconfigured must be distinguishable from unavailable and from failed "
            "by a FIELD, not by reading prose"
        )
        assert result.state == "ok" and result.refusal is None


# --------------------------------------------------------------------------- #
# Order is load-bearing: the grader must see the cross-encoder's pick
# --------------------------------------------------------------------------- #
class TestTheGraderSeesTheRerankedOrder:
    ROWS = [IRRELEVANT, RELEVANT]

    async def test_rrf_order_alone_refuses_this_query(self):
        result = await answer(Corpus([list(self.ROWS)]))
        assert result.state == "refused", "the baseline this class is a contrast to"
        assert result.matches == []

    async def test_the_same_rows_reranked_are_answered(self, reranker):
        corpus = Corpus([list(self.ROWS)])
        result = await answer(corpus)

        assert corpus.widths == [rr.RERANK_CANDIDATES], "wide, then narrowed"
        assert result.reranked is True and result.rerank_state == "reranked"
        assert result.state == "ok" and result.refusal is None
        assert [m.source_ref for m in result.matches] == ["sweep-1", "sourdough"]
        # `ContextGrader.grade` reads matches[0] as the best match, and this is
        # that row's similarity rather than the off-topic one's. A grade taken
        # before the re-rank would be the refusal in the test above — which is
        # the entire reason the two calls are in this order.
        assert result.reasons[1] == "closest match similarity 0.95"

    async def test_the_scored_rows_carry_the_score_the_encoder_gave_them(self, reranker):
        kept, report = await stages.narrow(QUERY, [dict(IRRELEVANT), dict(RELEVANT)], 3)
        assert report["reranked"] is True and report["model"] == rr.RERANK_MODEL
        assert [d[rr.SCORE_FIELD] for d in kept] == [2.0, 0.1]

    async def test_the_cross_encoder_never_runs_on_the_event_loop(self, reranker):
        await answer(Corpus([list(self.ROWS)]))
        assert reranker.calls, "the real rerank() never reached the encoder"
        assert not any(call["on_main_thread"] for call in reranker.calls), (
            "rerank() is CPU-bound and this loop also serves pre-trade risk checks; "
            "running it inline is milliseconds a risk decision waits for"
        )


# --------------------------------------------------------------------------- #
# The retry path is the second half of the same claim
# --------------------------------------------------------------------------- #
class TestTheRewriteRoundIsRerankedToo:
    async def test_both_rounds_are_scored_by_the_same_ranker(self, reranker):
        corpus = Corpus([NEAR, [DECOY, RELEVANT]])
        result = await answer(corpus, query="crossover sweep")

        assert result.retrievals == 2 and result.rewritten_query is not None
        assert corpus.widths == [rr.RERANK_CANDIDATES, rr.RERANK_CANDIDATES], (
            "a first round of twenty and a retry of three would grade two "
            "different candidate sets and compare the scores anyway"
        )
        assert len(reranker.calls) == 2, "the retry round was graded on RRF order"
        assert reranker.calls[1]["query"] == result.rewritten_query
        # The retry was kept, and it was kept on the cross-encoder's ordering.
        assert result.query == result.rewritten_query
        assert result.matches[0].source_ref == "sweep-1"

    async def test_the_rrf_order_would_have_discarded_that_retry(self):
        # The same two rounds with no re-ranker: the retry's best row is the
        # off-topic one, it grades worse than round one, and round one survives.
        # Which is the point — `retry_grade.score >= grade.score` is only
        # meaningful when both numbers came off the same scale.
        result = await answer(Corpus([NEAR, [DECOY, RELEVANT]]), query="crossover sweep")
        assert result.retrievals == 2 and result.query == "crossover sweep"
        assert result.matches[0].source_ref == "near-0"

    async def test_the_report_returned_is_the_kept_rounds(self, reranker):
        # The second round is worse, so round one survives — and so must the
        # report describing how round one was ordered.
        result = await answer(Corpus([[RELEVANT, IRRELEVANT], [STALE]]), query="crossover sweep")
        assert result.query == "crossover sweep", "the worse round must not be kept"
        assert result.reranked is True and result.rerank_state == "reranked"
