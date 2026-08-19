"""Entities and edges, tested for the questions they exist to answer.

Similarity ranking already handles "what looks like this". These tests are
about the ones it cannot: which runs saw the same bars, and what happened
after a promotion — where the two documents read nothing alike and are still
the connection a reader wants.
"""

from __future__ import annotations

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
