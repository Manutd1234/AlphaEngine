"""The mirror's contract: invisible to the order path, honest about losses."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

import modules.supabase_mirror as mirror_module
from modules.schemas import CheckResult, Fill, OrderRequest, RiskDecision
from modules.supabase_mirror import (
    SupabaseMirror,
    decision_payload,
    get_mirror,
    reset_mirror,
    verdict_for,
)


def make_decision(accepted: bool = True, rejected: list[str] | None = None) -> RiskDecision:
    return RiskDecision(
        order_id="ord-1",
        client_order_id="cli-1",
        accepted=accepted,
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.1,
        notional=5000.0,
        checks=[CheckResult(name="kill_switch", passed=True, detail="disengaged")],
        rejected_by=rejected or [],
        reason=None if accepted else "blocked",
        latency_ms=0.21,
        timestamp=datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc),
        fill=Fill(
            venue="BINANCE", price=64000.0, quantity=0.078, notional=5000.0,
            fee_usd=2.0, slippage_bps=1.2,
        ) if accepted else None,
        status="FILLED" if accepted else "REJECTED",
    )


def make_request() -> OrderRequest:
    return OrderRequest(symbol="BTCUSDT", side="BUY", notional=5000.0, strategy="ma_cross")


class TestVerdictMapping:
    def test_accepted_maps_to_accepted(self):
        primary, rejected = verdict_for(make_decision(accepted=True))
        assert primary == "ACCEPTED" and rejected == []

    def test_rejection_keeps_every_gate_in_order(self):
        decision = make_decision(accepted=False, rejected=["max_order_notional", "gross_exposure"])
        primary, rejected = verdict_for(decision)
        assert primary == "max_order_notional"
        assert rejected == ["max_order_notional", "gross_exposure"]


class TestPayloadHonesty:
    def test_latency_is_the_measured_value(self):
        payload = decision_payload(make_decision(), make_request(), "api")
        # The blueprint hardcoded 0.19 here. The payload may only ever carry
        # what the engine measured.
        assert payload["latency_ms"] == 0.21

    def test_fill_fields_absent_when_there_is_no_fill(self):
        payload = decision_payload(make_decision(accepted=False, rejected=["rate_limit"]), make_request(), "api")
        assert payload["fill_price"] is None and payload["venue"] is None
        assert payload["verdict"] == "rate_limit"

    def test_provenance_and_idempotency_keys_present(self):
        payload = decision_payload(make_decision(), make_request(), "telegram")
        assert payload["gateway_order_id"] == "ord-1"
        assert payload["source"] == "telegram"


class TestUnconfiguredIsANoOp:
    def test_disabled_without_environment(self, monkeypatch):
        reset_mirror()
        mirror = get_mirror()
        assert mirror.enabled is False
        # enqueue must be safe to call anyway — the hook is always registered.
        mirror.enqueue(make_decision(), make_request(), "api")
        health = mirror.health()
        assert health["configured"] is False and health["queued"] == 0

    @pytest.mark.asyncio
    async def test_start_and_stop_are_harmless_when_disabled(self):
        reset_mirror()
        mirror = get_mirror()
        await mirror.start()
        assert mirror.health()["running"] is False
        await mirror.stop()

    def test_disabled_when_credentials_exist_but_desk_is_blank(self, monkeypatch):
        configured_without_tenant = _SettingsStub()
        configured_without_tenant.supabase_desk_id = "  "
        monkeypatch.setattr(mirror_module, "settings", configured_without_tenant)

        mirror = SupabaseMirror()

        assert mirror.enabled is False
        mirror.enqueue(make_decision(), make_request(), "api")
        assert mirror.health()["queued"] == 0


class _SettingsStub:
    """config.Settings is frozen; the mirror only reads these six fields."""

    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_value"
    supabase_mirror_enabled = True
    supabase_desk_id = "00000000-0000-0000-0000-000000000001"
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 2


class TestBoundedQueue:
    def test_overflow_counts_drops_instead_of_blocking(self, monkeypatch):
        monkeypatch.setattr(mirror_module, "settings", _SettingsStub())

        async def scenario() -> dict:
            mirror = SupabaseMirror()  # not started: nothing drains, no client built
            assert mirror.enabled
            for _ in range(5):
                mirror.enqueue(make_decision(), make_request(), "api")
            return mirror.health()

        health = asyncio.run(scenario())
        assert health["queued"] == 2
        assert health["dropped"] == 3, "overflow must be counted, never awaited"

    def test_health_never_exposes_identity(self, monkeypatch):
        monkeypatch.setattr(mirror_module, "settings", _SettingsStub())
        mirror = SupabaseMirror()
        text = str(mirror.health())
        assert "supabase.co" not in text and "sb_secret" not in text


class TestDecisionHookSeam:
    @pytest.mark.asyncio
    async def test_gateway_invokes_registered_hooks_after_a_decision(self, monkeypatch, tmp_path):
        from modules.audit import AuditLog
        from modules.risk_proxy import RiskGateway

        gateway = RiskGateway(audit=AuditLog(tmp_path / "hook.duckdb"))
        seen: list[tuple[str, str]] = []
        gateway.add_decision_hook(lambda decision, req, source: seen.append((decision.symbol, source)))

        # A hook that raises must be contained, and later hooks must still run.
        def explode(decision, req, source):
            raise RuntimeError("observer bug")

        gateway.add_decision_hook(explode)
        gateway.add_decision_hook(lambda decision, req, source: seen.append(("second", source)))

        decision = await gateway.submit(make_request(), source="test")
        assert decision is not None
        assert ("BTCUSDT", "test") in seen
        assert ("second", "test") in seen, "a raising hook must not break the chain"
