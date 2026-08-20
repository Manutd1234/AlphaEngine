"""A second writer on one ledger fails loudly instead of forking it.

``AuditStore._connect`` used to catch every exception out of ``duckdb.connect``
and fall back to SQLite at ``<db>.sqlite``. DuckDB reports a held file lock as
an ``IOException`` like any other IO error, so a second gateway process pointed
at the same ``DATA_DIR`` did not fail. It opened a private database at a
different path and began writing a divergent append-only history, while
``/health`` reported ``backend: sqlite`` as though that were a configuration
someone had chosen.

``modules/single_writer.py`` now takes a ``flock(2)`` claim in
``RiskGateway.start()``, which stops the gateway. This is the defence behind
it, because an ``AuditLog`` is opened on several paths that never go through
``RiskGateway.start()`` — the Telegram bot, the job runner, ``tools/`` and the
tests all build one directly.

Two things are asserted, and the split between them is the point: an
*unavailable* DuckDB still falls back, because that is what the fallback is
for, and a *held* DuckDB raises.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from modules.audit import AuditLedgerConflict, AuditLog
from modules.audit.store import AuditStore, _is_lock_conflict

#: The message DuckDB 1.x actually produces, recorded verbatim from a real
#: cross-process conflict. Pinned here because the detection reads the message:
#: if a DuckDB upgrade rewords it, this is what should go red.
REAL_CONFLICT_MESSAGE = (
    'IO Error: Could not set lock on file "/tmp/x/audit.duckdb": Conflicting '
    "lock is held in /usr/bin/python3.12 (PID 12419) by user ian. See also "
    "https://duckdb.org/docs/stable/connect/concurrency"
)

#: A holder that opens the database, says so, and waits to be killed.
_HOLDER = textwrap.dedent(
    """
    import sys, duckdb
    conn = duckdb.connect(sys.argv[1])
    conn.execute("CREATE TABLE IF NOT EXISTS held (a INTEGER)")
    print("held", flush=True)
    sys.stdin.readline()
    """
)


class TestTellingTheTwoFailuresApart:
    def test_a_held_lock_is_recognised(self):
        assert _is_lock_conflict(Exception(REAL_CONFLICT_MESSAGE)) is True

    @pytest.mark.parametrize(
        "message",
        [
            "IO Error: Cannot open file: no such file or directory",
            "IO Error: database file is corrupt",
            "Invalid Input Error: file is not a valid DuckDB database file",
            "No module named 'duckdb'",
        ],
    )
    def test_every_other_failure_is_not_a_conflict(self, message):
        """A corrupt file or a missing wheel must keep falling back."""
        assert _is_lock_conflict(Exception(message)) is False


class TestASecondWriterIsRefused:
    def test_a_live_holder_makes_the_second_open_raise(self, tmp_path):
        """The real thing: two processes, one file, no second ledger."""
        db = tmp_path / "audit.duckdb"
        holder = subprocess.Popen(  # noqa: S603 - literal argv, no shell
            [sys.executable, "-c", _HOLDER, str(db)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            assert holder.stdout.readline().strip() == "held", "the holder never opened the ledger"

            with pytest.raises(AuditLedgerConflict) as caught:
                AuditLog(db)

            assert "another live process" in str(caught.value)
            assert str(db) in str(caught.value), "the operator is not told which ledger"
            assert not Path(str(db.with_suffix(".sqlite"))).exists(), (
                "a second, divergent ledger was opened beside the held one — this "
                "is the exact fork the raise exists to prevent"
            )
        finally:
            holder.stdin.close()
            holder.wait(timeout=10)

    def test_the_ledger_opens_normally_once_the_holder_is_gone(self, tmp_path):
        """The refusal must be about the conflict, not about the path."""
        db = tmp_path / "audit.duckdb"
        holder = subprocess.Popen(  # noqa: S603 - literal argv, no shell
            [sys.executable, "-c", _HOLDER, str(db)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        holder.stdout.readline()
        holder.stdin.close()
        holder.wait(timeout=10)

        store = AuditLog(db)
        try:
            assert store.backend == "duckdb"
        finally:
            store.close()


class TestTheFallbackStillFallsBack:
    def test_an_unimportable_duckdb_still_reaches_sqlite(self, tmp_path, monkeypatch):
        """The legitimate case, unchanged: no DuckDB, no analytical SQL, no drama."""
        import builtins

        real_import = builtins.__import__

        def refuse_duckdb(name, *args, **kwargs):
            if name == "duckdb":
                raise ImportError("No module named 'duckdb'")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", refuse_duckdb)
        store = AuditLog(tmp_path / "nodb.duckdb")
        try:
            assert store.backend == "sqlite"
            assert store.health() == {"backend": "sqlite", "available": True}
        finally:
            store.close()

    def test_a_non_lock_io_error_still_reaches_sqlite(self, tmp_path, monkeypatch):
        import duckdb

        def broken(_path):
            raise duckdb.IOException("IO Error: database file is corrupt")

        monkeypatch.setattr(duckdb, "connect", broken)
        store = AuditLog(tmp_path / "corrupt.duckdb")
        try:
            assert store.backend == "sqlite"
        finally:
            store.close()

    def test_a_lock_conflict_never_reaches_sqlite(self, tmp_path, monkeypatch):
        """The same path, the same exception type, the opposite decision."""
        import duckdb

        def held(_path):
            raise duckdb.IOException(REAL_CONFLICT_MESSAGE)

        monkeypatch.setattr(duckdb, "connect", held)
        with pytest.raises(AuditLedgerConflict):
            AuditStore(tmp_path / "held.duckdb")
        assert not (tmp_path / "held.sqlite").exists()
