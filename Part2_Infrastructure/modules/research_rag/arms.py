"""The relevance floor and the arm-refusal vocabulary the retrieval reads by.

Split out of ``modules/research_rag/retrieval.py`` under the file-length ceiling
``tests/test_file_size.py`` enforces: that file sat at 399 of 400 measured lines
and could not learn the tenant scope without shedding something first. What
moved is everything that is a CONSTANT or a pure constructor — no method here
touches ``self._client`` — so the split falls on the same line the package
already splits on (``writer.py`` owns configuration, ``retrieval.py`` owns the
client). ``apply_bm25`` came with them: it is the arm's SEAM and reads nothing but its
two arguments, so it belongs beside the vocabulary it refuses in. What did not
move is the call — ``retrieval._hybrid_arms`` still invokes it on the request
path, which is the property ``tests/test_research_bm25_wiring.py`` checks.

Every name here is re-exported from ``retrieval`` rather than being re-pointed
at by its importers. ``modules/research_rag/__init__.py`` publishes
``RAG_MIN_SIMILARITY`` from ``retrieval`` and ``tests/test_research_bm25_wiring.py``
reads ``retrieval.REASON_DENSE_ONLY`` and ``retrieval._unretrieved`` off the
module object; neither file is this change's to edit, and a split that renames
the import path of a constant two suites and one TypeScript parity test read is
a split that broke something to move a line count.
"""

from __future__ import annotations

from typing import Any

from modules import research_bm25

#: Cosine similarity below which a document is not offered as a match.
#:
#: `match_research_documents` has taken `min_similarity` since it was written and
#: defaulted it to 0.0, and no caller ever passed it. The Oracle query had no
#: floor at all. Both returned their N nearest rows however far away those were.
#:
#: 0.76 is MEASURED, not chosen. The first attempt used 0.35 on the reasoning
#: that cosine similarity runs 0-1 and a third is generous — and it filtered
#: nothing, because gte-small's absolute range is compressed near the top. Six
#: queries against the live index, one backtest card in the corpus:
#:
#:     moving average crossover BTCUSDT sharpe drawdown   0.898
#:     backtest sharpe ratio                              0.891
#:     trading strategy                                   0.792
#:     ---------------------------------------------- floor 0.76
#:     quantum entanglement in medieval poetry            0.744
#:     recipe for sourdough bread                         0.734
#:     the weather in Lisbon on Tuesday                   0.733
#:
#: Unrelated text lands at ~0.735 whatever it is about, so the useful signal is
#: the gap above that, not the absolute value. A generic but on-topic query
#: ("trading strategy") sits at 0.792 and must survive; nonsense must not.
#:
#: Six queries and one document is a thin basis and this number will move. That
#: is the eval harness's job — but a floor derived from three observed clusters
#: beats one derived from what the range looks like it ought to be.
RAG_MIN_SIMILARITY = 0.76

#: Why the BM25 arm did not contribute, in the cases only the WIRING can reach.
#:
#: ``research_bm25`` names the four it reaches by itself (empty candidate set,
#: empty query, no discriminating term, no matching document). These are states
#: of the retrieval AROUND it, named here so the arm stays a pure function of a
#: query and a candidate set. A caller branches on ``reason`` whichever side
#: declined, and prints ``detail``.
REASON_DENSE_ONLY = "dense_only_path"
REASON_RETRIEVAL_UNAVAILABLE = "retrieval_unavailable"

#: The join key failed — the one way the arm could raise inside a request.
#: ``rank_candidates`` documents ``id`` as a contract rather than an absent
#: state, so a row without one is a KeyError, and a KeyError here would turn a
#: search that works today into a 500.
REASON_UNJOINABLE_CANDIDATES = "candidates_without_ids"

#: The embed service answered, and what it said could not be read as JSON.
#:
#: The failure that killed the ingest drain: a proxy in front of
#: ``embed-research`` served an HTML 502 page under a 200 status, so
#: ``response.status_code >= 300`` was False and ``response.json()`` raised
#: ``json.JSONDecodeError`` — a ``ValueError``, which no ``except httpx.HTTPError``
#: in this package catches. Named rather than folded into
#: ``REASON_RETRIEVAL_UNAVAILABLE`` because the two want different operator
#: actions: one is "Supabase is unreachable", this one is "something in front of
#: Supabase is answering FOR it", and an operator reading a dashboard cannot get
#: from the second to the first.
REASON_UNPARSEABLE_BODY = "unparseable_response_body"


def _arm_unavailable(reason: str, detail: str, *, candidates: int = 0) -> dict[str, Any]:
    """A refusal in the arm's own report shape, built by the arm's own constructor.

    ``research_bm25._unavailable`` is private and reached deliberately: the
    rejected alternative spells its keys out here, a second definition of the
    shape that drifts the day the module adds a counter, and a caller reading
    ``scored_documents`` off one report and not the other cannot tell that
    drift from a result.
    """
    return research_bm25._unavailable(reason, detail, candidates=candidates)


def _unretrieved(detail: str) -> dict[str, Any]:
    """Nothing came back, so the arm was never offered anything to re-score."""
    return _arm_unavailable(REASON_RETRIEVAL_UNAVAILABLE, detail)


def apply_bm25(
    matches: list[dict[str, Any]], query_text: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Re-score the hybrid rows with Okapi BM25 and re-fuse all three arms.

    The seam between ``research_bm25`` and retrieval, kept as a free function so
    it can be tested against the real arm with no client and no stand-in.

    WHY A THIRD ARM AND NOT A REPLACEMENT. Dropping the ``ts_rank_cd`` arm for
    the better ranking model would discard the GIN index over the generated
    ``search_tsv`` column — the only thing in the system that finds a candidate
    at all — and move that scan onto the request path. BM25 here sees only the
    rows it is handed, because document frequency and average length are
    statistics of the set rather than of the corpus, so it can reorder a result
    and can never introduce a document into one. Keeping both keeps the index
    and gains the model: saturation through ``k1`` and length normalisation through
    ``b``, neither of which ``ts_rank_cd`` states an opinion about (the
    migration calls it with no normalisation argument, so length is ignored).

    Fusion is ``research_bm25.fuse`` at ``RRF_K`` — the same k = 60 the RPC and
    ``web/lib/retrieval-eval.ts`` use, because a third arm joining on a
    different constant is a second fusion wearing the first one's name.

    DECLINING IS NOT FAILING. When the arm cannot contribute, the two-arm
    ordering is returned exactly as the RPC ordered it, unsorted and
    unannotated, and the report names the reason. That is what makes "never
    worse than today" checkable rather than hopeful.
    """
    # Checked before the arm sees the rows. The rejected alternative is a
    # blanket ``except Exception`` around the call, which would also swallow a
    # real defect in the ranking and report a fiction as a refusal.
    if any("id" not in match for match in matches):
        detail = "a candidate carried no id, so a ranking could not be joined back to it"
        return matches, _arm_unavailable(REASON_UNJOINABLE_CANDIDATES, detail, candidates=len(matches))
    report = research_bm25.rank_candidates(query_text, matches)
    if not report["ranked"]:
        return matches, report
    return research_bm25.fuse(matches, report), report
