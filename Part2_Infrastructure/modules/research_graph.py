"""Entities and edges over the research corpus, without a graph database.

Hybrid retrieval answers "what is similar to this". It has no way to answer
"what is CONNECTED to this" — every run that saw the same bars, the incident
that followed a promotion, the regime a parameter set was fitted in. Those are
relations between documents, and a fused similarity ranking cannot express one.

Extraction is a read, not an inference
--------------------------------------

The entities here are not the open-ended kind a general extractor discovers.
They are the desk's own vocabulary and they are already structured on every
document: symbol, interval, strategy, data_hash, kind, source_ref. So this
module reads columns. There is no LLM in the ingest path, which keeps indexing
deterministic, free, and replayable — the same three properties the rest of the
research plane is built for.

That is a real limitation and it is the right trade. A model could find
entities in the prose that these rules miss. It would also find different ones
next month, and a graph whose edges change when nobody changed anything is a
graph nobody can reason from.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: Relation names, matching the `research_relation` enum in the migration.
#: Duplicated deliberately — the database owns the constraint, this owns the
#: derivation, and a mismatch should fail loudly at insert rather than silently
#: produce edges nothing traverses.
SAME_DATA = "same_data"
SAME_SYMBOL = "same_symbol"
SAME_STRATEGY = "same_strategy"
SAME_REGIME = "same_regime"
FOLLOWED_BY = "followed_by"
PROMOTED_TO = "promoted_to"

#: Fields read straight off a research_documents row. Order is the order they
#: are emitted in, which keeps a document's entity list stable across runs.
_ENTITY_FIELDS: tuple[tuple[str, str], ...] = (
    ("symbol", "symbol"),
    ("interval", "interval"),
    ("strategy", "strategy"),
    ("data_hash", "data_hash"),
    ("kind", "kind"),
)


@dataclass(frozen=True, slots=True)
class Entity:
    type: str
    value: str

    def as_dict(self) -> dict[str, str]:
        return {"type": self.type, "value": self.value}


@dataclass(frozen=True, slots=True)
class Edge:
    src_id: str
    dst_id: str
    relation: str
    #: What the two share. A traversal that cannot say WHY two documents are
    #: joined is one nobody trusts the second time they use it.
    evidence: str | None = None

    def as_row(self) -> dict[str, Any]:
        return {
            "src_id": self.src_id,
            "dst_id": self.dst_id,
            "relation": self.relation,
            "evidence": self.evidence,
        }


def extract_entities(document: dict[str, Any]) -> list[Entity]:
    """The entities on one document, in a stable order.

    A regime, when the metrics carry one, is included: it is the field that
    turns "these two runs disagree" into "these two runs were fitted in
    different markets", which is usually the answer.
    """
    entities: list[Entity] = []
    for field, entity_type in _ENTITY_FIELDS:
        value = document.get(field)
        if value:
            entities.append(Entity(entity_type, str(value)))

    metrics = document.get("metrics")
    if isinstance(metrics, dict):
        regime = metrics.get("regime") or metrics.get("volatility_regime")
        if regime:
            entities.append(Entity("regime", str(regime)))
    return entities


def _order_key(document: dict[str, Any]) -> tuple[str, str]:
    """Time first, then id.

    The id is not decoration. Two documents can carry the same occurred_at —
    a sweep and the summary it produced, or two runs indexed in one batch — and
    `sorted` is stable, so on a tie it preserves INPUT order. That made the
    derived edge set depend on the order the caller happened to pass its
    documents in, which a test caught by reversing the list. Breaking the tie
    on id makes the graph a function of the documents alone.
    """
    return (str(document.get("occurred_at") or ""), str(document.get("id") or ""))


def derive_edges(documents: list[dict[str, Any]]) -> list[Edge]:
    """Every edge implied by a set of documents.

    O(n²) over the set it is given, and deliberately given a bounded set — a
    backfill passes one symbol's documents at a time. Materialising the full
    cross product of a growing corpus is how a link table becomes larger than
    the thing it links.

    Edges are emitted in one direction only for the symmetric relations
    (same_data, same_symbol, same_strategy, same_regime), from the older
    document to the newer. The traversal reads both directions — there are
    indexes on src and dst — so storing both would double the table to answer
    the same question.
    """
    edges: list[Edge] = []
    ordered = sorted(documents, key=_order_key)

    for i, src in enumerate(ordered):
        src_id = src.get("id")
        if not src_id:
            continue
        src_entities = {e.type: e.value for e in extract_entities(src)}

        for dst in ordered[i + 1:]:
            dst_id = dst.get("id")
            if not dst_id or dst_id == src_id:
                continue
            dst_entities = {e.type: e.value for e in extract_entities(dst)}

            for entity_type, relation in (
                ("data_hash", SAME_DATA),
                ("symbol", SAME_SYMBOL),
                ("strategy", SAME_STRATEGY),
                ("regime", SAME_REGIME),
            ):
                shared = src_entities.get(entity_type)
                if shared and shared == dst_entities.get(entity_type):
                    edges.append(Edge(str(src_id), str(dst_id), relation, shared))

            # Directional. A risk incident that follows a backtest on the same
            # symbol is the sequence a reader is actually looking for, and it
            # is the one similarity ranking never surfaces because the two
            # documents read nothing alike.
            if (
                src.get("kind") == "backtest_run"
                and dst.get("kind") == "risk_incident"
                and src_entities.get("symbol")
                and src_entities.get("symbol") == dst_entities.get("symbol")
            ):
                edges.append(Edge(
                    str(src_id), str(dst_id), FOLLOWED_BY, str(src_entities["symbol"]),
                ))
            if (
                src.get("kind") == "backtest_run"
                and dst.get("kind") == "execution_summary"
                and src_entities.get("strategy")
                and src_entities.get("strategy") == dst_entities.get("strategy")
            ):
                edges.append(Edge(
                    str(src_id), str(dst_id), PROMOTED_TO, str(src_entities["strategy"]),
                ))

    return edges
