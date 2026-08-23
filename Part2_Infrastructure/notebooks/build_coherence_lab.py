#!/usr/bin/env python3
"""Generates the ten coherence-lab notebooks into ``notebooks/coherence_lab/``.

    python notebooks/build_coherence_lab.py            # print what would be written
    python notebooks/build_coherence_lab.py --write    # write the ten notebooks
    python notebooks/build_coherence_lab.py --check    # exit 1 if any is stale

Authored as a script for the reason ``build_research_template.py`` is: the
narrative stays diff-able as text rather than living inside JSON cell blobs, and
re-running produces byte-identical notebooks. The ``--write``/``--check`` pair is
the idiom ``tools/telegram_catalogue.py`` established — a generated artefact that
nobody hand-edits, with a check a test can run so drift turns the suite red
rather than shipping.

**The lessons are not written here.** They are read out of
``web/lib/coherence/lessons.ts``, the same catalogue the Coherence tab renders,
so a notebook and a pane cannot disagree about what a lesson claims. This file
knows how to turn a lesson into a notebook and nothing about what the lessons
say; ``coherence_lab_content.py`` holds the code cells.

Every cell runs. The notebooks import ``modules.coherence.kernel`` directly and
read the recorded Kalshi payloads in ``tests/fixtures/coherence/`` — no gateway,
no network, no API key. Where a lesson needs a solver that is in the tested venv
but not on the deployment image, it goes through the same seam the engine does
and prints which engine answered.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import nbformat as nbf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from notebooks.coherence_lab_content import SETUP, sections_for  # noqa: E402

LESSONS_TS = ROOT / "web" / "lib" / "coherence" / "lessons.ts"
OUT_DIR = Path(__file__).resolve().parent / "coherence_lab"

#: A floor, deliberately not a count. Pinning the number would mean every lesson
#: added to the catalogue breaks this generator, which is the wrong invariant:
#: what has to hold is that every catalogued lesson produces a notebook and every
#: notebook on disk comes from a catalogued lesson, and `--check` already tests
#: both directions. The floor is here only to catch a parser that silently
#: matched nothing, because a lab of two notebooks would otherwise look fine.
MIN_LESSONS = 10

_BLOCK = re.compile(r"\n  \{\n(.*?)\n  \},", re.DOTALL)
_ARRAY = re.compile(r"\[(.*?)\]", re.DOTALL)
_QUOTED = re.compile(r"\"((?:[^\"\\]|\\.)*)\"")

_SCALARS = ("id", "title", "summary", "formula", "whenItHolds", "whenItFails", "pane")
_REQUIRED = ("id", "title", "summary", "whenItHolds", "whenItFails", "pane")


def _scalar(block: str, name: str) -> str | None:
    """One quoted field of a lesson literal, with its escapes resolved.

    Read with a regex rather than a TypeScript parser, and that choice has a
    cost worth stating: it works because the literal is hand-maintained in one
    shape, and it fails loudly through ``_validate`` when that stops being true.
    A silent partial parse would produce a notebook missing the failure line,
    which is the line that earns the lesson.
    """
    match = re.search(rf"\b{name}:\s*\n?\s*\"((?:[^\"\\]|\\.)*)\"", block)
    return None if match is None else json.loads(f'"{match.group(1)}"')


def _array(block: str, name: str) -> tuple[str, ...]:
    match = re.search(rf"\b{name}:\s*(\[.*?\])", block, re.DOTALL)
    if match is None:
        return ()
    body = _ARRAY.search(match.group(1))
    return () if body is None else tuple(json.loads(f'"{item}"') for item in _QUOTED.findall(body.group(1)))


def _validate(lessons: list[dict[str, Any]]) -> None:
    if len(lessons) < MIN_LESSONS:
        raise SystemExit(
            f"{LESSONS_TS.name} parsed to only {len(lessons)} lessons, under the floor of {MIN_LESSONS}. "
            "A catalogue does not shrink, so this is a parser that stopped understanding the file; "
            "do not generate a lab from a partial read."
        )
    for index, lesson in enumerate(lessons):
        missing = [field for field in _REQUIRED if not lesson.get(field)]
        if missing:
            raise SystemExit(f"lesson {index} in {LESSONS_TS.name} parsed without {missing}")


def read_lessons() -> list[dict[str, Any]]:
    """The ten lessons, in catalogue order, from the TypeScript that defines them."""
    if not LESSONS_TS.exists():
        raise SystemExit(f"missing {LESSONS_TS}: the lab is generated from the lesson catalogue, not from prose here")
    text = LESSONS_TS.read_text(encoding="utf-8")
    lessons = [
        {
            **{name: _scalar(block, name) for name in _SCALARS},
            "guards": _array(block, "guards"),
            "pinnedBy": _array(block, "pinnedBy"),
            "shipped": "shipped: true" in block,
        }
        for block in _BLOCK.findall(text)
    ]
    _validate(lessons)
    return lessons


def _card(index: int, lesson: dict[str, Any]) -> str:
    """The lesson itself, rendered as the catalogue states it.

    Both boundaries are printed, and the failure one is not optional: a lesson
    that only says what is true teaches a reader to trust it everywhere.
    """
    lines = [
        f"# Lesson {index} — {lesson['title']}",
        "",
        lesson["summary"],
        "",
    ]
    if lesson.get("formula"):
        lines += [f"**The rule.** `{lesson['formula']}`", ""]
    lines += [
        f"**When it holds.** {lesson['whenItHolds']}",
        "",
        f"**When it fails.** {lesson['whenItFails']}",
        "",
        "| | |",
        "|---|---|",
        f"| Lesson id | `{lesson['id']}` |",
        f"| Pane it appears on | `{lesson['pane']}` (panes carry more than one lesson) |",
        f"| Code it is about | {', '.join(f'`{item}`' for item in lesson['guards']) or 'not yet pinned to a module'} |",
        f"| Tests that go red if it stops being true | {', '.join(f'`{item}`' for item in lesson['pinnedBy']) or 'none yet'} |",
        f"| Pane shipped | {'yes' if lesson['shipped'] else 'not yet — the engine runs, the pane is a placeholder'} |",
        "",
        "Every cell below runs against the real kernel. Nothing here is a re-implementation:",
        "a number this notebook prints is the number the engine would produce for the same",
        "input. The recorded Kalshi payloads come from `tests/fixtures/coherence/`.",
    ]
    return "\n".join(lines)


def build(index: int, lesson: dict[str, Any]) -> nbf.NotebookNode:
    """One lesson as a notebook: the claim, then the code that demonstrates it."""
    cells = [nbf.v4.new_markdown_cell(_card(index, lesson)), nbf.v4.new_code_cell(SETUP.strip())]
    for heading, code in sections_for(lesson["id"]):
        if heading:
            cells.append(nbf.v4.new_markdown_cell(heading.strip()))
        cells.append(nbf.v4.new_code_cell(code.strip()))

    # Deterministic cell ids. nbformat mints a random one per cell, which would
    # make every regeneration a diff and `--check` permanently red.
    for position, cell in enumerate(cells):
        cell["id"] = f"l{index}c{position:02d}"

    notebook = nbf.v4.new_notebook()
    notebook["cells"] = cells
    notebook["metadata"] = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.12"},
    }
    return notebook


def render() -> dict[Path, str]:
    """Every notebook the catalogue implies, as ``path -> text``."""
    rendered: dict[Path, str] = {}
    for index, lesson in enumerate(read_lessons()):
        text = nbf.writes(build(index, lesson))
        rendered[OUT_DIR / f"lesson_{index}_{lesson['id']}.ipynb"] = text if text.endswith("\n") else text + "\n"
    return rendered


def _stale(rendered: dict[Path, str]) -> list[str]:
    """What is out of date, in the words a reader would need to fix it."""
    problems = []
    for path, text in rendered.items():
        if not path.exists():
            problems.append(f"{path.name} has not been generated")
        elif path.read_text(encoding="utf-8") != text:
            problems.append(f"{path.name} differs from what the generator produces")
    if OUT_DIR.exists():
        expected = {path.name for path in rendered}
        for found in sorted(OUT_DIR.glob("*.ipynb")):
            if found.name not in expected:
                problems.append(f"{found.name} is on disk but no lesson generates it")
    return problems


def main(argv: list[str]) -> int:
    check = "--check" in argv
    write = "--write" in argv
    rendered = render()

    if check:
        problems = _stale(rendered)
        if problems:
            print("coherence lab is out of date:", file=sys.stderr)
            for problem in problems:
                print(f"  {problem}", file=sys.stderr)
            print("run: python notebooks/build_coherence_lab.py --write", file=sys.stderr)
            return 1
        print(f"coherence lab is in sync with {LESSONS_TS.relative_to(ROOT)} ({len(rendered)} notebooks)")
        return 0

    if not write:
        print(f"{len(rendered)} notebooks would be written to {OUT_DIR.relative_to(ROOT)}/:")
        for path in rendered:
            print(f"  {path.name}")
        print("\npass --write to generate them, --check to verify the ones on disk")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path, text in rendered.items():
        path.write_text(text, encoding="utf-8")
    cells = sum(len(json.loads(text)["cells"]) for text in rendered.values())
    print(f"wrote {len(rendered)} notebooks ({cells} cells) to {OUT_DIR.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
