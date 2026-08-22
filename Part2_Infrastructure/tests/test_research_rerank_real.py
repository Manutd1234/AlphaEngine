"""The cross-encoder re-ranker, tested WITH a cross-encoder.

``test_research_rerank.py`` drives a fake scorer at
``research_rerank._import_cross_encoder``, deliberately and correctly: the
property that module lives or dies by is what happens when there is no model,
and the whole suite must pass with neither ``fastembed`` installed nor weights
on disk. What that left is the other half — an ONNX code path that nothing had
ever executed. Every assertion about it was an assertion about a fake returning
the numbers the test handed it.

This file is that half, and it runs only when somebody has deliberately seeded
weights. Three things it proves that a fake structurally cannot:

* that ``BAAI/bge-reranker-base`` actually loads through
  ``TextCrossEncoder(cache_dir=...)`` and scores — a real ONNX session, real
  tokenisation, real float scores nobody chose;
* that its ordering is RIGHT WAY UP. A fake asserts that the module sorts
  descending by whatever it was given; only the real model can show that the
  relevant document is the one that gets the higher number. A cross-encoder
  wired up backwards passes every test in the fake file;
* that it is WIRED — the same promotion, through ``research_stages.narrow``,
  which is the only caller, off the event loop and under the bulkhead.

RERANK_TEST_MODEL_PATH, and why it is not RERANK_MODEL_PATH
-----------------------------------------------------------

``tests/conftest.py`` sets ``os.environ["RERANK_MODEL_PATH"] = ""`` by
ASSIGNMENT, so that an exported variable on a developer's machine cannot make
the route suites load ~110M parameters off a directory nobody mentioned. That
line is load-bearing and is not weakened here: this file reads a DIFFERENT
variable that conftest does not touch, and hands the path to
``research_rerank`` by substituting the settings object, exactly the way
``test_research_rerank.py::_settings`` already does. The default suite is
therefore still weight-free and still offline, and stays that way even on a box
where the weights happen to be seeded — opting in takes a second variable that
only CI and a developer running the bench ever set.

``HF_HUB_OFFLINE`` is set for the same reason from the other side. A seeded
cache_dir means no network at request time, which is the entire argument for
choosing a local ONNX re-ranker over Cohere or Voyage, and a test that silently
downloaded a missing blob would pass while disproving it.

ONE skip, not one per test
--------------------------

The absence is reported at MODULE level (``pytest.skip(...,
allow_module_level=True)``) rather than as a mark on each test. Two reasons.
The house rule is to count the skips rather than the passes, and a file that
contributes a variable number of skips depending on how many cases it happens
to hold makes that count unreadable. And the reason is one fact — no weights —
so it should be said once, with the name of the thing that is missing in it,
rather than repeated four times.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from modules import research_rerank as rr
from modules import research_stages

#: The opt-in. Deliberately not ``RERANK_MODEL_PATH`` — see the docstring.
MODEL_PATH_ENV = "RERANK_TEST_MODEL_PATH"

_PATH = os.getenv(MODEL_PATH_ENV, "").strip()


def _why_not() -> str | None:
    """The named reason this file cannot run, or ``None``.

    Three distinct reasons, in the order a reader would fix them, because
    "nobody opted in", "the directory is not there" and "the package is not
    installed" want three different actions — the same argument
    ``research_rerank._encoder`` makes for returning a state beside its reason.
    """
    if not _PATH:
        return (
            f"{MODEL_PATH_ENV} is unset, so no cross-encoder weights were offered "
            f"and the real ONNX path was not exercised. Seed them with "
            f"`python tools/bench_rerank.py --seed --model-path DIR` and export "
            f"{MODEL_PATH_ENV}=DIR."
        )
    if not Path(_PATH).is_dir():
        return (
            f"{MODEL_PATH_ENV}={_PATH} is not a directory, so there are no weights "
            f"to load; run `python tools/bench_rerank.py --seed --model-path {_PATH}`."
        )
    encoder_cls, reason = rr._import_cross_encoder()
    if encoder_cls is None:
        return f"{reason}, so the real model could not be constructed"
    return None


_REASON = _why_not()
if _REASON:
    pytest.skip(_REASON, allow_module_level=True)


#: A question with an unambiguous answer in the corpus below. Written as a desk
#: would ask it rather than as keywords, because keyword overlap is what the
#: LEXICAL arm already has — a cross-encoder that only rewards overlap is a slow
#: BM25 and this corpus is built so that it cannot pass by doing that.
QUERY = "what sharpe ratio did the BTCUSDT moving average crossover backtest reach"

#: The fused order RRF might plausibly hand over, with the answer in LAST place.
#:
#: That position is the point. The blind spot this whole module exists to close
#: is that RRF sees only rank, so it cannot promote the one document that
#: answers the question out of eleventh place. A corpus whose best document was
#: already first would let a re-ranker that does nothing at all pass.
FUSED_ORDER = [
    {
        "id": "sourdough",
        "title": "sourdough starter maintenance",
        "body": "feed the starter twice daily with equal flour and water by weight",
    },
    {
        "id": "incident",
        "title": "desk incident report",
        "body": "a working order was cancelled late and the venue acknowledged after the close",
    },
    {
        "id": "backtest",
        "title": "BTCUSDT moving average crossover backtest",
        "summary": "walk-forward evaluation of the ma_cross strategy",
        "body": "the crossover reached a sharpe ratio of 1.42 with a maximum drawdown of -12%",
        "symbol": "BTCUSDT",
        "strategy": "ma_cross",
    },
]


@pytest.fixture(scope="module", autouse=True)
def _real_model():
    """Point the module at the seeded weights, once, for this file only.

    Module-scoped and hand-rolled rather than ``monkeypatch``, which is
    function-scoped: loading the ONNX session costs ~0.45 s off a warm cache and
    paying that per test would make an opt-in suite slow enough to stop being
    opted into. The encoder cache is cleared on the way IN as well as out, so a
    fake left behind by ``test_research_rerank.py`` cannot be what answers here
    — which would be the worst possible failure of this file, passing while
    proving nothing.
    """
    saved_settings = rr.settings
    saved_offline = os.environ.get("HF_HUB_OFFLINE")
    rr._ENCODER = rr._LOAD_ERROR = rr._LOAD_ERROR_STATE = rr._LOADED_PATH = None
    rr.settings = SimpleNamespace(rerank_model_path=_PATH)
    # No network at request time is the property the local re-ranker was chosen
    # for; asserting it means making a download raise rather than succeed.
    os.environ["HF_HUB_OFFLINE"] = "1"
    yield
    rr.settings = saved_settings
    rr._ENCODER = rr._LOAD_ERROR = rr._LOAD_ERROR_STATE = rr._LOADED_PATH = None
    if saved_offline is None:
        os.environ.pop("HF_HUB_OFFLINE", None)
    else:
        os.environ["HF_HUB_OFFLINE"] = saved_offline


class TestTheRealModelReordersAndSaysSo:
    def test_the_relevant_document_is_promoted_from_last_place(self):
        report = rr.rerank(QUERY, FUSED_ORDER, top_k=3)
        assert report["state"] == "reranked", (
            f"the real model did not run: {report['state']} — {report['reason']}"
        )
        order = [document["id"] for document in report["documents"]]
        assert order[0] == "backtest", (
            f"the planted answer arrived LAST in the fused order and the "
            f"cross-encoder left it at {order.index('backtest')}; a re-ranker "
            f"that cannot promote a deep candidate is inert. Order: {order}"
        )
        assert order[-1] == "sourdough", (
            f"the unrelated document must sink, not merely fail to rise: {order}"
        )

    def test_the_scores_are_real_and_the_ordering_is_right_way_up(self):
        report = rr.rerank(QUERY, FUSED_ORDER, top_k=3)
        scores = [document[rr.SCORE_FIELD] for document in report["documents"]]
        assert all(isinstance(score, float) for score in scores)
        assert scores == sorted(scores, reverse=True), (
            f"the report is ordered by score descending or it is not ordered: {scores}"
        )
        assert scores[0] > scores[-1], (
            "the relevant document must score STRICTLY above the irrelevant one. "
            "A cross-encoder wired up backwards, or reading the document without "
            "the query, passes every assertion the fake suite can make and fails "
            f"only this one. Scores: {scores}"
        )

    def test_the_report_names_the_model_that_actually_scored(self):
        report = rr.rerank(QUERY, FUSED_ORDER, top_k=3)
        assert report["reranked"] is True
        assert report["model"] == rr.RERANK_MODEL == "BAAI/bge-reranker-base", (
            "an order nobody can attribute to a named model cannot be reproduced, "
            "and this is the one test in the tree where the name is the name of a "
            "model that was really loaded rather than a constant compared to itself"
        )
        assert report["reason"] is None
        assert report["candidates"] == 3 and report["returned"] == 3

    def test_the_encoder_came_from_fastembed_and_not_from_a_fake(self):
        encoder_cls, reason = rr._import_cross_encoder()
        assert reason is None
        assert encoder_cls.__module__.startswith("fastembed"), (
            f"this file exists to exercise the real ONNX path; {encoder_cls!r} is "
            "not it, so a fake has leaked in from another module"
        )
        rr.rerank(QUERY, FUSED_ORDER, top_k=3)
        assert isinstance(rr._ENCODER, encoder_cls), (
            "the cached encoder must BE the fastembed class, or the run above "
            "measured something else"
        )

    def test_an_unscorable_row_survives_a_real_batch(self):
        """The mixed batch, against the real model rather than a fake's list.

        ``rerank`` splits the batch into scored and unscored and rejoins them,
        and the fake suite proves the rejoin. What it cannot prove is that the
        real model is handed exactly the texts the split produced: a length
        mismatch there is the ``failed`` state, not a wrong order, and it would
        only ever appear against a scorer that counts its own inputs.
        """
        documents = [*FUSED_ORDER, {"id": "blank"}]
        report = rr.rerank(QUERY, documents, top_k=4)
        assert report["state"] == "reranked", report["reason"]
        order = [document["id"] for document in report["documents"]]
        assert order[0] == "backtest"
        assert order[-1] == "blank", "an unscored row must not outrank a scored one"
        assert rr.SCORE_FIELD not in report["documents"][-1]


class TestItIsWiredToItsRealCaller:
    """``research_stages.narrow`` is the only caller. It is what must work.

    This repository has a documented scar about modules shipping fully tested
    with no caller, and the re-ranker was most of the way to a second one: a
    real model path with no test, behind a seam whose own tests used a fake. The
    assertions here are deliberately the same ones as above, taken through the
    seam instead of through the function, because "the model works" and "the
    request path uses the model" are two facts.
    """

    async def test_narrow_promotes_the_same_document_off_the_event_loop(self):
        documents, report = await research_stages.narrow(QUERY, FUSED_ORDER, 3)
        assert report["state"] == "reranked", report["reason"]
        assert [document["id"] for document in documents] == [
            document["id"] for document in report["documents"]
        ], "the rows returned must be the report's own, not a second ordering"
        assert documents[0]["id"] == "backtest", (
            "the seam must serve the cross-encoder's order; if the fused order "
            "survives here it survives in production"
        )

    async def test_the_real_model_never_runs_on_the_event_loop(self):
        """Where it ran, not just what it returned.

        A 1,523 ms re-rank (``tools/bench_rerank.py``, twenty pairs at the
        truncation ceiling) left on this loop is a second and a half a pre-trade
        risk decision waited for. The fake suite records the thread because it is
        a property of the wiring; here the thread is recorded while the CPU is
        genuinely busy, which is the only version of this assertion that could
        ever have been observed to matter.
        """
        seen: list[bool] = []
        real_rerank = rr.rerank

        def recording(query, documents, top_k=3):
            seen.append(threading.current_thread() is threading.main_thread())
            return real_rerank(query, documents, top_k)

        rr.rerank = recording
        try:
            await research_stages.narrow(QUERY, FUSED_ORDER, 3)
        finally:
            rr.rerank = real_rerank
        assert seen == [False], (
            "the re-rank ran on the main thread; `asyncio.to_thread` is the "
            "bulkhead and without it the risk plane pays for research"
        )

    async def test_the_bulkhead_admits_one_re_rank_at_a_time(self):
        """The width, asserted where it is spent rather than read off a constant.

        One, re-argued in ``research_stages`` against the measurement: a single
        re-rank already spreads over ~9 of 18 cores, so a second simultaneous one
        bought 1.30-1.37x throughput for 1.46-1.54x the latency on every request.
        Asserted through the semaphore's own bookkeeping so that changing the
        number without changing the argument turns this red.
        """
        assert research_stages._RERANK_BULKHEAD._value == 1, (
            "the bulkhead width and the argument written above it must move "
            "together; see the measured table there before changing this"
        )
        documents, _ = await research_stages.narrow(QUERY, FUSED_ORDER, 3)
        assert research_stages._RERANK_BULKHEAD._value == 1, (
            "the semaphore must be released after the re-rank, or the second "
            "research query on this process would wait forever"
        )
        assert documents[0]["id"] == "backtest"
