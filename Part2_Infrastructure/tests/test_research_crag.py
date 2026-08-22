"""The grader, tested on the three situations it exists to tell apart.

The corpus always returns its closest documents. A query about something the
desk has never traded comes back with three cards, ranked, looking exactly like
an answer — so these tests build that case explicitly and require a refusal.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from modules.research_crag import ContextGrader, Grade

NOW = datetime(2026, 8, 20, tzinfo=UTC)


def _match(**over):
    base = dict(
        title="Moving-average crossover 25/40 on BTCUSDT",
        body="Sweep of 74 combinations. Deflated Sharpe 0.29, verdict FAIL.",
        symbol="BTCUSDT", strategy="ma_crossover",
        similarity=0.86, vector_rank=1, lexical_rank=1,
        occurred_at=(NOW - timedelta(days=2)).isoformat(),
    )
    base.update(over)
    return base


def test_both_retrievers_agreeing_on_a_recent_close_match_answers():
    grade = ContextGrader().grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW)
    assert grade.band == "answer"
    assert grade.usable
    assert grade.score > 0.8


def test_a_query_the_corpus_knows_nothing_about_is_refused():
    # Dense-only hits, low similarity, no shared vocabulary, and old. This is
    # exactly what "three cards that look like an answer" is made of.
    stale = [
        _match(similarity=0.31, vector_rank=1, lexical_rank=None, symbol="ETHUSDT",
               strategy="rsi_reversion", title="RSI reversion on ETHUSDT",
               body="Unrelated run.", occurred_at=(NOW - timedelta(days=400)).isoformat()),
    ]
    grade = ContextGrader().grade("SOLUSDT funding basis carry", stale, now=NOW)
    assert grade.band == "refuse"
    assert not grade.usable
    assert grade.reasons, "a refusal must carry its reason"


def test_a_near_miss_asks_for_a_rewrite_rather_than_answering_or_refusing():
    near = [
        _match(similarity=0.62, vector_rank=1, lexical_rank=None,
               occurred_at=(NOW - timedelta(days=30)).isoformat()),
    ]
    grade = ContextGrader().grade("crossover sweep", near, now=NOW)
    assert grade.band == "rewrite"


def test_an_empty_result_is_a_refusal_with_its_own_reason():
    grade = ContextGrader().grade("anything", [], now=NOW)
    assert grade.band == "refuse"
    assert grade.score == 0.0
    assert "returned nothing" in grade.reasons[0]


def test_agreement_between_retrievers_outweighs_a_single_high_similarity():
    # The design claim, pinned: a document both indexes found beats one the
    # embedder alone liked, because the lexical half is what catches BTCUSDT
    # and an eight-character data_hash.
    dense_only = [_match(similarity=0.95, vector_rank=1, lexical_rank=None)]
    both = [_match(similarity=0.70, vector_rank=2, lexical_rank=3)]
    grader = ContextGrader()
    assert (grader.grade("BTCUSDT ma_crossover", both, now=NOW).score
            > grader.grade("BTCUSDT ma_crossover", dense_only, now=NOW).score)


def test_recency_is_the_weakest_signal():
    grader = ContextGrader()
    fresh = grader.grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW).score
    old = grader.grade(
        "BTCUSDT ma_crossover sweep",
        [_match(occurred_at=(NOW - timedelta(days=365)).isoformat())],
        now=NOW,
    ).score
    # It moves the score, but by no more than its 0.10 weight.
    assert 0.0 < fresh - old <= 0.10 + 1e-9


def test_an_unparseable_timestamp_is_treated_as_unknown_not_as_ancient():
    grade = ContextGrader().grade(
        "BTCUSDT ma_crossover sweep", [_match(occurred_at="not a date")], now=NOW,
    )
    assert "recency unknown" in grade.reasons[3]
    assert grade.band == "answer", "an unreadable date must not silently demote a good match"


def test_the_rewrite_adds_the_corpus_vocabulary_the_query_missed():
    # Not a paraphrase: the corpus's own tokens are the only thing that can
    # turn a near-miss into a hit, and they are what a first query omits.
    grader = ContextGrader()
    assert grader.rewrite("crossover sweep", [_match()]) == "crossover sweep BTCUSDT ma_crossover"


def test_the_rewrite_adds_nothing_when_the_query_already_names_them():
    grader = ContextGrader()
    query = "BTCUSDT ma_crossover sweep"
    assert grader.rewrite(query, [_match()]) == query


def test_the_rewrite_of_an_empty_result_is_the_original_query():
    assert ContextGrader().rewrite("anything", []) == "anything"


def test_the_bands_are_configurable_and_validated():
    # The default match scores 0.96 — both retrievers agreed, similarity 0.86,
    # every query term present, two days old. A band above that demotes it,
    # which is what makes the bands a policy rather than decoration.
    strict = ContextGrader(answer_band=0.98, refuse_band=0.5)
    grade = strict.grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW)
    assert grade.band == "rewrite", "a band above the score must demote the match"
    with pytest.raises(ValueError, match="bands must satisfy"):
        ContextGrader(answer_band=0.3, refuse_band=0.7)


def test_a_grade_is_a_value_not_a_boolean():
    grade = ContextGrader().grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW)
    assert isinstance(grade, Grade)
    assert 0.0 <= grade.score <= 1.0
    assert grade.band in {"answer", "rewrite", "refuse"}
    assert len(grade.reasons) == 4, "one line per weighted signal"


# --------------------------------------------------------------------------- #
# The fifth signal: the cross-encoder, folded in only when one ran
# --------------------------------------------------------------------------- #
class TestTheCrossEncoderScoreIsRead:
    """The grader read four signals off the retrieval and ignored the fifth.

    `research_rerank` writes ``rerank_score`` onto every row it scored — the
    one number in the pipeline produced by reading the query and the document
    TOGETHER — and `grade` never looked at it. It changed a grade only by
    changing which row happened to be first, which meant the most informative
    signal available was contributing through a side effect of sorting.

    The other half of this, and the half that must never break: a desk with no
    re-ranker configured is the DEFAULT deployment, and its numbers may not
    move by a decimal.
    """

    def test_a_row_no_cross_encoder_scored_grades_exactly_as_it_always_did(self):
        grade = ContextGrader().grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW)
        assert grade.score == pytest.approx(0.963889, abs=5e-7), (
            "the unreranked arithmetic is 0.40 agreement + 0.25 similarity + "
            "0.25 overlap + 0.10 recency and nothing else; a fold that touched "
            "it would move every grade on every desk that never asked for one"
        )
        assert len(grade.reasons) == 4, "no fifth signal was read, so none is claimed"

    #: A document both retrievers found, recent and close in the embedding
    #: space, that happens to share only one of the query's three terms — it
    #: names neither the symbol nor the strategy in its own words. Vocabulary
    #: overlap is what drags it under the answer band, and a paraphrase is
    #: precisely what a cross-encoder is better at than a token count.
    PARAPHRASE = dict(
        symbol=None, strategy=None,
        title="Parameter sweep of the trend rule",
        body="Twenty-five combinations, deflated.",
    )

    def test_a_confident_cross_encoder_lifts_a_mid_band_grade_over_the_answer_band(self):
        grader = ContextGrader()
        before = grader.grade(
            "BTCUSDT ma_crossover sweep", [_match(**self.PARAPHRASE)], now=NOW,
        )
        after = grader.grade(
            "BTCUSDT ma_crossover sweep",
            [_match(**self.PARAPHRASE, rerank_score=4.0)],
            now=NOW,
        )

        assert before.band == "rewrite" and after.band == "answer", (
            "a cross-encoder that read the pair and called it relevant is the "
            "strongest evidence this pipeline produces; a mid-band grade it is "
            "confident about is exactly the grade it should decide"
        )
        assert after.score > before.score

    def test_a_dismissive_cross_encoder_demotes_a_grade_the_retrieval_liked(self):
        # It must be able to push DOWN, or it is not a signal, it is a bonus.
        # A document both retrievers found, recent and full of the query's own
        # words, that the cross-encoder says does not answer the question, is
        # the "three cards that look like an answer" case one step further in.
        grader = ContextGrader()
        default = grader.grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW)
        dismissed = grader.grade(
            "BTCUSDT ma_crossover sweep", [_match(rerank_score=-6.0)], now=NOW,
        )
        assert default.band == "answer" and dismissed.band != "answer"

    def test_the_fold_can_never_move_a_grade_by_more_than_its_weight(self):
        # A quarter, bounded on both sides. The other four signals are read off
        # the row and a reader can check them; this one is a model's opinion,
        # so it decides borderline cases and never carries a document alone.
        grader = ContextGrader()
        base = grader.grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW).score
        for logit in (-40.0, -6.0, 0.0, 6.0, 40.0):
            folded = grader.grade(
                "BTCUSDT ma_crossover sweep", [_match(rerank_score=logit)], now=NOW,
            ).score
            assert abs(folded - base) <= 0.25 + 1e-9, logit
            assert 0.0 <= folded <= 1.0

    def test_a_null_score_is_not_a_zero_score(self):
        # `research_rerank` leaves the key ABSENT rather than writing a null,
        # and this is the belt to that brace: a null that arrived anyway is a
        # measurement that was not taken, so the grade is the one the four
        # retrieval signals earned — never a confident dismissal.
        grader = ContextGrader()
        absent = grader.grade("BTCUSDT ma_crossover sweep", [_match()], now=NOW)
        nulled = grader.grade(
            "BTCUSDT ma_crossover sweep", [_match(rerank_score=None)], now=NOW,
        )
        assert nulled.score == absent.score and nulled.reasons == absent.reasons

    def test_the_reason_is_appended_so_the_other_four_keep_their_places(self):
        grade = ContextGrader().grade(
            "BTCUSDT ma_crossover sweep", [_match(rerank_score=2.0)], now=NOW,
        )
        assert len(grade.reasons) == 5
        assert "days old" in grade.reasons[3], (
            "a caller reading reasons[3] for recency must not find a signal "
            "there that is absent on most deployments"
        )
        assert "cross-encoder" in grade.reasons[4] and "88%" in grade.reasons[4], (
            "the reason must carry the model's own calibrated number, or a "
            "refusal cannot be argued with"
        )
