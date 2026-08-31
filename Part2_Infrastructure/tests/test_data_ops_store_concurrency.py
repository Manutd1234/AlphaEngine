"""SQLite first-open and shared-store contention regressions."""

from __future__ import annotations

import threading
from pathlib import Path

from modules.data_ops_store import open_data_ops_db


class TestConcurrentOpens:
    """The open lock covers races that SQLite's busy handler does not wait out."""

    THREADS = 6
    TRIALS = 40

    def test_racing_first_opens_of_one_file_all_succeed(self, tmp_path):
        errors: list[str] = []

        def open_once(path: Path, barrier: threading.Barrier, trial: int) -> None:
            barrier.wait(timeout=10)
            try:
                conn = open_data_ops_db(path)
                try:
                    conn.execute("CREATE TABLE IF NOT EXISTS t (x)")
                finally:
                    conn.close()
            except Exception as exc:  # noqa: BLE001 - the point is to count every failure
                errors.append(f"trial {trial}: {exc!r}")

        for trial in range(self.TRIALS):
            path = tmp_path / f"race-{trial}.sqlite"
            barrier = threading.Barrier(self.THREADS)
            threads = [
                threading.Thread(target=open_once, args=(path, barrier, trial), name=f"open-{i}")
                for i in range(self.THREADS)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)
        assert errors == [], errors

    def test_the_shared_store_is_built_once_under_contention(self):
        from modules.data_ops_backend import get_data_ops_store, reset_data_ops_store

        reset_data_ops_store()
        built: list[object] = []
        barrier = threading.Barrier(8)

        def run() -> None:
            barrier.wait(timeout=10)
            built.append(get_data_ops_store())

        threads = [threading.Thread(target=run, name=f"build-{i}") for i in range(8)]
        try:
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)
            assert len(built) == 8
            assert all(store is built[0] for store in built), "two threads built two stores"
        finally:
            reset_data_ops_store()
