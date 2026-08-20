"""The C901 / PLR0915 debt list turns one way.

`pyproject.toml`'s per-file-ignores names the files that were too complex when
those two rules were switched on. That list is a debt, not an exemption, and
the failure mode of any such list is that it outlives the debt: a file gets
refactored, the entry stays, and the rule is silently off for it forever after.

So this is the mirror of `test_file_size.py`'s second assertion. It runs ruff
with the project config ISOLATED — otherwise the ignores under test would
suppress the very findings that prove they are still needed — and fails when an
entry is no longer earning its place.

It does not assert the reverse. A new offender is caught by ruff itself in CI,
which is the whole point of having switched the rules on.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RULES = ("C901", "PLR0915")

#: Scanned explicitly. `--isolated` discards the project's `extend-exclude`, so
#: without this ruff would walk `venv` and take orders of magnitude longer.
TARGETS = ("main.py", "config.py", "celery_tasks.py", "worker.py", "modules", "tools", "tests")

#: Glob entries cover whole directories and cannot be checked file-by-file the
#: way a named path can. They are deliberate blanket allowances for scripts and
#: tests rather than debt against a specific file.
GLOBS = ("tools/*.py", "tests/*.py")


def _declared() -> dict[str, set[str]]:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    ignores = config["tool"]["ruff"]["lint"]["per-file-ignores"]
    return {
        path: {code for code in codes if code in RULES}
        for path, codes in ignores.items()
        if path not in GLOBS and any(code in RULES for code in codes)
    }


def _offenders() -> dict[str, set[str]]:
    # Every argument is a literal or `sys.executable`; nothing here comes from
    # input, and there is no shell. S603 cannot tell those apart.
    result = subprocess.run(  # noqa: S603
        [
            sys.executable, "-m", "ruff", "check", "--isolated",
            "--select", ",".join(RULES), "--output-format", "json",
            *[str(ROOT / t) for t in TARGETS if (ROOT / t).exists()],
        ],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    if not result.stdout.strip():
        return {}
    found: dict[str, set[str]] = {}
    for row in json.loads(result.stdout):
        relative = str(pathlib.Path(row["filename"]).relative_to(ROOT))
        found.setdefault(relative, set()).add(row["code"])
    return found


def test_no_entry_outlives_its_debt():
    declared, offending = _declared(), _offenders()
    assert offending, (
        "ruff reported no complexity findings at all, which means this test is "
        "not measuring anything — check the --isolated invocation"
    )
    stale = sorted(
        f"{path}: {sorted(codes - offending.get(path, set()))}"
        for path, codes in declared.items()
        if codes - offending.get(path, set())
    )
    assert stale == [], (
        "these per-file-ignores are no longer needed — the file complies now, "
        "so delete the entry and let the rule apply:\n  " + "\n  ".join(stale)
    )


def test_the_rules_are_actually_switched_on():
    """A debt list means nothing if the rules it defers are not selected."""
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    selected = config["tool"]["ruff"]["lint"]["select"]
    assert "C90" in selected, "C901's family is not selected, so the debt list defers nothing"
    assert "PLR0915" in selected


def test_the_thresholds_are_ruffs_defaults():
    """Tuned to fit the worst function, a threshold is a description not a rule."""
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    lint = config["tool"]["ruff"]["lint"]
    assert lint["mccabe"]["max-complexity"] == 10
    assert lint["pylint"]["max-statements"] == 50
