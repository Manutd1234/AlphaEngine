"""The audit store's clock, its timestamp reader, and the ``_KEEP`` sentinel.

Why the clock is read through the package
-----------------------------------------
``tests/test_rehydration.py`` arranges a deliberate timestamp tie — a
``book_reset`` written at exactly the instant of a ``session_rollover``, so the
replay has to refuse rather than guess — with a single line:

    monkeypatch.setattr(audit_module, "_utcnow", lambda: at.replace(tzinfo=None))

``audit_module`` there is ``modules.audit``, the package. When this was one
file, ``record_book_reset`` read the same module global that line patches, so
the tie was arranged and the refusal asserted. Split across files, a writer
that had done ``from modules.audit.clock import _utcnow`` would hold its own
binding, keep reading the real wall clock, and the two rows would land
microseconds apart. The refusal would never fire — and the test asserts a
``RuntimeError``, so it would go red, but the same trap on any *unasserted*
path would simply pass while testing nothing.

So writers call :func:`utcnow`, which reads ``modules.audit._utcnow`` at the
moment of the call. The package attribute stays the single patch point it was
when this was one file.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utcnow() -> datetime:
    """The clock, read through ``modules.audit._utcnow`` — see above."""
    return sys.modules[__package__]._utcnow()


#: Sentinel for "leave whatever is already stored alone".
#:
#: ``upsert_subscriber`` is a DELETE-then-INSERT, so any column it does not
#: carry forward is erased. ``/subscribe`` knows nothing about account linking
#: and must not unbind a chat merely by touching its alert preference — which is
#: exactly the defect a plain ``None`` default would have shipped.
_KEEP: Any = object()

def _audit_timestamp(value: Any, *, context: str) -> datetime:
    """A naive-UTC ``datetime`` from an audit column, or a refusal.

    DuckDB hands back a ``datetime``; the SQLite fallback hands back the ISO
    string it was given. Both have to become the same comparable value before a
    row can be placed on one side of a durable boundary — comparing a string
    against a ``datetime`` raises, and quietly failing to parse one would put
    every row on the wrong side of the boundary and say nothing about it.
    """
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.fromisoformat(str(value)).replace(tzinfo=None)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"invalid audit timestamp {context}: {value!r}") from exc
