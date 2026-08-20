"""The single-writer claim: the half of "one gateway process" that is enforceable.

`tests/test_container_contract.py` reads the committed image definition and
fails the build on `--workers`. That is a true statement about a file, and it
was the only statement anything made: nothing noticed `docker compose up
--scale gateway=2`, a second container on the same named volume, or a uvicorn
started by hand with workers. Each of those forks the position book and
localises the kill switch, and — because `AuditLog._connect` treats DuckDB's
"conflicting lock is held" the same as "DuckDB is not installed" — the second
process writes a private SQLite history instead of failing.

So these tests are about the failure MODE, not about scale. Nothing here makes
the gateway multi-process. What they pin is that a second writer on one state
directory stops, loudly, at the point where it would otherwise have started
accepting orders against a book somebody else owns.
"""

from __future__ import annotations

import fcntl
import subprocess
import sys
from pathlib import Path

import pytest

from modules import single_writer
from modules.single_writer import SingleWriterConflict, claim, lock_path, release, status

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _unclaimed():
    """The claim is process-wide, so a test that inherits one tests nothing.

    Released on the way in as well as out: `RiskGateway.start()` takes the claim
    for the whole pytest process, and whichever suite ran first would otherwise
    decide what these see.
    """
    release()
    yield
    release()


def _hold_from_elsewhere(path: Path):
    """A descriptor standing in for the other process's.

    `flock` locks the open file description, not the process, so a second
    descriptor conflicts with the first even here — which is what makes this a
    faithful stand-in rather than a mock. The real cross-process case is pinned
    below with an actual subprocess; this is the fast one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle


class TestTheClaim:
    def test_a_free_state_directory_is_claimed_and_enforced(self, tmp_path):
        state = claim(tmp_path)
        assert state["held"] is True
        assert state["enforced"] is True, "an unenforced claim protects nothing"
        assert lock_path(tmp_path).exists()

    def test_claiming_twice_in_one_process_is_a_no_op_not_a_deadlock(self, tmp_path):
        """`flock` would deny our own second descriptor, so the guard is required."""
        first = claim(tmp_path)
        second = claim(tmp_path)
        assert first == second

    def test_a_second_writer_is_refused_and_told_why(self, tmp_path):
        holder = _hold_from_elsewhere(lock_path(tmp_path))
        try:
            with pytest.raises(SingleWriterConflict) as raised:
                claim(tmp_path)
            message = str(raised.value)
            assert "position book" in message and "kill switch" in message, (
                "a refusal that does not say what would have broken gets "
                "worked around rather than understood"
            )
            assert "DATA_DIR" in message, "the refusal must name the way out"
        finally:
            holder.close()

    def test_two_state_directories_are_two_desks_and_both_may_run(self, tmp_path):
        """The claim is scoped to DATA_DIR because the book is what DATA_DIR holds."""
        holder = _hold_from_elsewhere(lock_path(tmp_path / "one"))
        try:
            assert claim(tmp_path / "two")["enforced"] is True
        finally:
            holder.close()

    def test_release_hands_the_directory_back(self, tmp_path):
        claim(tmp_path)
        release()
        assert status()["held"] is False
        assert claim(tmp_path)["enforced"] is True

    def test_an_unwritable_state_directory_is_not_this_module_s_error_to_raise(self, tmp_path):
        """`config.ensure_dirs` and the audit layer both meet this first, and
        report it in terms an operator can act on. Refusing here would replace
        their message with a worse one."""
        blocked = tmp_path / "denied"
        blocked.mkdir()
        blocked.chmod(0o500)
        try:
            state = claim(blocked)
        finally:
            blocked.chmod(0o700)
        assert state["held"] is True
        assert state["enforced"] is False, "a claim we could not take must not report as taken"


class TestWhatItReportsAboutItself:
    def test_the_three_states_are_kept_apart(self, tmp_path):
        assert status() == {"held": False, "enforced": False, "detail": "not claimed"}
        claim(tmp_path)
        held = status()
        assert (held["held"], held["enforced"]) == (True, True)
        assert held["detail"], "an enforced claim still has to say what it is"

    def test_unenforced_is_neither_safety_nor_a_conflict(self, tmp_path, monkeypatch):
        """The middle state is why this returns a dict rather than a bool.

        "We asked and the filesystem would not promise" flattens into a lie in
        either direction — a False reads as a conflict, a True as protection.
        """
        monkeypatch.setattr(single_writer, "_flock", lambda _h: (False, "filesystem said no"))
        state = claim(tmp_path)
        assert state["held"] is True and state["enforced"] is False
        assert state["detail"] == "filesystem said no"

    def test_the_holder_note_is_advisory_and_never_read_back(self, tmp_path):
        """A PID in a file is the stale-lock trap `flock` exists to avoid, so it
        is written for a human reading the volume and trusted by nothing."""
        claim(tmp_path)
        assert "pid=" in lock_path(tmp_path).read_text()
        release()
        # The note outlives the claim; the kernel's lock does not, and the
        # kernel's lock is the one that decides.
        assert lock_path(tmp_path).exists()
        assert claim(tmp_path)["enforced"] is True


class TestARealSecondProcess:
    """The stand-in descriptor above is fast; this is the thing itself."""

    def test_a_second_python_process_is_refused(self, tmp_path):
        claim(tmp_path)
        script = (
            f"import sys; sys.path.insert(0, {str(ROOT)!r})\n"
            "from modules.single_writer import claim, SingleWriterConflict\n"
            "try:\n"
            f"    claim({str(tmp_path)!r})\n"
            "    print('CLAIMED')\n"
            "except SingleWriterConflict:\n"
            "    print('REFUSED')\n"
        )
        result = subprocess.run(  # noqa: S603 - our own interpreter, literal script
            [sys.executable, "-c", script], capture_output=True, text=True, timeout=60,
        )
        assert result.stdout.strip() == "REFUSED", result.stderr

    def test_the_lock_dies_with_the_process_that_held_it(self, tmp_path):
        """No lease, no timeout, no stale claim — the kernel drops it on exit,
        including on SIGKILL. That property is the whole reason for `flock`
        over a PID file, so it is pinned rather than assumed."""
        script = (
            f"import sys; sys.path.insert(0, {str(ROOT)!r})\n"
            "from modules.single_writer import claim\n"
            f"claim({str(tmp_path)!r})\n"
        )
        subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=60)  # noqa: S603
        assert claim(tmp_path)["enforced"] is True, "a dead process still held the directory"


class TestTheGatewayActuallyTakesIt:
    """A guard nothing calls is the `DATA_OPS_BACKEND=postgres` mistake again —
    a setting that existed, tested clean, and selected nothing."""

    async def test_start_claims_before_the_loops_are_running(self, monkeypatch):
        from modules.risk_proxy import RiskGateway

        order: list[str] = []
        monkeypatch.setattr(
            "modules.risk_proxy.claim_single_writer", lambda: order.append("claim")
        )
        gateway = RiskGateway()
        await gateway.start()
        try:
            assert order == ["claim"]
        finally:
            await gateway.stop()

    async def test_a_conflicted_gateway_never_reaches_its_loops(self, tmp_path, monkeypatch):
        from modules.risk_proxy import RiskGateway

        # `settings` is a frozen dataclass, so the state directory is redirected
        # at the resolver rather than at the field. Everything below the
        # redirect — the claim, the flock, the refusal — is the shipped path.
        target = tmp_path / single_writer.LOCK_FILENAME
        monkeypatch.setattr(single_writer, "lock_path", lambda _d=None: target)
        holder = _hold_from_elsewhere(target)
        gateway = RiskGateway()
        try:
            with pytest.raises(SingleWriterConflict):
                await gateway.start()
            assert gateway._monitor is None, (
                "the refusal has to land before anything begins mutating the book"
            )
        finally:
            holder.close()
