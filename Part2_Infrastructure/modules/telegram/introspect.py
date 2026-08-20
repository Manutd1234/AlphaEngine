"""What the repo says about itself: verify gates, routes, OpenAPI, line counts.

Read by both the developer desk tab and the ``/readiness`` family, which is why
these are module functions rather than methods on the bot.
"""

from __future__ import annotations

import json
from pathlib import Path

"""The gates the deploy workflow actually runs before it will ship a build.

This replaced three hardcoded assertion counts (342/680/13) that drifted the
moment anyone added a test — including the tests added to cover this very
module. A number nobody updates is worse than no number, because it keeps
looking authoritative. These are names, not counts: they are checkable against
`.github/workflows/deploy.yml` by reading it.
"""
_VERIFY_GATES: tuple[str, ...] = (
    "ruff check .",
    "python -m pytest",
    "tools/export_openapi.py --check",
    "tools/synthetic_probe.py",
)


def _committed_route_counts() -> list[tuple[str, float]]:
    """Routes per tag, parsed from the committed OpenAPI snapshot.

    Real committed data that updates itself when a route lands, rather than a
    figure maintained by hand. Returns an empty list when the snapshot is not
    in the image, so the caller can say so rather than draw a lie.
    """
    snapshot = Path(__file__).resolve().parent.parent / "tools" / "openapi.json"
    try:
        document = json.loads(snapshot.read_text())
    except (OSError, ValueError):
        return []
    counts: dict[str, int] = {}
    for operations in document.get("paths", {}).values():
        for operation in operations.values():
            if not isinstance(operation, dict):
                continue
            for tag in operation.get("tags", ["untagged"]):
                counts[str(tag)] = counts.get(str(tag), 0) + 1
    return sorted(((tag, float(n)) for tag, n in counts.items()), key=lambda row: -row[1])


def _openapi_operations_by_tag() -> dict[str, list[tuple[str, str, str]]]:
    """``tag -> [(METHOD, path, summary)]`` from the committed OpenAPI snapshot.

    A synchronous file read on purpose: the ``/apis`` handler is async and
    ruff's ASYNC rules (rightly) refuse a blocking read inside a coroutine, so
    the disk touch is isolated here where it is plainly synchronous. Empty when
    the snapshot is not in the image.
    """
    snapshot = Path(__file__).resolve().parent.parent / "tools" / "openapi.json"
    try:
        document = json.loads(snapshot.read_text())
    except (OSError, ValueError):
        return {}
    by_tag: dict[str, list[tuple[str, str, str]]] = {}
    for path, operations in (document.get("paths") or {}).items():
        for method, operation in operations.items():
            if not isinstance(operation, dict):
                continue
            for tag in operation.get("tags", ["untagged"]):
                by_tag.setdefault(str(tag), []).append(
                    (method.upper(), str(path), str(operation.get("summary") or ""))
                )
    return by_tag


def _codebase_line_counts() -> list[tuple[str, int, int]]:
    """``(area, files, lines)`` for the Python that ships, walked from disk.

    Synchronous, and called from the async ``/codebase`` handler for the same
    reason ``_openapi_operations_by_tag`` is: the walk blocks, so it stays out
    of the coroutine.
    """
    import os

    root = Path(__file__).resolve().parent.parent
    areas = {"modules": root / "modules", "tools": root / "tools", "tests": root / "tests"}
    counts: list[tuple[str, int, int]] = []
    for name, path in areas.items():
        files = 0
        total_lines = 0
        if path.exists():
            for dirpath, _dirs, filenames in os.walk(path):
                if "__pycache__" in dirpath:
                    continue
                for filename in filenames:
                    if not filename.endswith(".py"):
                        continue
                    files += 1
                    try:
                        with (Path(dirpath) / filename).open("r", encoding="utf-8", errors="ignore") as handle:
                            total_lines += sum(1 for _ in handle)
                    except OSError:
                        pass
        counts.append((name, files, total_lines))
    main = root / "main.py"
    if main.exists():
        with main.open("r", encoding="utf-8", errors="ignore") as handle:
            counts.append(("main.py", 1, sum(1 for _ in handle)))
    return counts
