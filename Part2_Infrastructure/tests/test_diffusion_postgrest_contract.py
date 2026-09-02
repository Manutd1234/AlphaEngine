"""The Postgres Diffusion ledger matches the four backend-neutral stores.

These are source contracts, so CI can prove the PostgREST shape without a live
Supabase project.  The opt-in reachability test remains the deployment proof.
"""

import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
MIGRATION = REPO / "supabase/migrations/20260831120000_diffusion_postgrest_parity.sql"
SCOPE_GUARD = REPO / "supabase/migrations/20260831121000_data_ops_desk_scope_guard.sql"

EXPECTED_COLUMNS = {
    "diffusion_events": {
        "source_ref", "desk_id", "kind", "symbol", "title", "release_at",
        "release_at_source", "release_timing", "call_at", "call_at_source",
        "call_offset_min", "eps_estimate", "eps_actual", "surprise_pct",
        "scheduled", "statement_url", "first_seen_at", "last_seen_at",
        "revised_count", "verified_at",
    },
    "diffusion_runs": {
        "run_id", "desk_id", "source_ref", "symbol", "stage", "interval",
        "signal_state", "signal_reason", "terminal_return", "sigma_pre_per_bar",
        "pre_bars", "half_life_s", "half_life_state", "half_life_vol",
        "control_percentile", "controls_used", "measured_horizons", "of_horizons",
        "market_adjusted", "data_hash", "params_version", "t0_ms", "points_json",
        "computed_at",
    },
    "diffusion_texts": {
        "text_id", "desk_id", "source_ref", "stage", "source", "url", "state",
        "reason", "body", "sha256", "characters", "verified_release_time",
        "body_isolated", "vote_line", "first_seen_at", "fetched_at",
    },
    "diffusion_studies": {
        "study_id", "desk_id", "ran_at", "conditioning", "segment", "latent_dim",
        "events", "state", "verdict", "verdict_reason", "gate_state",
        "gate_r_squared", "gate_floor", "gate_fact", "gate_reason", "gate_samples",
        "effective_rank", "centroid_spread", "skill_meetings", "skill_baseline_r2",
        "skill_gain", "skill_shuffled_p", "skill_stage_minutes", "regressions_json",
    },
}


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _declared_columns(sql: str, table: str) -> set[str]:
    match = re.search(
        rf"create table if not exists public\.{table}\s*\((.*?)\n\);",
        sql,
        re.I | re.S,
    )
    assert match, f"{table} has no complete CREATE TABLE contract"
    columns: set[str] = set()
    for line in match.group(1).splitlines():
        token = line.strip().split(maxsplit=1)[0].rstrip(",") if line.strip() else ""
        if token and token not in {"constraint", "primary", "check", "unique", "foreign"}:
            columns.add(token)
    return columns


def test_all_four_relations_are_complete_and_desk_keyed():
    sql = _sql()
    for table, expected in EXPECTED_COLUMNS.items():
        assert _declared_columns(sql, table) == expected
        natural_key = {
            "diffusion_events": "source_ref",
            "diffusion_runs": "run_id",
            "diffusion_texts": "text_id",
            "diffusion_studies": "study_id",
        }[table]
        assert f"primary key (desk_id, {natural_key})" in sql
        assert f"alter table public.{table} enable row level security" in sql
        assert f"revoke all on public.{table} from anon, authenticated" in sql
    assert "notify pgrst, 'reload schema'" in sql


def test_stage_source_constraint_matches_the_domain_vocabulary():
    sql = _sql()
    current = "'vendor', 'issuer', 'estimated_offset', 'parsed_release', 'recorded'"
    successor = sql[sql.index("alter table public.diffusion_events\n    drop constraint"):]
    assert successor.count(current) == 2
    assert "fed_seed" not in re.sub(r"--.*", "", successor)
    assert successor.count("not valid") >= 2, "legacy authored rows must not block rollout"


def test_late_study_and_text_fields_are_present():
    sql = _sql()
    for field in (
        "vote_line", "skill_meetings", "skill_baseline_r2", "skill_gain",
        "skill_shuffled_p", "skill_stage_minutes",
    ):
        assert field in sql
    assert "alter table public.diffusion_texts\n    add column if not exists vote_line text" in sql


def test_existing_primary_keys_are_converted_atomically():
    sql = _sql()
    for table, natural_key in {
        "diffusion_events": "source_ref",
        "diffusion_runs": "run_id",
        "diffusion_texts": "text_id",
        "diffusion_studies": "study_id",
    }.items():
        conversion = (
            f"alter table public.{table}\n"
            f"    drop constraint if exists {table}_pkey,\n"
            f"    add constraint {table}_pkey primary key (desk_id, {natural_key})"
        )
        assert conversion in sql


def test_scope_guard_locks_out_legacy_writers_then_refuses_all_default_ownership():
    sql = SCOPE_GUARD.read_text(encoding="utf-8")
    tables = [
        "data_quality_findings", "data_quality_escalations", "data_schedule_runs",
        "data_work_items", *EXPECTED_COLUMNS,
    ]
    for table in tables:
        assert f"'{table}'" in sql
        assert f"public.{table}" in sql[sql.index("lock table"):sql.index("in access exclusive mode")]
        assert f"alter table public.{table} alter column desk_id drop default" in sql
        constraint = f"{table}_desk_id_not_default"
        assert f"drop constraint if exists {constraint}" in sql
        assert f"add constraint {constraint} check (desk_id <> 'default')" in sql
    assert "raise exception" in sql
    assert "SUPABASE_DESK_ID" in sql
    statements = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )
    assert re.search(r"^\s*begin\s*;", statements, re.I | re.M)
    assert re.search(r"^\s*commit\s*;", statements, re.I | re.M)
    assert statements.index("begin;") < statements.index("lock table")
    assert statements.rindex("commit;") > statements.index("notify pgrst")
    assert sql.index("lock table") < sql.index("select count(*)")
