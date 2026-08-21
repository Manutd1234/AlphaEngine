"""`POST /api/research/rag/search`, pinned to the two arms it publishes.

Four modules landed in one day — the cross-encoder, the generator, Louvain and
Okapi BM25 — and every one of them arrived with a full suite and no caller. This
file is about the LAST seam two of them cross: the HTTP surface. A field the
route drops is invisible in exactly the way `tests/test_research_contract.py`
describes, because both sides can be perfect and still not meet. The community
sweep's own route is in `tests/test_research_communities_route.py`.

THE FIELD-DROP DEFECT, WHICH HAS ALREADY HAPPENED HERE ONCE. Pydantic ignores
unknown keys by default, so a score a module attaches to a row is discarded
silently on its way out of the route. `vector_rank` and `lexical_rank` were
returned by the RPC and thrown away by `ResearchRagSearchResponse` for exactly
this reason, and the symptom was identical to the hybrid RPC being absent: the
feature looked broken rather than unpublished. `rerank_score` and `bm25_rank`
are the same shape of mistake waiting to be made, so the assertions below read
the values off an HTTP response body rather than off a report.

What is substituted, and what may never be
------------------------------------------

The network, and nothing else. `ResearchRag`'s httpx client is a stub, because
CI has no network and a test that reached Supabase would be a test that never
runs. The cross-encoder is installed at `research_rerank._import_cross_encoder`,
the one function that module documents as its own test seam, so its caching, its
five states and its fallback are all the real thing.

Everything else is production code: the real `research_stages`, the real
`research_rerank.rerank`, the real `research_bm25` arithmetic and the real
response models. A test here that monkeypatched `narrow` or `apply_bm25` would
be proving the wiring against a fiction of itself.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import research_seam as seam
from fastapi.testclient import TestClient
from test_research_graph_reads import DESK

import main
import modules.research_rag.writer as rag_module
from modules import research_bm25
from modules import research_rerank as rr
from modules.research_rag import EMBEDDING_DIMENSIONS, get_rag, reset_rag
from modules.schemas_research import ResearchRagMatch

NOW = datetime.now(UTC)

#: Four rare terms. IDF is computed over the CANDIDATE SET, so a term carried by
#: half of four candidates is priced at zero and tells nothing apart — the
#: corpus below gives each term to exactly one document so the arm has something
#: to say. That is a property of a four-row fixture, not of the real corpus.
QUERY = "deflated sharpe drawdown sweep"


class _Settings:
    """`writer.py` is the package's only reader of `settings`."""

    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_test"
    research_rag_enabled = True
    supabase_desk_id = DESK
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 10


def document(
    ref: str,
    body: str,
    *,
    vector_rank: int | None,
    lexical_rank: int | None,
    similarity: float,
    strategy: str | None = None,
) -> dict:
    """One row shaped exactly as `match_research_documents_hybrid` returns it."""
    return {
        "id": f"11111111-0000-0000-0000-{ref:>012}",
        "kind": "backtest_run",
        "source_ref": ref,
        "symbol": "BTCUSDT",
        "strategy": strategy,
        "occurred_at": (NOW - timedelta(days=1)).isoformat(),
        "title": body[:60],
        "body": body,
        "metrics": {"sharpe": 1.1},
        "similarity": similarity,
        "vector_rank": vector_rank,
        "lexical_rank": lexical_rank,
    }


#: The corpus, in the order the RPC fuses it. The document that answers the
#: question is FOURTH, so a search narrowed to three never sees it at all: this
#: is the recall half of retrieve-wide-then-narrow, and it is the reason the
#: width and the re-rank have to be wired as one change or not at all.
#:
#: It carries none of the query's terms, so BM25 leaves it out of its ranking
#: too and the fused order keeps it last. The only thing in the system that can
#: promote it is a model that reads the query and the document TOGETHER — which
#: is the case `research_rerank` was written for.
CORPUS = [
    document("deflated", "Deflated Sharpe 0.29 over 74 combinations.",
             vector_rank=1, lexical_rank=1, similarity=0.95),
    document("drawdown", "Drawdown profile across the parameter sweep.",
             vector_rank=2, lexical_rank=2, similarity=0.91),
    document("slippage", "Execution slippage notes for the desk.",
             vector_rank=3, lexical_rank=3, similarity=0.88),
    document("pick", "Sourdough proofing schedule.",
             vector_rank=4, lexical_rank=None, similarity=0.80, strategy="ma_crossover"),
]
PICK = CORPUS[-1]["source_ref"]


class Reply:
    def __init__(self, payload, status_code: int = 200, headers=None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class Corpus:
    """The Supabase side of the wire, and nothing else.

    It SLICES to the `match_count` it was asked for, the way the SQL function
    does. A fake that ignored the width would hand every test the whole corpus
    and quietly delete the only claim retrieve-wide makes.
    """

    def __init__(self, rows=CORPUS, *, corpus_size=412, hybrid_status=200) -> None:
        self.rows = list(rows)
        self.corpus_size = corpus_size
        self.hybrid_status = hybrid_status
        self.widths: list[int] = []
        self.dense_widths: list[int] = []

    async def post(self, path, json=None, headers=None):  # noqa: A002 — httpx's kwarg
        if path.endswith("/embed-research"):
            return Reply({"embeddings": [[0.05] * EMBEDDING_DIMENSIONS for _ in json["texts"]]})
        if path.endswith("match_research_documents_hybrid"):
            if self.hybrid_status >= 300:
                return Reply(None, self.hybrid_status)
            self.widths.append(json["match_count"])
            return Reply(self.rows[: json["match_count"]])
        if path.endswith("match_research_documents"):
            self.dense_widths.append(json["match_count"])
            # The dense function states no ranks; that is what makes the third
            # arm decline on this path rather than fuse against a rank nobody
            # returned.
            return Reply([
                {k: v for k, v in row.items() if k not in ("vector_rank", "lexical_rank")}
                for row in self.rows[: json["match_count"]]
            ])
        raise AssertionError(f"unexpected POST {path}")

    async def head(self, path, params=None, headers=None):
        return Reply(None, headers={"content-range": f"0-0/{self.corpus_size}"})


@pytest.fixture(autouse=True)
def unconfigured(monkeypatch):
    """The default deployment: no cross-encoder, and no encoder cached from another test."""
    seam.absent(monkeypatch)


@pytest.fixture
def client():
    """No lifespan: no feeds, no bot, no drain task — just the routes."""
    return TestClient(main.app)


@pytest.fixture
def corpus(monkeypatch):
    reset_rag()
    monkeypatch.setattr(rag_module, "settings", _Settings())
    rag = get_rag()

    def _serve(**kw):
        stub = Corpus(**kw)
        rag._client = stub
        return stub

    yield _serve
    reset_rag()


@pytest.fixture
def reranker(monkeypatch):
    """A configured cross-encoder, installed at `research_rerank`'s own boundary."""
    return seam.install_reranker(monkeypatch)


def search(client, match_count: int = 3, query: str = QUERY) -> dict:
    response = client.post(
        "/api/research/rag/search", json={"query": query, "match_count": match_count},
    )
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------- #
# The cross-encoder reaches the route, at both ends
# --------------------------------------------------------------------------- #
class TestRetrieveWideThenNarrow:
    def test_the_index_is_asked_for_the_wide_candidate_set(self, client, corpus, reranker):
        stub = corpus()
        body = search(client, match_count=3)

        assert stub.widths == [rr.RERANK_CANDIDATES], (
            "the route asked for its own match_count; without the wider net the "
            "cross-encoder only ever re-orders what RRF already chose"
        )
        assert len(body["matches"]) == 3, "the caller asked for three and must get three"

    def test_the_cross_encoder_saw_every_candidate_the_wider_net_caught(self, client, corpus, reranker):
        corpus()
        search(client, match_count=3)

        assert len(reranker.calls) == 1
        assert len(reranker.calls[0]["documents"]) == len(CORPUS)

    def test_the_document_rrf_ranked_last_is_the_one_returned_first(self, client, corpus, reranker):
        corpus()
        body = search(client, match_count=3)

        assert [m["source_ref"] for m in body["matches"]][0] == PICK, (
            "the returned order is RRF's, so nothing the cross-encoder decided reached the wire"
        )

    def test_a_narrow_search_never_sees_that_document_at_all(self, client, corpus):
        """The same query with no re-ranker configured — the desk as it was.

        This is what the width buys, stated as a difference rather than as a
        claim: with `match_count=3` the RPC never returns the fourth row, so no
        amount of re-ordering downstream could have found it.
        """
        stub = corpus()
        body = search(client, match_count=3)

        assert stub.widths == [3]
        assert PICK not in [m["source_ref"] for m in body["matches"]]


# --------------------------------------------------------------------------- #
# The scores travel with the rows, or the re-ranker looks like it did nothing
# --------------------------------------------------------------------------- #
class TestTheScoreSurvivesTheResponseModel:
    def test_every_re_ranked_row_carries_the_score_that_ordered_it(self, client, corpus, reranker):
        corpus()
        body = search(client, match_count=3)

        scores = [m["rerank_score"] for m in body["matches"]]
        assert all(s is not None for s in scores), (
            f"{rr.SCORE_FIELD} was dropped between the module and the wire: {scores}"
        )
        assert scores == sorted(scores, reverse=True), "the order and the scores disagree"
        assert scores[0] > scores[1], "the promoted document must carry the score that promoted it"

    def test_an_unscored_row_is_null_and_never_zero(self, client, corpus):
        """No model configured: perfectly good fused rows, no scores at all.

        Null and 0.0 are different claims. A zero in a relevance field reads as
        "the cross-encoder scored this and it was worst", which is a measurement
        nobody took.
        """
        corpus()
        body = search(client, match_count=3)

        assert [m["rerank_score"] for m in body["matches"]] == [None, None, None]

    def test_the_response_says_whose_order_the_rows_are_in(self, client, corpus, reranker):
        corpus()
        assert search(client)["reranked"] is True
        assert search(client)["rerank_state"] == "reranked"

    def test_an_unconfigured_desk_names_the_reason_rather_than_hiding_it(self, client, corpus):
        corpus()
        body = search(client, match_count=3)

        assert body["reranked"] is False
        assert body["rerank_state"] == "unconfigured", (
            "'these three are RRF's top three' and 'these three are the "
            "cross-encoder's pick of twenty' are different claims about lists "
            "that look identical, and the field is where they differ"
        )

    def test_a_state_that_never_reached_the_stage_reports_none(self, client, monkeypatch):
        """`None` and `"unconfigured"` are not the same fact.

        An unavailable index has nothing to narrow, so the stage was never
        reached. Reporting "unconfigured" there would blame a missing model for
        a missing corpus.
        """
        reset_rag()
        monkeypatch.setattr(rag_module, "settings", SimpleNamespace(
            supabase_url="", supabase_service_role_key="", research_rag_enabled=False,
            supabase_desk_id=DESK, supabase_timeout_s=5.0, supabase_mirror_queue_max=10,
        ))
        body = search(client, match_count=3)
        reset_rag()

        assert body["state"] == "unavailable"
        assert body["rerank_state"] is None and body["reranked"] is False


# --------------------------------------------------------------------------- #
# The third arm, on the wire
# --------------------------------------------------------------------------- #
class TestTheBm25ArmIsPublished:
    def test_the_rank_the_arm_assigned_reaches_the_caller(self, client, corpus, reranker):
        corpus()
        body = search(client, match_count=3)

        ranks = {m["source_ref"]: m["bm25_rank"] for m in body["matches"]}
        assert any(rank is not None for rank in ranks.values()), (
            f"bm25_rank was dropped by the response model: {ranks}"
        )
        assert PICK in ranks, f"the cross-encoder's pick never reached the wire: {ranks}"
        # Null, never 0 — a 1-based rank of 0 would read as "better than first".
        assert ranks[PICK] is None, (
            "the arm ranked a document that carries none of the query's terms"
        )

    def test_the_arm_reports_itself_in_a_field_beside_the_rows(self, client, corpus):
        corpus()
        report = search(client, match_count=3)["bm25"]

        assert report["ranked"] is True
        assert report["reason"] is None
        assert report["scored_documents"] == 2, report
        assert report["candidates"] == 3

    def test_an_arm_that_declines_says_so_and_changes_nothing(self, client, corpus):
        """A 404 from the hybrid RPC is the pre-migration deployment.

        Those rows carry no rank to fuse with, so the arm declines by name and
        the dense ordering is served exactly as it was — never fewer results
        than today, never worse ones.
        """
        stub = corpus(hybrid_status=404)
        body = search(client, match_count=3)

        assert stub.dense_widths == [3], "the dense fallback was never reached"
        assert body["bm25"]["ranked"] is False
        assert body["bm25"]["reason"] == "dense_only_path"
        assert [m["bm25_rank"] for m in body["matches"]] == [None, None, None]
        assert [m["source_ref"] for m in body["matches"]] == [row["source_ref"] for row in CORPUS[:3]]


class TestTheRowModelPublishesWhatTheModulesAttach:
    """Read off the REAL modules, so a renamed key fails here rather than in a browser."""

    def test_every_key_fuse_adds_is_a_field_of_the_row_model(self):
        rows = [dict(row) for row in CORPUS]
        report = research_bm25.rank_candidates(QUERY, rows)
        fused = research_bm25.fuse(rows, report)

        added = set(fused[0]) - set(rows[0])
        unpublished = added - set(ResearchRagMatch.model_fields)
        assert unpublished == {"fused_score"}, (
            "a key the fusion attaches is being dropped by ResearchRagMatch. "
            "`fused_score` is the ONE deliberate omission — it is the sum of the "
            "three published ranks, and the RPC's own column no longer equals it "
            f"now that a third arm contributes. The rest: {unpublished}"
        )

    def test_every_key_the_re_ranker_adds_is_a_field_of_the_row_model(self, monkeypatch):
        seam.install_reranker(monkeypatch)
        rows = [dict(row) for row in CORPUS]
        report = rr.rerank(QUERY, rows, 3)

        assert report["reranked"] is True, report["reason"]
        added = set(report["documents"][0]) - set(rows[0])
        assert added <= set(ResearchRagMatch.model_fields), (
            f"the re-ranker attaches {added}, which the row model would discard"
        )
