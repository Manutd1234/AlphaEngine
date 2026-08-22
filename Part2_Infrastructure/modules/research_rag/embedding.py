"""The embed call, and the one failure mode that used to kill the ingest loop.

``_EmbeddingMixin`` is the base of ``retrieval._RetrievalMixin`` rather than a
third file's worth of free functions, because the call needs ``self._client``
and nothing else. It was split out under the file-length ceiling
``tests/test_file_size.py`` enforces — ``retrieval.py`` had no room left for the
tenant scope and this hardening in the same change — and the split falls where
the package's own docstring says it does: embedding is one question, retrieval
is another, and only the second has arms and reports.

``EMBEDDING_DIMENSIONS`` and ``EMBEDDING_MODEL`` live here now, at the one place
that can actually violate them, and are re-exported from ``retrieval`` because
``modules/research_rag/__init__.py``, ``writer.py`` and three suites import them
from there.

THE HONESTY RULE THIS FILE CARRIES: an embed that fails returns ``None``, never
a zero vector. A zero vector is equidistant from everything and would be
returned as "similar" to any query — a failure that reads exactly like a
success, which is the one outcome this whole package is built to avoid.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from modules.research_rag.arms import REASON_UNPARSEABLE_BODY

log = logging.getLogger("alphaengine.rag")

EMBEDDING_DIMENSIONS = 384
EMBEDDING_MODEL = "gte-small"


class _EmbeddingMixin:
    """The embed half of ``ResearchRag``; see ``writer.ResearchRag``."""

    _client: httpx.AsyncClient | None

    async def embed_many(self, texts: list[str]) -> list[list[float]] | None:
        """Vectors for every text in one call, or None if any of it is unusable.

        All-or-nothing on purpose. A partial result would leave the caller
        pairing vectors with the wrong texts unless it also tracked which
        positions failed, and a silently misaligned embedding is the failure
        mode this whole module is built to avoid: it returns confident
        neighbours that mean nothing.

        One round trip. `embed-research` accepts up to 32 texts and the write
        path used to send them one at a time, so a backfill of N documents cost
        N round trips to a function that could have taken them in batches.

        A 200 WHOSE BODY WILL NOT PARSE IS AN EMBED FAILURE, and until now it
        was an uncaught exception. This method caught ``httpx.HTTPError`` only.
        The failure that actually happened in production shape was a proxy in
        front of `embed-research` serving an HTML 502 page under a 200 status:
        ``status_code >= 300`` is False, ``response.json()`` raises
        ``json.JSONDecodeError`` — a ``ValueError``, not an httpx error — and it
        went straight out of here, past every ``except`` in the package, and
        killed the ingest drain's loop. ``writer.py::_drain`` was hardened to
        survive that and must STAY hardened, because the next unhandled type
        will not be this one. But a dead letter is the wrong outcome here: the
        document is good and the embedder is temporarily lying, so returning
        None makes the row ``embedding_status='pending'`` and the backfill tool
        re-embeds it. A dead letter needs a human; a pending row needs a retry.

        The reason is LOGGED rather than returned, because the contract is
        ``list | None`` and widening it reaches ``writer.py`` and the embed
        route. ``REASON_UNPARSEABLE_BODY`` is in the message so that "the
        embedder is unreachable" and "something in front of the embedder is
        answering for it" can be told apart in a log search — they need
        different people.
        """
        if not self._client or not texts:
            return None
        response: Any = None
        try:
            response = await self._client.post(
                "/functions/v1/embed-research", json={"texts": texts}
            )
            if response.status_code >= 300:
                return None
            payload = response.json()
        except httpx.HTTPError:
            return None
        except ValueError:
            log.warning(
                "research rag: embed-research answered HTTP %s with a body that is not JSON "
                "(%s); %d text(s) stay unembedded and their documents stay pending",
                getattr(response, "status_code", "2xx"), REASON_UNPARSEABLE_BODY, len(texts),
            )
            return None
        if not isinstance(payload, dict):
            # Parsed, and still not the answer this endpoint documents. Checked
            # rather than left to raise ``AttributeError`` on ``.get``: the
            # rejected alternative widens the ``except`` above to catch that
            # too, which would also swallow a genuine defect in this method.
            log.warning(
                "research rag: embed-research returned %s, not an object carrying `embeddings` (%s)",
                type(payload).__name__, REASON_UNPARSEABLE_BODY,
            )
            return None
        embeddings = payload.get("embeddings") or []
        if len(embeddings) != len(texts):
            return None
        # A dimension mismatch means the corpus and this query were embedded
        # by different models. Refusing is the only safe answer: vectors are
        # comparable only within one model, and a 1536-dim query against a
        # 384-dim index does not error, it ranks nonsense.
        if any(not v or len(v) != EMBEDDING_DIMENSIONS for v in embeddings):
            return None
        return embeddings

    async def _embed(self, text: str) -> list[float] | None:
        """One vector, or None — the caller records 'pending', never zeros."""
        vectors = await self.embed_many([text])
        return vectors[0] if vectors else None
