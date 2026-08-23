"""A token budgeter for Kalshi's read bucket. It plans spend; it does not react.

Kalshi's limits are token buckets, not request counts: most endpoints cost ten
tokens, a few cost more (the CF Benchmarks passthrough is fifty), and the
authoritative list is ``GET /account/endpoint_costs`` — which is itself public.
So the honest client models the bucket locally and asks "can I afford this?"
before spending, rather than discovering the answer from a 429. That matters
more here than usual for two reasons.

**429s carry no ``Retry-After``.** Kalshi documents no header and no cooldown,
so a client that waits for the error has nothing to wait *on* and must guess.

**No budget is published for keyless traffic at all.** The documented buckets
are per account, and this engine reads the public endpoints without a key. The
default is therefore a quarter of the smallest published tier: about five
requests a second where Basic would allow twenty. Guessing high on someone
else's infrastructure is not our risk to take, and the interesting thing this
engine measures — how long a dislocation survives — is a question about
seconds, not milliseconds.

The bucket itself is ``modules/risk_proxy/rate_limit.TokenBucket``, imported
rather than reinvented: its docstring already argues why a fixed window is the
wrong shape, and "precisely the pattern that triggers exchange bans" applies
here verbatim.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from modules.coherence import tunables
from modules.risk_proxy.rate_limit import TokenBucket


@dataclass(frozen=True, slots=True)
class Spend:
    """What a planned request would cost, and whether it can be afforded now."""

    path: str
    cost: int
    affordable: bool
    tokens_remaining: float

    @property
    def state(self) -> str:
        return "affordable" if self.affordable else "over_budget"


@dataclass
class ReadBudget:
    """The client's model of its own read bucket.

    Costs are seeded from the published defaults and refined by
    ``/account/endpoint_costs`` when it has been read. The refinement is one
    way — a cost we were told beats a cost we assumed — because assuming the
    cheaper of the two is how a client spends a budget it does not have.
    """

    tokens_per_second: int = tunables.READ_TOKENS_PER_S
    burst: int = tunables.READ_BURST_TOKENS
    default_cost: int = tunables.DEFAULT_TOKEN_COST
    costs: dict[str, int] = field(default_factory=dict)
    _bucket: TokenBucket = field(init=False, repr=False)
    spent_tokens: int = field(default=0, init=False)
    refusals: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        self._bucket = TokenBucket(rate=self.tokens_per_second, burst=self.burst)

    def learn_costs(self, payload: dict[str, Any] | None) -> int:
        """Adopt ``/account/endpoint_costs``. Returns how many rows were learnt.

        The endpoint is public, so this runs on the keyless path too — the one
        piece of budget truth available without an account.
        """
        if not payload:
            return 0
        published_default = payload.get("default_cost")
        if isinstance(published_default, int) and published_default > 0:
            self.default_cost = published_default
        learnt = 0
        for row in payload.get("endpoint_costs") or []:
            path = str(row.get("path", "")).strip()
            cost = row.get("cost")
            if path and isinstance(cost, int):
                self.costs[f"{str(row.get('method', 'GET')).upper()} {path}"] = cost
                learnt += 1
        return learnt

    def cost_of(self, path: str, method: str = "GET") -> int:
        """What one call costs. Exact match first, then the wildcard rows."""
        full = f"/trade-api/v2{path.split('?', 1)[0]}"
        key = f"{method.upper()} {full}"
        if key in self.costs:
            return self.costs[key]
        for known, cost in self.costs.items():
            known_method, _, known_path = known.partition(" ")
            if known_method != method.upper() or "*" not in known_path:
                continue
            prefix = known_path.split("*", 1)[0]
            if full.startswith(prefix):
                return cost
        return self.default_cost

    def plan(self, path: str, method: str = "GET") -> Spend:
        """Ask before spending. Does NOT consume — see ``take``."""
        cost = self.cost_of(path, method)
        remaining = self._tokens()
        return Spend(path=path, cost=cost, affordable=remaining >= cost, tokens_remaining=remaining)

    def take(self, path: str, method: str = "GET") -> Spend:
        """Spend the tokens for one call, if they are there."""
        cost = self.cost_of(path, method)
        taken = self._bucket.try_consume(cost)
        if taken:
            self.spent_tokens += cost
        else:
            self.refusals += 1
        return Spend(path=path, cost=cost, affordable=taken, tokens_remaining=self._tokens())

    def _tokens(self) -> Decimal:
        """Tokens available right now, refilled.

        ``try_consume(0)`` refills and always succeeds, which is how the model
        is read without reaching into the bucket's private clock.
        """
        self._bucket.try_consume(0)
        return Decimal(str(self._bucket.tokens))

    def status(self) -> dict[str, Any]:
        """What the surface reports. Never a bare number without its basis."""
        return {
            "tokens_per_second": self.tokens_per_second,
            "burst": self.burst,
            "tokens_available": float(round(self._tokens(), 2)),
            "default_cost": self.default_cost,
            "published_costs_known": len(self.costs),
            "tokens_spent": self.spent_tokens,
            "refusals": self.refusals,
            "basis": (
                "self-imposed: Kalshi publishes token buckets per account and none for keyless traffic, "
                "so this is a quarter of the smallest published tier"
            ),
        }


_BUDGET: ReadBudget | None = None


def get_read_budget() -> ReadBudget:
    """The process-wide read budget. One bucket, or the model is a fiction."""
    global _BUDGET
    if _BUDGET is None:
        _BUDGET = ReadBudget()
    return _BUDGET


def reset_read_budget() -> None:
    """Drop the budget so a test starts from a full bucket."""
    global _BUDGET
    _BUDGET = None
