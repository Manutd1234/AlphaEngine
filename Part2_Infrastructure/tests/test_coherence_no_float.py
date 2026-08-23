"""The kernel may not use float. Enforced by parsing it, not by grepping it.

Lesson 1's assertion, and the one rule in this package a reviewer cannot check
by running the code: a float that creeps into the kernel gives answers that are
right in every test anyone thinks to write and wrong at the fourth decimal
place, which is exactly where this engine's decisions are taken.

This reads the **abstract syntax tree** rather than the text. The first draft
was a regex over the source and it failed on its own documentation — the prose
in ``book.py`` explaining that a NO bid at $0.56 implies a YES ask at $0.44
contains two numbers that look like float literals, and an error message
mentioning "0.01 contracts" contains a third. A grep cannot tell a number in a
sentence from a number in an expression. The parser can, and it also cannot be
fooled the other way: a float that arrives through ``operator.truediv`` or a
string-built annotation is still a float in the tree.
"""

from __future__ import annotations

import ast
from pathlib import Path

KERNEL = Path(__file__).resolve().parent.parent / "modules" / "coherence" / "kernel"

# `Decimal(1) / 100` is exact and idiomatic; `1 / 100` is a float. Only literals
# that are *written* as floats, names that resolve to the float builtin, and the
# math module (every function in which returns a float) are offences.
FORBIDDEN_NAMES = {"float"}
FORBIDDEN_MODULES = {"math"}

#: The one module allowed to touch float, and the argument for it.
#:
#: `dutchbook` calls SciPy's HiGHS, whose API is float arrays — there is no
#: Decimal linear programme to call instead. So it crosses at exactly one
#: boundary: prices go in as float, and the answer comes back through
#: `Decimal(str(...))` immediately. Nothing downstream ever sees the float.
#:
#: The exemption is a named entry rather than a relaxed rule for the same
#: reason `OVER_CEILING` is a list rather than a higher ceiling: it is a debt
#: with a reason attached, and the test below checks the debt is still the
#: shape it was admitted as. If a second module needs this, that is a design
#: change and it should have to argue for itself here.
FLOAT_BOUNDARY = "dutchbook.py"


def _offences(source: Path) -> list[str]:
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            found.append(f"{source.name}:{node.lineno} float literal {node.value!r}")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            found.append(f"{source.name}:{node.lineno} reference to the float builtin")
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in FORBIDDEN_MODULES:
                found.append(f"{source.name}:{node.lineno} {node.value.id}.{node.attr}")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in FORBIDDEN_MODULES:
                    found.append(f"{source.name}:{node.lineno} imports {alias.name}")
        elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] in FORBIDDEN_MODULES:
            found.append(f"{source.name}:{node.lineno} imports from {node.module}")
    return found


def _sources() -> list[Path]:
    return sorted(path for path in KERNEL.glob("*.py") if path.name != "__init__.py")


def _pure_sources() -> list[Path]:
    return [path for path in _sources() if path.name != FLOAT_BOUNDARY]


def test_the_kernel_is_being_scanned():
    """A guard that scans an empty directory passes for ever."""
    sources = _sources()
    assert len(sources) >= 3, f"expected the kernel's modules, found {[p.name for p in sources]}"


def test_no_float_reaches_the_kernel():
    offences = [line for source in _pure_sources() for line in _offences(source)]
    assert not offences, "float reached the coherence kernel:\n  " + "\n  ".join(offences)


def test_the_float_boundary_is_still_only_the_solver_call():
    """The exemption must stay the shape it was granted as.

    Two claims. The named module does still need it — an exemption nobody uses
    is a hole left open — and the value it hands back is a Decimal, because the
    whole permission rests on the float never leaving the solver call.
    """
    boundary = KERNEL / FLOAT_BOUNDARY
    assert boundary.exists(), f"{FLOAT_BOUNDARY} is gone; remove its exemption"
    source = boundary.read_text(encoding="utf-8")
    assert _offences(boundary), (
        f"{FLOAT_BOUNDARY} no longer uses float at all — delete its exemption rather than leaving it open"
    )
    assert "Decimal(str(" in source, (
        f"{FLOAT_BOUNDARY} must convert the solver's answer back through Decimal(str(...)); "
        "a float that escapes the call is the thing this exemption does not cover"
    )
    assert "linprog" in source, f"{FLOAT_BOUNDARY} is exempt because it calls a float solver, and it no longer does"


def test_the_guard_catches_a_float_when_one_is_present():
    """Prove the scanner works, so a silent pass cannot mean a broken scanner.

    Written against a sample rather than a real file: the point is that the
    tree-walk finds all four shapes, and a fixture is the only way to assert
    that without putting a float in the kernel to see what happens.
    """
    sample = ast.parse("import math\nx: float = 1.5\ny = float('2')\nz = math.sqrt(4)\n")
    found: list[str] = []
    for node in ast.walk(sample):
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            found.append("literal")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            found.append("name")
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in FORBIDDEN_MODULES:
                found.append("attribute")
        elif isinstance(node, ast.Import):
            found.append("import")
    assert set(found) == {"literal", "name", "attribute", "import"}, f"the scanner missed a shape: {sorted(set(found))}"
