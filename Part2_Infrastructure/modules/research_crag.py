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
not have it. The bound is STRUCTURAL: `answer_from_corpus` is straight-line
code with one ``if``, not a loop with a counter, so there is no place a third
attempt could be added by accident.

The middle band DECIDES, and for a long time it did not. `research_crag_policy`
holds that decision — the one retry and the answer-or-refuse that follows it —
and its docstring records what the code used to do instead: refuse below the
floor and answer everything else, with `ANSWER_BAND` read by nobody. A
mid-band grade that does not clear the answer band after its rewrite now
refuses, which is what every version of the three lines above has said.

Where this runs
---------------

`answer_from_corpus` is what ``POST /api/research/rag/ask`` calls, and it is
the only corrective path in the gateway. ``/api/research/rag/search`` remains
the raw retrieval primitive — it returns what the index ranked closest, ungraded
— and this function is the policy over it: route, retrieve, grade, rewrite once,
then answer or refuse.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from modules import research_crag_policy, research_crag_signals, research_stages
from modules.research_router import ResearchRouter, ToolResult
from modules.schemas import ResearchGraphNeighbour, ResearchRagMatch

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

        # 5. The cross-encoder, WHEN one ran. The four signals above are all
        #    properties of the retrieval; this is the only one that read the
        #    query and the document together, and it was being ignored — it
        #    moved a grade only by changing which row landed first. Folded here
        #    rather than weighted above because it is CONDITIONAL: a row with
        #    no `rerank_score` returns this score untouched, so the default
        #    deployment's numbers do not move by a decimal.
        score, cross_encoder = research_crag_signals.cross_encoder(best, score)
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
        # Appended, never inserted: a caller reading `reasons[3]` for recency
        # must not find a signal that is absent on most deployments there.
        if cross_encoder is not None:
            reasons += (cross_encoder,)
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


# --------------------------------------------------------------------------- #
# The corrective path: what a production query actually runs
# --------------------------------------------------------------------------- #
class ToolCallView(BaseModel):
    """One planned tool call and what it returned — the ledger row, echoed.

    Returned to the caller as well as written to the audit log so a reader can
    see WHICH tools produced the rows they are looking at without holding a
    DuckDB handle. Same fields, same names, one source.
    """

    tool: str
    reason: str
    state: str
    rows: int
    detail: str | None = None


class ResearchAnswer(BaseModel):
    """A graded answer, a refusal with its reason, or a state that is neither.

    FOUR states, and the point of the model is that they never collapse into
    each other:

    ``ok``           the corpus was searched and what came back was good enough
                     to read. ``matches`` may still be EMPTY — that is
                     "searched and found nothing", which is an answer.
    ``refused``      documents came back and they are not relevant. ``matches``
                     is empty and ``refusal`` says why, including how many
                     documents were searched — so a reader can tell a refusal
                     on relevance from an empty corpus.
    ``unavailable``  the index is not configured on this deployment.
    ``embed_failed`` the embedding service did not answer.

    ``score``/``band``/``reasons`` are the grade behind the verdict, present
    whenever anything was graded. A caller that renders a weak ``ok`` without
    showing the score is choosing to; the number is there.
    """

    state: Literal["ok", "refused", "unavailable", "embed_failed"]
    #: The query the answer was retrieved for — the rewrite when one was used.
    query: str
    #: Set only when the mid-band rewrite happened AND changed the query.
    rewritten_query: str | None = None
    #: Retrieval rounds. 1 or 2. Never 3: there is no loop here.
    retrievals: int = 1
    matches: list[ResearchRagMatch] = Field(default_factory=list)
    connected: list[ResearchGraphNeighbour] = Field(default_factory=list)
    corpus_size: int | None = None
    score: float | None = None
    band: Literal["answer", "rewrite", "refuse"] | None = None
    reasons: list[str] = Field(default_factory=list)
    #: The sentence a refusal says to the caller. None unless refused.
    refusal: str | None = None
    planner: str = "rules"
    fallback: bool = False
    calls: list[ToolCallView] = Field(default_factory=list)
    #: The cross-encoder's own report on `matches`: whether it ordered them and
    #: the state that says so. `rerank_state` None means re-ranking was never
    #: reached, which is not "reached it with no model configured".
    reranked: bool = False
    rerank_state: str | None = None
    #: The generation report, or None when generation was never ATTEMPTED —
    #: a different fact from a report whose `verdict` is "refused". Never
    #: flattened into `state`/`refusal`: CRAG refuses on retrieval relevance,
    #: generation on a grounding fence, and one field cannot say which fired.
    generation: dict[str, Any] | None = None


def _views(calls: list[ToolResult]) -> list[ToolCallView]:
    return [ToolCallView(**call.as_audit()) for call in calls]


async def answer_from_corpus(
    rag: Any,
    query: str,
    *,
    match_count: int = 3,
    kind: str | None = None,
    router: ResearchRouter | None = None,
    grader: ContextGrader | None = None,
    audit: Any = None,
    now: datetime | None = None,
    desk_id: str | None = None,
) -> ResearchAnswer:
    """Route, retrieve, grade, rewrite ONCE, then answer or refuse.

    The three bands are enforced here and in `research_crag_policy`, and
    nowhere else:

    * ``> 0.8``   answer.
    * ``0.4-0.8`` rewrite from the corpus's own vocabulary, re-query, and then
      answer or refuse ON WHAT THAT SECOND ROUND RETURNED. A mid-band grade
      that still does not clear the answer band refuses — which is a behaviour
      change from the version where the middle band decided nothing at all.
    * ``< 0.4``   refuse, with the reason, without spending a second query on a
      result that is not close.
    """
    grader = grader or ContextGrader()
    router = router or ResearchRouter(audit=audit)

    plan = router.plan(query)
    # WIDE for the arm the cross-encoder narrows again, and the caller's own
    # width for the graph arm, which it never sees. `research_stages` holds
    # both trades; the router applies one count to every tool, so the second
    # width reaches the corpus on the handle rather than through the plan.
    run = await router.execute(
        plan,
        research_stages.with_graph_width(rag, match_count),
        match_count=research_stages.wide(match_count),
        kind=kind, desk_id=desk_id,
    )

    if run.state != "ok" or not run.matches:
        # Two different facts, both passed through as themselves: a state that
        # is not "ok" means the search could not run, and "ok" with no rows
        # means it ran and the corpus holds nothing like this. Neither is a
        # refusal, and grading either one would turn it into one.
        return ResearchAnswer(
            state=run.state, query=query, retrievals=1, corpus_size=run.corpus_size,
            connected=run.connected, planner=plan.planner, fallback=plan.fallback,
            calls=_views(list(run.calls)),
        )

    # Narrow BEFORE grading: `grade` reads matches[0] as the best match, and
    # re-ranking is what changes which row that is.
    run.matches, rerank_report = await research_stages.narrow(query, run.matches, match_count)
    served = research_crag_policy.Round(
        query=query,
        run=run,
        grade=grader.grade(query, run.matches, now=now),
        plan=plan,
        rerank=rerank_report,
        calls=list(run.calls),
    )

    if served.grade.band == "rewrite":
        # The ONE retry, and the only place a second retrieval can happen.
        served = await research_crag_policy.rewrite_once(
            served, rag, router, grader, match_count=match_count, kind=kind,
            now=now, desk_id=desk_id,
        )
    # There is no third attempt, and no loop for one to be added to.

    refused = research_crag_policy.refused(served)
    grade, run = served.grade, served.run
    # Generation only where CRAG kept the evidence. None means never ATTEMPTED,
    # which is not the fact a report whose verdict is "refused" states.
    generation = None if refused else await research_stages.synthesise(
        served.query, run.matches, grade.score, router,
    )
    return ResearchAnswer(
        state="refused" if refused else "ok",
        query=served.query,
        rewritten_query=served.rewritten,
        retrievals=served.retrievals,
        matches=[] if refused else run.matches,
        connected=[] if refused else run.connected,
        corpus_size=run.corpus_size,
        score=round(grade.score, 4),
        band=grade.band,
        reasons=list(grade.reasons),
        refusal=research_crag_policy.refusal(served, grader) if refused else None,
        planner=served.plan.planner,
        fallback=served.plan.fallback,
        calls=_views(served.calls),
        reranked=served.rerank["reranked"], rerank_state=served.rerank["state"],
        generation=generation,
    )
