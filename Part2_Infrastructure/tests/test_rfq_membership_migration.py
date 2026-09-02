"""Offline contract for automatic RFQ membership provisioning.

The private venue read remains authenticated, but every Supabase Auth account
must be provisioned without an email-specific operator query.  These tests pin
the backfill, future-user trigger, least-privilege function, and deployment-time
completeness assertion together so a partial implementation cannot look done.
"""

from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parent.parent.parent
    / "supabase"
    / "migrations"
    / "20260902090000_rfq_membership_for_all_authenticated_users.sql"
)
SQL = MIGRATION.read_text(encoding="utf-8").lower()


def test_existing_accounts_are_backfilled_by_auth_user_id():
    assert "from auth.users as auth_user" in SQL
    assert "auth_user.id" in SQL
    assert "from auth.users as auth_user" in SQL
    assert "on conflict on constraint unique_desk_user_symbol" in SQL
    assert "is_active = true" in SQL
    assert "00000000-0000-0000-0000-000000000001" in SQL


def test_future_accounts_are_provisioned_after_signup():
    assert "after insert on auth.users" in SQL
    assert "for each row execute function public.provision_default_rfq_desk_membership()" in SQL
    assert "new.id" in SQL
    assert "'paper_only'::public.desk_authority" in SQL


def test_trigger_function_is_privileged_but_not_browser_callable():
    assert "security definer" in SQL
    assert "set search_path = ''" in SQL
    signature = "function public.provision_default_rfq_desk_membership()"
    for role in ("public", "anon", "authenticated"):
        assert f"revoke execute on {signature} from {role}" in SQL


def test_migration_fails_if_any_existing_account_remains_unprovisioned():
    assert "where not exists" in SQL
    assert "membership.user_id = auth_user.id" in SQL
    assert "membership.is_active = true" in SQL
    assert "raise exception 'rfq desk membership backfill is incomplete'" in SQL
