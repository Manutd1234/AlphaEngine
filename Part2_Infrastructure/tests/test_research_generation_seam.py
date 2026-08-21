"""Grounded generation, pinned to the corrective path that calls it.

The sibling of `tests/test_research_stage_seam.py`, and it exists for the same
reason `tests/test_research_contract.py` does: `research_generate` arrived with
twenty tests and NO caller, so every fence in it was proved and none of the
wiring was. Here the real `research_crag`, the real `research_stages` and the
real `research_generate.generate` run together; only the corpus and the Gemini
SDK are substituted, at the boundary that module documents as its own test seam.
`tests/research_seam.py` holds the harness and the argument for it.

Three claims are worth naming, because each is a defect that would otherwise be
invisible:

* a CRAG refusal must never reach the model — the money is spent before anyone
  can read what came back, so a fence that fires afterwards has not saved it;
* a generation refusal must NOT become a CRAG refusal — "retrieval was
  irrelevant" and "a grounding fence stopped the answer" are different facts,
  and folding one into the other loses which of them fired;
* a call that happened must be in the ledger even when it was refused, because
  gating the row on `generated` deletes exactly the expensive half.
"""

from __future__ import annotations

import inspect

import pytest
import research_seam as seam
from research_seam import IRRELEVANT, NEAR, QUERY, RELEVANT, STALE, Corpus, answer, grounded, row

from modules import research_generate as gen
from modules.research_router import ResearchRouter


@pytest.fixture(autouse=True)
def unconfigured(monkeypatch):
    """The default deployment, restored before every test in this file."""
    seam.absent(monkeypatch)


@pytest.fixture
def model(monkeypatch):
    """A fake provider at `research_generate._sdk`; returns the recorder."""
    return lambda **kw: seam.install_model(monkeypatch, **kw)


@pytest.fixture
def ledger(tmp_path):
    """A real `AuditLog` on a throwaway file, closed at the end of the test."""
    handle = seam.open_ledger(tmp_path / "ledger.duckdb")
    yield handle
    handle.log.close()


ROWS = [row(f"s-{i}") for i in range(3)]


# --------------------------------------------------------------------------- #
# What generation is passed, and when it is not called at all
# --------------------------------------------------------------------------- #
class TestGeneration:
    async def test_an_unconfigured_provider_reports_itself_rather_than_vanishing(self):
        result = await answer(Corpus([ROWS]))

        # Attempted and refused by its own first fence, which is not the same
        # fact as never having been reached. Absence is a state here too.
        assert result.generation is not None
        assert result.generation["verdict"] == gen.REFUSED
        assert result.generation["model_called"] is False
        assert "GEMINI_API_KEY" in result.generation["reason"]
        assert result.state == "ok" and result.refusal is None

    async def test_a_crag_refusal_never_reaches_the_model(self, model):
        sdk = model(text="anything at all")
        result = await answer(Corpus([[IRRELEVANT]]), query="sourdough starter hydration")

        assert result.state == "refused"
        assert result.generation is None, (
            "None is 'never attempted'. A report here would say a fence refused, "
            "which is a different fact from retrieval being irrelevant"
        )
        assert sdk.calls == [], (
            "evidence the grader has already judged insufficient does not become "
            "sufficient by being summarised, and the call is the money"
        )

    async def test_the_documents_reach_the_model_as_citable_mappings(self, model):
        sdk = model(text=grounded(*ROWS))
        result = await answer(Corpus([ROWS]))

        assert result.generation["verdict"] == gen.ANSWERED
        assert result.generation["citations"] == [r["id"] for r in ROWS]
        prompt = sdk.calls[0]["contents"]
        for r in ROWS:
            assert f"[doc:{r['id']}]" in prompt, (
                "the rows are plain dicts; a pydantic model here would have died on "
                "generate()'s doc.get('id') precheck instead of refusing with a reason"
            )

    async def test_the_question_asked_is_the_query_actually_answered(self, model):
        sdk = model(text=grounded(RELEVANT))
        result = await answer(Corpus([NEAR, [RELEVANT]]), query="crossover sweep")

        assert result.retrievals == 2 and result.query == result.rewritten_query
        assert f"QUESTION\n\n{result.rewritten_query}\n\nAnswer from" in sdk.calls[0]["contents"], (
            "generating over the rewrite's documents while asking the original "
            "question answers a question nobody asked of these rows"
        )

    async def test_a_discarded_rewrite_leaves_the_original_question(self, model):
        # Round two grades worse, so round one is kept. Generation must be given
        # the round that was KEPT, not the last one that happened to run.
        sdk = model(text=grounded(RELEVANT))
        result = await answer(Corpus([[RELEVANT, IRRELEVANT], [STALE]]), query="crossover sweep")

        assert result.retrievals == 2 and result.query == "crossover sweep"
        prompt = sdk.calls[0]["contents"]
        assert "QUESTION\n\ncrossover sweep\n\nAnswer from" in prompt
        assert f"[doc:{STALE['id']}]" not in prompt, "those rows were not the ones kept"


# --------------------------------------------------------------------------- #
# A generation refusal is not a CRAG refusal
# --------------------------------------------------------------------------- #
class TestTheTwoRefusalsStayApart:
    async def test_a_fabricated_citation_refuses_the_answer_not_the_retrieval(self, model):
        sdk = model(text="It ran [doc:not-a-real-id].")
        result = await answer(Corpus([ROWS]))

        assert len(sdk.calls) == 1, "the fence fired after the call, so it cost money"
        assert result.generation["verdict"] == gen.REFUSED
        assert result.generation["generated"] is False
        assert "fabrication" in result.generation["reason"]
        # CRAG's own verdict is untouched: retrieval was fine here, the answer
        # was not, and one `state` field cannot carry both sentences.
        assert result.state == "ok" and result.refusal is None
        assert len(result.matches) == 3

    async def test_corpus_silence_is_neither_an_answer_nor_a_refusal(self, model):
        model(text=gen.SILENCE_MARKER)
        result = await answer(Corpus([ROWS]))
        assert result.generation["verdict"] == gen.CORPUS_SILENT
        assert result.generation["generated"] is False
        assert result.state == "ok" and result.matches


# --------------------------------------------------------------------------- #
# The ledger: one row per call actually spent
# --------------------------------------------------------------------------- #
class TestTheLedger:
    def test_the_stage_calls_a_method_the_router_really_exports(self):
        """The defect `test_research_contract.py` exists for, one plane over.

        `research_stages.synthesise` resolves `record_generation` on whatever
        router it is handed, so a test that passed a stand-in would prove
        nothing about the real class — which is precisely how the scheduler and
        the sweep came apart. This asks the real class.
        """
        method = getattr(ResearchRouter, "record_generation", None)
        assert callable(method), "research_stages calls a name the router does not export"
        assert list(inspect.signature(method).parameters) == ["self", "query", "report"]

    async def test_a_spent_call_is_recorded_even_when_it_was_refused(self, model, ledger):
        sdk = model(text="It ran [doc:not-a-real-id].")
        await answer(Corpus([ROWS]), audit=ledger.log)

        assert len(sdk.calls) == 1
        rows = ledger.read("research_generation", QUERY)
        assert len(rows) == 1, (
            "gating on `generated` rather than `model_called` would delete every "
            "refusal that had already cost a call"
        )
        payload = rows[0]["payload"]
        assert payload["model_called"] is True and payload["generated"] is False
        assert payload["model"] == "test-model"
        assert payload["tokens"] == {"prompt": 812, "output": 96, "total": 908}
        assert rows[0]["actor"] == "research"

    async def test_a_call_the_sdk_never_costed_reports_no_count_not_a_zero(self, model, ledger):
        model(text=grounded(*ROWS), usage=None)
        await answer(Corpus([ROWS]), audit=ledger.log)

        payload = ledger.read("research_generation", QUERY)[0]["payload"]
        assert payload["tokens"] == {}, (
            "a count the SDK did not report must stay absent; a zero here is a "
            "measurement, and a false one"
        )
        assert payload["latency_ms"] >= 0.0

    async def test_an_unconfigured_provider_spends_nothing_and_records_nothing(self, ledger):
        result = await answer(Corpus([ROWS]), audit=ledger.log)

        assert result.generation["model_called"] is False
        assert ledger.read("research_generation", QUERY) == [], (
            "no call was made, so there is no spend to account for; a row here "
            "would put a call in the ledger that never happened"
        )
        # The plan is still recorded, so this is not a mute ledger.
        assert ledger.read("research_plan", QUERY)
