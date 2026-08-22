"""The bound on a research request: what it may spend, and what it may see.

`POST /api/research/rag/ask` is the only route in this gateway that can reach a
paid model, and until this module existed nothing bounded it. The single
`TokenBucket` in the process guards the ORDER path — `RiskGateway.__init__`
builds it from `settings.max_orders_per_sec` — so a loop pointed at `/ask` was
limited by nothing but the caller's patience, and every request could spend a
generation call. The token counts were already being recorded: `research_generate`
writes `model`, `latency_ms` and `tokens` into the `research_generation` ledger
row on every call actually spent. They were never priced and never totalled, so
the spend was auditable after the fact and unbounded before it.

TWO BOUNDS, NOT ONE, and they refuse for different reasons
----------------------------------------------------------

A rate limit alone does not bound a bill: at one request every five seconds a
day's worth of asks is still a day's worth of model calls. A spend ceiling alone
does not bound a stampede: a hundred concurrent requests all pass a ceiling that
none of them has yet crossed. So `check` applies both, and the refusal names
which one fired — `rate_limited` and `spend_capped` are different operator
actions (wait, versus raise the ceiling or find out what is looping).

THE CEILING IS LAGGING, WHICH IS WRITTEN DOWN RATHER THAN HIDDEN
----------------------------------------------------------------

Spend is known only AFTER a call returns — that is where the token counts come
from — so the window can be crossed by the request that crosses it. The
alternative was to price the prompt before sending it, which means re-deriving
the token count this codebase deliberately takes from the SDK rather than
estimating. The overshoot is bounded by one request's output ceiling
(`research_generate.MAX_OUTPUT_TOKENS`), and the burst is what bounds how many
requests can be in flight to overshoot together.

THE BOUND APPLIES WHERE SPENDING IS POSSIBLE, AND NOWHERE ELSE
---------------------------------------------------------------

`check` passes unconditionally on a deployment with no `GEMINI_API_KEY`. That is
not a hole, it is the scope of the thing: `research_generate.generate` cannot
reach a provider without one, so no request on such a deployment can cost
anything, and refusing one would be refusing a free query on the grounds that a
paid one might have been expensive. The key is read through
`research_generate.settings` rather than `config.settings` because that is the
module whose reading of it decides whether a call happens — patching a name
patches the module that reads it, which is `modules/api/deps.py`'s rule.

The residue is stated rather than implied: on an unconfigured deployment `/ask`
is bounded by nothing here, and neither is `/search`, which never could reach a
model and is therefore not this module's subject. Retrieval and re-ranking are
CPU this process shares with the pre-trade risk checks, and the bulkhead in
`research_stages` is what stands in front of that. A request rate limit over the
whole research plane is a different control with a different argument, and
inventing it inside a spend cap would leave neither reviewable.

UNPRICED IS NOT FREE
--------------------

`research_generate._telemetry` OMITS a token count the SDK did not report,
precisely so that an absent count never renders as a zero. This module keeps
that rule where it costs something: a call whose tokens were not reported is
recorded as an UNPRICED call, counted separately, and never added to the window
as 0.0. `spent_usd` is therefore a floor, not a measurement, whenever
`unpriced_calls` is non-zero, and `snapshot` says so. Rounding an unknown down
to zero here would be the defect this desk is most alert to, in the one place
where it would silently disable the ceiling.

THE OTHER BOUND IS NEXT DOOR
----------------------------

`research_quota_scope` answers the other question asked of a research request
before it is served: not "may this caller spend" but "which rows may this caller
see". It is the same kind of thing — a bound applied at the door, from an
environment constant, with a typed refusal when it cannot be applied — and it
was written here until the pair crossed the 400-line file ceiling
`tests/test_file_size.py` enforces. It imports `Bound` and `SCOPE_UNAVAILABLE`
from this module, so the two still speak one refusal vocabulary; splitting the
`Bound` type as well is what would have made them two.

WHY THE TUNABLES ARE HERE AND NOT IN `config.py`
------------------------------------------------

`config.py` is over the file-length ceiling `tests/test_file_size.py` ratchets
(407 lines, recorded), so it may not grow by so much as a field. These are
module-level constants read from `os.environ` at import, which is the shape
`modules/decision_core.py` and `modules/ml/engine.py` already use for the same
reason. Read at import rather than per call: a limiter whose rate can change
under it mid-window is a limiter whose refusals cannot be explained afterwards.
"""

from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass
from typing import Any

from modules.risk_proxy.rate_limit import TokenBucket


def _env_float(name: str, default: float) -> float:
    """A float from the environment, or the default. A blank value is unset."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        # Deliberately not silent-defaulted without a trace: a typo'd ceiling
        # that quietly reverts to the default is a bound nobody can audit.
        raise ValueError(f"{name} must be a number, got {raw!r}") from None


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


#: Sustained asks per second, and the burst the bucket will absorb.
#:
#: 0.2/s is one request every five seconds, which is above any pace a person
#: reading answers can sustain and far below what a retry loop does. The burst
#: of five is what makes a workspace opening three panels at once work: a token
#: bucket refuses on the SIXTH concurrent ask rather than on the second, which
#: a fixed window would not — see `TokenBucket`'s own note on why that shape was
#: chosen for the order path.
ASK_RATE_PER_S = _env_float("RESEARCH_ASK_RATE_PER_S", 0.2)
ASK_BURST = int(_env_float("RESEARCH_ASK_BURST", 5))

#: The spend window and its ceiling. An hour rather than a day because an hour
#: is the interval over which a runaway is worth interrupting; a daily cap
#: notices a loop after it has run all night. A ceiling of 0 or less DISABLES
#: the cap, and `snapshot` reports that as the state `uncapped` rather than as a
#: ceiling of zero that everything trivially exceeds.
SPEND_WINDOW_S = _env_float("RESEARCH_ASK_SPEND_WINDOW_S", 3600.0)
SPEND_CEILING_USD = _env_float("RESEARCH_ASK_SPEND_CEILING_USD", 2.0)

#: List price for `gemini-2.5-flash`, USD per million tokens, which is the model
#: `config.settings.gemini_model` defaults to. These are the VENDOR's published
#: numbers, not a measurement this desk took, and that is exactly why they are
#: overridable and why `snapshot` publishes them beside the total: a deployment
#: running another model with these prices would report a confident wrong bill,
#: and the only defence is that the reader can see which prices produced it.
PRICE_INPUT_USD_PER_MTOK = _env_float("RESEARCH_ASK_PRICE_INPUT_USD_PER_MTOK", 0.30)
PRICE_OUTPUT_USD_PER_MTOK = _env_float("RESEARCH_ASK_PRICE_OUTPUT_USD_PER_MTOK", 2.50)

#: The closed refusal vocabulary. Values rather than prose because the workspace
#: renders each differently and, more importantly, because NONE of them may be
#: confusable with the two refusals the research plane already has:
#: `ResearchAnswer.state == "refused"` is CRAG declining on relevance (documents
#: came back and none of them answer), and `generation.verdict == "corpus_silent"`
#: is the model reporting that the evidence does not say. Both of those mean the
#: request was served. These three mean it was NOT served, and no model was
#: called at all.
RATE_LIMITED = "rate_limited"
SPEND_CAPPED = "spend_capped"
SCOPE_UNAVAILABLE = "scope_unavailable"


@dataclass(frozen=True, slots=True)
class Bound:
    """A refusal at the door: which bound, why, and when to come back.

    `retry_after_s` is None when the answer is not "wait" — a scope that cannot
    be applied is a deployment fact, and telling a caller to retry in thirty
    seconds would be a lie with a number on it.
    """

    state: str
    reason: str
    retry_after_s: float | None = None


def price(tokens: dict[str, Any] | None) -> float | None:
    """USD for one generation call, or None when it cannot be priced.

    None, never 0.0, and the difference is the whole reason this function is not
    two multiplications at the call site. `research_generate` omits a token
    count the SDK did not report; multiplying an absent count by a price gives
    zero, and a zero folded into the window is a call that cost nothing — which
    is a measurement, and a false one. Both halves are required because pricing
    one of them alone understates the call by whichever half is missing, and an
    understated total is a ceiling that lifts itself.
    """
    if not tokens:
        return None
    prompt, output = tokens.get("prompt"), tokens.get("output")
    if prompt is None or output is None:
        return None
    return (
        float(prompt) * PRICE_INPUT_USD_PER_MTOK / 1_000_000.0
        + float(output) * PRICE_OUTPUT_USD_PER_MTOK / 1_000_000.0
    )


class AskQuota:
    """Rate and spend over a rolling window, for the one route that can spend.

    Not a second limiter: the rate half IS `modules.risk_proxy.rate_limit.TokenBucket`,
    the same class the order path has used since the gateway was written. A
    fixed window here would let twice the limit through across a boundary, which
    is the argument that class already records — and a research plane that
    enforced a differently-shaped bound from the trade plane would be two rules
    for one operator to hold.
    """

    def __init__(
        self,
        rate_per_s: float = ASK_RATE_PER_S,
        burst: int = ASK_BURST,
        *,
        ceiling_usd: float = SPEND_CEILING_USD,
        window_s: float = SPEND_WINDOW_S,
    ) -> None:
        self.bucket = TokenBucket(rate_per_s, burst)
        self.ceiling_usd = float(ceiling_usd)
        self.window_s = float(window_s)
        #: (monotonic, usd) per priced call, oldest first.
        self._priced: deque[tuple[float, float]] = deque()
        #: Monotonic stamps of calls that were SPENT and could not be priced.
        #: Kept apart from the total rather than folded in at zero: they are the
        #: reason `spent_usd` is a floor, and a reader has to be able to see
        #: how many of them there were.
        self._unpriced: deque[float] = deque()

    # -- the window -------------------------------------------------------- #
    def _prune(self, now: float) -> None:
        cutoff = now - self.window_s
        while self._priced and self._priced[0][0] < cutoff:
            self._priced.popleft()
        while self._unpriced and self._unpriced[0] < cutoff:
            self._unpriced.popleft()

    def spent_usd(self, now: float | None = None) -> float:
        """What the window has cost, as far as it can be priced.

        A FLOOR whenever `unpriced_calls` is non-zero, and named as such by
        `snapshot`. Callers must not present this as the bill.
        """
        now = time.monotonic() if now is None else now
        self._prune(now)
        return sum(usd for _, usd in self._priced)

    @property
    def unpriced_calls(self) -> int:
        return len(self._unpriced)

    @property
    def capped(self) -> bool:
        return self.ceiling_usd > 0

    # -- the gate ---------------------------------------------------------- #
    def check(self) -> Bound | None:
        """None to proceed, or the bound that refused. Consumes a token on pass.

        NOTHING IS BOUNDED WHERE NOTHING CAN BE SPENT — see the module docstring.
        Checked before the bucket, so an unconfigured deployment does not
        quietly accumulate a debt of tokens it would be refused for the moment
        somebody set a key.

        SPEND IS CHECKED NEXT, and before the token, deliberately: a request
        refused for spend must not also be charged a rate token, or a deployment
        sitting on its ceiling would drain the bucket with requests that never
        ran and the recovery would then be rate-limited on top of capped — two
        refusals for one cause, the second of which nobody can explain.
        """
        if not generation_configured():
            return None
        now = time.monotonic()
        spent = self.spent_usd(now)
        if self.capped and spent >= self.ceiling_usd:
            return Bound(
                SPEND_CAPPED,
                f"the research generation budget of ${self.ceiling_usd:.2f} per "
                f"{self.window_s / 60:.0f} minutes is spent (${spent:.4f} priced"
                + (f", plus {self.unpriced_calls} call(s) the provider did not report tokens for"
                   if self.unpriced_calls else "")
                + "). No model was called, so this is neither a relevance refusal "
                "nor a silent corpus.",
                retry_after_s=self._window_frees_in(now),
            )
        if not self.bucket.try_consume():
            return Bound(
                RATE_LIMITED,
                f"more than {self.bucket.capacity:.0f} research generations were asked "
                f"for faster than {self.bucket.rate:g} per second. No model was called, "
                "so this is neither a relevance refusal nor a silent corpus.",
                retry_after_s=self._token_in(),
            )
        return None

    def _token_in(self) -> float | None:
        """Seconds until one token exists, or None when refill cannot happen."""
        if self.bucket.rate <= 0:
            return None
        return round(max(0.0, (1.0 - self.bucket.tokens) / self.bucket.rate), 2)

    def _window_frees_in(self, now: float) -> float | None:
        """Seconds until the oldest recorded call leaves the window."""
        stamps = [s for s, _ in self._priced] + list(self._unpriced)
        if not stamps:
            return None
        return round(max(0.0, min(stamps) + self.window_s - now), 2)

    # -- the ledger side --------------------------------------------------- #
    def record(self, generation: dict[str, Any] | None) -> float | None:
        """Charge the window for a generation report. Returns the USD, or None.

        Gated on `model_called`, NEVER on `generated` — the same rule
        `ResearchRouter.record_generation` writes the ledger row under, and for
        the same reason: a refusal that fired AFTER the call (a fabricated
        citation, a timeout) spent the money. Charging only successful answers
        would leave the expensive half of the traffic outside the ceiling.
        """
        if not generation or not generation.get("model_called"):
            return None
        usd = price(generation.get("tokens"))
        now = time.monotonic()
        if usd is None:
            self._unpriced.append(now)
            return None
        self._priced.append((now, usd))
        return usd

    def snapshot(self) -> dict[str, Any]:
        """The window as a reader should see it, with its own honesty attached."""
        spent = self.spent_usd()
        unpriced = self.unpriced_calls
        return {
            "window_s": self.window_s,
            "ceiling_usd": self.ceiling_usd if self.capped else None,
            # `priced` when every call in the window carried token counts, so
            # the total is the total; `partial` when some did not, so it is a
            # floor; `uncapped` when no ceiling is configured at all. A caller
            # must never have to infer which from a number.
            "state": "uncapped" if not self.capped else ("partial" if unpriced else "priced"),
            # Eight places, not two. One generation on a flash-class model
            # costs a fraction of a cent, so rounding this to currency
            # precision would report a busy window as $0.00 while the ceiling —
            # which compares the UNROUNDED total — was refusing requests over
            # it. The rounding exists only to keep float noise out of the wire.
            "spent_usd": round(spent, 8),
            "priced_calls": len(self._priced),
            "unpriced_calls": unpriced,
            "price_input_usd_per_mtok": PRICE_INPUT_USD_PER_MTOK,
            "price_output_usd_per_mtok": PRICE_OUTPUT_USD_PER_MTOK,
            "rate_per_s": self.bucket.rate,
            "burst": self.bucket.capacity,
        }


def generation_configured() -> bool:
    """Whether a request on this deployment could reach the paid model at all.

    Imported inside the function, in the shape `research_stages.synthesise`
    uses: `research_generate` imports the relevance bands from `research_crag`,
    and a module-level import here would put this module inside that cycle for
    the sake of one boolean.

    A key with no SDK installed still counts as configured, and that is the
    conservative direction on purpose: the operator who set a key intends to
    spend, and `generate` reports its own missing extra without charging for it.
    """
    from modules import research_generate

    return bool((research_generate.settings.gemini_api_key or "").strip())


_QUOTA: AskQuota | None = None


def get_ask_quota() -> AskQuota:
    """The process-wide bound. One bucket and one window, or it bounds nothing."""
    global _QUOTA
    if _QUOTA is None:
        _QUOTA = AskQuota()
    return _QUOTA


def reset_ask_quota() -> None:
    """Drop the singleton — for tests, and for nothing on the request path."""
    global _QUOTA
    _QUOTA = None
