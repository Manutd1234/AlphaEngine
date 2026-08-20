"""The seam that keeps five harnesses from going vacuous.

``modules/risk_proxy/__init__.py`` says of itself:

    ``tests/test_risk_proxy_package.py`` proves the fan-out reaches the
    submodules and that a name it fails to reach is a red test rather than a
    quiet no-op.

It did not exist. The mechanism it describes — a package whose ``__setattr__``
pushes a rebound global out to every submodule that already defines it — is
what makes ``monkeypatch.setattr(risk_proxy, "settings", limits)`` and
``monkeypatch.setattr(risk_proxy, "_utcnow", frozen)`` still mean what they
meant when this was one 2,231-line module. Nineteen tests fail if the fan-out
is removed outright, so *that* much is held down. What nothing held down is the
narrower and far quieter failure: a submodule that stops holding the name as a
module global.

``__setattr__`` fans out to submodules where ``name in vars(module)``. A
submodule that switched to ``import config`` and read ``config.settings.x``,
or that reached the clock through ``modules.risk_proxy.clock._utcnow()``, would
still READ the patched decision — but would not be in ``vars()`` under that
name, so the fan-out would skip it, silently, and the gate fixture would judge
that module's arithmetic against the developer's ``.env`` while reporting
green. That is the exact shape of the two defects this round found by accident.

So these read the package's own source, work out which submodules USE each
patched name, and assert the fan-out reaches every one of them.
"""

from __future__ import annotations

import ast
import dataclasses
from pathlib import Path

import pytest

import modules.risk_proxy as risk_proxy
from config import settings as real_settings

#: The names a harness rebinds on the package object. ``settings`` is pinned by
#: ``tools/gate_fixture.py`` for all twenty parity scenarios and by
#: ``tests/test_working_orders.py``; ``_utcnow`` is pinned by the gate fixture,
#: ``tests/test_rehydration.py`` and ``tests/test_session_rollover.py``.
PATCHED_NAMES = ("settings", "_utcnow")

PKG = Path(risk_proxy.__file__).parent


def _module_globals(path: Path) -> set[str]:
    """Every name bound at module level in ``path``."""
    bound: set[str] = set()
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                bound.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                bound.add(alias.asname or alias.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    bound.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            bound.add(node.target.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
    return bound


def _uses(path: Path, name: str) -> bool:
    """Does ``path`` ever LOAD ``name``, anywhere, as a bare identifier?"""
    return any(
        isinstance(node, ast.Name) and node.id == name and isinstance(node.ctx, ast.Load)
        for node in ast.walk(ast.parse(path.read_text()))
    )


def _reads_through_another_module(path: Path, name: str) -> list[str]:
    """Places ``path`` reaches ``name`` as ``<something>.<name>``.

    ``config.settings.max_order_notional_usd`` is a perfectly ordinary way to
    write it and it works — but it reads ``config``'s global, which no amount
    of fanning out from this package can reach. A submodule written that way
    would be invisible to both the fan-out and to :func:`_uses`, so it is
    named here rather than left to be discovered by a fixture that quietly
    judged one module's arithmetic against the deployed configuration.

    ``modules.risk_proxy.clock._utcnow()`` is the same mistake for the clock.
    """
    found = []
    for node in ast.walk(ast.parse(path.read_text())):
        if (
            isinstance(node, ast.Attribute)
            and node.attr == name
            and isinstance(node.ctx, ast.Load)
        ):
            found.append(ast.unparse(node))
    return found


def _submodule_files() -> list[Path]:
    return sorted(p for p in PKG.glob("*.py") if p.name != "__init__.py")


def test_the_package_scan_finds_a_package():
    """Everything below is vacuous against an empty file list."""
    files = _submodule_files()
    assert len(files) >= 10, f"only found {len(files)} submodules under {PKG}"


def test_the_fan_out_is_installed():
    """Without the custom class, ``setattr`` on the package reaches nothing."""
    assert type(risk_proxy).__name__ == "_RiskProxyPackage", (
        "modules.risk_proxy is a plain module again — every "
        "monkeypatch.setattr aimed at it now sets an attribute nothing reads"
    )


@pytest.mark.parametrize("name", PATCHED_NAMES)
def test_every_submodule_that_uses_a_patched_name_holds_it_as_a_global(name):
    """The rot the fan-out cannot see.

    ``__setattr__`` only reaches ``name in vars(module)``. A submodule that
    uses the name but does not bind it at module level is invisible to the
    fan-out — the patch would land everywhere except the one place that
    changed, and nothing would fail.
    """
    unreachable = [
        path.name
        for path in _submodule_files()
        if _uses(path, name) and name not in _module_globals(path)
    ]
    assert not unreachable, (
        f"these submodules read `{name}` without binding it as a module global, "
        f"so the package fan-out cannot reach them: {unreachable}"
    )


@pytest.mark.parametrize("name", PATCHED_NAMES)
def test_no_submodule_reaches_a_patched_name_through_another_module(name):
    """The other way out of the fan-out's reach, and the quieter one."""
    offenders = {
        path.name: reads
        for path in _submodule_files()
        if (reads := _reads_through_another_module(path, name))
    }
    assert not offenders, (
        f"these read `{name}` off another module's globals, which the package "
        f"fan-out can never reach: {offenders}"
    )


@pytest.mark.parametrize("name", PATCHED_NAMES)
def test_the_fan_out_reaches_every_reader_of_a_patched_name(name, monkeypatch):
    """Set it on the package; every reader must see the new value."""
    readers = [path.name for path in _submodule_files() if _uses(path, name)]
    assert readers, f"no submodule reads `{name}` — is this still a patch point?"

    sentinel = (
        dataclasses.replace(real_settings, max_order_notional_usd=1.0)
        if name == "settings"
        else (lambda: None)
    )
    monkeypatch.setattr(risk_proxy, name, sentinel)

    reached = {
        Path(module.__file__).name
        for module in risk_proxy.submodules()
        if vars(module).get(name) is sentinel
    }
    missed = sorted(set(readers) - reached)
    assert not missed, f"setting `{name}` on the package did not reach {missed}"


@pytest.mark.parametrize("name", PATCHED_NAMES)
def test_the_undo_reaches_them_too(name, monkeypatch):
    """A patch that cannot be undone leaks into the next test in the session."""
    before = {
        module.__name__: vars(module)[name]
        for module in risk_proxy.submodules()
        if name in vars(module)
    }
    assert before, f"nothing holds `{name}`"

    monkeypatch.setattr(risk_proxy, name, lambda: None if name == "_utcnow" else None)
    monkeypatch.undo()

    after = {
        module.__name__: vars(module)[name]
        for module in risk_proxy.submodules()
        if name in vars(module)
    }
    assert after == before, "monkeypatch.undo did not restore every submodule"
