"""Choosing the data-operations backend, including the ways it must refuse.

The interesting cases are not "sqlite works". They are the two that would give
a deployment a false belief about where its durable state lives: a typo in
DATA_OPS_BACKEND, and `postgres` selected with no credentials to reach it.
Both must raise. A fall-back to SQLite in either case produces a gateway that
reports one backend and uses another, and nothing downstream would catch it.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from modules.data_ops_store import SqliteStore, open_data_ops_store


def _settings(**over):
    base = {
        "data_ops_backend": "sqlite",
        "data_ops_db_path": Path(":memory:"),
        "supabase_url": "",
        "supabase_service_role_key": "",
    }
    base.update(over)
    return SimpleNamespace(**base)


def test_sqlite_is_the_default_and_says_so():
    store = open_data_ops_store(_settings())
    assert isinstance(store, SqliteStore)
    assert store.backend == "sqlite"
    store.close()


def test_postgres_without_credentials_refuses_rather_than_falling_back():
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        open_data_ops_store(_settings(data_ops_backend="postgres"))


def test_a_typo_is_refused_rather_than_defaulted():
    with pytest.raises(ValueError, match="unknown DATA_OPS_BACKEND"):
        open_data_ops_store(_settings(data_ops_backend="postgress"))


def test_postgres_with_credentials_builds_the_postgrest_store():
    from modules.data_ops_postgrest import PostgrestStore

    store = open_data_ops_store(_settings(
        data_ops_backend="postgres",
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-key",
    ))
    assert isinstance(store, PostgrestStore)
    assert store.backend == "postgres"
    store.close()


def test_both_backends_report_a_backend_name():
    """Anything reporting `backend` on the wire reads this attribute."""
    sqlite = open_data_ops_store(_settings())
    assert sqlite.backend in {"sqlite", "postgres"}
    sqlite.close()
