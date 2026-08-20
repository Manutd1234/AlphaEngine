"""pgvector research index: what the desk already records, made retrievable.

The corpus is not new instrumentation. Completed backtests already land in the
audit log's ``backtest_runs`` table with DSR, OOS Sharpe, PBO and ``data_hash``;
risk incidents already flow through the gateway's alert path. This module
renders each of those into a plain-text card, embeds it via the
``embed-research`` edge function (gte-small, 384-dim — no paid API, no model
weights in the gateway image), and stores card + vector in
``public.research_documents``.

Retrieval triggers on a precisely-defined execution anomaly — not on vibes:

* an **accepted** fill whose realised ``slippage_bps`` exceeds
  ``settings.max_est_slippage_bps`` (the pre-trade estimate was wrong — the
  interesting case, and the gateway computes both numbers on the same order);
* a rejection citing ``est_slippage`` or ``daily_drawdown``;
* the drawdown circuit breaker engaging the kill switch.

Honesty rules, non-negotiable:

* ``body`` stores the exact text that was embedded, so a renderer change can
  never silently invalidate stored vectors.
* An embed failure stores the document ``embedding_status='pending'`` — never
  a zero vector, which is equidistant from everything and would be returned as
  "similar" to any query. The backfill tool re-embeds pending rows.
* With Supabase unconfigured, ``search`` reports ``unavailable`` — never an
  empty list. "Searched and found nothing" is a different fact from "could
  not search", and the workspace renders them differently.

A completed sweep yields one document per CHART as well as the run card — the
equity curve, the drawdown envelope, the fold table — described from the figures
the desk already computed in order to draw them. No image is embedded and there
is no vision model in this path: the Edge runtime's ``Supabase.ai.Session``
exposes gte-small and takes no image, so a chart is retrievable by what it says.

Card rendering deliberately does not import ``modules.telegram`` (matplotlib
is heavy); ``telegram.text_card`` is the design lineage — title, state, metric
lines, provenance footer — because a card an LLM retrieves and a card a human
reads on a phone want the same shape.

The module became a package. ``ResearchRag`` is still ONE class: the read half
is ``retrieval._RetrievalMixin`` (embedding, hybrid match, search, corpus size,
graph traversal) and the write half is ``writer.ResearchRag`` (lifecycle, the
bounded queue, the hooks, the drain loop). Every name the old module exported
is re-exported below.

Three things a reader porting a patch needs to know.

``settings`` is read in ``writer.py`` and NOWHERE else in this package. A test
stubbing configuration patches ``modules.research_rag.writer.settings`` — a
``monkeypatch.setattr`` against this file binds a name the class never reads,
and the stub silently does not apply.

``_submit`` still hops through ``self._loop.call_soon_threadsafe``. An
``asyncio.Queue`` binds itself to the loop that first touches it, so a
``put_nowait`` from the job queue's worker thread raises "bound to a different
event loop" — which the caller's ``except Exception`` swallowed, so a fitted run
simply never reached the corpus and nothing said why. Do not flatten it.

``RAG_MIN_SIMILARITY`` lives in ``retrieval.py``. Its parity with the
TypeScript constant is pinned by ``web/tests/oracle-contract.test.ts``, which
reads every file of this package rather than one path.
"""

from __future__ import annotations

from modules.research_cards import ANOMALY_GATES as ANOMALY_GATES  # noqa: F401
from modules.research_cards import classify_anomaly as classify_anomaly  # noqa: F401
from modules.research_cards import render_backtest_card as render_backtest_card  # noqa: F401
from modules.research_cards import render_backtest_documents as render_backtest_documents  # noqa: F401
from modules.research_cards import render_incident_card as render_incident_card  # noqa: F401
from modules.research_cards import render_ml_card as render_ml_card  # noqa: F401
from modules.research_rag.retrieval import EMBEDDING_DIMENSIONS as EMBEDDING_DIMENSIONS  # noqa: F401
from modules.research_rag.retrieval import EMBEDDING_MODEL as EMBEDDING_MODEL  # noqa: F401
from modules.research_rag.retrieval import RAG_MIN_SIMILARITY as RAG_MIN_SIMILARITY  # noqa: F401
from modules.research_rag.retrieval import _RetrievalMixin as _RetrievalMixin  # noqa: F401
from modules.research_rag.writer import ResearchRag as ResearchRag  # noqa: F401
from modules.research_rag.writer import get_rag as get_rag  # noqa: F401
from modules.research_rag.writer import reset_rag as reset_rag  # noqa: F401

__all__ = [
    "ANOMALY_GATES",
    "EMBEDDING_DIMENSIONS",
    "EMBEDDING_MODEL",
    "RAG_MIN_SIMILARITY",
    "ResearchRag",
    "classify_anomaly",
    "get_rag",
    "render_backtest_card",
    "render_backtest_documents",
    "render_incident_card",
    "render_ml_card",
    "reset_rag",
]
