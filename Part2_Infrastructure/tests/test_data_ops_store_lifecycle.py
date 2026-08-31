"""The SQLite store under contention, and after close.

CI failed once with ``sqlite3.OperationalError: database is locked`` raised
from ``PRAGMA journal_mode=WAL`` — the first statement on a fresh connection —
while ``tests/test_api.py`` was rendering the console. Nothing in that test
opened the store on purpose. Something on the request path asked for the
shared store; the autouse fixture had dropped the previous test's store
WITHOUT closing it (a deliberate choice at the time — see conftest); and the
leaked handle from the test before was being closed by the garbage collector
on another thread. The last connection to close a WAL database checkpoints it
and deletes the WAL and shm files under an exclusive lock. A fresh connection
arriving in that window is told the database is locked, and Python's default
busy timeout gave it five seconds of patience — which a loaded runner can
exceed, once in a few hundred runs, in the one job that gates the push.

What follows pins each half of the fix:

- a fresh connection has the exact thirty-second storage lock budget — HTTP
  request deadlines live at the bounded runtime layer and do not silently
  rewrite the database contract;
- two connections opening one file at the same INSTANT are serialised, because
  that race SQLite answers at once rather than waiting out, and the shared
  store is built exactly once however many threads ask first;
- a closed file-backed store reopens on its next use, so the fixture can
  close the shared store at teardown without taking the handle out from under
  a module-scoped fixture (the hazard that had ruled closing out);
- the suite itself: every test opens its own file, and the process's shared
  store is the one at that file.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

import pytest

from modules.data_ops_store import BUSY_TIMEOUT_S, SqliteStore, open_data_ops_db

DDL = ["CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY, note TEXT NOT NULL)"]


def _hold_write_lock(store: SqliteStore, held: threading.Event, release: threading.Event) -> threading.Thread:
    """A writer on another thread that opens a transaction and sits in it."""

    def run() -> None:
        with store.transaction() as conn:
            conn.execute("INSERT INTO rows (note) VALUES ('held')")
            held.set()
            release.wait(timeout=10)

    thread = threading.Thread(target=run, name="lock-holder", daemon=True)
    thread.start()
    return thread


class TestBusyTimeout:
    def test_a_fresh_connection_has_the_exact_thirty_second_lock_budget(self, tmp_path):
        assert BUSY_TIMEOUT_S == 30.0
        conn = open_data_ops_db(tmp_path / "store.sqlite")
        try:
            assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30_000
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
            assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        finally:
            conn.close()

    def test_in_memory_stores_keep_the_timeout_and_skip_wal(self):
        conn = open_data_ops_db(":memory:")
        try:
            assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30_000
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "memory"
            assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
            assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        finally:
            conn.close()

    def test_an_explicit_timeout_is_not_capped_below_the_requested_contract(self, tmp_path):
        conn = open_data_ops_db(tmp_path / "uncapped.sqlite", busy_timeout_s=30.5)
        try:
            assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30_500
        finally:
            conn.close()

    def test_a_connection_is_closed_when_pragma_configuration_fails(self, tmp_path, monkeypatch):
        class BrokenConnection:
            row_factory = None
            closed = False

            def execute(self, _statement):
                raise sqlite3.OperationalError("pragma setup failed")

            def close(self):
                self.closed = True

        broken = BrokenConnection()
        monkeypatch.setattr(sqlite3, "connect", lambda *_args, **_kwargs: broken)

        with pytest.raises(sqlite3.OperationalError, match="pragma setup failed"):
            open_data_ops_db(tmp_path / "broken.sqlite")

        assert broken.closed is True

    def test_opening_contends_with_an_exclusive_holder_and_the_timeout_is_what_saves_it(self, tmp_path):
        """The CI line, reproduced: ``PRAGMA journal_mode=WAL`` on a fresh
        connection while another connection holds the file exclusively.

        An ordinary writer is not enough to reproduce it — WAL readers do not
        wait for writers, and the pragma on an already-WAL file is a read. The
        lock the flake met is the EXCLUSIVE one: the lock the last connection
        takes to checkpoint and delete the WAL as it closes, which is what the
        garbage collector was doing to the previous test's leaked handle. A
        connection in ``locking_mode=EXCLUSIVE`` holds exactly that lock for
        as long as this test wants it held.

        The negative control comes first and is the whole point. With no busy
        timeout the open raises ``database is locked`` at once — proof that
        this is the contention, so the bounded wait in
        ``open_data_ops_db`` is load-bearing and not a number copied into the
        call for comfort.
        """
        path = tmp_path / "store.sqlite"
        with SqliteStore(path) as seed:
            seed.migrate(DDL)
            seed.add("rows", {"note": "seeded"})

        holder = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
        holder.execute("PRAGMA locking_mode=EXCLUSIVE")
        holder.execute("BEGIN IMMEDIATE")
        holder.execute("INSERT INTO rows (note) VALUES ('held')")

        def let_go() -> None:
            holder.execute("COMMIT")
            holder.close()

        released = threading.Timer(0.5, let_go)
        try:
            impatient = sqlite3.connect(str(path), timeout=0, isolation_level=None)
            try:
                with pytest.raises(sqlite3.OperationalError, match="locked"):
                    impatient.execute("PRAGMA journal_mode=WAL")
            finally:
                impatient.close()

            # The real open, racing the holder: it must wait, not raise. The
            # holder lets go after a beat — well inside the timeout and well
            # outside "immediately", which is what the elapsed check pins.
            released.start()
            started = time.monotonic()
            with SqliteStore(path) as late:
                waited = time.monotonic() - started
                assert waited >= 0.3, f"the open did not wait for the holder ({waited:.2f}s)"
                assert late.count("rows") == 2
        finally:
            released.join(timeout=5)

    def test_lock_timeout_fails_in_a_bounded_window_without_retrying(self, tmp_path):
        path = tmp_path / "bounded.sqlite"
        holder = open_data_ops_db(path)
        holder.execute("CREATE TABLE rows (id INTEGER PRIMARY KEY)")
        holder.execute("BEGIN IMMEDIATE")
        contender = open_data_ops_db(path, busy_timeout_s=0.05)
        started = time.monotonic()
        try:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                contender.execute("INSERT INTO rows DEFAULT VALUES")
            assert 0.04 <= time.monotonic() - started < 0.3
        finally:
            holder.execute("ROLLBACK")
            contender.close()
            holder.close()

    def test_two_writers_on_one_file_both_land(self, tmp_path):
        path = tmp_path / "store.sqlite"
        first, second = SqliteStore(path), SqliteStore(path)
        first.migrate(DDL)
        held, release = threading.Event(), threading.Event()
        holder = _hold_write_lock(first, held, release)
        assert held.wait(timeout=5)
        try:
            threading.Timer(0.3, release.set).start()
            second.add("rows", {"note": "waited"})
            assert sorted(r["note"] for r in second.fetch("rows")) == ["held", "waited"]
        finally:
            release.set()
            holder.join(timeout=5)
            first.close()
            second.close()

    def test_wal_reader_sees_last_commit_while_another_connection_writes(self, tmp_path):
        path = tmp_path / "reader-writer.sqlite"
        writer, reader = SqliteStore(path), SqliteStore(path)
        writer.migrate(DDL)
        writer.add("rows", {"note": "committed"})
        try:
            with writer.transaction() as conn:
                conn.execute("INSERT INTO rows (note) VALUES ('pending')")
                assert reader.count("rows") == 1
            assert reader.count("rows") == 2
        finally:
            writer.close()
            reader.close()

    def test_uncommitted_write_is_rolled_back_after_connection_loss(self, tmp_path):
        path = tmp_path / "crash.sqlite"
        conn = open_data_ops_db(path)
        conn.execute("CREATE TABLE rows (id INTEGER PRIMARY KEY)")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT INTO rows DEFAULT VALUES")
        conn.close()  # models a process losing its session before COMMIT

        reopened = open_data_ops_db(path)
        try:
            assert reopened.execute("SELECT COUNT(*) FROM rows").fetchone()[0] == 0
        finally:
            reopened.close()

    def test_corrupt_file_is_signalled_instead_of_selecting_a_fallback(self, tmp_path):
        path = tmp_path / "corrupt.sqlite"
        path.write_bytes(b"not a sqlite database")
        with pytest.raises(sqlite3.DatabaseError, match="database"):
            open_data_ops_db(path)


class TestCloseAndReopen:
    def test_a_closed_file_store_reopens_on_its_next_use(self, tmp_path):
        store = SqliteStore(tmp_path / "store.sqlite")
        store.migrate(DDL)
        store.add("rows", {"note": "before"})
        store.close()
        assert store.closed
        # Every entry point, not just one: the reopen lives in the one
        # accessor they all go through, and this is the check that they do.
        assert store.count("rows") == 1
        assert not store.closed
        store.close()
        store.add("rows", {"note": "after"})
        store.close()
        store.executemany("INSERT INTO rows (note) VALUES (?)", [("many",)])
        store.close()
        with store.transaction() as conn:
            conn.execute("INSERT INTO rows (note) VALUES ('txn')")
        assert [r["note"] for r in store.fetch("rows", order="id.asc")] == ["before", "after", "many", "txn"]
        store.close()

    def test_close_is_idempotent(self, tmp_path):
        store = SqliteStore(tmp_path / "store.sqlite")
        store.close()
        store.close()
        assert store.closed

    def test_a_close_failure_cannot_leave_the_poisoned_handle_attached(self):
        class CloseFails:
            def close(self):
                raise sqlite3.OperationalError("close failed")

        store = SqliteStore(":memory:")
        assert store._conn is not None
        store._conn.close()
        store._conn = CloseFails()

        with pytest.raises(sqlite3.OperationalError, match="close failed"):
            store.close()

        assert store.closed
        store.close()

    def test_an_in_memory_store_stays_closed(self):
        """Reopening ``:memory:`` would be an empty database wearing the old
        name — tables gone, rows gone, and a caller none the wiser."""
        store = SqliteStore(":memory:")
        store.migrate(DDL)
        store.close()
        with pytest.raises(sqlite3.ProgrammingError, match="closed database"):
            store.count("rows")
        assert store.closed

    def test_the_store_is_a_context_manager(self, tmp_path):
        with SqliteStore(tmp_path / "store.sqlite") as store:
            store.migrate(DDL)
            assert not store.closed
        assert store.closed

    def test_close_runs_a_passive_checkpoint_and_keeps_telemetry(self, tmp_path):
        store = SqliteStore(tmp_path / "checkpoint.sqlite")
        store.migrate(DDL)
        store.add("rows", {"note": "written"})
        before = store.sqlite_status()
        assert before["checkpoint_total"] == 0

        store.close()

        after = store.sqlite_status()
        assert after["checkpoint_total"] == 1
        assert after["last_checkpoint_duration_ms"] >= 0
        assert after["last_checkpoint_error"] is None

    def test_a_failed_begin_releases_the_lock(self, tmp_path):
        """A ``BEGIN IMMEDIATE`` that raises must not leave the store's lock
        held, or the next caller on any thread blocks forever with no error
        to say why."""
        store = SqliteStore(":memory:")
        store.close()
        with pytest.raises(sqlite3.ProgrammingError):
            with store.transaction():
                pass
        assert store._lock.acquire(timeout=1), "the lock was left held after BEGIN failed"
        store._lock.release()

    def test_a_failed_commit_rolls_back_before_the_connection_is_reused(self):
        class FailedCommit:
            def __init__(self):
                self.calls = []

            def execute(self, statement):
                self.calls.append(statement)
                if statement == "COMMIT":
                    raise sqlite3.OperationalError("commit failed")

            def close(self):
                pass

        store = SqliteStore(":memory:")
        assert store._conn is not None
        store._conn.close()
        failed = FailedCommit()
        store._conn = failed

        with pytest.raises(sqlite3.OperationalError, match="commit failed"):
            with store.transaction():
                pass

        assert failed.calls == ["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"]
        assert store._lock.acquire(timeout=1), "the lock was left held after COMMIT failed"
        store._lock.release()

    def test_a_connection_is_discarded_when_commit_and_rollback_both_fail(self):
        class PoisonedConnection:
            def __init__(self):
                self.closed = False

            def execute(self, statement):
                if statement in {"COMMIT", "ROLLBACK"}:
                    raise sqlite3.OperationalError(f"{statement.lower()} failed")

            def close(self):
                self.closed = True

        store = SqliteStore(":memory:")
        assert store._conn is not None
        store._conn.close()
        poisoned = PoisonedConnection()
        store._conn = poisoned

        with pytest.raises(sqlite3.OperationalError, match="commit failed"):
            with store.transaction():
                pass

        assert poisoned.closed is True
        assert store._conn is None


class TestTheSuiteIsolatesEachTest:
    def test_bootstrap_overrides_exported_audit_database_paths(self):
        source = Path(__file__).with_name("conftest.py").read_text(encoding="utf-8")
        assert 'os.environ["DATA_DIR"] = str(_TMP)' in source
        assert 'os.environ["DB_PATH"] = str(_TMP / "test.duckdb")' in source
        assert 'setdefault("DATA_DIR"' not in source
        assert 'setdefault("DB_PATH"' not in source

    def test_every_test_opens_its_own_file(self, tmp_path):
        from config import settings
        from modules.data_ops_backend import get_data_ops_store

        assert settings.data_ops_db_path == tmp_path / "data_ops.sqlite"
        store = get_data_ops_store()
        assert isinstance(store, SqliteStore)
        assert Path(store.path) == tmp_path / "data_ops.sqlite"
        assert store is get_data_ops_store()

    def test_the_shared_store_is_file_backed_not_memory(self):
        """``:memory:`` would also isolate tests — and would also mean the
        route tests never exercised the WAL open the flake came from."""
        from modules.data_ops_backend import get_data_ops_store

        store = get_data_ops_store()
        assert store.path != ":memory:"
        assert store.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
