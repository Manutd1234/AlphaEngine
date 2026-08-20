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

Where extraction actually runs
-----------------------------

On the row the insert echoes back, one statement after the document is written
— `persist_edges`, from the write queue's drain loop. Migration 20260820090400
describes this as happening "at card-render time"; it does not, and the
distinction is worth stating rather than papering over. The renderer produces
text, the corpus stores the columns, and the entities are read back off the
STORED row. Extracting at render time instead would buy nothing and cost
something real: `research_documents` has no entities column, so there is
nowhere to carry them, and a copy read off the submitted dict could disagree
with the row the database actually holds — which is the one every traversal
reads. Same columns, same values, one source of truth.
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
#:
#: An order id and a model are in here already, under the names the corpus
#: stores them by: an incident's ``source_ref`` IS its order id, and a fitted
#: run's ``strategy`` IS its model. They are not emitted a second time under
#: their own entity types because nothing could use them — ``research_relation``
#: has no ``same_model`` and no ``same_order``, and an entity no relation reads
#: is a row nobody traverses.
_ENTITY_FIELDS: tuple[tuple[str, str], ...] = (
    ("symbol", "symbol"),
    ("interval", "interval"),
    ("strategy", "strategy"),
    ("data_hash", "data_hash"),
    ("kind", "kind"),
)

#: Entity types a candidate lookup may filter on. ``interval`` and ``kind`` are
#: deliberately out: every 4h document matching every other 4h document is a
#: candidate set with no discriminating power, and the bounded query would fill
#: with documents that share nothing anyone would traverse for.
_LINKABLE: tuple[str, ...] = ("symbol", "strategy", "data_hash")

#: Kinds that describe a RUN. Both a parameter sweep and a fitted model can be
#: followed by an incident and both can be promoted, and ``ml_run`` joined the
#: corpus in migration 20260820090600 — after these relations were written, so
#: until now a fitted model was a document the graph could reach only sideways.
_RUN_KINDS: tuple[str, ...] = ("backtest_run", "ml_run")


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
                src.get("kind") in _RUN_KINDS
                and dst.get("kind") == "risk_incident"
                and src_entities.get("symbol")
                and src_entities.get("symbol") == dst_entities.get("symbol")
            ):
                edges.append(Edge(
                    str(src_id), str(dst_id), FOLLOWED_BY, str(src_entities["symbol"]),
                ))
            if (
                src.get("kind") in _RUN_KINDS
                and dst.get("kind") == "execution_summary"
                and src_entities.get("strategy")
                and src_entities.get("strategy") == dst_entities.get("strategy")
            ):
                edges.append(Edge(
                    str(src_id), str(dst_id), PROMOTED_TO, str(src_entities["strategy"]),
                ))

    return edges


async def persist_edges(
    client: Any,
    response: Any,
    *,
    desk_id: str,
    limit: int = 40,
) -> int:
    """Store every edge the just-written document implies. Returns the count.

    `derive_edges` had exactly one caller in the repository and it was a test.
    The migration created `research_edges`, the traversal function reads it, the
    corpus panel surfaces graph answers from it — and nothing ever wrote a row,
    so every traversal returned empty and could not say why.

    ── Bounded on purpose ─────────────────────────────────────────────────────
    Candidates are the most recent `limit` documents sharing this one's symbol
    or data hash, not the corpus. `derive_edges` is O(n²) over what it is given,
    and materialising the full cross product of a growing corpus is how a link
    table becomes larger than the thing it links.

    ── Only edges touching the new document ───────────────────────────────────
    The candidates already have edges between themselves from when each of them
    was written. Re-deriving those would be correct and wasted; the unique
    constraint would reject them all.

    ── Never raises ───────────────────────────────────────────────────────────
    A document that indexed successfully must not be reported as failed because
    its graph edges could not be written. The corpus is the primary artefact and
    the graph is derived from it, so a missing edge is recoverable by re-deriving
    and a missing document is not.
    """
    try:
        rows = response.json() or []
    except ValueError:
        return 0
    inserted = rows[0] if isinstance(rows, list) and rows else None
    # `resolution=ignore-duplicates` returns an empty representation when the
    # document was already there — and if it was, its edges were written then.
    if not isinstance(inserted, dict) or not inserted.get("id"):
        return 0

    # Extraction, on the document that was just written, from the columns it
    # already has. This is the ONLY definition of what a document can be linked
    # by: the candidate lookup below is built from the entities rather than from
    # a hand-written pair of column names, so a document that carries only a
    # strategy stops being an orphan the graph can never reach.
    entities = [e for e in extract_entities(inserted) if e.type in _LINKABLE]
    predicate = ",".join(f"{e.type}.eq.{e.value}" for e in entities)
    if not predicate:
        return 0

    try:
        found = await client.get(
            "/rest/v1/research_documents",
            params={
                "select": "id,kind,symbol,strategy,occurred_at,data_hash,metrics",
                "desk_id": f"eq.{desk_id}",
                "or": f"({predicate})",
                "order": "occurred_at.desc",
                "limit": str(limit),
            },
        )
        if found.status_code >= 300:
            return 0
        candidates = found.json() or []
    except Exception:
        return 0

    new_id = str(inserted["id"])
    edges = [
        edge for edge in derive_edges([*candidates, inserted])
        if edge.src_id == new_id or edge.dst_id == new_id
    ]
    if not edges:
        return 0

    try:
        written = await client.post(
            "/rest/v1/research_edges",
            json=[{**edge.as_row(), "desk_id": desk_id} for edge in edges],
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        return len(edges) if written.status_code < 300 else 0
    except Exception:
        return 0
