"""Host separation, URL construction and failover for Kalshi REST reads."""

from __future__ import annotations

import asyncio
import time
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.backend_runtime import bind_request_budget
from modules.coherence import tunables
from modules.coherence.drivers.kalshi_auth import SignedHeaders
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiRefused, KalshiUnavailable
from modules.coherence.scheduler.budget import ReadBudget


def budget() -> ReadBudget:
    return ReadBudget(tokens_per_second=1_000, burst=1_000)


def fake_sign(_method: str, _path: str, host: str) -> SignedHeaders:
    return SignedHeaders(key_id="test", timestamp_ms="1", signature="signature", host=host)


@pytest.fixture
def anyio_backend():
    return "asyncio"


class TestEnvironmentAwareFailover:
    @pytest.mark.anyio
    async def test_signed_demo_outage_fails_over_only_to_the_demo_alternative(self, monkeypatch):
        visited: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            visited.append(request.url.host)
            if request.url.host == urlsplit(tunables.DEMO_BASE_URL).hostname:
                return httpx.Response(503, json={"error": "temporary"})
            return httpx.Response(200, json={"exchange_active": True})

        monkeypatch.setattr("modules.coherence.drivers.kalshi_rest.kalshi_auth.sign", fake_sign)
        made = KalshiClient(
            base_url=tunables.DEMO_BASE_URL,
            signed=True,
            transport=httpx.MockTransport(handler),
            budget=budget(),
        )
        result = await made.exchange_status()
        assert result.status == 200
        assert visited == [
            urlsplit(tunables.DEMO_BASE_URL).hostname,
            urlsplit(tunables.DEMO_FAILOVER_URL).hostname,
        ]
        assert urlsplit(tunables.PUBLIC_BASE_URL).hostname not in visited
        assert urlsplit(tunables.PUBLIC_FAILOVER_URL).hostname not in visited

    @pytest.mark.anyio
    async def test_an_explicit_empty_failover_tries_only_the_primary(self):
        visited: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            visited.append(request.url.host)
            return httpx.Response(503, json={})

        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(handler),
            budget=budget(),
        )
        with pytest.raises(KalshiUnavailable, match="503"):
            await made.exchange_status()
        assert visited == [urlsplit(tunables.PUBLIC_BASE_URL).hostname]

    @pytest.mark.anyio
    async def test_an_identical_failover_is_deduplicated_after_normalisation(self):
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(503, json={})

        made = KalshiClient(
            failover_url=f"{tunables.PUBLIC_BASE_URL}/",
            transport=httpx.MockTransport(handler),
            budget=budget(),
        )
        with pytest.raises(KalshiUnavailable):
            await made.exchange_status()
        assert calls == 1

    def test_a_custom_primary_does_not_inherit_an_unrelated_production_failover(self):
        made = KalshiClient(base_url="https://kalshi.test/trade-api/v2", budget=budget())
        assert made.failover_url is None

    def test_a_signed_client_refuses_production_hosts_before_any_request(self):
        with pytest.raises(ValueError, match="demo API hosts"):
            KalshiClient(base_url=tunables.PUBLIC_BASE_URL, signed=True, budget=budget())
        production = KalshiClient(base_url=tunables.PUBLIC_BASE_URL, signing_environment="production", budget=budget())
        assert production.signing_environment == "production"

    @pytest.mark.parametrize(
        ("base_url", "failover_url"),
        [
            (tunables.DEMO_BASE_URL.replace("https://", "http://", 1), ""),
            (
                tunables.DEMO_BASE_URL,
                tunables.DEMO_FAILOVER_URL.replace("https://", "http://", 1),
            ),
        ],
    )
    def test_a_signed_client_requires_https_for_every_demo_host(self, base_url, failover_url):
        with pytest.raises(ValueError, match="requires HTTPS"):
            KalshiClient(
                base_url=base_url,
                failover_url=failover_url,
                signed=True,
                budget=budget(),
            )

    def test_explicit_failover_cannot_cross_known_environments(self):
        with pytest.raises(ValueError, match="same environment"):
            KalshiClient(
                base_url=tunables.DEMO_BASE_URL,
                failover_url=tunables.PUBLIC_FAILOVER_URL,
                budget=budget(),
            )


class TestRequestConstruction:
    @pytest.mark.anyio
    async def test_a_nearly_refilled_local_bucket_waits_instead_of_failing_the_read(self):
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={"exchange_active": True})

        shared = ReadBudget(tokens_per_second=1_000, burst=10, default_cost=10)
        assert shared.take("/prior-read").affordable
        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(handler),
            budget=shared,
        )

        result = await made.exchange_status()

        assert result.status == 200
        assert calls == 1
        assert shared.refusals == 0

    @pytest.mark.anyio
    async def test_local_budget_wait_is_bounded_and_reports_one_real_refusal(self, monkeypatch):
        shared = ReadBudget(tokens_per_second=1, burst=10, default_cost=10)
        assert shared.take("/prior-read").affordable
        monkeypatch.setattr(
            "modules.coherence.drivers.kalshi_pool.LOCAL_BUDGET_WAIT_MAX_S",
            0.01,
        )
        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={})),
            budget=shared,
        )

        with pytest.raises(KalshiUnavailable, match="read budget exhausted"):
            await made.exchange_status()

        assert shared.refusals == 1

    def test_one_shared_budget_survives_contended_testclient_loop_lifecycles(self):
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={"exchange_active": True})

        shared = ReadBudget(tokens_per_second=1_000, burst=10, default_cost=10)
        assert shared.take("/prior-read").affordable
        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(handler),
            budget=shared,
        )
        app = FastAPI()

        @app.get("/pair")
        async def pair() -> dict[str, int]:
            await asyncio.gather(made.exchange_status(), made.exchange_status())
            return {"calls": calls}

        # Each context owns a distinct event loop. Both calls contend while the
        # empty bucket refills, which binds an asyncio.Lock to the first loop
        # and reproduced the closed-loop failure on the second lifecycle.
        with TestClient(app) as first:
            assert first.get("/pair").status_code == 200
        with TestClient(app) as second:
            assert second.get("/pair").status_code == 200

        assert calls == 4
        assert shared.spent_tokens == 50  # prior read plus four actual reads
        assert shared.refusals == 0

    @pytest.mark.anyio
    async def test_concurrent_waiters_have_bounded_individual_refusals(self, monkeypatch):
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={})

        shared = ReadBudget(tokens_per_second=1, burst=10, default_cost=10)
        assert shared.take("/prior-read").affordable
        monkeypatch.setattr(
            "modules.coherence.drivers.kalshi_pool.LOCAL_BUDGET_WAIT_MAX_S",
            0.01,
        )
        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(handler),
            budget=shared,
        )
        started = time.monotonic()

        outcomes = await asyncio.gather(
            made.exchange_status(),
            made.exchange_status(),
            return_exceptions=True,
        )

        assert all(isinstance(outcome, KalshiUnavailable) for outcome in outcomes)
        assert time.monotonic() - started < 0.2
        assert calls == 0
        assert shared.spent_tokens == 10
        assert shared.refusals == 2

    @pytest.mark.anyio
    async def test_propagated_deadline_reserves_response_time_instead_of_waiting(self):
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={})

        shared = ReadBudget(tokens_per_second=1, burst=10, default_cost=10)
        assert shared.take("/prior-read").affordable
        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(handler),
            budget=shared,
        )
        started = time.monotonic()

        with bind_request_budget("req-budget-wait", "H1", remaining_ms=50):
            with pytest.raises(KalshiUnavailable, match="read budget exhausted"):
                await made.exchange_status()

        assert time.monotonic() - started < 0.05
        assert calls == 0
        assert shared.refusals == 1

    @pytest.mark.anyio
    async def test_near_expired_request_refuses_before_any_venue_transport(self):
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={})

        made = KalshiClient(
            transport=httpx.MockTransport(handler),
            budget=budget(),
        )

        with bind_request_budget("req-near-expired", "H1", remaining_ms=50):
            with pytest.raises(KalshiUnavailable, match="request budget exhausted before dispatch"):
                await made.exchange_status()

        assert calls == 0

    @pytest.mark.anyio
    async def test_primary_and_failover_recompute_and_cap_their_http_timeouts(self):
        captured: list[tuple[str, dict[str, float]]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            raw_timeout = request.extensions.get("timeout")
            assert isinstance(raw_timeout, dict)
            captured.append((request.url.host, {key: float(value) for key, value in raw_timeout.items()}))
            if request.url.host == urlsplit(tunables.PUBLIC_BASE_URL).hostname:
                time.sleep(0.02)
                return httpx.Response(503, json={})
            return httpx.Response(200, json={"exchange_active": True})

        made = KalshiClient(
            base_url=tunables.PUBLIC_BASE_URL,
            failover_url=tunables.PUBLIC_FAILOVER_URL,
            timeout_s=8,
            transport=httpx.MockTransport(handler),
            budget=budget(),
        )

        with bind_request_budget("req-attempt-timeouts", "H1", remaining_ms=1_000):
            result = await made.exchange_status()

        assert result.status == 200
        assert [host for host, _timeout in captured] == [
            urlsplit(tunables.PUBLIC_BASE_URL).hostname,
            urlsplit(tunables.PUBLIC_FAILOVER_URL).hostname,
        ]
        primary_read = captured[0][1]["read"]
        failover_read = captured[1][1]["read"]
        assert 0 < failover_read < primary_read <= 0.76
        assert all(
            0 < value <= 0.76
            for _host, timeout in captured
            for value in timeout.values()
        )

    @pytest.mark.anyio
    async def test_signs_the_exact_encoded_path_of_the_final_request(self, monkeypatch):
        signed: list[tuple[str, str]] = []
        requested: list[bytes] = []

        def signer(_method: str, path: str, host: str) -> SignedHeaders:
            signed.append((path, host))
            return fake_sign("GET", path, host)

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(request.url.raw_path)
            return httpx.Response(200, json={})

        monkeypatch.setattr("modules.coherence.drivers.kalshi_rest.kalshi_auth.sign", signer)
        made = KalshiClient(
            base_url=tunables.DEMO_BASE_URL,
            failover_url="",
            signed=True,
            transport=httpx.MockTransport(handler),
            budget=budget(),
        )
        await made.event("KX/ODD? NAME")

        expected = b"/trade-api/v2/events/KX%2FODD%3F%20NAME?with_nested_markets=true"
        assert requested == [expected]
        assert signed == [
            ("/trade-api/v2/events/KX%2FODD%3F%20NAME", tunables.DEMO_BASE_URL),
        ]

        production = KalshiClient(base_url=tunables.PUBLIC_BASE_URL, failover_url="", signing_environment="production",
                                  transport=httpx.MockTransport(handler), budget=budget())
        await production.get("/cfbenchmarks/values", {"id": "BRTI"})
        assert signed[-1] == ("/trade-api/v2/cfbenchmarks/values", tunables.PUBLIC_BASE_URL)

    @pytest.mark.anyio
    async def test_signed_401_names_a_signed_request(self, monkeypatch):
        monkeypatch.setattr("modules.coherence.drivers.kalshi_rest.kalshi_auth.sign", fake_sign)
        made = KalshiClient(
            base_url=tunables.DEMO_BASE_URL,
            failover_url="",
            signed=True,
            transport=httpx.MockTransport(lambda _request: httpx.Response(401, json={})),
            budget=budget(),
        )
        with pytest.raises(KalshiRefused, match="signed request") as raised:
            await made.exchange_status()
        assert "unauthenticated" not in raised.value.reason

    @pytest.mark.anyio
    async def test_unsigned_401_names_an_unauthenticated_read(self):
        made = KalshiClient(
            failover_url="",
            transport=httpx.MockTransport(lambda _request: httpx.Response(401, json={})),
            budget=budget(),
        )
        with pytest.raises(KalshiRefused, match="unauthenticated read"):
            await made.exchange_status()

    @pytest.mark.parametrize(
        "value",
        [
            "api.example.com/trade-api/v2",
            "file:///trade-api/v2",
            "https://api.example.com",
            "https://user:secret@api.example.com/trade-api/v2",
            "https://api.example.com/trade-api/v2?key=secret",
        ],
    )
    def test_constructor_rejects_an_unsafe_base_url(self, value):
        with pytest.raises(ValueError):
            KalshiClient(base_url=value, budget=budget())
