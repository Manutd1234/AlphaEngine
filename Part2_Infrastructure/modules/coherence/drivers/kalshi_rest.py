"""Kalshi REST reads with planned spend and honest degradation.

The injectable transport keeps tests on the real request path. Safety rules:
errors never log URLs; bulk orderbooks repeat ``tickers`` instead of joining
them; and an orderbook 401 degrades upstream to public top-of-book data marked
``depth="top_of_book"`` rather than being mistaken for deep liquidity.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Literal, Sequence
from urllib.parse import quote

import httpx

from modules.coherence import latency, tunables
from modules.coherence.drivers import kalshi_auth
from modules.coherence.drivers.kalshi_pool import acquire_budget as _acquire_budget
from modules.coherence.drivers.kalshi_pool import close_pool as close_pool
from modules.coherence.drivers.kalshi_pool import default_failover as _default_failover
from modules.coherence.drivers.kalshi_pool import host_only as _host_only
from modules.coherence.drivers.kalshi_pool import known_environment as _known_environment
from modules.coherence.drivers.kalshi_pool import local_budget_wait_s as _local_budget_wait_s
from modules.coherence.drivers.kalshi_pool import pool as _pool
from modules.coherence.drivers.kalshi_pool import venue_attempt_timeout_s as _venue_attempt_timeout_s
from modules.coherence.scheduler.budget import ReadBudget, get_read_budget

logger = logging.getLogger(__name__)


# One request per call, and the caller decides how many calls to make. The
# retry curve is the gateway's own Backoff; there is no retry inside a single
# fetch, because a retry hidden inside a "read the book" call turns one budget
# decision into several.
MAX_TICKERS_PER_BULK_CALL = 100
MAX_MARKETS_PER_PAGE = 1000


class KalshiUnavailable(RuntimeError):
    """A read did not complete. Carries a reason a person can act on."""

    def __init__(self, reason: str, status: int | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status = status


class KalshiRefused(KalshiUnavailable):
    """Kalshi answered 401/403. The contract tightened, or a key is needed."""


class _KalshiDeadlineExhausted(KalshiUnavailable):
    """The propagated request allowance cannot safely start another attempt."""


@dataclass(frozen=True, slots=True)
class Fetched:
    """One response, with the provenance a certificate has to be able to cite."""

    path: str
    status: int
    payload: dict[str, Any]
    host: str
    token_cost: int


def build_orderbooks_query(tickers: Sequence[str]) -> list[tuple[str, str]]:
    """``tickers`` as REPEATED pairs — the only correct shape for the bulk route.

    Returned as a list of pairs rather than a dict because a dict cannot hold a
    repeated key, which is exactly the mistake that makes the comma-joined form
    look reasonable.
    """
    if not tickers:
        raise ValueError("no tickers to fetch")
    if len(tickers) > MAX_TICKERS_PER_BULK_CALL:
        raise ValueError(f"bulk orderbook takes at most {MAX_TICKERS_PER_BULK_CALL} tickers, got {len(tickers)}")
    return [("tickers", ticker) for ticker in tickers]


class KalshiClient:
    """Read-only Kalshi calls with an explicit authentication boundary.

    Public reads remain unsigned by default. Private-channel and account-only
    reads opt explicitly into demo or production credentials. There is no
    ``post`` here; adding one would change what this engine is.
    """

    def __init__(
        self,
        base_url: str | None = None,
        failover_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        budget: ReadBudget | None = None,
        timeout_s: float | None = None,
        signed: bool = False,
        signing_environment: Literal["demo", "production"] | None = None,
    ) -> None:
        if signed and signing_environment is not None:
            raise ValueError("choose signed=True for demo compatibility or one signing_environment, not both")
        if signing_environment not in {None, "demo", "production"}:
            raise ValueError("signing_environment must be demo or production")
        # ``signed=True`` is retained as a demo-only compatibility spelling.
        # Production signing always has to be named; it can never turn on
        # because a legacy demo caller happened to request signing.
        self._signing_environment: Literal["demo", "production"] | None = (
            "demo" if signed else signing_environment
        )
        self.base_url = tunables.normalize_base_url(
            base_url if base_url is not None else tunables.PUBLIC_BASE_URL,
            name="KalshiClient base_url",
        )
        # None keeps the environment-aware default. An explicit empty string
        # disables failover; the old `or` expression made that impossible.
        chosen_failover = _default_failover(self.base_url) if failover_url is None else failover_url.strip()
        self.failover_url = (
            tunables.normalize_base_url(chosen_failover, name="KalshiClient failover_url")
            if chosen_failover
            else None
        )
        if self.failover_url == self.base_url:
            self.failover_url = None
        if self._signing_environment is not None and any(
            httpx.URL(url).scheme != "https"
            for url in filter(None, (self.base_url, self.failover_url))
        ):
            raise ValueError("a signed KalshiClient requires HTTPS for every venue host")
        base_environment = _known_environment(self.base_url)
        failover_environment = _known_environment(self.failover_url) if self.failover_url else None
        if self.failover_url and (base_environment or failover_environment) and base_environment != failover_environment:
            raise ValueError("KalshiClient base_url and failover_url must belong to the same environment")
        self._transport = transport
        self._budget = budget or get_read_budget()
        self._timeout_s = float(timeout_s if timeout_s is not None else tunables.REQUEST_TIMEOUT_S)
        # Off by default. Signed production reads are constructed explicitly by
        # the settlement and RFQ routes; every ordinary public client remains
        # keyless.
        self._signed = self._signing_environment is not None
        if self._signed:
            signed_hosts = (
                {tunables.DEMO_BASE_URL, tunables.DEMO_FAILOVER_URL}
                if self._signing_environment == "demo"
                else {tunables.PUBLIC_BASE_URL, tunables.PUBLIC_FAILOVER_URL}
            )
            if self.base_url not in signed_hosts or (
                self.failover_url is not None and self.failover_url not in signed_hosts
            ):
                raise ValueError(
                    f"a {self._signing_environment}-signed KalshiClient may use only configured "
                    f"{self._signing_environment} API hosts"
                )

    @property
    def signing_environment(self) -> Literal["demo", "production"] | None:
        """The explicitly selected credential boundary, if this client signs."""
        return self._signing_environment

    async def get(self, path: str, params: Any = None) -> Fetched:
        """One planned, budgeted GET, with the shared host as a failover.

        The budget is taken BEFORE the request, so a refusal costs nothing and
        is reported as a refusal rather than as a network failure. Those are
        different problems and a caller that cannot tell them apart cannot
        respond to either.
        """
        spend = await _acquire_budget(
            self._budget,
            path,
            max_wait_s=_local_budget_wait_s(),
        )
        if not spend.affordable:
            raise KalshiUnavailable(
                f"read budget exhausted before {path.split('?')[0]}: "
                f"{spend.cost} tokens needed, {spend.tokens_remaining:.1f} available",
            )
        last_error: str = "no host was tried"
        # The status travels with the reason. Without it the re-raise below
        # flattened every failure into "unavailable", and a caller could no
        # longer tell a 400 — the venue saying it does not publish what was
        # asked for, which is a fact about coverage — from a network fault
        # worth retrying. `livedata.fetch_weather` reads exactly that.
        last_status: int | None = None
        for host in dict.fromkeys(filter(None, (self.base_url, self.failover_url))):
            try:
                return await self._get_from(host, path, params, spend.cost)
            except KalshiRefused:
                raise
            except _KalshiDeadlineExhausted:
                raise
            except KalshiUnavailable as exc:
                last_error = exc.reason
                last_status = exc.status
                logger.warning("coherence: %s did not serve %s (%s)", _host_only(host), path.split("?")[0], exc.reason)
        raise KalshiUnavailable(last_error, status=last_status)

    async def _get_from(self, host: str, path: str, params: Any, token_cost: int) -> Fetched:
        request_url = _request_url(host, path, params)
        headers = {"Accept": "application/json"}
        if self._signed:
            # Signing is per host: a demo key cannot sign production, and the
            # signer refuses rather than producing a signature that earns a 401
            # reading as a credential fault.
            signed_path = request_url.raw_path.split(b"?", 1)[0].decode("ascii")
            headers.update(kalshi_auth.sign("GET", signed_path, host).as_dict())
        attempt_timeout_s = _venue_attempt_timeout_s(self._timeout_s)
        if attempt_timeout_s is None:
            raise _KalshiDeadlineExhausted(
                f"request budget exhausted before dispatch to {path.split('?')[0]}",
            )
        # TIMED AROUND THE CALL ITSELF, not around the whole method: the signing
        # above and the JSON parse below are this process's work, not the
        # venue's, and folding them in would report our own CPU as network. A
        # monotonic clock, because a wall clock can step backwards mid-request.
        started = time.perf_counter()
        try:
            if self._transport is not None:
                # AN INJECTED TRANSPORT NEVER TOUCHES THE POOL. Four suites hand
                # this class an `httpx.MockTransport` and expect a client built
                # around it; sharing a pooled client between tests would leak one
                # test's stub into the next. A throwaway costs nothing when the
                # transport is a function call.
                async with httpx.AsyncClient(
                    timeout=attempt_timeout_s,
                    follow_redirects=False,
                    transport=self._transport,
                    headers=headers,
                ) as client:
                    response = await client.get(request_url)
            else:
                # Headers go on the REQUEST, not the client: `kalshi_auth.sign`
                # signs one method, path and host, so a header set on a client
                # shared across hosts would send the wrong signature to the
                # failover. The timeout rides along for the same reason — it is
                # a property of this caller, not of the connection.
                response = await _pool().get(
                    request_url,
                    headers=headers,
                    timeout=attempt_timeout_s,
                )
        except httpx.HTTPError as exc:
            # Never interpolate the URL: it is the one string that can carry a
            # credential, and an exception message outlives the request.
            #
            # NOT TIMED. A call that failed measures this client's patience —
            # an eight-second timeout is eight seconds of waiting, not eight
            # seconds of venue — and feeding it to the window would push the
            # median toward the timeout and make every opportunity look
            # untradeable. `latency` says the same from the other side.
            raise KalshiUnavailable(f"transport failed: {type(exc).__name__}") from exc
        # An answer arrived, whatever its status. A 429 or a 401 is the venue
        # responding and its round trip is real; only a transport that never
        # answered is excluded.
        latency.record(time.perf_counter() - started)

        if response.status_code in (401, 403):
            request_kind = "signed request" if self._signed else "unauthenticated read"
            raise KalshiRefused(
                f"Kalshi refused the {request_kind} of {path.split('?')[0]} ({response.status_code})",
                status=response.status_code,
            )
        if response.status_code == 429:
            raise KalshiUnavailable(
                "Kalshi rate limited this client (429); it publishes no Retry-After, so back off exponentially",
                status=429,
            )
        if response.status_code >= 400:
            raise KalshiUnavailable(f"Kalshi answered {response.status_code}", status=response.status_code)
        try:
            payload = response.json()
        except ValueError as exc:
            raise KalshiUnavailable("Kalshi answered 200 with a body that is not JSON") from exc
        if not isinstance(payload, dict):
            raise KalshiUnavailable(f"expected a JSON object, got {type(payload).__name__}")
        return Fetched(path=path, status=response.status_code, payload=payload, host=_host_only(host), token_cost=token_cost)

    # ── The reads this engine makes ──────────────────────────────────────────

    async def exchange_status(self) -> Fetched:
        """Per-shard trading status. A hard gate before any solve is believed."""
        return await self.get("/exchange/status")

    async def endpoint_costs(self) -> Fetched:
        """The authoritative token costs. Public, and read once at startup."""
        return await self.get("/account/endpoint_costs")

    async def event(self, event_ticker: str, nested: bool = True) -> Fetched:
        return await self.get(
            f"/events/{_path_segment(event_ticker, 'event ticker')}",
            params={"with_nested_markets": str(nested).lower()},
        )

    async def markets(self, series_ticker: str, status: str = "open", limit: int = 200) -> Fetched:
        """Markets for one series.

        ``status`` here is the FILTER vocabulary (``open``), which is not the
        vocabulary the market object's own ``status`` field returns
        (``active``). ``mve_filter=exclude`` keeps multivariate combo markets
        out: they are a different instrument on a different shard and they
        interleave into this listing by default.
        """
        return await self.get(
            "/markets",
            params={
                "series_ticker": series_ticker,
                "status": status,
                "limit": min(limit, MAX_MARKETS_PER_PAGE),
                "mve_filter": "exclude",
            },
        )

    async def multivariate_markets(self, status: str = "open", limit: int = 200) -> Fetched:
        """Combo markets only — the mirror of ``markets``'s ``mve_filter=exclude``.

        These interleave into an ordinary ``/markets`` listing by default, which
        is why every other read here excludes them: a parlay is a different
        instrument on a different shard and it would otherwise arrive inside a
        strike ladder's family and be treated as one of its outcomes.
        """
        return await self.get(
            "/markets",
            params={"status": status, "limit": min(limit, MAX_MARKETS_PER_PAGE), "mve_filter": "only"},
        )

    async def multivariate_collections(self, limit: int = 100) -> Fetched:
        """Which events each combo family draws its legs from. Public."""
        return await self.get("/multivariate_event_collections", params={"limit": limit})

    async def settled_markets(self, series_ticker: str | None = None, limit: int = 200) -> Fetched:
        """Markets that have resolved, with the ``result`` field the score needs.

        ``status`` here is the FILTER word ``settled``; the market object's own
        ``status`` comes back as ``finalized``. Comparing the two is a bug that
        looks like an empty corpus.
        """
        params: dict[str, Any] = {"status": "settled", "limit": min(limit, MAX_MARKETS_PER_PAGE)}
        if series_ticker:
            params["series_ticker"] = series_ticker
        return await self.get("/markets", params=params)

    async def orderbooks(self, tickers: Sequence[str]) -> Fetched:
        """Up to 100 books for one request's tokens — the read that scales.

        This is the difference between watching fifty markets and watching the
        exchange: one call's budget buys a hundred books, so the recorder's
        reach is set by how many tickers it can name rather than by the rate
        limit.
        """
        return await self.get("/markets/orderbooks", params=build_orderbooks_query(tickers))

    async def orderbook(self, ticker: str, depth: int = 20) -> Fetched:
        return await self.get(f"/markets/{_path_segment(ticker, 'market ticker')}/orderbook", params={"depth": depth})

    async def series(self, series_ticker: str) -> Fetched:
        return await self.get(f"/series/{_path_segment(series_ticker, 'series ticker')}")

    async def series_fee_changes(self) -> Fetched:
        return await self.get("/series/fee_changes", params={"show_historical": "false"})

    async def account_limits(self) -> Fetched:
        """The real rate tier, and the only read here that needs a key.

        Everything else this client fetches is public. This one is worth the
        signing machinery because the budgeter is otherwise guessing: it
        assumes a quarter of the smallest published tier, and this replaces
        that assumption with the account's actual grant.
        """
        return await self.get("/account/limits")

    async def event_fee_changes(self, event_ticker: str | None = None, limit: int = 100) -> Fetched:
        params: dict[str, Any] = {"limit": limit}
        if event_ticker:
            params["event_ticker"] = event_ticker
        return await self.get("/events/fee_changes", params=params)


def _path_segment(value: str, label: str) -> str:
    """Encode one caller-supplied ticker as exactly one URL path segment."""
    if not value:
        raise ValueError(f"{label} must not be empty")
    return quote(value, safe="")


def _request_url(host: str, path: str, params: Any) -> httpx.URL:
    """Build the one URL used for both signing and transport."""
    if not path.startswith("/"):
        raise ValueError("Kalshi route paths must start with /")
    if params is None:
        return httpx.URL(f"{host}{path}")
    # Match httpx's existing `get(url, params=...)` behaviour: supplied params
    # replace a query embedded in `path`, rather than merging it.
    return httpx.URL(f"{host}{path}", params=params)
