"""The BM25 arm, tested as arithmetic rather than as a search.

Every assertion here runs against literal candidate rows. There is no database,
no Supabase and no network — not as a convenience but because that is what the
module IS: `rank_candidates` is a pure function of a query and a candidate set,
which is the property that makes the ranking model auditable at all. A test
needing a live index would be a test that does not run in CI, and CI is
network-free by construction.

Two families of property. First, that the maths is Okapi BM25 and not something
that merely counts words: saturation (the fifth occurrence of a term is worth
far less than the first), length normalisation (a short document is not beaten
by a long one padded with the same term), and an IDF that is floored rather than
allowed to go negative on a term most of the corpus contains.

Second, the refusals. An empty corpus, an empty query and a query whose every
term is universal are all NORMAL states and none of them may raise. "Could not
score" and "nothing scored" are different facts, and the report shape must let a
caller tell them apart from fields alone — never by reading `detail`.

There is no `settings` stub here, and that is deliberate: the module imports no
configuration, so there is no frozen dataclass to swap for a `SimpleNamespace`.
`test_the_module_reads_no_settings` is what holds that open.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from modules import research_bm25 as bm25


def _doc(doc_id: str, body: str) -> dict[str, Any]:
    """One candidate row, shaped as `match_research_documents_hybrid` returns it."""
    return {"id": doc_id, "title": "", "body": body, "symbol": None, "strategy": None}


def _repeat(word: str, times: int) -> str:
    return " ".join([word] * times)


def _padding(count: int, length: int = 10) -> list[dict[str, Any]]:
    """Candidates holding none of the query's vocabulary.

    Not decoration. Document frequency is computed over the CANDIDATE SET, so a
    term present in half of a two-document set has its IDF floored at zero and
    every score collapses. Padding keeps df/N below a half, which is the regime
    BM25 is actually used in.
    """
    return [_doc(f"pad{index}", _repeat("filler", length)) for index in range(count)]


def _scores(report: dict[str, Any]) -> dict[str, float]:
    return {row["id"]: row["score"] for row in report["ranking"]}


#: Two documents of IDENTICAL length, one holding "sharpe" once and one five
#: times. Length is held constant on purpose so the only difference between them
#: is term frequency, and the saturation curve is what is being measured.
SATURATION = [
    _doc("once", "sharpe " + _repeat("filler", 9)),
    _doc("many", _repeat("sharpe", 5) + " " + _repeat("filler", 5)),
    *_padding(3),
]

#: The same term count, different lengths: 5 tokens against 30.
LENGTHS = [
    _doc("short", "sharpe " + _repeat("filler", 4)),
    _doc("long", "sharpe " + _repeat("filler", 29)),
    *_padding(3),
]

#: Every candidate contains every query term — the negative-IDF case.
UNIVERSAL = [_doc(f"all{index}", "sharpe ratio drawdown") for index in range(4)]


class TestSaturation:
    def test_more_occurrences_rank_higher(self):
        ranking = bm25.rank_candidates("sharpe", SATURATION)["ranking"]
        assert [row["id"] for row in ranking] == ["many", "once"]

    def test_the_gain_is_sublinear_which_is_the_whole_point(self):
        """Five occurrences must not be worth five times one.

        This is the ranking model `ts_rank_cd` does not have. Cover density
        grows with the number of covers, so under the existing sparse arm a
        keyword-stuffed document beats a document that simply says the thing.

        With every document at the average length the normaliser collapses to
        k1, so the ratio is exactly (5/(5+k1)) / (1/(1+k1)) = 1.774 at k1 = 1.2.
        Linear would be 5.0.
        """
        scores = _scores(bm25.rank_candidates("sharpe", SATURATION))
        ratio = scores["many"] / scores["once"]
        assert ratio == pytest.approx(1.774, abs=0.01)
        assert 1.0 < ratio < 2.0, "five occurrences bought more than a doubling"


class TestLengthNormalisation:
    def test_the_shorter_document_wins_on_the_same_term_count(self):
        ranking = bm25.rank_candidates("sharpe", LENGTHS)["ranking"]
        assert [row["id"] for row in ranking] == ["short", "long"], (
            "a document that says 'sharpe' once in five words is more about it "
            "than one that says it once in thirty"
        )

    def test_b_of_zero_turns_length_normalisation_off(self):
        """b = 0 is the `ts_rank_cd` behaviour: length ignored entirely.

        Asserted because it is the difference between the two lexical arms. With
        b = 0 the two documents tie, which is exactly the outcome BM25 exists to
        avoid at the default b = 0.75.
        """
        scores = _scores(bm25.rank_candidates("sharpe", LENGTHS, b=0.0))
        assert scores["short"] == pytest.approx(scores["long"])


class TestIdfNeverGoesNegative:
    def test_a_term_in_every_candidate_is_floored_at_zero(self):
        # The raw Robertson-Sparck Jones weight here is ln(0.5/4.5) = -2.2. Left
        # unclamped it would subtract from the four documents that contain the
        # term and promote any document that does not.
        assert math.log((4 - 4 + 0.5) / (4 + 0.5)) < 0
        assert bm25.idf(4, 4) == 0.0

    def test_no_pair_of_counts_produces_a_negative_weight(self):
        for count in range(1, 13):
            for frequency in range(0, count + 1):
                assert bm25.idf(count, frequency) >= bm25.IDF_FLOOR

    def test_a_query_of_universal_terms_is_reported_not_ranked(self):
        report = bm25.rank_candidates("sharpe drawdown", UNIVERSAL)
        assert report["ranked"] is False
        assert report["reason"] == bm25.REASON_NO_DISCRIMINATING_TERMS
        assert report["terms"] == 2
        assert report["discriminating_terms"] == 0
        assert report["ranking"] == []


class TestAbsenceIsReportedNeverRaised:
    def test_an_empty_corpus_is_reported(self):
        report = bm25.rank_candidates("sharpe ratio", [])
        assert report["ranked"] is False
        assert report["reason"] == bm25.REASON_EMPTY_CORPUS
        assert report["candidates"] == 0
        assert report["detail"], "a refusal with no sentence is a refusal nobody can act on"

    @pytest.mark.parametrize("query", ["", "   ", "the and of it", "!!! --- ???"])
    def test_a_query_with_no_usable_tokens_is_reported(self, query):
        report = bm25.rank_candidates(query, SATURATION)
        assert report["ranked"] is False
        assert report["reason"] == bm25.REASON_EMPTY_QUERY
        assert report["terms"] == 0
        assert report["candidates"] == len(SATURATION), (
            "the candidates were real; only the query was empty, and the report "
            "must not lose that"
        )

    def test_no_candidate_containing_a_query_term_is_a_different_reason(self):
        report = bm25.rank_candidates("quantum entanglement", SATURATION)
        assert report["ranked"] is False
        assert report["reason"] == bm25.REASON_NO_MATCHING_DOCUMENTS
        # The terms discriminated perfectly well — nothing had them. That is a
        # different fact from "the terms could not discriminate", and the
        # counters carry it without anyone parsing the sentence.
        assert report["terms"] == 2
        assert report["discriminating_terms"] == 2
        assert report["scored_documents"] == 0

    def test_could_not_score_and_nothing_scored_differ_by_a_field(self):
        could_not = bm25.rank_candidates("sharpe", [])
        nothing = bm25.rank_candidates("sharpe", UNIVERSAL)

        assert could_not["ranked"] is False and nothing["ranked"] is False
        # The whole distinction, read off fields and never off prose.
        assert could_not["candidates"] == 0 or could_not["terms"] == 0
        assert nothing["candidates"] > 0 and nothing["terms"] > 0
        assert nothing["scored_documents"] == 0
        assert could_not["reason"] != nothing["reason"]
        assert could_not["reason"] == bm25.REASON_EMPTY_CORPUS

        # And one shape for every state: a caller must not have to branch on the
        # keys present before it can branch on what happened.
        ranked = bm25.rank_candidates("sharpe", SATURATION)
        assert ranked["ranked"] is True and ranked["reason"] is None
        assert set(could_not) == set(nothing) == set(ranked)

    @pytest.mark.parametrize(
        ("candidates", "reason"),
        [
            ([_doc("only", "sharpe ratio")], bm25.REASON_NO_DISCRIMINATING_TERMS),
            ([_doc("a", ""), _doc("b", "   ")], bm25.REASON_NO_MATCHING_DOCUMENTS),
        ],
        ids=["single-document corpus", "textless corpus"],
    )
    def test_a_degenerate_corpus_does_not_divide_by_zero(self, candidates, reason):
        """Both denominators BM25 owns, driven to their edge.

        A one-document corpus puts df = N, which floors every IDF: with one
        document there is nothing to discriminate BETWEEN, and saying so is more
        honest than returning a ranking of one. A textless corpus puts the
        average document length at zero, which is the length normaliser's
        denominator — reported rather than fudged with a synthetic +1.
        """
        report = bm25.rank_candidates("sharpe", candidates)
        assert report["ranked"] is False
        assert report["reason"] == reason


class TestTokeniser:
    def test_unicode_and_punctuation_do_not_crash(self):
        tokens = bm25.tokenise("Naïve — café's «BTC/USDT» 20/100!!  ")
        assert tokens[:2] == ["naïve", "café"]
        assert {"btc", "usdt", "20", "100"} <= set(tokens)
        assert bm25.tokenise("— ¿? ‽ …") == []
        assert bm25.tokenise(None) == []

    def test_short_finance_tokens_survive(self):
        """A minimum-length rule would delete meaning from this corpus.

        `MIN_TOKEN_LENGTH` is 1 for exactly this: `20/100` is a parameter pair
        the desk searches for, and the usual `len > 2` rule deletes both halves.
        """
        assert bm25.MIN_TOKEN_LENGTH == 1
        tokens = set(bm25.tokenise("S&P 500 FX MA P&L 20/100"))
        assert {"s", "p", "l", "fx", "ma", "500", "20", "100"} <= tokens

    def test_stopwords_never_dominate_a_ranking(self):
        candidates = [
            _doc("stuffed", _repeat("the", 10)),
            _doc("real", "sharpe ratio and drawdown"),
            *_padding(3),
        ]
        report = bm25.rank_candidates("the sharpe", candidates)
        assert report["terms"] == 1, "'the' must not survive as a query term"
        assert [row["id"] for row in report["ranking"]] == ["real"], (
            "a document made entirely of stopwords matched nothing and must not "
            "be ranked at all"
        )


class TestDeterminism:
    def test_the_same_input_ranks_identically_twice(self):
        first = bm25.rank_candidates("sharpe filler", SATURATION)
        second = bm25.rank_candidates("sharpe filler", SATURATION)
        assert first == second

    def test_candidate_order_does_not_change_the_ranking(self):
        forwards = bm25.rank_candidates("sharpe", SATURATION)["ranking"]
        backwards = bm25.rank_candidates("sharpe", list(reversed(SATURATION)))["ranking"]
        assert forwards == backwards, (
            "the ranking must be a function of the candidates, not of the order "
            "the RPC happened to return them in"
        )
        # Equal scores are broken by id for the same reason.
        twins = [_doc("b", "sharpe ratio"), _doc("a", "sharpe ratio"), *_padding(3)]
        assert [r["id"] for r in bm25.rank_candidates("sharpe", twins)["ranking"]] == ["a", "b"]


class TestFusionJoinsOnIdenticalTerms:
    MATCHES = [
        {"id": "both", "vector_rank": 3, "lexical_rank": None},
        {"id": "dense_only", "vector_rank": 1, "lexical_rank": None},
    ]

    def test_a_document_two_arms_rank_beats_one_a_single_arm_ranks_first(self):
        """The point of a third arm, and the arithmetic that produces it."""
        report = {"ranking": [{"id": "both", "rank": 1, "score": 1.0}]}
        fused = bm25.fuse(self.MATCHES, report)

        assert bm25.RRF_K == 60, "the third arm must join on the migration's constant"
        assert [row["id"] for row in fused] == ["both", "dense_only"]
        assert fused[0]["fused_score"] == pytest.approx(1 / 63 + 1 / 61)
        assert fused[1]["fused_score"] == pytest.approx(1 / 61)

    def test_an_unranked_bm25_arm_is_none_and_costs_nothing(self):
        """A refused BM25 report must degrade to the two existing arms.

        NULL HONESTY: `bm25_rank` stays None. Coerced to 0 it would read as
        "better than first" in a 1-based ranking and invert the fusion.
        """
        refused = bm25.rank_candidates("", self.MATCHES)
        fused = bm25.fuse(self.MATCHES, refused)

        assert refused["ranked"] is False
        assert all(row["bm25_rank"] is None for row in fused)
        assert [row["id"] for row in fused] == ["dense_only", "both"]
        assert fused[0]["fused_score"] == pytest.approx(1 / 61)

    def test_bm25_can_reorder_the_candidates_but_never_add_one(self):
        report = {"ranking": [{"id": "ghost", "rank": 1, "score": 9.0}]}
        fused = bm25.fuse(self.MATCHES, report)
        assert [row["id"] for row in fused] == ["dense_only", "both"]
        assert "ghost" not in {row["id"] for row in fused}, (
            "the arm re-scores the candidate set; a document the hybrid search "
            "never returned cannot enter through the fusion"
        )


def test_the_module_reads_no_settings():
    """No configuration surface, so no frozen dataclass to swap in a test.

    `Settings` is frozen and the house rule is to substitute the whole object
    with a `SimpleNamespace` rather than monkeypatch a field. The better answer
    where it is available is the one taken here: a module that reads nothing
    needs no substitute, and its behaviour cannot drift with a deployment.
    """
    assert not hasattr(bm25, "settings")
