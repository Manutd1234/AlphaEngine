"""The ingest drain's survival contract: nothing indexes if the loop dies.

Three failures are pinned here, all of them observed in the tree:

1. ``_drain`` had no guard of its own and ``embed_many`` catches only
   ``httpx.HTTPError``. A proxy that answers 200 with an HTML error page makes
   ``response.json()`` raise ``JSONDecodeError`` — a ``ValueError`` — which went
   straight out of the loop and killed the task. ``status().running`` went False
   and every later submission sat in the queue until the process restarted.

   THE OUTCOME MOVED, AND THESE TESTS MOVED WITH IT. Both ends of that defect
   were closed independently: ``_drain`` grew a guard that dead-letters whatever
   escapes ``_index_one``, and ``embed_many`` grew ``except ValueError`` so the
   poisoned body never escapes in the first place. The second one now fires
   first, so the document is no longer dead-lettered — it is inserted with a
   NULL vector and ``embedding_status='pending'``.

   That is strictly the better outcome and the reason is recoverability, not
   taste. A dead letter is a counter and an identity; the document is gone and
   only a human reading ``/api/research/rag/status`` and re-running the backfill
   by hand brings it back. A pending row is IN the corpus, carries its own
   ``body`` — the exact text that still needs embedding — and is picked up by
   the backfill's ``embedding_status = 'pending'`` query with nobody paged. The
   embedder was lying temporarily; the document was always fine. So what these
   tests pin is unchanged in substance and different in outcome: the poisoned
   response must not kill the loop, the SECOND document must still be attempted,
   and a recovered proxy must still index. Only the row the first document ends
   up as has changed, from unrecoverable to retryable.

   ``_drain``'s guard is NOT now dead code and must not be deleted on the
   strength of these tests passing without it: it catches the next unhandled
   type, which will not be this one. ``test_a_drain_that_ended_anyway_is_...``
   below is what still exercises the supervisor behind it.
2. A non-2xx insert incremented ``_failed`` and the document was GONE: no retry,
   no identity, nothing to replay.
3. Queue overflow was counted on a status route nobody was watching and logged
   nowhere, so the first evidence of a stalled drain was a query that could not
   find a run everybody remembered making.

The ResearchRag under test is the REAL one — the real queue, the real drain, the
real ``deliver`` and the real ``Backoff``. What is faked is the corpus at the
HTTP boundary, because the suite is offline. The retry curve is shortened by
moving the delivery module's own constants rather than by injecting a sleeper:
what runs here is the production loop, not a rehearsal of it.
"""

from __future__ import annotations

import asyncio
import json
import logging

import pytest

import modules.research_ingest_delivery as delivery
import modules.research_rag.writer as rag_module
from modules.research_rag import ResearchRag
from modules.research_rag.arms import REASON_UNPARSEABLE_BODY
from modules.research_rag.replacement import REPLACE_PATH


class Stub:
    """The configuration the writer reads, and nothing else."""

    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_x"
    research_rag_enabled = True
    supabase_desk_id = "00000000-0000-0000-0000-000000000001"
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 10


EMBED_PATH = "/functions/v1/embed-research"
INSERT_PATH = "/rest/v1/research_documents"
VECTOR = [0.01] * 384


class Response:
    def __init__(self, status_code: int, payload=None, *, poisoned: bool = False):
        self.status_code = status_code
        self._payload = payload
        self._poisoned = poisoned

    def json(self):
        if self._poisoned:
            # Exactly what httpx raises for an HTML body served as 200: a
            # JSONDecodeError, which is a ValueError and is not an HTTPError.
            raise json.JSONDecodeError("Expecting value", "<html>502 Bad Gateway</html>", 0)
        return self._payload


class Corpus:
    """A fake Supabase at the HTTP boundary. Records every call it is given."""

    def __init__(self, *, embed_poisoned: bool = False, insert_status=201):
        self.embed_poisoned = embed_poisoned
        #: An int, or a list of statuses consumed one per attempt.
        self.insert_status = insert_status
        self.embeds: list[list[str]] = []
        self.inserts: list[dict] = []
        self.replacements: list[dict] = []

    async def aclose(self) -> None:
        """`stop()` closes its client; the fake has to be closable too."""

    async def post(self, path, json=None, headers=None):  # noqa: A002 - httpx's kwarg
        if path == EMBED_PATH:
            self.embeds.append(json["texts"])
            if self.embed_poisoned:
                return Response(200, poisoned=True)
            return Response(200, {"embeddings": [VECTOR for _ in json["texts"]]})
        assert path == REPLACE_PATH
        self.replacements.append(json)
        self.inserts.extend(dict(row) for row in json["p_rows"])
        status = self.insert_status
        if isinstance(status, list):
            status = status[min(len(self.replacements) - 1, len(status) - 1)]
        # An empty representation is what `resolution=ignore-duplicates` returns
        # for a document already present; `persist_edges` handles it and stops.
        return Response(status, [])


def document(ref: str, kind: str = "backtest_run") -> dict:
    return {
        "kind": kind, "source_ref": ref, "symbol": "BTCUSDT", "interval": "4h",
        "strategy": "ma_cross", "occurred_at": "2026-08-21T00:00:00+00:00",
        "title": f"Sweep {ref}", "body": f"Sweep {ref}\nSharpe: 0.2",
        "metrics": {}, "data_hash": None,
    }


@pytest.fixture
def rag(monkeypatch):
    monkeypatch.setattr(rag_module, "settings", Stub())
    return ResearchRag()


async def _settle(predicate, give_up_after_s: float = 2.0) -> None:
    """Let the drain run until it has caught up, or fail the test loudly."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + give_up_after_s
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError("the drain never caught up")
        await asyncio.sleep(0.005)


async def _drive(rag: ResearchRag, corpus: Corpus, documents: list[dict], predicate) -> None:
    rag._client = corpus
    rag._loop = asyncio.get_running_loop()
    rag._task = asyncio.create_task(rag._drain(), name="research-rag-test")
    try:
        for doc in documents:
            rag._submit(doc)
        await _settle(predicate)
    finally:
        await rag.stop()


class TestOneBadResponseCannotKillTheDrain:
    def test_a_200_with_a_non_json_body_leaves_the_document_pending_and_the_loop_lives(
        self, rag, caplog,
    ):
        """The exact outage: an HTML 502 from a proxy, served as 200.

        PENDING, NOT A DEAD LETTER, and the module docstring above argues why at
        length: ``embed_many`` catches the ``JSONDecodeError`` before it can
        escape ``_index_one``, so the document is INSERTED with a null vector
        and ``embedding_status='pending'`` — a row the backfill re-embeds on its
        own — instead of being counted, discarded and left for a human. The
        property this test exists to protect is unchanged: the poisoned response
        does not kill the loop and the SECOND document is still attempted.
        """
        corpus = Corpus(embed_poisoned=True)

        async def scenario():
            with caplog.at_level(logging.WARNING, logger="alphaengine.rag"):
                await _drive(
                    rag, corpus, [document("job-1"), document("job-2")],
                    lambda: rag.status()["pending_embeddings"] == 2,
                )

        asyncio.run(scenario())
        status = rag.status()
        assert status["pending_embeddings"] == 2
        assert status["indexed"] == 0, "nothing was embedded, so nothing may claim to be"
        # Nothing was lost, so nothing needs replaying by hand. These two being
        # zero is the whole difference between the old outcome and this one.
        assert status["failed"] == 0
        assert status["dead_lettered"] == 0 and status["dead_letters"] == []
        # The second document proves the LOOP survived the first, which is the
        # whole claim: a counter of two pending rows could also mean two crashes.
        assert corpus.embeds == [["Sweep job-1\nSharpe: 0.2"], ["Sweep job-2\nSharpe: 0.2"]]
        # Both reached the corpus, and neither carries a vector. A ZERO vector
        # here would be the defect this package is most alert to — equidistant
        # from everything, and therefore "similar" to every query ever asked.
        assert [r["source_ref"] for r in corpus.inserts] == ["job-1", "job-2"]
        assert [r["embedding"] for r in corpus.inserts] == [None, None]
        assert {r["embedding_status"] for r in corpus.inserts} == {"pending"}
        assert {r["embedding_model"] for r in corpus.inserts} == {None}
        # Silence would make a corpus that has quietly stopped embedding look
        # exactly like one with nothing to embed. The reason is NAMED so that
        # "the embedder is unreachable" and "something in front of the embedder
        # is answering for it" can be told apart in a log search.
        assert REASON_UNPARSEABLE_BODY in caplog.text
        assert "stay unembedded" in caplog.text

    def test_a_poisoned_document_does_not_stop_the_next_one_indexing(self, rag):
        corpus = Corpus(embed_poisoned=True)

        async def scenario():
            rag._client = corpus
            rag._loop = asyncio.get_running_loop()
            rag._task = asyncio.create_task(rag._drain(), name="research-rag-test")
            try:
                rag._submit(document("job-1"))
                await _settle(lambda: rag.status()["pending_embeddings"] == 1)
                corpus.embed_poisoned = False  # the proxy recovers
                rag._submit(document("job-2"))
                await _settle(lambda: rag.status()["indexed"] == 1)
            finally:
                await rag.stop()

        asyncio.run(scenario())
        status = rag.status()
        assert status["indexed"] == 1
        # The first document is still there and still retryable — the recovery
        # of the second is not bought by forgetting the first.
        assert status["pending_embeddings"] == 1
        assert status["dead_lettered"] == 0
        assert status["running"] is False  # only because stop() cancelled it

    def test_a_drain_that_ended_anyway_is_restarted_by_the_next_submission(self, rag):
        """The supervisor of last resort, for a fault the guard cannot see."""
        corpus = Corpus()

        async def dead() -> None:
            raise RuntimeError("the drain died before this change existed")

        async def scenario():
            rag._client = corpus
            rag._loop = asyncio.get_running_loop()
            rag._task = asyncio.create_task(dead(), name="research-rag-test")
            await asyncio.sleep(0.01)
            assert rag.status()["running"] is False, "the task must really be dead"
            try:
                rag._submit(document("job-3"))
                await _settle(lambda: rag.status()["indexed"] == 1)
                assert rag.status()["running"] is True
                assert rag.status()["drain_restarts"] == 1
            finally:
                await rag.stop()

        asyncio.run(scenario())


class TestFailedInsertsAreRetriedThenDeadLettered:
    @pytest.fixture(autouse=True)
    def _fast_curve(self, monkeypatch):
        # The real curve, at a millisecond. `Backoff` refuses a base of zero,
        # and the point is to run the real loop rather than a stubbed sleeper.
        monkeypatch.setattr(delivery, "INGEST_BACKOFF_BASE_S", 0.001)
        monkeypatch.setattr(delivery, "INGEST_BACKOFF_CEILING_S", 0.002)

    def test_a_500_is_retried_the_configured_number_of_times(self, rag):
        corpus = Corpus(insert_status=500)

        asyncio.run(_drive(
            rag, corpus, [document("job-1")],
            lambda: rag.status()["dead_lettered"] == 1,
        ))
        assert len(corpus.inserts) == delivery.INGEST_ATTEMPTS == 3
        letter = rag.status()["dead_letters"][0]
        assert letter["reason"] == "rejected" and letter["detail"] == "HTTP 500"
        assert letter["attempts"] == 3
        assert letter["source_ref"] == "job-1"
        assert rag.status()["indexed"] == 0 and rag.status()["failed"] == 1

    def test_a_transient_failure_recovers_rather_than_being_lost(self, rag):
        """The retry has to actually deliver, not merely delay the funeral."""
        corpus = Corpus(insert_status=[503, 201])

        asyncio.run(_drive(
            rag, corpus, [document("job-1")],
            lambda: rag.status()["indexed"] == 1,
        ))
        assert len(corpus.inserts) == 2
        assert rag.status()["dead_lettered"] == 0
        assert rag.status()["failed"] == 0

    def test_an_expired_key_is_named_auth_rather_than_rejected(self, rag):
        """An operator's problem and a developer's must not read alike."""
        corpus = Corpus(insert_status=401)

        asyncio.run(_drive(
            rag, corpus, [document("job-1")],
            lambda: rag.status()["dead_lettered"] == 1,
        ))
        assert rag.status()["dead_letters"][0]["reason"] == "auth"

    def test_the_dead_letter_book_is_bounded_and_says_what_it_discarded(self):
        book = delivery.DeadLetterBook(maximum=2)
        outcome = delivery.Undelivered(reason="rejected", detail="HTTP 500", attempts=3)
        for ref in ("a", "b", "c"):
            book.record({"kind": "backtest_run", "source_ref": ref}, outcome)
        assert book.depth == 2
        assert [e["source_ref"] for e in book.recent()] == ["c", "b"]
        assert book.discarded == 1, "a bounded buffer that forgets silently is the same defect"


class TestOverflowIsAudible:
    def test_a_full_queue_logs_the_reason_and_reports_the_depth(self, rag, caplog):
        rag._queue = asyncio.Queue(maxsize=1)
        with caplog.at_level(logging.WARNING, logger="alphaengine.rag"):
            for ref in ("job-1", "job-2", "job-3"):
                rag._offer(document(ref))

        assert rag.status()["dropped"] == 2
        warnings = [r for r in caplog.records if "queue full" in r.message]
        assert len(warnings) == 1, (
            "one line per burst, not one per dropped document — a warning printed "
            "a thousand times is a warning nobody reads"
        )
        assert "job-2" in caplog.text, "the drop must name what was dropped"

    def test_status_exposes_dead_letter_depth_without_exposing_identity(self, rag):
        text = str(rag.status())
        assert "dead_lettered" in text and "dead_letters_discarded" in text
        assert "supabase.co" not in text and "sb_secret" not in text
