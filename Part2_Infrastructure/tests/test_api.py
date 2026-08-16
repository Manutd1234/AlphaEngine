"""Gateway-level tests: REST contract, client separation, audit persistence."""

from __future__ import annotations

import re
import time
from dataclasses import replace

import pytest
from conftest import deep_book, stub_feed
from fastapi.testclient import TestClient

import main
from modules.risk_proxy import TokenBucket


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        # Market data is disabled in tests (see conftest); inject a deterministic book.
        engine = main.get_engine()
        engine.feeds = {"TEST": stub_feed("TEST", deep_book())}
        gw = main.get_gateway()
        gw.bucket = TokenBucket(1e6, 1_000_000)
        gw.reset_book("test")
        yield c


class TestMeta:
    def test_health_reports_all_three_modules(self, client):
        body = client.get("/health").json()
        assert body["status"] in {"ok", "halted"}
        assert {"A_tca", "B_risk", "C_backtest"} <= set(body["modules"])
        # The decision engine is published beside the backtest engine, for the
        # same reason: deploy.yml reads it to refuse a quietly degraded container.
        assert body["modules"]["B_risk"]["decision_engine"] in {"native", "python"}

    def test_config_exposes_limits(self, client):
        cfg = client.get("/api/config").json()
        assert cfg["limits"]["max_order_notional_usd"] > 0
        assert cfg["symbols"]

    def test_operations_snapshot_is_structured_and_freshness_aware(self, client):
        body = client.get("/api/ops/snapshot").json()
        assert body["schema_version"] == 1
        assert body["status"] in {"nominal", "degraded", "critical", "halted"}
        assert body["observed_at"].endswith("Z")
        assert body["stale_after_seconds"] == 65
        assert body["environment"]
        assert body["version"]

        assert body["market_data"]["feeds"][0]["symbols"][0]["symbol"] == "BTCUSDT"
        assert body["market_data"]["feeds"][0]["symbols"][0]["age_seconds"] >= 0
        assert body["risk"]["orders_accepted_total"] >= 0
        assert body["queue"]["workers"] >= 1
        assert {"queued", "running", "succeeded", "failed", "cancelled"} <= set(body["queue"]["by_status"])
        assert body["audit"]["backend"] in {"duckdb", "sqlite"}
        assert body["audit"]["available"] is True
        assert body["telegram"]["status"] == "disabled"
        assert body["route_latency"]["window_seconds"] > 0

        # The decision's own clock. Engine and sample count are always present
        # so a build that fell back to Python is visible before the first order;
        # the quantiles are null until something has been measured — never 0.
        decision = body["decision_latency"]
        assert decision["engine"] in {"native", "python"}
        assert decision["samples"] >= 0
        if decision["samples"] == 0:
            assert decision["p50_us"] is None and decision["p99_us"] is None
            assert decision["max_us"] is None
        else:
            assert decision["p50_us"] is not None and decision["p99_us"] >= decision["p50_us"]
        if decision["engine"] == "python":
            assert decision["core_p99_ns"] is None, "the Python engine has no core clock"

        # Raw error messages and deployment identities do not belong on this
        # frequently-polled endpoint even when their safe presence flags do.
        def keys(value):
            if isinstance(value, dict):
                return set(value).union(*(keys(item) for item in value.values()))
            if isinstance(value, list):
                return set().union(*(keys(item) for item in value))
            return set()

        published_keys = keys(body)
        assert "last_error" not in published_keys
        assert "username" not in published_keys
        assert "db_path" not in published_keys

    def test_broker_credentials_never_reach_gateway_payloads(self, client, monkeypatch):
        from modules import jobs

        secret = "redis://queue-user:super-secret@redis.internal:6379/7?ssl=true"
        monkeypatch.setattr(jobs, "settings", replace(jobs.settings, celery_broker_url=secret))

        for path in ("/health", "/api/jobs", "/api/ops/snapshot"):
            response = client.get(path)
            assert response.status_code == 200
            assert secret not in response.text
            assert "super-secret" not in response.text
            assert "redis.internal" not in response.text

        queue = client.get("/api/ops/snapshot").json()["queue"]
        assert queue["broker_configured"] is True
        assert queue["broker_transport"] == "redis"
        assert "broker" not in queue

    def test_portal_renders(self, client):
        html = client.get("/app").text
        assert "AlphaEngine" in html
        assert "/ws/book/" in html
        assert "{{" not in html          # template fully rendered


class TestMetrics:
    """The scrape endpoint is only useful if a scraper can parse it."""

    SAMPLE = re.compile(r'^[a-z_]+(\{[a-z_]+="[^"]*"(,[a-z_]+="[^"]*")*\})? -?[0-9.]+$')

    def _samples(self, body: str) -> list[str]:
        return [ln for ln in body.splitlines() if ln and not ln.startswith("#")]

    def test_exposition_format_parses(self, client):
        resp = client.get("/metrics")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/plain")

        body = resp.text
        samples = self._samples(body)
        assert samples, "no metrics exported"
        for line in samples:
            assert self.SAMPLE.match(line), line

        # Every exported series must have declared its type first, or a scraper
        # has to guess whether a rate() is meaningful.
        declared = {ln.split()[2] for ln in body.splitlines() if ln.startswith("# TYPE ")}
        for line in samples:
            assert line.split("{")[0].split(" ")[0] in declared, line

    def test_kill_switch_state_is_observable(self, client):
        client.post("/api/risk/kill", json={"reason": "metrics-test"})
        assert "alphaengine_kill_switch_active 1" in client.get("/metrics").text

        client.post("/api/risk/resume", json={})
        assert "alphaengine_kill_switch_active 0" in client.get("/metrics").text

    def test_order_counters_advance(self, client):
        def accepted() -> float:
            for line in client.get("/metrics").text.splitlines():
                if line.startswith("alphaengine_orders_accepted_total "):
                    return float(line.split()[-1])
            raise AssertionError("orders_accepted_total not exported")

        before = accepted()
        client.post("/api/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "notional": 12000, "order_type": "MARKET"})
        assert accepted() == before + 1

    def test_latency_window_records_routes_but_not_the_scrape(self, client):
        client.get("/health")
        body = client.get("/metrics").text
        assert 'alphaengine_request_latency_ms{route="/health",quantile="0.5"}' in body
        # Timing the scrape would make the endpoint report on itself.
        assert 'route="/metrics"' not in body


class TestTCARoutes:
    def test_book(self, client):
        books = client.get("/api/book/BTCUSDT?depth=5").json()
        assert books[0]["bids"] and books[0]["asks"]
        assert books[0]["bids"][0]["cum_notional"] > 0

    def test_tca_report(self, client):
        r = client.get("/api/tca/BTCUSDT?side=BUY&notional=50000").json()
        assert r["smart_route"]
        assert r["smart_route_vwap"] >= r["consolidated_mid"]

    def test_unknown_symbol_404s(self, client):
        assert client.get("/api/book/NOPEUSDT").status_code == 404


class TestRiskRoutes:
    def test_accept_then_audit(self, client):
        d = client.post("/api/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "notional": 10000,
            "order_type": "MARKET", "client_order_id": "api-1"}).json()
        assert d["accepted"] and d["fill"]["simulated"]

        rows = client.get("/api/audit/orders?limit=5").json()
        assert any(r["order_id"] == d["order_id"] for r in rows)

    def test_reject_returns_200_with_evidence(self, client):
        """A rejection is a business outcome, not an HTTP error."""
        resp = client.post("/api/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "notional": 5_000_000, "order_type": "MARKET"})
        assert resp.status_code == 200
        body = resp.json()
        assert not body["accepted"]
        assert "max_order_notional" in body["rejected_by"]
        assert any(not c["passed"] for c in body["checks"])

    def test_kill_and_resume_round_trip(self, client):
        assert client.post("/api/risk/kill", json={"reason": "pytest"}).json()["kill_switch_active"]
        blocked = client.post("/api/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "notional": 1000, "order_type": "MARKET"}).json()
        assert "kill_switch" in blocked["rejected_by"]

        assert not client.post("/api/risk/resume", json={}).json()["kill_switch_active"]
        assert client.get("/api/risk/state").json()["kill_switch_active"] is False

    def test_kill_event_is_audited(self, client):
        client.post("/api/risk/kill", json={"reason": "audit-check"})
        client.post("/api/risk/resume", json={})
        events = client.get("/api/audit/events?limit=20").json()
        assert any(e["event"] == "kill_switch_engaged" for e in events)

    def test_malformed_order_is_422(self, client):
        assert client.post("/api/orders", json={"symbol": "BTCUSDT", "side": "SIDEWAYS"}).status_code == 422


class TestJobs:
    def test_backtest_job_lifecycle(self, client):
        job = client.post("/api/backtest", json={
            "symbol": "BTCUSDT", "interval": "1h", "bars": 400,
            "fast_min": 5, "fast_max": 15, "fast_step": 5,
            "slow_min": 30, "slow_max": 60, "slow_step": 30,
            "walk_forward": False}).json()
        assert job["status"] in {"queued", "running"}

        for _ in range(180):
            status = client.get(f"/api/jobs/{job['job_id']}").json()
            if status["status"] in {"succeeded", "failed"}:
                break
            time.sleep(0.5)

        assert status["status"] == "succeeded", status.get("error")
        assert status["result"]["combos_tested"] > 0
        assert status["result"]["equity_curve_png"]
        # The queue's id must be what the job persists, not a placeholder —
        # otherwise the audit log cannot be joined back to the request.
        assert status["result"]["job_id"] == job["job_id"]
        assert any(r["job_id"] == job["job_id"] for r in client.get("/api/audit/backtests").json())

    def test_unknown_job_404s(self, client):
        assert client.get("/api/jobs/deadbeef").status_code == 404


class TestOrderLifecycle:
    """The routes that exist because an order can now outlive its own request."""

    def _rest(self, client) -> str:
        """Place a non-marketable limit and return its id."""
        body = client.post("/api/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "quantity": 10.0,
            "order_type": "LIMIT", "limit_price": 98.0,
        }).json()
        assert body["status"] == "WORKING", body
        return body["order_id"]

    def test_a_resting_order_appears_in_the_open_book(self, client):
        order_id = self._rest(client)
        rows = client.get("/api/orders").json()
        assert any(row["order_id"] == order_id for row in rows)

        row = next(r for r in rows if r["order_id"] == order_id)
        assert row["status"] == "WORKING"
        assert row["notional"] == pytest.approx(980.0)
        # A resting order with no mark reports null distance, never zero: "at the
        # touch" and "nobody is quoting this" are different claims.
        assert row["distance_bps"] is not None

        client.post(f"/api/orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_the_open_book_filters_by_symbol(self, client):
        order_id = self._rest(client)
        assert client.get("/api/orders", params={"symbol": "BTCUSDT"}).json()
        assert client.get("/api/orders", params={"symbol": "ETHUSDT"}).json() == []
        client.post(f"/api/orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_cancel_takes_it_off_the_book_and_acknowledges(self, client):
        order_id = self._rest(client)
        resp = client.post(f"/api/orders/{order_id}/cancel", json={"reason": "changed my mind"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "CANCELLED"
        assert not any(r["order_id"] == order_id for r in client.get("/api/orders").json())

    def test_cancelling_something_that_is_not_resting_is_a_404(self, client):
        resp = client.post("/api/orders/deadbeef/cancel", json={})
        assert resp.status_code == 404

    def test_the_timeline_records_every_transition(self, client):
        order_id = self._rest(client)
        client.post(f"/api/orders/{order_id}/cancel", json={"reason": "cleanup"})

        body = client.get(f"/api/orders/{order_id}").json()
        assert body["status"] == "CANCELLED"
        events = [e["event"] for e in body["events"]]
        assert events == ["ACCEPTED_WORKING", "CANCELLED"], events

    def test_an_unknown_timeline_is_a_404(self, client):
        assert client.get("/api/orders/deadbeef").status_code == 404

    def test_replace_returns_the_new_order_s_evidence_not_the_old(self, client):
        order_id = self._rest(client)
        resp = client.post(f"/api/orders/{order_id}/replace", json={"limit_price": 97.0})
        assert resp.status_code == 200

        body = resp.json()
        assert body["order_id"] != order_id
        assert body["checks"], "a replacement faces every gate again"
        assert body["status"] == "WORKING"

        rows = client.get("/api/orders").json()
        assert not any(r["order_id"] == order_id for r in rows)
        replacement = next(r for r in rows if r["order_id"] == body["order_id"])
        assert replacement["limit_price"] == 97.0

        client.post(f"/api/orders/{body['order_id']}/cancel", json={"reason": "cleanup"})

    def test_a_market_order_that_claims_to_rest_is_rejected_not_coerced(self, client):
        resp = client.post("/api/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "notional": 1000.0,
            "order_type": "MARKET", "time_in_force": "GTC",
        })
        assert resp.status_code == 422

    def test_risk_state_counts_the_resting_book(self, client):
        order_id = self._rest(client)
        state = client.get("/api/risk/state").json()
        assert state["working_orders"] >= 1
        assert state["working_notional"] > 0
        client.post(f"/api/orders/{order_id}/cancel", json={"reason": "cleanup"})


class TestReadAuthentication:
    SENSITIVE_COLLECTIONS = (
        "/api/config",
        "/api/orders",
        "/api/risk/state",
        "/api/risk/limits",
        "/api/jobs",
        "/api/audit/orders",
        "/api/audit/events",
        "/api/audit/backtests",
        "/api/audit/stats",
    )

    def test_local_mode_keeps_sensitive_reads_available(self, client, monkeypatch):
        monkeypatch.setattr(main, "settings", replace(main.settings, require_auth=False))

        for path in self.SENSITIVE_COLLECTIONS:
            assert client.get(path).status_code == 200, path
        # Local mode reaches the handler, so an unknown job remains a 404 rather
        # than being intercepted by authentication.
        assert client.get("/api/jobs/deadbeef").status_code == 404

    def test_auth_mode_requires_bearer_for_sensitive_reads(self, client, monkeypatch):
        token = "pytest-gateway-bearer"
        monkeypatch.setattr(
            main,
            "settings",
            replace(main.settings, require_auth=True, web_api_token=token),
        )

        for path in (*self.SENSITIVE_COLLECTIONS, "/api/jobs/deadbeef"):
            response = client.get(path)
            assert response.status_code == 401, path
            assert response.json()["error"] == "authentication required"

    def test_auth_mode_accepts_valid_bearer_and_rejects_invalid_one(self, client, monkeypatch):
        token = "pytest-gateway-bearer"
        monkeypatch.setattr(
            main,
            "settings",
            replace(main.settings, require_auth=True, web_api_token=token),
        )
        headers = {"Authorization": f"Bearer {token}"}

        for path in self.SENSITIVE_COLLECTIONS:
            assert client.get(path, headers=headers).status_code == 200, path
        assert client.get("/api/jobs/deadbeef", headers=headers).status_code == 404

        invalid = client.get(
            "/api/risk/state",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert invalid.status_code == 401
        assert invalid.json()["error"] == "invalid gateway token"

    def test_auth_mode_accepts_dedicated_gateway_header(self, client, monkeypatch):
        token = "pytest-gateway-header-token"
        monkeypatch.setattr(
            main,
            "settings",
            replace(main.settings, require_auth=True, web_api_token=token),
        )

        response = client.get(
            "/api/portfolio",
            headers={"X-AlphaEngine-Token": token},
        )
        assert response.status_code == 200

        invalid = client.get(
            "/api/portfolio",
            headers={"X-AlphaEngine-Token": "wrong-token"},
        )
        assert invalid.status_code == 401
        assert invalid.json()["error"] == "invalid gateway token"


class TestTelegramAuth:
    def test_webhook_rejects_a_bad_secret(self, client):
        r = client.post("/telegram/webhook", json={"update_id": 1},
                        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"})
        assert r.status_code == 403

    def test_gateway_console_has_no_telegram_webapp_coupling_or_embedded_secret(
        self, client, monkeypatch
    ):
        secret = "must-never-appear-in-html"
        monkeypatch.setattr(
            main,
            "settings",
            replace(main.settings, require_auth=True, web_api_token=secret),
        )
        html = client.get("/app").text
        assert "telegram-web-app" not in html
        assert "initData" not in html
        assert "X-Telegram-Init-Data" not in html
        assert secret not in html
        assert '"auth_required": true' in html
        assert 'id="authToken"' in html
        assert "sessionStorage" not in html
        assert "Gateway Console" in html
