"""
Environment coercion, and the ``.env`` load that has to happen before it.
========================================================================

Split out of ``config.py`` on 2026-08-21, which had reached 434 lines — over
the house ceiling, and awkward to reduce because the body is one flat
``Settings`` dataclass whose ~200 fields are read as ``settings.foo`` from
almost every module in the tree. Nesting them into sub-dataclasses would be a
correct refactor and a breaking one; moving the five coercion helpers is
neither.

They earn their own module for a better reason than line count, though: they
are the only part of configuration that is pure. Every one is a total function
from a string to a value with no I/O and no state, so they can be tested
directly — ``_env_int`` returning the default for ``"abc"``, ``_env_bool``
accepting ``on`` but not ``maybe``, ``_env_list`` upper-casing and dropping
blanks — none of which was reachable while they were private to a module whose
import has the side effect of reading the filesystem.

**Deliberately still module-level functions, not a class.** They hold nothing
between calls; a class here would be a namespace with a constructor, and the
argument for `PollingController` or `DeskSourceMachine` being classes — that a
machine with state should be drivable without its host — does not apply to a
function that reads one variable and coerces it.

``config.py`` re-exports all five under their original private names, so no
call site changed and none needed to: nothing outside ``config.py`` ever
imported them.
"""

from __future__ import annotations

import os
from pathlib import Path

#: The gateway root. Defined here rather than in ``config`` because the ``.env``
#: load below needs it and that load must happen before any coercion runs.
BASE_DIR = Path(__file__).resolve().parent


def load_dotenv_if_present() -> None:
    """Load ``BASE_DIR/.env`` when python-dotenv is installed.

    Optional by design: the system runs without it, because in CI and in a
    container configuration arrives as real environment variables. Nothing is
    logged on failure — logging is not configured yet at import time, and a
    missing ``.env`` is the normal case, not a fault.
    """
    try:  # pragma: no cover - trivial
        from dotenv import load_dotenv

        load_dotenv(BASE_DIR / ".env")
    except Exception:  # pragma: no cover  # noqa: S110 - see docstring
        pass


def env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


def env_float(key: str, default: float) -> float:
    raw = env(key)
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def env_int(key: str, default: int) -> int:
    raw = env(key)
    try:
        return int(float(raw)) if raw else default
    except ValueError:
        return default


def env_bool(key: str, default: bool) -> bool:
    raw = env(key).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "y", "on"}


def env_list(key: str, default: list[str]) -> list[str]:
    raw = env(key)
    if not raw:
        return list(default)
    return [item.strip().upper() for item in raw.split(",") if item.strip()]
