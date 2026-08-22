"""Multimodal generation: the image really goes, the bounds really move.

Stage 5's last gap, and the one that was written off as blocked by conflating
two different things. Multimodal EMBEDDING is constrained by the Supabase Edge
runtime, which exposes `gte-small` and takes no image. Multimodal GENERATION was
never blocked: `settings.gemini_model` is `gemini-2.5-flash`, the key is
configured, and the chart PNG is already in-process on a finished `JobRecord`.

Everything here runs against a fake provider. NO TEST IN THIS FILE MAKES A LIVE
CALL — `tests/conftest.py` blanks `GEMINI_API_KEY` by assignment precisely so
that none can, and every fixture below substitutes `research_generate._sdk`. The
numbers quoted in the assertions are measurements taken ONCE, by hand, against
the real key, and they are asserted here as the reason a constant has the value
it has rather than re-measured on every run:

* 20,590 ms and 29,924 ms — two live multimodal calls, which is why the vision
  budget is its own constant and not the text path's 20,000 ms;
* 6 output tokens of 491 at `max_output_tokens=200` with no thinking config, the
  truncation this file's `TestTruncationIsItsOwnRefusal` exists for;
* 85 output tokens of 380 at `thinking_budget=0`, the call that worked.

`tests/test_research_generate_multimodal_seam.py` carries the other half — the
same path driven from the real `research_crag`, because a capability proved
through `generate` alone is one proved a call short of where it runs, and this
repository's documented scar is a module shipping fully tested with no caller.

The single most important test here is
`test_a_truncated_reply_is_never_reported_as_an_uncited_answer`. Every other
assertion checks that something reached the provider; that one checks that a
refusal tells the reader the TRUE reason, because a truncated answer loses its
trailing citations and would otherwise be refused as "cited no document" — a
sentence that sends whoever reads it to inspect the corpus for a defect that is
a number in `research_generate`.
"""

from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace

import pytest

from modules import research_generate as gen
from modules import research_generate_call as call
from modules import research_generate_vision as vision

#: A PNG that is not a real PNG. Nothing here decodes pixels — the assertion is
#: that these exact bytes arrive as an image part with an image/png mime type —
#: and a real chart would put 150 KB of base64 in the file for no extra claim.
PIXELS = b"\x89PNG\r\n\x1a\nequity-curve"
ENCODED = base64.b64encode(PIXELS).decode()

#: A chart document in the shape `research_cards.render_backtest_documents`
#: writes it: its own `kind`, a `<job id>:<chart>` source_ref, and `metrics.chart`.
CHART = {
    "id": "doc-chart", "kind": "chart", "source_ref": "job-77:equity_curve",
    "metrics": {"chart": "equity_curve"},
    "title": "Equity curve: BTCUSDT 4h ma_cross",
    "body": "Equity curve: BTCUSDT 4h ma_cross\nThe equity curve ends at 1.03x.",
}
TEXT_DOC = {
    "id": "doc-a", "kind": "backtest_run", "title": "MA crossover 20/100",
    "body": "Sharpe 1.42 over 2024.",
}
#: Three grounded answers, one per document set a test supplies. The citation
#: fence is real here, so an answer citing a document the test did not pass is
#: refused before anything about images can be asserted — which is the fence
#: doing its job and would read as a multimodal defect.
CHART_ANSWER = "The curve ends at 1.03x [doc:doc-chart]."
TEXT_ANSWER = "The 20/100 pair ran at Sharpe 1.42 [doc:doc-a]."
GROUNDED = "The curve ends at 1.03x [doc:doc-chart] on the 20/100 pair [doc:doc-a]."

#: The multimodal model this desk actually runs. `test-model` is deliberately
#: NOT one, which is what makes the decline path testable at all.
VISION_MODEL = "gemini-2.5-flash"


def chart(**over) -> dict:
    return {**CHART, **over}


class FakeSdk:
    """`google-genai` at `research_generate`'s own seam, recording what it was sent."""

    def __init__(self, text=CHART_ANSWER, usage=None, finish=None, delay=0.0):
        self.text, self.usage, self.finish, self.delay = text, usage, finish, delay
        self.calls: list[dict] = []

    def Client(self, *, api_key):  # the SDK spells it this way
        return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
            generate_content=self._generate,
        )))

    async def _generate(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.delay:
            await asyncio.sleep(self.delay)
        candidates = [SimpleNamespace(finish_reason=self.finish)] if self.finish else []
        return SimpleNamespace(text=self.text, usage_metadata=self.usage, candidates=candidates)


def _part(*, data, mime_type):
    return SimpleNamespace(inline_data=SimpleNamespace(data=data, mime_type=mime_type))


#: The SDK's constructors, faked as plain namespaces so the real `_call` still
#: runs and every bound it applies stays readable. Unlike `research_seam`'s
#: version this one carries `ThinkingConfig` and `Part`, because those are the
#: two the multimodal path needs and the point of this file is that they arrive.
FULL_TYPES = SimpleNamespace(
    GenerateContentConfig=lambda **kw: SimpleNamespace(**kw),
    HttpOptions=lambda **kw: SimpleNamespace(**kw),
    ThinkingConfig=lambda **kw: SimpleNamespace(**kw),
    Part=SimpleNamespace(from_bytes=_part),
)

#: The same SDK one version older: no thinking budget, no image part. Both
#: absences must be states rather than an AttributeError three frames away.
OLD_TYPES = SimpleNamespace(
    GenerateContentConfig=lambda **kw: SimpleNamespace(**kw),
    HttpOptions=lambda **kw: SimpleNamespace(**kw),
)


@pytest.fixture
def model(monkeypatch):
    """Install a fake provider at `_sdk`, with a model name that takes images."""
    def install(*, types=FULL_TYPES, gemini_model=VISION_MODEL, **kwargs):
        fake = FakeSdk(**kwargs)
        monkeypatch.setattr(gen, "settings", SimpleNamespace(
            gemini_api_key="test-key-not-a-real-one", gemini_model=gemini_model,
        ))
        monkeypatch.setattr(gen, "_sdk", lambda: (fake, types, None))
        return fake
    return install


def sent_parts(fake) -> list:
    payload = fake.calls[0]["contents"]
    return payload if isinstance(payload, list) else [payload]


def images_of(report) -> dict[str, str]:
    """`{document id: state}` from the report's own image ledger."""
    return {note["document_id"]: note["state"] for note in report["images"]}


class TestTheImageActuallyReachesTheProvider:
    async def test_a_chart_documents_png_is_attached_as_an_image_part(self, model):
        fake = model()
        out = await gen.generate("what does the curve do", [chart(image_b64=ENCODED)], 0.9)

        parts = sent_parts(fake)
        assert len(parts) == 2, (
            "the call carried text alone. An answer that describes a chart the model was "
            "never shown is the exact failure this whole path exists to prevent"
        )
        assert isinstance(parts[0], str), "the prompt must come first, so the rules are read first"
        assert parts[1].inline_data.data == PIXELS
        assert parts[1].inline_data.mime_type == "image/png"
        assert images_of(out) == {"doc-chart": vision.ATTACHED}
        assert out["verdict"] == gen.ANSWERED

    async def test_the_clause_names_the_image_by_the_id_that_can_be_cited(self, model):
        fake = model()
        await gen.generate("q", [chart(image_b64=ENCODED)], 0.9)
        prompt = sent_parts(fake)[0]
        assert "[chart:doc-chart]" in prompt, (
            "the marker the answer must use is checked against the ids actually sent, so a "
            "clause that does not name them leaves the model to guess an id, and a guessed "
            "id refuses the answer"
        )
        assert "never a substitute for the text you cite" in prompt

    async def test_a_text_only_call_still_sends_a_bare_prompt(self, model):
        fake = model(text=TEXT_ANSWER)
        await gen.generate("q", [TEXT_DOC], 0.9)
        assert isinstance(fake.calls[0]["contents"], str), (
            "wrapping every text call in a one-element list changes the request shape for "
            "the ninety-nine calls that have no chart in them"
        )
        assert images_of(await gen.generate("q", [TEXT_DOC], 0.9)) == {}, (
            "a document that is not a chart is not an absent image; reporting one would "
            "make the ledger unreadable for the case that matters"
        )


class TestTheBytesComeFromTheRealJobQueue:
    """The wiring, against the real `JobQueue` and the real `JobRecord`.

    This repository's documented scar is a module shipping fully tested with no
    caller. The join under test is `source_ref` -> job id -> `record.result`,
    and it is asserted against `modules.jobs` itself rather than a stand-in for
    the same reason `research_seam.open_ledger` opens a real `AuditLog`: a fake
    whose shape the test chose proves only that the test is self-consistent.
    """

    @pytest.fixture
    def queue(self):
        from modules.jobs import JobRecord, get_queue
        live = get_queue()
        held = dict(live._jobs)
        yield SimpleNamespace(queue=live, record=JobRecord)
        live._jobs.clear()
        live._jobs.update(held)

    async def test_a_finished_runs_png_is_found_through_its_source_ref(self, model, queue):
        fake = model()
        queue.queue._jobs["job-77"] = queue.record(
            job_id="job-77", kind="backtest", status="succeeded",
            result={"equity_curve_png": ENCODED, "heatmap_png": None},
        )
        out = await gen.generate("what does the curve do", [chart()], 0.9)

        assert sent_parts(fake)[1].inline_data.data == PIXELS, (
            "the document carried no image of its own, so this is the production join: "
            "the corpus row names the job, and the job is where the pixels live"
        )
        assert images_of(out) == {"doc-chart": vision.ATTACHED}

    async def test_a_job_this_process_no_longer_holds_names_itself(self, model, queue):
        fake = model()
        out = await gen.generate("q", [chart()], 0.9)
        assert images_of(out) == {"doc-chart": vision.JOB_NOT_RETAINED}
        assert len(sent_parts(fake)) == 1, "no image existed, so none may be claimed"
        assert out["verdict"] == gen.ANSWERED, (
            "an unreachable image is an absence, not a failure: the chart's description is "
            "still in the corpus and still answers the question"
        )
        assert "restart" in out["images"][0]["reason"]

    async def test_a_job_still_running_is_a_different_state_from_a_missing_one(
        self, model, queue
    ):
        model()
        queue.queue._jobs["job-77"] = queue.record(job_id="job-77", kind="backtest")
        out = await gen.generate("q", [chart()], 0.9)
        assert images_of(out) == {"doc-chart": vision.JOB_UNFINISHED}, (
            "'the job has not finished' and 'the job is gone' have different fixes, and a "
            "single 'no image' would answer neither"
        )

    async def test_a_finished_run_that_drew_nothing_says_so(self, model, queue):
        model()
        queue.queue._jobs["job-77"] = queue.record(
            job_id="job-77", kind="backtest", status="succeeded",
            result={"equity_curve_png": None},
        )
        out = await gen.generate("q", [chart()], 0.9)
        assert images_of(out) == {"doc-chart": vision.IMAGE_ABSENT}


class TestTheThinkingBudgetIsSetExplicitly:
    async def test_every_call_carries_a_zero_thinking_budget(self, model):
        fake = model()
        await gen.generate("q", [chart(image_b64=ENCODED)], 0.9)
        config = fake.calls[0]["config"]
        assert config.thinking_config.thinking_budget == gen.THINKING_BUDGET == 0, (
            "MEASURED: at max_output_tokens=200 with no thinking config the reply was six "
            "usable tokens of 491 — roughly 190 went to thinking, which 2.5-flash charges "
            "against the same cap. An unset budget makes the answer's real ceiling unknown"
        )
        assert config.max_output_tokens == gen.MAX_OUTPUT_TOKENS

    def test_an_sdk_without_thinkingconfig_names_the_state_rather_than_raising(self):
        config, reason = call.thinking(OLD_TYPES, gen.THINKING_BUDGET)
        assert config is None and reason == call.NO_THINKING_CONFIG
        assert call.thinking(FULL_TYPES, 0)[1] is None

    async def test_an_older_sdk_still_answers_under_an_unknown_split(self, model):
        # Deliberately NOT a refusal. An SDK too old to express the budget still
        # answers; it answers under a cap whose split between thinking and text
        # is unknown, which is exactly what the truncation fence below catches.
        # Refusing every call here would remove the feature to avoid a risk that
        # is already fenced.
        fake = model(types=OLD_TYPES, text=TEXT_ANSWER)
        out = await gen.generate("q", [TEXT_DOC], 0.9)
        assert out["verdict"] == gen.ANSWERED
        assert fake.calls[0]["config"].thinking_config is None


class TestTheVisionBudgetIsItsOwn:
    async def test_a_call_carrying_an_image_gets_the_longer_ceiling(self, model):
        fake = model()
        await gen.generate("q", [chart(image_b64=ENCODED)], 0.9)
        assert fake.calls[0]["config"].http_options.timeout == vision.VISION_TIMEOUT_MS

        fake = model()
        await gen.generate("q", [TEXT_DOC], 0.9)
        assert fake.calls[0]["config"].http_options.timeout == gen.TIMEOUT_MS, (
            "raising the one budget would hand the text path a 45s hang budget it has "
            "never needed; the bound has to be paid by the call that needs it"
        )

    def test_the_vision_ceiling_clears_both_measured_calls(self):
        assert gen.TIMEOUT_MS < 29_924 < vision.VISION_TIMEOUT_MS, (
            "the two live calls took 20,590 ms and 29,924 ms. The text budget would have "
            "aborted essentially every multimodal call, and a vision budget that does not "
            "clear the slower measurement is a fence that fires on healthy calls"
        )
        assert vision.VISION_TIMEOUT_MS <= 60_000, "slower than the reader's patience"

    async def test_a_multimodal_timeout_names_the_budget_it_blew(self, monkeypatch, model):
        fake = model(delay=5.0)
        monkeypatch.setattr(vision, "VISION_TIMEOUT_MS", 25)
        out = await gen.generate("q", [chart(image_b64=ENCODED)], 0.9)
        assert fake.calls, "the call was started"
        assert "25 ms" in out["reason"], (
            "the refusal quoted the text budget, so a reader tuning the multimodal ceiling "
            "would be shown a number that had nothing to do with the call that timed out"
        )
        assert out["model_called"] is True and images_of(out) == {"doc-chart": vision.ATTACHED}


class TestTruncationIsItsOwnRefusal:
    #: The exact reply the 200-token call came back with, live.
    CUT = "The equity curve shows significant volatility"

    async def test_a_truncated_reply_is_never_reported_as_an_uncited_answer(self, model):
        model(text=self.CUT, finish="MAX_TOKENS")
        out = await gen.generate("q", [chart(image_b64=ENCODED)], 0.9)

        assert out["verdict"] == gen.REFUSED and out["answer"] is None
        assert "cut off" in out["reason"] and str(gen.MAX_OUTPUT_TOKENS) in out["reason"]
        assert "cited no document" not in out["reason"], (
            "a truncated answer loses its TRAILING citations, so fence 4 sees an uncited "
            "answer and refuses with a true observation and a false explanation. The "
            "reader is then sent to inspect the corpus for a defect that is a token cap"
        )
        assert "thinking" in out["reason"], "the reason must name the cause that is fixable"

    async def test_a_truncated_reply_that_kept_a_citation_is_refused_too(self, model):
        model(text="The curve ends at 1.03x [doc:doc-chart] and then", finish="MAX_TOKENS")
        out = await gen.generate("q", [chart(image_b64=ENCODED)], 0.9)
        assert out["verdict"] == gen.REFUSED and "cut off" in out["reason"], (
            "a cut-off sentence's last clause is unfinished, and an unfinished claim about "
            "a drawdown is one nobody can check; a citation earlier in it changes nothing"
        )

    async def test_both_spellings_of_the_finish_reason_are_recognised(self, model):
        # An enum on the real SDK, a plain string on some builds. Reading only
        # one would make the fence silently absent on the other.
        for finish in (SimpleNamespace(name="MAX_TOKENS"), "MAX_TOKENS", "FinishReason.MAX_TOKENS"):
            model(text=self.CUT, finish=finish)
            out = await gen.generate("q", [TEXT_DOC], 0.9)
            assert out["verdict"] == gen.REFUSED, f"{finish!r} was not read as truncation"
            assert "cut off" in out["reason"]

    async def test_a_normal_stop_is_left_to_the_other_fences(self, model):
        model(text=GROUNDED, finish="STOP")
        out = await gen.generate("q", [chart(image_b64=ENCODED), TEXT_DOC], 0.9)
        assert out["verdict"] == gen.ANSWERED
        assert call.finish_reason(SimpleNamespace(candidates=[])) is None, (
            "an SDK that reported no finish reason must read as 'not truncated', never as "
            "a guess: erring the other way would refuse healthy answers"
        )

    async def test_a_reply_that_is_only_thinking_is_truncation_not_silence(self, model):
        # The 200-token call's worst case: every token went to thinking and no
        # text came back at all. "The model returned no text" would be true and
        # useless; the cap is the fact.
        model(text="", finish="MAX_TOKENS")
        out = await gen.generate("q", [TEXT_DOC], 0.9)
        assert "cut off" in out["reason"] and "returned no text" not in out["reason"]
