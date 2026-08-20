"""A ceiling on file length, ratcheting down.

Ruff has no file-length rule and there is no other lint on this tree, so a
300-400 line convention had nothing holding it — which is how
``modules/telegram.py`` reached nearly 7,000 lines with a single class holding
84% of them.

Same shape as the web suite's ``file-size.test.ts`` and as ``dead-css``: an
allow-list that may shrink and must not grow. A flat "every file under 400"
would be red on the day it was written and therefore ignored; a ratchet is red
only when someone makes things worse.

Two rules. A file already on the list may not get LONGER — that is what stops
"I will split it later" becoming "it grew while I waited". A file not on the
list may not cross the ceiling at all.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CEILING = 400

#: Files over the ceiling today, at the length they are at.
#:
#: Every entry is a debt, not an exemption. The number may go DOWN freely; it
#: may not go up. Delete an entry once the file is under the ceiling — that is
#: the ratchet closing.
OVER_CEILING: dict[str, int] = {
    "modules/telegram.py": 6961,
    "modules/risk_proxy.py": 2233,
    "modules/audit.py": 1249,
    "main.py": 1244,
    "modules/tca_engine.py": 1014,
    "tests/test_quant_risk.py": 863,
    "tests/test_telegram_link.py": 862,
    "tests/test_session_rollover.py": 857,
    "modules/schemas.py": 856,
    "tests/test_telegram.py": 830,
    "modules/data_quality.py": 771,
    "modules/telegram_charts.py": 766,
    "modules/metrics.py": 689,
    "modules/research_rag.py": 640,
    "tools/e2e_smoke.py": 603,
    "tests/test_working_orders.py": 529,
    "modules/portfolio.py": 485,
    "tests/test_tca_engine.py": 478,
    "tests/test_data_jobs.py": 466,
    "tests/test_api.py": 436,
    "tests/test_decision_core_native.py": 435,
    "config.py": 435,
    "tests/test_telegram_interactive.py": 422,
    "modules/operations.py": 405,
}

ROOTS = ("modules", "tools", "tests")
ROOT_FILES = ("main.py", "config.py", "celery_tasks.py", "worker.py")


def _measure() -> dict[str, int]:
    sizes: dict[str, int] = {}
    for directory in ROOTS:
        for path in (ROOT / directory).rglob("*.py"):
            if "__pycache__" in str(path):
                continue
            sizes[str(path.relative_to(ROOT))] = len(path.read_text().split("\n"))
    for name in ROOT_FILES:
        path = ROOT / name
        if path.exists():
            sizes[name] = len(path.read_text().split("\n"))
    return sizes


def test_a_file_not_already_over_the_ceiling_stays_under_it():
    sizes = _measure()
    crossed = sorted(
        f"{path} ({lines})"
        for path, lines in sizes.items()
        if lines > CEILING and path not in OVER_CEILING
    )
    assert not crossed, (
        f"these crossed {CEILING} lines. Split them, or add them to OVER_CEILING "
        f"with a reason:\n  " + "\n  ".join(crossed)
    )


def test_a_file_already_over_the_ceiling_does_not_get_longer():
    sizes = _measure()
    grown = sorted(
        f"{path}: {OVER_CEILING[path]} -> {lines}"
        for path, lines in sizes.items()
        if path in OVER_CEILING and lines > OVER_CEILING[path]
    )
    assert not grown, (
        "these are already over the ceiling and grew. The ratchet only turns one "
        "way:\n  " + "\n  ".join(grown)
    )


def test_the_list_holds_no_file_that_is_already_under_the_ceiling():
    # A stale entry is a ceiling not being enforced on a file that has earned
    # it. Removing them is how the list empties.
    sizes = _measure()
    stale = sorted(
        f"{path} ({sizes.get(path, 'gone')})"
        for path in OVER_CEILING
        if sizes.get(path, 0) <= CEILING
    )
    assert not stale, (
        "remove these from OVER_CEILING — they are under the ceiling now:\n  "
        + "\n  ".join(stale)
    )
