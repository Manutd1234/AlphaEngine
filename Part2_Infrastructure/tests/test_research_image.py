"""The fourth retrieval arm, tested WITHOUT a vision model and without a network.

Every assertion here runs against fake encoders substituted at
``research_image._import_encoders``, deliberately and for
``tests/test_research_rerank.py``'s reasons. ``fastembed`` is an optional extra
that is not in ``requirements-dev.txt``, the CLIP pair is ~0.6 GB of weights,
and CI is network-free by construction — so a test that needed the real ONNX
models would not run at all, and it would fail to run on exactly the path that
matters most, which is the path where there is no model.

That path is the property this arm lives or dies by. It is OPTIONAL in the sense
the re-ranker is optional: with no model configured, no fastembed installed, or
no migration deployed, the three-arm ordering the desk serves today must come
back UNCHANGED — same rows, same order, nothing annotated — and the search must
say which of those it was in a FIELD rather than in prose. Half the tests below
are that one claim taken from different angles, because an optional arm that
degrades retrieval when it is absent is worse than no arm.

The other half is the claim that makes it worth having: the arm ADDS recall. It
fuses at the SAME k = 60 as the other three, every document the text arms found
keeps every contribution it had, and a document only the picture matched is
appended rather than substituted. That half lives in
``tests/test_research_image_fusion.py``, which was split from this file under
the ceiling ``tests/test_file_size.py`` enforces; this one is the ENCODER SEAM —
what happens when there is no model, and what is refused when there is.

NEVER A ZERO VECTOR is tested here rather than assumed. A 512-d zero is
equidistant from everything under cosine distance, so it does not fail — it
ranks as "similar" to every query ever asked, which is the failure this whole
package is built to make impossible.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from modules import research_image
from modules import research_image_ingest as ingest

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"
IMAGE_SQL = (MIGRATIONS / "20260822100000_research_image_embedding.sql").read_text()

#: A 1x1 PNG, base64'd — the same one ``tests/conftest.py`` uses. A real image,
#: so the base64 and PNG-decode branches are exercised by real bytes rather than
#: by a fake that would pass whatever it was handed.
PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

VECTOR = [0.02] * research_image.IMAGE_DIMENSIONS


class FakeImage:
    """What Pillow hands back. ``convert`` is the only method the code calls."""

    def __init__(self, mode: str = "RGBA") -> None:
        self.mode = mode

    def convert(self, mode: str) -> FakeImage:
        return FakeImage(mode)


class FakeImageLib:
    def __init__(self, raises: Exception | None = None) -> None:
        self.raises = raises
        self.opened = 0

    def open(self, handle: Any) -> FakeImage:
        self.opened += 1
        if self.raises is not None:
            raise self.raises
        return FakeImage()


def _cold(monkeypatch) -> None:
    """Forget any loaded pair and any remembered load failure.

    The cache is module state on purpose — it is what makes each model load once
    per process — so a test that did not clear it would inherit whatever the
    previous test installed and pass for the wrong reason.
    """
    monkeypatch.setattr(research_image, "_VISION", None)
    monkeypatch.setattr(research_image, "_TEXT", None)
    monkeypatch.setattr(research_image, "_IMAGE_LIB", None)
    monkeypatch.setattr(research_image, "_LOAD_ERROR", None)
    monkeypatch.setattr(research_image, "_LOAD_ERROR_STATE", None)
    monkeypatch.setattr(research_image, "_LOADED_PATH", None)


@pytest.fixture(autouse=True)
def _cold_module(monkeypatch):
    """Every test starts unloaded, UNCONFIGURED and with no floor.

    ``RESEARCH_IMAGE_MODEL_PATH`` is read into a module constant at import, and
    ``tests/conftest.py`` does not blank it the way it blanks
    ``RERANK_MODEL_PATH``. So a developer with it exported would otherwise run
    this suite in a different configuration from CI — which is the exact class
    of "passes here, fails there" the conftest assignments exist to stop.
    """
    _cold(monkeypatch)
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    monkeypatch.delenv("RESEARCH_IMAGE_MIN_SIMILARITY", raising=False)


def _install(monkeypatch, *, vectors=None, load_raises=None, embed_raises=None, image_lib=None):
    """Substitute a fake CLIP pair at the module's ONE import boundary.

    Returns a recorder so a test can assert how many times each model was
    CONSTRUCTED. The difference between a cached pair and one rebuilt per
    document is invisible in every report and very visible in the latency.
    """
    _cold(monkeypatch)
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "/models/clip")
    lib = image_lib if image_lib is not None else FakeImageLib()
    recorder = SimpleRecorder(lib)

    class FakeEncoder:
        def __init__(self, **kwargs):
            recorder.built += 1
            recorder.kwargs = kwargs
            if load_raises is not None:
                raise load_raises

        def embed(self, items):
            recorder.batches.append(list(items))
            if embed_raises is not None:
                raise embed_raises
            return iter(vectors if vectors is not None else [VECTOR])

    monkeypatch.setattr(
        research_image, "_import_encoders",
        lambda: (FakeEncoder, FakeEncoder, lib, None),
    )
    return recorder


class SimpleRecorder:
    def __init__(self, lib: Any) -> None:
        self.built = 0
        self.kwargs: dict[str, Any] | None = None
        self.batches: list[list[Any]] = []
        self.lib = lib


# --------------------------------------------------------------------------- #
# the seam: what happens when there is no model
# --------------------------------------------------------------------------- #
class TestAbsenceIsAStateAndNeverAZeroVector:
    def test_an_unconfigured_desk_reports_a_named_state_rather_than_embedding(self):
        assert research_image.configured() is False
        vector, state, reason = ingest.embed_image(PNG)
        assert vector is None and state == "pending"
        assert "RESEARCH_IMAGE_MODEL_PATH" in reason

    def test_a_document_with_no_image_is_absent_not_pending(self, monkeypatch):
        """'absent' and 'pending' are different instructions to the backfill.

        Most documents in this corpus have no picture. Calling that 'pending'
        would hand the backfill rows to chase forever, and a queue that can
        never empty is a queue nobody reads.
        """
        _install(monkeypatch)
        vector, state, _reason = ingest.embed_image(None)
        assert vector is None and state == "absent"
        assert set(IMAGE_SQL.split("image_embedding_status in (")[1].split(")")[0].replace(
            "'", "").replace(" ", "").split(",")) == {"absent", "pending", "ready", "failed"}

    def test_fastembed_missing_is_pending_and_says_how_to_fix_it(self, monkeypatch):
        _cold(monkeypatch)
        monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "/models/clip")
        monkeypatch.setattr(
            research_image, "_import_encoders",
            lambda: (None, None, None, "the fastembed package is not installed"),
        )
        vector, state, reason = ingest.embed_image(PNG)
        assert vector is None and state == "pending", "the image is fine; the environment is not"
        assert "fastembed" in reason

    def test_an_all_zero_vector_is_refused_rather_than_stored(self, monkeypatch):
        """The defect this package is most alert to, in a new column.

        A zero vector is equidistant from everything under cosine distance, so
        it never fails — it comes back as "similar" to whatever was asked.
        """
        _install(monkeypatch, vectors=[[0.0] * research_image.IMAGE_DIMENSIONS])
        vector, state, _reason = ingest.embed_image(PNG)
        assert vector is None and state == "failed"

    def test_a_vector_of_the_wrong_width_is_refused(self, monkeypatch):
        """jina-clip-v1 is 768-d. The column is 512. Caught here, not at INSERT."""
        _install(monkeypatch, vectors=[[0.3] * 768])
        vector, state, _reason = ingest.embed_image(PNG)
        assert vector is None and state == "failed"

    def test_a_payload_that_is_not_a_png_fails_rather_than_pending(self, monkeypatch):
        """'failed' because retrying will not help — the image is the problem."""
        _install(monkeypatch)
        vector, state, _reason = ingest.embed_image("not base64 at all !!")
        assert vector is None and state == "failed"

    def test_an_oversized_payload_is_refused_before_it_is_decoded(self, monkeypatch):
        recorder = _install(monkeypatch)
        vector, state, _reason = ingest.embed_image("A" * (ingest.MAX_PNG_B64_CHARS + 4))
        assert vector is None and state == "failed"
        assert recorder.lib.opened == 0, "a refusal must not cost the decode it refused"

    def test_the_pair_is_built_once_and_the_png_reaches_it_as_rgb(self, monkeypatch):
        recorder = _install(monkeypatch)
        vector, state, reason = ingest.embed_image(PNG)
        assert state == "ready" and reason == ""
        assert vector == VECTOR and len(vector) == 512
        ingest.embed_image(PNG)
        assert recorder.built == 2, "two models, built once each, not once per document"
        assert recorder.kwargs is not None and recorder.kwargs["cache_dir"] == "/models/clip"
        assert [img.mode for batch in recorder.batches for img in batch] == ["RGB", "RGB"]

    def test_a_load_failure_is_remembered_rather_than_retried(self, monkeypatch):
        recorder = _install(monkeypatch, load_raises=OSError("no such directory"))
        assert ingest.embed_image(PNG)[1] == "pending"
        assert ingest.embed_image(PNG)[1] == "pending"
        assert recorder.built == 1, (
            "retrying a missing model directory per document turns one "
            "misconfiguration into a per-document stall"
        )


# --------------------------------------------------------------------------- #
# the query side: the TEXT half of the same pair, and nothing else
# --------------------------------------------------------------------------- #
class TestTheQueryIsEmbeddedByTheTextHalfOfTheSamePair:
    def test_the_two_model_names_are_the_two_halves_of_one_clip_pair(self):
        """The shared space is the mechanism; a mismatched pair is silent noise."""
        assert research_image.IMAGE_MODEL_VISION.endswith("-vision")
        assert research_image.IMAGE_MODEL_TEXT.endswith("-text")
        assert (
            research_image.IMAGE_MODEL_VISION.rsplit("-", 1)[0]
            == research_image.IMAGE_MODEL_TEXT.rsplit("-", 1)[0]
        )

    def test_the_query_goes_to_the_text_encoder_as_text(self, monkeypatch):
        recorder = _install(monkeypatch)
        vector, report = research_image.embed_query("a curve that spikes then flattens")
        assert report is None and vector == VECTOR
        assert recorder.batches[-1] == ["a curve that spikes then flattens"]

    def test_an_empty_query_is_a_named_state_not_an_embedding(self, monkeypatch):
        _install(monkeypatch)
        vector, report = research_image.embed_query("   ")
        assert vector is None and report["state"] == "empty" and report["ranked"] is False
