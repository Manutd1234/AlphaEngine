"""The third retrieval arm, pinned to the retrieval that calls it.

``modules/research_bm25.py`` has twenty-five tests of its own and every one of
them is arithmetic: a query, a list of literal rows, a score. They prove the
ranking model. They cannot prove that anything CALLS it, and that is the defect
``tests/test_research_contract.py`` exists for — two modules built in parallel
that never met, with both suites green because each mocked the other.

So nothing here substitutes anything. Every assertion below imports the real
``modules.research_bm25`` and the real ``modules.research_rag.retrieval`` and
asks whether the one satisfies the other. The only stand-in is the HTTP client,
which is not the collaborator under test: it is the network, CI has none, and a
test that reached Supabase would be a test that never runs.

Three families:

* THE SEAM EXISTS. Retrieval reaches the real module, joins on the constant the
  migration declares, and re-scores fields the RPC actually returns — checked
  against the migration's own text, because "the payload carries the document
  body" is exactly the kind of belief that is true until it is not.
* THE ARM CHANGES THE ANSWER. A third arm that fuses without ever reordering
  anything is dead code with a green suite.
* DECLINING LEAVES TODAY'S ANSWER ALONE. Each of the arm's four named refusals
  and each of the wiring's three must return the two-arm ordering unchanged —
  same rows, same order, nothing annotated — and say which one applied in a
  FIELD. Never fewer results than today, never worse ones.
"""

from __future__ import annotations

import asyncio
import inspect
import re
from pathlib import Path
from typing import Any

import pytest

from modules import research_bm25
from modules.research_rag import ResearchRag, retrieval
from modules.research_rag.retrieval import EMBEDDING_DIMENSIONS, apply_bm25

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"
HYBRID_SQL = (MIGRATIONS / "20260810090000_hybrid_research_search.sql").read_text()

QUERY = "sharpe drawdown"


def _rpc_fused(vector_rank: int | None, lexical_rank: int | None) -> float:
    """What the RPC's own ``fused_score`` column holds for these two ranks."""
    return sum(
        1.0 / (research_bm25.RRF_K + rank)
        for rank in (vector_rank, lexical_rank)
        if rank is not None
    )


def _row(
    doc_id: str,
    body: str,
    *,
    vector_rank: int | None = None,
    lexical_rank: int | None = None,
    similarity: float = 0.9,
    title: str = "",
) -> dict[str, Any]:
    """One row exactly as ``match_research_documents_hybrid`` returns it."""
    return {
        "id": doc_id,
        "kind": "backtest_run",
        "source_ref": f"job/{doc_id}",
        "symbol": None,
        "strategy": None,
        "occurred_at": "2026-08-20T09:00:00+00:00",
        "title": title,
        "body": body,
        "metrics": {},
        "similarity": similarity,
        "lexical_rank": lexical_rank,
        "vector_rank": vector_rank,
        "fused_score": _rpc_fused(vector_rank, lexical_rank),
    }


#: Six candidates for the query "sharpe drawdown", ordered as the RPC returns
#: them — by two-arm fused score, so by ``vector_rank`` here, because none of
#: them was reached by the ``ts_rank_cd`` arm.
#:
#: ``paraphrase`` is the case the dense arm was added for and the case it gets
#: wrong: gte-small ranks it first on topic while it does not contain either
#: word the desk typed. ``exact`` is the document that answers the question and
#: sits third. That gap is small in RRF terms — 1/61 against 1/63 — which is
#: the point: the third arm can flip a close pair and cannot overturn the other
#: two retrievers, which is why adding it cannot make retrieval worse.
CANDIDATES: list[dict[str, Any]] = [
    _row("paraphrase", "momentum crossover performance summary for the quarter",
         vector_rank=1, similarity=0.93),
    _row("filler-a", "position sizing notes for the desk", vector_rank=2, similarity=0.91),
    _row("exact", "sharpe drawdown sharpe", vector_rank=3, similarity=0.89),
    _row("filler-b", "venue latency review", vector_rank=4, similarity=0.87),
    _row("filler-c", "borrow costs and financing", vector_rank=5, similarity=0.85),
    _row("mention", "a long note about execution quality that mentions sharpe once "
                    "among a great deal of other prose about fills and venues",
         vector_rank=6, similarity=0.83),
]

TWO_ARM_ORDER = ["paraphrase", "filler-a", "exact", "filler-b", "filler-c", "mention"]


class _Response:
    def __init__(self, status_code: int, payload: Any = None, headers: dict | None = None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self) -> Any:
        return self._payload


class _Client:
    """The network and nothing else.

    It answers the two RPCs and the embed function with literal payloads. It
    does not know BM25 exists, which is the property that matters: everything
    between the payload and the ranking is the real code under test.
    """

    def __init__(self, rows: list[dict[str, Any]], *, hybrid_status: int = 200,
                 dense_rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows
        self.hybrid_status = hybrid_status
        self.dense_rows = dense_rows if dense_rows is not None else rows
        self.paths: list[str] = []

    async def post(self, path: str, json: dict) -> _Response:  # noqa: A002 — httpx's own kwarg name
        self.paths.append(path)
        if path.endswith("embed-research"):
            return _Response(200, {"embeddings": [[0.1] * EMBEDDING_DIMENSIONS]})
        if path.endswith("match_research_documents_hybrid"):
            if self.hybrid_status >= 300:
                return _Response(self.hybrid_status, [])
            return _Response(200, self.rows)
        if path.endswith("match_research_documents"):
            return _Response(200, self.dense_rows)
        raise AssertionError(f"retrieval posted to an unexpected path: {path}")

    async def head(self, path: str, params: dict | None = None,
                   headers: dict | None = None) -> _Response:
        return _Response(200, None, {"content-range": "0-0/6"})


def _rag(client: _Client) -> ResearchRag:
    """A real ``ResearchRag`` with a stub transport.

    ``enabled`` and ``_client`` are set on the INSTANCE. ``settings`` is a
    frozen dataclass and is not touched here — this package reads it only in
    ``writer.py``, and nothing in this file needs a configuration at all.
    """
    rag = ResearchRag()
    rag.enabled = True
    rag._client = client
    return rag


def _ids(rows: list[dict[str, Any]]) -> list[str]:
    return [str(row["id"]) for row in rows]


class TestTheSeamExists:
    def test_retrieval_holds_the_real_module_not_a_name_that_resolves(self):
        """The original defect, in one line: a name that resolves to nothing real."""
        assert retrieval.research_bm25 is research_bm25

    def test_the_arm_exports_what_the_wiring_calls(self):
        """Names AND signatures, because renaming was only half of that break.

        ``apply_bm25`` calls ``rank_candidates(query, candidates)`` positionally
        and ``fuse(matches, report)`` positionally. An arm that took either as
        keyword-only would resolve perfectly and raise on every request.
        """
        for name, arity in (("rank_candidates", 2), ("fuse", 2), ("_unavailable", 2)):
            fn = getattr(research_bm25, name, None)
            assert callable(fn), f"the arm does not export {name!r}"
            positional = [
                p for p in inspect.signature(fn).parameters.values()
                if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
            ]
            assert len(positional) >= arity, (
                f"{name} takes {len(positional)} positional parameters; the wiring passes {arity}"
            )

    def test_the_fields_the_arm_scores_are_fields_the_rpc_returns(self):
        """The claim that would have been a fiction: that the text is in the payload.

        BM25 scores a candidate set, so it needs the document text on the row.
        If the RPC returned ids and scores only, this wiring would be scoring
        empty strings and reporting a ranking of nothing — which looks exactly
        like a ranking. The migration's own ``returns table`` is the authority.
        """
        declared = HYBRID_SQL[HYBRID_SQL.index("returns table (") :]
        declared = declared[declared.index("(") + 1 : declared.index(")\nlanguage")]
        columns = {line.strip().split()[0] for line in declared.splitlines() if line.strip()}

        assert "id" in columns, "the join key between the arm and the rows is not returned"
        missing = [field for field in research_bm25.TEXT_FIELDS if field not in columns]
        assert not missing, (
            f"the arm scores {missing}, which match_research_documents_hybrid does not return; "
            "it would be scoring empty strings"
        )

    def test_the_arm_scores_the_same_fields_the_tsvector_indexes(self):
        """Two lexical arms over different text would not be two opinions."""
        generated = HYBRID_SQL[HYBRID_SQL.index("search_tsv tsvector") : HYBRID_SQL.index("stored;")]
        for field in research_bm25.TEXT_FIELDS:
            assert f"coalesce({field}," in generated, (
                f"the arm reads {field!r}, which the generated tsvector does not"
            )

    def test_the_third_arm_joins_on_the_constant_the_migration_declares(self):
        """A third arm fused at a different k is a second fusion, not a third arm."""
        declared = re.search(r"rrf_k\s+int\s+default\s+(\d+)", HYBRID_SQL)
        assert declared, "the migration no longer declares rrf_k"
        assert research_bm25.RRF_K == int(declared.group(1)) == 60


class TestTheArmChangesTheAnswer:
    def test_bm25_promotes_the_document_that_says_the_words(self):
        """Dead code with a green suite is the thing being ruled out here."""
        client = _Client(CANDIDATES)
        result = asyncio.run(_rag(client).search(QUERY))

        assert result["state"] == "ok"
        assert result["bm25"]["ranked"] is True
        assert _ids(CANDIDATES) == TWO_ARM_ORDER, "the fixture no longer starts from today's order"
        assert _ids(result["matches"])[:2] == ["exact", "mention"], (
            "the arm ranked the documents but the fusion did not use its ranking"
        )

    def test_the_fused_score_is_the_two_arm_score_plus_the_third(self):
        """Arithmetic, not vibes: every row, all three contributions, one k."""
        result = asyncio.run(_rag(_Client(CANDIDATES)).search(QUERY))
        for row in result["matches"]:
            expected = sum(
                1.0 / (research_bm25.RRF_K + rank)
                for rank in (row["vector_rank"], row["lexical_rank"], row["bm25_rank"])
                if rank is not None
            )
            assert row["fused_score"] == pytest.approx(expected), row["id"]

    def test_the_arm_reorders_and_never_adds_or_drops_a_document(self):
        """It re-scores a candidate set, so recall is the RPC's business alone."""
        result = asyncio.run(_rag(_Client(CANDIDATES)).search(QUERY))
        assert sorted(_ids(result["matches"])) == sorted(_ids(CANDIDATES))
        assert len(result["matches"]) == len(CANDIDATES)

    def test_a_document_the_arm_did_not_rank_keeps_none_never_zero(self):
        """In a 1-based ranking, 0 reads as "better than first"."""
        result = asyncio.run(_rag(_Client(CANDIDATES)).search(QUERY))
        ranks = {row["id"]: row["bm25_rank"] for row in result["matches"]}
        assert ranks["exact"] == 1
        assert ranks["paraphrase"] is None, "a document holding no query term was given a rank"
        assert 0 not in ranks.values(), "an unranked document was coerced to rank zero"

    def test_the_report_says_how_much_of_the_query_could_discriminate(self):
        report = asyncio.run(_rag(_Client(CANDIDATES)).search(QUERY))["bm25"]
        assert report["candidates"] == len(CANDIDATES)
        assert report["terms"] == 2
        assert report["discriminating_terms"] == 2
        assert report["scored_documents"] == 2


class TestDecliningLeavesTodaysAnswerAlone:
    """Seven named refusals, four the arm's and three the wiring's.

    Each must return the rows the two-arm fusion produced, in that order, with
    nothing added to them — "unchanged" has to mean unchanged for the report's
    claim to be worth checking.
    """

    def _unchanged(self, rows: list[dict[str, Any]], out: list[dict[str, Any]]) -> None:
        assert _ids(out) == _ids(rows), "a refusal reordered the result anyway"
        assert all("bm25_rank" not in row for row in out), (
            "a refusal annotated the rows; the two-arm result is no longer what it was"
        )

    def test_a_query_of_only_stopwords(self):
        out, report = apply_bm25(list(CANDIDATES), "the and of")
        assert report["reason"] == research_bm25.REASON_EMPTY_QUERY
        assert report["ranked"] is False
        self._unchanged(CANDIDATES, out)

    def test_candidates_that_carry_no_text(self):
        rows = [_row("a", ""), _row("b", "")]
        out, report = apply_bm25(list(rows), QUERY)
        assert report["reason"] == research_bm25.REASON_NO_MATCHING_DOCUMENTS
        self._unchanged(rows, out)

    def test_a_term_every_candidate_contains(self):
        rows = [_row(f"d{i}", "sharpe drawdown") for i in range(4)]
        out, report = apply_bm25(list(rows), QUERY)
        assert report["reason"] == research_bm25.REASON_NO_DISCRIMINATING_TERMS
        self._unchanged(rows, out)

    def test_no_candidates_at_all(self):
        out, report = apply_bm25([], QUERY)
        assert report["reason"] == research_bm25.REASON_EMPTY_CORPUS
        assert out == []

    def test_a_candidate_without_the_join_key_reports_rather_than_raises(self):
        """The one way the arm could raise inside a request.

        ``rank_candidates`` treats ``id`` as a contract, so a row without one is
        a ``KeyError`` — which would turn a search that works today into a 500.
        """
        rows = [_row("exact", "sharpe drawdown"), {"body": "sharpe", "title": ""}]
        out, report = apply_bm25(list(rows), QUERY)
        assert report["reason"] == retrieval.REASON_UNJOINABLE_CANDIDATES
        assert report["ranked"] is False
        assert len(out) == 2

    def test_the_dense_only_path_keeps_its_similarity_ordering(self):
        """A 404 hybrid RPC is a rollout, and its rows carry no rank to fuse with.

        Fusing here would score every row on the BM25 arm ALONE and throw away
        the only ordering this path has, which is the one outcome forbidden.
        """
        dense = [
            {"id": "one", "body": "momentum notes", "title": "", "similarity": 0.95},
            {"id": "two", "body": "sharpe drawdown sharpe", "title": "", "similarity": 0.80},
        ]
        client = _Client([], hybrid_status=404, dense_rows=dense)
        result = asyncio.run(_rag(client).search(QUERY))

        assert result["bm25"]["reason"] == retrieval.REASON_DENSE_ONLY
        assert result["bm25"]["ranked"] is False
        assert result["bm25"]["candidates"] == 2
        assert _ids(result["matches"]) == ["one", "two"], "the dense ordering was overturned"

    def test_a_search_that_could_not_run_still_reports_the_arm(self):
        rag = ResearchRag()
        rag.enabled = False
        rag._client = None
        result = asyncio.run(rag.search(QUERY))

        assert result["state"] == "unavailable"
        assert result["bm25"]["reason"] == retrieval.REASON_RETRIEVAL_UNAVAILABLE
        assert result["bm25"]["ranked"] is False

    def test_a_failed_rpc_is_not_reported_as_nothing_to_score(self):
        """"Could not retrieve" and "nothing to rank" are different facts."""
        client = _Client([], hybrid_status=500)
        result = asyncio.run(_rag(client).search(QUERY))
        assert result["matches"] == []
        assert result["bm25"]["reason"] == retrieval.REASON_RETRIEVAL_UNAVAILABLE
        assert result["bm25"]["reason"] != research_bm25.REASON_EMPTY_CORPUS


class TestOneReportShape:
    def test_the_wirings_refusals_carry_the_arms_own_keys(self):
        """A caller reads one shape whichever side declined, or it reads none."""
        success = research_bm25.rank_candidates(QUERY, [_row("a", "sharpe"), _row("b", "x")])
        arm_refusal = research_bm25.rank_candidates(QUERY, [])
        wiring_refusal = retrieval._unretrieved("nothing was retrieved")

        assert set(wiring_refusal) == set(arm_refusal) == set(success)
        assert wiring_refusal["ranking"] == []
        assert wiring_refusal["detail"], "a refusal with no sentence for a human to read"

    def test_could_not_and_nothing_to_stay_distinguishable_by_field(self):
        """The house rule, held across the seam rather than inside the arm."""
        could_not = retrieval._unretrieved("the hybrid RPC could not be reached")
        _, nothing_to = apply_bm25([_row("a", "sharpe"), _row("b", "sharpe")], QUERY)

        assert could_not["reason"] != nothing_to["reason"]
        assert could_not["candidates"] == 0
        assert nothing_to["candidates"] == 2

    def test_the_list_only_caller_still_receives_a_list(self):
        """``writer.py``'s anomaly path calls ``_match`` and indexes the result.

        Widening that return to a tuple would not have raised: ``matches[0]``
        on a tuple is a list, and a list of rows and a list-of-lists both
        iterate. This is the seam inside the package, and it fails loudly here.
        """
        rag = _rag(_Client(CANDIDATES))
        rows = asyncio.run(rag._match([0.1] * EMBEDDING_DIMENSIONS, match_count=3))
        assert isinstance(rows, list)
        assert all(isinstance(row, dict) for row in rows)
