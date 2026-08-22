"""Cross-encoder re-ranking: the precision half of retrieve-wide-then-narrow.

Retrieval today fuses a dense ranking (pgvector over gte-small, 384d) with a
lexical one (Postgres FTS, ``ts_rank_cd``) by Reciprocal Rank Fusion at k=60,
and hands the top ``match_count=3`` to the CRAG grader. RRF is a very good
cheap fusion and it has one structural blind spot: it only ever sees RANK. It
cannot look at the query and the document together, so it has no way to promote
a candidate sitting eleventh in both lists that happens to be the one document
that answers the question.

That blind spot is why ``match_count`` is pinned at 3. Widening the net today
adds candidates with no mechanism to sort them out again, so recall bought by a
wider net is paid for immediately in precision. A cross-encoder breaks the
trade: it runs the query and each document through one model TOGETHER, with
full cross-attention between them, rather than comparing two vectors embedded in
ignorance of each other. That is materially more accurate than bi-encoder cosine
similarity, and it is what unlocks the standard both-ends win — retrieve twenty,
re-rank precisely, pass three onward. Recall rises from the wider net, precision
from the re-ranker.

Why fastembed's ONNX cross-encoder and not Cohere Rerank or Voyage
-----------------------------------------------------------------

The hosted re-rankers are more accurate and were rejected anyway. Both would put
a vendor API call on the retrieval path, and that single change would take out
four properties this codebase spends most of its effort holding:

* the test suite is network-free by construction, and a hosted re-ranker is
  either mocked into meaninglessness or untested;
* results would become a function of a model version nobody here pins — the
  same argument ``research_crag`` makes for grading arithmetically rather than
  with an LLM;
* an outage at the vendor would become an outage in retrieval;
* the query text and the desk's own research would leave the box.

``BAAI/bge-reranker-base`` through fastembed's ``TextCrossEncoder`` is ONNX and
CPU-only. It fits this VM precisely because there is no GPU to want, no key to
hold and no network at request time once the model directory is seeded. It is
the same trade ``requirements-ml.txt`` documents: the hosted thing is better and
the local thing is the one that can be reasoned about.

Which latency plane this is
---------------------------

The RESEARCH plane, measured in MILLISECONDS. This codebase never blends its
three planes: the pre-trade decision is microseconds (``RiskDecision.latency_ms``
and the µs histogram), the compiled core is nanoseconds, and the network to the
venue is milliseconds. Nothing here may ever be quoted under a decision-plane
label, and nothing here may ever be called from one.

What twenty pairs actually cost — measured, not estimated
---------------------------------------------------------

This paragraph used to read "tens of milliseconds, call it 30-80 ms", declared
itself an ESTIMATE derived from the parameter count, and said the eval harness
was what would turn it into a measurement. ``tools/bench_rerank.py`` is that
harness, it has now been run against the real weights, and the estimate did not
survive it. Median of seven runs per row, arm64 laptop with 18 cores, Python
3.12, fastembed 0.7.4 / onnxruntime 1.29.0, weights already on disk:

* twenty pairs of one-line rows (~200 characters each): **197 ms of wall clock
  and 1,776 ms of CPU**, spread across roughly nine cores.
* twenty pairs at ``MAX_DOCUMENT_CHARS`` — the length this module's own
  truncation lets through: **1,523 ms of wall clock and 12,573 ms of CPU**.
* the model load: **0.45 s** off a seeded directory, not "a second or two". The
  ~22 s and 1.05 GiB are the one-off SEEDING of that directory, which is the
  cost ``requirements-rerank.txt`` insists is paid at image build time.

So the old figure was low by 2.5x against the TOP of its own 30-80 ms range on
the friendliest realistic batch, and by 19x on the batch this module permits.
The term that dominates is the LENGTH of a document rather than the number of
them — see ``MAX_DOCUMENT_CHARS``.

The second number in each row is the one that was missing, and it is the one
that matters to a process that also serves the pre-trade risk checks. A wall
clock says a re-rank takes a fifth of a second; onnxruntime's intra-op pool
says that fifth of a second spent 1.8 CPU-seconds across nine cores of an
eighteen-core box. ``research_stages._RERANK_BULKHEAD`` was sized against the
wall figure alone and is re-argued there against this one.

Even at 1.5 s it is still three orders of magnitude away from the decision
plane, which remains the fact that decides where this may be called from.

``rerank`` is SYNCHRONOUS and CPU-bound, and that is a constraint on the caller
rather than an oversight. A route that awaits nothing while this runs blocks the
event loop for a fifth of a second at the short end of the table above and a
second and a half at the long one, and this process also serves the pre-trade
risk checks — research may wait, risk may not. Any async caller must
push it off the loop the way ``modules/research.py::_off_loop`` pushes OpenBB
(``asyncio.to_thread``, behind a small bulkhead). It is left synchronous here so
that the choice of executor, timeout and bulkhead belongs to the caller who
knows what else that loop is carrying.

Falling back is a feature, not a degradation
--------------------------------------------

When no model is available this returns the candidates in their ORIGINAL FUSED
ORDER, truncated to ``top_k``, with ``reranked: False`` and a named reason. RRF
order is a correct, useful ranking — it is what the desk serves today. Returning
nothing, or returning an arbitrary order, would turn a missing optional extra
into an outage. So the fallback never empties the list, never re-orders, and
never invents a score: a document the cross-encoder did not see comes back
WITHOUT a score key rather than with a plausible-looking zero.

Absence is a state
------------------

An empty ``RERANK_MODEL_PATH`` is the normal deployment, and an uninstalled
``fastembed`` is the normal environment — the whole suite passes without either.
Both are reported in the shape ``research_graph_projection`` uses for an unset
``NEO4J_URI``: a named reason and a state, never an exception and never a silent
success. A caller must be able to tell "the cross-encoder ordered these" from
"nobody did" by reading a FIELD, which is why ``reranked``, ``state`` and
``model`` are all present on every report rather than only on the happy path.
"""

from __future__ import annotations

import logging
from typing import Any

from config import settings

log = logging.getLogger("alphaengine.research_rerank")

#: The scorer. ``base`` rather than ``large`` because this runs on the request
#: path on a CPU: ``bge-reranker-large`` is roughly three times the compute for
#: a gain that matters at the top of a thousand-candidate list, not at the top
#: of twenty. Named as a constant because it is written into every successful
#: report — a re-ranked order whose model nobody recorded cannot be reproduced.
RERANK_MODEL = "BAAI/bge-reranker-base"

#: How wide retrieval should cast the net WHEN re-ranking is on, replacing the
#: ``match_count=3`` that RRF alone can afford. Twenty is the point where the
#: recall curve for this corpus has flattened, and it is now also the width the
#: measured table above was taken at: 197 ms on short rows, 1.5 s on rows at the
#: truncation ceiling. A hundred would cost five times that for candidates
#: already below the relevance floor. This module never widens anything itself —
#: the constant lives here so the caller that does widen names the same number
#: the measurement was taken at.
RERANK_CANDIDATES = 20

#: The fields joined to make the document side of the pair, in this order.
#: Deliberately the same set ``research_crag.ContextGrader`` reads, plus
#: ``summary``: a re-ranker and a grader that disagree about what a document
#: SAYS will disagree about what it is worth, and the resulting order would be
#: impossible to explain from the row the reader is shown.
TEXT_FIELDS = ("title", "summary", "body", "symbol", "strategy")

#: Characters kept per document. bge-reranker-base truncates at 512 tokens
#: whatever it is given, and ~2,000 characters of English is about that many
#: tokens — so this cuts text the model would have discarded anyway, and stops
#: one long backtest body from setting the latency for the whole batch.
#:
#: The bench turned that last clause from a plausible claim into the dominant
#: one. At a fixed width of twenty, this constant IS the latency: 101 ms at 40
#: characters a row, 193 ms at 200, 412 ms at 500, 1,529 ms at 2,000. Lowering
#: it is therefore the largest single lever on the cost of this module, and it
#: is deliberately NOT pulled here — a cut below ~512 tokens starts discarding
#: text the model would have read, which trades away the precision the whole
#: module exists to buy. Re-measure with ``tools/bench_rerank.py --lengths``
#: before moving it, on the box that will run it.
MAX_DOCUMENT_CHARS = 2_000

#: The key a re-ranked document carries its score under. Absent — not None, not
#: 0.0 — on any document the cross-encoder did not score, because an absent key
#: is the only form that cannot be mistaken for a measurement.
SCORE_FIELD = "rerank_score"

# The loaded encoder, cached at module level so the model is read off disk once
# per process rather than once per request. `_LOAD_ERROR` is the other half of
# that: a load that failed is remembered and NOT retried, because retrying a
# missing model directory on every query turns one misconfiguration into a
# per-request stall. `_LOADED_PATH` records which setting the cache belongs to,
# so a changed configuration invalidates both rather than being ignored.
_ENCODER: Any = None
_LOAD_ERROR: str | None = None
_LOAD_ERROR_STATE: str | None = None
_LOADED_PATH: str | None = None


def configured() -> bool:
    """Whether a re-ranker is configured at all.

    ``RERANK_MODEL_PATH`` is empty by default, and that is not a mistake to be
    corrected: the desk ran without a re-ranker before this module existed and
    still does. Unconfigured is a state, and this is the function that names it.
    """
    return bool(settings.rerank_model_path)


def _unavailable(
    documents: list[dict[str, Any]], top_k: int, state: str, reason: str
) -> dict[str, Any]:
    """The shape every refusal takes. Never raises, never reports success.

    One deliberate difference from ``research_graph_projection._unavailable``,
    which zeroes its counts: this one still returns DOCUMENTS. A projection that
    could not run has nothing to hand back, whereas a re-rank that could not run
    still holds a perfectly good fused ranking, and dropping it would convert a
    missing optional extra into an empty search result. ``reranked`` and
    ``model`` are what tell the caller the order is RRF's rather than the
    cross-encoder's; the list itself is never the signal.
    """
    kept = documents[:top_k]
    return {
        "reranked": False,
        "state": state,
        "reason": reason,
        "model": None,
        "candidates": len(documents),
        "returned": len(kept),
        "documents": kept,
    }


def _import_cross_encoder() -> tuple[Any, str | None]:
    """``TextCrossEncoder``, or a reason it is not importable.

    The import lives alone in its own function for two reasons. It must be LAZY
    — ``fastembed`` is an optional extra and a module-level import would stop
    the gateway booting for want of a feature it is not using, exactly as the
    neo4j driver would. And it must be a BOUNDARY: tests substitute this one
    function to get a fake scorer, rather than injecting a fake package into
    ``sys.modules``, which keeps the suite honest about what it is mocking.
    """
    try:
        from fastembed.rerank.cross_encoder import (  # type: ignore[import-not-found]
            TextCrossEncoder,
        )
    except ImportError:
        return None, (
            "the fastembed package is not installed "
            "(pip install -r requirements-rerank.txt)"
        )
    return TextCrossEncoder, None


def _encoder() -> tuple[Any, str | None, str | None]:
    """The cached cross-encoder, or a reason and a state naming its absence.

    Returns a state alongside the reason rather than the reason alone: "not
    configured", "not installed" and "the model raised" need three different
    responses from a caller — set an env var, install an extra, page somebody —
    and a caller that had to tell them apart by matching on prose would break
    the first time the sentence was reworded.
    """
    global _ENCODER, _LOAD_ERROR, _LOAD_ERROR_STATE, _LOADED_PATH

    path = settings.rerank_model_path
    if not path:
        return None, (
            "RERANK_MODEL_PATH is unset, so the candidates were not re-ranked"
        ), "unconfigured"

    if path != _LOADED_PATH:
        # Configuration moved. Drop the encoder AND the remembered failure: a
        # sticky error from the old path would deny a correctly configured one.
        _ENCODER, _LOAD_ERROR, _LOAD_ERROR_STATE, _LOADED_PATH = None, None, None, path

    if _ENCODER is not None:
        return _ENCODER, None, None
    if _LOAD_ERROR is not None:
        return None, _LOAD_ERROR, _LOAD_ERROR_STATE

    encoder_cls, reason = _import_cross_encoder()
    if encoder_cls is None:
        _LOAD_ERROR, _LOAD_ERROR_STATE = reason, "unavailable"
        log.warning("research rerank: %s", reason)
        return None, _LOAD_ERROR, _LOAD_ERROR_STATE

    try:
        # `cache_dir` is where fastembed resolves the model from, so a seeded
        # directory means no network at request time — the property this whole
        # module was chosen for.
        _ENCODER = encoder_cls(model_name=RERANK_MODEL, cache_dir=path)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        # Exception, not a narrower class: a model directory can be missing,
        # unreadable, or hold an ONNX file this fastembed cannot open, and for
        # the caller all three mean the same thing — no re-ranker, here is why.
        _LOAD_ERROR = f"{type(exc).__name__} loading {RERANK_MODEL} from {path}: {exc}"
        _LOAD_ERROR_STATE = "failed"
        log.warning("research rerank: %s", _LOAD_ERROR)
        return None, _LOAD_ERROR, _LOAD_ERROR_STATE

    return _ENCODER, None, None


def _text(document: dict[str, Any]) -> str:
    """The document side of the pair: its own words, bounded.

    Empty when the row carries none of ``TEXT_FIELDS``. That is a real case —
    a graph neighbour row, a partially written card — and it is handled by
    leaving the document out of the batch rather than by scoring it against an
    empty string, which would hand back a confident number about nothing.
    """
    parts = [str(document[field]) for field in TEXT_FIELDS if document.get(field)]
    return " ".join(parts)[:MAX_DOCUMENT_CHARS]


def rerank(
    query: str, documents: list[dict[str, Any]], top_k: int = 3
) -> dict[str, Any]:
    """Re-order ``documents`` by cross-encoder relevance to ``query``.

    Returns a report, never raises, and never returns fewer documents than it
    could. Five states, and a caller branches on ``state`` rather than reading
    ``reason``:

    ``reranked``      the cross-encoder scored the pairs; this order is its own
                      and every scored document carries ``rerank_score``.
    ``unconfigured``  ``RERANK_MODEL_PATH`` is empty — the default deployment.
    ``unavailable``   ``fastembed`` is not installed.
    ``failed``        a model was there and it raised, or it returned a number
                      of scores that did not match the batch.
    ``empty``         there was nothing to score. Not a failure: ``candidates``
                      says whether that is because no documents were offered or
                      because none of them carried any text.

    In the last four the documents come back in the order they arrived in,
    truncated to ``top_k``, unmodified — no score key added and no re-ordering.
    """
    top_k = max(1, int(top_k))

    if not documents:
        # Checked before the model is touched. Loading ~110M parameters to
        # score nothing is the one avoidable millisecond in this function.
        return _unavailable(
            documents, top_k, "empty",
            "no candidates were offered, so there was nothing to re-rank",
        )

    batch = [(i, _text(doc)) for i, doc in enumerate(documents)]
    batch = [(i, text) for i, text in batch if text]
    if not batch:
        return _unavailable(
            documents, top_k, "empty",
            "no candidate carried any text to score, so the fused order was kept",
        )

    encoder, reason, state = _encoder()
    if encoder is None:
        return _unavailable(documents, top_k, state or "unavailable", reason or "no re-ranker")

    try:
        scores = list(encoder.rerank(query, [text for _, text in batch]))
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        return _unavailable(
            documents, top_k, "failed",
            f"{type(exc).__name__} scoring {len(batch)} pairs with {RERANK_MODEL}: {exc}",
        )

    if len(scores) != len(batch):
        # Refuse rather than zip and truncate. A score list of the wrong length
        # means scores would be paired with the wrong documents, and a
        # misaligned relevance score is the failure this module exists to
        # prevent: it looks exactly like a confident answer.
        return _unavailable(
            documents, top_k, "failed",
            f"{RERANK_MODEL} returned {len(scores)} scores for {len(batch)} pairs; "
            "a misaligned score would be attributed to the wrong document",
        )

    # Descending by score, ties broken by the position RRF gave them. A tie is
    # not evidence about which of two documents is better, so the fused order —
    # which IS evidence — decides it rather than the sort's own arbitrariness.
    ranked = sorted(
        zip([i for i, _ in batch], (float(s) for s in scores), strict=True),
        key=lambda pair: (-pair[1], pair[0]),
    )
    ordered = [{**documents[i], SCORE_FIELD: score} for i, score in ranked]

    # Anything with no text keeps its relative order and goes last, carrying no
    # score. It was never scored, so it must not outrank something that was —
    # but dropping it would lose a candidate silently, which is worse.
    scored = {i for i, _ in batch}
    ordered += [doc for i, doc in enumerate(documents) if i not in scored]

    kept = ordered[:top_k]
    return {
        "reranked": True,
        "state": "reranked",
        "reason": None,
        "model": RERANK_MODEL,
        "candidates": len(documents),
        "returned": len(kept),
        "documents": kept,
    }
