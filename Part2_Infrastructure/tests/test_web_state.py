"""The shared web-ops ledger: merge semantics, bounds, and the wire contract.

Most tests drive ``WebOpsState`` directly with an injected clock — the store's
behaviour is time-shaped, and real sleeps would make the suite flaky. One
route-level test pins the HTTP contract the Next.js workspace consumes.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
from modules.web_telemetry import (
    INSTANCE_CAP,
    KEY_CAP,
    OUTAGE_MAX_MS,
    RETENTION_MS,
    SAMPLE_CAP,
    WebLatencyBatch,
    WebLatencySample,
    WebOpsState,
    WebOutageCommand,
    WebQuotaReset,
    WebQuotaSpend,
    WebStateSyncRequest,
)

NOW = 1_700_000_000_000.0


def sync(state: WebOpsState, instance: str, now_ms: float = NOW, **kwargs):
    return state.sync(WebStateSyncRequest(instance=instance, **kwargs), now_ms=now_ms)


def latency_batch(key: str, *samples: tuple[float, float, bool]) -> WebLatencyBatch:
    return WebLatencyBatch(key=key, samples=[WebLatencySample(ts=ts, ms=ms, ok=ok) for ts, ms, ok in samples])


class TestLatencyMerge:
    def test_two_instances_merge_into_one_ledger(self):
        state = WebOpsState()
        sync(state, "lambda-a", latency=[latency_batch("openbb", (NOW - 5_000, 120.0, True))])
        view = sync(state, "lambda-b", latency=[latency_batch("openbb", (NOW - 2_000, 300.0, False))])
        assert view.instances == ["lambda-a", "lambda-b"]
        (row,) = view.latency
        assert row.key == "openbb"
        assert [(s.ms, s.ok) for s in row.samples] == [(120.0, True), (300.0, False)]

    def test_merged_samples_come_back_sorted_by_time(self):
        state = WebOpsState()
        sync(state, "a", latency=[latency_batch("k", (NOW - 1_000, 3.0, True), (NOW - 9_000, 1.0, True))])
        view = sync(state, "b", latency=[latency_batch("k", (NOW - 5_000, 2.0, True))])
        assert [s.ms for s in view.latency[0].samples] == [1.0, 2.0, 3.0]

    def test_stale_and_future_samples_are_refused(self):
        state = WebOpsState()
        view = sync(
            state,
            "a",
            latency=[
                latency_batch(
                    "k",
                    (NOW - RETENTION_MS - 1, 1.0, True),  # replay from before the window
                    (NOW + 120_000, 2.0, True),  # a broken clock
                    (NOW - 1_000, 3.0, True),  # genuine
                )
            ],
        )
        assert [s.ms for s in view.latency[0].samples] == [3.0]

    def test_retention_prunes_old_samples_on_later_syncs(self):
        state = WebOpsState()
        sync(state, "a", latency=[latency_batch("k", (NOW - 1_000, 1.0, True))])
        later = NOW + RETENTION_MS + 5_000
        view = sync(state, "a", now_ms=later)
        assert view.latency == []

    def test_per_key_cap_keeps_the_newest_samples(self):
        state = WebOpsState()
        # Two pushes of SAMPLE_CAP samples each — the deque must keep the newest.
        for round_index in range(2):
            base = NOW - 10_000 + round_index * 5_000
            batch = latency_batch("k", *[(base + i, float(round_index), True) for i in range(SAMPLE_CAP)])
            view = sync(state, "a", latency=[batch])
        samples = view.latency[0].samples
        assert len(samples) == SAMPLE_CAP
        assert all(s.ms == 1.0 for s in samples)

    def test_key_cardinality_is_capped_by_evicting_the_stalest(self):
        state = WebOpsState()
        for i in range(KEY_CAP):
            # key-0 gets the oldest newest-sample, so it is the eviction victim.
            sync(state, "a", latency=[latency_batch(f"key-{i}", (NOW - 10_000 + i, 1.0, True))])
        view = sync(state, "a", latency=[latency_batch("one-too-many", (NOW - 1_000, 1.0, True))])
        keys = {row.key for row in view.latency}
        assert len(keys) == KEY_CAP
        assert "one-too-many" in keys
        assert "key-0" not in keys


class TestOutages:
    def test_an_outage_set_by_one_instance_is_seen_by_another(self):
        state = WebOpsState()
        sync(state, "a", outages_set=[WebOutageCommand(provider="tiingo", expires_at=NOW + 60_000, note="drill")])
        view = sync(state, "b")
        (outage,) = view.outages
        assert (outage.provider, outage.note) == ("tiingo", "drill")

    def test_expiry_is_clamped_to_the_ceiling_and_expired_commands_ignored(self):
        state = WebOpsState()
        view = sync(
            state,
            "a",
            outages_set=[
                WebOutageCommand(provider="greedy", expires_at=NOW + OUTAGE_MAX_MS * 10),
                WebOutageCommand(provider="already-over", expires_at=NOW - 1),
            ],
        )
        (outage,) = view.outages
        assert outage.provider == "greedy"
        assert outage.expires_at == NOW + OUTAGE_MAX_MS

    def test_clear_by_provider_and_clear_all(self):
        state = WebOpsState()
        for provider in ("p1", "p2"):
            sync(state, "a", outages_set=[WebOutageCommand(provider=provider, expires_at=NOW + 60_000)])
        view = sync(state, "b", outages_cleared=["p1"])
        assert [o.provider for o in view.outages] == ["p2"]
        view = sync(state, "b", outages_cleared=["*"])
        assert view.outages == []

    def test_expired_outages_vanish_without_a_clear(self):
        state = WebOpsState()
        sync(state, "a", outages_set=[WebOutageCommand(provider="p", expires_at=NOW + 30_000)])
        view = sync(state, "a", now_ms=NOW + 31_000)
        assert view.outages == []


class TestQuota:
    def test_deltas_accumulate_across_instances(self):
        state = WebOpsState()
        sync(state, "a", quota=[WebQuotaSpend(provider="fmp", window="2026-08-11", spent=3)])
        view = sync(state, "b", quota=[WebQuotaSpend(provider="fmp", window="2026-08-11", spent=2)])
        (quota,) = view.quota
        assert quota.spent == 5

    def test_windows_are_independent_counters(self):
        state = WebOpsState()
        sync(state, "a", quota=[WebQuotaSpend(provider="fmp", window="2026-08-10", spent=9)])
        view = sync(state, "a", quota=[WebQuotaSpend(provider="fmp", window="2026-08-11", spent=1)])
        assert {(q.window, q.spent) for q in view.quota} == {("2026-08-10", 9), ("2026-08-11", 1)}

    def test_reset_zeroes_the_shared_counter_before_new_spend_applies(self):
        state = WebOpsState()
        sync(state, "a", quota=[WebQuotaSpend(provider="fmp", window="2026-08-11", spent=9)])
        view = sync(
            state,
            "b",
            quota=[WebQuotaSpend(provider="fmp", window="2026-08-11", spent=1)],
            quota_reset=[WebQuotaReset(provider="fmp", window="2026-08-11")],
        )
        (quota,) = view.quota
        assert quota.spent == 1


class TestInstances:
    def test_instance_registry_is_capped(self):
        state = WebOpsState()
        for i in range(INSTANCE_CAP + 5):
            # Later instances have later last-seen stamps, so the earliest go.
            sync(state, f"i-{i:03d}", now_ms=NOW + i)
        view = sync(state, "final", now_ms=NOW + INSTANCE_CAP + 10)
        assert len(view.instances) == INSTANCE_CAP
        assert "final" in view.instances
        assert "i-000" not in view.instances

    def test_idle_instances_age_out(self):
        state = WebOpsState()
        sync(state, "short-lived")
        view = sync(state, "steady", now_ms=NOW + RETENTION_MS + 1_000)
        assert view.instances == ["steady"]


class TestRoute:
    @pytest.fixture(scope="class")
    def client(self):
        # No `with`: entering the context manager runs the app lifespan, and its
        # shutdown would close the module-level audit singleton under any test
        # file that runs after this one. The sync route touches none of the
        # lifespan-managed services, so requests without lifespan are exact.
        return TestClient(main.app)

    def test_sync_round_trip_pins_the_wire_contract(self, client):
        body = {
            "schema_version": 1,
            "instance": "route-test",
            "latency": [{"key": "route:probe", "samples": [{"ts": NOW, "ms": 42.0, "ok": True}]}],
        }
        # ts=NOW is far in the past relative to the real clock, so the sample
        # itself is refused — the contract shape is what this test pins.
        response = client.post("/api/ops/web-state/sync", json=body)
        assert response.status_code == 200
        view = response.json()
        assert view["schema_version"] == 1
        assert view["observed_at"].endswith("Z")
        assert view["window_seconds"] == RETENTION_MS / 1000.0
        assert "route-test" in view["instances"]
        assert set(view) == {
            "schema_version",
            "observed_at",
            "window_seconds",
            "instances",
            "latency",
            "outages",
            "quota",
        }

    def test_unbounded_bodies_are_rejected_not_truncated(self, client):
        too_many_keys = {
            "instance": "route-test",
            "latency": [{"key": f"k{i}", "samples": []} for i in range(KEY_CAP + 1)],
        }
        assert client.post("/api/ops/web-state/sync", json=too_many_keys).status_code == 422
