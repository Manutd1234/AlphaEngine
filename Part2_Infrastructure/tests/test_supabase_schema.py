"""The committed Supabase SQL, held in parity with the Python engine — offline.

Even a two-gate SQL sandbox can drift from config.py, and a mirror that
relabels or drops a gate is worse than no mirror. These tests parse the
committed migration text and import the live settings/engine, so the drift
surfaces as a red test instead of a silently wrong Postgres blotter. No test
here touches a network or a database.
"""

from __future__ import annotations

import re
from pathlib import Path

from config import settings
from modules.supabase_mirror import GATE_TO_VERDICT

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"
SQL = {path.name: path.read_text() for path in sorted(MIGRATIONS.glob("*.sql"))}
ALL_SQL = "\n".join(SQL.values())
RISK_PROXY = (Path(__file__).resolve().parent.parent / "modules" / "risk_proxy.py").read_text()


def engine_gate_names() -> set[str]:
    """Every gate name risk_proxy.submit() can emit, read from its source."""
    return set(re.findall(r'add\("([a-z_]+)"', RISK_PROXY))


class TestMigrationHygiene:
    def test_filenames_are_ordered_timestamped_migrations(self):
        for name in SQL:
            assert re.fullmatch(r"\d{14}_[a-z0-9_]+\.sql", name), name
        assert list(SQL) == sorted(SQL), "migrations must apply in filename order"

    def test_no_secret_shaped_literals(self):
        for shape in (r"\bsb_(secret|publishable)_", r"\beyJ[A-Za-z0-9_-]{10,}"):
            assert not re.search(shape, ALL_SQL)


class TestGateParity:
    def test_every_engine_gate_maps_into_the_enum(self):
        engine = engine_gate_names()
        assert engine == set(GATE_TO_VERDICT), (
            "GATE_TO_VERDICT out of step with risk_proxy's gates — "
            f"engine-only: {engine - set(GATE_TO_VERDICT)}, "
            f"map-only: {set(GATE_TO_VERDICT) - engine}"
        )

    def test_every_mapped_verdict_is_declared_in_the_sql_enum(self):
        enum_sql = SQL["20260808120000_desk_enums.sql"]
        body = enum_sql[enum_sql.index("create type public.order_verdict") :]
        declared = set(re.findall(r"'([A-Za-z_]+)'", body[: body.index(";")]))
        for label in list(GATE_TO_VERDICT.values()) + ["ACCEPTED"]:
            assert label in declared, f"enum missing {label}"

    def test_limit_defaults_mirror_config(self):
        tables = SQL["20260808120100_desk_tables.sql"]
        expectations = {
            "max_order_notional_usd": settings.max_order_notional_usd,
            "max_gross_exposure_usd": settings.max_gross_exposure_usd,
            "max_symbol_notional_usd": settings.max_symbol_notional_usd,
            "max_daily_drawdown_pct": settings.max_daily_drawdown_pct,
            "max_est_slippage_bps": settings.max_est_slippage_bps,
        }
        for column, expected in expectations.items():
            match = re.search(rf"{column}\s+numeric[^\n]*default\s+([0-9.]+)", tables)
            assert match, f"{column} has no DEFAULT in the migration"
            assert float(match.group(1)) == expected, (
                f"{column}: SQL default {match.group(1)} != config {expected} — "
                "change config.py and the migration in the same commit"
            )


class TestSecurityPosture:
    def test_every_security_definer_pins_search_path(self):
        for chunk in re.split(r"create or replace function", ALL_SQL, flags=re.I)[1:]:
            head = chunk[:600].lower()
            if "security definer" in head:
                assert "set search_path" in head, (
                    "SECURITY DEFINER without a pinned search_path is a "
                    "privilege-escalation footgun"
                )

    def test_rls_enabled_and_anon_denied(self):
        rls = SQL["20260808120200_rls_policies.sql"].lower()
        for table in ("desk_risk_limits", "order_blotter"):
            assert f"public.{table} enable row level security" in rls
            assert f"revoke all on public.{table} from anon" in rls
        assert "to anon" not in rls, "no policy may grant anon anything"

    def test_blotter_is_append_only_by_trigger(self):
        tables = SQL["20260808120100_desk_tables.sql"].lower()
        assert "before update or delete on public.order_blotter" in tables

    def test_provenance_column_and_idempotency_exist(self):
        tables = SQL["20260808120100_desk_tables.sql"]
        assert "decided_by public.desk_decider not null" in tables
        assert "unique_decider_order" in tables

    def test_the_sandbox_rpc_stamps_its_provenance(self):
        rpc = SQL["20260808120300_order_mirror_rpc.sql"]
        assert "'supabase_rpc'" in rpc, "the sandbox decider must label its rows"
        assert "'gateway'" in rpc, "the mirror path must label its rows"
        # The blueprint hardcoded latency_ms 0.19 — a fabricated measurement.
        # The RPC may only ever read latency from the payload it was handed.
        assert "0.19" not in rpc
