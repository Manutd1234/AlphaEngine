"""The ingest half: the picture is stored, and it never reaches the corpus row.

The sibling of `tests/test_research_vision_durable.py`, split from it for the
400-line ceiling and kept apart for a better reason: that file asks what a
READER can reach, and this one asks what a WRITER puts where. The two halves
fail differently. A broken read is an answer with no picture, which is honest
and visible. A broken write is 200 kilobytes of base64 arriving in a column
nothing meant it to be in, which is invisible until a corpus panel ships four
megabytes to a browser that asked for twenty titles.

So the assertions here are mostly about ABSENCE — what is NOT in the row that
PostgREST is handed. That row is built in `research_rag.writer._index_one`, and
the private `_chart_png` key has to be popped from the document before it is
built, exactly as `_retrieve_after` and `_image_png` are. A key that survived
would be answered 400 and would dead-letter the document: the picture would take
the sweep down with it.

Offline: the corpus is a fake, and `render_backtest_documents` is given a plain
namespace rather than a real `BacktestResult`, which is also the replay shape
the renderer promises never to raise on.
"""

from __future__ import annotations

import base64
import hashlib
from types import SimpleNamespace
from typing import Any

import pytest

from modules import research_image_store as store
from modules import research_image_store_write as writes
from modules.research_cards import render_backtest_documents

ENCODED = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PIXELS = base64.b64decode(ENCODED)
DOC_ID = "11111111-2222-3333-4444-555555555555"

RESULT = SimpleNamespace(
    request=SimpleNamespace(symbol="BTCUSDT", interval="4h", strategy="ma_cross"),
    engine="numpy", combos_tested=74, data_hash="8e43f5f7", job_id="job-1",
    best=SimpleNamespace(
        fast=20, slow=80, sharpe=0.24, total_return=0.026, max_drawdown=-0.147,
        trades=30, exposure=0.45,
    ),
    benchmark_buy_hold={"total_return": -0.41},
    deflated_sharpe_ratio=0.228, walk_forward_oos_sharpe=-0.02, pbo=0.61,
    walk_forward=[SimpleNamespace(oos_sharpe=s) for s in (0.4, -0.1, 0.2)],
    equity_curve_png=ENCODED,
    heatmap_png="aGVhdG1hcA==",
)


class FakeResponse:
    def __init__(self, status_code: int = 201, payload: Any = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else [{"id": DOC_ID}]

    def json(self) -> Any:
        return self._payload


class FakeWire:
    """The async Supabase client, recording every write."""

    def __init__(self, *answers: Any):
        self.answers = list(answers)
        self.posts: list[tuple[str, dict[str, Any], dict[str, str]]] = []

    async def post(self, url: str, json: dict[str, Any], headers: Any = None) -> Any:
        self.posts.append((url, json, dict(headers or {})))
        if not self.answers:
            return FakeResponse()
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture(autouse=True)
def cold():
    store.reset()
    yield
    store.reset()


def equity_document() -> dict[str, Any]:
    charts = [d for d in render_backtest_documents(RESULT) if d["kind"] == "chart"]
    return next(d for d in charts if d["metrics"]["chart"] == "equity_curve")


class TestWhatTheRendererAttaches:
    def test_the_equity_document_carries_its_own_rendered_figure(self):
        assert equity_document()[store.CHART_PNG_FIELD] == ENCODED

    def test_only_the_chart_the_desk_actually_draws_gets_a_picture(self):
        """A picture filed under a document that is not a picture of it is the
        confident wrong answer this plane exists to refuse.

        The drawdown is a subplot inside the equity figure and the fold table is
        text, so pointing either at `equity_curve_png` would put an image under
        a document whose sentence describes something else. The rendered Sharpe
        heatmap is the mirror image of the problem: it exists, no chart document
        describes it, and an image with no citable document is one the generator
        refuses to send — so it is not carried either.
        """
        documents = render_backtest_documents(RESULT)
        carried = {
            d["source_ref"] for d in documents if store.CHART_PNG_FIELD in d
        }
        assert carried == {"job-1:equity_curve"}, carried

    def test_a_run_that_rendered_nothing_yields_documents_without_pictures(self):
        bare = SimpleNamespace(**{
            k: v for k, v in RESULT.__dict__.items()
            if k not in ("equity_curve_png", "heatmap_png")
        })
        documents = render_backtest_documents(bare)
        assert documents, "a sweep that finished is indexed whether or not it drew"
        assert all(store.CHART_PNG_FIELD not in d for d in documents)

    def test_the_embedded_text_is_untouched_by_carrying_a_picture(self):
        """`body` IS the stored vector's meaning; a picture may not change it."""
        document = equity_document()
        assert document["body"].startswith("Equity curve: BTCUSDT 4h ma_cross\n")
        assert ENCODED not in document["body"] and ENCODED not in document["title"]


class TestTheCorpusRowNeverCarriesTheBytes:
    async def test_the_drain_pops_the_picture_before_it_builds_the_row(self, monkeypatch):
        """The assertion the whole design rests on, made against the real drain.

        `_index_one` is the only place a research row is assembled. If the
        private key survived into it, PostgREST would answer 400 — the picture
        would dead-letter the sweep that drew it.
        """
        from modules.research_rag import writer as writer_module

        rag = writer_module.ResearchRag()
        rag.enabled = True
        wire = FakeWire()
        rag._client = wire
        monkeypatch.setattr(writer_module, "settings", SimpleNamespace(
            supabase_desk_id="00000000-0000-0000-0000-000000000001",
            supabase_url="https://corpus.example.invalid",
            supabase_service_role_key="service-role-not-a-real-one",
        ))
        monkeypatch.setattr(store, "settings", writer_module.settings)

        async def no_vector(_text: str) -> None:
            return None

        monkeypatch.setattr(rag, "_embed", no_vector)
        monkeypatch.setattr(writer_module, "persist_edges", _no_edges)

        await rag._index_one(dict(equity_document()))

        document_post = next(p for p in wire.posts if "research_documents" in p[0])
        row = document_post[1]
        assert store.CHART_PNG_FIELD not in row
        assert not any(isinstance(v, str) and v == ENCODED for v in row.values()), (
            "no column on research_documents may carry the image, under any name"
        )
        # And the picture went somewhere: a second request, a different table.
        assert any(p[0] == store.TABLE for p in wire.posts)

    async def test_a_document_with_no_picture_writes_no_image_row(self, monkeypatch):
        from modules.research_rag import writer as writer_module

        rag = writer_module.ResearchRag()
        rag.enabled = True
        wire = FakeWire()
        rag._client = wire
        monkeypatch.setattr(writer_module, "settings", SimpleNamespace(
            supabase_desk_id="00000000-0000-0000-0000-000000000001",
        ))
        monkeypatch.setattr(writer_module, "persist_edges", _no_edges)

        async def no_vector(_text: str) -> None:
            return None

        monkeypatch.setattr(rag, "_embed", no_vector)
        await rag._index_one({"kind": "risk_incident", "source_ref": "order-1", "body": "x"})
        assert [p[0] for p in wire.posts] == ["/rest/v1/research_documents"]


async def _no_edges(*_args: Any, **_kwargs: Any) -> int:
    return 0


class TestWhatIsStoredAboutTheStoredImage:
    async def test_the_row_is_keyed_to_the_document_and_digests_the_real_bytes(self):
        wire = FakeWire()
        document = equity_document()
        assert await writes.persist_chart_image(wire, FakeResponse(), ENCODED, document)

        url, row, headers = wire.posts[0]
        assert url == store.TABLE
        assert row["document_id"] == DOC_ID
        assert row["source_ref"] == "job-1:equity_curve" and row["chart"] == "equity_curve"
        assert row["png_b64"] == ENCODED
        # Over the DECODED bytes, so the digest means the same thing if these
        # bytes ever move to Storage — the migration's `storage_path` door.
        assert row["byte_length"] == len(PIXELS)
        assert row["sha256"] == hashlib.sha256(PIXELS).hexdigest()
        assert row["sha256"] != hashlib.sha256(ENCODED.encode()).hexdigest()
        assert "return=minimal" in headers.get("Prefer", "")

    async def test_a_successful_write_warms_the_cache_it_just_filled(self):
        wire = FakeWire()
        await writes.persist_chart_image(wire, FakeResponse(), ENCODED, equity_document())
        assert store.cached(DOC_ID) == ENCODED, (
            "the gateway that ingested the sweep must never pay the blocking fetch"
        )

    async def test_a_failed_write_does_not_leave_the_cache_claiming_success(self):
        wire = FakeWire(FakeResponse(500))
        assert not await writes.persist_chart_image(wire, FakeResponse(), ENCODED, equity_document())
        assert store.cached(DOC_ID) is None

    async def test_a_duplicate_document_writes_no_image_rather_than_inventing_a_key(self):
        """`resolution=ignore-duplicates` returns an EMPTY representation.

        There is no id to key an image to, and the image was stored when the
        document was first written. Inventing one would hang 200 kilobytes off
        a row nothing points at.
        """
        wire = FakeWire()
        assert not await writes.persist_chart_image(wire, FakeResponse(201, []), ENCODED, {})
        assert wire.posts == []

    async def test_a_payload_that_is_not_base64_is_never_written(self):
        wire = FakeWire()
        assert not await writes.persist_chart_image(
            wire, FakeResponse(), "not base64 at all!!", equity_document()
        )
        assert wire.posts == [], "a row a reader cannot decode is worse than no row"

    async def test_a_payload_over_the_bound_is_refused_rather_than_stored(self):
        wire = FakeWire()
        assert not await writes.persist_chart_image(
            wire, FakeResponse(), "A" * (store.MAX_PNG_B64_CHARS + 4), equity_document()
        )
        assert wire.posts == []


class TestIndexingIsNeverFailedByItsOwnPicture:
    async def test_a_deployment_without_the_migration_indexes_and_stops_asking(self):
        """404 on the image table alone. The corpus keeps ingesting.

        This is the isolation the side table buys and a column could not: a new
        column on `research_documents` would have made the same deployment
        answer 400 to the DOCUMENT insert and dead-letter every research row.
        """
        wire = FakeWire(FakeResponse(404), FakeResponse(404))
        document = equity_document()
        assert not await writes.persist_chart_image(wire, FakeResponse(), ENCODED, document)
        assert store._Rollout.table_absent
        # And it does not ask again for the life of the process.
        assert not await writes.persist_chart_image(wire, FakeResponse(), ENCODED, document)
        assert len(wire.posts) == 1

    async def test_an_unreachable_corpus_is_a_log_line_and_a_false(self):
        import httpx

        wire = FakeWire(httpx.ConnectError("no route"))
        assert not await writes.persist_chart_image(
            wire, FakeResponse(), ENCODED, equity_document()
        )

    async def test_a_response_that_is_not_json_does_not_raise(self):
        class Broken:
            def json(self) -> Any:
                raise ValueError("not JSON")

        wire = FakeWire()
        assert not await writes.persist_chart_image(wire, Broken(), ENCODED, equity_document())
        assert wire.posts == []
