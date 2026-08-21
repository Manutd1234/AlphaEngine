"""The cross-encoder re-ranker, tested without a cross-encoder.

Every assertion here runs against a fake scorer substituted at
``_import_cross_encoder``, deliberately. CI is network-free by construction and
``fastembed`` is an optional extra, so a test that needed the real ONNX model
would not run — and it would not run on exactly the path that matters most,
which is the path where there is no model.

Because that is the property this module lives or dies by: when no re-ranker is
available the fused RRF order must survive UNCHANGED and TRUNCATED, not be
emptied, re-ordered or decorated with invented scores. RRF order is what the
desk serves today; returning nothing would turn a missing optional package into
an outage. The first class below is that property, taken from four angles.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules import research_rerank as rr

DOCS = [
    {"id": "a", "title": "BTCUSDT crossover backtest", "body": "sharpe 1.4"},
    {"id": "b", "title": "ETHUSDT breakout backtest", "body": "sharpe 0.2"},
    {"id": "c", "title": "desk incident", "body": "a fill was cancelled late"},
]


def _cold(monkeypatch):
    """Forget any loaded encoder and any remembered load failure.

    The cache is module state on purpose — it is what makes the model load once
    per process — so a test that did not clear it would inherit the encoder the
    previous one installed and pass for the wrong reason.
    """
    monkeypatch.setattr(rr, "_ENCODER", None)
    monkeypatch.setattr(rr, "_LOAD_ERROR", None)
    monkeypatch.setattr(rr, "_LOAD_ERROR_STATE", None)
    monkeypatch.setattr(rr, "_LOADED_PATH", None)


@pytest.fixture(autouse=True)
def _cold_module(monkeypatch):
    """Every test starts with an unloaded encoder and no remembered failure."""
    _cold(monkeypatch)


def _settings(monkeypatch, **overrides):
    """Swap the whole settings object, not a field.

    `Settings` is a frozen dataclass, so setattr on it raises
    FrozenInstanceError — which is the point of freezing it, and why a test
    that wants different configuration substitutes the object instead.
    """
    base = {"rerank_model_path": "/models/bge-reranker-base"}
    monkeypatch.setattr(rr, "settings", SimpleNamespace(**{**base, **overrides}))


def _install(monkeypatch, scores=None, *, raises=None, load_raises=None):
    """Substitute a fake cross-encoder at the module's import boundary.

    Returns a recorder so a test can assert how many times the model was
    CONSTRUCTED — the difference between a cached encoder and one rebuilt per
    request is invisible in the report and very visible in the latency.
    """
    _cold(monkeypatch)
    _settings(monkeypatch)
    recorder = SimpleNamespace(built=0, batches=[], query=None, kwargs=None)

    class FakeCrossEncoder:
        def __init__(self, **kwargs):
            recorder.built += 1
            recorder.kwargs = kwargs
            if load_raises is not None:
                raise load_raises

        def rerank(self, query, documents):
            recorder.query = query
            recorder.batches.append(list(documents))
            if raises is not None:
                raise raises
            return list(scores or [])

    monkeypatch.setattr(rr, "_import_cross_encoder", lambda: (FakeCrossEncoder, None))
    return recorder


def _no_model(monkeypatch, reason="the fastembed package is not installed"):
    _cold(monkeypatch)
    _settings(monkeypatch)
    monkeypatch.setattr(rr, "_import_cross_encoder", lambda: (None, reason))


class TestTheFallbackKeepsTheFusedOrder:
    """The single most important behaviour: no model must never mean no results."""

    def test_an_unconfigured_desk_returns_the_fused_order_untouched(self, monkeypatch):
        _settings(monkeypatch, rerank_model_path="")
        out = rr.rerank("sharpe", DOCS, top_k=3)
        assert out["reranked"] is False
        assert out["state"] == "unconfigured"
        assert "RERANK_MODEL_PATH" in out["reason"], "the reason must name the setting"
        assert [d["id"] for d in out["documents"]] == ["a", "b", "c"], (
            "an absent re-ranker must not disturb the order RRF produced"
        )
        assert out["documents"][0] is DOCS[0], "the rows must come back unmodified"

    def test_the_fallback_truncates_to_top_k(self, monkeypatch):
        _no_model(monkeypatch)
        out = rr.rerank("sharpe", DOCS, top_k=2)
        assert [d["id"] for d in out["documents"]] == ["a", "b"]
        assert out["returned"] == 2
        assert out["candidates"] == 3, (
            "the report must still say how wide the net was, or a caller cannot "
            "tell a narrow retrieval from a truncated one"
        )

    def test_the_fallback_never_returns_an_empty_list(self, monkeypatch):
        # Zero is in the list on purpose: a caller asking for no documents is a
        # caller bug, and answering it with nothing would be indistinguishable
        # from the outage this module refuses to be.
        _no_model(monkeypatch)
        for top_k in (0, 1, 3, 20):
            out = rr.rerank("sharpe", DOCS, top_k=top_k)
            assert out["documents"], (
                f"top_k={top_k} returned nothing; falling back to RRF order is a "
                "working pipeline, returning nothing is an outage"
            )

    def test_the_fallback_invents_no_scores(self, monkeypatch):
        _no_model(monkeypatch)
        out = rr.rerank("sharpe", DOCS, top_k=3)
        assert all(rr.SCORE_FIELD not in d for d in out["documents"]), (
            "a document nothing scored must carry no score key — not None and not "
            "0.0, either of which reads like a measurement"
        )
        assert out["model"] is None, "no model scored these, so none may be named"

    def test_a_missing_package_names_the_extras_file(self, monkeypatch):
        _settings(monkeypatch)
        out = rr.rerank("sharpe", DOCS, top_k=3)
        assert out["state"] == "unavailable"
        assert "requirements-rerank.txt" in out["reason"], (
            "the reason must say how to fix it"
        )


class TestAFailingModelIsReportedNotPropagated:
    def test_a_scorer_that_raises_leaves_the_fused_order_standing(self, monkeypatch):
        _install(monkeypatch, raises=RuntimeError("onnxruntime segfaulted"))
        out = rr.rerank("sharpe", DOCS, top_k=3)
        assert out["reranked"] is False
        assert out["state"] == "failed"
        assert "RuntimeError" in out["reason"]
        assert [d["id"] for d in out["documents"]] == ["a", "b", "c"]

    def test_a_load_that_raises_is_reported_once_and_not_retried(self, monkeypatch):
        recorder = _install(monkeypatch, load_raises=OSError("no such model directory"))
        first = rr.rerank("sharpe", DOCS, top_k=3)
        second = rr.rerank("sharpe", DOCS, top_k=3)
        assert first["state"] == second["state"] == "failed"
        assert "OSError" in first["reason"]
        assert recorder.built == 1, (
            "a failed load retried per request turns one misconfiguration into a "
            "stall on every query"
        )

    def test_a_score_count_that_does_not_match_the_batch_is_refused(self, monkeypatch):
        _install(monkeypatch, scores=[0.9, 0.1])
        out = rr.rerank("sharpe", DOCS, top_k=3)
        assert out["reranked"] is False
        assert out["state"] == "failed"
        assert "misaligned" in out["reason"], (
            "two scores for three pairs must refuse, not zip and truncate: a score "
            "attributed to the wrong document looks exactly like a good answer"
        )
        assert [d["id"] for d in out["documents"]] == ["a", "b", "c"]


class TestTheCrossEncoderActuallyReorders:
    def test_scores_decide_the_order(self, monkeypatch):
        recorder = _install(monkeypatch, scores=[0.10, 0.95, 0.40])
        out = rr.rerank("ETHUSDT breakout", DOCS, top_k=3)
        assert out["reranked"] is True
        assert out["state"] == "reranked"
        assert out["reason"] is None
        assert [d["id"] for d in out["documents"]] == ["b", "c", "a"], (
            "the whole point of the re-ranker is that a deep candidate can be "
            "promoted; if the fused order survives a decisive score, it is inert"
        )
        assert recorder.query == "ETHUSDT breakout", (
            "the cross-encoder must score against the query, not the document alone"
        )

    def test_every_returned_document_carries_its_score(self, monkeypatch):
        _install(monkeypatch, scores=[0.10, 0.95, 0.40])
        out = rr.rerank("sharpe", DOCS, top_k=2)
        assert [d[rr.SCORE_FIELD] for d in out["documents"]] == [0.95, 0.40]
        assert out["model"] == rr.RERANK_MODEL, (
            "an order nobody can attribute to a model cannot be reproduced"
        )

    def test_a_top_k_larger_than_the_candidate_count_is_safe(self, monkeypatch):
        _install(monkeypatch, scores=[0.10, 0.95, 0.40])
        out = rr.rerank("sharpe", DOCS, top_k=50)
        assert out["returned"] == 3, "top_k is a ceiling, never a target to pad up to"
        assert [d["id"] for d in out["documents"]] == ["b", "c", "a"]

    def test_a_tie_keeps_the_fused_order(self, monkeypatch):
        _install(monkeypatch, scores=[0.5, 0.5, 0.5])
        out = rr.rerank("sharpe", DOCS, top_k=3)
        assert [d["id"] for d in out["documents"]] == ["a", "b", "c"], (
            "equal scores are no evidence about which is better, so the fused rank "
            "— which is evidence — must break the tie rather than the sort"
        )

    def test_the_candidates_handed_in_are_not_mutated(self, monkeypatch):
        _install(monkeypatch, scores=[0.10, 0.95, 0.40])
        rr.rerank("sharpe", DOCS, top_k=3)
        assert all(rr.SCORE_FIELD not in d for d in DOCS), (
            "scoring must copy, not annotate: a caller that re-ranks twice would "
            "otherwise get a second order built on the first one's leftovers"
        )

    def test_the_encoder_is_loaded_once_across_two_calls(self, monkeypatch):
        recorder = _install(monkeypatch, scores=[0.10, 0.95, 0.40])
        rr.rerank("sharpe", DOCS, top_k=3)
        rr.rerank("drawdown", DOCS, top_k=3)
        assert recorder.built == 1, (
            "the model must be read off disk once per process; per-request loading "
            "would put a second or two on every query"
        )
        assert len(recorder.batches) == 2, "both queries must still be scored"
        assert recorder.kwargs["cache_dir"] == "/models/bge-reranker-base", (
            "RERANK_MODEL_PATH is where the model is resolved from; ignoring it "
            "would reach the network on the request path"
        )

    def test_a_changed_model_path_reloads_rather_than_serving_the_old_one(self, monkeypatch):
        recorder = _install(monkeypatch, scores=[0.10, 0.95, 0.40])
        rr.rerank("sharpe", DOCS, top_k=3)
        _settings(monkeypatch, rerank_model_path="/models/other")
        rr.rerank("sharpe", DOCS, top_k=3)
        assert recorder.built == 2, (
            "the cache belongs to one configured path; serving the old encoder "
            "after the setting moved would silently ignore the change"
        )


class TestNothingToRerankIsNotAFailure:
    def test_an_empty_candidate_list_is_a_state_of_its_own(self, monkeypatch):
        recorder = _install(monkeypatch, scores=[])
        out = rr.rerank("sharpe", [], top_k=3)
        assert out["state"] == "empty", (
            "'there was nothing to re-rank' and 'the re-ranker failed' must be "
            "distinguishable by a field, not by reading the sentence"
        )
        assert out["documents"] == []
        assert out["candidates"] == 0
        assert recorder.built == 0, (
            "loading ~110M parameters to score nothing is the one avoidable "
            "millisecond on this path"
        )

    def test_a_document_missing_its_text_does_not_crash_the_batch(self, monkeypatch):
        docs = [DOCS[0], {"id": "blank"}, DOCS[1]]
        _install(monkeypatch, scores=[0.2, 0.8])
        out = rr.rerank("sharpe", docs, top_k=3)
        assert out["reranked"] is True
        assert [d["id"] for d in out["documents"]] == ["b", "a", "blank"], (
            "an unscorable row must be kept, must not outrank a scored one, and "
            "must not take the rest of the batch down with it"
        )
        assert rr.SCORE_FIELD not in out["documents"][-1], (
            "nothing scored it, so it carries no score"
        )

    def test_a_batch_with_no_text_at_all_keeps_the_fused_order(self, monkeypatch):
        blanks = [{"id": "x"}, {"id": "y"}]
        _install(monkeypatch, scores=[0.9, 0.1])
        out = rr.rerank("sharpe", blanks, top_k=2)
        assert out["state"] == "empty"
        assert [d["id"] for d in out["documents"]] == ["x", "y"]
        assert out["candidates"] == 2, (
            "candidates is how a caller tells 'no rows were offered' from 'the "
            "rows offered had nothing to score'"
        )


class TestTheReportIsBranchable:
    def test_every_outcome_reports_a_distinct_state_in_the_same_shape(self, monkeypatch):
        """A caller must never parse prose, nor guard a key, to know what happened."""
        reports = []

        _settings(monkeypatch, rerank_model_path="")
        reports.append(rr.rerank("q", DOCS, top_k=3))

        _no_model(monkeypatch)
        reports.append(rr.rerank("q", DOCS, top_k=3))

        _install(monkeypatch, raises=RuntimeError("boom"))
        reports.append(rr.rerank("q", DOCS, top_k=3))

        _install(monkeypatch, scores=[0.1, 0.2, 0.3])
        reports.append(rr.rerank("q", DOCS, top_k=3))
        reports.append(rr.rerank("q", [], top_k=3))

        assert {r["state"] for r in reports} == {
            "unconfigured", "unavailable", "failed", "reranked", "empty",
        }, "two different outcomes are reporting the same state"
        assert all(r.keys() == reports[0].keys() for r in reports), (
            "a caller reading out['model'] must not have to guard the key by "
            "outcome; a report whose shape changes is a report that gets .get()"
        )

    def test_configured_reads_the_setting_and_nothing_else(self, monkeypatch):
        _settings(monkeypatch, rerank_model_path="")
        assert rr.configured() is False
        _settings(monkeypatch, rerank_model_path="/models/bge-reranker-base")
        assert rr.configured() is True, (
            "unconfigured is the default deployment, not a fault, and this is the "
            "function that lets a status surface say so without loading a model"
        )
