"""One process owns the mutable book, and now something enforces it.

The gateway is single-process by design. The position book, the resting-order
book, the token bucket and the kill switch are plain Python objects on the heap,
mutated under one `asyncio.Lock`, and read on the sub-millisecond order path.
`docker/gateway.Dockerfile` says so in a comment and
`tests/test_container_contract.py` fails the build if `--workers` or `gunicorn`
appears in it.

What that arrangement did NOT have was anything that noticed the rule being
broken. The contract test reads the committed image definition; it cannot see
`uvicorn main:app --workers 4` typed at a shell, `docker compose up
--scale gateway=2`, or a second container pointed at the same named volume.
Each of those produces a second gateway with its own book, and the failures are
silent and expensive in a specific order:

  * The **kill switch** is local. A halt lands on whichever process served the
    request; the other keeps accepting. This is the one that matters, because
    the halt is the last line of defence and it is the one an operator most
    believes in.
  * The **token bucket** is per process, so N workers permit N × the configured
    rate — the exact pattern the bucket exists to keep off an exchange's ban
    list.
  * The **position book** is per process, so every notional, gross-exposure and
    drawdown check is computed against a fraction of the real position. Limits
    do not merely drift; they are systematically too permissive.
  * The **audit log** hides all of it. `AuditLog._connect` catches every
    exception from `duckdb.connect` — including DuckDB's own "Conflicting lock
    is held" — and falls back to a SQLite file at a *different path*. So the
    second process does not fail: it quietly writes a private, divergent
    history, and `/health` reports `backend: sqlite` to nobody in particular.

Hence this module. It is a POSIX advisory lock on one file in `DATA_DIR`, taken
when the gateway starts and held for the life of the process.

── What this does and does not close ─────────────────────────────────────────

It does not make the gateway multi-process. Nothing here shares a book, and the
boundary in `tests/test_container_contract.py` stays exactly as true as it was.
What changes is the failure mode: a second writer on the same state directory
now refuses to start and says why, instead of running a shadow desk.

That distinction is the whole value, and overstating it would be worse than not
shipping it.

── Why flock, and why not a lock row in Postgres ──────────────────────────────

`flock(2)` is released by the kernel when the holding process dies, by any
route including SIGKILL and OOM. There is therefore no stale lock, no lease to
renew and no timeout to tune — the three things that make a hand-rolled lock
file worse than no lock at all. A PID written into a file and checked on
startup gets all three wrong.

A row in Postgres (or `pg_advisory_lock`) would additionally guard two
gateways on two *hosts* sharing one database, which this does not. It was not
chosen because it would make a network round trip a precondition of booting the
risk gateway, and a gateway that will not start when the mirror is unreachable
is a worse trade than one that will not start twice on the same volume. The
co-hosted case is the one this deployment actually has: the compose file mounts
a single named volume, and `--scale gateway=2` is a plausible typo.

── Fail-closed on conflict, fail-open on "cannot lock" ────────────────────────

An observed conflict is proof that a second writer exists, so it raises. A
filesystem that cannot do advisory locks at all is not evidence of anything, so
it logs and continues: refusing to boot over an unsupported syscall would turn
a working single-process deployment into an outage in exchange for no
information. `status()` reports which of the two happened, so "unenforced" is
visible rather than assumed.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("alphaengine.single_writer")

#: Name of the lock file inside DATA_DIR. Deliberately not the audit database:
#: locking that would race the audit layer's own handle, and the claim needs to
#: outlive any one store.
LOCK_FILENAME = "gateway.writer.lock"


class SingleWriterConflict(RuntimeError):
    """Another live process already owns this state directory.

    Raised, not logged. The point is that the second gateway does not reach the
    part of startup where it would begin accepting orders against a book the
    first one is also mutating.
    """


class _Claim:
    """The held lock: an open descriptor and what we know about the holder."""

    def __init__(self, path: Path, handle: Any, enforced: bool, detail: str) -> None:
        self.path = path
        self.handle = handle
        self.enforced = enforced
        self.detail = detail


class SingleWriterClaim:
    """One process's claim on one state directory, and what it can honestly say.

    Was a module-level `_Claim | None` rebound under `global` by `claim()` and
    `release()`, and read by `status()` — an accidental singleton. The `_Claim`
    class existed but held only the descriptor; the ownership rules lived in
    three module functions over one hidden name.

    **The defect this class prevents.** The claim is process-wide, so a test
    that inherited one tested nothing: `claim()` short-circuits on the guard
    below and hands back the PREVIOUS holder's status — a different path, very
    possibly `enforced: True` for a `tmp_path` that has since been deleted —
    without a word. `tests/test_single_writer.py` had to carry an autouse
    fixture calling `release()` on the way IN as well as out to survive that,
    and its docstring says why. A cleanup verb that exists only because the
    state is global is a class that has not been written yet.

    **The middle state becomes reachable without a monkeypatch.** `enforced:
    False` — "we asked and the filesystem would not promise" — is the reason
    `status()` returns a dict rather than a bool, and the only way to reach it
    was `monkeypatch.setattr(single_writer, "_flock", ...)`, a module attribute
    every other test in the process shares. Injecting `flock` puts that branch
    in the constructor.

    Both seams are LATE-BOUND when not injected: an instance built with no
    arguments looks `_flock` and `lock_path` up on the module at call time, so
    the existing `monkeypatch.setattr` on either name still reaches the
    process-wide claim. Injection is the better seam; it is not the only one.

    There is deliberately no module-level alias to `self.held`. `release()`
    rebinds it to None, and a name bound at import time would freeze at its
    initial value and report "not claimed" for ever — the same trap
    `modules/metrics/__init__` documents for its two scalars. Nothing
    re-exports this state by object, which is why rebinding here is safe;
    that was checked before the attribute was allowed to be rebound at all.
    """

    def __init__(self, *, flock=None, resolve_path=None) -> None:
        self._flock = flock
        self._resolve_path = resolve_path
        #: The live claim, or None. `flock` treats two descriptors on one file
        #: as independent even within a single process, so a second `claim()`
        #: without this guard would deadlock against ourselves. Reclaiming is a
        #: no-op by design: `RiskGateway.start` may run more than once in a
        #: test process.
        self.held: _Claim | None = None

    def _take_lock(self, handle: Any) -> tuple[bool, str]:
        return (self._flock if self._flock is not None else _flock)(handle)

    def _path_for(self, data_dir: Path | str | None) -> Path:
        return (self._resolve_path if self._resolve_path is not None else lock_path)(data_dir)

    def claim(self, data_dir: Path | str | None = None) -> dict[str, Any]:
        """Take the claim for this state directory. Idempotent within the instance."""
        if self.held is not None:
            return self.status()

        path = self._path_for(data_dir)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = path.open("a+")
        except OSError as exc:
            # An unwritable DATA_DIR is a real problem, but it is not this
            # module's problem to be fatal about: config.ensure_dirs and the
            # audit layer both meet it first and report it in terms an operator
            # can act on.
            log.warning("single-writer claim skipped: %s (%s)", path.parent, exc.__class__.__name__)
            self.held = _Claim(path, None, False, "state directory is not writable")
            return self.status()

        enforced, detail = self._take_lock(handle)
        self.held = _Claim(path, handle, enforced, detail)
        _describe(handle)
        if enforced:
            log.info("single-writer claim held on %s (pid %d)", path.name, os.getpid())
        else:
            log.warning("single-writer claim NOT enforced: %s", detail)
        return self.status()

    def release(self) -> None:
        """Drop the claim. Rarely needed: process exit releases it either way."""
        if self.held is None:
            return
        handle, self.held = self.held.handle, None
        if handle is None:
            return
        try:
            handle.close()  # closing the descriptor releases the flock
        except OSError:
            log.debug("single-writer claim close failed", exc_info=True)

    def status(self) -> dict[str, Any]:
        """What this instance can honestly say about its exclusivity.

        Three states, and the middle one is the reason this returns a dict
        rather than a bool: `held=True, enforced=False` means "we asked, and the
        filesystem would not promise" — which is neither safety nor a conflict,
        and reads as a lie in either direction if flattened.
        """
        if self.held is None:
            return {"held": False, "enforced": False, "detail": "not claimed"}
        return {"held": True, "enforced": self.held.enforced, "detail": self.held.detail}


#: The process-wide claim. One instance, not a hidden module name, so a test can
#: build its own without releasing the one `RiskGateway.start` is holding.
_default = SingleWriterClaim()


def lock_path(data_dir: Path | str | None = None) -> Path:
    """Where the claim lives for a given state directory.

    Scoped to `DATA_DIR` rather than being a global singleton path, because two
    gateways with two state directories are two independent desks and there is
    nothing wrong with running them. What must not happen is two processes on
    ONE book, and the book is what `DATA_DIR` contains.
    """
    if data_dir is None:
        from config import settings

        data_dir = settings.data_dir
    return Path(data_dir) / LOCK_FILENAME


def _flock(handle: Any) -> tuple[bool, str]:
    """Try for the exclusive lock. Returns (enforced, detail); raises on conflict."""
    try:
        import fcntl
    except ImportError:  # pragma: no cover - POSIX in every deployment target
        return False, "advisory locking unavailable on this platform"
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise SingleWriterConflict(
            "another gateway process already holds this state directory. The "
            "risk gateway keeps its position book, resting orders, token bucket "
            "and kill switch in memory, so a second process would fork the book "
            "and localise the halt. Give this instance its own DATA_DIR, or stop "
            "the other one."
        ) from exc
    except OSError as exc:
        # Not a conflict — the filesystem cannot do this. Say so and carry on.
        return False, f"advisory locking refused by the filesystem ({exc.__class__.__name__})"
    return True, "exclusive advisory lock held"


def claim(data_dir: Path | str | None = None) -> dict[str, Any]:
    """Take the single-writer claim for this state directory.

    Idempotent within a process and never re-entrant across descriptors. Raises
    `SingleWriterConflict` when a *different* live process holds it.
    """
    return _default.claim(data_dir)


def _describe(handle: Any) -> None:
    """Record who holds it, for a human reading the volume.

    Advisory only and never read back as truth — the lock itself is the truth,
    and a PID in a file is exactly the stale-state trap flock exists to avoid.
    Truncated and rewritten so the file does not grow across restarts.
    """
    try:
        handle.seek(0)
        handle.truncate()
        handle.write(f"pid={os.getpid()}\n")
        handle.flush()
    except OSError:  # a lock that cannot annotate itself is still a lock
        log.debug("single-writer claim could not write its holder note", exc_info=True)


def release() -> None:
    """Drop the process-wide claim. Process exit releases it either way."""
    _default.release()


def status() -> dict[str, Any]:
    """What this process can honestly say about its exclusivity."""
    return _default.status()
