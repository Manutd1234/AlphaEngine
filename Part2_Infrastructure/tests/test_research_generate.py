"""Grounded generation, tested with no key, no network and no SDK installed.

Every assertion here runs against a fake provider, deliberately. A test that
needs a live model is a test that does not run in CI — CI is network-free by
construction — so the properties that matter would go unguarded on exactly the
path where they matter most. That this file imports `research_generate` at all,
on a machine where `google-genai` is not installed, is itself the assertion that
the import is lazy and the gateway boots without a generation provider.

The properties that matter are refusals, and each test below names the defect it
prevents. The single most important one is
`test_a_score_below_the_refuse_band_never_calls_the_model`: every other fence
here inspects what came back, and that one asserts nothing was ever sent. A
model call spent on evidence the grader has already judged insufficient is how
a desk gets a confident answer to an unanswerable question, and no amount of
checking the reply afterwards undoes it.
"""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace

import pytest

from modules import research_crag as crag
from modules import research_generate as gen

#: Two documents shaped like the rows retrieval actually returns.
DOCS = [
    {"id": "doc-a", "kind": "backtest", "symbol": "BTCUSDT", "strategy": "ma_cross",
     "title": "MA crossover 20/100", "body": "Sharpe 1.42 over 2024. Max drawdown 18.3%."},
    {"id": "doc-b", "kind": "incident", "title": "Feed gap",
     "body": "Four-hour bars were missing between 03:00 and 09:00 on 12 March."},
]

#: An answer that cites only ids that were supplied — the one shape that passes.
GROUNDED = "The 20/100 crossover ran at Sharpe 1.42 [doc:doc-a] across a feed gap [doc:doc-b]."


def _settings(monkeypatch, **overrides):
    """Swap the whole settings object, not a field.

    `Settings` is a frozen dataclass, so setattr on it raises
    FrozenInstanceError — which is the point of freezing it, and why a test
    that wants different configuration substitutes the object instead. It also
    keeps the desk's REAL key out of every fake call recorded below.
    """
    base = {"gemini_api_key": "test-key-not-a-real-one", "gemini_model": "test-model"}
    monkeypatch.setattr(gen, "settings", SimpleNamespace(**{**base, **overrides}))


class FakeSdk:
    """Stands in for `google-genai` at the module boundary.

    Records every call so a test can assert one was NOT made, which is the only
    way to prove a fence fired before the money was spent rather than after.
    """

    def __init__(self, text: str = GROUNDED, usage=None, error=None, delay: float = 0.0):
        self.text, self.usage, self.error, self.delay = text, usage, error, delay
        self.calls: list[dict] = []
        self.api_key: str | None = None

    def Client(self, *, api_key):  # the SDK spells it this way
        self.api_key = api_key
        models = SimpleNamespace(generate_content=self._generate)
        return SimpleNamespace(aio=SimpleNamespace(models=models))

    async def _generate(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text, usage_metadata=self.usage)


#: The SDK's config constructors, faked as plain namespaces so a test can read
#: back exactly which bounds reached them.
FAKE_TYPES = SimpleNamespace(
    GenerateContentConfig=lambda **kw: SimpleNamespace(**kw),
    HttpOptions=lambda **kw: SimpleNamespace(**kw),
)

USAGE = SimpleNamespace(prompt_token_count=812, candidates_token_count=96, total_token_count=908)


@pytest.fixture
def model(monkeypatch):
    """Install a fake provider and hermetic settings; hand back the fake.

    Patched at `_sdk` rather than at `_call`, so the real `_call` runs and the
    bounds it applies are observable — a fixture that stubbed the call itself
    would leave the timeout and the token cap untested.
    """
    def install(**kwargs):
        fake = FakeSdk(**kwargs)
        _settings(monkeypatch)
        monkeypatch.setattr(gen, "_sdk", lambda: (fake, FAKE_TYPES, None))
        return fake
    return install


class TestAbsenceIsReportedNeverRaised:
    async def test_an_unset_key_is_reported_and_never_raised(self, monkeypatch):
        _settings(monkeypatch, gemini_api_key="")
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["generated"] is False
        assert out["verdict"] == gen.REFUSED
        assert "GEMINI_API_KEY" in out["reason"], "the reason must name what is missing"
        assert out["model_called"] is False
        assert "latency_ms" not in out, (
            "no call was made, so there is no latency; a zero here would be a "
            "measurement of something that never happened"
        )

    def test_a_missing_package_names_the_extras_file(self, monkeypatch):
        # The real lazy import, forced to fail: `None` in sys.modules is what an
        # absent optional dependency looks like from inside the function.
        _settings(monkeypatch)
        monkeypatch.setitem(sys.modules, "google", None)
        monkeypatch.setitem(sys.modules, "google.genai", None)
        sdk, types_, reason = gen._sdk()
        assert sdk is None and types_ is None
        assert "requirements-genai.txt" in reason, "the reason must say how to fix it"

    async def test_an_sdk_exception_becomes_a_report_not_a_traceback(self, model):
        fake = model(error=RuntimeError("upstream 503"))
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["generated"] is False
        assert "RuntimeError" in out["reason"] and "503" in out["reason"]
        assert fake.calls, "the call was attempted, so it must be in the ledger"
        assert out["model_called"] is True
        assert out["latency_ms"] >= 0, (
            "a call that raised still spent time and money and must stay auditable"
        )


class TestTheRefusalBandIsCheckedBeforeTheCall:
    async def test_a_score_below_the_refuse_band_never_calls_the_model(self, model):
        """The fence this module exists for.

        Below the refuse band CRAG has already decided the evidence does not
        answer the question. Calling anyway buys a fluent paragraph over
        material known to be irrelevant — and one that is far harder to discard
        than a refusal, because it reads like an answer.
        """
        fake = model()
        out = await gen.generate("who won the 1998 world cup", DOCS, 0.2)
        assert fake.calls == [], "the model was called on evidence already graded insufficient"
        assert out["generated"] is False
        assert out["verdict"] == gen.REFUSED
        assert "0.20" in out["reason"] and "0.40" in out["reason"], (
            "the refusal must carry both the grade and the floor it fell below"
        )
        assert out["model_called"] is False

    async def test_an_ungraded_context_never_calls_the_model(self, model):
        fake = model()
        out = await gen.generate("what was the sharpe", DOCS, None)
        assert fake.calls == [], (
            "a None score was treated as a number; ungraded context must refuse, not "
            "be coerced to zero or waved through"
        )
        assert "not graded" in out["reason"]

    async def test_an_empty_document_list_refuses_rather_than_asking_for_context(self, model):
        fake = model()
        out = await gen.generate("what was the sharpe", [], 0.95)
        assert fake.calls == [], "an empty context was sent, which asks the model to invent one"
        assert out["generated"] is False
        assert "no documents" in out["reason"]

    async def test_a_document_with_no_id_refuses_because_it_could_not_be_cited(self, model):
        fake = model()
        out = await gen.generate("q", [DOCS[0], {"title": "orphan", "body": "Sharpe 9.9"}], 0.95)
        assert fake.calls == [], "an uncitable document reached the prompt"
        assert "position [1]" in out["reason"], "the reason must name which document"

    def test_the_bands_are_the_graders_own_constants(self):
        # Not a copy. A second 0.4 would let generation refuse at a threshold
        # the grader no longer uses, so the desk's stated relevance floor and
        # its real one would quietly become different numbers.
        assert gen.REFUSE_BAND is crag.REFUSE_BAND
        assert gen.ANSWER_BAND is crag.ANSWER_BAND
        assert gen.evidence_band(None) is None, "ungraded is not the same as graded badly"
        assert gen.evidence_band(0.2) == "refuse"

    async def test_a_mid_band_score_still_generates(self, model):
        # The floor is the refuse band, not the answer band. CRAG's middle band
        # means "rewrite and try again", and by the time this module is called
        # that has already happened; refusing here too would make the corrective
        # retry pointless.
        fake = model()
        out = await gen.generate("what was the sharpe", DOCS, 0.55)
        assert len(fake.calls) == 1
        assert out["verdict"] == gen.ANSWERED


class TestCitationsAreVerifiedNotTrusted:
    async def test_a_citation_to_an_id_that_was_not_supplied_refuses_the_answer(self, model):
        """A fabricated id means the sentence around it was fabricated too.

        Returning it with a warning flag was the rejected alternative: a warning
        beside an answer is a thing readers learn to skip, and the number in the
        sentence would be read as measured.
        """
        model(text="Sharpe was 2.9 [doc:doc-z] on the second run [doc:doc-a].", usage=USAGE)
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["generated"] is False
        assert out["verdict"] == gen.REFUSED
        assert out["answer"] is None, "a fabricating answer must not reach the caller at all"
        assert out["citations"] == []
        assert "doc-z" in out["reason"], "the reason must name the fabricated id"
        assert out["model_called"] is True and out["tokens"]["total"] == 908, (
            "an ungrounded call nobody can find in the ledger later is exactly what this "
            "desk avoids; a refusal after a spent call must still carry what it cost"
        )

    async def test_a_well_grounded_answer_passes_through_with_its_citations(self, model):
        model()
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["generated"] is True
        assert out["verdict"] == gen.ANSWERED
        assert out["answer"] == GROUNDED
        assert out["citations"] == ["doc-a", "doc-b"]
        assert out["reason"] is None

    async def test_an_answer_that_cites_nothing_is_refused_as_ungrounded(self, model):
        model(text="The strategy did well and the Sharpe was around 1.4.")
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["generated"] is False, (
            "an uncited answer is indistinguishable from one written out of the model's "
            "own training data, so it cannot be shown as corpus-grounded"
        )
        assert "cited no document" in out["reason"]

    async def test_every_supplied_id_reaches_the_prompt_in_citable_form(self, model):
        fake = model()
        await gen.generate("what was the sharpe", DOCS, 0.9)
        contents = fake.calls[0]["contents"]
        for doc in DOCS:
            assert f"[doc:{doc['id']}]" in contents, (
                "an id the verifier will demand was never shown to the model, so every "
                "citation of that document would be rejected as fabricated"
            )
            assert doc["body"] in contents


class TestTheContextIsClosed:
    def test_the_instruction_forbids_outside_knowledge_and_invented_figures(self):
        text = gen.SYSTEM_INSTRUCTION
        assert "ONLY PERMISSIBLE SOURCE" in text
        assert gen.SILENCE_MARKER in text, (
            "without the marker the model has no way to say the corpus is silent, so its "
            "only remaining option is to answer from training data"
        )
        for forbidden in ("compute", "estimate", "round", "annualise"):
            assert forbidden in text, f"the instruction does not forbid the model to {forbidden}"

    async def test_the_instruction_is_sent_with_every_call(self, model):
        fake = model()
        await gen.generate("what was the sharpe", DOCS, 0.9)
        assert fake.calls[0]["config"].system_instruction == gen.SYSTEM_INSTRUCTION, (
            "the fences are in the system instruction; a call without it is unfenced"
        )

    async def test_a_document_longer_than_the_cap_is_cut_and_the_cut_is_marked(self, model):
        fake = model()
        long_doc = {"id": "doc-a", "title": "log", "body": "x" * (gen.MAX_DOCUMENT_CHARS + 500)}
        await gen.generate("q", [long_doc], 0.9)
        contents = fake.calls[0]["contents"]
        assert "TRUNCATED" in contents, (
            "a silent cut lets the model quote a figure as though it had seen the whole "
            "document; the cut has to be visible to the reader of the prompt"
        )
        assert "x" * (gen.MAX_DOCUMENT_CHARS + 1) not in contents


class TestTheCallIsBounded:
    async def test_the_timeout_and_token_cap_reach_the_sdk(self, model):
        fake = model()
        await gen.generate("what was the sharpe", DOCS, 0.9)
        config = fake.calls[0]["config"]
        assert config.max_output_tokens == gen.MAX_OUTPUT_TOKENS
        assert config.http_options.timeout == gen.TIMEOUT_MS, (
            "the constant is documented as the bound; a call that does not carry it "
            "means the argued value is decoration"
        )
        assert config.temperature == gen.TEMPERATURE

    async def test_a_model_that_does_not_answer_in_time_becomes_a_refusal(self, monkeypatch,
                                                                          model):
        fake = model(delay=5.0)
        monkeypatch.setattr(gen, "TIMEOUT_MS", 20)
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert fake.calls, "the call was started"
        assert out["generated"] is False
        assert "20 ms" in out["reason"], (
            "a hung provider must become a report; a request that never returns takes "
            "the caller's worker with it"
        )
        assert out["model_called"] is True


class TestTelemetryIsNeverOptional:
    async def test_latency_and_token_counts_are_reported_for_the_ledger(self, model):
        model(usage=USAGE)
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["model"] == "test-model"
        assert isinstance(out["latency_ms"], float), (
            "the ledger row needs a latency for every spent call, in ms"
        )
        assert out["tokens"] == {"prompt": 812, "output": 96, "total": 908}

        # ... and a count the SDK did NOT report is an absent key, never a zero,
        # which would read as "this call used no output tokens".
        model(usage=SimpleNamespace(prompt_token_count=812, total_token_count=None))
        out = await gen.generate("what was the sharpe", DOCS, 0.9)
        assert out["tokens"] == {"prompt": 812}, (
            "an unreported token count was coerced to zero, turning 'not measured' into "
            "a measurement"
        )


class TestSilenceIsAnAnswerNotAFailure:
    async def test_the_corpus_being_silent_is_its_own_verdict(self, model):
        model(text=gen.SILENCE_MARKER, usage=USAGE)
        out = await gen.generate("what did we trade in 1994", DOCS, 0.9)
        assert out["verdict"] == gen.CORPUS_SILENT, (
            "'the corpus does not say' was reported as a refusal, so a caller cannot "
            "tell 'could not answer' from 'there was nothing to answer with'"
        )
        assert out["generated"] is False
        assert out["answer"] is None
        assert out["model_called"] is True and out["tokens"]["total"] == 908
