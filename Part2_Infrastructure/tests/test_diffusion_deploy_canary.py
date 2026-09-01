from __future__ import annotations

import pytest

from modules.coherence.diffusion.bootstrap import EXPECTED_COUNTS
from tools import check_diffusion_ready as canary


def _payloads() -> dict[str, dict]:
    events = EXPECTED_COUNTS["diffusion_events"]
    runs = EXPECTED_COUNTS["diffusion_runs"]
    return {
        "events": {
            "state": "ok",
            "backend": "sqlite",
            "events": [{} for _ in range(events)],
        },
        "absorption": {
            "state": "ok",
            "backend": "sqlite",
            "horizons": ["1m", "5m"],
            "release_curve": [0.25, 1.0],
            "call_curve": [0.1, 1.0],
            "runs": [{} for _ in range(runs)],
        },
        "findings": {
            "state": "ok",
            "backend": "sqlite",
            "calendar": {"of": events},
            "findings": [{"n": 10}, {"n": 0}],
        },
    }


def _install_reads(monkeypatch: pytest.MonkeyPatch, payloads: dict[str, dict]) -> None:
    def read(path: str) -> dict:
        if "/events" in path:
            return payloads["events"]
        if "/absorption" in path:
            return payloads["absorption"]
        return payloads["findings"]

    monkeypatch.setattr(canary, "_read", read)


def test_canary_accepts_every_populated_diagram_input(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_reads(monkeypatch, _payloads())
    assert canary.readiness_report() == {
        "backend": "sqlite",
        "events": 62,
        "runs": 248,
        "findings": 2,
        "assessable_findings": 1,
    }


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (lambda payloads: payloads["events"].update(events=[]), "event ledger contains 0 rows"),
        (lambda payloads: payloads["absorption"].update(runs=[]), "absorption ledger contains 0 runs"),
        (lambda payloads: payloads["absorption"].update(release_curve=[]), "no drawable horizons"),
        (lambda payloads: payloads["findings"].update(findings=[{"n": 0}]), "no measured relationship"),
    ],
)
def test_canary_refuses_a_healthy_but_empty_gateway(
    monkeypatch: pytest.MonkeyPatch,
    mutation,
    reason: str,
) -> None:
    payloads = _payloads()
    mutation(payloads)
    _install_reads(monkeypatch, payloads)
    with pytest.raises(canary.DiffusionReadinessError, match=reason):
        canary.readiness_report()
