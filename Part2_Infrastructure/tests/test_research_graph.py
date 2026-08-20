"""Entities and edges, tested for the questions they exist to answer.

Similarity ranking already handles "what looks like this". These tests are
about the ones it cannot: which runs saw the same bars, and what happened
after a promotion — where the two documents read nothing alike and are still
the connection a reader wants.
"""

from __future__ import annotations

import pytest

from modules.research_graph import (
    FOLLOWED_BY,
    PROMOTED_TO,
    SAME_DATA,
    SAME_STRATEGY,
    SAME_SYMBOL,
    derive_edges,
    extract_entities,
)


def _doc(doc_id, **over):
    base = dict(
        id=doc_id, kind="backtest_run", symbol="BTCUSDT", interval="4h",
        strategy="ma_crossover", data_hash="9f9602c7",
        occurred_at="2026-08-01T00:00:00+00:00", metrics={},
    )
    base.update(over)
    return base


def test_entities_come_off_structured_fields_in_a_stable_order():
    entities = extract_entities(_doc("a"))
    assert [e.type for e in entities] == ["symbol", "interval", "strategy", "data_hash", "kind"]
    assert [e.value for e in entities][:2] == ["BTCUSDT", "4h"]


def test_a_regime_is_read_from_the_metrics_when_one_is_there():
    # The field that turns "these two runs disagree" into "these two runs were
    # fitted in different markets", which is usually the answer.
    entities = extract_entities(_doc("a", metrics={"regime": "high_vol"}))
    assert ("regime", "high_vol") in [(e.type, e.value) for e in entities]


def test_absent_fields_produce_no_entity_rather_than_an_empty_one():
    entities = extract_entities(_doc("a", strategy=None, data_hash=""))
    types = [e.type for e in entities]
    assert "strategy" not in types and "data_hash" not in types


def test_two_runs_over_the_same_bars_are_joined_and_the_evidence_says_which():
    edges = derive_edges([_doc("a"), _doc("b", strategy="ema_crossover")])
    same_data = [e for e in edges if e.relation == SAME_DATA]
    assert len(same_data) == 1
    assert same_data[0].evidence == "9f9602c7", "the edge must name what they share"


def test_runs_over_different_bars_are_not_joined_by_data():
    edges = derive_edges([_doc("a"), _doc("b", data_hash="deadbeef")])
    assert not [e for e in edges if e.relation == SAME_DATA]
    # …but they still share the symbol and the strategy.
    assert {e.relation for e in edges} == {SAME_SYMBOL, SAME_STRATEGY}


def test_an_incident_after_a_backtest_on_the_same_symbol_is_directional():
    # The sequence similarity ranking never surfaces: a FAIL verdict and a
    # drawdown breach read nothing alike.
    edges = derive_edges([
        _doc("run", occurred_at="2026-08-01T00:00:00+00:00"),
        _doc("incident", kind="risk_incident", strategy=None,
             occurred_at="2026-08-05T00:00:00+00:00"),
    ])
    followed = [e for e in edges if e.relation == FOLLOWED_BY]
    assert len(followed) == 1
    assert followed[0].src_id == "run" and followed[0].dst_id == "incident"


def test_direction_follows_time_not_argument_order():
    later_first = derive_edges([
        _doc("incident", kind="risk_incident", strategy=None,
             occurred_at="2026-08-05T00:00:00+00:00"),
        _doc("run", occurred_at="2026-08-01T00:00:00+00:00"),
    ])
    followed = [e for e in later_first if e.relation == FOLLOWED_BY]
    assert len(followed) == 1
    assert followed[0].src_id == "run", "the older document is always the source"


def test_a_promotion_reaches_the_execution_that_followed_it():
    edges = derive_edges([
        _doc("run", occurred_at="2026-08-01T00:00:00+00:00"),
        _doc("fill", kind="execution_summary", occurred_at="2026-08-02T00:00:00+00:00"),
    ])
    promoted = [e for e in edges if e.relation == PROMOTED_TO]
    assert len(promoted) == 1
    assert promoted[0].evidence == "ma_crossover"


def test_a_document_is_never_joined_to_itself():
    edges = derive_edges([_doc("a"), _doc("a")])
    assert all(e.src_id != e.dst_id for e in edges)


def test_symmetric_edges_are_stored_once_not_twice():
    # The traversal reads both directions and there are indexes on src and dst,
    # so storing both would double the table to answer the same question.
    edges = derive_edges([_doc("a"), _doc("b", strategy="ema_crossover")])
    pairs = {(e.src_id, e.dst_id, e.relation) for e in edges}
    mirrored = {(dst, src, rel) for src, dst, rel in pairs}
    assert not (pairs & mirrored)


def test_derivation_is_deterministic():
    # A graph whose edges change when nobody changed anything is a graph
    # nobody can reason from — which is the whole reason extraction reads
    # columns rather than asking a model.
    docs = [_doc("a"), _doc("b", data_hash="other"), _doc("c", kind="risk_incident")]
    first = [e.as_row() for e in derive_edges(docs)]
    second = [e.as_row() for e in derive_edges(list(reversed(docs)))]
    assert first == second


def test_documents_without_an_id_are_skipped_rather_than_producing_a_null_edge():
    edges = derive_edges([_doc("a"), _doc(None), _doc("c")])
    assert all(e.src_id and e.dst_id for e in edges)


# ---------------------------------------------------------------------------
# persist_edges — the half that was missing
# ---------------------------------------------------------------------------
#
# `derive_edges` had one caller in the whole repository and it was the test
# above. The migration created `research_edges`, `traverse_research_graph` reads
# it and the corpus panel surfaces graph answers from it — and nothing wrote a
# row, so every traversal returned empty and had no way to say why.


class _Response:
    def __init__(self, payload, status=201):
        self._payload = payload
        self.status_code = status

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _Client:
    """Records what was asked of it, so the REQUEST can be asserted."""

    def __init__(self, candidates, *, get_status=200, post_status=201):
        self.candidates = candidates
        self.get_status = get_status
        self.post_status = post_status
        self.posted: list[dict] = []
        self.params: dict = {}
        self.headers: dict = {}

    async def get(self, _path, params=None):
        self.params = params or {}
        return _Response(self.candidates, self.get_status)

    async def post(self, _path, json=None, headers=None):
        self.posted = json or []
        self.headers = headers or {}
        return _Response([], self.post_status)


def _document(doc_id, **over):
    base = {
        "id": doc_id,
        "kind": "backtest_run",
        "symbol": "BTCUSDT",
        "strategy": "ma_cross",
        "data_hash": "abc123",
        "occurred_at": "2026-08-20T10:00:00Z",
        "metrics": {},
    }
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_a_new_document_writes_the_edges_it_implies():
    from modules.research_graph import persist_edges

    existing = _document("older", occurred_at="2026-08-19T10:00:00Z")
    client = _Client([existing])
    written = await persist_edges(
        client, _Response([_document("newer")]), desk_id="desk-1",
    )
    assert written > 0, "a document sharing a data hash and a symbol implies edges"
    relations = {row["relation"] for row in client.posted}
    assert "same_data" in relations
    assert all(row["desk_id"] == "desk-1" for row in client.posted)


@pytest.mark.asyncio
async def test_only_edges_touching_the_new_document_are_written():
    """The candidates already have edges between themselves."""
    from modules.research_graph import persist_edges

    a = _document("a", occurred_at="2026-08-18T10:00:00Z")
    b = _document("b", occurred_at="2026-08-19T10:00:00Z")
    client = _Client([a, b])
    await persist_edges(client, _Response([_document("c")]), desk_id="desk-1")
    for row in client.posted:
        assert "c" in (row["src_id"], row["dst_id"]), (
            f"re-derived an a-b edge that was written when b arrived: {row}"
        )


@pytest.mark.asyncio
async def test_a_duplicate_document_writes_no_edges():
    """`resolution=ignore-duplicates` returns an empty representation.

    If the document was already there, its edges were written then.
    """
    from modules.research_graph import persist_edges

    client = _Client([_document("older")])
    assert await persist_edges(client, _Response([]), desk_id="desk-1") == 0
    assert client.posted == []


@pytest.mark.asyncio
async def test_the_candidate_query_is_bounded_and_desk_scoped():
    from modules.research_graph import persist_edges

    client = _Client([_document("older")])
    await persist_edges(client, _Response([_document("newer")]), desk_id="desk-9", limit=7)
    assert client.params["desk_id"] == "eq.desk-9"
    assert client.params["limit"] == "7", (
        "derive_edges is O(n^2) over what it is given; an unbounded candidate "
        "set is how a link table outgrows the thing it links"
    )
    assert "symbol.eq.BTCUSDT" in client.params["or"]


@pytest.mark.asyncio
async def test_the_write_ignores_duplicates():
    from modules.research_graph import persist_edges

    client = _Client([_document("older")])
    await persist_edges(client, _Response([_document("newer")]), desk_id="desk-1")
    assert "ignore-duplicates" in client.headers.get("Prefer", ""), (
        "the unique constraint on (src_id, dst_id, relation) would otherwise "
        "turn a re-index into a failed write"
    )


@pytest.mark.asyncio
async def test_a_failure_never_reaches_the_caller():
    """A document that indexed must not report as failed over its edges.

    The corpus is the primary artefact and the graph is derived from it: a
    missing edge can be re-derived, a missing document cannot.
    """
    from modules.research_graph import persist_edges

    broken = _Client([_document("older")], get_status=500)
    assert await persist_edges(broken, _Response([_document("newer")]), desk_id="d") == 0

    unparseable = _Client([_document("older")])
    assert await persist_edges(unparseable, _Response(ValueError("not json")), desk_id="d") == 0

    class Exploding(_Client):
        async def get(self, *_a, **_k):
            raise RuntimeError("connection reset")

    assert await persist_edges(
        Exploding([]), _Response([_document("newer")]), desk_id="d",
    ) == 0


# ---------------------------------------------------------------------------
# entity extraction, at the point the document is written
# ---------------------------------------------------------------------------
#
# Extraction is a read of columns, and these pin WHICH columns: the candidate
# lookup is built from `extract_entities`, not from a hand-written pair of
# column names, so "what a document can be linked by" has one definition.


@pytest.mark.asyncio
async def test_the_candidate_lookup_filters_on_every_linkable_entity():
    from modules.research_graph import persist_edges

    client = _Client([_document("older")])
    await persist_edges(client, _Response([_document("newer")]), desk_id="desk-1")
    predicate = client.params["or"]
    for expected in ("symbol.eq.BTCUSDT", "strategy.eq.ma_cross", "data_hash.eq.abc123"):
        assert expected in predicate, expected
    assert "interval.eq" not in predicate, (
        "every 4h document matching every other 4h document is a candidate set "
        "with no discriminating power"
    )


@pytest.mark.asyncio
async def test_a_document_carrying_only_a_strategy_is_not_an_orphan():
    """It used to be: the lookup asked for symbol or data_hash and nothing else.

    A document with neither was skipped before a candidate was ever read, so it
    entered the corpus unreachable and nothing said so.
    """
    from modules.research_graph import persist_edges

    lonely = _document("newer", symbol=None, data_hash=None)
    client = _Client([_document("older", symbol=None, data_hash=None)])
    written = await persist_edges(client, _Response([lonely]), desk_id="desk-1")
    assert client.params.get("or") == "(strategy.eq.ma_cross)"
    assert written > 0 and {row["relation"] for row in client.posted} == {SAME_STRATEGY}


@pytest.mark.asyncio
async def test_a_document_with_no_linkable_entity_is_not_queried_for_at_all():
    from modules.research_graph import persist_edges

    client = _Client([_document("older")])
    orphan = _document("newer", symbol=None, data_hash=None, strategy=None)
    assert await persist_edges(client, _Response([orphan]), desk_id="desk-1") == 0
    assert client.params == {}, "an unfiltered candidate query would read the corpus"


def test_a_fitted_run_is_followed_by_the_incident_that_came_after_it():
    """`ml_run` joined the corpus after these relations were written.

    A fitted model that was promoted and then breached a drawdown limit is the
    same story as a sweep that did, and it was the one kind the graph could not
    tell.
    """
    edges = derive_edges([
        _doc("fit", kind="ml_run", strategy="ridge", occurred_at="2026-08-01T00:00:00+00:00"),
        _doc("incident", kind="risk_incident", strategy=None,
             occurred_at="2026-08-05T00:00:00+00:00"),
    ])
    followed = [e for e in edges if e.relation == FOLLOWED_BY]
    assert len(followed) == 1
    assert (followed[0].src_id, followed[0].evidence) == ("fit", "BTCUSDT")


def test_a_fitted_run_reaches_the_execution_it_was_promoted_into():
    edges = derive_edges([
        _doc("fit", kind="ml_run", occurred_at="2026-08-01T00:00:00+00:00"),
        _doc("fill", kind="execution_summary", occurred_at="2026-08-02T00:00:00+00:00"),
    ])
    promoted = [e for e in edges if e.relation == PROMOTED_TO]
    assert len(promoted) == 1 and promoted[0].src_id == "fit"
