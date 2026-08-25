"""The Kalshi REST client: public reads, planned spend, honest degradation.

Shaped after ``modules/equity_quote.py`` — an async function taking an
injectable ``httpx.AsyncBaseTransport`` so every test drives real code against
recorded payloads instead of a stand-in that agrees with whatever the caller
expects.

Three behaviours are worth reading before the code.

**Nothing here logs a URL.** ``main.py`` pins httpx's logger to WARNING
precisely because its INFO request line carries the full URL, and signed
Kalshi requests put the key id in a header while other venues put credentials
in query strings. Errors are built from status lines.

**The bulk orderbook takes ``tickers`` repeated, not comma-joined.** Comma-
joining returns HTTP 200 with one entry whose ticker is the joined string and
whose ladders are empty — indistinguishable downstream from a market nobody is
quoting. ``build_orderbooks_query`` is the only place the parameter is built,
and ``kalshi_parse.parse_orderbooks`` raises if the wrong shape ever comes back.

**A 401 on the orderbook route is expected, not exceptional.** Kalshi's
OpenAPI marks both orderbook routes as requiring a key while the quick-start
guide and the live exchange serve them keyless. The client runs keyless, and
if that tightens it degrades to the Market object's top-of-book fields — which
are unambiguously public — and reports ``depth="top_of_book"`` so no caller
mistakes a shallow read for a deep one.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Sequence

import httpx

from modules.coherence import tunables
from modules.coherence.drivers import kalshi_auth
from modules.coherence.scheduler.budget import ReadBudget, get_read_budget

logger = logging.getLogger(__name__)


# ── The connection pool ──────────────────────────────────────────────────────
#
# Until 2026-08-25 every GET opened its own `httpx.AsyncClient` and closed it on
# the way out, so each call paid for a fresh DNS lookup, TCP connect and TLS
# handshake. Measured against `external-api.kalshi.com` from this machine:
#
#     cold connection   DNS 3ms + TCP 239-257ms + TLS 237-265ms + ~250ms  = 713-776ms
#     reused connection                                          ~265ms  = 261-274ms
#
# A cold Proofs load makes about nineteen of these, so roughly 9.3 seconds of
# the wall clock was handshake for connections thrown away microseconds later.
#
# One client for the process, created on first use rather than at import: the
# module is imported by tooling that never makes a request, and a client built
# at import time binds to whatever event loop happens to exist then.
#
# KEYED ON THE RUNNING LOOP, and that is not defensive programming — it is the
# first thing that broke. A pooled connection holds a transport bound to the
# loop that opened it, so a client built under one loop raises "Event loop is
# closed" the moment a second loop uses it. In this process there is only ever
# one loop and the check never fires; under pytest every test gets its own, and
# without this the suite fails in whichever test happens to run second.
_POOL: httpx.AsyncClient | None = None
_POOL_LOOP: asyncio.AbstractEventLoop | None = None


def _pool() -> httpx.AsyncClient:
    """The shared client for the running loop, built on first use."""
    global _POOL, _POOL_LOOP
    loop = asyncio.get_running_loop()
    if _POOL is None or _POOL.is_closed or _POOL_LOOP is not loop:
        _POOL = httpx.AsyncClient(
            follow_redirects=False,
            # Bounded rather than default-unbounded: this process talks to two
            # hosts and a leak here is a file-descriptor leak.
            limits=httpx.Limits(max_keepalive_connections=8, max_connections=16),
        )
        _POOL_LOOP = loop
    return _POOL


async def close_pool() -> None:
    """Close the shared client, if it belongs to the loop asking.

    ONLY IF IT BELONGS TO THIS LOOP, and that qualifier is the whole function.
    `aclose()` on a client whose connections were opened under a different loop
    raises "Event loop is closed" from deep inside asyncio's transport teardown
    — and under pytest that is the common case, because every `TestClient`
    builds a loop, runs the lifespan and tears the loop down, so the second test
    to start the app finds a pool belonging to the first test's corpse. Dropping
    the reference is the right move there: the loop that owned those sockets is
    already gone and closed them on its way out.
    """
    global _POOL, _POOL_LOOP
    if _POOL is not None and not _POOL.is_closed:
        try:
            mine = _POOL_LOOP is asyncio.get_running_loop()
        except RuntimeError:
            mine = False
        if mine:
            await _POOL.aclose()
    _POOL = None
    _POOL_LOOP = None

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
    """Public, unauthenticated reads against Kalshi's production host.

    Deliberately read-only: there is no ``post`` here, and adding one would be
    a change to what this engine is, not a new method.
    """

    def __init__(
        self,
        base_url: str | None = None,
        failover_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        budget: ReadBudget | None = None,
        timeout_s: float | None = None,
        signed: bool = False,
    ) -> None:
        self.base_url = (base_url or tunables.PUBLIC_BASE_URL).rstrip("/")
        self.failover_url = (failover_url or tunables.PUBLIC_FAILOVER_URL).rstrip("/")
        self._transport = transport
        self._budget = budget or get_read_budget()
        self._timeout_s = float(timeout_s if timeout_s is not None else tunables.REQUEST_TIMEOUT_S)
        # Off by default, and that is the whole posture: the read path this
        # engine lives on is public, so a client that signs by habit would fail
        # closed on production for no benefit.
        self._signed = signed

    async def get(self, path: str, params: Any = None) -> Fetched:
        """One planned, budgeted GET, with the shared host as a failover.

        The budget is taken BEFORE the request, so a refusal costs nothing and
        is reported as a refusal rather than as a network failure. Those are
        different problems and a caller that cannot tell them apart cannot
        respond to either.
        """
        spend = self._budget.take(path)
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
        for host in (self.base_url, self.failover_url):
            if not host:
                continue
            try:
                return await self._get_from(host, path, params, spend.cost)
            except KalshiRefused:
                raise
            except KalshiUnavailable as exc:
                last_error = exc.reason
                last_status = exc.status
                logger.warning("coherence: %s did not serve %s (%s)", _host_only(host), path.split("?")[0], exc.reason)
        raise KalshiUnavailable(last_error, status=last_status)

    async def _get_from(self, host: str, path: str, params: Any, token_cost: int) -> Fetched:
        headers = {"Accept": "application/json"}
        if self._signed:
            # Signing is per host: a demo key cannot sign production, and the
            # signer refuses rather than producing a signature that earns a 401
            # reading as a credential fault.
            headers.update(kalshi_auth.sign("GET", f"/trade-api/v2{path.split('?', 1)[0]}", host).as_dict())
        try:
            if self._transport is not None:
                # AN INJECTED TRANSPORT NEVER TOUCHES THE POOL. Four suites hand
                # this class an `httpx.MockTransport` and expect a client built
                # around it; sharing a pooled client between tests would leak one
                # test's stub into the next. A throwaway costs nothing when the
                # transport is a function call.
                async with httpx.AsyncClient(
                    timeout=max(0.1, self._timeout_s),
                    follow_redirects=False,
                    transport=self._transport,
                    headers=headers,
                ) as client:
                    response = await client.get(f"{host}{path}", params=params)
            else:
                # Headers go on the REQUEST, not the client: `kalshi_auth.sign`
                # signs one method, path and host, so a header set on a client
                # shared across hosts would send the wrong signature to the
                # failover. The timeout rides along for the same reason — it is
                # a property of this caller, not of the connection.
                response = await _pool().get(
                    f"{host}{path}",
                    params=params,
                    headers=headers,
                    timeout=max(0.1, self._timeout_s),
                )
        except httpx.HTTPError as exc:
            # Never interpolate the URL: it is the one string that can carry a
            # credential, and an exception message outlives the request.
            raise KalshiUnavailable(f"transport failed: {type(exc).__name__}") from exc

        if response.status_code in (401, 403):
            raise KalshiRefused(
                f"Kalshi refused an unauthenticated read of {path.split('?')[0]} ({response.status_code})",
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
        return await self.get(f"/events/{event_ticker}", params={"with_nested_markets": str(nested).lower()})

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
        return await self.get(f"/markets/{ticker}/orderbook", params={"depth": depth})

    async def series(self, series_ticker: str) -> Fetched:
        return await self.get(f"/series/{series_ticker}")

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


def _host_only(url: str) -> str:
    """The hostname, for logs and provenance. Never the path, never the query."""
    return url.split("//", 1)[-1].split("/", 1)[0]
