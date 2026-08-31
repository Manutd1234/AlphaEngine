"""Authored market data stays behind an explicit demo switch."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from config import Settings
from modules.backtester import MarketDataUnavailable, fetch_ohlcv

ROOT = Path(__file__).resolve().parent.parent


def test_runtime_defaults_do_not_enable_authored_data(monkeypatch):
    monkeypatch.delenv("ALLOW_SYNTHETIC_BOOK", raising=False)

    configured = Settings()

    assert configured.allow_synthetic_book is False
    assert not hasattr(configured, "data_work_seed")


def test_runtime_default_does_not_invent_a_supabase_tenant(monkeypatch):
    monkeypatch.delenv("SUPABASE_DESK_ID", raising=False)

    assert Settings().supabase_desk_id == ""


def test_retired_shared_supabase_tenant_is_refused(monkeypatch):
    monkeypatch.setenv("SUPABASE_DESK_ID", " default ")

    with pytest.raises(ValueError, match="retired unscoped sentinel"):
        Settings()


def test_rag_stays_inert_when_supabase_has_no_tenant(monkeypatch):
    from types import SimpleNamespace

    import modules.research_rag.writer as rag_module
    from modules.research_rag import ResearchRag

    monkeypatch.setattr(rag_module, "settings", SimpleNamespace(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-key",
        supabase_desk_id=" ",
        research_rag_enabled=True,
        supabase_mirror_queue_max=10,
    ))

    assert ResearchRag().enabled is False


def test_example_environment_has_no_work_queue_seed_switch():
    example = (ROOT / ".env.example").read_text(encoding="utf-8")

    assert "ALLOW_SYNTHETIC_BOOK=0" in example
    assert "ALLOW_SYNTHETIC_BOOK=1" not in example
    assert "DATA_WORK_SEED" not in example


def test_observed_backtest_mode_refuses_to_invent_bars_after_failures(monkeypatch):
    import modules.audit as audit_module
    import modules.backtester.data as bt_data

    class EmptyCache:
        @staticmethod
        def load_ohlcv(*_args):
            return []

    monkeypatch.setattr(
        bt_data,
        "_fetch_binance_klines",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("offline")),
    )
    monkeypatch.setattr(audit_module, "get_audit", lambda: EmptyCache())

    with pytest.raises(MarketDataUnavailable, match="data_mode='synthetic_demo'"):
        fetch_ohlcv("BTCUSDT", "1h", 800)


def test_synthetic_backtest_demo_is_explicit_tagged_and_stable(monkeypatch):
    import modules.audit as audit_module
    import modules.backtester.data as bt_data

    monkeypatch.setattr(
        bt_data,
        "_fetch_binance_klines",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("venue must not be read")),
    )
    monkeypatch.setattr(
        audit_module,
        "get_audit",
        lambda: (_ for _ in ()).throw(AssertionError("cache must not be read")),
    )

    first, first_source = fetch_ohlcv("BTCUSDT", "1h", 800, data_mode="synthetic_demo")
    second, second_source = fetch_ohlcv("BTCUSDT", "1h", 800, data_mode="synthetic_demo")

    columns = ["open", "high", "low", "close", "volume"]
    assert first_source == second_source == "synthetic"
    assert np.array_equal(first[columns], second[columns])
