"""Two arms, two widths — and both of them measured at the corpus.

`research_stages.wide` is the retrieve-wide half of retrieve-wide-then-narrow,
and it had two defects that a test asserting `widths == [20]` could not see.

**It was not a widening at the top of the range.** It returned
`RERANK_CANDIDATES` outright, so a request that already asked for twenty
documents was "widened" to the twenty it asked for and then narrowed to twenty
— the cross-encoder re-ordering exactly the rows it was going to keep, with
"retrieve twenty, keep three" written in every document describing the stage.
The tests below assert the RELATION between what was asked and what was
fetched, at several request sizes, rather than one number at one size.

**And it widened an arm nothing narrows.** The router applies a single
`match_count` to every tool in a plan, so on a re-ranking deployment
`graph_traverse` also asked for twenty neighbours — a different list, which the
cross-encoder never sees and nothing else truncates. `research_stages` used to
say so in a docstring and call the fix owed. This file is where it stops being
owed: the graph arm's width is measured separately from the search arm's, on
the same request, through the real `answer_from_corpus`.
"""

from __future__ import annotations

import pytest
import research_seam as seam
from research_seam import NEAR, Corpus, answer, row

from modules import research_rerank as rr
from modules import research_stages as stages

#: A causal query: `RuleBasedPlanner` routes "after" to `graph_traverse` and
#: hybrid search always runs, so one request exercises both arms at once.
CAUSAL_QUERY = "what happened after the BTCUSDT ma_crossover drawdown sweep"
STRONG = [row(f"s-{i}") for i in range(3)]

NEIGHBOUR = {
    "id": "22222222-0000-0000-0000-000000000001",
    "kind": "risk_incident", "source_ref": "ord-9", "symbol": "BTCUSDT",
    "strategy": "ma_crossover", "occurred_at": "2026-08-19T00:00:00+00:00",
    "title": "Execution anomaly", "depth": 1,
    "arrived_by": "shares_data_hash", "evidence": "8e43f5f7",
}


@pytest.fixture(autouse=True)
def unconfigured(monkeypatch):
    seam.absent(monkeypatch)


@pytest.fixture
def reranker(monkeypatch):
    return seam.install_reranker(monkeypatch)


# --------------------------------------------------------------------------- #
# The arithmetic
# --------------------------------------------------------------------------- #
class TestTheSearchArmIsGenuinelyWidened:
    def test_an_unconfigured_desk_asks_for_exactly_what_it_asked_for(self):
        # The optional stage is off, so nothing narrows, so nothing widens.
        # Not "about the same" — the same integer, at every size.
        assert [stages.wide(n) for n in (1, 3, 7, 20, 200)] == [1, 3, 7, 20, 200]

    def test_the_default_request_still_asks_for_the_documented_twenty(self, reranker):
        # `RERANK_CANDIDATES` is the floor and the width the latency estimate in
        # `research_rerank` was written for; a `match_count=3` request must keep
        # landing on it or that estimate describes a batch nobody runs.
        assert stages.wide(3) == rr.RERANK_CANDIDATES

    def test_a_request_at_the_top_of_the_range_is_widened_rather_than_matched(self, reranker):
        # THE DEFECT, in one line. This returned 20 for a 20-document request:
        # twenty fetched, twenty kept, a cross-encoder with nothing to promote.
        assert stages.wide(20) == 60
        assert stages.wide(20) > 20

    def test_every_request_size_fetches_more_than_it_keeps(self, reranker):
        # The property the stage exists for, asserted as a property rather than
        # as a table of numbers: below the ceiling, the net is always wider
        # than the catch, so the cross-encoder always has something to promote.
        for requested in range(1, stages.MAX_CANDIDATES // stages.WIDEN_FACTOR + 1):
            assert stages.wide(requested) > requested, requested

    def test_the_widening_is_bounded(self, reranker):
        # `match_count` arrives on an HTTP request and the cost of a batch is
        # linear in it. The multiple is capped, so a large request cannot buy
        # an unbounded slice of the CPU this process shares with the risk path.
        assert stages.wide(1_000) <= max(1_000, stages.MAX_CANDIDATES)
        assert stages.wide(40) == stages.MAX_CANDIDATES

    def test_a_request_wider_than_the_ceiling_is_never_narrowed_by_it(self, reranker):
        # The ceiling bounds the WIDENING, never the request. Returning 60 for
        # a 200-document request would serve sixty rows and call them the top
        # two hundred, which is a worse defect than the one being fixed.
        assert stages.wide(200) >= 200

    def test_the_width_never_falls_as_the_request_grows(self, reranker):
        widths = [stages.wide(n) for n in range(1, 80)]
        assert widths == sorted(widths), "a bigger request must not fetch fewer rows"


class TestTheGraphArmHasItsOwnWidth:
    def test_the_graph_width_is_the_callers_own_count(self):
        # Not widened at all, and not widened less: nothing narrows the graph
        # arm, so every neighbour it asks for is one the caller is served.
        assert [stages.graph_width(n) for n in (1, 3, 20)] == [1, 3, 20]

    def test_an_unconfigured_desk_is_handed_the_corpus_itself(self):
        # Nothing widened, so there is nothing to pin back — and the strongest
        # available form of "this stage is invisible when it is off" is that the
        # default deployment does not even get a wrapper.
        corpus = Corpus([STRONG])
        assert stages.with_graph_width(corpus, 3) is corpus

    def test_the_wrapper_passes_everything_else_through_untouched(self, reranker):
        corpus = Corpus([STRONG])
        pinned = stages.with_graph_width(corpus, 3)

        assert pinned is not corpus
        assert pinned.corpus_size == 412, (
            "this stands in for a corpus object this module does not own; an "
            "attribute it forgets to delegate is a production AttributeError"
        )


# --------------------------------------------------------------------------- #
# Measured at the corpus, on the real path
# --------------------------------------------------------------------------- #
class TestBothWidthsReachTheCorpus:
    async def test_an_unconfigured_desk_asks_both_arms_for_the_same_count(self):
        corpus = Corpus([STRONG], connected=[NEIGHBOUR])
        result = await answer(corpus, query=CAUSAL_QUERY)

        assert result.state == "ok" and len(result.connected) == 1
        assert corpus.widths == [3] and corpus.graph_widths == [3], (
            "with nothing to narrow either arm, today's number is the right "
            "number for both"
        )

    async def test_a_reranking_desk_widens_the_search_arm_and_not_the_graph_arm(self, reranker):
        corpus = Corpus([STRONG], connected=[NEIGHBOUR])
        result = await answer(corpus, query=CAUSAL_QUERY)

        assert result.reranked is True, "the re-ranker must actually have run"
        assert corpus.widths == [rr.RERANK_CANDIDATES], "wide, because something narrows it"
        assert corpus.graph_widths == [3], (
            "the graph arm asked for twenty neighbours on this deployment and "
            "nothing narrowed them: a different list, which the cross-encoder "
            "never sees, widened for a reason that does not apply to it"
        )
        assert len(result.connected) == 1

    async def test_the_rewrite_round_keeps_both_widths(self, reranker):
        # The retry is a second `router.execute`, and a width applied on one
        # call site and forgotten on the other is exactly the kind of defect
        # that hides behind a passing first round.
        corpus = Corpus([NEAR, STRONG], connected=[NEIGHBOUR])
        result = await answer(corpus, query="what happened after the crossover sweep")

        assert result.retrievals == 2, "the mid-band rewrite must have fired"
        assert corpus.widths == [rr.RERANK_CANDIDATES, rr.RERANK_CANDIDATES]
        assert corpus.graph_widths == [3, 3]
