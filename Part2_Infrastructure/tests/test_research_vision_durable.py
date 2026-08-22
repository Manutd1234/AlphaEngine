"""The chart survives the process that drew it — and stays out of every search.

`research_generate_vision` could show a model the equity curve only while the
`JobRecord` that carried the PNG was still in this process's memory. That is the
in-process pool on a laptop. Under the Celery backend the record belongs to a
worker; after a restart it belongs to nobody; on a second gateway replica it
never existed. So the state `job_not_retained` was not an edge case, it was the
normal answer on every deployment that scales, and the feature was effectively
absent exactly where it was wanted.

This suite pins the two halves of the fix against each other:

* the pixels are REACHABLE from the corpus row, so a chart drawn by a process
  that is gone still reaches the model;
* the pixels are UNREACHABLE from retrieval, which is the hard constraint. A
  measured equity-curve PNG is 150,111 bytes; a search that returned forty chart
  documents must transfer exactly what it transferred before this existed.

The second is checked structurally rather than by inspection, because "we
remembered not to select it" is not a property. The bytes are in a side table,
one request in the whole gateway names that table, and that request is a lookup
by primary key for one document about to be shown to a model.

Offline, like everything that touches this module: no key, no network, no SDK.
`_CLIENT` is replaced with a fake, which is the seam `research_image_store`
documents as such — the module builds its client lazily through `_client()`
precisely so a test can put one there.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from modules import research_generate_vision as vision
from modules import research_image_store as store

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"
MODULES = Path(__file__).resolve().parent.parent / "modules"
IMAGE_SQL = (MIGRATIONS / "20260822110000_research_chart_images.sql").read_text()

#: A 1x1 PNG, base64'd — the same one `tests/conftest.py` uses. A real image, so
#: the decode branches are exercised by real bytes rather than by a fake that
#: would pass whatever it was handed.
ENCODED = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
VISION_MODEL = "gemini-2.5-flash"
DOC_ID = "11111111-2222-3333-4444-555555555555"


def chart(**over: Any) -> dict[str, Any]:
    """A chart document exactly as retrieval hands one to the generator."""
    base = {
        "id": DOC_ID,
        "kind": "chart",
        # A job id no queue in this process has ever heard of — which IS the
        # Celery case, the restart case and the second-replica case.
        "source_ref": "job-gone-77:equity_curve",
        "metrics": {"chart": "equity_curve"},
        "title": "Equity curve: BTCUSDT 4h ma_cross",
        "body": "The equity curve ends at 1.03x after a 14.7% maximum drawdown.",
    }
    base.update(over)
    return base


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: Any = None, text: str | None = None):
        self.status_code = status_code
        self._payload = payload
        self._text = text

    def json(self) -> Any:
        if self._text is not None:
            raise ValueError("not JSON")
        return self._payload


class FakeClient:
    """The Supabase side of the wire, and nothing else.

    Records every request so the hard-constraint tests can assert on WHAT was
    asked for rather than only on what came back — a fetch that quietly grew a
    `select=*` would still return the right bytes and would be the defect.
    """

    def __init__(self, *responses: Any):
        self.responses = list(responses)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def close(self) -> None:
        """`store.reset()` closes the client it is dropping; a fake that could
        not be closed would make every teardown an error."""

    def get(self, url: str, params: dict[str, Any] | None = None) -> Any:
        self.calls.append((url, dict(params or {})))
        answer = self.responses.pop(0) if self.responses else FakeResponse(200, [])
        if isinstance(answer, Exception):
            raise answer
        return answer


def stored(png: str = ENCODED) -> FakeResponse:
    return FakeResponse(200, [{"png_b64": png}])


@pytest.fixture(autouse=True)
def cold():
    """No cache, no client, no remembered 404 — before AND after every test.

    Module state is what makes this store cheap; it is also what makes a suite
    pass for the wrong reason when one test inherits the previous one's cache.
    """
    store.reset()
    yield
    store.reset()


@pytest.fixture
def configured(monkeypatch):
    """A desk with a corpus. Returns the fake wire the store will read."""
    def install(*responses: Any) -> FakeClient:
        monkeypatch.setattr(store, "settings", SimpleNamespace(
            supabase_url="https://corpus.example.invalid",
            supabase_service_role_key="service-role-not-a-real-one",
        ))
        client = FakeClient(*responses)
        monkeypatch.setattr(store, "_CLIENT", client)
        return client
    return install


def images_of(doc: dict[str, Any]) -> tuple[list[Any], list[dict[str, Any]]]:
    return vision.resolve([doc], model=VISION_MODEL)


class TestTheLimitThatIsClosed:
    def test_a_chart_whose_job_is_gone_now_reaches_the_model(self, configured):
        """The whole point. No job record, and the model still sees the chart."""
        wire = configured(stored())
        attachments, notes = images_of(chart())

        assert [n["state"] for n in notes] == [vision.ATTACHED], notes
        assert len(attachments) == 1 and attachments[0].document_id == DOC_ID
        assert attachments[0].chart == "equity_curve"
        assert len(wire.calls) == 1, "one lookup, for one document"

    def test_an_unconfigured_desk_reports_exactly_what_it_reported_before(self, monkeypatch):
        """A configured store may only improve the answer, never change it.

        With no corpus there is nothing new to ask, so the state is the job
        path's own — the same string, and the same fix it points an operator at.
        """
        monkeypatch.setattr(store, "settings", SimpleNamespace(
            supabase_url="", supabase_service_role_key="",
        ))
        _, notes = images_of(chart())
        assert [n["state"] for n in notes] == [vision.JOB_NOT_RETAINED]

    def test_a_corpus_that_holds_no_image_says_so_and_says_what_would_fix_it(self, configured):
        """`image_not_stored` is a different FACT from `job_not_retained`.

        One means the run's process is gone; this one means the corpus was
        written before the images were, and re-indexing is the fix. A single
        state for both would send a reader looking for a restart.
        """
        configured(FakeResponse(200, []))
        _, notes = images_of(chart())
        assert [n["state"] for n in notes] == [vision.IMAGE_NOT_STORED]
        assert "re-indexing" in notes[0]["reason"]

    def test_a_store_that_cannot_be_read_is_not_a_store_that_is_empty(self, configured):
        import httpx

        configured(httpx.ConnectError("no route"))
        _, notes = images_of(chart())
        assert [n["state"] for n in notes] == [vision.IMAGE_STORE_UNREACHABLE]
        assert "says nothing about whether the image exists" in notes[0]["reason"]

    def test_an_html_error_page_served_as_200_is_a_state_not_a_traceback(self, configured):
        configured(FakeResponse(200, None, text="<html>502</html>"))
        _, notes = images_of(chart())
        assert [n["state"] for n in notes] == [vision.IMAGE_STORE_UNREACHABLE]

    def test_a_deployment_without_the_migration_asks_once_and_then_stops(self, configured):
        """The rollout property, and it must not cost a request per answer."""
        wire = configured(FakeResponse(404), stored())
        assert [n["state"] for n in images_of(chart())[1]] == [vision.IMAGE_NOT_STORED]
        # The second answer must not go back to a database that already said no,
        # even though a PNG is now sitting on the wire waiting to be handed over.
        assert [n["state"] for n in images_of(chart())[1]] == [vision.JOB_NOT_RETAINED]
        assert len(wire.calls) == 1

    def test_the_job_record_is_still_the_fast_path(self, configured, monkeypatch):
        """Adding a fallback must not make a healthy single process slower."""
        from modules.jobs import JobRecord, get_queue

        record = JobRecord(job_id="job-live", kind="backtest", backend="in-process")
        record.result = {"equity_curve_png": ENCODED}
        monkeypatch.setitem(get_queue()._jobs, "job-live", record)
        wire = configured()

        attachments, notes = images_of(chart(source_ref="job-live:equity_curve"))
        assert [n["state"] for n in notes] == [vision.ATTACHED]
        assert attachments and wire.calls == [], "the corpus was not asked at all"


class TestTheStallIsPaidAtMostOncePerChart:
    def test_a_second_answer_about_the_same_chart_makes_no_second_request(self, configured):
        wire = configured(stored())
        for _ in range(3):
            assert [n["state"] for n in images_of(chart())[1]] == [vision.ATTACHED]
        assert len(wire.calls) == 1

    def test_the_write_path_warming_the_cache_means_no_request_at_all(self, configured):
        """A gateway that ingested the sweep never touches the blocking path."""
        wire = configured()
        store.remember(DOC_ID, ENCODED)
        assert [n["state"] for n in images_of(chart())[1]] == [vision.ATTACHED]
        assert wire.calls == []

    def test_the_cache_is_bounded_and_evicts_the_least_recently_used(self):
        for index in range(store.CACHE_MAX + 2):
            store.remember(f"doc-{index}", ENCODED)
        assert len(store._CACHE) == store.CACHE_MAX
        assert store.cached("doc-0") is None, "the oldest is the one that goes"
        assert store.cached(f"doc-{store.CACHE_MAX + 1}") == ENCODED

    def test_turning_the_fetch_off_leaves_the_free_sources_working(self, configured, monkeypatch):
        """An operator who wants the loop back keeps the cache and the queue."""
        monkeypatch.setattr(store, "FETCH_TIMEOUT_MS", 0)
        wire = configured(stored())
        assert [n["state"] for n in images_of(chart())[1]] == [vision.JOB_NOT_RETAINED]
        assert wire.calls == []
        store.remember(DOC_ID, ENCODED)
        assert [n["state"] for n in images_of(chart())[1]] == [vision.ATTACHED]


class TestRetrievalNeverDragsImageBytes:
    def test_exactly_one_request_in_the_gateway_names_the_image_table(self):
        """The hard constraint, checked structurally rather than by intention.

        If a second module learns this table's name, the property stops being
        "one lookup by primary key" and becomes "whatever those callers do".
        """
        named = sorted(
            path.name for path in MODULES.rglob("*.py")
            if store.TABLE in path.read_text()
        )
        assert named == ["research_image_store.py"], named

    def test_the_lookup_is_by_primary_key_and_selects_one_column(self, configured):
        wire = configured(stored())
        images_of(chart())
        url, params = wire.calls[0]
        assert url == store.TABLE
        assert params["document_id"] == f"eq.{DOC_ID}"
        assert params["select"] == "png_b64", "a select=* here would be the defect"
        assert params["limit"] == "1"

    def test_the_bytes_are_not_a_column_on_the_table_retrieval_reads(self):
        body = "\n".join(
            line for line in IMAGE_SQL.splitlines() if not line.lstrip().startswith("--")
        )
        assert "alter table public.research_documents" not in body.lower(), (
            "a column on research_documents is one forgetful projection away from "
            "every search payload — that is the rejected alternative (a)"
        )
        assert "create table if not exists public.research_chart_images" in body

    def test_no_retrieval_function_can_name_the_image_table(self):
        """Each RPC declares an explicit `returns table` over the corpus alone."""
        for name in (
            "20260808120500_match_research_documents.sql",
            "20260810090000_hybrid_research_search.sql",
            "20260822100000_research_image_embedding.sql",
        ):
            assert "research_chart_images" not in (MIGRATIONS / name).read_text(), name

    def test_the_image_row_dies_with_the_document_it_describes(self):
        assert "on delete cascade" in IMAGE_SQL, (
            "a 200-kilobyte orphan nothing can name becomes the largest table here"
        )

    def test_a_browser_is_not_granted_the_table_at_all(self):
        body = "\n".join(
            line for line in IMAGE_SQL.splitlines() if not line.lstrip().startswith("--")
        )
        assert "revoke all on public.research_chart_images from anon, authenticated;" in body
        assert "create policy" not in body.lower(), (
            "a policy with no grant behind it is a capability with no caller, and "
            "the next reader would take it as evidence the browser path was intended"
        )
        assert "enable row level security" in body


class TestTheTwoHalvesCannotDisagree:
    def test_the_chart_map_is_one_object_and_not_two_copies(self):
        assert vision.CHART_IMAGE_KEYS is store.CHART_PNG_FIELDS, (
            "two dicts spelled the same way drift silently: an image stored that "
            "no reader can use, or asked for that nobody was told to store"
        )

    def test_every_state_the_store_can_return_has_a_sentence_in_the_report(self):
        for state in store.REASONS:
            assert vision.REASONS.get(state), state

    def test_a_stored_payload_larger_than_the_bound_is_refused_not_truncated(self, configured):
        configured(stored("A" * (store.MAX_PNG_B64_CHARS + 4)))
        _, notes = images_of(chart())
        assert [n["state"] for n in notes] == [vision.IMAGE_NOT_STORED]

    def test_a_stored_payload_that_is_not_base64_is_named_and_never_sent(self, configured):
        configured(stored("not base64 at all!!"))
        attachments, notes = images_of(chart())
        assert attachments == []
        assert [n["state"] for n in notes] == [vision.IMAGE_UNDECODABLE]


class TestItIsWiredToThePathThatActuallyAnswers:
    """The scar, checked once more at the seam this change moved.

    `research_generate` arrived with twenty tests and no caller. Image
    resolution takes that shape again: `research_generate_vision` resolves the
    picture itself, so nothing upstream had to learn that charts exist — which
    is the right design and also the design under which nobody notices the
    resolution is never reached. Everything above asks `resolve` directly; this
    asks the real `research_crag`, which calls the real `research_stages`, which
    calls the real `research_generate`, and asserts the PIXELS arrive at the
    provider having come from the corpus rather than from any job queue.
    """

    async def test_a_chart_from_a_process_that_is_gone_reaches_the_provider(
        self, configured, monkeypatch,
    ):
        import research_seam as seam
        from research_seam import Corpus, answer
        from test_research_generate_multimodal import FULL_TYPES, FakeSdk

        from modules import research_generate as gen

        seam.absent(monkeypatch)
        wire = configured(stored())
        # `research_seam.row` supplies the fields retrieval really returns; the
        # chart fields are this document's own.
        chart_row = seam.row(
            "sweep-1", id=DOC_ID, kind="chart", source_ref="job-gone-77:equity_curve",
            metrics={"chart": "equity_curve"},
            title="Equity curve: BTCUSDT ma_crossover drawdown sweep",
        )
        # No bare figure: fence 3 refuses a number that is not quoted from a
        # document, and a refusal there would read as a multimodal defect when
        # it is the citation fence doing exactly its job.
        fake = FakeSdk(text=f"The curve climbs steadily and recovers [doc:{DOC_ID}].")
        monkeypatch.setattr(gen, "settings", SimpleNamespace(
            gemini_api_key="test-key-not-a-real-one", gemini_model=VISION_MODEL,
        ))
        monkeypatch.setattr(gen, "_sdk", lambda: (fake, FULL_TYPES, None))

        result = await answer(Corpus([[chart_row]]))

        assert result.generation["verdict"] == gen.ANSWERED, result.generation["reason"]
        ledger = result.generation["images"]
        assert [(n["document_id"], n["chart"], n["state"]) for n in ledger] == [
            (DOC_ID, "equity_curve", vision.ATTACHED)
        ], ledger
        parts = fake.calls[0]["contents"]
        import base64 as _b64
        assert len(parts) == 2 and parts[1].inline_data.data == _b64.b64decode(ENCODED), (
            "the pixels must arrive at the provider, and they must be the ones the "
            "corpus stored — the job queue never held this run"
        )
        assert len(wire.calls) == 1
