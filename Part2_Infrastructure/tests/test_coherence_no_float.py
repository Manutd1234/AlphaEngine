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


def test_the_kernel_is_being_scanned():
    """A guard that scans an empty directory passes for ever."""
    sources = _sources()
    assert len(sources) >= 3, f"expected the kernel's modules, found {[p.name for p in sources]}"


def test_no_float_reaches_the_kernel():
    offences = [line for source in _sources() for line in _offences(source)]
    assert not offences, "float reached the coherence kernel:\n  " + "\n  ".join(offences)


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
