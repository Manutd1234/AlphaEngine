"""The durable data-quality ledger: merge, dedupe, rules, and the wire shape.

Driven with an in-memory ledger and an injected clock, like ``test_web_state``:
the store's behaviour is time-shaped and real sleeps would make it flaky. Two
route-level tests pin what the Next.js workspace consumes.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from modules.data_quality import (
    DataQualityLedger,
    Escalation,
    WebContractCheck,
    WebContractFinding,
    publish_escalation,
)

NOW = 1_700_000_000_000.0
MIN = 60_000.0


def finding(seq: int, *, provider: str = "openbb", passed: bool = True, fatal: int = 0, warn: int = 0,
            drift: int = 0, at: float = NOW, capability: str = "quote", symbol: str | None = "BTCUSDT") -> WebContractFinding:
    checks = []
    if fatal:
        checks.append(WebContractCheck(check="quote.price_positive", severity="fatal", message="no positive price"))
    if warn:
        checks.append(WebContractCheck(check="quote.freshness", severity="warn", message="old"))
    if drift:
        checks.append(WebContractCheck(check="quote.change_derivable", severity="drift", message="renamed"))
    return WebContractFinding(
        seq=seq, observed_at=at, capability=capability, provider=provider, symbol=symbol,
        key=f"{capability}:{symbol}:*", passed=passed, fatal=fatal, warn=warn, drift=drift,
        not_evaluated=0, checks=checks,
    )


def ledger(**over) -> DataQualityLedger:
    defaults = dict(
        retention_days=7, view_window_minutes=1440, recent_limit=25,
        escalate_fatal_count=3, escalate_window_minutes=15, escalate_fail_rate=0.25,
        escalate_min_samples=8, escalate_cooldown_minutes=60,
    )
    defaults.update(over)
    return DataQualityLedger.in_memory(**defaults)


class TestMerge:
    def test_two_instances_merge_into_one_view(self):
        led = ledger()
        led.ingest([finding(1, at=NOW - MIN)], instance="lambda-a", now_ms=NOW)
        led.ingest([finding(1, provider="fmp", at=NOW - 2 * MIN)], instance="lambda-b", now_ms=NOW)
        view = led.view(NOW)
        assert view.total.evaluated == 2
        assert view.instances == 2
        assert [row.provider for row in view.by_provider] == ["fmp", "openbb"]
        assert view.first_observed_at is not None and view.last_observed_at is not None
        assert view.first_observed_at < view.last_observed_at

    def test_a_re_pushed_batch_is_not_counted_twice(self):
        led = ledger()
        batch = [finding(1), finding(2)]
        led.ingest(batch, instance="a", now_ms=NOW)
        # A sync that failed after the server stored the rows is restored and
        # re-pushed by the instance; the (instance, seq) key absorbs it.
        led.ingest(batch, instance="a", now_ms=NOW)
        assert led.view(NOW).total.evaluated == 2
        # The same seq from another instance is another finding.
        led.ingest([finding(1)], instance="b", now_ms=NOW)
        assert led.view(NOW).total.evaluated == 3

    def test_stale_and_future_findings_are_refused(self):
        led = ledger(retention_days=1)
        led.ingest([
            finding(1, at=NOW - 2 * 86_400_000),   # older than retention
            finding(2, at=NOW + 5 * MIN),          # from the future
            finding(3, at=NOW - MIN),              # fine
        ], instance="a", now_ms=NOW)
        assert led.view(NOW).total.evaluated == 1

    def test_prune_removes_findings_past_retention(self):
        led = ledger(retention_days=1)
        led.ingest([finding(1, at=NOW - 3_600_000)], instance="a", now_ms=NOW)
        assert led.view(NOW).total.evaluated == 1
        later = NOW + 2 * 86_400_000
        removed = led.prune(later)
        assert removed == 1
        assert led.view(later).total.evaluated == 0

    def test_fail_rate_is_none_with_nothing_evaluated_never_zero(self):
        led = ledger()
        led.ingest([finding(1, provider="fmp", passed=False, fatal=1)], instance="a", now_ms=NOW)
        rows = {row.provider: row for row in led.view(NOW).by_provider}
        assert rows["fmp"].fail_rate == 1.0
        # A provider that has not been evaluated in the window does not appear
        # with a rate of 0 — it does not appear at all.
        assert "openbb" not in rows

    def test_findings_filter_by_provider_capability_and_severity(self):
        led = ledger()
        led.ingest([
            finding(1, provider="fmp", passed=False, fatal=1),
            finding(2, provider="fmp", warn=1),
            finding(3, provider="openbb", capability="bars"),
        ], instance="a", now_ms=NOW)
        fatal, total = led.findings(severity="fatal")
        assert total == 1 and fatal[0].provider == "fmp" and fatal[0].severity == "fatal"
        warn, _ = led.findings(provider="fmp", severity="warn")
        assert [f.severity for f in warn] == ["warn"]
        bars, _ = led.findings(capability="bars")
        assert [f.provider for f in bars] == ["openbb"]
        clean, _ = led.findings(severity="clean")
        assert [f.capability for f in clean] == ["bars"]


class TestRules:
    def test_a_fatal_burst_opens_once_and_the_cooldown_holds_a_second(self):
        led = ledger()
        opened = led.ingest([finding(i, passed=False, fatal=1) for i in range(1, 4)], instance="a", now_ms=NOW)
        assert [e.rule for e in opened] == ["fatal_burst"]
        assert opened[0].provider == "openbb" and opened[0].count == 3
        assert "3 payloads with a fatal contract finding from openbb" in opened[0].detail
        # More fatal findings inside the cooldown do not open a second one.
        again = led.ingest([finding(i, passed=False, fatal=1) for i in range(4, 7)], instance="a", now_ms=NOW + MIN)
        assert again == []
        view = led.view(NOW + MIN)
        assert len(view.escalations) == 1
        assert view.escalations[0].resolved_at is None

    def test_a_burst_that_ages_out_is_resolved_not_deleted(self):
        led = ledger()
        led.ingest([finding(i, passed=False, fatal=1) for i in range(1, 4)], instance="a", now_ms=NOW)
        # Twenty minutes on, the three fatal findings are outside the rule
        # window; the next ingest of anything resolves the escalation.
        later = NOW + 20 * MIN
        led.ingest([finding(9, provider="fmp", at=later)], instance="a", now_ms=later)
        (esc,) = led.view(later).escalations
        assert esc.rule == "fatal_burst" and esc.resolved_at is not None

    def test_fail_rate_needs_min_samples_and_then_the_threshold(self):
        led = ledger(escalate_min_samples=8, escalate_fail_rate=0.25)
        # Seven of eight failing, but only seven evaluated: no escalation.
        opened = led.ingest([finding(i, provider="fmp", passed=(i > 6)) for i in range(1, 8)], instance="a", now_ms=NOW)
        assert opened == []
        # The eighth crosses min_samples; 6/8 = 75% > 25%.
        opened = led.ingest([finding(8, provider="fmp", passed=True)], instance="a", now_ms=NOW)
        assert [e.rule for e in opened] == ["fail_rate"]
        assert opened[0].evaluated == 8 and opened[0].count == 6

    def test_a_healthy_provider_never_escalates(self):
        led = ledger()
        opened = led.ingest([finding(i, warn=1) for i in range(1, 30)], instance="a", now_ms=NOW)
        assert opened == []
        assert led.view(NOW).escalations == []


class _StubBot:
    def __init__(self, enabled: bool, targets: int):
        self.enabled = enabled
        self._targets = targets
        self.sent: list[tuple[str, str]] = []
        self.roles: list[frozenset[str] | None] = []

    def health(self):
        return {"alert_targets": self._targets}

    async def broadcast(
        self, severity: str, message: str, roles: frozenset[str] | None = None,
    ) -> None:
        # Mirrors the production signature. A stub that is narrower than the
        # thing it stands in for turns a signature change into a swallowed
        # TypeError and a channel that silently reads "log" — which is how this
        # test failed when `roles` was added.
        self.sent.append((severity, message))
        self.roles.append(roles)


class _StubAudit:
    def __init__(self):
        self.events: list[dict] = []

    def record_risk_event(self, event, **kwargs):
        self.events.append({"event": event, **kwargs})


class TestPublish:
    def test_disabled_bot_means_the_log_channel_and_an_audit_row(self):
        led = ledger()
        (esc,) = led.ingest([finding(i, passed=False, fatal=1) for i in range(1, 4)], instance="a", now_ms=NOW)
        bot = _StubBot(enabled=False, targets=0)
        audit = _StubAudit()
        channel = asyncio.run(publish_escalation(esc, ledger=led, bot=bot, audit=audit))
        assert channel == "log"
        assert bot.sent and bot.sent[0][0] == "warning" and "Data-quality escalation" in bot.sent[0][1]
        assert audit.events[0]["event"] == "data_quality_escalation"
        assert audit.events[0]["payload"]["channel"] == "log"
        (view_esc,) = led.view(NOW).escalations
        assert view_esc.channel == "log" and view_esc.notified_at is not None

    def test_an_enabled_bot_with_targets_is_the_telegram_channel(self):
        led = ledger()
        esc = Escalation(id=1, rule="fail_rate", provider="fmp", opened_at=NOW, window_minutes=15,
                         count=6, evaluated=8, detail="6 of 8 payloads from fmp failed their contract (75%)")
        led._store.execute(
            "INSERT INTO data_quality_escalations (id, rule, provider, opened_at, window_minutes, count, evaluated, detail) VALUES (1,'fail_rate','fmp',?,15,6,8,'x')",
            (NOW,),
        )
        bot = _StubBot(enabled=True, targets=2)
        channel = asyncio.run(publish_escalation(esc, ledger=led, bot=bot, audit=_StubAudit()))
        assert channel == "telegram"
        assert led.view(NOW).escalations[0].channel == "telegram"


class TestRoute:
    @pytest.fixture(scope="class")
    def client(self):
        # No `with`: the sync and read routes touch none of the lifespan-managed
        # services (see test_web_state.TestRoute).
        return TestClient(main.app)

    def test_sync_persists_findings_and_returns_the_merged_quality_view(self, client):
        import time as _time

        now = _time.time() * 1000.0
        body = {
            "schema_version": 1,
            "instance": "route-test-dq",
            "findings": [
                {"seq": i, "observed_at": now - 1_000 * i, "capability": "quote", "provider": "route-vendor",
                 "symbol": "AAPL", "key": "quote:AAPL:*", "passed": False, "fatal": 1, "warn": 0, "drift": 0,
                 "not_evaluated": 0,
                 "checks": [{"check": "quote.price_positive", "severity": "fatal", "message": "no positive price"}]}
                for i in range(1, 4)
            ],
        }
        response = client.post("/api/ops/web-state/sync", json=body)
        assert response.status_code == 200
        quality = response.json()["data_quality"]
        rows = {row["provider"]: row for row in quality["by_provider"]}
        assert rows["route-vendor"]["evaluated"] == 3
        assert rows["route-vendor"]["fail_rate"] == 1.0
        assert any(e["rule"] == "fatal_burst" and e["provider"] == "route-vendor" for e in quality["escalations"])

        view = client.get("/api/data-quality/view")
        assert view.status_code == 200
        assert view.json()["backend"] == "sqlite"

        older = client.get("/api/data-quality/findings", params={"provider": "route-vendor", "severity": "fatal", "limit": 2})
        assert older.status_code == 200
        payload = older.json()
        assert payload["total"] >= 3 and len(payload["findings"]) == 2
        assert payload["findings"][0]["severity"] == "fatal"
        assert set(payload) == {"findings", "total", "retention_days", "window_minutes", "observed_at"}


class TestEscalationRouting:
    """An escalation reaches the roles that own it, and everyone with no role."""

    @pytest.mark.asyncio
    async def test_it_is_addressed_to_the_data_roles(self):
        from modules.data_quality import ESCALATION_ROLES, Escalation, publish_escalation

        ledger = DataQualityLedger.in_memory()
        bot = _StubBot(enabled=True, targets=1)
        audit = _StubAudit()
        escalation = Escalation(
            id=1, rule="fatal_burst", provider="fmp", opened_at=1_000.0,
            window_minutes=15, count=3, evaluated=None, detail="three fatals",
        )

        channel = await publish_escalation(escalation, ledger=ledger, bot=bot, audit=audit)

        assert channel == "telegram"
        assert bot.roles == [ESCALATION_ROLES], (
            "the escalation went to every chat; role routing existed and this path skipped it"
        )

    def test_the_roles_are_the_ones_who_can_act_on_it(self):
        from modules.data_quality import ESCALATION_ROLES

        # A provider failing contract checks is a data engineer's problem first
        # and a developer's second. A portfolio manager receiving it learns
        # nothing they can act on.
        assert ESCALATION_ROLES == frozenset({"data", "dev"})


class TestAcknowledgement:
    # These reach `ledger._store` rather than `ledger` because the ledger
    # composes its backend instead of inheriting SQLite — the raw SQL belongs
    # to the store now. Setting a fixture row up through SQL is still the right
    # move here: it is arranging a precondition, not exercising the ledger.

    def test_an_open_escalation_can_be_taken(self):
        ledger = DataQualityLedger.in_memory()
        ledger._store.execute(
            "INSERT INTO data_quality_escalations (rule,provider,opened_at,window_minutes,count,detail) "
            "VALUES (?,?,?,?,?,?)", ("fatal_burst", "fmp", 1_000.0, 15, 3, "three fatals"),
        )
        row_id = ledger._store.one("SELECT id FROM data_quality_escalations LIMIT 1")["id"]

        assert ledger.acknowledge(row_id, "tg:42") is True
        row = ledger._store.one(
            "SELECT acknowledged_at, acknowledged_by FROM data_quality_escalations WHERE id=?",
            (row_id,),
        )
        assert row["acknowledged_at"] is not None
        assert row["acknowledged_by"] == "tg:42"

    def test_the_first_name_stands(self):
        ledger = DataQualityLedger.in_memory()
        ledger._store.execute(
            "INSERT INTO data_quality_escalations (rule,provider,opened_at,window_minutes,count,detail) "
            "VALUES (?,?,?,?,?,?)", ("fatal_burst", "fmp", 1_000.0, 15, 3, "three fatals"),
        )
        row_id = ledger._store.one("SELECT id FROM data_quality_escalations LIMIT 1")["id"]

        ledger.acknowledge(row_id, "tg:42")
        ledger.acknowledge(row_id, "tg:99")

        # A second person taking an escalation someone else already has must not
        # quietly overwrite whose name is against it.
        by = ledger._store.one(
            "SELECT acknowledged_by FROM data_quality_escalations WHERE id=?", (row_id,),
        )["acknowledged_by"]
        assert by == "tg:42"

    def test_there_is_nothing_to_acknowledge_on_a_resolved_one(self):
        ledger = DataQualityLedger.in_memory()
        ledger._store.execute(
            "INSERT INTO data_quality_escalations "
            "(rule,provider,opened_at,window_minutes,count,detail,resolved_at) "
            "VALUES (?,?,?,?,?,?,?)", ("fatal_burst", "fmp", 1_000.0, 15, 3, "x", 2_000.0),
        )
        row_id = ledger._store.one("SELECT id FROM data_quality_escalations LIMIT 1")["id"]

        # Not an error, and not an acknowledgement either. The caller needs to
        # tell "done" from "there was nothing to do".
        assert ledger.acknowledge(row_id, "tg:42") is False

    def test_the_columns_are_added_to_a_table_that_already_exists(self, tmp_path):
        import sqlite3

        path = tmp_path / "ops.sqlite"
        # A data volume written before the columns existed.
        conn = sqlite3.connect(path)
        conn.execute(
            "CREATE TABLE data_quality_escalations (id INTEGER PRIMARY KEY, rule TEXT NOT NULL, "
            "provider TEXT NOT NULL, opened_at REAL NOT NULL, window_minutes INTEGER NOT NULL, "
            "count INTEGER NOT NULL, evaluated INTEGER, detail TEXT NOT NULL, notified_at REAL, "
            "channel TEXT, resolved_at REAL)"
        )
        conn.commit()
        conn.close()

        ledger = DataQualityLedger(str(path))
        columns = {r["name"] for r in ledger._store.query("PRAGMA table_info(data_quality_escalations)")}
        assert {"acknowledged_at", "acknowledged_by"} <= columns

        # And twice, because `migrate` runs on every construction and an
        # unconditional ALTER fails on the second start.
        DataQualityLedger(str(path))
