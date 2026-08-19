"""Corrective RAG: grade what retrieval returned before anything reads it.

The corpus can always return its three closest documents. "Closest" is not
"relevant" — a query about a symbol the desk has never traded still comes back
with three cards, ranked, looking exactly like an answer. The grader's whole job
is to tell those two situations apart and to make the difference visible.

Three bands, and the third is the one that matters:

    score > 0.8    answer
    0.4 – 0.8      rewrite the query once, re-query, then answer or refuse
    score < 0.4    refuse, and say why

This repository already distinguishes "could not search" from "found nothing" —
``search`` returns ``state: unavailable`` rather than an empty list, and the
workspace renders the two differently. Refusing on relevance is that same rule
applied one step later: "nothing in this desk's own history is relevant to that"
is an answer. A fabricated one is not.

Why the grader is not a model
-----------------------------

Every signal it uses is already in the row the hybrid RPC returns — the fused
RRF score, whether BOTH retrievers surfaced the document, the cosine similarity,
how old it is, and how much of the query's own vocabulary it contains. Scoring
those arithmetically is deterministic, free, testable, and reproducible across
deployments. An LLM call here would make the grade a function of a model
version, which is precisely the property the rest of this project spends its
effort removing.

The rewrite is bounded to ONE retry. An unbounded corrective loop is a latency
hole and a cost hole, and the second attempt is where nearly all of the value
is: it either finds the exact token the first query missed, or the corpus does
not have it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

#: The two band edges. Named rather than inlined because /thresholds-style
#: surfaces print them, and a number a reader cannot find in the code is a
#: number nobody can argue with.
ANSWER_BAND = 0.8
REFUSE_BAND = 0.4

#: Recency stops mattering past this. A six-month-old incident is exactly as
#: relevant as a one-year-old one, and pretending otherwise would rank the
#: corpus by date wearing relevance's clothes.
RECENCY_HORIZON_DAYS = 180.0

_TOKEN = re.compile(r"[A-Za-z0-9_.\-]{2,}")


@dataclass(frozen=True, slots=True)
class Grade:
    """A graded retrieval, and the reason it graded that way."""

    score: float
    band: str                    #: "answer" | "rewrite" | "refuse"
    #: One line per signal, in the order they were weighted. Rendered to the
    #: reader when the grade refuses, because a refusal without a reason is
    #: indistinguishable from a broken search.
    reasons: tuple[str, ...]
    best_score: float
    both_retrievers: int

    @property
    def usable(self) -> bool:
        return self.band == "answer"


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN.findall(text or "")}


def _age_days(value: Any, now: datetime) -> float | None:
    if not value:
        return None
    try:
        stamp = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return max(0.0, (now - stamp).total_seconds() / 86_400.0)


class ContextGrader:
    """Scores a hybrid-retrieval result set against the query that produced it."""

    def __init__(
        self,
        answer_band: float = ANSWER_BAND,
        refuse_band: float = REFUSE_BAND,
    ) -> None:
        if not 0.0 <= refuse_band <= answer_band <= 1.0:
            raise ValueError("bands must satisfy 0 <= refuse <= answer <= 1")
        self.answer_band = float(answer_band)
        self.refuse_band = float(refuse_band)

    def grade(
        self,
        query: str,
        matches: list[dict[str, Any]],
        *,
        now: datetime | None = None,
    ) -> Grade:
        now = now or datetime.now(UTC)

        if not matches:
            # Not a low score — a different state. Nothing was returned, so
            # there is nothing to be more or less confident about.
            return Grade(0.0, "refuse", ("the corpus returned nothing for this query",), 0.0, 0)

        query_tokens = _tokens(query)
        best = matches[0]

        # 1. Agreement. A document both retrievers surfaced is the strongest
        #    signal this corpus produces: the embedder found it semantically and
        #    the lexical index found the literal token. RRF gives them equal
        #    say, and agreement is what RRF cannot express in its own score.
        agreed = sum(
            1 for m in matches
            if m.get("vector_rank") is not None and m.get("lexical_rank") is not None
        )
        agreement = min(1.0, agreed / max(1, min(len(matches), 3)))

        # 2. Similarity of the best match, floored at zero. Cosine over
        #    gte-small compresses near the top, so this is deliberately not the
        #    dominant term.
        similarity = max(0.0, min(1.0, float(best.get("similarity") or 0.0)))

        # 3. Vocabulary overlap. The desk's queries carry tokens the embedder
        #    blurs — BTCUSDT, a data_hash, a parameter pair — so a document
        #    that literally contains them is more likely to be the one meant.
        text = " ".join(str(best.get(f) or "") for f in ("title", "body", "symbol", "strategy"))
        overlap = (
            len(query_tokens & _tokens(text)) / len(query_tokens) if query_tokens else 0.0
        )

        # 4. Recency, bounded. Weakest of the four on purpose: relevance is not
        #    a function of date, it is only mildly correlated with it.
        age = _age_days(best.get("occurred_at"), now)
        recency = 1.0 if age is None else max(0.0, 1.0 - age / RECENCY_HORIZON_DAYS)

        score = (
            0.40 * agreement
            + 0.25 * similarity
            + 0.25 * min(1.0, overlap)
            + 0.10 * recency
        )
        score = max(0.0, min(1.0, score))

        band = (
            "answer" if score > self.answer_band
            else "refuse" if score < self.refuse_band
            else "rewrite"
        )

        reasons = (
            f"{agreed} of {min(len(matches), 3)} top matches were found by both retrievers",
            f"closest match similarity {similarity:.2f}",
            f"{overlap:.0%} of the query's terms appear in it",
            "recency unknown" if age is None else f"the closest match is {age:.0f} days old",
        )
        return Grade(score, band, reasons, score, agreed)

    def rewrite(self, query: str, matches: list[dict[str, Any]]) -> str:
        """One rewrite, built from what the corpus actually contains.

        Not a paraphrase and not an LLM call: the corpus's own vocabulary is the
        only thing that can turn a near-miss into a hit here. The best match's
        symbol and strategy are appended when the query did not already name
        them, which is the exact failure the lexical half of the hybrid index
        exists to catch and the one a first query most often misses.
        """
        if not matches:
            return query
        best = matches[0]
        have = _tokens(query)
        additions = [
            str(best.get(field))
            for field in ("symbol", "strategy")
            if best.get(field) and str(best[field]).lower() not in have
        ]
        return f"{query} {' '.join(additions)}".strip() if additions else query
