"""Ingest and the two escalation rules, as a mixin on the ledger.

Split out of ``modules/data_quality.py``; ``DataQualityLedger`` inherits this
alongside :class:`~modules.data_quality_read.DataQualityReadMixin`, so ``self``
here is always a fully built ledger — the ``_sql_*`` helpers, the tunables and
``prune`` all come from the class that mixes this in.

``_resolve_cleared`` is called from ``ingest`` and NOWHERE else on this path,
which is why a provider that goes silent needs the periodic sweep in
``modules/data_quality_escalation.py`` to clear its escalation at all.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from modules.data_quality_models import (
    CHECKS_PER_FINDING_CAP,
    FUTURE_SLACK_MS,
    WebContractCheck,
    WebContractFinding,
)
from modules.data_quality_schema import _PRUNE_EVERY_MS, Escalation, _now_ms

log = logging.getLogger("alphaengine.data_quality")


class DataQualityRulesMixin:
    """Ingest, the two rules, and the resolver they share."""

    # -- ingest ------------------------------------------------------------- #
    def ingest(
        self,
        findings: list[WebContractFinding],
        *,
        instance: str,
        source: str = "web",
        now_ms: float | None = None,
    ) -> list[Escalation]:
        """Persist a batch (de-duplicated on ``(instance, seq)``), run the rules.

        Returns the escalations this batch newly opened, so the caller can
        publish them; nothing here does network I/O.
        """
        now = now_ms if now_ms is not None else _now_ms()
        retention_ms = self.retention_days * 86_400_000
        rows: list[tuple[Any, ...]] = []
        for finding in findings:
            # Refuse the stale and the future, as the latency ledger does: a
            # sample outside the window is a replay or a broken clock.
            if finding.observed_at < now - retention_ms or finding.observed_at > now + FUTURE_SLACK_MS:
                continue
            rows.append((
                instance, finding.seq, source, finding.observed_at, now,
                finding.capability, finding.provider, finding.symbol, finding.key,
                1 if finding.passed else 0, finding.fatal, finding.warn, finding.drift, finding.not_evaluated,
                json.dumps([c.model_dump() for c in finding.checks[:CHECKS_PER_FINDING_CAP]]),
            ))
        if rows:
            self._sql_many(
                """
                INSERT INTO data_quality_findings
                    (instance, seq, source, observed_at, received_at, capability, provider, symbol, key,
                     passed, fatal, warn, drift, not_evaluated, checks_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(instance, seq) DO NOTHING
                """,
                rows,
            )
        providers = sorted({row[6] for row in rows})
        opened = self._evaluate_rules(providers, now) if providers else []
        self._resolve_cleared(now)
        if now - self._last_prune_ms >= _PRUNE_EVERY_MS:
            self.prune(now)
        return opened

    def record(
        self,
        *,
        source: Literal["replay", "backfill"],
        capability: str,
        provider: str,
        symbol: str | None,
        key: str,
        passed: bool,
        violations: list[dict[str, Any]],
        not_evaluated: int,
        instance: str,
        observed_ms: float | None = None,
    ) -> list[Escalation]:
        """A finding the gateway itself produced (a replay or backfill job)."""
        self._gateway_seq += 1
        checks = [
            WebContractCheck(
                check=str(v.get("check", ""))[:64] or "unknown",
                severity=v.get("severity", "warn"),
                message=str(v.get("message", ""))[:200],
            )
            for v in violations[:CHECKS_PER_FINDING_CAP]
        ]
        finding = WebContractFinding(
            seq=self._gateway_seq,
            observed_at=observed_ms if observed_ms is not None else _now_ms(),
            capability=capability,
            provider=provider,
            symbol=symbol,
            key=key,
            passed=passed,
            fatal=sum(1 for c in checks if c.severity == "fatal"),
            warn=sum(1 for c in checks if c.severity == "warn"),
            drift=sum(1 for c in checks if c.severity == "drift"),
            not_evaluated=not_evaluated,
            checks=checks,
        )
        # A gateway-side finding carries a seq the gateway process owns; the
        # instance name makes the (instance, seq) pair unique across restarts
        # only if the counter never repeats, so the job id is part of it.
        return self.ingest([finding], instance=instance, source=source)

    # -- rules -------------------------------------------------------------- #
    def _open_within_cooldown(self, rule: str, provider: str, now: float) -> bool:
        cooldown_ms = self.escalate_cooldown_minutes * 60_000
        row = self._sql_one(
            "SELECT id FROM data_quality_escalations WHERE rule=? AND provider=? AND opened_at>? LIMIT 1",
            (rule, provider, now - cooldown_ms),
        )
        return row is not None

    def _evaluate_rules(self, providers: list[str], now: float) -> list[Escalation]:
        window_ms = self.escalate_window_minutes * 60_000
        since = now - window_ms
        opened: list[Escalation] = []
        for provider in providers:
            stats = self._sql_one(
                """
                SELECT COUNT(*) AS evaluated,
                       SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN fatal>0 THEN 1 ELSE 0 END) AS fatal_findings
                FROM data_quality_findings WHERE provider=? AND observed_at>=?
                """,
                (provider, since),
            ) or {}
            evaluated = int(stats.get("evaluated") or 0)
            failed = int(stats.get("failed") or 0)
            fatal_findings = int(stats.get("fatal_findings") or 0)

            if fatal_findings >= self.escalate_fatal_count and not self._open_within_cooldown("fatal_burst", provider, now):
                detail = (
                    f"{fatal_findings} payloads with a fatal contract finding from {provider} "
                    f"in the last {self.escalate_window_minutes} minutes"
                )
                opened.append(self._open("fatal_burst", provider, now, fatal_findings, evaluated, detail))

            if evaluated >= self.escalate_min_samples:
                rate = failed / evaluated
                if rate > self.escalate_fail_rate and not self._open_within_cooldown("fail_rate", provider, now):
                    detail = (
                        f"{failed} of {evaluated} payloads from {provider} failed their contract "
                        f"({rate * 100:.0f}%) in the last {self.escalate_window_minutes} minutes"
                    )
                    opened.append(self._open("fail_rate", provider, now, failed, evaluated, detail))
        return opened

    def _open(self, rule: str, provider: str, now: float, count: int, evaluated: int, detail: str) -> Escalation:
        cursor = self._sql_execute(
            """
            INSERT INTO data_quality_escalations
                (rule, provider, opened_at, window_minutes, count, evaluated, detail)
            VALUES (?,?,?,?,?,?,?)
            """,
            (rule, provider, now, self.escalate_window_minutes, count, evaluated, detail),
        )
        log.warning("data-quality escalation opened: %s", detail)
        return Escalation(
            id=int(cursor.lastrowid or 0), rule=rule, provider=provider, opened_at=now,
            window_minutes=self.escalate_window_minutes, count=count, evaluated=evaluated, detail=detail,
        )

    def _resolve_cleared(self, now: float) -> None:
        """An open escalation whose condition no longer holds is resolved, not deleted."""
        window_ms = self.escalate_window_minutes * 60_000
        since = now - window_ms
        for row in self._sql_query("SELECT id, rule, provider FROM data_quality_escalations WHERE resolved_at IS NULL"):
            stats = self._sql_one(
                """
                SELECT COUNT(*) AS evaluated,
                       SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN fatal>0 THEN 1 ELSE 0 END) AS fatal_findings
                FROM data_quality_findings WHERE provider=? AND observed_at>=?
                """,
                (row["provider"], since),
            ) or {}
            evaluated = int(stats.get("evaluated") or 0)
            failed = int(stats.get("failed") or 0)
            fatal_findings = int(stats.get("fatal_findings") or 0)
            still = (
                fatal_findings >= self.escalate_fatal_count
                if row["rule"] == "fatal_burst"
                else evaluated >= self.escalate_min_samples and failed / evaluated > self.escalate_fail_rate
            )
            if not still:
                self._sql_execute("UPDATE data_quality_escalations SET resolved_at=? WHERE id=?", (now, row["id"]))

    def mark_notified(self, escalation_id: int, channel: str, now_ms: float | None = None) -> None:
        now = now_ms if now_ms is not None else _now_ms()
        self._sql_execute(
            "UPDATE data_quality_escalations SET notified_at=?, channel=? WHERE id=?",
            (now, channel, escalation_id),
        )
