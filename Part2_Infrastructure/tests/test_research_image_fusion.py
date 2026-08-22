"""The fourth arm's arithmetic: RRF over four rankings, and every refusal.

Split from ``tests/test_research_image.py`` under the file-length ceiling
``tests/test_file_size.py`` enforces, and the split falls where the subject
does. That file is the ENCODER SEAM — no model, a bad PNG, a zero vector, a
width that is not 512. This one is what the arm DOES with the ranking once it
has one, and the two claims it has to satisfy at the same time:

* IT ADDS RECALL. Fusion at the SAME k = 60 the other three arms use, every
  document the text arms found keeping every contribution it had, and a
  document only the picture matched APPENDED rather than substituted.
* IT SUBTRACTS NONE. Each named refusal — unconfigured, no migration, an
  unparseable body, the dense-only path — must return the three-arm ordering
  exactly as it arrived and say which refusal applied in a FIELD.

The last class reads the migration's own text. "The function returns a rank
rather than a fused score" is precisely the kind of belief that is true until
somebody edits the SQL, and the Python here would keep summing either way.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from modules import research_bm25, research_image
from modules import research_image_arm as arm
from tests.test_research_image import IMAGE_SQL, MIGRATIONS, _install


def _match(doc_id: str, *, vector_rank=None, lexical_rank=None, bm25_rank=None) -> dict[str, Any]:
    """A row as the three text arms leave it."""
    ranks = (vector_rank, lexical_rank, bm25_rank)
    return {
        "id": doc_id, "kind": "chart", "source_ref": f"job:{doc_id}", "title": doc_id,
        "body": doc_id, "similarity": 0.88, "vector_rank": vector_rank,
        "lexical_rank": lexical_rank, "bm25_rank": bm25_rank,
        "fused_score": sum(1.0 / (research_bm25.RRF_K + r) for r in ranks if r is not None),
    }


def _image_row(doc_id: str, rank: int) -> dict[str, Any]:
    """A row as ``match_research_document_images`` returns it."""
    return {
        "id": doc_id, "kind": "chart", "source_ref": f"job:{doc_id}", "title": doc_id,
        "body": doc_id, "image_similarity": 0.31, "image_rank": rank,
    }


class TestTheFourthArmAddsRecallAndSubtractsNone:
    def test_it_fuses_at_the_same_k_the_other_three_use(self):
        """A fourth arm on another constant is a second fusion in disguise."""
        assert arm.RRF_K == research_bm25.RRF_K == 60
        assert "rrf_k int default 60" in (
            MIGRATIONS / "20260810090000_hybrid_research_search.sql"
        ).read_text()

    def test_a_document_the_text_arms_found_keeps_every_contribution_it_had(self):
        before = _match("a", vector_rank=1, lexical_rank=2, bm25_rank=3)
        fused, added = arm.fuse([dict(before)], [_image_row("a", 1)])
        assert added == 0
        assert fused[0]["fused_score"] == pytest.approx(
            before["fused_score"] + 1.0 / (arm.RRF_K + 1)
        )
        assert fused[0]["image_rank"] == 1

    def test_a_document_no_picture_matched_keeps_a_null_image_rank(self):
        """Null, never 0 — in a 1-based ranking 0 reads as "better than first"."""
        fused, _added = arm.fuse([_match("a", vector_rank=1)], [_image_row("b", 1)])
        by_id = {row["id"]: row for row in fused}
        assert by_id["a"]["image_rank"] is None
        assert by_id["a"]["fused_score"] == pytest.approx(1.0 / (arm.RRF_K + 1))

    def test_a_document_only_the_picture_found_is_added_and_carries_no_text_similarity(self):
        """The recall this arm exists to buy — and an honest null beside it."""
        fused, added = arm.fuse([_match("a", vector_rank=1)], [_image_row("z", 1)])
        assert added == 1
        assert [row["id"] for row in fused] == ["a", "z"]
        introduced = fused[-1]
        assert introduced["similarity"] is None, "no text arm measured it, so 0.0 would be a lie"
        assert introduced["vector_rank"] is None and introduced["bm25_rank"] is None
        assert introduced["fused_score"] == pytest.approx(1.0 / (arm.RRF_K + 1))

    def test_agreement_between_the_words_and_the_picture_outranks_either_alone(self):
        """The whole reason to fuse rather than to concatenate two result lists."""
        matches = [_match("words-only", vector_rank=1), _match("both", vector_rank=4)]
        fused, _added = arm.fuse(matches, [_image_row("both", 1), _image_row("picture-only", 2)])
        assert [row["id"] for row in fused] == ["both", "words-only", "picture-only"]

    def test_no_document_the_text_arms_found_is_ever_dropped(self):
        matches = [_match(name, vector_rank=i + 1) for i, name in enumerate("abcde")]
        fused, _added = arm.fuse(matches, [_image_row("z", 1)])
        assert {row["id"] for row in fused} >= set("abcde")


# --------------------------------------------------------------------------- #
# declining leaves today's answer alone
# --------------------------------------------------------------------------- #
class Response:
    def __init__(self, status_code: int, payload: Any = None, *, poisoned: bool = False) -> None:
        self.status_code = status_code
        self._payload = payload
        self._poisoned = poisoned

    def json(self) -> Any:
        if self._poisoned:
            raise ValueError("Expecting value")
        return self._payload


class Client:
    def __init__(self, response: Response) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    async def post(self, path: str, json: dict[str, Any] | None = None) -> Response:  # noqa: A002
        self.calls.append({"path": path, "json": json})
        return self.response


def _run(coro):
    return asyncio.run(coro)


THREE_ARM = [_match("a", vector_rank=1, lexical_rank=1), _match("b", vector_rank=2)]


class TestDecliningReturnsTodaysOrderingUnchanged:
    def _unchanged(self, matches: list[dict[str, Any]], report: dict[str, Any], state: str) -> None:
        assert matches == THREE_ARM, "same rows, same order, nothing annotated"
        assert report["ranked"] is False and report["state"] == state
        assert report["reason"] and report["model"] is None and report["added"] == 0

    def test_an_unconfigured_desk_never_calls_the_rpc(self):
        client = Client(Response(200, []))
        matches, report = _run(arm.image_arm(client, "q", list(THREE_ARM)))
        self._unchanged(matches, report, "unconfigured")
        assert client.calls == [], "an arm that is off must not cost a round trip"

    def test_a_missing_migration_is_a_state_and_not_an_error(self, monkeypatch):
        """404 is PGRST202: the deployment predates the image migration."""
        _install(monkeypatch)
        matches, report = _run(arm.image_arm(Client(Response(404)), "q", list(THREE_ARM)))
        self._unchanged(matches, report, "unavailable")
        assert "migration" in report["reason"]

    def test_a_200_with_a_body_that_will_not_parse_is_named_failed(self, monkeypatch):
        _install(monkeypatch)
        client = Client(Response(200, poisoned=True))
        matches, report = _run(arm.image_arm(client, "q", list(THREE_ARM)))
        self._unchanged(matches, report, "failed")

    def test_the_dense_only_path_is_left_strictly_alone(self, monkeypatch):
        """The rows carry no rank, so a fourth arm could only destroy an ordering.

        ``_match_arms`` refuses BM25 on this path for the same reason: fusing
        would score every row on the new arm ALONE and discard the similarity
        ordering that is the only ordering the dense function returns.
        """
        _install(monkeypatch)
        dense = [{"id": "a", "similarity": 0.91}, {"id": "b", "similarity": 0.80}]
        client = Client(Response(200, [_image_row("b", 1)]))
        matches, report = _run(arm.image_arm(client, "q", list(dense)))
        assert matches == dense
        assert report["state"] == "unfusable" and report["ranked"] is False
        assert client.calls == []

    def test_an_empty_candidate_list_still_gets_the_arm(self, monkeypatch):
        """Nothing to destroy, everything to gain: this is pure recall."""
        _install(monkeypatch)
        client = Client(Response(200, [_image_row("z", 1)]))
        matches, report = _run(arm.image_arm(client, "a curve that spikes", []))
        assert [row["id"] for row in matches] == ["z"]
        assert report["ranked"] is True and report["added"] == 1
        assert report["model"] == research_image.IMAGE_MODEL_TEXT

    def test_the_query_vector_sent_is_512_wide_and_scoped_when_asked(self, monkeypatch):
        _install(monkeypatch)
        client = Client(Response(200, []))
        _run(arm.image_arm(client, "q", list(THREE_ARM), 7, "chart", "desk-1"))
        sent = client.calls[0]["json"]
        assert client.calls[0]["path"] == arm.IMAGE_RPC
        assert len(sent["query_embedding"]) == research_image.IMAGE_DIMENSIONS == 512
        assert sent["match_count"] == 7 and sent["filter_kind"] == "chart"
        assert sent["filter_desk_id"] == "desk-1"
        assert "min_similarity" not in sent, "no floor has been measured, so none is sent"

    def test_an_unscoped_search_leaves_the_tenant_key_off_entirely(self, monkeypatch):
        """``retrieval._scope``'s rollout rule, kept identical on the new RPC."""
        _install(monkeypatch)
        client = Client(Response(200, []))
        _run(arm.image_arm(client, "q", list(THREE_ARM)))
        assert "filter_desk_id" not in client.calls[0]["json"]

    def test_a_measured_floor_reaches_the_rpc_and_a_typo_does_not(self, monkeypatch):
        _install(monkeypatch)
        monkeypatch.setenv("RESEARCH_IMAGE_MIN_SIMILARITY", "0.24")
        client = Client(Response(200, []))
        _run(arm.image_arm(client, "q", list(THREE_ARM)))
        assert client.calls[0]["json"]["min_similarity"] == pytest.approx(0.24)

        monkeypatch.setenv("RESEARCH_IMAGE_MIN_SIMILARITY", "quite high")
        client = Client(Response(200, []))
        _run(arm.image_arm(client, "q", list(THREE_ARM)))
        assert "min_similarity" not in client.calls[0]["json"], (
            "an unparseable floor is UNSET, never silently 0.0 — on a metric "
            "that can go negative those are different instructions"
        )


class TestTheMigrationSaysWhatThisCodeAssumes:
    def test_the_column_is_512_wide_with_its_own_cosine_index(self):
        assert "image_embedding extensions.vector(512)" in IMAGE_SQL
        assert "hnsw (image_embedding extensions.vector_cosine_ops)" in IMAGE_SQL
        assert "where image_embedding is not null" in IMAGE_SQL

    def test_the_function_ranks_only_ready_rows_and_never_fuses(self):
        assert "d.image_embedding_status = 'ready'" in IMAGE_SQL
        assert "image_rank" in IMAGE_SQL and "fused_score" not in IMAGE_SQL

    def test_the_honest_caveat_is_written_where_it_will_be_read(self):
        """CLIP on a line chart is an empirical question and must SAY so."""
        for text in (IMAGE_SQL, Path(research_image.__file__).read_text()):
            assert "retrieval-eval.ts" in text
            assert "EMPIRICAL" in text or "empirical" in text
