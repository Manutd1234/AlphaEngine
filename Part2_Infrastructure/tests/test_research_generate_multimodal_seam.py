"""The multimodal path, driven from the corrective loop that actually calls it.

The sibling of `tests/test_research_generate_multimodal.py`, split from it for
the 400-line ceiling and kept apart for a better reason: everything there asks
`generate` directly, and this file asks the real `research_crag`, which calls
the real `research_stages.synthesise`, which calls the real
`research_generate.generate`. Only the corpus and the Gemini SDK are
substituted, at the two boundaries `tests/research_seam.py` documents as such.

That distinction is this repository's documented scar. `research_generate`
arrived with twenty tests and NO caller, so every fence in it was proved and
none of the wiring was. Image resolution is exactly the shape that scar takes
again: `research_generate_vision` resolves the PNG itself, so nothing in
`research_stages` had to learn about charts — which is the right design and also
the design under which nobody would notice that the resolution is never reached.

`research_seam.FAKE_TYPES` deliberately is NOT used here. It carries no
`ThinkingConfig` and no `Part`, which is correct for the suites that share it —
they exercise the graceful-degradation path an older SDK takes — and useless for
proving that an image part arrives. The fuller fake lives in the sibling file
and is imported.

Offline, like everything that touches this module: no key, no network, no SDK.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import research_seam as seam
from research_seam import Corpus, answer, grounded, row
from test_research_generate_multimodal import (
    ENCODED,
    FULL_TYPES,
    PIXELS,
    VISION_MODEL,
    FakeSdk,
    images_of,
    sent_parts,
)

from modules import research_generate as gen
from modules import research_generate_vision as vision


@pytest.fixture(autouse=True)
def unconfigured(monkeypatch):
    """The default deployment — neither extra configured — before every test."""
    seam.absent(monkeypatch)


class TestItIsWiredToTheCorrectivePath:
    @pytest.fixture
    def wired(self, monkeypatch):
        def install(**kwargs):
            fake = FakeSdk(**kwargs)
            monkeypatch.setattr(gen, "settings", SimpleNamespace(
                gemini_api_key="test-key-not-a-real-one", gemini_model=VISION_MODEL,
            ))
            monkeypatch.setattr(gen, "_sdk", lambda: (fake, FULL_TYPES, None))
            return fake
        return install

    async def test_a_retrieved_chart_row_arrives_at_the_provider_as_an_image(self, wired):
        chart_row = row("sweep-1", kind="chart", source_ref="job-77:equity_curve",
                        metrics={"chart": "equity_curve"}, image_b64=ENCODED,
                        title="Equity curve: BTCUSDT ma_crossover drawdown sweep")
        fake = wired(text=grounded(chart_row))
        result = await answer(Corpus([[chart_row]]))

        assert result.generation["verdict"] == gen.ANSWERED, result.generation["reason"]
        parts = sent_parts(fake)
        assert len(parts) == 2 and parts[1].inline_data.data == PIXELS, (
            "the module resolves images itself, so nothing in `research_stages` has to "
            "learn about charts — but if that resolution is not reached from the real "
            "corrective path then it is a capability with no caller"
        )
        assert images_of(result.generation) == {chart_row["id"]: vision.ATTACHED}

    async def test_a_text_only_retrieval_reports_an_empty_image_ledger(self, wired):
        rows = [row(f"s-{i}") for i in range(3)]
        wired(text=grounded(*rows))
        result = await answer(Corpus([rows]))
        assert result.generation["images"] == [], (
            "no chart was retrieved, which is honest; the key is always present so a "
            "reader never has to tell 'not reported' from 'nothing to report'"
        )
