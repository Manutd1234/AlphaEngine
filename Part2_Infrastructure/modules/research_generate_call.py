"""What one generation call cost, how it ended, and the thinking budget it ran under.

Three concerns that all read the SDK's RESPONSE rather than the desk's rules,
split out of `research_generate` when the multimodal budget landed and that
module was at the 400-line ceiling. They belong together for a better reason
than line count, though: each one exists because a number the provider reports
must never be confused with a number the provider did not report.

The truncation fence, and why it is a fence rather than a log line
------------------------------------------------------------------

Gemini 2.5 Flash spends THINKING TOKENS against ``max_output_tokens``. That is
not a footnote, it is the whole reason this module exists. Measured against the
real key, on a chart image with a deliberate -34% drawdown injected at bars
220-300:

* ``max_output_tokens=200``, no thinking config: prompt=295, output=6,
  total=491. Roughly 190 tokens went to thinking, and the answer arrived
  truncated to "The equity curve shows significant volatility" — six usable
  tokens, no citation, no figure, nothing.
* ``max_output_tokens=300`` with ``ThinkingConfig(thinking_budget=0)``:
  prompt=295, output=85, total=380, and the answer read the injected drawdown
  off the pixels: "a significant drawdown occurring roughly between bar 200 and
  bar 300, where the equity drops from over 140,000 USD to below 95,000 USD".

The first of those is the dangerous shape, and not because it is short. A
truncated answer loses its TRAILING citations, so it walks into fence 4 and
refuses as "the answer cited no document" — a sentence that is false. The reader
is then told the model wrote something ungrounded when in fact the model was cut
off mid-word by a budget it was never given. A wrong stated reason is worse than
a refusal, because it sends whoever reads it to fix the wrong thing: they go
looking at the corpus, or at the prompt, when the defect is a number in this
file.

So truncation is detected from the SDK's own ``finish_reason``, BEFORE any other
fence reads the text, and refuses under its own name. The rejected alternative
was to return the truncated prefix with a flag — rejected for the reason every
fence here is a refusal rather than a warning, and doubly so here: a cut-off
sentence's last clause is unfinished, and an unfinished clause about a drawdown
is a claim nobody can check.

Reading the SDK defensively
---------------------------

Every accessor below is a `getattr` with a default, and none of them raises.
``finish_reason`` is an enum on the real SDK, a plain string on some builds and
absent on a fake; a token count the SDK did not report is an ABSENT key in the
ledger, never a zero, because zero prompt tokens is a measurement and a false
one. `ThinkingConfig` is likewise fetched by name rather than imported: an older
`google-genai` does not carry it, and the desk boots against whatever version is
installed. An SDK with no `ThinkingConfig` is a NAMED state that the caller
reports, never an AttributeError caught three frames away and rendered as
"AttributeError calling the model".
"""

from __future__ import annotations

import time
from typing import Any

#: The SDK's usage field names, mapped to the ledger's. Read defensively: a
#: count the SDK did not report is an ABSENT key in the report, never a zero.
#: Zero prompt tokens is a measurement, and a false one.
TOKEN_FIELDS: dict[str, str] = {
    "prompt": "prompt_token_count",
    "output": "candidates_token_count",
    "total": "total_token_count",
}

#: The finish reason that means "the budget ran out", as the SDK spells it.
#: Matched as a SUBSTRING of the uppercased name because the value arrives as
#: `FinishReason.MAX_TOKENS` from an enum, `"MAX_TOKENS"` from a string build
#: and `2` from a raw protobuf — the first two are the ones that reach a desk,
#: and an unrecognised third is treated as "not truncated" rather than guessed
#: at, which errs towards letting the other four fences judge the text.
MAX_TOKENS = "MAX_TOKENS"

#: The state name for an SDK that cannot express a thinking budget. A value
#: rather than prose, so the caller reports absence by branching rather than by
#: matching on a sentence.
NO_THINKING_CONFIG = "sdk_has_no_thinking_config"


def telemetry(response: Any, started: float, *, model: str) -> dict[str, Any]:
    """Model, latency and token counts — the ledger row, minus the query.

    Never optional. An ungrounded model call nobody can audit afterwards is the
    exact thing this desk avoids, so latency is recorded even when the call
    RAISED — the time and the money were still spent.

    `model` is passed rather than read from `settings` here, and that is not
    tidiness: `research_generate.settings` is what tests substitute and what the
    deployment configures, so reading a second `settings` in this module would
    put a different model name in the ledger than the one the call actually used.
    """
    report: dict[str, Any] = {
        "model": model,
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "tokens": {},
    }
    usage = getattr(response, "usage_metadata", None)
    for name, attribute in TOKEN_FIELDS.items():
        value = getattr(usage, attribute, None)
        if value is not None:
            report["tokens"][name] = int(value)
    return report


def thinking(types: Any, budget: int) -> tuple[Any, str | None]:
    """``(ThinkingConfig, None)``, or ``(None, reason)`` when the SDK has none.

    Fetched by name rather than imported so an older `google-genai` reports
    itself instead of raising. The absent case is deliberately NOT a refusal:
    an SDK that cannot express a thinking budget still answers, it just answers
    under a cap whose split between thinking and text is unknown — which is
    exactly what `truncation_refusal` below is there to catch. Refusing every
    call on an older SDK would take the feature away to avoid a risk that is
    already fenced.
    """
    config_type = getattr(types, "ThinkingConfig", None)
    if config_type is None:
        return None, NO_THINKING_CONFIG
    return config_type(thinking_budget=budget), None


def finish_reason(response: Any) -> str | None:
    """How the model stopped, uppercased, or None when it did not say."""
    for candidate in getattr(response, "candidates", None) or ():
        raw = getattr(candidate, "finish_reason", None)
        if raw is None:
            continue
        return str(getattr(raw, "name", None) or raw).upper()
    return None


def truncation_refusal(response: Any, cap: int) -> str | None:
    """The reason to refuse a truncated answer, or None. Never raises.

    Its own reason, never folded into the citation one. A truncated answer and a
    fabricated citation are different failures with different fixes — the first
    is a budget in this repository, the second is a model writing from training
    data — and the truncated one arrives disguised as the other, because the
    citations a grounded answer carries are the part the cut removed.
    """
    reason = finish_reason(response)
    if reason is None or MAX_TOKENS not in reason:
        return None
    return (
        f"the model was cut off at the {cap}-token output cap before it finished, so the "
        "answer is incomplete and its trailing citations are missing. This is NOT a "
        "fabricated citation and not an ungrounded answer: the text that arrived may be "
        "perfectly grounded and simply stops mid-claim. Raise the cap or shorten the "
        "context; on a thinking model, check that the thinking budget is set, because "
        "thinking tokens are spent against this same cap"
    )
