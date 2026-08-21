"""The single-writer claim as an object rather than a hidden module global.

``tests/test_single_writer.py`` pins the BEHAVIOUR — that a second writer on one
state directory is refused, that the kernel drops the lock when the holder dies,
that the gateway takes the claim before its loops start. All of it still runs
against the process-wide claim, and none of it changes here.

This file pins the two things that were not expressible while the claim was a
``_Claim | None`` rebound under ``global``:

* **Isolation.** The claim was process-wide, so a test that inherited one tested
  nothing — ``claim()`` short-circuits on the "already held" guard and hands
  back the PREVIOUS holder's status, a different path and very possibly
  ``enforced: True`` for a ``tmp_path`` that has since been deleted. The older
  file carries an autouse fixture calling ``release()`` on the way IN as well as
  out to survive exactly that, and says so in its docstring. A cleanup verb that
  exists only because the state is global is a class that has not been written
  yet.

* **The middle state.** ``enforced: False`` — "we asked and the filesystem would
  not promise" — is the whole reason ``status()`` returns a dict rather than a
  bool, and the only way to reach it was
  ``monkeypatch.setattr(single_writer, "_flock", ...)``: a module attribute
  shared with every other test in the process, and with the claim the gateway is
  holding. Injection makes it a constructor argument.

Nothing here calls the module-level ``claim()`` / ``release()``, so nothing here
can disturb the claim ``RiskGateway.start()`` took for the pytest process.
"""

from __future__ import annotations

import fcntl
from pathlib import Path

import pytest

from modules import single_writer
from modules.single_writer import SingleWriterClaim, SingleWriterConflict


def _refused(_handle):
    """A filesystem that cannot do advisory locking. Not a conflict."""
    return False, "advisory locking refused by the filesystem (OSError)"


def _granted(_handle):
    return True, "exclusive advisory lock held"


def _hold_from_elsewhere(path: Path):
    """A descriptor standing in for another process's.

    `flock` locks the open file description, not the process, so a second
    descriptor conflicts with the first even within one interpreter.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle


class TestTwoClaimsInOneProcess:
    def test_a_claim_does_not_inherit_another_claims_holding(self, tmp_path):
        """The defect: an unreleased claim answered for the next one.

        `claim()` returns early when something is already held, so a second
        caller was told about the FIRST caller's directory — a stale path
        reported as enforced, with nothing saying the answer was not about the
        directory that was asked for.
        """
        first = SingleWriterClaim()
        first.claim(tmp_path / "one")
        try:
            second = SingleWriterClaim()
            assert second.status()["held"] is False, (
                "a fresh claim must not inherit another instance's holding"
            )
            assert second.claim(tmp_path / "two")["enforced"] is True
            second.release()
        finally:
            first.release()

    def test_releasing_one_does_not_release_the_other(self, tmp_path):
        first = SingleWriterClaim()
        second = SingleWriterClaim()
        first.claim(tmp_path / "one")
        second.claim(tmp_path / "two")
        try:
            second.release()
            assert first.status()["held"] is True
            assert second.status()["held"] is False
        finally:
            first.release()

    def test_the_process_wide_claim_is_untouched_by_an_instance(self, tmp_path):
        before = single_writer.status()
        instance = SingleWriterClaim()
        instance.claim(tmp_path)
        instance.release()
        assert single_writer.status() == before, (
            "building a claim of one's own must not disturb the gateway's"
        )


class TestTheMiddleStateWithoutAMonkeypatch:
    def test_unenforced_is_neither_safety_nor_a_conflict(self, tmp_path):
        """Injected, so no other test in this process sees the substitution."""
        instance = SingleWriterClaim(flock=_refused)
        state = instance.claim(tmp_path)
        try:
            assert state["held"] is True, "the directory is ours as far as we can tell"
            assert state["enforced"] is False, "and we must not claim a promise we lack"
            assert "filesystem" in state["detail"], (
                "flattening the middle state reads as a lie in either direction"
            )
        finally:
            instance.release()

    def test_an_unenforced_claim_still_writes_its_holder_note(self, tmp_path):
        instance = SingleWriterClaim(flock=_refused)
        instance.claim(tmp_path)
        try:
            assert "pid=" in single_writer.lock_path(tmp_path).read_text()
        finally:
            instance.release()

    def test_an_unwritable_directory_is_reported_not_raised(self, tmp_path):
        """`config.ensure_dirs` and the audit layer meet this first and say it
        better. Refusing here would replace their message with a worse one."""
        blocked = tmp_path / "denied"
        blocked.mkdir()
        blocked.chmod(0o500)
        instance = SingleWriterClaim()
        try:
            state = instance.claim(blocked)
        finally:
            blocked.chmod(0o700)
        assert state == {
            "held": True,
            "enforced": False,
            "detail": "state directory is not writable",
        }

    def test_a_real_conflict_still_raises_rather_than_reporting(self, tmp_path):
        """Fail-closed on proof of a second writer, fail-open on "cannot lock"."""
        holder = _hold_from_elsewhere(single_writer.lock_path(tmp_path))
        instance = SingleWriterClaim()
        try:
            with pytest.raises(SingleWriterConflict):
                instance.claim(tmp_path)
            assert instance.status()["held"] is False, (
                "a refused claim must not leave the instance believing it holds one"
            )
        finally:
            holder.close()


class TestTheSeamsStayLateBoundWhenNotInjected:
    """The older suite monkeypatches `single_writer._flock` and `lock_path`.

    Capturing either at construction time would make those patches vacuous
    against the process-wide claim — the same failure `test_session_rollover`
    hit when a fixture patched a package attribute that every submodule had
    already bound directly. So an un-injected instance looks both up on the
    module at CALL time.
    """

    def test_a_patched_module_flock_still_reaches_an_uninjected_claim(self, tmp_path, monkeypatch):
        instance = SingleWriterClaim()
        monkeypatch.setattr(single_writer, "_flock", lambda _h: (False, "filesystem said no"))
        state = instance.claim(tmp_path)
        try:
            assert state["detail"] == "filesystem said no"
        finally:
            instance.release()

    def test_an_injected_flock_wins_over_the_module_one(self, tmp_path, monkeypatch):
        monkeypatch.setattr(single_writer, "_flock", lambda _h: (False, "module"))
        instance = SingleWriterClaim(flock=_granted)
        try:
            assert instance.claim(tmp_path)["enforced"] is True
        finally:
            instance.release()

    def test_a_patched_lock_path_still_reaches_an_uninjected_claim(self, tmp_path, monkeypatch):
        target = tmp_path / "elsewhere" / single_writer.LOCK_FILENAME
        monkeypatch.setattr(single_writer, "lock_path", lambda _d=None: target)
        instance = SingleWriterClaim()
        try:
            instance.claim(tmp_path)
            assert target.exists(), "the patched resolver decided where the lock went"
        finally:
            instance.release()


def test_the_module_functions_delegate_to_one_process_wide_instance():
    # No call site changed: `claim`, `release` and `status` are the same three
    # names `modules/risk_proxy` imports, now over an object.
    assert isinstance(single_writer._default, SingleWriterClaim)
    assert single_writer.status() == single_writer._default.status()
