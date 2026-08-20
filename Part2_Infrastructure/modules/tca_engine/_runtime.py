"""The two values this package resolves LATE rather than at import time.

Both were module globals of the single ``tca_engine.py``, so both are names a
test can patch on the module object, and one of them is patched today:

* ``tools/gate_fixture.py`` — shared by ``tools/make_gate_fixture.py`` and
  ``tests/test_gate_parity.py`` — pins the scenario's limits with
  ``monkeypatch.setattr(modules.tca_engine, "settings", limits)``. Every gate
  in the twenty-scenario battery is then judged against those limits, and
  ``venue_stale_after_s`` is one of them: it is what ``BookState.stale`` reads,
  and therefore what decides the ``reference_freshness`` gate.
* ``_utcnow`` is not patched by anything today. It is resolved the same way on
  purpose: a name the package still exports, that a future test would
  reasonably patch, and that would silently do nothing is a worse thing to
  leave behind than the six lines it costs to make it work.

A submodule that did a plain ``from config import settings`` would bind the
real settings object at import time and keep it. The patch above would then
change the *package* attribute and nothing else — the split would silently
disarm the fixture, the freshness scenarios would be judged against whatever
the developer's ``.env`` happened to say, and the parity suite would go green
having tested the wrong thing. Nothing would fail; that is the whole problem.

So ``settings`` here is a proxy that forwards every attribute read to
``modules.tca_engine.settings`` at the moment it is read. The package attribute
stays the single patch point it was when this was one file, every call site
keeps the literal ``settings.venue_stale_after_s`` it always had, and no
arithmetic moves.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any

#: The package this proxy reads through. Spelled once, here.
_PACKAGE = "modules.tca_engine"


class _SettingsProxy:
    """Reads ``modules.tca_engine.settings`` on every attribute access."""

    __slots__ = ()

    def __getattr__(self, name: str) -> Any:
        return getattr(sys.modules[_PACKAGE].settings, name)

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return f"<settings proxy -> {sys.modules[_PACKAGE].settings!r}>"


settings = _SettingsProxy()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow() -> datetime:
    """The clock, read through ``modules.tca_engine._utcnow`` — see above."""
    return sys.modules[_PACKAGE]._utcnow()
