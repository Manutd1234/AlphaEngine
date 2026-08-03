"""Gateway-level tests: REST contract, Telegram auth, audit persistence."""

from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

import main
from conftest import deep_book, stub_feed
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

    def test_config_exposes_limits(self, client):
        cfg = client.get("/api/config").json()
        assert cfg["limits"]["max_order_notional_usd"] > 0
        assert cfg["symbols"]

    def test_portal_renders(self, client):
        html = client.get("/app").text
        assert "AlphaEngine" in html
        assert "/ws/book/" in html
        assert "{{" not in html          # template fully rendered


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


class TestTelegramAuth:
    def test_webhook_rejects_a_bad_secret(self, client):
        r = client.post("/telegram/webhook", json={"update_id": 1},
                        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"})
        assert r.status_code == 403

    def test_init_data_signature_validation(self):
        from modules.telegram import validate_init_data

        token = "123456:TEST-TOKEN"
        fields = {"query_id": "AAA", "user": '{"id":42,"username":"trader"}',
                  "auth_date": str(int(time.time()))}
        check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        good = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()

        assert validate_init_data(urlencode({**fields, "hash": good}), token)["user"]["id"] == 42
        assert validate_init_data(urlencode({**fields, "hash": "0" * 64}), token) is None
        assert validate_init_data("", token) is None

    def test_expired_init_data_rejected(self):
        from modules.telegram import validate_init_data

        token = "123456:TEST-TOKEN"
        fields = {"auth_date": str(int(time.time()) - 999_999), "user": '{"id":1}'}
        check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        sig = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        assert validate_init_data(urlencode({**fields, "hash": sig}), token) is None
