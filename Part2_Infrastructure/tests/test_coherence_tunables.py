"""Configuration boundaries for the Kalshi coherence client."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from modules.coherence import tunables


class TestKalshiBaseUrls:
    def test_normalises_case_and_one_trailing_slash(self):
        assert tunables.normalize_base_url(" HTTPS://API.Example.COM/trade-api/v2/ ") == (
            "https://api.example.com/trade-api/v2"
        )

    def test_keeps_an_explicit_port(self):
        assert tunables.normalize_base_url("http://localhost:8080/trade-api/v2") == (
            "http://localhost:8080/trade-api/v2"
        )

    @pytest.mark.parametrize(
        "value",
        [
            "",
            "ftp://api.example.com/trade-api/v2",
            "https://api.example.com",
            "https://api.example.com/trade-api/v1",
            "https://api.example.com/trade-api/v2/markets",
            "https://user:secret@api.example.com/trade-api/v2",
            "https://api.example.com/trade-api/v2?token=secret",
            "https://api.example.com/trade-api/v2#fragment",
            "https://api.example.com/trade-api/v2//",
        ],
    )
    def test_rejects_urls_that_cannot_be_appended_and_signed_safely(self, value):
        with pytest.raises(ValueError):
            tunables.normalize_base_url(value)

    def test_validation_error_does_not_echo_embedded_credentials(self):
        with pytest.raises(ValueError) as raised:
            tunables.normalize_base_url("https://key-id:private-marker@example.com/trade-api/v2")
        assert "private-marker" not in str(raised.value)

    def test_demo_failover_is_the_official_demo_alternative(self):
        assert tunables.DEMO_FAILOVER_URL == "https://demo-api.kalshi.co/trade-api/v2"


class TestSeriesWatchlist:
    def test_canonicalises_deduplicates_and_preserves_first_seen_order(self):
        assert tunables.parse_series_watchlist(" kxhighny, KXBTCD, KXHIGHNY, kxbtc_d.1-test ") == (
            "KXHIGHNY",
            "KXBTCD",
            "KXBTC_D.1-TEST",
        )

    def test_empty_entries_do_not_create_phantom_series(self):
        assert tunables.parse_series_watchlist(" , , ") == ()

    @pytest.mark.parametrize("value", ["SERIES", "KX", "KXHIGHNY/../../x", "KX HIGHNY", "KXHIGHNY?limit=1"])
    def test_rejects_names_that_are_not_safe_kalshi_series_tickers(self, value):
        with pytest.raises(ValueError, match="COHERENCE_SERIES"):
            tunables.parse_series_watchlist(value)

    def test_broad_live_families_configure_the_recorder_without_static_series(self, monkeypatch):
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ())
        monkeypatch.setattr(tunables, "LIVE_FAMILY_LIMIT", 200)
        assert tunables.watchlist_configured()


class TestDemoPrivateKeyPath:
    def test_resolves_relative_paths_from_the_gateway_root(self, tmp_path):
        assert tunables.resolve_private_key_path("secrets/demo.pem", base_dir=tmp_path) == str(
            (tmp_path / "secrets/demo.pem").resolve()
        )

    def test_keeps_absolute_paths_and_empty_configuration_stable(self, tmp_path):
        key = tmp_path / "demo.pem"
        assert tunables.resolve_private_key_path(str(key), base_dir=tmp_path / "elsewhere") == str(key)
        assert tunables.resolve_private_key_path("", base_dir=tmp_path) == ""


def test_every_coherence_tunable_is_present_in_the_environment_template():
    source = Path(tunables.__file__).read_text()
    template = Path(__file__).parents[1].joinpath(".env.example").read_text()
    declared = set(re.findall(r'"((?:KALSHI|COHERENCE)_[A-Z0-9_]+)"', source))
    documented = set(re.findall(r"^((?:KALSHI|COHERENCE)_[A-Z0-9_]+)=", template, flags=re.MULTILINE))
    assert declared <= documented, f"missing from .env.example: {sorted(declared - documented)}"
