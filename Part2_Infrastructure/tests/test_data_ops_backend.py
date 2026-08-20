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


class TestTheSharedRowInterface:
    """Both backends answer the same five methods, or the setting is a lie.

    `ScheduleRunStore` used to subclass `SqliteStore`, which made SQLite not a
    choice but the definition of the class. These assert the interface both
    stores must satisfy, so a method added to one and forgotten on the other
    fails here rather than at runtime on whichever deployment opted in.
    """

    SHARED = ("migrate", "fetch", "fetch_one", "add", "patch", "remove", "close", "backend")

    def test_both_stores_answer_the_same_methods(self):
        from modules.data_ops_postgrest import PostgrestStore
        from modules.data_ops_store import SqliteStore

        for cls in (SqliteStore, PostgrestStore):
            missing = [name for name in self.SHARED if not hasattr(cls, name)]
            assert not missing, f"{cls.__name__} is missing {missing}"

    def test_the_schedule_store_reports_the_backend_it_was_given(self):
        from modules.data_jobs import ScheduleRunStore

        store = ScheduleRunStore(":memory:")
        assert store.backend == "sqlite"
        store.close()

    def test_a_round_trip_through_the_row_interface(self):
        from modules.data_jobs import ScheduleRunStore

        store = ScheduleRunStore(":memory:")
        assert store.last_run("nightly") is None
        store.record_run("nightly", 1_000.0, "job-1", "succeeded")
        first = store.last_run("nightly")
        assert first is not None and first["last_job_id"] == "job-1"

        # The upsert path: same key, new values, still one row.
        store.record_run("nightly", 2_000.0, "job-2", "failed")
        second = store.last_run("nightly")
        assert second is not None
        assert second["last_job_id"] == "job-2" and second["last_outcome"] == "failed"
        store.close()

    def test_an_identifier_that_is_not_one_is_refused(self):
        """The row interface interpolates table and column names; values bind."""
        from modules.data_ops_store import SqliteStore

        store = SqliteStore(":memory:")
        with pytest.raises(ValueError, match="not a bare SQL identifier"):
            store.fetch("data_work_items; DROP TABLE data_work_items")
        store.close()
