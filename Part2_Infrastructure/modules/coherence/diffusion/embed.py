"""Text into vectors, behind one seam, with the absence reported rather than raised.

The encoder is `fastembed` over ONNX on the CPU — already in this repository's
optional set for the re-ranker, already downloaded as weights rather than
committed, and small enough that a statement embeds in milliseconds. There is
no torch here and none is needed.

`_import_encoder` is THE seam, in the shape `research_rerank` uses: one lazy
function returning `(thing, reason)`, substituted by tests and by nothing else.
An absent encoder is a state with a reason, in the same shape as an unset
environment variable, and never an exception out of an import.

CHUNKING, AND WHY IT IS MEAN-POOLED. A statement runs past the model's window,
so it is split on paragraph boundaries and the chunk vectors are averaged. That
loses the order of the paragraphs, which for this measurement is acceptable and
worth saying out loud: the instrument asks at what RESOLUTION one text explains
another, not where in the text the explanation sits. Localisation was dropped
from the design deliberately — the published attribution result it rested on
turned out to be attention plus information rather than information alone.

A failed embed stores nothing. Never a zero vector: a zero vector is
equidistant from everything and would read as a document similar to every
query, which is the defect this repository states three times in its own
migrations.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

EmbedState = Literal["ok", "unconfigured", "unavailable", "empty"]

#: 384 dimensions, the same width as the corpus's own text space, so a latent
#: fitted here and one fitted there are at least commensurable in size.
MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIMENSIONS = 384

#: Characters, not tokens: an approximation, and a deliberately conservative
#: one. The model's window is 512 tokens and English averages about four
#: characters a token, so 1,400 leaves room for the tokeniser to disagree.
CHUNK_CHARS = 1_400


@dataclass(frozen=True)
class Embedded:
    """One document's vector, or the reason there is not one."""

    state: EmbedState
    vector: np.ndarray | None = None
    chunks: int = 0
    model: str | None = None
    reason: str | None = None


def _import_encoder() -> tuple[Any, str | None]:
    """The one seam. Tests substitute this and nothing else."""
    try:
        from fastembed import TextEmbedding
    except ImportError:
        return None, ("the fastembed package is not installed "
                      "(pip install -r requirements-rerank.txt)")
    return TextEmbedding, None


def chunk(text: str, *, size: int = CHUNK_CHARS) -> list[str]:
    """Paragraph-aligned chunks under the window, in order.

    Split on blank lines first so a chunk boundary lands between paragraphs
    rather than mid-sentence; only a paragraph that is itself over the window
    is cut by length.
    """
    paragraphs = [part.strip() for part in text.split("\n") if part.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        while len(paragraph) > size:
            chunks.append(paragraph[:size])
            paragraph = paragraph[size:]
        if not current:
            current = paragraph
        elif len(current) + 1 + len(paragraph) <= size:
            current = f"{current} {paragraph}"
        else:
            chunks.append(current)
            current = paragraph
    if current:
        chunks.append(current)
    return chunks or ([text[:size]] if text.strip() else [])


class TextEncoder:
    """A lazily-constructed encoder that reports its own absence."""

    def __init__(self, *, model: str = MODEL_NAME, cache_dir: str | None = None) -> None:
        self._model_name = model
        self._cache_dir = cache_dir
        self._encoder: Any | None = None
        self._reason: str | None = None
        self._state: EmbedState = "ok"

    def _ensure(self) -> bool:
        if self._encoder is not None:
            return True
        if self._reason is not None:
            return False
        factory, reason = _import_encoder()
        if factory is None:
            self._reason, self._state = reason, "unconfigured"
            return False
        try:
            kwargs = {"cache_dir": self._cache_dir} if self._cache_dir else {}
            self._encoder = factory(model_name=self._model_name, **kwargs)
        except Exception as exc:  # noqa: BLE001 - the reason is the answer
            self._reason, self._state = str(exc), "unavailable"
            return False
        return True

    @property
    def reason(self) -> str | None:
        return self._reason

    def embed(self, text: str) -> Embedded:
        """One document, mean-pooled over its chunks, L2 normalised."""
        if not text or not text.strip():
            return Embedded("empty", reason="the document is empty, so there is nothing to embed")
        if not self._ensure():
            return Embedded(self._state, reason=self._reason)
        pieces = chunk(text)
        try:
            vectors = np.asarray(list(self._encoder.embed(pieces)), dtype=np.float64)
        except Exception as exc:  # noqa: BLE001
            return Embedded("unavailable", reason=str(exc))
        if vectors.size == 0:
            return Embedded("unavailable", chunks=len(pieces),
                            reason="the encoder returned no vectors for a non-empty document")
        pooled = vectors.mean(axis=0)
        norm = float(np.linalg.norm(pooled))
        if norm == 0.0:
            # Not normalised to zero and not stored: a zero vector is
            # equidistant from everything and reads as similar to any query.
            return Embedded("unavailable", chunks=len(pieces),
                            reason="the pooled vector has no length, so it carries no direction")
        return Embedded("ok", vector=pooled / norm, chunks=len(pieces), model=self._model_name)
