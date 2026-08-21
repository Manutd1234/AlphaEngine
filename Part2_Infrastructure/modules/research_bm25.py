"""Okapi BM25 over a candidate set: a third lexical arm for research retrieval.

``match_research_documents_hybrid`` fuses two rankings today — a dense one over
gte-small vectors and a sparse one from ``ts_rank_cd`` over a generated
tsvector — joined by Reciprocal Rank Fusion at k = 60. This module produces a
THIRD ranking of the same candidate rows and fuses it on identical terms. It is
a pure function of its arguments: no database round trip, no ``settings``, no
clock — the instinct that keeps ``retrieval.py`` free of configuration, and what
makes every property below testable without a network.

Why a third arm and not a replacement for the FTS one
-----------------------------------------------------

The obvious move is to delete the ``ts_rank_cd`` arm and rank lexically with
BM25 instead, since BM25 is the better ranking model. The trade is worse than it
looks, and the reason is the index rather than the maths. The sparse arm is
backed by a GIN index over a GENERATED ``search_tsv`` column
(``20260810090000_hybrid_research_search.sql``), which Postgres uses to scan the
WHOLE table and hand back the fifty rows worth ranking. BM25 here sees only the
rows it is given, because document frequency and average document length are
collection statistics and this module is handed a collection of fifty. So
replacing FTS discards the GIN index — the only thing in the system that finds a
candidate at all — moves ranking onto the gateway's request path, and loses
``english`` stemming and the ``setweight`` A/B title weighting. What it gains is
the ranking MODEL. Take both instead: FTS keeps its index and supplies recall,
BM25 re-scores what came back and supplies the ordering, RRF combines them. This
arm can reorder the candidate set but can never introduce a document into it,
which is why adding it cannot make retrieval worse than it is today.

What ``ts_rank_cd`` does not model
----------------------------------

It is a cover-density ranker: it rewards proximity and term coverage, and it is
good at that. It models neither of BM25's two ideas.

* SATURATION. Cover density grows with the number of covers, so a term twenty
  times over counts roughly twenty times over. A document that says "sharpe"
  once is about the Sharpe ratio; one that says it twenty times is not twenty
  times more about it. ``BM25_K1`` sets how fast the gain flattens.
* LENGTH. The migration calls ``ts_rank_cd(tsv, query)`` with no normalisation
  argument, so the default of 0 applies and length is ignored entirely. A long
  document contains more of everything and wins for no reason a reader would
  accept. ``BM25_B`` is the correction.

Absence is a state, not a failure
---------------------------------

An empty candidate set, a query that tokenises to nothing, and a query whose
every term appears in every candidate are all NORMAL. Each is reported in the
shape ``research_graph_projection._unavailable`` uses — a boolean verb, a named
reason and zeroed counters — never raised, never returned as a bare empty list.
The two refusals that must not be confused are told apart by FIELDS rather than
by reading prose: COULD NOT SCORE is ``candidates == 0 or terms == 0``, NOTHING
SCORED is ``candidates > 0 and terms > 0 and scored_documents == 0``.

One deviation from ``_unavailable``: ``reason`` is one of the ``REASON_*``
constants rather than free prose, because callers branch on it, and prose that
is branched on is prose nobody can reword. The human sentence is ``detail``.

``retrieval.py::_match`` already holds the candidate rows and the query text, so
the call site is one ``fuse`` after the hybrid RPC returns — but this module is
the arm, not the wiring.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

#: Term-frequency saturation. ``tf * (k1 + 1) / (tf + k1 * …)`` rises steeply
#: over the first few occurrences and then flattens: at k1 = 1.2 a term seen
#: five times is worth about 1.8x a term seen once, not 5x.
#:
#: The canonical default, from the Okapi TREC experiments (Robertson, Walker &
#: Sparck Jones, "Okapi at TREC-3", 1994; restated in Robertson & Zaragoza,
#: "The Probabilistic Relevance Framework: BM25 and Beyond", 2009, which gives
#: 1.2-2.0 as the sensible range absent tuning). Kept rather than tuned, for the
#: reason the migration keeps RRF's k = 60: with a corpus this small, tuning
#: fits the constant to a handful of documents and calls the fit a finding.
BM25_K1 = 1.2

#: Length normalisation, from 0 (ignore length, which is what ``ts_rank_cd``
#: does here today) to 1 (normalise fully by length/average length). 0.75 is the
#: same canonical default from the same papers, and a PARTIAL correction on
#: purpose: a longer document does tend to say more, so the honest position sits
#: between "length is irrelevant" and "length is proportional to noise".
BM25_B = 0.75

#: The floor under the IDF term, and the fix for the classic negative-IDF trap.
#:
#: The Robertson-Sparck Jones IDF goes NEGATIVE once a term appears in more than
#: half the collection, which would let a common term subtract score from the
#: documents that contain it and push documents that lack it up the ranking.
#:
#: Floored at exactly zero, not at a small positive epsilon (rank_bm25 uses
#: 0.25 x the mean IDF; rejected): a term most of the candidate set contains
#: cannot tell those documents apart, and a small positive weight would hand the
#: ordering to document length while still looking like a lexical match. Zero
#: says the true thing, and the report counts how many terms landed here.
IDF_FLOOR = 0.0

#: Shortest token kept — i.e. no minimum length at all. Argued, not assumed: the
#: usual `len > 2` rule is actively wrong for a finance corpus, deleting ``FX``,
#: ``MA``, ``PE``, the ``20`` and ``100`` of a parameter pair like ``20/100``,
#: and the ``s``/``p`` of ``S&P`` — the very tokens ``retrieval.py`` says the
#: dense arm blurs and this arm exists to catch. The rejected alternative is
#: ``research_crag.py``'s ``[A-Za-z0-9_.\-]{2,}``, right for measuring query
#: overlap and wrong here. Uninformative short tokens need no length rule: they
#: appear nearly everywhere, so IDF already prices them at zero, while a length
#: rule is a second and cruder filter nobody can audit from the report.
MIN_TOKEN_LENGTH = 1

#: Cormack et al.'s original constant, the same value
#: ``match_research_documents_hybrid`` and ``web/lib/retrieval-eval.ts`` use.
#: Duplicated rather than tuned separately: a third arm joining on different
#: terms from the first two is not a third arm, it is a second fusion.
RRF_K = 60

#: The candidate fields that make up a document's text, in the order the
#: generated tsvector concatenates them. Weighting is NOT reproduced here —
#: ``setweight`` gives titles the A slot in Postgres and this arm treats every
#: field alike, so the two lexical arms disagree about titles on purpose and RRF
#: gets two genuinely different opinions rather than one opinion twice.
TEXT_FIELDS: tuple[str, ...] = ("title", "body", "symbol", "strategy")

#: Closed-class English function words, dropped before scoring.
#:
#: Deliberately SHORT: every word here is a word this arm can no longer match,
#: so the list holds only words that mean nothing alone. It is needed at all
#: because document frequency is computed over the CANDIDATE SET — fifty rows,
#: not the corpus — where "the" can appear in two of fifty, draw a healthy
#: positive IDF, and rank documents by their fondness for the definite article.
#: Excluded on purpose, though a general-purpose list holds them: "in", "out",
#: "up", "down", "over", "under", "no", "not", "long", "short", "call", "put",
#: "open", "close", "high", "low" — a desk uses every one as a term.
STOPWORDS = frozenset({
    "a", "an", "and", "any", "are", "as", "at", "be", "been", "being", "but",
    "by", "can", "did", "do", "does", "for", "from", "had", "has", "have",
    "he", "her", "him", "his", "i", "if", "into", "is", "it", "its", "me",
    "my", "of", "on", "or", "our", "she", "so", "than", "that", "the",
    "their", "them", "then", "there", "these", "they", "this", "those", "to",
    "was", "we", "were", "what", "when", "which", "while", "who", "will",
    "with", "would", "you", "your",
})

#: One token = one run of alphanumerics. ``[^\W_]`` is ``\w`` minus the
#: underscore, so it stays Unicode-aware (``naive`` with a diaeresis is one
#: token) while ``data_hash`` splits into ``data`` and ``hash`` — raising recall
#: for a query that spells it with a space, at no cost, because BM25's
#: saturation absorbs the repetition a split introduces.
_TOKEN = re.compile(r"[^\W_]+")

#: Named reasons. A caller branches on these; ``detail`` is what it prints.
REASON_EMPTY_CORPUS = "empty_corpus"
REASON_EMPTY_QUERY = "empty_query"
REASON_NO_DISCRIMINATING_TERMS = "no_discriminating_terms"
REASON_NO_MATCHING_DOCUMENTS = "no_matching_documents"


def tokenise(text: str | None) -> list[str]:
    """Lowercase, split on non-alphanumerics, drop stopwords. Deterministic.

    ``casefold`` rather than ``lower``: it is the case-insensitive-comparison
    operation, so a query typed with a German sharp s or a Turkish dotted I
    still matches the document that spells it the other way.
    """
    if not text:
        return []
    return [
        token
        for token in _TOKEN.findall(text.casefold())
        if len(token) >= MIN_TOKEN_LENGTH and token not in STOPWORDS
    ]


def document_text(candidate: Mapping[str, Any], fields: Sequence[str] = TEXT_FIELDS) -> str:
    """The scorable text of one candidate row. A missing field is absent, not ''."""
    return " ".join(str(candidate.get(field) or "") for field in fields)


def idf(document_count: int, document_frequency: int) -> float:
    """Robertson-Sparck Jones inverse document frequency, smoothed and floored.

    ``ln((N - df + 0.5) / (df + 0.5))``. The +0.5 on both sides is the standard
    smoothing: it holds the denominator at 0.5 or more, so a term no candidate
    contains cannot divide by zero, and holds the numerator positive for a term
    every candidate contains.

    Floored at ``IDF_FLOOR``. Above df = N/2 the raw value turns negative — a
    term four candidates in five contain would SUBTRACT from the four that have
    it and hand the ranking to the one that does not. That is the negative-IDF
    trap: a scoring bug, not a signal.
    """
    # df cannot exceed N by construction; clamped so a caller's mistake reports
    # a floor rather than crashing on a log-domain error inside a request.
    frequency = min(max(document_frequency, 0), max(document_count, 0))
    if document_count <= 0:
        return IDF_FLOOR
    return max(IDF_FLOOR, math.log((document_count - frequency + 0.5) / (frequency + 0.5)))


def _unavailable(
    reason: str,
    detail: str,
    *,
    candidates: int = 0,
    terms: int = 0,
    discriminating: int = 0,
) -> dict[str, Any]:
    """The shape every refusal takes: never raises, never reports success.

    Same keys as a success, so a caller reads one shape either way.
    """
    return {
        "ranked": False,
        "reason": reason,
        "detail": detail,
        "ranking": [],
        "candidates": candidates,
        "terms": terms,
        "discriminating_terms": discriminating,
        "scored_documents": 0,
    }


def _document_score(
    counts: Counter[str],
    length: int,
    weights: Mapping[str, float],
    average_length: float,
    k1: float,
    b: float,
) -> tuple[float, int]:
    """``SUM idf(t) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * |D| / avgdl))``."""
    # The length penalty is computed once per document rather than per term: it
    # does not depend on t, and the inner loop runs over every query term.
    normaliser = k1 * (1.0 - b + b * (length / average_length))
    total = 0.0
    matched = 0
    for term, weight in weights.items():
        frequency = counts[term]
        if not frequency:
            continue
        matched += 1
        total += weight * (frequency * (k1 + 1.0)) / (frequency + normaliser)
    return total, matched


def rank_candidates(
    query: str,
    candidates: Sequence[Mapping[str, Any]],
    *,
    k1: float = BM25_K1,
    b: float = BM25_B,
    fields: Sequence[str] = TEXT_FIELDS,
) -> dict[str, Any]:
    """Re-score `candidates` against `query` with Okapi BM25.

    `candidates` are the rows ``match_research_documents_hybrid`` returned; each
    must carry ``id``, the join key for `fuse` and so a contract rather than an
    absent state.

    Returns a report, never a bare list. A document matching no discriminating
    term is LEFT OUT of the ranking rather than ranked last with a zero — the
    decision the migration makes with its ``search_tsv @@ tsquery`` filter, and
    for the same reason: a rank would let a document containing nothing of the
    query collect RRF weight it did not earn.
    """
    if not candidates:
        return _unavailable(
            REASON_EMPTY_CORPUS,
            "no candidates were offered, so there was nothing to score",
        )

    # Deduplicated: the query-term-frequency factor (Okapi's k3) is omitted, as
    # it is in every modern implementation, because queries are short — so a
    # term typed twice must not count twice by accident.
    terms = sorted(set(tokenise(query)))
    if not terms:
        return _unavailable(
            REASON_EMPTY_QUERY,
            "the query held no tokens once stopwords were dropped",
            candidates=len(candidates),
        )

    tokens = [tokenise(document_text(candidate, fields)) for candidate in candidates]
    lengths = [len(token_list) for token_list in tokens]
    total_length = sum(lengths)
    count = len(candidates)
    if total_length == 0:
        # Every candidate is textless, so avgdl would be 0 and the length
        # normaliser would divide by it. Reported as "nothing matched", which is
        # what it is, rather than guarded with a fudged denominator.
        return _unavailable(
            REASON_NO_MATCHING_DOCUMENTS,
            f"none of the {count} candidates carried any text in {tuple(fields)}",
            candidates=count,
            terms=len(terms),
        )

    average_length = total_length / count
    counts = [Counter(token_list) for token_list in tokens]
    weights = {term: idf(count, sum(1 for doc in counts if doc[term])) for term in terms}
    discriminating = {term: weight for term, weight in weights.items() if weight > IDF_FLOOR}
    if not discriminating:
        return _unavailable(
            REASON_NO_DISCRIMINATING_TERMS,
            f"every one of the {len(terms)} query terms appears in most or all of "
            f"the {count} candidates, so none of them can tell the candidates apart",
            candidates=count,
            terms=len(terms),
        )

    ranking: list[dict[str, Any]] = []
    for candidate, document, length in zip(candidates, counts, lengths, strict=True):
        score, matched = _document_score(document, length, discriminating, average_length, k1, b)
        if matched:
            ranking.append({"id": candidate["id"], "score": score, "matched_terms": matched})

    if not ranking:
        return _unavailable(
            REASON_NO_MATCHING_DOCUMENTS,
            f"none of the {count} candidates contains any of the "
            f"{len(discriminating)} discriminating query terms",
            candidates=count,
            terms=len(terms),
            discriminating=len(discriminating),
        )

    # Ties broken by id, so the ranking is a function of the input and not of the
    # order the RPC happened to return rows in — an unstable order would move the
    # evaluation metrics in `web/lib/retrieval-eval.ts` for no reason at all.
    ranking.sort(key=lambda row: (-row["score"], str(row["id"])))
    for position, row in enumerate(ranking, start=1):
        row["rank"] = position

    return {
        "ranked": True,
        "reason": None,
        "detail": None,
        "ranking": ranking,
        "candidates": count,
        "terms": len(terms),
        "discriminating_terms": len(discriminating),
        "scored_documents": len(ranking),
    }


def _fusion_order(row: Mapping[str, Any]) -> tuple[float, float, float, str]:
    """Deterministic, and never None in a comparison key."""
    vector = row.get("vector_rank")
    lexical = row.get("lexical_rank")
    return (
        -float(row["fused_score"]),
        math.inf if vector is None else float(vector),
        math.inf if lexical is None else float(lexical),
        str(row["id"]),
    )


def fuse(
    matches: Sequence[Mapping[str, Any]],
    bm25: Mapping[str, Any],
    *,
    k: int = RRF_K,
) -> list[dict[str, Any]]:
    """Reciprocal Rank Fusion over three arms, at the same k = 60 as the other two.

    ``1/(k + rank)`` per arm, summed — identical terms to
    ``match_research_documents_hybrid`` and to ``reciprocalRankFusion`` in
    ``web/lib/retrieval-eval.ts``, because a third arm joining on a different
    constant is a second fusion wearing the first one's name.

    An arm that did not rank a document contributes NOTHING for it rather than a
    penalty: penalising absence turns the fusion into an AND across arms with
    very different recall, deleting exactly the paraphrase matches the dense arm
    was added to find.

    NULL HONESTY: a document BM25 did not rank keeps ``bm25_rank: None``, never
    0 — which in a 1-based ranking would read as "better than first".
    """
    bm25_ranks = {row["id"]: row["rank"] for row in (bm25.get("ranking") or ())}
    fused: list[dict[str, Any]] = []
    for match in matches:
        bm25_rank = bm25_ranks.get(match["id"])
        ranks = (match.get("vector_rank"), match.get("lexical_rank"), bm25_rank)
        fused.append({
            **match,
            "bm25_rank": bm25_rank,
            # A row no arm ranked scores 0.0 — a sum of no contributions, not a
            # missing score coerced to zero. Its three rank fields stay None,
            # so the absence is still readable off the row.
            "fused_score": sum(1.0 / (k + rank) for rank in ranks if rank is not None),
        })
    return sorted(fused, key=_fusion_order)
